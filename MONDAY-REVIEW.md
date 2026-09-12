BranDuel: Monday review and event-night plan

September 5 update: the first two implementation steps are complete. The original findings below are preserved as the pre-change review. See README.md for the current behavior and startup instructions. The old defect probe script now runs regression tests. The current suite has 49 passing tests, a passing client/Worker production build, and a successful isolated local Worker/D1 event rehearsal. Cloudflare staging/deployment and the room-wide rehearsal are still pending.

Prepared September 4, 2026, for the working session on Monday, September 7. The event date is not specified.

BranDuel has the right core experience for the Degenerate Derby. Four fictional sports franchises compete, earn large purses, back themselves, and watch their fortunes change together. The next build should make that experience dependable and easy to run while Jimmy is also playing. The current build needs repairs before event use.

I reviewed all 14 turns in the conversation "Define BranDuel requirements" (01a006af-4c50-79a1-a5a1-f5543d67fbbe), inspected the current source, reran the seven existing tests and production build, and reproduced five defects against an isolated in-memory database. Both existing checks passed. The reproductions use the actual Worker handler with a small SQLite adapter; they do not establish behavior under real Cloudflare concurrency. No deployment or fresh browser/device rehearsal was performed. Earlier chat claims about visual QA are historical evidence.

The implementation files were left unchanged. This review and [review/probes.mjs](<C:/Users/zorro/OneDrive/Documents/ChatGPT/Degenerate Derby/review/probes.mjs>) are the new handoff artifacts. The script documents current defects and deliberately asserts that they reproduce; it should be replaced with regression tests expecting rejection or correct behavior as repairs land.

The agreed product is already unusually specific:

- Eight players, paired as Jason/Ezra, Corey/Jimmy, Brandon/Andrew, and Bruce/Ryan. Teams share a bank.
- Fictional dollars, initially $10 million per team. The unlimited house funds game purses. Losing a game does not debit the losing team's bank.
- Smash, Boomerang Fu, and Worms have betting. Mario Party has no betting. Its earlier "wins/losses only" request needs reconciling with the later accepted $100,000 payout and the generic FFA placement system now implemented.
- Fixed pairs and two-to-four-player free-for-alls. FFA purses use the agreed placement splits.
- Game-specific records and ratings, with some overall skill contribution to odds.
- One editable team ticket per market, adopted later in the conversation. Self-bets can only back the player or their side; teammate restrictions still apply.
- Anyone may log a result under the agreed trust model. Jimmy has commissioner powers. Name selection was explicitly temporary; username/passcode was the intended eventual login.
- A live round proceeds through matchup, short betting window, manual start, result, automatic settlement, and rematch or next matchup.

That live loop should remain the center of the app. Scheduled events can support preparation, but creating calendar entries should not become the normal work between games.

The source confirms the following state today:

| Area | Current implementation | Event implication |
|---|---|---|
| Shared data | Worker API, D1 state snapshot, revision checks, two-second polling | Shared infrastructure exists; the old single-browser-only assessment is outdated. |
| Deployment | Placeholder D1 ID; no explicit staging/production environments | This checkout does not establish a working public deployment. Current account authentication was not checked. |
| Identity | Client-supplied player name; fresh state defaults to Jimmy | Every phone needs an explicit authenticated identity before the event. |
| Live rounds | Builder, timer, start, result, rematch, recap | A substantial playable loop is implemented. |
| Host experience | Live start/builder/rematch controls are also rendered to ordinary players | Server rejections and optimistic UI can make controls appear to work and then revert. |
| Economy | Purses, ticket edits, settlement, refunds, balance adjustments | The happy path works; durable audit and recovery need repair. |
| Results | Ordinary settlement and history | No completed-result correction action exists. |
| Finale | Final banks, rounds, biggest ticket, game counts | A basic recap exists; awards, rating changes, exports, and frozen final standings are missing. |
| Release history | All project files are untracked; no commits on the current branch | Establish a versioned baseline before Monday's edits and a recoverable release before the party. |

