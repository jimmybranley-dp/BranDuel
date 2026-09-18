import { describe, expect, it } from "vitest";
import { createInitialState, GAME_IDS, normalizeState, TEAM_IDS } from "./data";
import { applyAction, DomainError, parseAction } from "./domain";
import { getGameRecords, isBettingOpen } from "./engine";
import type { AppState } from "./types";

function live(format: "teams" | "free-for-all" = "teams") {
  let s = applyAction(createInitialState(), { type: "START_GAME_NIGHT" }, "jimmy");
  s = applyAction(s, { type: "CREATE_LIVE_EVENT", payload: format === "teams"
    ? { gameId: "smash", format, teamIds: ["jason-ezra", "corey-jimmy"], bettingSeconds: 60 }
    : { gameId: "boomerang", format, playerIds: ["jason", "corey", "andrew", "ryan"], bettingSeconds: 60 } }, "jimmy");
  return s;
}
function reconcile(s: AppState) {
  TEAM_IDS.forEach((teamId) => expect(s.ledger.filter((e) => e.teamId === teamId).reduce((sum, e) => sum + e.amount, 0)).toBe(s.balances[teamId]));
}
function error(action: () => unknown, status: number) {
  try { action(); throw new Error("Expected rejection"); } catch (e) { expect(e).toBeInstanceOf(DomainError); expect((e as DomainError).status).toBe(status); }
}

