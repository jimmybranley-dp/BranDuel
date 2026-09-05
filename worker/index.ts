/// <reference types="@cloudflare/workers-types" />

import { createInitialState } from "../src/data";
import { reducer, type Action } from "../src/store";
import type { AppState, PlayerId } from "../src/types";

interface Env {
  DB: D1Database;
}

interface StateRow {
  revision: number;
  state_json: string;
}

interface ActionRequest {
  action: Action;
  actorId: PlayerId;
  requestId: string;
}

const PLAYER_IDS = new Set<PlayerId>(["jason", "ezra", "corey", "jimmy", "brandon", "andrew", "bruce", "ryan"]);
const COMMISSIONER_ACTIONS = new Set<Action["type"]>([
  "START_GAME_NIGHT",
  "END_GAME_NIGHT",
  "CREATE_LIVE_EVENT",
  "START_MATCH",
  "RUN_IT_BACK",
  "DISMISS_RECAP",
  "CANCEL_EVENT",
  "REOPEN_EVENT",
  "UPDATE_SETTINGS",
  "ADJUST_BALANCE",
  "RESET",
]);

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

async function ensureSchema(db: D1Database) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL DEFAULT 1, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS action_requests (request_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, action_type TEXT NOT NULL, response_json TEXT, created_at TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS ledger_audit (entry_id TEXT PRIMARY KEY, team_id TEXT NOT NULL, amount INTEGER NOT NULL, entry_type TEXT NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL)"),
  ]);
}

async function getState(db: D1Database): Promise<{ state: AppState; revision: number }> {
  await ensureSchema(db);
  let row = await db.prepare("SELECT revision, state_json FROM app_state WHERE id = 1").first<StateRow>();
  if (!row) {
    const initial = createInitialState();
    await db.prepare("INSERT OR IGNORE INTO app_state (id, revision, state_json, updated_at) VALUES (1, 1, ?, ?)")
      .bind(JSON.stringify(initial), new Date().toISOString()).run();
    row = await db.prepare("SELECT revision, state_json FROM app_state WHERE id = 1").first<StateRow>();
  }
  if (!row) throw new Error("Unable to initialize BranDuel state.");
  return { state: JSON.parse(row.state_json) as AppState, revision: row.revision };
}

function isActionRequest(value: unknown): value is ActionRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<ActionRequest>;
  return typeof body.requestId === "string"
    && body.requestId.length >= 8
    && typeof body.actorId === "string"
    && PLAYER_IDS.has(body.actorId as PlayerId)
    && !!body.action
    && typeof body.action === "object"
    && typeof (body.action as Action).type === "string";
}

function applyAsActor(current: AppState, action: Action, actorId: PlayerId) {
  const actorState = structuredClone(current);
  actorState.currentPlayerId = actorId;
  const next = reducer(actorState, action);
  next.currentPlayerId = "jimmy";
  return next;
}

async function recordLedgerEntries(db: D1Database, previous: AppState, next: AppState) {
  const previousIds = new Set(previous.ledger.map((entry) => entry.id));
  const additions = next.ledger.filter((entry) => !previousIds.has(entry.id));
  if (!additions.length) return;
  await db.batch(additions.map((entry) => db.prepare(
    "INSERT OR IGNORE INTO ledger_audit (entry_id, team_id, amount, entry_type, description, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(entry.id, entry.teamId, entry.amount, entry.type, entry.description, entry.createdAt)));
}

async function handleAction(request: Request, env: Env) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!isActionRequest(body)) return json({ error: "Invalid action request." }, { status: 400 });
  if (body.action.type === "SET_PLAYER") return json({ error: "Player selection is local to each device." }, { status: 400 });
  if (COMMISSIONER_ACTIONS.has(body.action.type) && body.actorId !== "jimmy") {
    return json({ error: "Only Jimmy can perform that action." }, { status: 403 });
  }

  await ensureSchema(env.DB);
  const reserved = await env.DB.prepare(
    "INSERT OR IGNORE INTO action_requests (request_id, actor_id, action_type, response_json, created_at) VALUES (?, ?, ?, NULL, ?)",
  ).bind(body.requestId, body.actorId, body.action.type, new Date().toISOString()).run();

  if ((reserved.meta.changes ?? 0) === 0) {
    const existing = await env.DB.prepare("SELECT response_json FROM action_requests WHERE request_id = ?")
      .bind(body.requestId).first<{ response_json: string | null }>();
    if (existing?.response_json) return json(JSON.parse(existing.response_json));
    return json({ error: "This action is already being processed." }, { status: 409 });
  }

  try {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await getState(env.DB);
      const next = applyAsActor(current.state, body.action, body.actorId);
      const nextRevision = current.revision + 1;
      const payload = { state: next, revision: nextRevision, serverTime: new Date().toISOString() };
      const updated = await env.DB.prepare(
        "UPDATE app_state SET state_json = ?, revision = ?, updated_at = ? WHERE id = 1 AND revision = ?",
      ).bind(JSON.stringify(next), nextRevision, payload.serverTime, current.revision).run();

      if ((updated.meta.changes ?? 0) === 1) {
        await recordLedgerEntries(env.DB, current.state, next);
        await env.DB.prepare("UPDATE action_requests SET response_json = ? WHERE request_id = ?")
          .bind(JSON.stringify(payload), body.requestId).run();
        return json(payload);
      }
    }
    throw new Error("The league state changed too many times. Try again.");
  } catch (error) {
    await env.DB.prepare("DELETE FROM action_requests WHERE request_id = ?").bind(body.requestId).run();
    const message = error instanceof Error ? error.message : "Unable to apply action.";
    return json({ error: message }, { status: 409 });
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "BranDuel house" });
    }
    if (url.pathname === "/api/state" && request.method === "GET") {
      const current = await getState(env.DB);
      return json({ ...current, serverTime: new Date().toISOString() });
    }
    if (url.pathname === "/api/actions" && request.method === "POST") {
      return handleAction(request, env);
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "API route not found." }, { status: 404 });
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