Monday's first work should address these findings in order. P0 means a release blocker; P1 means required for dependable operation of this event.

| Priority | Finding and evidence | Repair and acceptance condition |
|---|---|---|
| P0 | The API accepts any string action type. A non-Jimmy request using internal `HYDRATE_REMOTE` can replace shared state. Reproduced HTTP 200 and a persisted arbitrary balance. See [Worker validation](<C:/Users/zorro/OneDrive/Documents/ChatGPT/Degenerate Derby/worker/index.ts:65>) and [internal reducer action](<C:/Users/zorro/OneDrive/Documents/ChatGPT/Degenerate Derby/src/store.tsx:83>). | Allowlist external actions, validate every payload, and keep client hydration outside the server command reducer. Reject unknown/internal actions before any write. |
| P0 | Identity is asserted by the request's `actorId`; selecting or submitting Jimmy confers commissioner access. This was intentional during testing. | Add per-player passcodes checked on the server, a persistent session cookie, throttled login attempts, and server-derived roles. Keep trusted result reporting available if desired. |
| P0 | State, audit additions, and request completion commit separately. Injecting an audit failure made a $100k adjustment return 409; retrying the same request applied it again. Bank increased $200k, audit recorded $100k. See [write sequence](<C:/Users/zorro/OneDrive/Documents/ChatGPT/Degenerate Derby/worker/index.ts:126>). | Commit the state, ledger entries, and request result atomically. Preserve safe revision conflict handling across the whole commit. Bind request keys to actor and payload; reuse keys on uncertain retries. A retry must return the original result without another financial change. |
| P1 | [Client dispatch](<C:/Users/zorro/OneDrive/Documents/ChatGPT/Degenerate Derby/src/store.tsx:375>) applies actions locally before POSTing. Forms announce success immediately. Failed writes become "Local mode" and later hydration can erase their visible effects. | Show pending/accepted/rejected states. Only announce accepted wagers and settled rounds after confirmation. On connection loss, retain a visibly stale read-only view and pause writes. Resolve uncertain requests by their original IDs. |
| P1 | FFA validation checks length and membership without uniqueness. The API accepted Ezra in all four places and paid his team the whole $250k purse. See [result validation](<C:/Users/zorro/OneDrive/Documents/ChatGPT/Degenerate Derby/src/store.tsx:259>). | Require an exact permutation of the participants. Validate distinct teams, participant counts, game IDs, finite safe integer money, limits, and legal lifecycle transitions on the server. Reject invalid actions explicitly instead of returning success with unchanged state. |
| P1 | A reopened event stays open indefinitely because `bettingReopened` bypasses the deadline. Reproduced open betting two hours after "Reopen 1 hr". See [deadline logic](<C:/Users/zorro/OneDrive/Documents/ChatGPT/Degenerate Derby/src/engine.ts:34>). | Reopening must set a new finite deadline. Use server time to accept bets and synchronize the displayed countdown. Starting play must close all access to that round's market. |
| P1 | Completed results cannot be corrected. The winner is preselected in result forms. Cancellation is available in the reducer for in-progress rounds, but the normal live UI loses its cancel control once play starts. | Require an explicit result selection and concise review before settlement. Add commissioner correction with reason and compensating ledger entries, plus void/refund access throughout unfinished play. Corrections must fix records, ratings, wagers, and balances together. |
| P1 | One live round does not mean one open market. A fresh seed plus a live round produced four bettable markets. Ending a night only checks its active event and can leave scheduled bets unresolved. | Start production without demo events. During the event, keep future matchups as drafts with no wagering. Close only after every event-night ticket is settled or refunded. |
| P1 | Host controls are shown to all players; end-of-night state is not frozen and another session replaces the active night metadata. See [live view](<C:/Users/zorro/OneDrive/Documents/ChatGPT/Degenerate Derby/src/App.tsx:481>) and [summary](<C:/Users/zorro/OneDrive/Documents/ChatGPT/Degenerate Derby/src/App.tsx:516>). | Render controls by capability. Freeze and archive the final event summary, including starting/ending balances, results, and rules. Remove reset from the live event workflow. |

