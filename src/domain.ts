import { basePurse, createInitialState, GAME_IDS, maxFreeForAllPlayers, PLAYER_IDS, PREP_RATING_WEIGHT, TEAM_IDS, players } from "./data";
import { canPlayerBet, generateOdds, isBettingOpen, selectionWon } from "./engine";
import { buildSettlementPreview } from "./settlement";
import type { AppSettings, AppState, EventFormat, EventMode, EventType, GameId, GameNightMode, LedgerEntry, MatchResult, PlayerId, ScheduledEvent, TeamId } from "./types";

type Matchup = { gameId: GameId; format: EventFormat; eventType?: EventType; name?: string; housePurse?: number; bracketSize?: 2 | 3 | 4; hasConsolationMatch?: boolean; teamIds?: TeamId[]; playerIds?: PlayerId[] };
type GameInput = { id: string; name: string; shortName: string; standardContest: string; expectedMinutes: number; bettable: boolean; overridePurse?: number; overrideReason?: string };
type NewGame = GameInput;
type TeamNames = Record<TeamId, string>;
export const MAX_ACTIVE_EVENTS = 4;
export type Action =
  | { type: "START_GAME_NIGHT" | "END_GAME_NIGHT" | "DISMISS_RECAP" | "RESET" }
  | { type: "RESET_SEASON"; seasonId?: string; reason: string }
  | { type: "START_ECONOMY_SEASON"; seasonId?: string; reason: string }
  | { type: "SET_GAME_NIGHT_MODE"; mode: GameNightMode }
  | { type: "CREATE_LIVE_EVENT"; payload: Matchup & { bettingSeconds: number } }
  | { type: "CREATE_PREP_EVENT"; payload: Matchup }
  | { type: "START_MATCH"; eventId: string }
  | { type: "RUN_IT_BACK"; eventId: string; bettingSeconds: number }
  | { type: "PLACE_BET"; eventId: string; selectionId: string; stake: number }
  | { type: "SETTLE_TEAM_EVENT"; eventId: string; winningTeamId: TeamId }
  | { type: "SETTLE_FFA_EVENT"; eventId: string; orderedPlayerIds: PlayerId[] }
  | { type: "SETTLE_EVENT"; eventId: string; result: MatchResult }
  | { type: "CORRECT_RESULT"; eventId: string; result: MatchResult; reason: string }
  | { type: "CANCEL_EVENT"; eventId: string; reason?: string }
  | { type: "REOPEN_EVENT"; eventId: string; bettingSeconds?: number }
  | { type: "PAUSE_BETTING"; paused: boolean }
  | { type: "UPDATE_SETTINGS"; settings: AppSettings }
  | { type: "UPDATE_TEAM_NAMES"; teamNames: TeamNames }
  | { type: "ADD_GAME"; payload: NewGame }
  | { type: "UPDATE_GAME"; payload: GameInput }
  | { type: "ADJUST_BALANCE"; teamId: TeamId; amount: number; note: string };

