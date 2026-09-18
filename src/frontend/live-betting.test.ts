import { describe, expect, it } from "vitest";
import { createInitialState } from "../data";
import { reducer } from "../domain";
import { activeNightEvents } from "./live-betting";

describe("live betting event selection", () => {
  it("reads all concurrent active markets in order", () => {
    let state = reducer(createInitialState(), { type: "START_GAME_NIGHT" });
    state = reducer(state, { type: "CREATE_LIVE_EVENT", payload: { gameId: "smash", format: "teams", teamIds: ["jason-ezra", "corey-jimmy"], bettingSeconds: 90 } });
    state = reducer(state, { type: "CREATE_LIVE_EVENT", payload: { gameId: "worms", format: "teams", teamIds: ["brandon-andrew", "bruce-ryan"], bettingSeconds: 90 } });

    expect(activeNightEvents(state).map((event) => event.id)).toEqual(state.gameNight?.activeEventIds);
  });

  it("falls back to the legacy singular active event field", () => {
    let state = reducer(createInitialState(), { type: "START_GAME_NIGHT" });
    state = reducer(state, { type: "CREATE_LIVE_EVENT", payload: { gameId: "smash", format: "teams", teamIds: ["jason-ezra", "corey-jimmy"], bettingSeconds: 90 } });
    const legacyState = structuredClone(state);
    delete legacyState.gameNight!.activeEventIds;

    expect(activeNightEvents(legacyState)).toHaveLength(1);
    expect(activeNightEvents(legacyState)[0]?.id).toBe(state.gameNight?.activeEventId);
  });
});

