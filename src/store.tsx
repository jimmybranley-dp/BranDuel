import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { createInitialState } from "./data";
import { canPlayerBet, generateOdds, getFreeForAllShares, isBettingOpen, selectionWon } from "./engine";
import type { AppSettings, AppState, EventFormat, GameId, PlayerId, ScheduledEvent, TeamId } from "./types";

const STORAGE_KEY = "branduel-state-v2";
const PLAYER_STORAGE_KEY = "branduel-player-v1";

type SchedulePayload = {
  gameId: GameId;
  format: EventFormat;
  scheduledAt: string;
  teamIds?: [TeamId, TeamId];
  playerIds?: PlayerId[];
};

export type Action =
  | { type: "SET_PLAYER"; playerId: PlayerId }
  | { type: "START_GAME_NIGHT" }
  | { type: "END_GAME_NIGHT" }
  | { type: "CREATE_LIVE_EVENT"; payload: Omit<SchedulePayload, "scheduledAt"> & { bettingSeconds: number } }
  | { type: "START_MATCH"; eventId: string }
  | { type: "RUN_IT_BACK"; eventId: string; bettingSeconds: number }
  | { type: "DISMISS_RECAP" }
  | { type: "SCHEDULE_EVENT"; payload: SchedulePayload }
  | { type: "PLACE_BET"; eventId: string; selectionId: string; stake: number }
  | { type: "SETTLE_TEAM_EVENT"; eventId: string; winningTeamId: TeamId }
  | { type: "SETTLE_FFA_EVENT"; eventId: string; orderedPlayerIds: PlayerId[] }
  | { type: "CANCEL_EVENT"; eventId: string }
  | { type: "REOPEN_EVENT"; eventId: string }
  | { type: "UPDATE_SETTINGS"; settings: AppSettings }
  | { type: "ADJUST_BALANCE"; teamId: TeamId; amount: number; note: string }
  | { type: "RESET" };

type InternalAction = Action | { type: "HYDRATE_REMOTE"; state: AppState };
export type SyncStatus = "connecting" | "shared" | "local";
type StoreValue = { state: AppState; dispatch: React.Dispatch<Action>; syncStatus: SyncStatus };
const StoreContext = createContext<StoreValue | null>(null);

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadInitialState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const playerId = localStorage.getItem(PLAYER_STORAGE_KEY) as PlayerId | null;
    if (saved) {
      const state = JSON.parse(saved) as AppState;
      if (playerId && state.players[playerId]) state.currentPlayerId = playerId;
      return state;
    }
  } catch {
    // A fresh seed is safer than blocking the app on corrupt local test data.
  }
  return createInitialState();
}

function addLedger(
  state: AppState,
  teamId: TeamId,
  amount: number,
  type: AppState["ledger"][number]["type"],
  description: string,
) {
  state.ledger.unshift({ id: id("txn"), teamId, amount, type, description, createdAt: new Date().toISOString() });
}

function settleBets(state: AppState, event: ScheduledEvent) {
  state.bets = state.bets.map((bet) => {
    if (bet.eventId !== event.id || bet.status !== "open") return bet;
    if (selectionWon(event, bet.selectionId)) {
      const payout = Math.round(bet.stake * bet.decimalOdds);
      state.balances[bet.teamId] += payout;
      addLedger(state, bet.teamId, payout, "bet-win", `Winning wager on ${state.games[event.gameId].shortName}`);
      return { ...bet, status: "won" as const, payout };
    }
    return { ...bet, status: "lost" as const, payout: 0 };
  });
}

