import { describe, expect, it } from "vitest";
import { createInitialState } from "./data";
import { canPlayerBet, formatAmericanOdds, generateOdds, getBetRestrictionReason, getCurrentNightHeatAppearances, getFairProbabilities, getFreeForAllShares, getPlayerHeat, HEAT_CONFIG, isBettingOpen } from "./engine";
import type { ScheduledEvent } from "./types";

function sampleTeamEvent(): ScheduledEvent {
  return { id: "team-event", gameId: "smash", format: "teams", teamIds: ["jason-ezra", "corey-jimmy"], odds: { "jason-ezra": 1.9, "corey-jimmy": 1.9 }, status: "betting", scheduledAt: "2026-09-12T00:00:00.000Z", createdAt: "2026-09-12T00:00:00.000Z", createdBy: "jimmy" };
}

function sampleFfaEvent(): ScheduledEvent {
  return { id: "ffa-event", gameId: "boomerang", format: "free-for-all", playerIds: ["ezra", "corey", "andrew", "ryan"], odds: { ezra: 3.8, corey: 3.8, andrew: 3.8, ryan: 3.8 }, status: "betting", scheduledAt: "2026-09-12T00:00:00.000Z", createdAt: "2026-09-12T00:00:00.000Z", createdBy: "jimmy" };
}

function completedTeamEvent(id: string, settledAt: string, winner: "jason-ezra" | "corey-jimmy" = "jason-ezra", gameId = "smash", mode: "prep" | "derby" = "derby"): ScheduledEvent {
  return { id, gameId, format: "teams", teamIds: ["jason-ezra", "corey-jimmy"], odds: {}, status: "completed", scheduledAt: settledAt, settledAt, createdAt: settledAt, createdBy: "jimmy", gameNightId: "night-1", mode, ratingWeight: 1, result: { winningTeamId: winner } };
}

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

  it("uses only completed results from the current night and seeds live odds from Prep", () => {
    const state = createInitialState();
    state.gameNight = { id: "night-1", status: "active", mode: "live", startedAt: "2026-09-18T00:00:00.000Z", eventIds: ["prep-1"] };
    state.events = [completedTeamEvent("old-night", "2026-09-18T00:02:00.000Z")];
    state.events[0].gameNightId = "old-night";
    expect(generateOdds(state, "smash", "teams", ["jason-ezra", "corey-jimmy"])).toEqual({ "jason-ezra": 1.9, "corey-jimmy": 1.9 });

    state.events = [completedTeamEvent("prep-1", "2026-09-18T00:02:00.000Z", "jason-ezra", "smash", "prep")];
    expect(generateOdds(state, "smash", "teams", ["jason-ezra", "corey-jimmy"])).toEqual({ "jason-ezra": 1.46, "corey-jimmy": 2.72 });
    expect(generateOdds(state, "boomerang", "teams", ["jason-ezra", "corey-jimmy"])).toEqual({ "jason-ezra": 1.58, "corey-jimmy": 2.37 });
  });

  it("supports legacy eventIds association, weighted recency, and normalized result performance", () => {
    const state = createInitialState();
    state.gameNight = { id: "night-1", status: "active", mode: "live", startedAt: "2026-09-18T00:00:00.000Z", eventIds: ["legacy"] };
    const legacy = completedTeamEvent("legacy", "2026-09-18T00:02:00.000Z");
    delete legacy.gameNightId;
    state.events = [legacy];
    expect(getCurrentNightHeatAppearances(state)).toHaveLength(4);
    expect(getPlayerHeat(state, "jason", "smash")).toMatchObject({ nightForm: 1, gameForm: 1, lineScore: 1 });

    const ranked: ScheduledEvent = { id: "ranked", gameId: "smash", format: "teams", teamIds: ["jason-ezra", "corey-jimmy", "brandon-andrew", "bruce-ryan"], odds: {}, status: "completed", scheduledAt: "2026-09-18T00:03:00.000Z", settledAt: "2026-09-18T00:03:00.000Z", createdAt: "2026-09-18T00:03:00.000Z", createdBy: "jimmy", gameNightId: "night-1", result: { orderedTeamIds: ["jason-ezra", "corey-jimmy", "brandon-andrew", "bruce-ryan"] } };
    state.events.push(ranked);
    const performances = getCurrentNightHeatAppearances(state).filter((appearance) => appearance.eventId === "ranked");
    expect(performances.filter((appearance) => appearance.playerId === "jason")[0].performance).toBe(1);
    expect(performances.filter((appearance) => appearance.playerId === "corey")[0].performance).toBeCloseTo(1 / 3);
    expect(performances.filter((appearance) => appearance.playerId === "brandon")[0].performance).toBeCloseTo(-1 / 3);
    expect(performances.filter((appearance) => appearance.playerId === "bruce")[0].performance).toBe(-1);
    expect(HEAT_CONFIG.recencyWeights).toEqual([1, 0.65, 0.4, 0.25]);
  });

  it("keeps two-way and multiway fair probabilities inside their guardrails", () => {
    expect(getFairProbabilities([["favorite", 10], ["underdog", -10]])).toEqual({ favorite: 0.72, underdog: 0.28 });
    for (let count = 2; count <= 8; count += 1) {
      const fair = Object.values(getFairProbabilities(Array.from({ length: count }, (_, index) => [`selection-${index}`, index] as [string, number])));
      expect(fair.every((probability) => Number.isFinite(probability) && probability > 0)).toBe(true);
      expect(fair.reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 10);
      if (count > 2) {
        expect(Math.min(...fair)).toBeGreaterThanOrEqual(0.5 / count - 1e-10);
        expect(Math.max(...fair)).toBeLessThanOrEqual(Math.min(0.55, 2.2 / count) + 1e-10);
      }
    }
  });

  it("only lets a participant back their own side", () => {
    const state = createInitialState();
    const event = sampleTeamEvent();
    expect(canPlayerBet(state, event, "corey-jimmy", "jimmy")).toBe(true);
    expect(canPlayerBet(state, event, "jason-ezra", "jimmy")).toBe(false);
  });

  it("blocks a player when only their teammate is in a free-for-all", () => {
    const state = createInitialState();
    const event = sampleFfaEvent();
    expect(canPlayerBet(state, event, "andrew", "brandon")).toBe(false);
    expect(canPlayerBet(state, event, "corey", "jimmy")).toBe(false);
    expect(getBetRestrictionReason(state, event, "jimmy")).toBe("Corey is playing, so your team cannot bet on this match.");
  });

  it("closes betting at the scheduled start", () => {
    const event = sampleTeamEvent();
    event.status = "betting";
    event.bettingClosesAt = event.scheduledAt;
    expect(isBettingOpen(event, new Date(event.scheduledAt).getTime() - 1)).toBe(true);
    expect(isBettingOpen(event, new Date(event.scheduledAt).getTime())).toBe(false);
  });
});
