# Testing

## Test layers

- **Domain/unit:** Vitest tests for validation, permissions, lifecycle, betting, settlement, correction, reconciliation, records, and ratings (`src/**/*.test.*`).
- **Worker integration:** Vitest-compatible Worker tests exercise sessions, origin checks, D1 batches, revisions, receipts, export, and API errors (`worker/**/*.test.*`).
- **Economy simulation:** reproducible and stress simulations exercise nights and money conservation.
- **Browser smoke:** Playwright covers the user flow in a fresh local Worker/D1 environment with ephemeral credentials.
- **Event rehearsal:** `test:event` starts a fresh loopback Worker/D1 server with one-time in-memory credentials and exercises multi-session action recovery and closeout. It does not read private credential files.

Vitest is configured in `vite.config.ts` and excludes `browser-tests/**`; Playwright is configured separately in `playwright.config.ts`. The harness never trades away authoritative Worker writes, request/revision/receipt coverage, isolated D1 state, ephemeral credentials, production-target safeguards, or secret/artifact redaction for speed.

### Browser coverage matrix

The browser harness runs each selected suite/project against a new temporary D1 state directory and, for local runs, a new in-memory credential set. `npm run test:browser` fails fast after the first failing suite/project by default. CI and deliberate exhaustive runs must opt into `--full-matrix`, which preserves the complete matrix while continuing after failures. The critical suite uses separate Jimmy, Jason, and Ezra browser contexts so confirmed state must converge through the Worker.

| Journey                                | Jimmy / commissioner | Ordinary player                | Desktop | Phone | Browser assertion                                                 |
| -------------------------------------- | -------------------- | ------------------------------ | ------- | ----- | ----------------------------------------------------------------- |
| Login and open Game Night              | ✓                    | blocked before opening         | ✓       | ✓     | Session and commissioner-only opening                             |
| Matchup, ticket, and edit              | ✓ observes           | ✓ creates, places, edits       | ✓       | ✓     | Accessible controls and confirmed ticket                          |
| Self-bet and teammate rules            | ✓ observes           | ✓ Jason self-bet; Ezra blocked | ✓       | ✓     | Disabled selections and restriction copy                          |
| Start, review, and settle team result  | ✓ observes           | ✓ operates                     | ✓       | ✓     | Preview before confirmation and recap                             |
| Correct, void, and refund              | ✓                    | —                              | ✓       | ✓     | Reasoned correction and reversal confirmation                     |
| Closeout refusal and success/export    | ✓                    | —                              | ✓       | ✓     | Unresolved work rejected; frozen archive downloads                |
| Offline and uncertain recovery         | ✓ observes           | ✓                              | ✓       | ✓     | Read-only state, saved request lock, receipt recovery             |
| Cross-context convergence              | ✓                    | ✓                              | ✓       | ✓     | Same confirmed state in Jimmy/Jason/Ezra contexts                 |
| Concurrent markets and four-market cap | ✓                    | ✓                              | ✓       | ✓     | Two markets open together; isolated actions; cap enforced         |
| Expired-market reopen recovery         | ✓                    | ✓                              | ✓       | ✓     | Expiry, rejection, finite reopen, frozen rules, post-start denial |

Playwright retains the HTML report for every run and trace, screenshot, and video artifacts on failures. The runner mechanically uses separate `state-desktop` and `state-phone` directories under an OS temporary root and removes them after completion; it never uses `.wrangler/state`. The concurrent-market and recovery suites also capture a small set of deterministic screenshots for visual evidence without committing pixel baselines.

## Canonical commands

```powershell
npm ci
npm run verify
npm run verify:full
npm run verify:stage -- browser
npm run verify:from -- event
npm run docs:check
npm run execution-plans:check
npm test
npm run lint
npm run format:check
npm run test:architecture
npm run check
npm run build
npm run test:browser
npm run test:browser -- --suite critical --project chromium
npm run test:browser -- --suite recovery --project chromium-phone
npm run test:browser -- --full-matrix
npm run check:artifacts
npm run types:check
npm run test:observability
npm run test:artifacts
```

`npm run verify` runs lint, deterministic formatting, documentation and execution-plan checks, generated Wrangler binding freshness, architecture and observability tests, TypeScript, Vitest, the production bundle, and artifact/secret safety in that order. `verify:full` adds the isolated event rehearsal and desktop/phone Playwright journeys. `npm test` is the code/Worker Vitest layer only. Formatting intentionally covers the guardrail/configuration/documentation surface in this incremental adoption; broad legacy source reformatting is tracked out of scope for this task.