describe("Server command validation", () => {
  it("fills newly added games into legacy persisted state", () => {
    const legacy = structuredClone(createInitialState());
    delete (legacy.games as Record<string, unknown>)["mario-kart"];
    delete (legacy.games as Record<string, unknown>)["nfl-blitz"];
    delete (legacy.games as Record<string, unknown>)["billiards"];
    delete (legacy.settings.payouts as Record<string, unknown>)["mario-kart"];
    delete (legacy.settings.payouts as Record<string, unknown>)["nfl-blitz"];
    delete (legacy.settings.payouts as Record<string, unknown>)["billiards"];
    const normalized = normalizeState(legacy);
    expect(normalized.games["mario-kart"].name).toBe("Mario Kart");
    expect(normalized.settings.payouts["mario-kart"]).toBe(500_000);
    expect(normalized.games["nfl-blitz"].name).toBe("NFL Blitz");
    expect(normalized.settings.payouts["nfl-blitz"]).toBe(450_000);
    expect(normalized.games.billiards.name).toBe("Billiards");
    expect(normalized.settings.payouts.billiards).toBe(450_000);
  });
  it("rejects FFA participants from the same team", () => {
    error(() => applyAction(createInitialState(), { type: "CREATE_LIVE_EVENT", payload: { gameId: "smash", format: "free-for-all", playerIds: ["jason", "ezra"], bettingSeconds: 60 } }, "jimmy"), 400);
    error(() => applyAction(createInitialState(), { type: "CREATE_LIVE_EVENT", payload: { gameId: "worms", format: "free-for-all", playerIds: ["corey", "jimmy"], bettingSeconds: 60 } }, "jimmy"), 400);
  });
  it("allows two-player FFAs for every game type", () => {
    for (const gameId of GAME_IDS) {
      const state = applyAction(createInitialState(), { type: "START_GAME_NIGHT" }, "jimmy");
      expect(() => applyAction(state, { type: "CREATE_LIVE_EVENT", payload: { gameId, format: "free-for-all", playerIds: ["jason", "corey"], bettingSeconds: 60 } }, "jimmy")).not.toThrow();
    }
  });
  it("allows eight-player free-for-alls", () => {
    let s = applyAction(createInitialState(), { type: "START_GAME_NIGHT" }, "jimmy");
    const players = ["jason", "ezra", "corey", "jimmy", "brandon", "andrew", "bruce", "ryan"] as const;
    s = applyAction(s, { type: "CREATE_LIVE_EVENT", payload: { gameId: "smash", format: "free-for-all", playerIds: [...players], bettingSeconds: 60 } }, "jimmy");
    const eventId = s.events[0].id;
    s = applyAction(s, { type: "START_MATCH", eventId }, "jimmy");
    s = applyAction(s, { type: "SETTLE_FFA_EVENT", eventId, orderedPlayerIds: [...players] }, "jimmy");
    expect(s.events[0].status).toBe("completed");
    expect(TEAM_IDS.reduce((sum, teamId) => sum + s.balances[teamId], 0)).toBe(1_255_000);
    const other = applyAction(createInitialState(), { type: "START_GAME_NIGHT" }, "jimmy");
    expect(() => applyAction(other, { type: "CREATE_LIVE_EVENT", payload: { gameId: "boomerang", format: "free-for-all", playerIds: ["jason", "corey", "brandon", "bruce", "ryan"], bettingSeconds: 60 } }, "jimmy")).not.toThrow();
  });
  it("rejects internal/unknown actions, extra fields, unsafe money and malformed participants", () => {
    for (const action of [
      { type: "HYDRATE_REMOTE", state: {} }, { type: "SET_PLAYER", playerId: "jimmy" }, { type: "SCHEDULE_EVENT", payload: {} }, { type: "invented" },
      { type: "START_GAME_NIGHT", actorId: "jimmy" },
      ...[NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER].map((amount) => ({ type: "ADJUST_BALANCE", teamId: "jason-ezra", amount, note: "test" })),
      { type: "CREATE_LIVE_EVENT", payload: { gameId: "smash", format: "teams", teamIds: ["jason-ezra", "jason-ezra"], bettingSeconds: 60 } },
      { type: "CREATE_LIVE_EVENT", payload: { gameId: "bogus", format: "teams", teamIds: ["jason-ezra", "corey-jimmy"], bettingSeconds: 60 } },
      { type: "CREATE_LIVE_EVENT", payload: { gameId: "smash", format: "free-for-all", playerIds: ["jason", "jason"], bettingSeconds: 60 } },
    ]) error(() => parseAction(action), 400);
  });
  it("derives commissioner permission from actor argument and permits trusted player results", () => {
    const s = live();
    error(() => applyAction(s, { type: "ADJUST_BALANCE", teamId: "jason-ezra", amount: 100, note: "cheat" }, "jason"), 403);
    const running = applyAction(s, { type: "START_MATCH", eventId: s.events[0].id }, "jimmy");
    expect(applyAction(running, { type: "SETTLE_TEAM_EVENT", eventId: s.events[0].id, winningTeamId: "jason-ezra" }, "ryan").events[0].status).toBe("completed");
  });
  it("lets Jimmy rename teams without changing their stable IDs", () => {
    const s = createInitialState();
    const renamed = applyAction(s, { type: "UPDATE_TEAM_NAMES", teamNames: {
      "jason-ezra": "Blue Comets",
      "corey-jimmy": "Red Rockets",
      "brandon-andrew": "Green Goblins",
      "bruce-ryan": "Gold Guardians",
    } }, "jimmy");
    expect(renamed.teams["jason-ezra"].name).toBe("Blue Comets");
    expect(Object.keys(renamed.balances)).toEqual(TEAM_IDS);
    error(() => applyAction(s, { type: "UPDATE_TEAM_NAMES", teamNames: {
      "jason-ezra": "One", "corey-jimmy": "Two", "brandon-andrew": "Three", "bruce-ryan": "Four",
    } }, "jason"), 403);
  });
  it("lets Jimmy add a custom game to the pool and use it for a round", () => {
    const initial = createInitialState();
    const added = applyAction(initial, { type: "ADD_GAME", payload: { id: "rocket-league", name: "Rocket League", shortName: "Rocket League", standardContest: "One standard match", expectedMinutes: 10, bettable: true } }, "jimmy");
    expect(added.games["rocket-league"].name).toBe("Rocket League");
    expect(added.settings.payouts["rocket-league"]).toBe(400_000);
    const night = applyAction(added, { type: "START_GAME_NIGHT" }, "jimmy");
    const prep = applyAction(night, { type: "SET_GAME_NIGHT_MODE", mode: "prep" }, "jimmy");
    expect(() => applyAction(prep, { type: "CREATE_PREP_EVENT", payload: { gameId: "rocket-league", format: "teams", teamIds: ["jason-ezra", "corey-jimmy"] } }, "jimmy")).not.toThrow();
  });
  it("requires Jimmy to start the night while players operate ordinary rounds", () => {
    error(() => applyAction(createInitialState(), { type: "START_GAME_NIGHT" }, "jason"), 403);
    let s = applyAction(createInitialState(), { type: "START_GAME_NIGHT" }, "jimmy");
    s = applyAction(s, { type: "CREATE_LIVE_EVENT", payload: { gameId: "smash", format: "teams", teamIds: ["jason-ezra", "corey-jimmy"], bettingSeconds: 60 } }, "ezra");
    const eventId = s.gameNight!.activeEventId!;
    s = applyAction(s, { type: "START_MATCH", eventId }, "brandon");
    s = applyAction(s, { type: "SETTLE_TEAM_EVENT", eventId, winningTeamId: "jason-ezra" }, "ryan");
    expect(s.events.find((event) => event.id === eventId)?.status).toBe("completed");
    s = applyAction(s, { type: "RUN_IT_BACK", eventId, bettingSeconds: 60 }, "andrew");
    expect(s.gameNight?.activeEventId).not.toBe(eventId);
    error(() => applyAction(s, { type: "PAUSE_BETTING", paused: true }, "jason"), 403);
    error(() => applyAction(s, { type: "END_GAME_NIGHT" }, "jason"), 403);
  });
  it("rejects duplicate finishers and settlement before play", () => {
    let s = live("free-for-all"); const eventId = s.events[0].id;
    error(() => applyAction(s, { type: "SETTLE_FFA_EVENT", eventId, orderedPlayerIds: ["jason", "corey", "andrew", "ryan"] }, "jason"), 409);
    s = applyAction(s, { type: "START_MATCH", eventId }, "jimmy");
    error(() => applyAction(s, { type: "SETTLE_FFA_EVENT", eventId, orderedPlayerIds: ["jason", "jason", "jason", "jason"] }, "jason"), 400);
    expect(s.events[0].result).toBeUndefined(); reconcile(s);
  });
});

