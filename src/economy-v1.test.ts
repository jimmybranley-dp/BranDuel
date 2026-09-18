import { describe, expect, it } from "vitest";
import { allowedMaximumBet } from "./engine";
import { applyAction, DomainError } from "./domain";
import { basePurse, createInitialState, medianObservedMinutes, normalizeState, TEAM_IDS } from "./data";
import { buildSettlementPreview } from "./settlement";
import type { PlayerId, ScheduledEvent } from "./types";

function expectDomain(action: Parameters<typeof applyAction>[1], state = createInitialState(), actor: PlayerId = "jimmy") {
  expect(() => applyAction(state, action, actor)).toThrow(DomainError);
}

function openMarkets() {
  let state = applyAction(createInitialState(), { type: "START_GAME_NIGHT" }, "jimmy");
  const ids = ["smash", "boomerang", "worms", "mario-kart"].map((gameId, index) => {
    state = applyAction(state, { type: "CREATE_LIVE_EVENT", payload: { gameId, format: "teams", teamIds: ["jason-ezra", index % 2 ? "brandon-andrew" : "corey-jimmy"], bettingSeconds: 60 } }, "jimmy");
    return state.events[0].id;
  });
  return { state, ids };
}

describe("Economy v1 purse formula and catalog", () => {
  it("rounds, clamps, and rejects invalid durations", () => {
    expect([8, 10, 20, 50, 15, 12, 12, 35].map(basePurse)).toEqual([350_000, 400_000, 575_000, 900_000, 500_000, 450_000, 450_000, 750_000]);
    expect(basePurse(0.01)).toBe(150_000);
    expect(basePurse(1_000_000)).toBe(1_000_000);
    expect(basePurse(10.634765625)).toBe(425_000);
    expect(() => basePurse(0)).toThrow();
    expect(() => basePurse(Number.NaN)).toThrow();
    expect(() => basePurse(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("seeds the new opening economy and catalog", () => {
    const state = createInitialState();
    expect(Object.values(state.balances)).toEqual([200_000, 200_000, 200_000, 200_000]);
    expect(state.ledger.filter((entry) => entry.type === "opening-grant").reduce((sum, entry) => sum + entry.amount, 0)).toBe(800_000);
    expect(state.games["golden-tee"]).toMatchObject({ expectedMinutes: 35, basePurse: 750_000, bettable: true });
    expect(state.games["mortal-kombat"]).toMatchObject({ expectedMinutes: 10, basePurse: 400_000, bettable: true });
    expect(state.games["mario-party"].bettable).toBe(false);
  });

  it("adds missing catalog entries without changing legacy balances or events", () => {
    const legacy = createInitialState();
    delete legacy.games["golden-tee"];
    delete legacy.games["mortal-kombat"];
    legacy.balances["jason-ezra"] = 12_345;
    legacy.events = [{ id: "old", gameId: "smash", format: "teams", status: "completed", scheduledAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", createdBy: "jimmy", odds: {}, purse: 1_500_000 }];
    const normalized = normalizeState(legacy);
    expect(normalized.balances["jason-ezra"]).toBe(12_345);
    expect(normalized.events[0].purse).toBe(1_500_000);
    expect(normalized.games["golden-tee"].basePurse).toBe(750_000);
    expect(normalized.games["mortal-kombat"].basePurse).toBe(400_000);
  });

  it("requires duration metadata for custom games and validates overrides", () => {
    const state = createInitialState();
    const added = applyAction(state, { type: "ADD_GAME", payload: { id: "rocket-league", name: "Rocket League", shortName: "Rocket League", standardContest: "One standard match", expectedMinutes: 20, bettable: true } }, "jimmy");
    expect(added.games["rocket-league"]).toMatchObject({ basePurse: 575_000, payout: 575_000 });
    expectDomain({ type: "ADD_GAME", payload: { id: "bad-game", name: "Bad", shortName: "Bad", standardContest: "One", expectedMinutes: 20, overridePurse: 700_000, overrideReason: "Too large", bettable: true } });
    expectDomain({ type: "ADD_GAME", payload: { id: "bad-game", name: "Bad", shortName: "Bad", standardContest: "One", expectedMinutes: 20, overridePurse: 500_000, bettable: true } });
  });
});

describe("Economy v1 dynamic ticket caps", () => {
  it("uses confirmed bank, replacement refunds, and concurrent-market exposure", () => {
    const { state: initialState, ids } = openMarkets();
    let state = initialState;
    const first = state.events.find((event) => event.id === ids[0])!;
    expect(allowedMaximumBet(state, first, "jason-ezra")).toBe(100_000);
    state = applyAction(state, { type: "PLACE_BET", eventId: ids[0], selectionId: "jason-ezra", stake: 100_000 }, "jason");
    expect(allowedMaximumBet(state, state.events.find((event) => event.id === ids[1])!, "jason-ezra")).toBe(50_000);
    state = applyAction(state, { type: "PLACE_BET", eventId: ids[1], selectionId: "jason-ezra", stake: 50_000 }, "jason");
    expect(allowedMaximumBet(state, state.events.find((event) => event.id === ids[2])!, "jason-ezra")).toBe(25_000);
    state = applyAction(state, { type: "PLACE_BET", eventId: ids[2], selectionId: "jason-ezra", stake: 25_000 }, "jason");
    expect(allowedMaximumBet(state, state.events.find((event) => event.id === ids[3])!, "jason-ezra")).toBe(0);
    expectDomain({ type: "PLACE_BET", eventId: ids[3], selectionId: "jason-ezra", stake: 25_000 }, state, "jason");
  });

  it("calculates replacement maximum as though the old stake were returned", () => {
    const { state: initialState, ids } = openMarkets();
    let state = initialState;
    state = applyAction(state, { type: "PLACE_BET", eventId: ids[0], selectionId: "jason-ezra", stake: 50_000 }, "bruce");
    const event = state.events.find((item) => item.id === ids[0])!;
    expect(allowedMaximumBet(state, event, "jason-ezra")).toBe(100_000);
    state = applyAction(state, { type: "PLACE_BET", eventId: ids[0], selectionId: "jason-ezra", stake: 100_000 }, "ryan");
    expect(state.bets.filter((bet) => bet.eventId === ids[0]).map((bet) => bet.status)).toEqual(["open", "replaced"]);
  });
});

describe("Economy v1 timing, seasons, and settlement", () => {
  it("uses only completed non-voided events with authoritative timestamps for median suggestions", () => {
    const state = createInitialState();
    const make = (id: string, minutes: number, status: ScheduledEvent["status"] = "completed"): ScheduledEvent => ({ id, gameId: "smash", format: "teams", status, scheduledAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", createdBy: "jimmy", odds: {}, startedAt: "2026-01-01T00:00:00.000Z", settledAt: new Date(Date.parse("2026-01-01T00:00:00.000Z") + minutes * 60_000).toISOString() });
    state.events = [make("a", 10), make("b", 20), make("c", 30), make("void", 100, "cancelled"), { ...make("missing", 40), startedAt: undefined }];
    expect(medianObservedMinutes(state, "smash")).toBe(20);
  });

  it("records the match start timestamp through the accepted action", () => {
    let state = applyAction(createInitialState(), { type: "START_GAME_NIGHT" }, "jimmy");
    state = applyAction(state, { type: "CREATE_LIVE_EVENT", payload: { gameId: "smash", format: "teams", teamIds: ["jason-ezra", "corey-jimmy"], bettingSeconds: 60 } }, "jimmy");
    const eventId = state.events[0].id;
    state = applyAction(state, { type: "START_MATCH", eventId }, "jimmy");
    expect(state.events[0]).toMatchObject({ id: eventId, status: "in-progress", startedAt: expect.any(String) });
  });

  it("rebases every team to $200,000 with auditable season entries", () => {
    let state = applyAction(createInitialState(), { type: "START_GAME_NIGHT" }, "jimmy");
    state = applyAction(state, { type: "ADJUST_BALANCE", teamId: "jason-ezra", amount: 300_000, note: "Carry-forward test" }, "jimmy");
    state = applyAction(state, { type: "END_GAME_NIGHT" }, "jimmy");
    state = applyAction(state, { type: "START_ECONOMY_SEASON", seasonId: "season-v1", reason: "Economy v1 launch" }, "jimmy");
    expect(state.balances).toEqual(Object.fromEntries(TEAM_IDS.map((teamId) => [teamId, 200_000])));
    expect(state.economySeasons?.[0]).toMatchObject({ id: "season-v1", actorId: "jimmy", reason: "Economy v1 launch" });
    expect(state.economySeasons?.[0].ledgerEntryIds).toHaveLength(4);
    expect(state.gameNight?.status).toBe("ended");
  });

  it("keeps the requested settlement curves for v1 purses", () => {
    const state = createInitialState();
    const event = (gameId: string, format: "teams" | "free-for-all", housePurse: number): ScheduledEvent => ({ id: gameId, gameId, format, eventType: format === "teams" ? "HEAD_TO_HEAD" : "FFA", housePurse, purse: housePurse, status: "in-progress", scheduledAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", createdBy: "jimmy", odds: {}, teamIds: format === "teams" ? ["jason-ezra", "corey-jimmy"] : undefined, playerIds: format === "free-for-all" ? ["jason", "corey", "brandon", "bruce"] : undefined });
    expect(buildSettlementPreview(event("smash", "teams", 400_000), state, { winningTeamId: "jason-ezra" }).payouts.map((item) => item.amount)).toEqual([300_000, 100_000]);
    const golden = buildSettlementPreview(event("golden-tee", "free-for-all", 750_000), state, { orderedPlayerIds: ["jason", "corey", "brandon", "bruce"] });
    expect(golden.input.adjustedHousePurse).toBe(675_000);
    expect(golden.payouts[0].amount).toBe(405_000);
  });
});
