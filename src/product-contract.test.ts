import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createInitialState,
  PREP_RATING_COPY,
  PREP_RATING_WEIGHT,
} from "./data";
import { applyAction } from "./domain";

describe("prep mode product contract", () => {
  it("keeps full Heat weight and the non-economic promise in one shared contract", () => {
    let state = applyAction(
      createInitialState(),
      { type: "START_GAME_NIGHT" },
      "jimmy",
    );
    state = applyAction(
      state,
      { type: "SET_GAME_NIGHT_MODE", mode: "prep" },
      "jimmy",
    );
    state = applyAction(
      state,
      {
        type: "CREATE_PREP_EVENT",
        payload: {
          gameId: "smash",
          format: "teams",
          teamIds: ["jason-ezra", "corey-jimmy"],
        },
      },
      "jimmy",
    );

    expect(PREP_RATING_WEIGHT).toBe(1);
    expect(state.events[0].ratingWeight).toBe(PREP_RATING_WEIGHT);
    expect(PREP_RATING_COPY).toContain("full weight");
    expect(PREP_RATING_COPY).toContain(
      "no betting, purse, bankroll, or ledger effect",
    );

    const product = readFileSync(
      new URL("../docs/PRODUCT.md", import.meta.url),
      "utf8",
    );
    const setup = readFileSync(
      new URL("./frontend/match-setup.tsx", import.meta.url),
      "utf8",
    );
    expect(product).toContain(
      "Prep results seed opening live odds at full weight",
    );
    expect(product).toContain("no betting, purse, bankroll, or ledger effect");
    expect(setup).toContain("PREP_RATING_COPY");
  });
});
