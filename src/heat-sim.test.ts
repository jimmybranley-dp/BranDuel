import { describe, expect, it } from "vitest";
import { createInitialState } from "./data";
import { generateOdds, getFairProbabilities, getPlayerHeat } from "./engine";
import type { ScheduledEvent } from "./types";

function resultEvent(id: string, gameId: string, settledAt: string, winner: "jason-ezra" | "corey-jimmy", mode: "prep" | "derby" = "derby"): ScheduledEvent {
  return { id, gameId, format: "teams", teamIds: ["jason-ezra", "corey-jimmy"], odds: {}, status: "completed", scheduledAt: settledAt, settledAt, createdAt: settledAt, createdBy: "jimmy", gameNightId: "simulation-night", mode, ratingWeight: 1, result: { winningTeamId: winner } };
}

describe("deterministic Heat simulation", () => {
  it("demonstrates neutral opening, Prep seeding, live movement, decay, and field bounds", () => {
    const state = createInitialState();
    state.gameNight = { id: "simulation-night", status: "active", mode: "live", startedAt: "2026-09-18T00:00:00.000Z", eventIds: [] };
    const neutral = generateOdds(state, "smash", "teams", ["jason-ezra", "corey-jimmy"]);
    state.events.push(resultEvent("prep", "smash", "2026-09-18T00:01:00.000Z", "jason-ezra", "prep"));
    const prepSeeded = generateOdds(state, "smash", "teams", ["jason-ezra", "corey-jimmy"]);
    state.events.push(resultEvent("live-1", "boomerang", "2026-09-18T00:02:00.000Z", "jason-ezra"));
    const liveMoved = generateOdds(state, "smash", "teams", ["jason-ezra", "corey-jimmy"]);
    for (let index = 0; index < 4; index += 1) state.events.push(resultEvent(`live-${index + 2}`, "smash", `2026-09-18T00:0${3 + index}:00.000Z`, index % 2 ? "corey-jimmy" : "jason-ezra"));
    const cooled = getPlayerHeat(state, "jason", "smash");

    expect(neutral).toEqual({ "jason-ezra": 1.9, "corey-jimmy": 1.9 });
    expect(prepSeeded).toEqual({ "jason-ezra": 1.46, "corey-jimmy": 2.72 });
    expect(liveMoved["jason-ezra"]).toBeLessThan(prepSeeded["jason-ezra"]);
    expect(cooled.nightAppearances).toHaveLength(4);
    expect(cooled.nightAppearances.some((appearance) => appearance.eventId === "prep")).toBe(false);

    for (let count = 2; count <= 8; count += 1) {
      const probabilities = Object.values(getFairProbabilities(Array.from({ length: count }, (_, index) => [`selection-${index}`, index] as [string, number])));
      expect(probabilities.reduce((sum, probability) => sum + probability, 0)).toBeCloseTo(1, 10);
      expect(probabilities.every((probability) => probability > 0 && Number.isFinite(probability))).toBe(true);
    }

    console.log(JSON.stringify({ neutral, prepSeeded, liveMoved, cooled: cooled.lineScore }));
  });
});
