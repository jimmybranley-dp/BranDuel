# AGENTS.md

## Project purpose

BranDuel is the Degenerate Derby game-night application. It serves four fixed teams, a fictional-dollar economy, optional wagers, game results, corrections, and final closeout.

The hosted system uses a Cloudflare Worker for the API and static client, Cloudflare D1 for shared state and audit data, React and Vite for the client, TypeScript throughout, Vitest for code tests, and Playwright for browser smoke tests.

The canonical repository is `https://github.com/jimmybranley-dp/BranDuel`.

## Working rules

Keep reliability ahead of cosmetic work. Preserve the ordinary-player game-night loop and commissioner recovery controls. Keep the next action clear in the UI and keep confirmed state visible during network trouble.

Every financial or result mutation must be server-confirmed before the client shows success. Preserve request IDs, revision checks, receipts, ledger audit, and atomic Worker transactions when changing the action path.

Treat D1 as the source of truth for hosted state. Do not add a client-side write path, optimistic balance update, or offline wager queue. A disconnected page may show its last confirmed state as read-only.

Use additive migrations. Existing local or hosted data can be real event data. Never reset a database to make a test pass without explicit instruction and a verified target.

Keep secrets out of source control and documentation. `.dev.vars` and `.private-player-*.json` contain credentials or hashes. Never print their contents, commit them, upload them, or copy them into memory.

## Permissions and game rules

Ordinary signed-in players may start the night, schedule or create matchups, start play, report results, and run rematches. Jimmy's commissioner role is required for corrections, voids and refunds, betting pauses, economy and bank changes, reset, and final closeout.

Each new database starts with four teams at $10,000,000. House purses are explicit per event. Participant count does not alter the purse, and a losing match does not debit the losing team. Mario Party has no betting market.

There is one open team ticket per market. Enforce self-bet and teammate restrictions. Editing a ticket must preserve the replaced ticket in history and record its refund before the new stake. Opening a market freezes odds, purse, and stake limits. Reopening uses a finite deadline and cannot happen after play begins.

Team results require an explicit winner. Free-for-all results require each distinct participant exactly once. Review happens before settlement. Closeout requires every draft, round, and open ticket to be finished or voided, then freezes the archive.

## Architecture notes

`worker/index.ts` owns authentication, role checks, allowlisted actions, request receipts, D1 transactions, ledger audit, reconciliation, export, and API errors.

`src/domain.ts` owns pure rules and state transitions. Keep domain functions deterministic and test them directly before testing through the Worker.

`src/transport.ts` handles accepted, rejected, and uncertain requests. When a response is lost, the original request must remain recoverable through session storage. The client must block additional mutations and sign-out until it is resolved.

`src/store.tsx` polls shared state every two seconds and tracks the last confirmed snapshot. It must not invent state after a failed or uncertain action.

`src/settlement.ts` links results, wagers, payouts, refunds, corrections, and reversals. Corrections reverse linked payouts before applying the replacement result and recomputing records and ratings from result history.

`migrations/0001_shared_state.sql` creates the original shared schema. `migrations/0002_authoritative_actions.sql` adds the action, audit, receipt, session, and integrity structures used by the reliability build.

## Local commands

Use Node 24.19.0 or another compatible Node 24 release.

```powershell
npm ci
npm run check
npm run build
npx vitest run --config vite.config.ts --exclude browser-tests/**
npm run test:browser
npm run test:event
```

Start Windows development with:

```powershell
.\Start-BranDuel.ps1
```

The event smoke test needs a new state directory and a separate local server:

```powershell
$env:BRANDUEL_STATE_PATH = '.wrangler/rehearsal-new'
npm run db:migrate:local -- --persist-to $env:BRANDUEL_STATE_PATH
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

In another terminal, set the same variable and run `npm run test:event`. Keep it unset for ordinary development. Never point an isolated rehearsal at `.wrangler/state`.

The `npm test` script currently discovers the Playwright file as well as Vitest files. Use the explicit Vitest command above for unit and Worker coverage, and `npm run test:browser` for Playwright.

## Cloudflare operations

Hosted URLs:

- staging: `https://branduel-staging.jimmybranley.workers.dev`;
- production: `https://branduel-production.jimmybranley.workers.dev`.

Cloudflare environment selection occurs during the Vite build. Set `CLOUDFLARE_ENV` before `npm run build`; a later deploy flag cannot change bindings embedded during the build.

The staging and production D1 databases are separate and both require the `PLAYER_PASSCODES` Worker secret. Use `npx.cmd wrangler` on Windows.

Before deploying a migration, confirm the target in `wrangler.jsonc`, apply the migration remotely, build with the matching environment, deploy that Worker, check the hosted root and authenticated health endpoint, and run the staging rehearsal on real devices before touching production.

Never run a test that creates, closes, or resets a night against production. Before the real event, replace memorable test passcodes with strong unique values. Rotation invalidates sessions.

## Verification expectations

For domain, Worker, transport, or settlement changes, run focused tests plus `npm run check` and `npm run build`. For action-path changes, run the isolated event smoke test. For UI changes, run browser smoke tests at phone-sized viewports and check ordinary-player and commissioner flows.

For hosted changes, verify authentication, anonymous rejection, clean revision and balances in a fresh environment, shared state across separate sessions, retry behavior, settlement, correction or void, export, and closeout as applicable.

Record failures with the exact command, environment, database target, selected player, and error text. A stale session after credential rotation often needs a hard refresh or a closed and reopened phone tab.

## Safety boundaries

Do not expose passcodes, hashes, session tokens, `.dev.vars`, or raw credential JSON. Do not modify production D1 data for a test. Do not reset a database without confirming the exact target. Do not report a deployment as successful without checking its hosted endpoint. Do not report tests as passing when the wrong runner discovered or skipped them. Do not remove request receipts, revision checks, or audit writes to simplify a client flow.

When a request is uncertain, preserve its request ID and resolve it before allowing another mutation. When a result is corrected, preserve the reason and audit trail.

## Documentation map

- `README.md` is the operator guide, local setup, game rules, hosted environments, deployment, and GitHub workflow.
- `MONDAY-REVIEW.md` contains the earlier event-readiness review and remaining-risk notes.
- `wrangler.jsonc` defines Worker names, D1 bindings, secrets, and environments.
- `worker/index.ts`, `src/domain.ts`, `src/transport.ts`, `src/store.tsx`, and `src/settlement.ts` define main behavior.

Update this file when architecture, permissions, data handling, deployment, or verification behavior changes.
