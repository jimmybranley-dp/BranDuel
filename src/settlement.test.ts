import { describe, expect, it } from "vitest";
import { createInitialState } from "./data";
import { buildSettlementPreview, getFfaPlayerMultiplier } from "./settlement";
import type { ScheduledEvent } from "./types";

function event(overrides: Partial<ScheduledEvent>): ScheduledEvent {
  return { id: "event-test", gameId: "smash", format: "teams", eventType: "HEAD_TO_HEAD", housePurse: 1_000, status: "in-progress", scheduledAt: "2026-09-12T00:00:00.000Z", createdAt: "2026-09-12T00:00:00.000Z", createdBy: "jimmy", odds: {}, ...overrides } as ScheduledEvent;
}

describe("generic event settlement", () => {
  it("settles FFA by team score and uses the four-team curve", () => {
    const state = createInitialState();
    const preview = buildSettlementPreview(event({ format: "free-for-all", eventType: "FFA", playerIds: ["jason", "corey", "brandon", "bruce"] }), state, { orderedPlayerIds: ["jason", "corey", "brandon", "bruce"] });
    expect(preview.payouts.map((item) => [item.teamId, item.amount])).toEqual([["jason-ezra", 540], ["corey-jimmy", 225], ["brandon-andrew", 90], ["bruce-ryan", 45]]);
    expect(preview.input.baseHousePurse).toBe(1_000);
    expect(preview.input.housePurse).toBe(1_000);
    expect(preview.input.adjustedHousePurse).toBe(900);
    expect(preview.input.playerCountMultiplier).toBe(0.9);
    expect(Object.values(preview.bankrollChanges).reduce((sum, amount) => sum + amount, 0)).toBe(900);
  });

  it("maps every supported FFA player count to its purse multiplier", () => {
    expect([2, 3, 4, 5, 6, 7, 8].map(getFfaPlayerMultiplier)).toEqual([0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3]);
    expect(getFfaPlayerMultiplier(1)).toBeUndefined();
    expect(getFfaPlayerMultiplier(9)).toBeUndefined();
  });

  it("settles single and bracket head-to-head events", () => {
    const state = createInitialState();
    const single = buildSettlementPreview(event({ teamIds: ["jason-ezra", "corey-jimmy"] }), state, { winningTeamId: "jason-ezra" });
    expect(single.payouts.map((item) => item.amount)).toEqual([750, 250]);
    const bracket = buildSettlementPreview(event({ teamIds: ["jason-ezra", "corey-jimmy", "brandon-andrew", "bruce-ryan"], bracketSize: 4, hasConsolationMatch: false }), state, { orderedTeamIds: ["jason-ezra", "corey-jimmy", "brandon-andrew", "bruce-ryan"] });
    expect(bracket.payouts.map((item) => item.amount)).toEqual([600, 250, 75, 75]);
    expect(bracket.input.baseHousePurse).toBe(1_000);
    expect(bracket.input.adjustedHousePurse).toBe(1_000);
    expect(bracket.input.playerCountMultiplier).toBeUndefined();
  });

  it("assigns integer rounding remainder from the highest finish", () => {
    const state = createInitialState();
    const preview = buildSettlementPreview(event({ housePurse: 101, teamIds: ["jason-ezra", "corey-jimmy"] }), state, { winningTeamId: "jason-ezra" });
    expect(preview.payouts.map((item) => item.amount)).toEqual([76, 25]);
  });
});
