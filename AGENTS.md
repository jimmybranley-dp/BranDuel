# BranDuel agent map

Read [docs/index.md](docs/index.md) first. The current product, architecture, reliability, security, testing, operations, and frontend contracts live in `docs/`; `MONDAY-REVIEW.md` is historical only.

## Non-negotiables

- Preserve the ordinary game-night loop and Jimmy's commissioner recovery controls.
- Every financial or result mutation is server-confirmed. Keep request IDs, revision checks, durable receipts, ledger audit, and atomic Worker/D1 writes.
- D1 is the hosted source of truth. Never add client-side writes, optimistic balances, or an offline wager queue. A disconnected client is read-only.
- Use additive migrations. Existing state may be real event data; never reset a database to make a test pass.
- Never access, print, copy, commit, or upload `.dev.vars`, `.private-player-*.json`, passcodes, hashes, or session tokens.
- Never use production for tests, rehearsals, migrations, or deployment from this local harness. Do not claim a hosted change without endpoint verification.

## Code ownership

- `worker/index.ts`: authentication, roles, allowlisted actions, receipts, D1 transactions, audit, export, and API errors.
- `src/domain.ts`: deterministic command validation and state transitions. Pass an authenticated actor to `applyAction`.
- `src/transport.ts`: accepted/rejected/uncertain request lifecycle and receipt recovery.
- `src/store.tsx`: polling, last confirmed snapshot, pending-request lock, and read-only offline behavior.
- `src/settlement.ts`: purse allocation, payouts, refunds, reversals, and settlement records.
- `src/data.ts`, `src/types.ts`, `src/engine.ts`: canonical seed data, state types, odds, betting restrictions, records, and ratings.
- `src/App.tsx` and `src/styles.css`: screens and responsive presentation; do not bypass store/transport for writes.
- `migrations/`: additive D1 schema changes only. `wrangler.jsonc` defines Worker, D1, assets, secrets, and environments.

## Verification map

Use Node 24.19.0 (or compatible Node 24). Work focused-first: after reading the required contracts, use `rg` and targeted file excerpts, then run only tests related to the changed files or behavior. Use `npm run check` and `npm run build` when the affected layer requires TypeScript/build checks; do not use aggregate commands as the debugging loop when a narrower command reproduces the failure. `npm run verify` is the normal pre-handoff aggregate check. Reserve `npm run verify:full` for release-oriented work, explicit requests, harness changes, or high-risk Worker/action changes that also need browser journeys. See [docs/TESTING.md](docs/TESTING.md).

When an aggregate command fails, diagnose its first failing stage and rerun that stage directly with `npm run verify:stage -- <stage>`; use `npm run verify:from -- <stage>` only when a suffix of the gate is needed. Do not repeatedly dump or reread complete source files after the relevant contracts are known. Never weaken financial, authentication, persistence, production-target, secret-safety, isolated-state, receipt, revision, audit, or complete CI/release-quality coverage to shorten elapsed time.

For local operation and hosted-target safeguards, use the commands in [docs/OPERATIONS.md](docs/OPERATIONS.md). Production wrappers are plan-only locally and production execution requires an external human-protected mechanism that is not part of this repository.

## Change discipline

Inspect `git status` first and preserve existing owner changes. Resolve disagreements with code/tests/evidence or record them in [docs/PRODUCT.md](docs/PRODUCT.md) and `docs/decisions/`; do not silently choose a product rule. For domain, Worker, transport, settlement, or UI changes, run the focused checks required by [docs/TESTING.md](docs/TESTING.md). Update docs when architecture, permissions, data handling, deployment, or verification behavior changes.