export class DomainError extends Error {
  constructor(message: string, public status = 409, public code = "INVALID_STATE") { super(message); this.name = "DomainError"; }
}
function requireThat(condition: unknown, message: string, status = 409, code = "INVALID_STATE"): asserts condition {
  if (!condition) throw new DomainError(message, status, code);
}
function invalid(condition: unknown, message: string): asserts condition { requireThat(condition, message, 400, "INVALID_ACTION"); }
function object(value: unknown, allowed: string[], required = allowed): Record<string, unknown> {
  invalid(value !== null && typeof value === "object" && !Array.isArray(value), "Expected an object.");
  const obj = value as Record<string, unknown>;
  invalid(Object.keys(obj).every((key) => allowed.includes(key)), "Unexpected action field.");
  invalid(required.every((key) => Object.hasOwn(obj, key)), "Missing action field.");
  return obj;
}
function text(value: unknown, name: string, limit = 500) { invalid(typeof value === "string" && value.trim().length > 0 && value.length <= limit, `${name} is required.`); }
function money(value: unknown, minimum = 0) { invalid(typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && Math.abs(value) <= 1_000_000_000_000, "Money must be a whole, finite amount within supported limits."); }
function duration(value: unknown) { invalid(typeof value === "number" && Number.isSafeInteger(value) && value >= 10 && value <= 3600, "Betting window must be 10–3600 seconds."); }
function member(value: unknown, ids: string[], name: string) { invalid(typeof value === "string" && ids.includes(value), `Invalid ${name}.`); }
function list(value: unknown, ids: string[], min: number, max: number) {
  invalid(Array.isArray(value) && value.length >= min && value.length <= max && new Set(value).size === value.length && value.every((id) => ids.includes(id)), "Participants must be distinct valid IDs.");
}
function matchup(value: Record<string, unknown>, availableGameIds: string[] = GAME_IDS) {
  invalid(typeof value.gameId === "string" && availableGameIds.includes(value.gameId) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.gameId), "Invalid game."); member(value.format, ["teams", "free-for-all"], "format");
  if (value.eventType !== undefined) member(value.eventType, ["FFA", "HEAD_TO_HEAD"], "event type");
  if (value.housePurse !== undefined) money(value.housePurse);
  if (value.bracketSize !== undefined) invalid(value.bracketSize === 2 || value.bracketSize === 3 || value.bracketSize === 4, "Select between two and four teams.");
  if (value.hasConsolationMatch !== undefined) invalid(typeof value.hasConsolationMatch === "boolean", "Consolation setting must be boolean.");
  if (value.format === "teams") {
    invalid(value.eventType === undefined || value.eventType === "HEAD_TO_HEAD", "Team matches must be head-to-head events.");
    const bracketSize = (value.bracketSize as number | undefined) ?? (Array.isArray(value.teamIds) ? value.teamIds.length : 0);
    list(value.teamIds, TEAM_IDS, bracketSize, bracketSize);
    invalid(value.playerIds === undefined, "Team matches cannot include individual participants.");
    invalid(value.hasConsolationMatch === undefined || bracketSize === 4 || value.hasConsolationMatch === false, "Consolation matches require a four-team bracket.");
  } else {
    invalid(value.eventType === undefined || value.eventType === "FFA", "Free-for-alls must be FFA events.");
    list(value.playerIds, PLAYER_IDS, 2, maxFreeForAllPlayers(value.gameId as GameId));
    const teams = (value.playerIds as PlayerId[]).map((playerId) => players[playerId].teamId);
    invalid(teams.length !== 2 || new Set(teams).size === 2, "A two-player FFA must be between different teams.");
    invalid(value.teamIds === undefined, "Free-for-alls cannot include team participants.");
    invalid(value.bracketSize === undefined && value.hasConsolationMatch === undefined, "FFA events cannot use bracket settings.");
  }
}
function settings(value: unknown) {
  const s = object(value, ["startingBankroll", "minimumBet", "maximumBet", "houseEdge", "payouts"]);
  money(s.startingBankroll, 1); money(s.minimumBet, 1); money(s.maximumBet, 1);
  invalid(s.minimumBet === 25_000, "Minimum bet is fixed at $25,000.");
  invalid(s.maximumBet === 500_000, "Hard maximum bet is fixed at $500,000.");
  invalid(s.houseEdge === 0.05, "House edge is fixed at 5%.");
  invalid(s.payouts !== null && typeof s.payouts === "object" && !Array.isArray(s.payouts), "Payouts are required.");
  const p = s.payouts as Record<string, unknown>;
  invalid(GAME_IDS.every((gameId) => Object.hasOwn(p, gameId)) && Object.keys(p).every((gameId) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(gameId)), "Invalid game payout.");
  Object.values(p).forEach((amount) => money(amount));
}
function gameInput(value: unknown, existingIds: string[], requireNew: boolean): NewGame {
  const g = object(value, ["id", "name", "shortName", "standardContest", "expectedMinutes", "bettable", "overridePurse", "overrideReason"], ["id", "name", "shortName", "standardContest", "expectedMinutes", "bettable"]);
  invalid(typeof g.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(g.id) && (requireNew ? !existingIds.includes(g.id) : true), requireNew ? "Game ID must be a new lowercase slug." : "Game ID must identify an existing game.");
  text(g.name, "Game name", 80); text(g.shortName, "Short name", 30); text(g.standardContest, "Standard contest", 160);
  invalid(typeof g.expectedMinutes === "number" && Number.isSafeInteger(g.expectedMinutes) && g.expectedMinutes > 0 && g.expectedMinutes <= 1440, "Expected minutes must be a positive whole number.");
  invalid(typeof g.bettable === "boolean", "Betting setting is required.");
  const calculated = basePurse(g.expectedMinutes as number);
  if (g.overridePurse !== undefined) {
    money(g.overridePurse, 1);
    invalid((g.overridePurse as number) % 25_000 === 0, "An override must be rounded to $25,000.");
    invalid((g.overridePurse as number) >= calculated * 0.8 && (g.overridePurse as number) <= calculated * 1.2, "An override must be within ±20% of the calculated purse.");
    text(g.overrideReason, "Override reason", 500);
  } else {
    invalid(g.overrideReason === undefined, "An override reason requires an override purse.");
  }
  return { id: g.id as string, name: (g.name as string).trim(), shortName: (g.shortName as string).trim(), standardContest: (g.standardContest as string).trim(), expectedMinutes: g.expectedMinutes as number, bettable: g.bettable as boolean, overridePurse: g.overridePurse as number | undefined, overrideReason: g.overrideReason as string | undefined };
}
function teamNames(value: unknown): TeamNames {
  const names = object(value, TEAM_IDS);
  TEAM_IDS.forEach((teamId) => text(names[teamId], "Team name", 60));
  invalid(new Set(TEAM_IDS.map((teamId) => (names[teamId] as string).trim().toLowerCase())).size === TEAM_IDS.length, "Team names must be unique.");
  return Object.fromEntries(TEAM_IDS.map((teamId) => [teamId, (names[teamId] as string).trim()])) as TeamNames;
}
function resultShape(value: unknown) {
  const r = object(value, ["winningTeamId", "orderedPlayerIds", "orderedTeamIds"], []);
  invalid([r.winningTeamId, r.orderedPlayerIds, r.orderedTeamIds].filter((item) => item !== undefined).length === 1, "Specify exactly one result format.");
  if (r.winningTeamId !== undefined) member(r.winningTeamId, TEAM_IDS, "winner");
  else if (r.orderedPlayerIds !== undefined) list(r.orderedPlayerIds, PLAYER_IDS, 2, 8);
  else list(r.orderedTeamIds, TEAM_IDS, 2, 4);
}
export function parseAction(value: unknown, availableGameIds: string[] = GAME_IDS): Action {
  const base = object(value, ["type", "payload", "eventId", "bettingSeconds", "selectionId", "stake", "winningTeamId", "orderedPlayerIds", "result", "reason", "paused", "settings", "teamNames", "teamId", "amount", "note", "mode", "seasonId"], ["type"]);
  switch (base.type) {
    case "START_GAME_NIGHT": case "END_GAME_NIGHT": case "DISMISS_RECAP": case "RESET": object(base, ["type"]); break;
    case "RESET_SEASON": object(base, ["type", "reason", "seasonId"], ["type", "reason"]); text(base.reason, "Season reset reason"); if (base.seasonId !== undefined) text(base.seasonId, "Season ID", 120); break;
    case "START_ECONOMY_SEASON": object(base, ["type", "reason", "seasonId"], ["type", "reason"]); text(base.reason, "Season reason"); if (base.seasonId !== undefined) text(base.seasonId, "Season ID", 120); break;
    case "SET_GAME_NIGHT_MODE": object(base, ["type", "mode"]); member(base.mode, ["prep", "live"], "game night mode"); break;
    case "CREATE_LIVE_EVENT": case "CREATE_PREP_EVENT": {
      object(base, ["type", "payload"]);
      const live = base.type === "CREATE_LIVE_EVENT";
      const p = object(base.payload, ["gameId", "format", "eventType", "name", "housePurse", "bracketSize", "hasConsolationMatch", "teamIds", "playerIds", ...(live ? ["bettingSeconds"] : [])], ["gameId", "format", ...(live ? ["bettingSeconds"] : [])]);
      matchup(p, availableGameIds);
      if (live) duration(p.bettingSeconds);
      break;
    }
    case "START_MATCH": object(base, ["type", "eventId"]); break;
    case "RUN_IT_BACK": object(base, ["type", "eventId", "bettingSeconds"]); duration(base.bettingSeconds); break;
    case "REOPEN_EVENT": object(base, ["type", "eventId", "bettingSeconds"], ["type", "eventId"]); if (base.bettingSeconds !== undefined) duration(base.bettingSeconds); break;
    case "PLACE_BET": object(base, ["type", "eventId", "selectionId", "stake"]); text(base.selectionId, "Selection", 100); money(base.stake, 1); break;
    case "SETTLE_TEAM_EVENT": object(base, ["type", "eventId", "winningTeamId"]); member(base.winningTeamId, TEAM_IDS, "winner"); break;
    case "SETTLE_FFA_EVENT": object(base, ["type", "eventId", "orderedPlayerIds"]); list(base.orderedPlayerIds, PLAYER_IDS, 2, 8); break;
    case "SETTLE_EVENT": object(base, ["type", "eventId", "result"]); resultShape(base.result); break;
    case "CORRECT_RESULT": object(base, ["type", "eventId", "result", "reason"]); resultShape(base.result); text(base.reason, "Correction reason"); break;
    case "CANCEL_EVENT": object(base, ["type", "eventId", "reason"], ["type", "eventId"]); if (base.reason !== undefined) text(base.reason, "Void reason"); break;
    case "PAUSE_BETTING": object(base, ["type", "paused"]); invalid(typeof base.paused === "boolean", "Paused must be boolean."); break;
    case "UPDATE_SETTINGS": object(base, ["type", "settings"]); settings(base.settings); break;
    case "UPDATE_TEAM_NAMES": object(base, ["type", "teamNames"]); teamNames(base.teamNames); break;
    case "ADD_GAME": object(base, ["type", "payload"]); gameInput(base.payload, availableGameIds, true); break;
    case "UPDATE_GAME": object(base, ["type", "payload"]); gameInput(base.payload, availableGameIds, false); break;
    case "ADJUST_BALANCE": object(base, ["type", "teamId", "amount", "note"]); member(base.teamId, TEAM_IDS, "team"); money(base.amount, -1_000_000_000_000); invalid(base.amount !== 0, "Adjustment cannot be zero."); text(base.note, "Adjustment note"); break;
    default: throw new DomainError("Unknown or internal action.", 400, "INVALID_ACTION");
  }
  if ("eventId" in base) text(base.eventId, "Event ID", 150);
  return structuredClone(base) as Action;
}
function id(prefix: string) { return `${prefix}-${crypto.randomUUID()}`; }
function addLedger(state: AppState, actorId: PlayerId, teamId: TeamId, amount: number, type: LedgerEntry["type"], description: string, references: Partial<Pick<LedgerEntry, "eventId" | "betId" | "reversesEntryId" | "seasonId" | "priorBalance" | "newBalance" | "reason">> = {}) {
  requireThat(Number.isSafeInteger(amount) && Number.isSafeInteger(state.balances[teamId] + amount), "Amount exceeds safe accounting limits.");
  state.balances[teamId] += amount;
  const entryId = id("txn");
  state.ledger.unshift({ id: entryId, teamId, amount, type, description, actorId, createdAt: new Date().toISOString(), ...references });
  return entryId;
}
function activeNight(state: AppState) { requireThat(state.gameNight?.status === "active", "Start a game night first."); return state.gameNight; }
function activeEventIds(state: AppState) {
  const night = state.gameNight;
  return night?.activeEventIds ?? (night?.activeEventId ? [night.activeEventId] : []);
}
function setActiveEvents(night: NonNullable<AppState["gameNight"]>, eventIds: string[]) {
  const uniqueEventIds = [...new Set(eventIds)];
  night.activeEventIds = uniqueEventIds;
  night.activeEventId = uniqueEventIds.at(-1);
}
function oneMarket(state: AppState, exceptId?: string) {
  const activeCount = state.events.filter((e) => e.id !== exceptId && (e.status === "betting" || e.status === "in-progress")).length;
  requireThat(activeCount < MAX_ACTIVE_EVENTS, `Up to ${MAX_ACTIVE_EVENTS} games can be active at once. Finish or void an active game first.`);
}
function eventFor(state: AppState, eventId: string) {
  const event = state.events.find((item) => item.id === eventId);
  requireThat(event, "Event was not found.", 404, "NOT_FOUND");
  requireThat(!event.gameNightId || event.gameNightId === activeNight(state).id, "Archived rounds are frozen.");
  return event;
}
function validateResult(event: ScheduledEvent, result: MatchResult) {
  resultShape(result);
  const type = event.eventType ?? (event.format === "free-for-all" ? "FFA" : "HEAD_TO_HEAD");
  if (type === "HEAD_TO_HEAD") {
    const teamIds = event.teamIds ?? event.participants?.teamIds ?? [];
    const ordered = result.orderedTeamIds ?? (result.winningTeamId ? [result.winningTeamId, ...teamIds.filter((teamId) => teamId !== result.winningTeamId)] : []);
    requireThat(ordered.length === teamIds.length && new Set(ordered).size === teamIds.length && ordered.every((teamId) => teamIds.includes(teamId)), "Result must rank every participating team exactly once.", 400, "INVALID_RESULT");
    requireThat(teamIds.length >= 2 && teamIds.length <= 4, "Fixed-team events require two to four teams.", 400, "INVALID_RESULT");
  }
  else requireThat(result.orderedPlayerIds && event.playerIds && event.playerIds.length <= maxFreeForAllPlayers(event.gameId) && result.orderedPlayerIds.length === event.playerIds.length && new Set(result.orderedPlayerIds).size === event.playerIds.length && result.orderedPlayerIds.every((p) => event.playerIds!.includes(p)), "Finish order must contain every participant exactly once.", 400, "INVALID_RESULT");
}
function settle(state: AppState, event: ScheduledEvent, result: MatchResult, actorId: PlayerId) {
  validateResult(event, result);
  const prep = event.mode === "prep";
  const preview = prep ? undefined : buildSettlementPreview(event, state, result);
  const ledgerCount = state.ledger.length;
  event.result = structuredClone(result); event.status = "completed"; event.settledAt ??= new Date().toISOString();
  if (!prep && preview) {
    preview.payouts.filter((payout) => payout.amount > 0).forEach((payout) => addLedger(state, actorId, payout.teamId, payout.amount, "game-payout", `${state.games[event.gameId].name}, rank ${payout.rank}`, { eventId: event.id }));
    state.bets.filter((b) => b.eventId === event.id && b.status === "open").forEach((bet) => {
      bet.payout = selectionWon(event, bet.selectionId) ? Math.round(bet.stake * bet.decimalOdds) : 0;
      bet.status = bet.payout ? "won" : "lost";
      if (bet.payout) addLedger(state, actorId, bet.teamId, bet.payout, "bet-win", "Winning wager", { eventId: event.id, betId: bet.id });
    });
    event.settlementLedgerIds = state.ledger.slice(0, state.ledger.length - ledgerCount).map((entry) => entry.id);
    event.settlements = [...(event.settlements ?? []), { id: id("settlement"), ...preview, committedAt: new Date().toISOString() }];
  }
  if (state.gameNight && activeEventIds(state).includes(event.id)) { setActiveEvents(state.gameNight, activeEventIds(state).filter((id) => id !== event.id)); state.gameNight.lastSettledEventId = event.id; }
}
function reverseSettlement(state: AppState, event: ScheduledEvent, actorId: PlayerId, reason: string) {
  const reversed = new Set(state.ledger.map((e) => e.reversesEntryId).filter(Boolean));
  const ids = event.settlementLedgerIds;
  requireThat(ids?.length, "This legacy result lacks a complete settlement audit and cannot be reversed automatically.");
  const entries = state.ledger.filter((e) => ids.includes(e.id) && e.eventId === event.id && ["game-payout", "bet-win"].includes(e.type) && !reversed.has(e.id));
  requireThat(entries.length === ids.length, "This result's settlement audit is incomplete; automatic reversal is blocked.");
  entries.forEach((entry) => addLedger(state, actorId, entry.teamId, -entry.amount, "reversal", reason, { eventId: event.id, betId: entry.betId, reversesEntryId: entry.id }));
  state.bets.filter((b) => b.eventId === event.id && (b.status === "won" || b.status === "lost")).forEach((b) => { b.status = "open"; b.payout = 0; });
}
function createEvent(state: AppState, payload: Matchup, actorId: PlayerId, seconds?: number, mode: EventMode = "derby") {
  const night = activeNight(state);
  requireThat(state.games[payload.gameId], "Game is not in the game pool.", 400, "INVALID_GAME");
  const configuredPurse = state.games[payload.gameId].payout;
  requireThat(payload.housePurse === undefined || payload.housePurse === configuredPurse, "Round purse is configured by the game's economy settings.", 400, "INVALID_PURSE");
  if (seconds !== undefined) oneMarket(state);
  requireThat(mode === "prep" ? state.gameNight?.mode === "prep" : state.gameNight?.mode === "live", mode === "prep" ? "Prep mode is not enabled." : "Live Night has not started yet.");
  const now = new Date().toISOString();
  const event: ScheduledEvent = {
    id: id("evt"), gameId: payload.gameId, name: payload.name ?? state.games[payload.gameId].name, eventType: payload.eventType ?? (payload.format === "free-for-all" ? "FFA" : "HEAD_TO_HEAD"), housePurse: configuredPurse, format: payload.format, teamIds: payload.teamIds, playerIds: payload.playerIds,
    participants: { playerIds: payload.playerIds, teamIds: payload.teamIds }, bracketSize: payload.bracketSize, hasConsolationMatch: payload.hasConsolationMatch,
    scheduledAt: now, createdAt: now, createdBy: actorId, gameNightId: night.id,
    status: mode === "prep" ? "in-progress" : "betting", mode, ratingWeight: mode === "prep" ? PREP_RATING_WEIGHT : 1, odds: {},
  };
  if (seconds !== undefined) openMarket(state, event, seconds);
  state.events.unshift(event); night.eventIds.push(event.id);
  if (seconds !== undefined || mode === "prep") { setActiveEvents(night, [...activeEventIds(state), event.id]); night.lastSettledEventId = undefined; }
}
function openMarket(state: AppState, event: ScheduledEvent, seconds: number, reopened = false) {
  event.status = "betting"; event.bettingReopened = reopened;
  event.bettingClosesAt = new Date(Date.now() + seconds * 1000).toISOString();
  if (event.purse === undefined) {
    event.purse = event.housePurse ?? state.settings.payouts[event.gameId]; event.rules = structuredClone(state.settings);
    event.odds = generateOdds(state, event.gameId, event.format, event.format === "teams" ? event.teamIds! : event.playerIds!);
  }
}

