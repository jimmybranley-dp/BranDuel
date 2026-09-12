# BranDuel

BranDuel runs the Degenerate Derby's fixed teams, fictional-dollar economy, betting, results, and game-night closeout. The September 5 reliability build replaces the test identity picker and optimistic local writes with authenticated, server-confirmed actions.

On this Windows machine, start it from the project folder:

```powershell
.\Start-BranDuel.ps1
```

Open http://127.0.0.1:5173. The helper uses Node 24.19.0 or a compatible Node 24 release, including the bundled Codex runtime when the system Node is older. It applies local migrations before starting Vite. Keep its terminal running. An alternate port can be selected with `-Port 5175`.

The eight player passcodes are in `.private-player-passcodes.json`. Give each player only their own value. The app asks for a name and passcode; Jimmy's session receives commissioner controls. Passcodes and session tokens are never part of the browser bundle. Tabs in one browser share its cookie; use separate browser profiles/devices for different players. The server rejects a request when a tab's expected player differs from its authenticated session.

For a new checkout, use the Node version pinned in `.nvmrc` and `.node-version`, then:

```sh
npm ci
npm run setup:passcodes
npm run db:migrate:local
npm run dev
```

Credential setup generates `.dev.vars` containing salted PBKDF2 hashes, `.private-player-hashes.json` for later secret provisioning, and `.private-player-passcodes.json` for the commissioner. These files are ignored by Git. The script refuses to overwrite existing credentials. Changing a player's configured hash invalidates that player's existing sessions. Do not distribute the hash file or raw build directory as party handouts; the Vite plugin includes a local `.dev.vars` copy in the Worker preview output.

The current event rules are:

- Four fixed teams, each with a shared $10,000,000 opening bankroll. New databases start with opening-grant ledger entries and no demo events.
- Default house purses: Smash $1,500,000, Boomerang Fu $1,250,000, Worms $1,750,000, Mario Party $3,000,000, Mario Kart $1,500,000, NFL Blitz $1,750,000, Billiards $1,250,000. Each event stores its explicit house purse; participant count does not change it. Losing a match does not debit the losing team's bank. Mario Party has no betting.
- One open team ticket per market, with self-bet and teammate restrictions. Editing retains the replaced ticket in history and records its refund before the new stake.
- Scheduled matchups are drafts. Jimmy opens one market at a time; opening freezes its odds, purse, and stake limits. Reopening sets a finite deadline and cannot happen after play begins.
- Any signed-in player may report an in-progress result. Team winners must be selected explicitly; FFA results require every distinct participant exactly once.

Run the night from Home. Jimmy starts the session, opens a matchup, and starts play. A participant reviews and submits the result. Success appears only after the house accepts it. Phones poll shared state every two seconds, and the server controls deadlines.

Commissioner recovery includes pausing new wagers, opening drafts, voiding unfinished or completed rounds, and correcting a completed result with a reason. Corrections reverse linked game and wager payouts, apply the corrected result, and recompute records/ratings from result history. Previously accepted odds on later rounds remain unchanged. A correction can put a team into debt if it has already spent the reversed winnings; further wagers still require sufficient available funds.

When a response is missing, the browser saves its original request receipt in session storage and blocks further changes and sign-out. Use **Resolve saved request** to retrieve its saved result, or retry the same ID if the server has no receipt. Refreshing the page retains it; if the session expires, sign in as the original player. A disconnected open page shows its last confirmed state read-only. There is no offline wagering or background queue of new bets. Closing the tab/browser may discard session storage, so resolve uncertain requests before doing so.

Before closeout, finish or void every draft, round, and open ticket. **Review closeout** freezes the final banks, rules, results, tickets, and ledger. Export the final archive from the summary. Review/correct mistakes before closing; closed event records are immutable in the normal UI. A commissioner can also fetch `/api/export` while authenticated for a consistent state-plus-database-audit export. The current UI is designed around a single event; starting another night through the domain API archives the previous snapshot and carries its balances, rather than resetting the league.

Existing local data is preserved by the additive migration. It does not invent purse snapshots or payout links for legacy matches. An unfinished legacy round can be voided and recreated. A completed legacy result without complete linked settlement entries cannot be automatically corrected. The pre-upgrade local database backup is in `.wrangler/baseline-before-step12`. Use a new database for a clean rehearsal or the real event; do not reset the old league to achieve that.

Verification commands:

```sh
npm test
npm run check
npm run build
```

Browser smoke testing runs against a fresh isolated local D1 database and Chromium:

```powershell
npm run test:browser
```

To point the same suite at a deployed staging URL, set `BRANDUEL_BASE_URL`; the suite will not start a local server in that mode. Use a staging account and database because the test starts a game night.

Economy simulation uses the production domain action path and checks the ledger, tickets, frozen purses, wagering payouts, corrections, voids, closeout guard, and final snapshot after every accepted action. It prints an economy-balance report with bankroll distributions, debt rate, wager outcomes by profile, correction and void counts, and the five largest bankroll gaps.

```powershell
# Fast deterministic run (25 nights x 8 rounds)
npm run sim:economy:fast

# Longer run (500 nights x 12 rounds)
npm run sim:economy:stress

# Replay one printed failure or extreme-night seed
$env:ECONOMY_SEED = 481516
$env:ECONOMY_NIGHTS = 1
npm run sim:economy:replay
```

For the real Worker/D1 rehearsal, use a fresh loopback database. The smoke script requires `BRANDUEL_STATE_PATH` in both terminals and rejects the ordinary development state path. It uses separate authenticated player sessions, duplicate IDs, retry recovery, concurrent ticket edits, settlement, correction, void, reconciliation, export, and closeout.

The 57 automated tests cover domain rules, Worker authentication and SQLite transaction behavior, client transport recovery, the economy simulator, and its settlement regression checks. Worker tests inject failures between state/audit/receipt operations, simulate a lost commit response, and race revisions and duplicate IDs. The full build type-checks both browser and Worker source. `review/probes.mjs` now runs regression coverage instead of asserting that the original defects still exist.

To repeat the real local Worker/D1 smoke test, pick a new unused state directory. With Node 24 selected, run these commands in one terminal:

```powershell
$env:BRANDUEL_STATE_PATH = '.wrangler/rehearsal-new'
npm run db:migrate:local -- --persist-to $env:BRANDUEL_STATE_PATH
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

In a second terminal in the project folder:

```sh
$env:BRANDUEL_STATE_PATH = '.wrangler/rehearsal-new'
npm run test:event
```

The script signs into separate sessions, races team edits, retries accepted requests, settles/corrects/voids rounds, reconciles every bank, and closes the event. It requires an empty loopback database and deliberately leaves its test history in that isolated directory. Choose another unused directory for the next run. Keep `BRANDUEL_STATE_PATH` unset for ordinary development. The Windows startup helper always clears that override and uses the standard local database.

Cloudflare deployment is the next phase. `wrangler.jsonc` still contains a placeholder database ID. Before deployment, configure separate staging and production databases, provision `PLAYER_PASSCODES` as a Worker secret in the selected environment, apply migrations there, and build for that environment. No remote deployment was performed in this work. Multi-device rehearsal at the venue remains necessary before event use.