### Focused-first and resumable verification

During implementation, start with the narrowest reproducer: a Vitest file or test name, a Worker test file, `npm run check`, `npm run build`, `npm run test:event`, or one browser suite/project. Use `rg` and targeted excerpts after reading the relevant contracts; do not repeatedly print whole source files. `npm run verify:stage -- <stage>` runs one aggregate stage, and `npm run verify:from -- <stage>` resumes from that stage through the end of the selected gate. Stage ids are available with `npm run verify -- --list`.

If an aggregate check fails, repair the first failing stage and rerun only that stage until it passes. Keep `npm run verify` as the normal pre-handoff gate. Use `npm run verify:full` only for release-oriented work, an explicit request, harness changes, or a high-risk Worker/action change that also spans browser journeys. For a high-risk cross-layer task, run focused checks, the isolated event rehearsal, and selected browser journeys first; then run one final full aggregate check. If that final check fails, validate its failing stage directly before one final aggregate rerun.

The browser selector accepts `smoke`, `critical`, `concurrent`, or `recovery` and the `chromium` or `chromium-phone` project. The examples above are single-suite, single-project runs. `--full-matrix` is the explicit keep-going option for CI or exhaustive local diagnosis. Browser runs remain sequential because each run has its own state, artifact namespace, port lifecycle, and local credentials; parallelism must not be introduced without preserving those isolation properties.

Do not broadly increase timeouts or remove meaningful tests to improve elapsed time. First fix stale fixtures or nondeterminism. Adjust a timeout only when evidence shows the test is valid and predictably slower under aggregate load.

`npm run test:event` also captures recognized local Worker console records and writes the sanitized `diagnostics/branduel-event-rehearsal.json` artifact. See [OBSERVABILITY.md](OBSERVABILITY.md) for the local Cloudflare explorer workflow and redaction contract.

The Vitest and Vite wrappers create a temporary Wrangler config alongside their isolated OS-temporary state/log path. They disable dotenv loading, so repository `.dev.vars` and `.env` files are never consulted by build or unit-test verification. The event and browser runners use a temporary config directory with no credential files and enable process-environment loading only for the in-memory ephemeral credentials they create for that run. All wrappers print bounded startup diagnostics containing the Node runtime, working directory, config file, temporary state path, and sanitized error category. The event and browser runners additionally write bootstrap artifacts that distinguish migration failure, server exit before readiness, readiness timeout, browser launch failure, and test assertion failure. A zero-record event artifact includes `workerRequestsRan: false` and the failed bootstrap phase.

Simulation commands are `npm run sim:economy:fast`, `npm run sim:economy:stress`, and `npm run sim:economy:replay` (the replay accepts `ECONOMY_SEED`, `ECONOMY_NIGHTS`, and `ECONOMY_ROUNDS`).

## Required checks by change type

| Change                            | Minimum verification                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Domain or settlement              | Focused Vitest tests, `npm run check`, `npm run build`                                                          |
| Worker, transport, or action path | Focused Vitest/Worker tests, `npm run check`, `npm run build`, then an isolated event rehearsal                 |
| Frontend                          | `npm run check`, `npm run build`, browser smoke at phone-sized viewports; check ordinary-player and Jimmy flows |
| Migration or operation safety     | Worker/migration safety tests, `npm run check`, `npm run verify`; use a new local state for rehearsal           |
| Documentation only                | Link and command validation; run `npm run verify` if a command or configuration claim changed                   |

## Local-state isolation

Ordinary local development may use the default local D1 state. `npm run test:event` starts its own loopback Worker with a fresh temporary state, generates credentials in memory, and removes the state when the rehearsal ends. Never print or expose test credentials. Browser smoke creates temporary credentials/state automatically. An external browser rehearsal may target only the exact staging hostname by setting `BRANDUEL_BASE_URL` and `BRANDUEL_TEST_PASSCODE`; production is refused before login or mutation.

### Host-limited verification evidence

The economy v1 test layer covers the duration formula, fixed $200,000 fresh grants, dynamic replacement/concurrent caps, Golden Tee and Mortal Kombat normalization, custom-game override validation, authoritative timing medians, season rebases, and the v1 settlement examples. A supported Node 24.19+ runtime remains the release-quality confirmation target.
