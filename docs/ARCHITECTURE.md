# Architecture

## System overview

The Cloudflare Worker serves the API and the built client. D1 stores the shared state snapshot plus request, session, and ledger/audit data. React renders the confirmed snapshot and sends allowlisted commands through the transport layer. Vite selects the Cloudflare environment at build time.

The current state model is a JSON snapshot in `app_state` with a monotonically increasing revision. Financial entries are also copied to relational audit tables so exports and reconciliation have an audit trail.

## Module ownership

| Module                                      | Owns                                                                                                     | Must not own                                              |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `worker/index.ts`                           | Authentication, session/role checks, routes, request receipts, D1 CAS/batches, audit, export, API errors | UI decisions or a second business-rule implementation     |
| `worker/observability.ts`                   | Worker-owned diagnostic schema, redaction, and structured console records                                | Request bodies, state, credentials, or business decisions |
| `src/domain.ts`                             | Pure-ish command parsing, permissions, lifecycle transitions, ticket and result rules                    | Trusting client identity or bypassing settlement          |
| `src/settlement.ts`                         | Deterministic payout previews, rankings, purse allocation                                                | Persistence or authorization                              |
| `src/engine.ts`                             | Heat odds, betting restrictions, factual records, display formatting                                     | Accepting external writes                                 |
| `src/transport.ts`                          | POST interpretation and uncertain-request resolution                                                     | Applying actions locally                                  |
| `src/store.tsx`                             | Polling, last confirmed state, pending-request lock, login/logout state                                  | Inventing accepted state or direct mutation endpoints     |
| `src/App.tsx`                               | Authenticated composition, view routing, and toast framing                                               | Feature presentation or financial state changes           |
| `src/frontend/auth.tsx`                     | Login and request-recovery status presentation                                                           | Session/network implementation                            |
| `src/frontend/shell.tsx`                    | Application shell, navigation, sync status, and write guard                                              | Authorization or mutation decisions                       |
| `src/frontend/live-betting.tsx`             | Live markets, tickets, exposure, and betting-window presentation                                         | Applying bets locally                                     |
| `src/frontend/match-setup.tsx`              | Game-night start, matchup builder, active-round controls, and prep mode                                  | Domain validation or result settlement                    |
| `src/frontend/results.tsx`                  | Result review, settlement preview/recap, and frozen night summary                                        | Payout calculation or persistence                         |
| `src/frontend/commissioner.tsx`             | Commissioner recovery and settings controls                                                              | Commissioner authorization                                |
| `src/frontend/bank.tsx`                     | Team bank, ledger activity, and wager history presentation                                               | Balance mutation                                          |
| `src/frontend/ratings.tsx`                  | Current-night Heat and factual record presentation                                                       | Heat or rating calculation                                |
| `src/frontend/shared.tsx`, `src/styles.css` | Shared presentation primitives and responsive styling                                                    | Financial state changes outside `store.dispatch`          |
| `src/data.ts`, `src/types.ts`               | Seed data, duration-calibrated purse helper, timing calibration helpers, and shared types                | Runtime authorization                                     |
| `migrations/*.sql`                          | Additive schema evolution                                                                                | Destructive reset or application behavior                 |

## Dependency directions

The intended direction is:

`App.tsx` → `src/frontend/*` → `store.tsx` → `transport.ts` → Worker `/api/actions` → `domain.ts` → `settlement.ts` / `engine.ts`

`worker/index.ts` also reads `data.ts`/`types.ts` and writes D1. `domain.ts` may use the pure rule modules, but the client must not call a reducer to claim a server write. Tests may use `applyAction` directly as a local domain adapter.

## State and request flow

1. Login creates a server session; `/api/state` returns the snapshot, revision, server time, and server-derived player ID.
2. The store polls every two seconds and on focus. It replaces local state only with a snapshot at least as new as the last revision.
3. A mutation is saved to session storage with a request ID before POST. The UI becomes pending and blocks further writes.
4. The Worker authenticates the cookie, checks `expectedPlayerId`, hashes the canonical action payload, parses/validates the action, applies it against the current snapshot, and commits the snapshot, ledger rows, audit context, receipt, and write guard in one D1 batch with a revision check.
5. The client shows success only for a confirmed accepted response. A rejected response clears the pending request and refreshes; an uncertain response keeps the request and blocks mutation until receipt resolution.
6. Polling converges separate sessions on the latest confirmed snapshot.

## Boundaries that must not be bypassed

- Do not accept `actorId` or internal hydration actions from the request body; use the session actor and the action allowlist.
- Do not write balances, bets, results, or receipts from React, local storage, or an offline queue.
- Do not remove revision checks, request receipts, `write_guards`, ledger context, or the atomic D1 batch to simplify a path.
- Do not make deadlines client-authoritative; the Worker/domain check server time.
- Do not mutate archived nights or use reset as a migration strategy.
- Do not add a remote operation path that bypasses the named target wrapper and its production plan-only boundary.

## Mechanical guardrails

`npm run check:architecture` recursively discovers every `.ts` and `.tsx` module under `src/` and `worker/`. Exact path rules assign the data, rule, transport, store, UI, Worker/API, observability, and operation-safety roles; every `src/frontend/**` module is treated as React UI and every other governed module must have an explicit rule. Unknown modules fail with a remediation hint. Test modules (`*.test.ts`/`*.test.tsx`) and `src/vite-env.d.ts` are narrow, documented exceptions because they are not production modules.

The checker rejects React/browser dependencies in pure rules, requires Worker actions to pass through `parseAction(data.action)`, rejects UI network/storage/domain mutation shortcuts, and checks dependency direction for every assigned role. A new frontend file is therefore checked automatically without maintaining a second filename list. Add an exception only when the ownership table and a decision record explain why.

The architecture test suite includes a controlled invalid UI fixture that must fail the checker. The fixture is test-only and is excluded from the production lint scope. Production modules receive advisory guidance at 900 lines and approximately 160 branch tokens; these thresholds reflect the current compact codebase and are prompts for future cohesive extraction, not rewrite requirements.

`vite.config.ts` is the only Vite configuration source. The tracked `vite.config.js` and `vite.config.d.ts` files were stale TypeScript output, so they were removed and are ignored to prevent regeneration from re-entering the repository. `tsconfig.node.json` uses `noEmit`, and `npm run check` verifies the source configuration without generating compiled config files.

The config pins Vite’s project root to the repository, resolves the Wrangler config from that root, and gives isolated runners an explicit state path. Vitest keeps the Cloudflare plugin enabled but disables persistent local state; the Vite/Vitest wrappers use OS-temporary Wrangler config, state, and log locations. Build and unit-test wrappers disable local dotenv loading, while event/browser wrappers use only their in-memory ephemeral credentials through the temporary config. This bounds repository discovery without changing the Worker environment being tested.
