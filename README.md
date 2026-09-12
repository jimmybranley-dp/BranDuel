# BranDuel

BranDuel is the Degenerate Derby game-night app. It runs four fixed teams through a fictional-dollar economy, game results, optional betting markets, corrections, and final closeout.

The live application runs on Cloudflare Workers with Cloudflare D1. Source code is maintained in [GitHub](https://github.com/jimmybranley-dp/BranDuel).

## Hosted environments

| Environment | URL | Purpose |
| --- | --- | --- |
| Staging | https://branduel-staging.jimmybranley.workers.dev | Rehearsals and device testing |
| Production | https://branduel-production.jimmybranley.workers.dev | The real Derby |

Cloudflare hosts the Worker, static client, and D1 state. The PC does not need to stay on for either hosted environment. The local checkout is needed for code changes, local testing, migrations, and deployments. Staging and production have separate databases and `PLAYER_PASSCODES` secrets. Never use production for tests that create or close a game night.

## Local development

The project requires Node 24.19.0 or another compatible Node 24 release. The version is pinned in `.nvmrc` and `.node-version`.

On Windows, from the project folder:

```powershell
.\Start-BranDuel.ps1
```

Open `http://127.0.0.1:5173`. Keep the helper terminal running. Use `-Port 5175` when needed.

For a new checkout:

```powershell
npm ci
npm run setup:passcodes
npm run db:migrate:local
npm run dev
```

The local credential files are ignored by Git:

- `.dev.vars` contains salted PBKDF2 hashes for the local Worker.
- `.private-player-hashes.json` is used when provisioning a Cloudflare secret.
- `.private-player-passcodes.json` contains local player mappings.

Never commit, upload, print, or paste those files. The Vite Worker preview can include local `.dev.vars` values, so do not distribute a raw build directory as a handout.

## Game-night rules

Each new database starts with four teams at $10,000,000 and opening-grant ledger entries. A clean database starts without demo events.

| Game | House purse |
| --- | ---: |
| Smash | $1,500,000 |
| Boomerang Fu | $1,250,000 |
| Worms | $1,750,000 |
| Mario Party | $3,000,000 |
| Mario Kart | $1,500,000 |
| NFL Blitz | $1,750,000 |
| Billiards | $1,250,000 |

Each event stores its purse explicitly. Participant count does not change it. Losing a match does not debit the losing team. Mario Party has results but no betting market.

Players sign in with a name and passcode. Jimmy's account has commissioner powers. Ordinary signed-in players can start the night, schedule or create matchups, start play, report results, and run rematches. Commissioner-only actions include corrections, voids and refunds, betting pauses, economy and bank changes, reset, and final closeout.

Betting enforces one open team ticket per market, self-bet and teammate restrictions, editable tickets with refund history, balance checks, and deadlines. Opening a market freezes its odds, purse, and stake limits. Reopening requires a finite deadline and is disallowed after play begins.

Team results require an explicit winner. Free-for-all results require every distinct participant exactly once. Results are reviewed before settlement. Phones poll shared state every two seconds, and the server controls deadlines.

## Reliability and recovery

The Worker is authoritative for every financial and result mutation. The client does not announce success until the Worker confirms the action.

The action path provides authenticated sessions, role checks, allowlisted and validated actions, revision checks, atomic state/audit/receipt writes, duplicate-request recovery, server-side time and deadline enforcement, ledger reconciliation, correction and void paths, frozen closeout, and archive export.

If a response is lost, the browser saves the original request receipt in session storage, blocks additional changes and sign-out, and shows `Resolve saved request`. Resolve it or retry the same request ID before closing the tab. If the session expires, sign in again as the original player. A disconnected page shows the last confirmed state as read-only. There is no offline wagering or background queue of new bets.

Before closeout, finish or void every draft, round, and open ticket. Review and correct errors first. Closeout freezes the final banks, rules, results, tickets, and ledger. Export the final archive from the summary. The authenticated commissioner endpoint `/api/export` provides a consistent state and database-audit export.

The app is designed around one active event. Starting another event through the domain API archives the previous snapshot and carries balances forward instead of resetting the league.

## Verification

Run the focused checks with Node 24:

```powershell
npm run check
npm run build
npx vitest run --config vite.config.ts --exclude browser-tests/**
```

The current `npm test` script also discovers `browser-tests/smoke.spec.ts`, which is a Playwright suite. Use the explicit Vitest command for unit and Worker coverage, and use Playwright for browser coverage:

```powershell
npm run test:browser
```

Browser smoke testing creates a fresh isolated local D1 database and requires Chromium. To test staging, set `BRANDUEL_BASE_URL`; the suite will not start a local server in that mode. Use staging credentials because the test starts a game night.

The real Worker/D1 rehearsal uses a new loopback state directory. In one terminal:

```powershell
$env:BRANDUEL_STATE_PATH = '.wrangler/rehearsal-new'
npm run db:migrate:local -- --persist-to $env:BRANDUEL_STATE_PATH
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

In a second terminal:

```powershell
$env:BRANDUEL_STATE_PATH = '.wrangler/rehearsal-new'
npm run test:event
```

The event smoke test uses separate authenticated sessions and exercises duplicate request IDs, retry recovery, concurrent ticket edits, settlement, correction, void, reconciliation, export, and closeout. It requires an empty isolated database and leaves its history there. Choose a new directory for each run. Keep `BRANDUEL_STATE_PATH` unset for ordinary development.

The economy simulation checks reproducible nights:

```powershell
npm run sim:economy:fast
npm run sim:economy:stress
$env:ECONOMY_SEED = 481516
$env:ECONOMY_NIGHTS = 1
npm run sim:economy:replay
```

## Cloudflare deployment

Environment selection happens during the Vite build. Set `CLOUDFLARE_ENV` before building and deploying. A later deploy flag cannot change bindings selected by an earlier build.

Staging:

```powershell
$env:CLOUDFLARE_ENV = 'staging'
npx.cmd wrangler d1 migrations apply branduel-staging --remote --env staging --config wrangler.jsonc
npm run build
npx.cmd wrangler deploy --env staging --config wrangler.jsonc
```

Production:

```powershell
$env:CLOUDFLARE_ENV = 'production'
npx.cmd wrangler d1 migrations apply branduel-production --remote --env production --config wrangler.jsonc
npm run build
npx.cmd wrangler deploy --env production --config wrangler.jsonc
```

Provision or rotate the secret interactively. Never put a plaintext passcode file in a shell transcript:

```powershell
npx.cmd wrangler secret put PLAYER_PASSCODES --env staging --config wrangler.jsonc
npx.cmd wrangler secret put PLAYER_PASSCODES --env production --config wrangler.jsonc
```

After deployment, check the hosted root and authenticated `/api/health`. Verify login, clean revision 1 state, zero events, and four $10,000,000 balances before inviting players. Rehearse on actual phones before the real night. On Windows, use `npx.cmd wrangler`.

## Credentials

The current test setup uses lowercase player names as memorable passcodes. This is for staging tests only. Rotate to strong, unique passcodes before the real event. Rotation invalidates existing sessions, so players must refresh or reopen the app and sign in again.

Give each player only their own passcode. Use separate browser profiles or devices for different players because tabs in one browser share its session cookie.

## GitHub workflow

The canonical repository is `https://github.com/jimmybranley-dp/BranDuel`. Keep the working tree clean, make a focused commit, run relevant checks, and push to `main` when code is ready for the shared repository.

Do not commit `.dev.vars`, `.private-player-*.json`, `.wrangler/`, build output, test results, or browser reports. GitHub contains source, tests, migrations, configuration, and documentation. Cloudflare contains hosted code, secrets, and D1 state.

## Project history

The original prototype kept game state in the client and used a test identity picker. The reliability work moved the action boundary into the Worker and added authenticated sessions, role enforcement, atomic writes, request receipts, ledger auditing, result review, corrections, voids, reconciliation, and closeout export.

The hosted rollout added separate staging and production D1 databases, Worker secrets, environment-specific builds, and hosted verification. The live-night flow was then distributed so ordinary players can start and operate normal rounds while Jimmy retains recovery, economy, and closeout controls.

Existing local data is preserved by the additive migration. It does not invent missing purse snapshots or payout links for legacy matches. An unfinished legacy round can be voided and recreated. A completed legacy result without complete linked settlement entries cannot be corrected automatically. Use a new database for a clean rehearsal or the real event. Do not reset the old league to obtain one.

## Important files

| Path | Role |
| --- | --- |
| `worker/index.ts` | Worker routes, authentication, actions, receipts, audit, and export |
| `src/domain.ts` | Rules, permissions, validation, and state transitions |
| `src/transport.ts` | Request lifecycle and uncertain-request recovery |
| `src/store.tsx` | Client state and polling |
| `src/App.tsx` | Game-night screens and controls |
| `src/settlement.ts` | Settlement, payouts, corrections, and refunds |
| `migrations/` | Local and remote D1 schema migrations |
| `wrangler.jsonc` | Worker, asset, D1, secret, and environment configuration |
| `Start-BranDuel.ps1` | Windows local startup helper |
| `MONDAY-REVIEW.md` | Earlier event-readiness review and remaining risks |
| `AGENTS.md` | Instructions for future coding agents |
