import { describe, expect, it } from "vitest";
import { createInitialState } from "./data";
import { reducer } from "./store";

describe("Game Night session", () => {
  it("runs a live team round from betting through settlement", () => {
    let state = reducer(createInitialState(), { type: "START_GAME_NIGHT" });
    state = reducer(state, {
      type: "CREATE_LIVE_EVENT",
      payload: {
        gameId: "smash",
        format: "teams",
        teamIds: ["jason-ezra", "corey-jimmy"],
        bettingSeconds: 90,
      },
    });

    const eventId = state.gameNight?.activeEventId;
    expect(eventId).toBeTruthy();
    expect(state.events.find((event) => event.id === eventId)?.status).toBe("betting");

    state = reducer(state, { type: "PLACE_BET", eventId: eventId!, selectionId: "corey-jimmy", stake: 25_000 });
    state = reducer(state, { type: "PLACE_BET", eventId: eventId!, selectionId: "corey-jimmy", stake: 50_000 });
    expect(state.bets.filter((bet) => bet.eventId === eventId && bet.status === "open")).toHaveLength(1);
    expect(state.balances["corey-jimmy"]).toBe(9_950_000);

    state = reducer(state, { type: "START_MATCH", eventId: eventId! });
    expect(state.events.find((event) => event.id === eventId)?.status).toBe("in-progress");

    state = reducer(state, { type: "SETTLE_TEAM_EVENT", eventId: eventId!, winningTeamId: "corey-jimmy" });
    expect(state.gameNight?.activeEventId).toBeUndefined();
    expect(state.gameNight?.lastSettledEventId).toBe(eventId);
    expect(state.balances["corey-jimmy"]).toBe(10_545_000);
  });

  it("can run the same matchup again with refreshed odds", () => {
    let state = reducer(createInitialState(), { type: "START_GAME_NIGHT" });
    state = reducer(state, {
      type: "CREATE_LIVE_EVENT",
      payload: { gameId: "worms", format: "teams", teamIds: ["brandon-andrew", "bruce-ryan"], bettingSeconds: 60 },
    });
    const firstId = state.gameNight!.activeEventId!;
    state = reducer(state, { type: "START_MATCH", eventId: firstId });
    state = reducer(state, { type: "SETTLE_TEAM_EVENT", eventId: firstId, winningTeamId: "brandon-andrew" });
    state = reducer(state, { type: "RUN_IT_BACK", eventId: firstId, bettingSeconds: 90 });
    expect(state.gameNight?.eventIds).toHaveLength(2);
    expect(state.gameNight?.activeEventId).not.toBe(firstId);
    expect(state.events[0].status).toBe("betting");
    expect(state.events[0].odds["brandon-andrew"]).toBeLessThan(state.events[0].odds["bruce-ryan"]);
  });
});