export function applyAction(current: AppState, unchecked: Action, actorId: PlayerId): AppState {
  const action = parseAction(unchecked, Object.keys(current.games));
  requireThat(PLAYER_IDS.includes(actorId), "Sign in to continue.", 401, "UNAUTHENTICATED");
  const commissionerActions = ["START_GAME_NIGHT", "END_GAME_NIGHT", "START_ECONOMY_SEASON", "RESET_SEASON", "SET_GAME_NIGHT_MODE", "REOPEN_EVENT", "CORRECT_RESULT", "CANCEL_EVENT", "PAUSE_BETTING", "UPDATE_SETTINGS", "UPDATE_TEAM_NAMES", "ADD_GAME", "UPDATE_GAME", "ADJUST_BALANCE", "RESET"];
  if (commissionerActions.includes(action.type)) requireThat(actorId === "jimmy", "Only Jimmy can perform this action.", 403, "FORBIDDEN");
  requireThat(current.gameNight?.status !== "ended" || action.type === "START_GAME_NIGHT" || action.type === "START_ECONOMY_SEASON" || action.type === "RESET_SEASON", "This night is closed and its results are frozen.");
  const state = structuredClone(current);
  switch (action.type) {
    case "RESET":
      requireThat(!state.gameNight && state.events.length === 0 && state.bets.length === 0 && state.ledger.every((e) => e.type === "opening-grant"), "Reset is disabled after activity begins.");
      return createInitialState();
    case "RESET_SEASON": {
      requireThat(!state.gameNight || state.gameNight.status === "ended", "Close the active game night before resetting the league for a new season.");
      requireThat(state.events.every((event) => ["completed", "cancelled"].includes(event.status)), "Close or void every prior round before resetting the season.");
      requireThat(state.bets.every((bet) => bet.status !== "open"), "Resolve every prior ticket before resetting the season.");
      const seasonId = action.seasonId?.trim() || id("season");
      const startedAt = new Date().toISOString();
      const fresh = createInitialState();
      fresh.currentPlayerId = actorId;
      fresh.teams = structuredClone(state.teams);
      fresh.players = structuredClone(state.players);
      fresh.games = structuredClone(state.games);
      fresh.settings = { ...structuredClone(state.settings), startingBankroll: 200_000, payouts: Object.fromEntries(Object.entries(state.games).map(([gameId, game]) => [gameId, game.payout])) };
      fresh.gameNightArchives = [];
      fresh.ledger = TEAM_IDS.map((teamId) => ({ id: `opening-${seasonId}-${teamId}`, teamId, amount: 200_000, type: "opening-grant" as const, description: "Opening bankroll for new season", createdAt: startedAt, actorId, seasonId, reason: action.reason }));
      fresh.economySeasons = [{ id: seasonId, startedAt, actorId, reason: action.reason, priorBalances: structuredClone(state.balances), newBalances: structuredClone(fresh.balances), ledgerEntryIds: fresh.ledger.map((entry) => entry.id) }];
      return fresh;
    }
    case "START_ECONOMY_SEASON": {
      requireThat(!state.gameNight || state.gameNight.status === "ended", "End the active game night before starting a new economy season.");
      requireThat(state.events.every((event) => ["completed", "cancelled"].includes(event.status)), "Close or void every prior round before starting a new economy season.");
      requireThat(state.bets.every((bet) => bet.status !== "open"), "Resolve every prior ticket before starting a new economy season.");
      const seasonId = action.seasonId?.trim() || id("season");
      requireThat(!(state.economySeasons ?? []).some((season) => season.id === seasonId), "That economy season already exists.", 409, "SEASON_EXISTS");
      const target = 200_000;
      const priorBalances = structuredClone(state.balances);
      const newBalances = structuredClone(state.balances);
      const ledgerEntryIds: string[] = [];
      TEAM_IDS.forEach((teamId) => {
        const priorBalance = state.balances[teamId];
        const ledgerEntryId = addLedger(state, actorId, teamId, target - priorBalance, "admin-adjustment", `Economy season ${seasonId}: ${action.reason}`, { seasonId, priorBalance, newBalance: target, reason: action.reason });
        ledgerEntryIds.push(ledgerEntryId);
        newBalances[teamId] = target;
        state.bankAdjustments.unshift({ id: id("adjustment"), teamId, amount: target - priorBalance, note: `Economy season ${seasonId}: ${action.reason}`, actorId, createdAt: new Date().toISOString(), ledgerEntryId });
      });
      state.settings.startingBankroll = target;
      state.economySeasons = [{ id: seasonId, startedAt: new Date().toISOString(), actorId, reason: action.reason, priorBalances, newBalances, ledgerEntryIds }, ...(state.economySeasons ?? [])];
      break;
    }
    case "START_GAME_NIGHT": {
      requireThat(state.gameNight?.status !== "active", "A game night is already active.");
      if (state.gameNight) state.gameNightArchives = [...(state.gameNightArchives ?? []), structuredClone(state.gameNight)];
      state.gameNight = { id: id("night"), status: "active", mode: "live", startedAt: new Date().toISOString(), eventIds: [], startingBalances: structuredClone(state.balances) };
      // Adopt pre-session legacy drafts so closeout cannot strand them.
      state.events.filter((e) => !e.gameNightId && !["completed", "cancelled"].includes(e.status)).forEach((e) => { e.gameNightId = state.gameNight!.id; state.gameNight!.eventIds.push(e.id); });
      state.bettingPaused = false; break;
    }
    case "SET_GAME_NIGHT_MODE": {
      const night = activeNight(state);
      const currentMode = night.mode ?? "live";
      requireThat(currentMode !== action.mode, "Game Night is already in that mode.");
      if (action.mode === "prep") {
        requireThat(currentMode === "live" && activeEventIds(state).length === 0 && state.events.every((event) => event.gameNightId !== night.id) && state.bets.every((bet) => bet.status !== "open"), "Prep mode can only be enabled before live play begins.");
      } else {
        requireThat(currentMode === "prep" && activeEventIds(state).length === 0, "Finish the current prep game before starting Live Night.");
      }
      night.mode = action.mode;
      break;
    }
    case "END_GAME_NIGHT": {
      const night = activeNight(state);
      requireThat(!state.events.some((e) => !["completed", "cancelled"].includes(e.status)) && !state.bets.some((b) => b.status === "open"), "Finish or void every unfinished round and ticket before closeout.");
      night.status = "ended"; night.endedAt = new Date().toISOString(); setActiveEvents(night, []);
      night.finalSnapshot = { balances: structuredClone(state.balances), startingBalances: structuredClone(night.startingBalances ?? state.balances), settings: structuredClone(state.settings), events: structuredClone(state.events.filter((e) => e.gameNightId === night.id)), bets: structuredClone(state.bets.filter((b) => night.eventIds.includes(b.eventId))), ledger: structuredClone(state.ledger) };
      state.bettingPaused = true; break;
    }
    case "CREATE_LIVE_EVENT": createEvent(state, action.payload, actorId, action.payload.bettingSeconds); break;
    case "CREATE_PREP_EVENT": createEvent(state, action.payload, actorId, undefined, "prep"); break;
    case "RUN_IT_BACK": {
      const previous = eventFor(state, action.eventId); requireThat(previous.status === "completed", "Only a completed round can be replayed.");
      createEvent(state, previous, actorId, action.bettingSeconds); break;
    }
    case "START_MATCH": {
      activeNight(state); const event = eventFor(state, action.eventId); requireThat(event.status === "betting", "Only a round in betting can start.");
      oneMarket(state, event.id); event.status = "in-progress"; event.startedAt = new Date().toISOString(); event.bettingReopened = false; break;
    }
    case "REOPEN_EVENT": {
      const night = activeNight(state); const event = eventFor(state, action.eventId);
      requireThat(event.status === "betting", "Betting can only reopen before play begins.");
      requireThat(!isBettingOpen(event), "Only an expired betting market can be reopened.", 409, "BETTING_STILL_OPEN");
      oneMarket(state, event.id); openMarket(state, event, action.bettingSeconds ?? 60, true);
      setActiveEvents(night, [...activeEventIds(state), event.id]); night.lastSettledEventId = undefined; break;
    }
    case "PAUSE_BETTING": requireThat(Boolean(state.bettingPaused) !== action.paused, "Betting already has that pause state."); state.bettingPaused = action.paused; break;
    case "DISMISS_RECAP": requireThat(state.gameNight?.lastSettledEventId, "No recap to dismiss."); state.gameNight.lastSettledEventId = undefined; break;
    case "PLACE_BET": {
      activeNight(state); const event = eventFor(state, action.eventId);
      requireThat(!state.bettingPaused && isBettingOpen(event) && state.games[event.gameId].bettable, "Betting is closed.", 409, "BETTING_CLOSED");
      requireThat(canPlayerBet(state, event, action.selectionId, actorId), "Your team cannot place that wager.", 403, "BET_RESTRICTED");
      const rules = event.rules ?? state.settings;
      const odds = event.odds[action.selectionId]; requireThat(Object.hasOwn(event.odds, action.selectionId) && Number.isFinite(odds) && odds > 1, "Invalid wager selection.", 400, "INVALID_SELECTION");
      const teamId = state.players[actorId].teamId;
      const existing = state.bets.find((b) => b.eventId === event.id && b.teamId === teamId && b.status === "open");
      const available = state.balances[teamId] + (existing?.stake ?? 0);
      const bankrollMaximum = Math.floor((Math.max(0, available) * 0.5) / 25_000) * 25_000;
      const allowedMaximum = Math.min(rules.maximumBet, bankrollMaximum);
      requireThat(allowedMaximum >= rules.minimumBet, "Your team does not have enough available bank for another minimum ticket.", 409, "INSUFFICIENT_BANK_FOR_MINIMUM");
      requireThat(action.stake >= rules.minimumBet && action.stake <= allowedMaximum, `Stake must be between ${rules.minimumBet} and ${allowedMaximum}.`, 400, "INVALID_STAKE");
      requireThat(state.balances[teamId] + (existing?.stake ?? 0) >= action.stake, "Insufficient team funds.", 409, "INSUFFICIENT_FUNDS");
      requireThat(!existing || existing.selectionId !== action.selectionId || existing.stake !== action.stake, "That ticket is already accepted.");
      if (existing) { existing.status = "replaced"; existing.payout = existing.stake; addLedger(state, actorId, teamId, existing.stake, "bet-refund", "Replaced team ticket", { eventId: event.id, betId: existing.id }); }
      const betId = id("bet");
      state.bets.unshift({ id: betId, eventId: event.id, teamId, placedBy: actorId, selectionId: action.selectionId, stake: action.stake, decimalOdds: odds, status: "open", payout: 0, placedAt: new Date().toISOString() });
      addLedger(state, actorId, teamId, -action.stake, "bet-stake", "Team wager", { eventId: event.id, betId }); break;
    }
    case "SETTLE_EVENT": case "SETTLE_TEAM_EVENT": case "SETTLE_FFA_EVENT": {
      activeNight(state); const event = eventFor(state, action.eventId); requireThat(event.status === "in-progress", "Start the match before reporting its result.");
      settle(state, event, action.type === "SETTLE_EVENT" ? action.result : action.type === "SETTLE_TEAM_EVENT" ? { winningTeamId: action.winningTeamId } : { orderedPlayerIds: action.orderedPlayerIds }, actorId); break;
    }
    case "CORRECT_RESULT": {
      activeNight(state); const event = eventFor(state, action.eventId); requireThat(event.status === "completed" && event.result, "Only completed rounds can be corrected.");
      validateResult(event, action.result); requireThat(JSON.stringify(event.result) !== JSON.stringify(action.result), "The corrected result is unchanged.");
      event.corrections = [...(event.corrections ?? []), { at: new Date().toISOString(), actorId, reason: action.reason, previousResult: structuredClone(event.result), result: structuredClone(action.result) }];
      if (event.mode !== "prep") reverseSettlement(state, event, actorId, action.reason);
      settle(state, event, action.result, actorId); break;
    }
    case "CANCEL_EVENT": {
      activeNight(state); const event = eventFor(state, action.eventId); requireThat(event.status !== "cancelled", "Round is already void.");
      if (event.status === "completed" && event.mode !== "prep") {
        requireThat(action.reason?.trim(), "A reason is required to void a completed result.", 400, "INVALID_ACTION");
        event.corrections = [...(event.corrections ?? []), { at: new Date().toISOString(), actorId, reason: action.reason!, previousResult: structuredClone(event.result!) }];
        reverseSettlement(state, event, actorId, action.reason!);
      }
      event.status = "cancelled";
      state.bets.filter((b) => b.eventId === event.id && b.status === "open").forEach((bet) => {
        addLedger(state, actorId, bet.teamId, bet.stake, "bet-refund", action.reason ?? "Voided round", { eventId: event.id, betId: bet.id }); bet.status = "refunded"; bet.payout = bet.stake;
      });
      if (state.gameNight && activeEventIds(state).includes(event.id)) setActiveEvents(state.gameNight, activeEventIds(state).filter((id) => id !== event.id));
      if (state.gameNight?.lastSettledEventId === event.id) state.gameNight.lastSettledEventId = undefined;
      break;
    }
    case "UPDATE_SETTINGS":
      requireThat(action.settings.startingBankroll === state.settings.startingBankroll, "Opening bankroll is fixed. Use a documented bank adjustment instead.");
      requireThat(Object.keys(state.games).every((gameId) => action.settings.payouts[gameId] === state.settings.payouts[gameId]), "Use the game economy editor for purse changes so duration calibration and reasons are recorded.", 400, "USE_GAME_ECONOMY_EDITOR");
      requireThat(JSON.stringify(action.settings) !== JSON.stringify(state.settings), "Settings are unchanged.");
      state.settings = structuredClone(action.settings); break;
    case "UPDATE_TEAM_NAMES":
      requireThat(TEAM_IDS.some((teamId) => state.teams[teamId].name !== action.teamNames[teamId]), "Team names are unchanged.");
      TEAM_IDS.forEach((teamId) => { state.teams[teamId].name = action.teamNames[teamId]; });
      break;
    case "ADD_GAME": {
      requireThat(!state.games[action.payload.id], "A game with that ID already exists.", 409, "GAME_EXISTS");
      const calculated = basePurse(action.payload.expectedMinutes);
      const configured = action.payload.overridePurse ?? calculated;
      const game = { id: action.payload.id, name: action.payload.name, shortName: action.payload.shortName, standardContest: action.payload.standardContest, expectedMinutes: action.payload.expectedMinutes, basePurse: calculated, payout: configured, bettable: action.payload.bettable, ...(action.payload.overridePurse !== undefined ? { purseOverride: { amount: action.payload.overridePurse, reason: action.payload.overrideReason! } } : {}) };
      state.games[game.id] = game;
      state.settings.payouts[game.id] = game.payout;
      break;
    }
    case "UPDATE_GAME": {
      const currentGame = state.games[action.payload.id];
      requireThat(currentGame, "Game was not found.", 404, "NOT_FOUND");
      const calculated = basePurse(action.payload.expectedMinutes);
      const configured = action.payload.overridePurse ?? calculated;
      state.games[action.payload.id] = { ...currentGame, id: action.payload.id, name: action.payload.name, shortName: action.payload.shortName, standardContest: action.payload.standardContest, expectedMinutes: action.payload.expectedMinutes, basePurse: calculated, payout: configured, bettable: action.payload.bettable, needsDurationCalibration: false, ...(action.payload.overridePurse !== undefined ? { purseOverride: { amount: action.payload.overridePurse, reason: action.payload.overrideReason! } } : { purseOverride: undefined }) };
      state.settings.payouts[action.payload.id] = configured;
      break;
    }
    case "ADJUST_BALANCE": {
      const createdAt = new Date().toISOString();
      const ledgerEntryId = addLedger(state, actorId, action.teamId, action.amount, "admin-adjustment", action.note);
      state.bankAdjustments.unshift({ id: id("adjustment"), teamId: action.teamId, amount: action.amount, note: action.note, actorId, createdAt, ledgerEntryId });
      break;
    }
  }
  return state;
}

/** Test/local adapter only; the server must pass its authenticated actor to applyAction. */
export function reducer(state: AppState, action: Action) { return applyAction(state, action, state.currentPlayerId); }
