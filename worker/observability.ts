export const DIAGNOSTIC_SCHEMA = "branduel.diagnostic.v1";

export const DIAGNOSTIC_EVENTS = [
  "login.success",
  "login.failure",
  "action.request",
  "action.accepted",
  "action.rejected",
  "receipt.recovery",
  "revision.conflict",
  "settlement",
  "correction",
  "void.refund",
  "export",
  "health.failure",
  "unexpected.failure",
] as const;

export type DiagnosticEvent = (typeof DIAGNOSTIC_EVENTS)[number];
export type DiagnosticOutcome =
  | "accepted"
  | "rejected"
  | "recovered"
  | "failed";

export interface DiagnosticRecord {
  schemaVersion: typeof DIAGNOSTIC_SCHEMA;
  event: DiagnosticEvent;
  timestamp: string;
  requestId?: string;
  route?: string;
  actionType?: string;
  actorId?: string;
  startRevision?: number;
  endRevision?: number;
  responseStatus?: number;
  errorCode?: string;
  durationMs?: number;
  attempt?: number;
  outcome?: DiagnosticOutcome;
}

const SAFE_REQUEST_ID = /^[a-zA-Z0-9_-]{8,128}$/;
const SAFE_PLAYER_ID = /^[a-z][a-z0-9-]{1,32}$/;
const SAFE_ACTION_TYPE = /^[A-Z][A-Z0-9_]{0,64}$/;
const SAFE_ROUTE = /^\/api\/[a-z0-9/_:-]+$/;
const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,64}$/;
const KNOWN_ACTION_TYPES = new Set([
  "START_GAME_NIGHT",
  "END_GAME_NIGHT",
  "DISMISS_RECAP",
  "RESET",
  "RESET_SEASON",
  "START_ECONOMY_SEASON",
  "SET_GAME_NIGHT_MODE",
  "CREATE_LIVE_EVENT",
  "CREATE_PREP_EVENT",
  "START_MATCH",
  "RUN_IT_BACK",
  "PLACE_BET",
  "SETTLE_TEAM_EVENT",
  "SETTLE_FFA_EVENT",
  "SETTLE_EVENT",
  "CORRECT_RESULT",
  "CANCEL_EVENT",
  "REOPEN_EVENT",
  "PAUSE_BETTING",
  "UPDATE_SETTINGS",
  "UPDATE_TEAM_NAMES",
  "ADD_GAME",
  "UPDATE_GAME",
  "ADJUST_BALANCE",
]);

function safeRequestId(value: unknown) {
  if (
    typeof value !== "string" ||
    !SAFE_REQUEST_ID.test(value) ||
    /^[a-f0-9]{64}$/i.test(value)
  )
    return undefined;
  return value;
}

function safeActionType(value: unknown) {
  return typeof value === "string" &&
    SAFE_ACTION_TYPE.test(value) &&
    KNOWN_ACTION_TYPES.has(value)
    ? value
    : undefined;
}

function safeRevision(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function safeDuration(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.min(600_000, Math.round(value))
    : undefined;
}

function safeStatus(value: unknown) {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : undefined;
}

/** Allowlist the diagnostic shape so credentials, sessions, bodies, hashes, and state cannot enter logs. */
export function sanitizeDiagnosticRecord(
  value: unknown,
): DiagnosticRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    input.schemaVersion !== DIAGNOSTIC_SCHEMA ||
    !DIAGNOSTIC_EVENTS.includes(input.event as DiagnosticEvent)
  )
    return null;
  const timestamp =
    typeof input.timestamp === "string" &&
    Number.isFinite(Date.parse(input.timestamp))
      ? input.timestamp
      : undefined;
  if (!timestamp) return null;

  const record: DiagnosticRecord = {
    schemaVersion: DIAGNOSTIC_SCHEMA,
    event: input.event as DiagnosticEvent,
    timestamp,
  };
  const requestId = safeRequestId(input.requestId);
  const route =
    typeof input.route === "string" && SAFE_ROUTE.test(input.route)
      ? input.route
      : undefined;
  const actionType = safeActionType(input.actionType);
  const actorId =
    typeof input.actorId === "string" && SAFE_PLAYER_ID.test(input.actorId)
      ? input.actorId
      : undefined;
  const startRevision = safeRevision(input.startRevision);
  const endRevision = safeRevision(input.endRevision);
  const responseStatus = safeStatus(input.responseStatus);
  const errorCode =
    typeof input.errorCode === "string" && SAFE_ERROR_CODE.test(input.errorCode)
      ? input.errorCode
      : undefined;
  const durationMs = safeDuration(input.durationMs);
  const attempt =
    typeof input.attempt === "number" &&
    Number.isInteger(input.attempt) &&
    input.attempt >= 0 &&
    input.attempt <= 10
      ? input.attempt
      : undefined;
  const outcome = ["accepted", "rejected", "recovered", "failed"].includes(
    input.outcome as string,
  )
    ? (input.outcome as DiagnosticOutcome)
    : undefined;

  if (requestId !== undefined) record.requestId = requestId;
  if (route !== undefined) record.route = route;
  if (actionType !== undefined) record.actionType = actionType;
  if (actorId !== undefined) record.actorId = actorId;
  if (startRevision !== undefined) record.startRevision = startRevision;
  if (endRevision !== undefined) record.endRevision = endRevision;
  if (responseStatus !== undefined) record.responseStatus = responseStatus;
  if (errorCode !== undefined) record.errorCode = errorCode;
  if (durationMs !== undefined) record.durationMs = durationMs;
  if (attempt !== undefined) record.attempt = attempt;
  if (outcome !== undefined) record.outcome = outcome;
  return record;
}

export function diagnosticRecord(
  event: DiagnosticEvent,
  fields: Omit<
    Partial<DiagnosticRecord>,
    "schemaVersion" | "event" | "timestamp"
  > = {},
  timestamp = new Date().toISOString(),
) {
  const record = sanitizeDiagnosticRecord({
    schemaVersion: DIAGNOSTIC_SCHEMA,
    event,
    timestamp,
    ...fields,
  });
  if (!record) throw new Error("Unable to create a safe diagnostic record.");
  return record;
}

export function logDiagnostic(
  event: DiagnosticEvent,
  fields: Omit<
    Partial<DiagnosticRecord>,
    "schemaVersion" | "event" | "timestamp"
  > = {},
) {
  const message = JSON.stringify(diagnosticRecord(event, fields));
  if (event === "unexpected.failure" || event === "health.failure")
    console.error(message);
  else console.log(message);
}

export function knownActionType(value: unknown) {
  return safeActionType(value) ?? "UNKNOWN";
}

export function semanticActionEvent(
  actionType: string,
):
  | Extract<DiagnosticEvent, "settlement" | "correction" | "void.refund">
  | undefined {
  if (
    ["SETTLE_EVENT", "SETTLE_TEAM_EVENT", "SETTLE_FFA_EVENT"].includes(
      actionType,
    )
  )
    return "settlement";
  if (actionType === "CORRECT_RESULT") return "correction";
  if (actionType === "CANCEL_EVENT") return "void.refund";
  return undefined;
}
