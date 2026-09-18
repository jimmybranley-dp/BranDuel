import { createInitialState, normalizeState, PLAYER_IDS } from "../src/data";
import { applyAction, parseAction, DomainError } from "../src/domain";
import { knownActionType, logDiagnostic, semanticActionEvent } from "./observability";
import type { AppState, PlayerId } from "../src/types";

interface Snapshot { state: AppState; revision: number; serverTime: string; playerId?: PlayerId }
interface Receipt { actor_id: string; payload_hash: string; response_json: string; response_status: number }
const COOKIE = "branduel_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const MAX_BODY = 32_768;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { ...init, headers });
}
function failure(error: string, code: string, status: number) { return json({ error, code }, { status }); }
function hex(bytes: ArrayBuffer | Uint8Array) { return Array.from(new Uint8Array(bytes)).map(value => value.toString(16).padStart(2, "0")).join(""); }
async function digest(value: string) { return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))); }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return "{" + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",") + "}";
  return JSON.stringify(value);
}
function credentials(env: Env): Record<string, string> {
  try {
    const hashes = JSON.parse(env.PLAYER_PASSCODES ?? "null");
    if (!hashes || typeof hashes !== "object" || PLAYER_IDS.some(id => typeof hashes[id] !== "string" || !/^pbkdf2\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(hashes[id]))) throw new Error();
    return hashes;
  } catch { throw new Error("Player credentials have not been configured."); }
}
async function verify(passcode: string, stored: string) {
  const [, iterations, salt, expected] = stored.split("$");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(passcode), "PBKDF2", false, ["deriveBits"]);
  const actual = hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: Uint8Array.from(salt.match(/../g)!, pair => parseInt(pair, 16)), iterations: Number(iterations) }, key, 256));
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  return difference === 0;
}
function tokenFrom(request: Request) { return request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1); }
function cookie(request: Request, token: string, seconds: number) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
async function actor(request: Request, env: Env): Promise<PlayerId | null> {
  const token = tokenFrom(request);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const row = await env.DB.prepare("SELECT player_id, credential_hash FROM player_sessions WHERE token_hash = ? AND expires_at > ?").bind(await digest(token), Date.now()).first<{ player_id: PlayerId; credential_hash: string }>();
  if (!row || !PLAYER_IDS.includes(row.player_id) || await digest(credentials(env)[row.player_id]) !== row.credential_hash) return null;
  return row.player_id;
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new DomainError("Use application/json.", 400, "INVALID_REQUEST");
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("A JSON body is required.", 400, "INVALID_REQUEST");
  let size = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.length;
    if (size > MAX_BODY) { await reader.cancel(); throw new DomainError("Request body is too large.", 400, "INVALID_REQUEST"); }
    parts.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new DomainError("Invalid JSON body.", 400, "INVALID_JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("Invalid request body.", 400, "INVALID_REQUEST");
  return value as Record<string, unknown>;
}
function ledgerStatements(db: D1Database, previous: AppState | null, next: AppState, requestId: string, actorId: string) {
  const previousIds = new Set(previous?.ledger.map(entry => entry.id));
  return next.ledger.filter(entry => !previousIds.has(entry.id)).flatMap(entry => [
    db.prepare("INSERT INTO ledger_audit (entry_id, team_id, amount, entry_type, description, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(entry.id, entry.teamId, entry.amount, entry.type, entry.description, entry.createdAt),
    db.prepare("INSERT INTO ledger_context (entry_id, request_id, actor_id, entry_json) VALUES (?, ?, ?, ?)").bind(entry.id, requestId, actorId, JSON.stringify(entry)),
  ]);
}
async function getState(db: D1Database): Promise<Snapshot> {
  let row = await db.prepare("SELECT revision, state_json FROM app_state WHERE id = 1").first<{ revision: number; state_json: string }>();
  if (!row) {
    const initial = createInitialState();
    const now = new Date().toISOString();
    try {
      await db.batch([
        db.prepare("INSERT INTO app_state (id, revision, state_json, updated_at) VALUES (1, 1, ?, ?)").bind(JSON.stringify(initial), now),
        ...ledgerStatements(db, null, initial, "initialization", "system"),
      ]);
    } catch (error) {
      row = await db.prepare("SELECT revision, state_json FROM app_state WHERE id = 1").first<{ revision: number; state_json: string }>();
      if (!row) throw error;
    }
    row ??= await db.prepare("SELECT revision, state_json FROM app_state WHERE id = 1").first<{ revision: number; state_json: string }>();
  }
  if (!row) throw new Error("Unable to initialize state.");
  return { state: normalizeState(JSON.parse(row.state_json) as AppState), revision: row.revision, serverTime: new Date().toISOString() };
}
async function receipt(db: D1Database, requestId: string) { return db.prepare("SELECT actor_id, payload_hash, response_json, response_status FROM action_receipts WHERE request_id = ?").bind(requestId).first<Receipt>(); }
function receiptResponse(saved: Receipt, actorId: string, payloadHash?: string) {
  if (saved.actor_id !== actorId || (payloadHash !== undefined && saved.payload_hash !== payloadHash)) return failure("This request ID belongs to a different action. Refresh and try again.", "REQUEST_KEY_REUSED", 409);
  const payload = JSON.parse(saved.response_json);
  if (saved.response_status === 200) payload.serverTime = new Date().toISOString();
  return json(payload, { status: saved.response_status });
}
type ActionObservation = { requestId?: string; actionType?: string; actorId: PlayerId; startedAt: number; startRevision?: number; endRevision?: number; responseStatus?: number; errorCode?: string; attempt?: number };
function observeAction(response: Response, context: ActionObservation, outcome: "accepted" | "rejected" | "recovered" | "failed") {
  const fields = {
    requestId: context.requestId,
    route: "/api/actions",
    actionType: context.actionType,
    actorId: context.actorId,
    startRevision: context.startRevision,
    endRevision: context.endRevision,
    errorCode: context.errorCode,
    responseStatus: response.status,
    durationMs: Date.now() - context.startedAt,
    attempt: context.attempt,
    outcome,
  } as const;
  logDiagnostic("action.request", fields);
  if (outcome === "accepted") {
    logDiagnostic("action.accepted", fields);
    const semantic = context.actionType ? semanticActionEvent(context.actionType) : undefined;
    if (semantic) logDiagnostic(semantic, fields);
  } else if (outcome === "rejected") {
    logDiagnostic("action.rejected", fields);
  } else if (outcome === "recovered") {
    logDiagnostic("receipt.recovery", fields);
  }
  return response;
}
async function handleAction(request: Request, env: Env, actorId: PlayerId) {
  const startedAt = Date.now();
  const context: ActionObservation = { actorId, startedAt, actionType: "UNKNOWN" };
  let data: Record<string, unknown>;
  try { data = await body(request); }
  catch (error) {
    if (!(error instanceof DomainError)) throw error;
    context.errorCode = error.code;
    return observeAction(failure(error.message, error.code, error.status), context, "rejected");
  }
  context.requestId = typeof data.requestId === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(data.requestId) ? data.requestId : undefined;
  context.actionType = knownActionType((data.action as Record<string, unknown> | null)?.type);
  if (typeof data.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(data.requestId) || typeof data.expectedPlayerId !== "string" || !PLAYER_IDS.includes(data.expectedPlayerId as PlayerId) || Object.keys(data).some(key => !["requestId", "action", "expectedPlayerId"].includes(key))) {
    context.errorCode = "INVALID_REQUEST";
    return observeAction(failure("Invalid action request.", "INVALID_REQUEST", 400), context, "rejected");
  }
  // Cookies are shared between tabs. A stale tab must never submit under another player's new session.
  if (data.expectedPlayerId !== actorId) {
    context.errorCode = "SESSION_CHANGED";
    return observeAction(failure(`This browser is signed in as another player. Sign in as ${data.expectedPlayerId} to resolve this request.`, "SESSION_CHANGED", 401), context, "rejected");
  }
  const requestId = data.requestId;
  const payloadHash = await digest(canonical(data.action));
  let saved = await receipt(env.DB, requestId);
  if (saved) return observeAction(receiptResponse(saved, actorId, payloadHash), context, "recovered");
  const legacy = await env.DB.prepare("SELECT request_id FROM action_requests WHERE request_id = ?").bind(requestId).first();
  if (legacy) {
    context.errorCode = "LEGACY_REQUEST";
    return observeAction(failure("This request predates verified receipts. Jimmy must reconcile its original change before submitting a new request.", "LEGACY_REQUEST", 409), context, "rejected");
  }
  const action = parseAction(data.action);
  context.actionType = action.type;
  for (let attempt = 0; attempt < 5; attempt++) {
    context.attempt = attempt + 1;
    const current = await getState(env.DB);
    context.startRevision = current.revision;
    let next: AppState;
    try { next = applyAction(current.state, action, actorId); }
    catch (error) {
      if (!(error instanceof DomainError)) throw error;
      // Persist a terminal rejection at its observed revision so retries cannot become a new wager later.
      try {
        await env.DB.batch([
          env.DB.prepare("UPDATE app_state SET revision = revision WHERE id = 1 AND revision = ?").bind(current.revision),
          env.DB.prepare("INSERT INTO write_guards (request_id, valid) VALUES (?, changes())").bind(requestId),
          env.DB.prepare("INSERT INTO action_receipts (request_id, actor_id, payload_hash, response_json, response_status, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(requestId, actorId, payloadHash, JSON.stringify({ error: error.message, code: error.code }), error.status, new Date().toISOString()),
          env.DB.prepare("DELETE FROM write_guards WHERE request_id = ?").bind(requestId),
        ]);
        context.errorCode = error.code;
        return observeAction(failure(error.message, error.code, error.status), context, "rejected");
      } catch (writeError) {
        saved = await receipt(env.DB, requestId);
        if (saved) return observeAction(receiptResponse(saved, actorId, payloadHash), context, "recovered");
        const latest = await getState(env.DB);
        if (latest.revision !== current.revision) {
          logDiagnostic("revision.conflict", { requestId, route: "/api/actions", actionType: action.type, actorId, startRevision: current.revision, endRevision: latest.revision, responseStatus: 409, durationMs: Date.now() - startedAt, attempt: attempt + 1, outcome: "failed" });
          continue;
        }
        throw writeError;
      }
    }
    const payload: Snapshot = { state: next, revision: current.revision + 1, serverTime: new Date().toISOString(), playerId: actorId };
    try {
      await env.DB.batch([
        env.DB.prepare("UPDATE app_state SET state_json = ?, revision = ?, updated_at = ? WHERE id = 1 AND revision = ?").bind(JSON.stringify(next), payload.revision, payload.serverTime, current.revision),
        // D1 batch runs sequentially in one transaction. CHECK forces rollback if the CAS changed zero rows.
        env.DB.prepare("INSERT INTO write_guards (request_id, valid) VALUES (?, changes())").bind(requestId),
        ...ledgerStatements(env.DB, current.state, next, requestId, actorId),
        env.DB.prepare("INSERT INTO action_receipts (request_id, actor_id, payload_hash, response_json, response_status, created_at) VALUES (?, ?, ?, ?, 200, ?)").bind(requestId, actorId, payloadHash, JSON.stringify(payload), payload.serverTime),
        env.DB.prepare("DELETE FROM write_guards WHERE request_id = ?").bind(requestId),
      ]);
      return observeAction(json(payload), context, "accepted");
    } catch (error) {
      // A lost response after commit is resolved by its durable receipt, never by deleting the request.
      saved = await receipt(env.DB, requestId);
      if (saved) return observeAction(receiptResponse(saved, actorId, payloadHash), context, "recovered");
      const latest = await getState(env.DB);
      if (latest.revision !== current.revision) {
        logDiagnostic("revision.conflict", { requestId, route: "/api/actions", actionType: action.type, actorId, startRevision: current.revision, endRevision: latest.revision, responseStatus: 409, durationMs: Date.now() - startedAt, attempt: attempt + 1, outcome: "failed" });
        continue;
      }
      throw error;
    }
  }
  logDiagnostic("revision.conflict", { requestId, route: "/api/actions", actionType: context.actionType, actorId, startRevision: context.startRevision, responseStatus: 503, durationMs: Date.now() - startedAt, attempt: 5, errorCode: "WRITE_CONFLICT", outcome: "failed" });
  context.errorCode = "WRITE_CONFLICT";
  return observeAction(failure("The house is busy. Retry this same request shortly.", "WRITE_CONFLICT", 503), context, "rejected");
}
async function login(request: Request, env: Env) {
  const startedAt = Date.now();
  const observeLogin = (response: Response, playerId?: PlayerId, outcome: "accepted" | "rejected" = "rejected", errorCode?: string) => {
    logDiagnostic(outcome === "accepted" ? "login.success" : "login.failure", { route: "/api/login", actorId: playerId, responseStatus: response.status, errorCode, durationMs: Date.now() - startedAt, outcome });
    return response;
  };
  let data: Record<string, unknown>;
  try { data = await body(request); }
  catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return observeLogin(failure(error.message, error.code, error.status), undefined, "rejected", error.code);
  }
  const playerId = typeof data.playerId === "string" && PLAYER_IDS.includes(data.playerId as PlayerId) ? data.playerId as PlayerId : undefined;
  if (!playerId || typeof data.passcode !== "string" || data.passcode.length < 1 || data.passcode.length > 128) return observeLogin(failure("Choose a player and enter their passcode.", "INVALID_LOGIN", 400), playerId, "rejected", "INVALID_LOGIN");
  const now = Date.now();
  const window = Math.floor(now / 900_000);
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const keys = [`player:${playerId}:${window}`, `ip:${await digest(ip)}:${window}`];
  const counts = await env.DB.batch(keys.map(key => env.DB.prepare("INSERT INTO login_attempts (bucket, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1 RETURNING attempts").bind(key, now + 900_000)));
  const attempts = counts.map(result => Number((result.results[0] as { attempts: number }).attempts));
  if (attempts[0] > 20 || attempts[1] > 100) return observeLogin(failure("Too many sign-in attempts. Wait 15 minutes and try again.", "LOGIN_THROTTLED", 429), playerId, "rejected", "LOGIN_THROTTLED");
  const hashes = credentials(env);
  if (!await verify(data.passcode as string, hashes[playerId])) return observeLogin(failure("That player and passcode do not match.", "INVALID_LOGIN", 401), playerId, "rejected", "INVALID_LOGIN");
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const oldToken = tokenFrom(request);
  const statements = [env.DB.prepare("INSERT INTO player_sessions (token_hash, player_id, credential_hash, expires_at) VALUES (?, ?, ?, ?)").bind(await digest(token), playerId, await digest(hashes[playerId]), now + SESSION_SECONDS * 1000)];
  if (oldToken) statements.push(env.DB.prepare("DELETE FROM player_sessions WHERE token_hash = ?").bind(await digest(oldToken)));
  statements.push(env.DB.prepare("DELETE FROM player_sessions WHERE expires_at <= ?").bind(now), env.DB.prepare("DELETE FROM login_attempts WHERE expires_at <= ?").bind(now));
  await env.DB.batch(statements);
  return observeLogin(json({ playerId }, { headers: { "set-cookie": cookie(request, token, SESSION_SECONDS) } }), playerId, "accepted");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const startedAt = Date.now();
    if (!url.pathname.startsWith("/api/")) return new Response(null, { status: 404 });
    try {
      if (request.method !== "GET" && (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site")) return failure("Use this app’s own page to make changes.", "ORIGIN_REJECTED", 403);
      if (url.pathname === "/api/health" && request.method === "GET") {
        try { await env.DB.prepare("SELECT COUNT(*) AS count FROM app_state").first(); }
        catch {
          const response = failure("The house health check could not reach D1.", "HEALTH_D1_FAILURE", 503);
          logDiagnostic("health.failure", { route: "/api/health", responseStatus: response.status, durationMs: Date.now() - startedAt, errorCode: "HEALTH_D1_FAILURE", outcome: "failed" });
          return response;
        }
        return json({ ok: true, service: "BranDuel house" });
      }
      if (url.pathname === "/api/login" && request.method === "POST") return await login(request, env);
      if (url.pathname === "/api/logout" && request.method === "POST") {
        const token = tokenFrom(request);
        if (token) await env.DB.prepare("DELETE FROM player_sessions WHERE token_hash = ?").bind(await digest(token)).run();
        return json({ playerId: null }, { headers: { "set-cookie": cookie(request, "", 0) } });
      }
      const playerId = await actor(request, env);
      if (url.pathname === "/api/session" && request.method === "GET") return json({ playerId });
      if (!playerId) return failure("Sign in to continue.", "AUTH_REQUIRED", 401);
      if (url.pathname === "/api/state" && request.method === "GET") return json({ ...await getState(env.DB), playerId });
      if (url.pathname === "/api/actions" && request.method === "POST") return await handleAction(request, env, playerId);
      if (url.pathname.startsWith("/api/actions/") && request.method === "GET") {
        const expectedPlayerId = url.searchParams.get("expectedPlayerId");
        if (expectedPlayerId !== null && expectedPlayerId !== playerId) {
          const response = failure("This browser is signed in as another player. Sign in as the player who submitted this request to resolve it.", "SESSION_CHANGED", 401);
          logDiagnostic("receipt.recovery", { requestId: url.pathname.slice("/api/actions/".length), route: "/api/actions/:requestId", actorId: playerId, responseStatus: response.status, durationMs: Date.now() - startedAt, errorCode: "SESSION_CHANGED", outcome: "rejected" });
          return response;
        }
        const saved = await receipt(env.DB, url.pathname.slice("/api/actions/".length));
        if (!saved || saved.actor_id !== playerId) {
          const response = failure("No accepted request with this ID was found.", "REQUEST_UNKNOWN", 404);
          logDiagnostic("receipt.recovery", { requestId: url.pathname.slice("/api/actions/".length), route: "/api/actions/:requestId", actorId: playerId, responseStatus: response.status, durationMs: Date.now() - startedAt, errorCode: "REQUEST_UNKNOWN", outcome: "rejected" });
          return response;
        }
        const response = receiptResponse(saved, playerId);
        logDiagnostic("receipt.recovery", { requestId: url.pathname.slice("/api/actions/".length), route: "/api/actions/:requestId", actorId: playerId, responseStatus: response.status, durationMs: Date.now() - startedAt, outcome: "recovered" });
        return response;
      }
      if (url.pathname === "/api/export" && request.method === "GET") {
        if (playerId !== "jimmy") {
          const response = failure("Only Jimmy can export the event.", "FORBIDDEN", 403);
          logDiagnostic("export", { route: "/api/export", actorId: playerId, responseStatus: response.status, durationMs: Date.now() - startedAt, errorCode: "FORBIDDEN", outcome: "rejected" });
          return response;
        }
        await getState(env.DB);
        const [stateRows, audit] = await env.DB.batch([
          env.DB.prepare("SELECT revision, state_json FROM app_state WHERE id = 1"),
          env.DB.prepare("SELECT ledger_audit.*, ledger_context.request_id, ledger_context.actor_id, ledger_context.entry_json FROM ledger_audit LEFT JOIN ledger_context USING(entry_id) ORDER BY created_at, entry_id"),
        ]);
        const row = stateRows.results[0] as unknown as { revision: number; state_json: string };
        const now = new Date().toISOString();
        const response = json({ state: JSON.parse(row.state_json), revision: row.revision, serverTime: now, exportedAt: now, ledgerAudit: audit.results }, { headers: { "content-disposition": `attachment; filename="branduel-${now.slice(0, 10)}.json"` } });
        logDiagnostic("export", { route: "/api/export", actorId: playerId, startRevision: row.revision, endRevision: row.revision, responseStatus: response.status, durationMs: Date.now() - startedAt, outcome: "accepted" });
        return response;
      }
      return failure("API route not found.", "NOT_FOUND", 404);
    } catch (error) {
      if (error instanceof DomainError) return failure(error.message, error.code, error.status);
      const response = failure("The house could not confirm this request. Keep it pending and retry shortly.", "SERVICE_UNAVAILABLE", 503);
      logDiagnostic("unexpected.failure", { route: url.pathname, responseStatus: response.status, durationMs: Date.now() - startedAt, errorCode: "UNEXPECTED_FAILURE", outcome: "failed" });
      return response;
    }
  },
} satisfies ExportedHandler<Env>;