describe("Market lifecycle and snapshots", () => {
  it("starts with four auditable opening grants and no demo markets", () => {
    const s = createInitialState();
    expect(s.events).toEqual([]);
    expect(s.ledger).toHaveLength(4);
    expect(s.ledger.every((entry) => entry.type === "opening-grant" && entry.actorId === "jimmy")).toBe(true);
    reconcile(s);
  });
  it("opens four finite concurrent markets and rejects a fifth", () => {
    let s = live();
    const firstId = s.events[0].id;
    for (const gameId of ["worms", "mario-kart", "nfl-blitz"] as const) {
      s = applyAction(s, { type: "CREATE_LIVE_EVENT", payload: { gameId, format: "teams", teamIds: ["brandon-andrew", "bruce-ryan"], bettingSeconds: 60 } }, "jimmy");
    }
    expect(s.gameNight?.activeEventIds).toHaveLength(4);
    error(() => applyAction(s, { type: "CREATE_LIVE_EVENT", payload: { gameId: "billiards", format: "teams", teamIds: ["jason-ezra", "brandon-andrew"], bettingSeconds: 60 } }, "jimmy"), 409);
    expect(isBettingOpen(s.events.find((event) => event.id === firstId)!)).toBe(true);
    s.events.find((event) => event.id === firstId)!.bettingClosesAt = new Date(Date.now() - 1000).toISOString();
    error(() => applyAction(s, { type: "PLACE_BET", eventId: firstId, selectionId: "jason-ezra", stake: 25_000 }, "jason"), 409);
    s = applyAction(s, { type: "PAUSE_BETTING", paused: true }, "jimmy");
    error(() => applyAction(s, { type: "PLACE_BET", eventId: firstId, selectionId: "jason-ezra", stake: 25_000 }, "jason"), 409);
  });
  it("keeps three concurrent markets independent through betting and settlement", () => {
    let s = applyAction(createInitialState(), { type: "START_GAME_NIGHT" }, "jimmy");
    const matchups = [
      { gameId: "smash" as const, teamIds: ["jason-ezra", "corey-jimmy"] as const },
      { gameId: "worms" as const, teamIds: ["brandon-andrew", "bruce-ryan"] as const },
      { gameId: "nfl-blitz" as const, teamIds: ["jason-ezra", "brandon-andrew"] as const },
    ];
    const eventIds = matchups.map(({ gameId, teamIds }) => {
      s = applyAction(s, { type: "CREATE_LIVE_EVENT", payload: { gameId, format: "teams", teamIds: [...teamIds], bettingSeconds: 60 } }, "jimmy");
      return s.events[0].id;
    });
    expect(s.gameNight?.activeEventIds).toEqual(eventIds);

    s = applyAction(s, { type: "PLACE_BET", eventId: eventIds[0], selectionId: "jason-ezra", stake: 25_000 }, "jason");
    s = applyAction(s, { type: "PLACE_BET", eventId: eventIds[1], selectionId: "brandon-andrew", stake: 50_000 }, "brandon");
    s = applyAction(s, { type: "START_MATCH", eventId: eventIds[1] }, "bruce");
    s = applyAction(s, { type: "SETTLE_TEAM_EVENT", eventId: eventIds[1], winningTeamId: "brandon-andrew" }, "ryan");

    expect(s.events.find((event) => event.id === eventIds[0])?.status).toBe("betting");
    expect(s.events.find((event) => event.id === eventIds[1])?.status).toBe("completed");
    expect(s.events.find((event) => event.id === eventIds[2])?.status).toBe("betting");
    expect(s.gameNight?.activeEventIds).toEqual([eventIds[0], eventIds[2]]);
    expect(s.gameNight?.activeEventId).toBe(eventIds[2]);
    expect(s.bets.filter((bet) => bet.status === "open")).toHaveLength(1);
    reconcile(s);

    s = applyAction(s, { type: "CREATE_LIVE_EVENT", payload: { gameId: "billiards", format: "teams", teamIds: ["corey-jimmy", "bruce-ryan"], bettingSeconds: 60 } }, "jimmy");
    expect(s.gameNight?.activeEventIds).toHaveLength(3);
  });
  it("reopens only an expired pre-play market without duplicating or changing its frozen rules", () => {
    let s = live();
    const eventId = s.events[0].id;
    const event = s.events[0];
    const frozen = { purse: event.purse, odds: structuredClone(event.odds), rules: structuredClone(event.rules) };
    error(() => applyAction(s, { type: "REOPEN_EVENT", eventId, bettingSeconds: 90 }, "jimmy"), 409);
    s.events[0].bettingClosesAt = new Date(Date.now() - 1_000).toISOString();
    error(() => applyAction(s, { type: "PLACE_BET", eventId, selectionId: "jason-ezra", stake: 25_000 }, "jason"), 409);
    error(() => applyAction(s, { type: "REOPEN_EVENT", eventId, bettingSeconds: 90 }, "jason"), 403);

    s = applyAction(s, { type: "REOPEN_EVENT", eventId, bettingSeconds: 90 }, "jimmy");
    expect(s.gameNight?.activeEventIds).toEqual([eventId]);
    expect(s.events[0].bettingReopened).toBe(true);
    expect(s.events[0].purse).toBe(frozen.purse);
    expect(s.events[0].odds).toEqual(frozen.odds);
    expect(s.events[0].rules).toEqual(frozen.rules);
    s = applyAction(s, { type: "PLACE_BET", eventId, selectionId: "jason-ezra", stake: 25_000 }, "jason");
    expect(s.bets[0].status).toBe("open");
    s = applyAction(s, { type: "START_MATCH", eventId }, "jason");
    error(() => applyAction(s, { type: "REOPEN_EVENT", eventId, bettingSeconds: 90 }, "jimmy"), 409);
  });
  it("snapshots purse and ticket limits when betting opens", () => {
    let s = live(); const eventId = s.events[0].id;
    s = applyAction(s, { type: "PLACE_BET", eventId, selectionId: "jason-ezra", stake: 25_000 }, "jason");
    s = applyAction(s, { type: "START_MATCH", eventId }, "jimmy");
    s = applyAction(s, { type: "SETTLE_TEAM_EVENT", eventId, winningTeamId: "jason-ezra" }, "jason");
    expect(s.balances["jason-ezra"]).toBe(485_000); reconcile(s);
  });
  it("keeps replaced tickets and refunds in the audit trail", () => {
    let s = live(); const eventId = s.events[0].id;
    s = applyAction(s, { type: "PLACE_BET", eventId, selectionId: "jason-ezra", stake: 25_000 }, "jason");
    s = applyAction(s, { type: "PLACE_BET", eventId, selectionId: "jason-ezra", stake: 50_000 }, "ezra");
    expect(s.bets.map((b) => b.status)).toEqual(["open", "replaced"]);
    expect(s.bets[0].placedBy).toBe("ezra");
    s = applyAction(s, { type: "CANCEL_EVENT", eventId }, "jimmy");
    expect(s.balances["jason-ezra"]).toBe(200_000); reconcile(s);
  });
  it("never allows Mario Party betting and refuses unfinished closeout", () => {
    let s = applyAction(createInitialState(), { type: "START_GAME_NIGHT" }, "jimmy");
    s = applyAction(s, { type: "CREATE_LIVE_EVENT", payload: { gameId: "mario-party", format: "teams", teamIds: ["jason-ezra", "corey-jimmy"], bettingSeconds: 60 } }, "jimmy");
    const eventId = s.events[0].id;
    error(() => applyAction(s, { type: "END_GAME_NIGHT" }, "jimmy"), 409);
    error(() => applyAction(s, { type: "PLACE_BET", eventId, selectionId: "jason-ezra", stake: 25_000 }, "jason"), 409);
    s = applyAction(s, { type: "START_MATCH", eventId }, "jimmy");
    error(() => applyAction(s, { type: "REOPEN_EVENT", eventId }, "jimmy"), 409);
    s = applyAction(s, { type: "SETTLE_TEAM_EVENT", eventId, winningTeamId: "jason-ezra" }, "jason");
    expect(s.balances["jason-ezra"]).toBe(875_000); reconcile(s);
  });
});

