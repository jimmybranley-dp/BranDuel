# Decision record 0005: current-night Heat odds

Date: September 18, 2026

## Decision

BranDuel uses a derived, entertainment-oriented current-night Heat signal for generated betting lines. It is not presented as a statistically precise long-term skill estimate. Completed, valid, non-voided Prep and live appearances from the active Game Night share one recency sequence. The four newest appearances use `1.00`, `0.65`, `0.40`, and `0.25`; `nightForm` and game-specific `gameForm` combine as `0.65 / 0.35`. Selection strength is `exp(0.31 × lineScore)`, followed by bounded fair-probability normalization and the existing 5% house edge.

Prep results seed the first live markets at full weight and naturally age out as newer appearances arrive. Switching from Prep to Live does not reset Heat. A new Game Night starts neutral. Historical W–L records remain factual and separate from Heat.

## Consequences

- Heat is derived from confirmed event results rather than stored as a mutable total, so corrections and voids deterministically affect future markets.
- Team selections use the arithmetic mean of member line scores; FFA selections use the individual line score.
- Two-selection fair probabilities are bounded to `0.28–0.72`. Multi-selection probabilities are bounded to `0.5 / N` through `min(0.55, 2.2 / N)`.
- Odds are snapshotted when a market opens. Later results, corrections, voids, and wager volume never rewrite accepted odds.
- Prep remains non-economic: no purse, wager, bankroll, or ledger effects.
