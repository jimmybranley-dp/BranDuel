# Decision record 0004: Economy v1 boundary

Date: September 18, 2026

## Decision

BranDuel v1 uses a duration-calibrated purse: `400,000 × sqrt(minutes / 10)`, rounded to the nearest $25,000 with exact half steps rounding upward, then clamped to $150,000–$1,000,000. Fresh teams start at $200,000; tickets remain within a $25,000 minimum and $500,000 hard maximum, with an additional team-specific cap of half the confirmed available bank, floored to $25,000.

Game metadata owns expected minutes and the standard contest description. A commissioner may override a calculated purse only within ±20%, on a $25,000 boundary, with a recorded reason. The configured purse and all betting rules are frozen into a market when it opens.

Observed duration is `startedAt → settledAt`. At least three completed, non-voided samples produce a commissioner-visible median and suggested future purse; suggestions never mutate a current market. Historical events without `startedAt` are ignored.

Existing balances are not silently rewritten. Jimmy must explicitly start a new economy season after all prior work is closed. That action preserves archives and records one per-team ledger adjustment with the actor, reason, prior/new balances, season ID, request receipt, and D1 audit context.

## Consequences

- Repeated success can compound, but a team cannot risk more than half its currently confirmed available bank on a new ticket.
- Ticket replacement returns the old open stake before recalculating the team cap.
- Older snapshots remain readable; missing duration metadata marks historical custom games for calibration without inventing old data.
- Golden Tee’s four-player nine-hole contest remains an operational product question until the physical cabinet mode is confirmed.