The current ledger is useful but is not a complete accounting source. Opening bankrolls are absent from its entries, and audit rows lack explicit event, bet, and actor references. Add those links and opening grants. Until then, reconciliation is starting bankroll plus net ledger entries, not ledger sum alone. Snapshot each round's purse and rules when betting opens so an economy edit cannot silently change an existing round's promised payout. Winning tickets already retain their accepted decimal odds.

Cloudflare Worker plus D1 remains my hosting recommendation for this eight-person event, assuming reliable internet at the venue. Keep React and the existing database approach while repairing the write boundary. A database redesign, WebSockets, or a move to another platform is unnecessary for the first night.

| Environment | What it is for | Data |
|---|---|---|
| Local | Development and quick checks | Disposable local D1 |
| Staging | Full rehearsal on actual phones and the display | Separate staging D1 |
| Production | The real Derby | Clean production D1 and frozen event configuration |

Cloudflare supports distinct D1 bindings for environments. This app uses the Vite plugin, so environment selection must happen at development/build time; setting it only when deploying does not change the already-built binding selection. Add explicit build/deploy commands and a visible staging badge. Verify the target Worker name and database before migrations. [D1 environments](https://developers.cloudflare.com/d1/configuration/environments/), [Vite environment selection](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/).

The room should have one QR code and short URL, one browser session on each player's phone, and a dedicated display connected to a laptop or small computer by HDMI. The display should use a read-only spectator page. Show the current matchup, betting status, four team banks, last result, and next participants in text readable across the room. It must not carry Jimmy's credentials. Test the room's Wi-Fi with phones and consoles connected; finish game updates and downloads before arrivals. Disable sleep on the display machine and keep the host device charged.

Plan for a tested phone hotspot as the first network fallback. The public URL means players can also use cellular data. If the house cannot be reached, pause betting, keep playing, and record match IDs, participants, and results on paper. Reconcile accepted tickets before logging delayed results. A screenshot alone cannot establish that a wager reached the server. Existing browser fallback is not a LAN server or a reliable offline mode. If the venue has no usable internet, choose a dedicated local host and centralized LAN database as a separate build decision before the rehearsal.

Before doors open, export production data and record the release version. Repeat the export after the finale. D1 provides SQL export and point-in-time recovery, but a restore must be rehearsed and coordinated: rewinding a database can also remove legitimate later actions. Use corrections for individual mistakes and restore for disaster recovery. Do not assume rolling back code also rolls back the database. [D1 export](https://developers.cloudflare.com/d1/best-practices/import-export-data/), [D1 recovery](https://developers.cloudflare.com/d1/reference/time-travel/).

Jimmy should own event setup, market control, disputes, and final closeout. Players should place team tickets and report results under the existing trust rule. One teammate can act as the team's usual ticket editor without removing the other's permission; show who changed the ticket and alert both when it changes. If Jimmy needs relief, add an explicitly delegated operator role with round controls but no economy/reset access. That is a proposed addition to the current Jimmy-only administration rule.

The admin home should put current status and its next action first. It also needs a persistent recovery menu: pause new betting, void/refund the current round, correct a result with a reason, see recent accepted requests, inspect all team balances, and export the event. A bank adjustment alone is not a result correction. Health should include a database read and clients should show last successful sync; the existing health endpoint always returns OK without checking D1.

For a three-hour event, use this as a pacing template, not a promise about how long the games take:

| Elapsed time | Room activity | App responsibility |
|---|---|---|
| 0:00-0:15 | Arrivals, passcodes, team introductions, rules | Verify all eight identities and the four equal starting banks; demonstrate one disposable practice round before the official start. |
| 0:15-1:15 | Featured matches with rotating participants | Queue the next matchup while the current game runs. Open bets during controller/setup time. Keep results and rematches on Home. |
| 1:15-1:30 | Break and standings reveal | Reconcile balances, check each player's participation, announce the next block. |
| 1:30-2:40 | Second block across agreed games | Rotate teams and games. Allow casual side play while one official market has the room's attention. |
| 2:40-3:00 | Final eligible round and awards | Stop opening rounds that cannot finish, resolve outstanding tickets, freeze standings, export, and reveal the recap. |

A 60-second betting window should overlap loading and controller setup. Twenty separate 90-second waits would consume 30 minutes. Slow games need deliberate slots: decide whether Mario Party means a full board or a shorter agreed competition before fixing the schedule. If several stations must run equally official matches simultaneously, the one-live-round architecture needs expansion. For the first event I would keep one featured market and allow unscored side games.

The most valuable additions after the repairs are a TV scoreboard and a next-match queue. The scoreboard turns private phone activity into shared reactions. The queue prevents the same pair from repeatedly choosing the game and collecting more opportunities to earn purses. A simple count of appearances and "last played" is enough to help the host rotate people.

The next additions should make the night's history worth keeping: custom team names and crests, a short result reveal with bank changes, and an exportable final card. Awards can include largest net betting win, biggest upset based on opening odds, most game wins, and final bank champion. All of these should come from actual accepted results and tickets. Let the host advance the reveal and make sounds optional.

The winning condition still needs an explicit decision. My recommendation is highest final team bank as the Derby title, with a separate game-performance award. That fits the fictional franchise concept, but equal opportunities to play matter: the house pays for each win, so unrestricted rematch volume rewards activity as well as skill. Set the rotation and the tie rule before play. A shared title on an exact bank tie is a simple default.

Keep the accepted economy for rehearsal: $10m opening bank, $25k-$500k tickets, and the existing game purses. A $500k ticket is 5% of opening cash. At even-field 1.90 odds, winning it nets $450k; a $250k ticket at four-way 3.80 odds nets $700k. Those swings can already exceed a game purse. Tune only after watching the simulated night; larger stakes can make one upset decide the event. Equal starting ratings mean early odds will be similar, which is appropriate when no performance history exists. Label ratings provisional instead of manufacturing confident favorites.

One FFA interaction deserves a conscious decision: when one player from every team participates, each player can only back themselves and all four nonplaying teammates are blocked. That follows the current rules but changes the spectator experience. If both teammates enter one FFA, each may edit the single shared ticket to back themselves. Keep that rule visible and agree who controls the ticket; changing it should be a product decision rather than an accidental side effect.

The recommended work sequence for Monday is:

1. Save the current build in version control, pin the working runtime, and keep the existing tests green. Separate the server command reducer from React hydration and add the Worker to explicit TypeScript checking; it is currently outside the source sets checked by `tsc -b`.
2. Repair input validation, identity, atomic writes, and accepted/pending/error behavior. Convert the five reproductions into proper regression tests. Include revision conflicts and failures between database operations.
3. Complete the commissioner recovery controls, finite deadlines, one-market behavior, clean production seed, and final closeout. Add reference-linked opening ledger grants and snapshot round rules.
4. Configure isolated Cloudflare staging and run a short practice across phones before investing in new decoration. Then add the TV view and queue.
5. Run the full event rehearsal, fix observed friction, and deploy the verified version to production. Freeze code and economy before arrivals.

Treat the first three steps plus a working staging round as a useful Monday milestone, not a guarantee that every feature can be completed in a day. A larger ratings model, chat, native apps, public signup, season management, and elaborate PWA/offline caching can wait.

Release acceptance should include all eight identities on actual devices, two teammates editing together, opposing teams betting simultaneously, a late bet, a duplicate request, and a lost response after a successful write. Deliberately disconnect a phone, reconnect it, reload the host, void a round, and correct a result. Check a mixed team/FFA night, Mario Party with no betting, and attempts to use commissioner actions as a player. Every device must converge on the same accepted tickets and balances, and every final bank must reconcile with the full ledger. The night must refuse final closeout while its tickets remain unresolved.

Finish the rehearsal by having Jimmy play a complete match while someone follows the agreed reporting process. If that requires constant intervention from him, simplify the host workflow before adding anything else.
