import { describe, expect, it } from "vitest";
import { createInitialState, sampleEvents } from "./data";
import { canPlayerBet, formatAmericanOdds, generateOdds, getBetRestrictionReason, getFreeForAllShares, isBettingOpen } from "./engine";

describe("BranDuel rules", () => {
  it("uses the agreed free-for-all payout shares", () => {
    expect(getFreeForAllShares(4)).toEqual([0.5, 0.3, 0.15, 0.05]);
    expect(getFreeForAllShares(3)).toEqual([0.6, 0.3, 0.1]);
    expect(getFreeForAllShares(2)).toEqual([0.7, 0.3]);
  });

  it("creates equal opening odds with a five percent house edge", () => {
    const state = createInitialState();
    expect(generateOdds(state, "smash", "teams", ["jason-ezra", "corey-jimmy"])).toEqual({
      "jason-ezra": 1.9,
      "corey-jimmy": 1.9,
    });
    expect(formatAmericanOdds(1.9)).toBe("-111");
  });

  it("only lets a participant back their own side", () => {
    const state = createInitialState();
    const event = sampleEvents()[0];
    expect(canPlayerBet(state, event, "corey-jimmy", "jimmy")).toBe(true);
    expect(canPlayerBet(state, event, "jason-ezra", "jimmy")).toBe(false);
  });

  it("blocks a player when only their teammate is in a free-for-all", () => {
    const state = createInitialState();
    const event = sampleEvents()[1];
    expect(canPlayerBet(state, event, "andrew", "brandon")).toBe(false);
    expect(canPlayerBet(state, event, "corey", "jimmy")).toBe(false);
    expect(getBetRestrictionReason(state, event, "jimmy")).toBe("Corey is playing, so your team cannot bet on this match.");
  });

  it("closes betting at the scheduled start", () => {
    const event = sampleEvents()[0];
    event.status = "betting";
    event.bettingClosesAt = event.scheduledAt;
    expect(isBettingOpen(event, new Date(event.scheduledAt).getTime() - 1)).toBe(true);
    expect(isBettingOpen(event, new Date(event.scheduledAt).getTime())).toBe(false);
  });
});
