-- Additive migration: existing snapshots, request history and ledger rows are retained.
CREATE TABLE IF NOT EXISTS action_receipts (
  request_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS write_guards (
  request_id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);
CREATE TABLE IF NOT EXISTS player_sessions (
  token_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  credential_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_player_sessions_expiry ON player_sessions(expires_at);
CREATE TABLE IF NOT EXISTS login_attempts (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger_context (
  entry_id TEXT PRIMARY KEY REFERENCES ledger_audit(entry_id),
  request_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  entry_json TEXT NOT NULL
);
