CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 1,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_requests (
  request_id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  response_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_audit (
  entry_id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  entry_type TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_action_requests_created_at ON action_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_audit_team_created ON ledger_audit(team_id, created_at DESC);