export function reducer(current: AppState, action: InternalAction): AppState {
  if (action.type === "HYDRATE_REMOTE") {
    return { ...action.state, currentPlayerId: current.currentPlayerId };
  }
  if (action.type === "RESET") return createInitialState();
  const state = structuredClone(current);

  if (action.type === "SET_PLAYER") {
    state.currentPlayerId = action.playerId;
    return state;
  }

  if (action.type === "START_GAME_NIGHT") {
    if (state.gameNight?.status === "active") return current;
    state.gameNight = {
      id: id("night"),
      status: "active",
      startedAt: new Date().toISOString(),
      eventIds: [],
    };
    return state;
  }

  if (action.type === "END_GAME_NIGHT") {
    if (!state.gameNight || state.gameNight.status !== "active" || state.gameNight.activeEventId) return current;
    state.gameNight.status = "ended";
    state.gameNight.endedAt = new Date().toISOString();
    return state;
  }

  if (action.type === "CREATE_LIVE_EVENT") {
    if (!state.gameNight || state.gameNight.status !== "active" || state.gameNight.activeEventId) return current;
    const now = new Date();
    const participants = action.payload.format === "teams" ? action.payload.teamIds ?? [] : action.payload.playerIds ?? [];
    const event: ScheduledEvent = {
      id: id("evt"),
      gameId: action.payload.gameId,
      format: action.payload.format,
      teamIds: action.payload.teamIds,
      playerIds: action.payload.playerIds,
      scheduledAt: now.toISOString(),
      bettingClosesAt: new Date(now.getTime() + action.payload.bettingSeconds * 1000).toISOString(),
      gameNightId: state.gameNight.id,
      status: "betting",
      odds: generateOdds(state, action.payload.gameId, action.payload.format, participants),
      createdBy: state.currentPlayerId,
      createdAt: now.toISOString(),
    };
    state.events.unshift(event);
    state.gameNight.eventIds.push(event.id);
    state.gameNight.activeEventId = event.id;
    state.gameNight.lastSettledEventId = undefined;
    return state;
  }

  if (action.type === "START_MATCH") {
    const event = state.events.find((item) => item.id === action.eventId);
    if (!event || event.status !== "betting") return current;
    event.status = "in-progress";
    event.bettingReopened = false;
    return state;
  }

  if (action.type === "RUN_IT_BACK") {
    if (!state.gameNight || state.gameNight.status !== "active" || state.gameNight.activeEventId) return current;
    const previous = state.events.find((item) => item.id === action.eventId);
    if (!previous || previous.status !== "completed") return current;
    const now = new Date();
    const participants = previous.format === "teams" ? previous.teamIds ?? [] : previous.playerIds ?? [];
    const event: ScheduledEvent = {
      id: id("evt"),
      gameId: previous.gameId,
      format: previous.format,
      teamIds: previous.teamIds,
      playerIds: previous.playerIds,
      scheduledAt: now.toISOString(),
      bettingClosesAt: new Date(now.getTime() + action.bettingSeconds * 1000).toISOString(),
      gameNightId: state.gameNight.id,
      status: "betting",
      odds: generateOdds(state, previous.gameId, previous.format, participants),
      createdBy: state.currentPlayerId,
      createdAt: now.toISOString(),
    };
    state.events.unshift(event);
    state.gameNight.eventIds.push(event.id);
    state.gameNight.activeEventId = event.id;
    state.gameNight.lastSettledEventId = undefined;
    return state;
  }

  if (action.type === "DISMISS_RECAP") {
    if (state.gameNight) state.gameNight.lastSettledEventId = undefined;
    return state;
  }

  if (action.type === "SCHEDULE_EVENT") {
    const participants = action.payload.format === "teams" ? action.payload.teamIds ?? [] : action.payload.playerIds ?? [];
    const event: ScheduledEvent = {
      id: id("evt"),
      ...action.payload,
      status: "scheduled",
      odds: generateOdds(state, action.payload.gameId, action.payload.format, participants),
      createdBy: state.currentPlayerId,
      createdAt: new Date().toISOString(),
    };
    state.events.unshift(event);
    return state;
  }

  if (action.type === "PLACE_BET") {
    const event = state.events.find((item) => item.id === action.eventId);
    if (!event || !isBettingOpen(event) || !state.games[event.gameId].bettable) return current;
    if (!canPlayerBet(state, event, action.selectionId, state.currentPlayerId)) return current;
    if (action.stake < state.settings.minimumBet || action.stake > state.settings.maximumBet) return current;
    const teamId = state.players[state.currentPlayerId].teamId;
    const existing = state.bets.find((bet) => bet.eventId === event.id && bet.teamId === teamId && bet.status === "open");
    const availableWithExisting = state.balances[teamId] + (existing?.stake ?? 0);
    if (availableWithExisting < action.stake) return current;
    const decimalOdds = event.odds[action.selectionId];
    if (!decimalOdds) return current;

    if (existing) {
      const difference = existing.stake - action.stake;
      state.balances[teamId] += difference;
      existing.selectionId = action.selectionId;
      existing.stake = action.stake;
      existing.decimalOdds = decimalOdds;
      existing.placedBy = state.currentPlayerId;
      existing.placedAt = new Date().toISOString();
      if (difference !== 0) {
        addLedger(
          state,
          teamId,
          difference,
          difference > 0 ? "bet-refund" : "bet-stake",
          `Updated team wager on ${state.games[event.gameId].shortName}`,
        );
      }
      return state;
    }

    state.balances[teamId] -= action.stake;
    state.bets.unshift({
      id: id("bet"),
      eventId: event.id,
      teamId,
      placedBy: state.currentPlayerId,
      selectionId: action.selectionId,
      stake: action.stake,
      decimalOdds,
      status: "open",
      payout: 0,
      placedAt: new Date().toISOString(),
    });
    addLedger(state, teamId, -action.stake, "bet-stake", `Wager on ${state.games[event.gameId].shortName}`);
    return state;
  }

  if (action.type === "SETTLE_TEAM_EVENT") {
    const event = state.events.find((item) => item.id === action.eventId);
    if (!event || !["scheduled", "betting", "in-progress"].includes(event.status) || !event.teamIds?.includes(action.winningTeamId)) return current;
    event.status = "completed";
    event.result = { winningTeamId: action.winningTeamId };
    const payout = state.settings.payouts[event.gameId];
    state.balances[action.winningTeamId] += payout;
    addLedger(state, action.winningTeamId, payout, "game-payout", `${state.games[event.gameId].name} win`);
    settleBets(state, event);
    if (state.gameNight?.activeEventId === event.id) {
      state.gameNight.activeEventId = undefined;
      state.gameNight.lastSettledEventId = event.id;
    }
    return state;
  }

  if (action.type === "SETTLE_FFA_EVENT") {
    const event = state.events.find((item) => item.id === action.eventId);
    if (!event || !["scheduled", "betting", "in-progress"].includes(event.status) || !event.playerIds) return current;
    const validOrder = action.orderedPlayerIds.length === event.playerIds.length
      && action.orderedPlayerIds.every((playerId) => event.playerIds?.includes(playerId));
    if (!validOrder) return current;
    event.status = "completed";
    event.result = { orderedPlayerIds: action.orderedPlayerIds };
    const pot = state.settings.payouts[event.gameId];
    const shares = getFreeForAllShares(action.orderedPlayerIds.length);
    action.orderedPlayerIds.forEach((playerId, index) => {
      const teamId = state.players[playerId].teamId;
      const payout = Math.round(pot * shares[index]);
      state.balances[teamId] += payout;
      addLedger(state, teamId, payout, "game-payout", `${state.games[event.gameId].name}, ${index + 1}${index === 0 ? "st" : index === 1 ? "nd" : index === 2 ? "rd" : "th"} place`);
    });
    settleBets(state, event);
    if (state.gameNight?.activeEventId === event.id) {
      state.gameNight.activeEventId = undefined;
      state.gameNight.lastSettledEventId = event.id;
    }
    return state;
  }

  if (action.type === "CANCEL_EVENT") {
    const event = state.events.find((item) => item.id === action.eventId);
    if (!event || !["scheduled", "betting", "in-progress"].includes(event.status)) return current;
    event.status = "cancelled";
    state.bets = state.bets.map((bet) => {
      if (bet.eventId !== event.id || bet.status !== "open") return bet;
      state.balances[bet.teamId] += bet.stake;
      addLedger(state, bet.teamId, bet.stake, "bet-refund", `Refund for cancelled ${state.games[event.gameId].shortName} event`);
      return { ...bet, status: "refunded" as const, payout: bet.stake };
    });
    if (state.gameNight?.activeEventId === event.id) {
      state.gameNight.activeEventId = undefined;
      state.gameNight.lastSettledEventId = undefined;
    }
    return state;
  }

  if (action.type === "REOPEN_EVENT") {
    const event = state.events.find((item) => item.id === action.eventId);
    if (!event || !["scheduled", "betting"].includes(event.status)) return current;
    event.status = event.gameNightId ? "betting" : "scheduled";
    event.bettingReopened = true;
    event.scheduledAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    return state;
  }

  if (action.type === "UPDATE_SETTINGS") {
    state.settings = action.settings;
    Object.values(state.games).forEach((game) => {
      game.payout = action.settings.payouts[game.id];
    });
    return state;
  }

  if (action.type === "ADJUST_BALANCE") {
    state.balances[action.teamId] += action.amount;
    addLedger(state, action.teamId, action.amount, "admin-adjustment", action.note || "Admin adjustment");
    return state;
  }

  return current;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, localDispatch] = useReducer(reducer, undefined, loadInitialState);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("connecting");
  const stateRef = useRef(state);
  const syncStatusRef = useRef<SyncStatus>("connecting");
  const serverRevision = useRef(0);
  const actionQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    stateRef.current = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    localStorage.setItem(PLAYER_STORAGE_KEY, state.currentPlayerId);
  }, [state]);

  const updateSyncStatus = useCallback((status: SyncStatus) => {
    syncStatusRef.current = status;
    setSyncStatus(status);
  }, []);

  const hydrate = useCallback((remoteState: AppState, revision: number) => {
    if (revision < serverRevision.current) return;
    serverRevision.current = revision;
    localDispatch({ type: "HYDRATE_REMOTE", state: remoteState });
    updateSyncStatus("shared");
  }, [updateSyncStatus]);

  const fetchRemoteState = useCallback(async () => {
    try {
      const response = await fetch("/api/state", { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`State request failed with ${response.status}.`);
      const payload = await response.json() as { state: AppState; revision: number };
      if (payload.revision > serverRevision.current || syncStatusRef.current === "local") hydrate(payload.state, payload.revision);
      else updateSyncStatus("shared");
    } catch {
      updateSyncStatus("local");
    }
  }, [hydrate, updateSyncStatus]);

  useEffect(() => {
    void fetchRemoteState();
    const interval = window.setInterval(() => void fetchRemoteState(), 2_000);
    const refresh = () => void fetchRemoteState();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [fetchRemoteState]);

  const dispatch = useCallback<React.Dispatch<Action>>((action) => {
    localDispatch(action);
    if (action.type === "SET_PLAYER") return;

    const actorId = stateRef.current.currentPlayerId;
    const requestId = crypto.randomUUID();
    actionQueue.current = actionQueue.current.then(async () => {
      try {
        const response = await fetch("/api/actions", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ action, actorId, requestId }),
        });
        const payload = await response.json() as { state?: AppState; revision?: number; error?: string };
        if (!response.ok || !payload.state || typeof payload.revision !== "number") {
          throw new Error(payload.error ?? `Action request failed with ${response.status}.`);
        }
        hydrate(payload.state, payload.revision);
      } catch {
        updateSyncStatus("local");
        await fetchRemoteState();
      }
    });
  }, [fetchRemoteState, hydrate, updateSyncStatus]);

  const value = useMemo(() => ({ state, dispatch, syncStatus }), [state, dispatch, syncStatus]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useStore must be used inside StoreProvider");
  return context;
}
