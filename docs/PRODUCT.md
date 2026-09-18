# Product contract

This document separates behavior verified by the current code/tests from decisions that still need the product owner. The implementation sources are `src/data.ts`, `src/domain.ts`, `src/engine.ts`, and `src/settlement.ts`; the tests in `src/*.test.*` are the executable examples.

## Settled and implemented rules

### Event and economy

- There are four fixed two-player teams: Jason/Ezra, Corey/Jimmy, Brandon/Andrew, and Bruce/Ryan.
- A fresh economy grants each team $200,000. Opening grants are recorded in the ledger. Existing balances carry forward until Jimmy explicitly resets the league for a new season.
- House purses use `round-to-nearest-$25,000($400,000 × sqrt(expected minutes / 10))`, clamped to $150,000–$1,000,000. Exact half steps round upward. The built-in purses are:

  | Game          |    Purse | Betting |
  | ------------- | -------: | ------- |
  | Smash         | $350,000 | Yes     |
  | Boomerang Fu  | $400,000 | Yes     |
  | Worms         | $575,000 | Yes     |
  | Mario Party   | $900,000 | No      |
  | Mario Kart    | $500,000 | Yes     |
  | NFL Blitz     | $450,000 | Yes     |
  | Billiards     | $450,000 | Yes     |
  | Golden Tee    | $750,000 | Yes     |
  | Mortal Kombat | $400,000 | Yes     |

- A losing match does not debit the losing team. Winning game payouts and winning wager payouts credit the appropriate team.
- A team event ranks two to four distinct participating teams. An FFA ranks two to eight distinct players, and a two-player FFA must cross team boundaries.
- A result is reviewed before settlement. Team results require an explicit winner or complete team order; FFA results require every participant exactly once.
- Odds, purse, and stake rules are snapshotted when a market opens. The minimum ticket is $25,000 and the hard maximum is $500,000. Each ticket is also capped at half of the team’s confirmed available bank, floored to the nearest $25,000; replacement tickets add the existing open stake back before calculating that cap.
- There is at most one open team ticket per market. Replacing a ticket preserves the old ticket and refunds it before staking the replacement. Self-bet and teammate restrictions apply.
- Mario Party has results and payouts but no betting market.
- Scheduling is not supported. A normal event is created live when the matchup is ready; the legacy `scheduled` status is retained only so old snapshots can be safely voided.
- Closeout requires every event to be completed or cancelled and every ticket to be resolved. Closeout freezes the final snapshot and archive.

### Roles and permissions

All permissions below are enforced by the Worker using the authenticated session actor, not by a client-selected identity.

| Capability                                                        | Any signed-in player | Jimmy / commissioner |
| ----------------------------------------------------------------- | -------------------- | -------------------- |
| Start the night                                                   | No                   | Yes                  |
| Create a live matchup, start play, report a result, run a rematch | Yes                  | Yes                  |
| Place or edit an allowed team ticket                              | Yes                  | Yes                  |
| Correct or void/refund a round                                    | No                   | Yes                  |
| Pause betting, change economy/team names/games, adjust a bank     | No                   | Yes                  |
| Change night mode, close out, reset                               | No                   | Yes                  |
| Export the event archive                                          | No                   | Yes                  |

The command domain contains a prep action for the optional warmup mode. Scheduling actions are intentionally absent; legacy scheduled snapshots may only be recovered or voided.

## Critical journeys

1. **Join:** choose a player and passcode; the Worker establishes a session and returns the confirmed snapshot.
2. **Start:** Jimmy starts Game Night. No round or wager is created by this action.
3. **Run a live round:** build a matchup, open its finite betting window, place/edit team tickets, start play to lock betting, report the result, review the settlement, and continue with a rematch or next matchup.
4. **Recover:** if confirmation is missing, stop mutations, keep the request ID, and resolve the saved request before signing out or trying another change. See [RELIABILITY.md](RELIABILITY.md).
5. **Commissioner recovery:** Jimmy may pause betting, reopen an eligible expired market before play, void/refund, correct a completed result with a reason, inspect balances, export, and close out.
6. **Close:** finish or void every draft/round and resolve every ticket; Jimmy closes the night and then uses the frozen archive for the final recap.

Prep mode, if intentionally enabled by Jimmy before live play, runs non-betting games whose results count toward ratings at full weight while having no betting, purse, bankroll, or ledger effect.

## Product invariants

- The four stable team IDs remain the ownership key even if Jimmy renames teams.
- Server-confirmed state is the only accepted product state; a client cache is never authority.
- A market's accepted odds and rules do not change after opening.
- A team has no more than one open ticket per market, and ticket replacement is auditable.
- Settlement and correction preserve money conservation and a reconstructable ledger.
- Results cannot be settled before play, and final closeout cannot leave unresolved work.
- Archived nights are frozen; ordinary new nights carry balances forward rather than silently resetting the league.
- Jimmy may explicitly reset the league for a new season only after all prior work is closed. This clears active game results, derived ratings, wagers, and closeout archives, then creates fresh $200,000 opening grants. Immutable server audit and receipt records remain available for accountability.

## Unresolved product decisions

The previously tracked decisions below are now recorded as settled by the product owner. New unresolved decisions belong here; do not infer them from a temporary UI or historical material.

| Decision                 | Current evidence                                                         | Owner decision needed                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Golden Tee cabinet mode. | The economy catalog defines a four-player nine-hole stroke-play contest. | Confirm whether the physical cabinet exposes a native nine-hole mode or whether the standard contest needs an operational note. |

### Decisions recorded on September 17, 2026

- Up to four concurrent markets are supported.
- Scheduling is removed from the product. Legacy scheduled snapshots remain only for safe recovery/void handling.
- Jimmy alone starts Game Night; any signed-in player may operate normal live rounds after it starts.
- The official Derby winner is settled in person. The app records results and balances but does not declare the title winner.
- Prep mode uses full rating weight and remains a pre-live, non-economic mode.

See [decision record 0003](decisions/0003-open-product-decisions.md) for the evidence trail.