describe("Commissioner corrections and finale", () => {
  it("lets Jimmy open prep mode and switch permanently to Live Night", () => {
    let s = applyAction(createInitialState(), { type: "START_GAME_NIGHT" }, "jimmy");
    error(() => applyAction(s, { type: "SET_GAME_NIGHT_MODE", mode: "prep" }, "jason"), 403);
    s = applyAction(s, { type: "SET_GAME_NIGHT_MODE", mode: "prep" }, "jimmy");
    expect(s.gameNight?.mode).toBe("prep");
    s = applyAction(s, { type: "SET_GAME_NIGHT_MODE", mode: "live" }, "jimmy");
    expect(s.gameNight?.mode).toBe("live");
    error(() => applyAction(s, { type: "CREATE_PREP_EVENT", payload: { gameId: "smash", format: "teams", teamIds: ["jason-ezra", "corey-jimmy"] } }, "jimmy"), 409);
  });

  it("records prep games for ratings without touching the economy", () => {
    let s = applyAction(createInitialState(), { type: "START_GAME_NIGHT" }, "jimmy");
    s = applyAction(s, { type: "SET_GAME_NIGHT_MODE", mode: "prep" }, "jimmy");
    const startingBalances = structuredClone(s.balances);
    const startingLedger = s.ledger.length;
    s = applyAction(s, { type: "CREATE_PREP_EVENT", payload: { gameId: "smash", format: "teams", teamIds: ["jason-ezra", "corey-jimmy"] } }, "jason");
    const eventId = s.gameNight!.activeEventId!;
    expect(s.events[0].mode).toBe("prep");
    expect(s.events[0].status).toBe("in-progress");
    s = applyAction(s, { type: "SETTLE_EVENT", eventId, result: { winningTeamId: "jason-ezra" } }, "ezra");
    expect(s.balances).toEqual(startingBalances);
    expect(s.ledger).toHaveLength(startingLedger);
    expect(s.bets).toHaveLength(0);
    expect(getGameRecords(s, "smash").find((record) => record.playerId === "jason")?.wins).toBe(1);
    expect(getGameRecords(s, "smash").find((record) => record.playerId === "jason")?.rating).toBe(1014);
  });

  it("corrects and voids prep results without requiring settlement reversals", () => {
    let s = applyAction(createInitialState(), { type: "START_GAME_NIGHT" }, "jimmy");
    s = applyAction(s, { type: "SET_GAME_NIGHT_MODE", mode: "prep" }, "jimmy");
    s = applyAction(s, { type: "CREATE_PREP_EVENT", payload: { gameId: "smash", format: "teams", teamIds: ["jason-ezra", "corey-jimmy"] } }, "jimmy");
    const eventId = s.gameNight!.activeEventId!;
    s = applyAction(s, { type: "SETTLE_TEAM_EVENT", eventId, winningTeamId: "jason-ezra" }, "jason");
    s = applyAction(s, { type: "CORRECT_RESULT", eventId, result: { winningTeamId: "corey-jimmy" }, reason: "Wrong winner" }, "jimmy");
    expect(getGameRecords(s, "smash").find((record) => record.playerId === "corey")?.wins).toBe(1);
    s = applyAction(s, { type: "CANCEL_EVENT", eventId, reason: "Disputed prep result" }, "jimmy");
    expect(getGameRecords(s, "smash").every((record) => record.wins === 0 && record.rating === 1000)).toBe(true);
  });

  it("reverses and reapplies results repeatedly without changing accepted odds", () => {
    let s = live(); const eventId = s.events[0].id;
    s = applyAction(s, { type: "PLACE_BET", eventId, selectionId: "jason-ezra", stake: 100_000 }, "bruce");
    s = applyAction(s, { type: "START_MATCH", eventId }, "jimmy");
    s = applyAction(s, { type: "SETTLE_TEAM_EVENT", eventId, winningTeamId: "jason-ezra" }, "jason");
    s = applyAction(s, { type: "RUN_IT_BACK", eventId, bettingSeconds: 60 }, "jimmy");
    const laterOdds = structuredClone(s.events[0].odds);
    s = applyAction(s, { type: "CORRECT_RESULT", eventId, result: { winningTeamId: "corey-jimmy" }, reason: "Wrong side reported" }, "jimmy");
    expect(s.balances["jason-ezra"]).toBe(287_500);
    expect(s.balances["corey-jimmy"]).toBe(462_500);
    expect(s.balances["bruce-ryan"]).toBe(100_000);
    expect(s.events[0].odds).toEqual(laterOdds);
    expect(getGameRecords(s, "smash").find((p) => p.playerId === "corey")?.wins).toBe(1);
    reconcile(s);
    s = applyAction(s, { type: "CORRECT_RESULT", eventId, result: { winningTeamId: "jason-ezra" }, reason: "Video confirmed original" }, "jimmy");
    reconcile(s);
    s = applyAction(s, { type: "CANCEL_EVENT", eventId, reason: "Disputed round void" }, "jimmy");
    TEAM_IDS.forEach((team) => expect(s.balances[team]).toBe(200_000));
    expect(s.bets[0].status).toBe("refunded");
    expect(getGameRecords(s, "smash").every((p) => p.wins === 0 && p.rating === 1000)).toBe(true); reconcile(s);
  });
  it("conserves odd FFA purses and fixes all placement payouts", () => {
    let s = createInitialState();
    s = applyAction(s, { type: "START_GAME_NIGHT" }, "jimmy");
    s = applyAction(s, { type: "CREATE_LIVE_EVENT", payload: { gameId: "boomerang", format: "free-for-all", playerIds: ["jason", "corey", "andrew"], bettingSeconds: 60 } }, "jimmy");
    const eventId = s.events[0].id;
    s = applyAction(s, { type: "START_MATCH", eventId }, "jimmy");
    s = applyAction(s, { type: "SETTLE_FFA_EVENT", eventId, orderedPlayerIds: ["jason", "corey", "andrew"] }, "jason");
    expect(TEAM_IDS.reduce((sum, t) => sum + s.balances[t], 0)).toBe(1_120_000);
    s = applyAction(s, { type: "CORRECT_RESULT", eventId, result: { orderedPlayerIds: ["andrew", "corey", "jason"] }, reason: "Placements transposed" }, "jimmy");
    expect(s.balances["brandon-andrew"]).toBe(408_000); reconcile(s);
  });
  it("blocks unresolved closeout then freezes and archives the final snapshot", () => {
    let s = live(); const eventId = s.events[0].id;
    error(() => applyAction(s, { type: "END_GAME_NIGHT" }, "jimmy"), 409);
    s = applyAction(s, { type: "CANCEL_EVENT", eventId }, "jimmy");
    s = applyAction(s, { type: "END_GAME_NIGHT" }, "jimmy");
    const snapshot = structuredClone(s.gameNight!.finalSnapshot);
    error(() => applyAction(s, { type: "ADJUST_BALANCE", teamId: "jason-ezra", amount: 100, note: "too late" }, "jimmy"), 409);
    error(() => applyAction(s, { type: "RESET" }, "jimmy"), 409);
    s = applyAction(s, { type: "START_GAME_NIGHT" }, "jimmy");
    s = applyAction(s, { type: "ADJUST_BALANCE", teamId: "jason-ezra", amount: 100, note: "new night" }, "jimmy");
    expect(s.bankAdjustments).toHaveLength(1);
    expect(s.bankAdjustments[0]).toMatchObject({ teamId: "jason-ezra", amount: 100, note: "new night", actorId: "jimmy" });
    expect(s.bankAdjustments[0].ledgerEntryId).toBe(s.ledger[0].id);
    expect(s.gameNightArchives![0].finalSnapshot).toEqual(snapshot);
    error(() => applyAction(s, { type: "CANCEL_EVENT", eventId }, "jimmy"), 409); reconcile(s);
  });
  it("resets closed game and rating history for a fresh season", () => {
    let s = live(); const eventId = s.events[0].id;
    s = applyAction(s, { type: "START_MATCH", eventId }, "jimmy");
    s = applyAction(s, { type: "SETTLE_TEAM_EVENT", eventId, winningTeamId: "jason-ezra" }, "jason");
    s = applyAction(s, { type: "END_GAME_NIGHT" }, "jimmy");
    expect(getGameRecords(s, "smash").some((record) => record.rating !== 1000 || record.wins !== 0 || record.losses !== 0)).toBe(true);
    const reset = applyAction(s, { type: "RESET_SEASON", seasonId: "production-season-1", reason: "Remove testing history before live game nights" }, "jimmy");
    expect(reset.gameNight).toBeUndefined();
    expect(reset.gameNightArchives).toEqual([]);
    expect(reset.events).toEqual([]);
    expect(reset.bets).toEqual([]);
    expect(reset.bankAdjustments).toEqual([]);
    TEAM_IDS.forEach((teamId) => expect(reset.balances[teamId]).toBe(200_000));
    expect(getGameRecords(reset, "smash").every((record) => record.rating === 1000 && record.wins === 0 && record.losses === 0)).toBe(true);
    expect(reset.economySeasons?.[0]).toMatchObject({ id: "production-season-1", reason: "Remove testing history before live game nights" });
    expect(new Set(reset.ledger.map((entry) => entry.id)).size).toBe(4);
    expect(reset.ledger.every((entry) => entry.type === "opening-grant" && entry.amount === 200_000)).toBe(true);
  });
  it("refuses unsafe legacy reversals and permits debt without allowing unaffordable bets", () => {
    let s = live(); const eventId = s.events[0].id;
    s = applyAction(s, { type: "PLACE_BET", eventId, selectionId: "jason-ezra", stake: 100_000 }, "bruce");
    s = applyAction(s, { type: "START_MATCH", eventId }, "jimmy");
    s = applyAction(s, { type: "SETTLE_TEAM_EVENT", eventId, winningTeamId: "jason-ezra" }, "jason");
    s = applyAction(s, { type: "ADJUST_BALANCE", teamId: "bruce-ryan", amount: -10_000_000, note: "Bank already spent" }, "jimmy");
    s = applyAction(s, { type: "CORRECT_RESULT", eventId, result: { winningTeamId: "corey-jimmy" }, reason: "Wrong winner" }, "jimmy");
    expect(s.balances["bruce-ryan"]).toBe(-9_900_000); reconcile(s);
    s = applyAction(s, { type: "RUN_IT_BACK", eventId, bettingSeconds: 60 }, "jimmy");
    error(() => applyAction(s, { type: "PLACE_BET", eventId: s.events[0].id, selectionId: "jason-ezra", stake: 25_000 }, "bruce"), 409);
    s.ledger.forEach((entry) => { delete entry.eventId; });
    error(() => applyAction(s, { type: "CORRECT_RESULT", eventId, result: { winningTeamId: "jason-ezra" }, reason: "Legacy correction" }, "jimmy"), 409);
  });
  it("rejects partial settlement audit reversals without changing any input state", () => {
    let s = live(); const eventId = s.events[0].id;
    s = applyAction(s, { type: "PLACE_BET", eventId, selectionId: "jason-ezra", stake: 25_000 }, "jason");
    s = applyAction(s, { type: "START_MATCH", eventId }, "jimmy");
    s = applyAction(s, { type: "SETTLE_TEAM_EVENT", eventId, winningTeamId: "jason-ezra" }, "jason");
    expect(s.events[0].settlementLedgerIds).toHaveLength(3);
    s.ledger = s.ledger.filter((entry) => entry.type !== "bet-win");
    const original = structuredClone(s);
    error(() => applyAction(s, { type: "CORRECT_RESULT", eventId, result: { winningTeamId: "corey-jimmy" }, reason: "Audit is incomplete" }, "jimmy"), 409);
    expect(s).toEqual(original);
  });
  it("can correct and void zero-purse rounds using their explicit zero ledger entry", () => {
    let s = live(); const eventId = s.events[0].id;
    s.events[0].purse = 0;
    s = applyAction(s, { type: "START_MATCH", eventId }, "jimmy");
    s = applyAction(s, { type: "SETTLE_TEAM_EVENT", eventId, winningTeamId: "jason-ezra" }, "jason");
    s = applyAction(s, { type: "CORRECT_RESULT", eventId, result: { winningTeamId: "corey-jimmy" }, reason: "Correct records only" }, "jimmy");
    s = applyAction(s, { type: "CANCEL_EVENT", eventId, reason: "Void practice result" }, "jimmy");
    TEAM_IDS.forEach((team) => expect(s.balances[team]).toBe(200_000)); reconcile(s);
  });
});
