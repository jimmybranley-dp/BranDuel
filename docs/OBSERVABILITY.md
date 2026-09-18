# Local diagnostics and observability

BranDuel uses structured Worker console logs and Cloudflare-native Workers Logs. Staging and production explicitly enable persisted Workers Logs with 100% head sampling and invocation logs disabled. There is no third-party observability service. Wrangler’s local `dev --local` stream is the local Cloudflare explorer surface; `wrangler tail` is a hosted real-time tail and must not be used for tests or this task.

The configuration follows Cloudflare’s Workers Logs schema: `observability.logs.enabled` and `persist` are true, `head_sampling_rate` is `1`, and `invocation_logs` is false in both named hosted environments. One hundred percent sampling is deliberate for this small event application: it keeps rare betting-window, receipt, and settlement failures diagnosable. Workers Logs retention is plan-dependent (currently up to three days on Free and seven days on Paid), and higher traffic or more console records can increase usage/cost; revisit the rate with an authorized operator if volume changes. See the [Cloudflare Workers Logs documentation](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).

## Diagnostic schema

Each Worker record is one JSON line with `schemaVersion: "branduel.diagnostic.v1"`. Events are:

| Event                                                  | Meaning                                            |
| ------------------------------------------------------ | -------------------------------------------------- |
| `login.success`, `login.failure`                       | Login result, player ID only when valid            |
| `action.request`, `action.accepted`, `action.rejected` | Authenticated action lifecycle                     |
| `receipt.recovery`                                     | Durable receipt lookup, replay, or recovery result |
| `revision.conflict`                                    | CAS/rebase conflict and retry                      |
| `settlement`, `correction`, `void.refund`              | Accepted economic/result operation                 |
| `export`                                               | Commissioner export success or denial              |
| `health.failure`                                       | D1-backed health check failure                     |
| `unexpected.failure`                                   | Unhandled Worker failure                           |

The allowlisted fields are `requestId`, `route`, `actionType`, `actorId`, `startRevision`, `endRevision`, `responseStatus`, `errorCode`, `durationMs`, `attempt`, and `outcome`. The logger drops all other fields. It never logs request bodies, state snapshots, ledger payloads, reasons, passcodes, credential hashes, cookies, session tokens, or client/IP data. A 64-character hexadecimal value is not accepted as a request ID in a log record, protecting token-shaped material.

Unexpected failures and D1-backed health failures use error severity. Application diagnostic records remain allowlisted before they reach `console.log`/`console.error`; enabling Workers Logs does not permit request bodies or snapshots to be added.

An authorized human may inspect hosted records in Cloudflare Dashboard → Workers & Pages → the intended Worker → Observability. Codex may inspect only sanitized local diagnostic artifacts and repository configuration/tests. Hosted dashboard queries, `wrangler tail`, production data, and credential-bearing environments require explicit human authorization and are outside autonomous verification.

To correlate a user report, use only safe fields supplied by the user or an authorized operator: request ID, action type, start/end revision, response status, error code, attempt, outcome, and duration. Never ask the user to paste a cookie, passcode, token, request body, snapshot, ledger, or raw credential file.

## Querying the local Cloudflare explorer

The disposable event rehearsal queries the local observability store and creates `diagnostics/branduel-event-rehearsal.json`:

```powershell
npm run test:event
Get-Content diagnostics/branduel-event-rehearsal.json | ConvertFrom-Json
```

For an interactive local Worker session, use a new temporary persistence directory and capture the console stream. Do not use `.wrangler/state`:

```powershell
$explorerState = Join-Path ([System.IO.Path]::GetTempPath()) ("branduel-explorer-" + [guid]::NewGuid())
$explorerLog = Join-Path $explorerState "worker-console.log"
npx.cmd wrangler dev --local --persist-to $explorerState --log-level info 2>&1 | Tee-Object -FilePath $explorerLog
```

In another terminal, summarize only recognized diagnostic records from that local log:

```powershell
npm run diagnostics:local -- --input $explorerLog --output diagnostics/local-summary.json
Get-Content diagnostics/local-summary.json | ConvertFrom-Json
```

When a local Vite/Cloudflare session is running, Codex can query the read-only Local Explorer observability endpoint directly. The command sends a fixed `SELECT` over the `logs` table and never accepts arbitrary SQL or reads hosted data:

```powershell
npm run diagnostics:local -- --explorer-url http://127.0.0.1:5173/cdn-cgi/local/explorer/api/local/observability/query --output diagnostics/explorer-summary.json
```

The plugin also exposes `/cdn-cgi/local/explorer/api` for the local OpenAPI description and `/cdn-cgi/local/explorer/api/d1/database` for local D1 metadata. The observability query returns `logs` columns including `ts_ms`, `level`, and `message`; the diagnostic script unwraps the console message envelope and re-applies the same allowlist before summarizing it.

The summary reports recent failed requests and action requests at or above the 1,000 ms slow-action threshold. It includes only sanitized records. `--window-minutes` and `--slow-action-ms` can narrow or adjust the local report.

## Rehearsal thresholds and CI

Critical event-smoke requests must complete within 2,000 ms locally; the D1-backed health probe must complete within 1,000 ms. Override only for a deliberately slower local machine with `BRANDUEL_ACTION_MAX_MS` or `BRANDUEL_HEALTH_MAX_MS`. The event rehearsal writes the sanitized artifact under `diagnostics/`, which CI uploads for inspection.
