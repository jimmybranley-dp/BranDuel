import type { AppState, Game, GameId, Player, PlayerId, Team, TeamId } from "./types";

export const PLAYER_IDS: PlayerId[] = ["jason", "ezra", "corey", "jimmy", "brandon", "andrew", "bruce", "ryan"];
export const TEAM_IDS: TeamId[] = ["jason-ezra", "corey-jimmy", "brandon-andrew", "bruce-ryan"];
export const GAME_IDS: GameId[] = ["smash", "boomerang", "worms", "mario-party", "mario-kart", "nfl-blitz", "billiards", "golden-tee", "mortal-kombat"];
export const PREP_RATING_WEIGHT = 1;
export const PREP_RATING_COPY = "Prep results seed live Heat at full weight while having no betting, purse, bankroll, or ledger effect.";

export const PURSE_INCREMENT = 25_000;
export const MIN_BASE_PURSE = 150_000;
export const MAX_BASE_PURSE = 1_000_000;

/**
 * Duration-calibrated purse. Math.round is intentionally used for nearest-unit
 * rounding; an exact half step rounds upward. The result is always a safe,
 * whole fictional-dollar amount and is clamped after rounding.
 */
export function basePurse(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 1_000_000) {
    throw new RangeError("Expected duration must be a positive finite number of minutes.");
  }
  const raw = 400_000 * Math.sqrt(minutes / 10);
  // The tiny tolerance keeps mathematically exact half steps stable across
  // binary floating-point representation while preserving ordinary nearest rounding.
  const rounded = Math.round(raw / PURSE_INCREMENT + 1e-10) * PURSE_INCREMENT;
  if (!Number.isSafeInteger(rounded)) throw new RangeError("Calculated purse exceeds safe accounting limits.");
  return Math.min(MAX_BASE_PURSE, Math.max(MIN_BASE_PURSE, rounded));
}

export const calculateBasePurse = basePurse;

export function maxFreeForAllPlayers(gameId: GameId) {
  void gameId;
  return 8;
}

export const players: Record<PlayerId, Player> = {
  jason: { id: "jason", name: "Jason", teamId: "jason-ezra" },
  ezra: { id: "ezra", name: "Ezra", teamId: "jason-ezra" },
  corey: { id: "corey", name: "Corey", teamId: "corey-jimmy" },
  jimmy: { id: "jimmy", name: "Jimmy", teamId: "corey-jimmy" },
  brandon: { id: "brandon", name: "Brandon", teamId: "brandon-andrew" },
  andrew: { id: "andrew", name: "Andrew", teamId: "brandon-andrew" },
  bruce: { id: "bruce", name: "Bruce", teamId: "bruce-ryan" },
  ryan: { id: "ryan", name: "Ryan", teamId: "bruce-ryan" },
};

export const teams: Record<TeamId, Team> = {
  "jason-ezra": { id: "jason-ezra", name: "Jason & Ezra", playerIds: ["jason", "ezra"] },
  "corey-jimmy": { id: "corey-jimmy", name: "Corey & Jimmy", playerIds: ["corey", "jimmy"] },
  "brandon-andrew": { id: "brandon-andrew", name: "Brandon & Andrew", playerIds: ["brandon", "andrew"] },
  "bruce-ryan": { id: "bruce-ryan", name: "Bruce & Ryan", playerIds: ["bruce", "ryan"] },
};

export const games: Record<GameId, Game> = {
  smash: { id: "smash", name: "Super Smash Bros.", shortName: "Smash", standardContest: "One match", expectedMinutes: 8, basePurse: 350_000, payout: 350_000, bettable: true },
  boomerang: { id: "boomerang", name: "Boomerang Fu", shortName: "Boomerang", standardContest: "One standard match", expectedMinutes: 10, basePurse: 400_000, payout: 400_000, bettable: true },
  worms: { id: "worms", name: "Worms", shortName: "Worms", standardContest: "One quick-settings round", expectedMinutes: 20, basePurse: 575_000, payout: 575_000, bettable: true },
  "mario-party": { id: "mario-party", name: "Mario Party", shortName: "Mario Party", standardContest: "One board", expectedMinutes: 50, basePurse: 900_000, payout: 900_000, bettable: false },
  "mario-kart": { id: "mario-kart", name: "Mario Kart", shortName: "Mario Kart", standardContest: "One four-race Grand Prix", expectedMinutes: 15, basePurse: 500_000, payout: 500_000, bettable: true },
  "nfl-blitz": { id: "nfl-blitz", name: "NFL Blitz", shortName: "NFL Blitz", standardContest: "One full game", expectedMinutes: 12, basePurse: 450_000, payout: 450_000, bettable: true },
  billiards: { id: "billiards", name: "Billiards", shortName: "Billiards", standardContest: "One 8-ball rack", expectedMinutes: 12, basePurse: 450_000, payout: 450_000, bettable: true },
  "golden-tee": { id: "golden-tee", name: "Golden Tee", shortName: "Golden Tee", standardContest: "Four-player nine-hole stroke play", expectedMinutes: 35, basePurse: 750_000, payout: 750_000, bettable: true },
  "mortal-kombat": { id: "mortal-kombat", name: "Mortal Kombat", shortName: "Mortal Kombat", standardContest: "First to two in-game match wins", expectedMinutes: 10, basePurse: 400_000, payout: 400_000, bettable: true },
};

export function createInitialState(): AppState {
  const startingBankroll = 200_000;
  return {
    currentPlayerId: "jimmy",
    teams: structuredClone(teams),
    players: structuredClone(players),
    games: structuredClone(games),
    balances: {
      "jason-ezra": startingBankroll,
      "corey-jimmy": startingBankroll,
      "brandon-andrew": startingBankroll,
      "bruce-ryan": startingBankroll,
    },
    events: [],
    bets: [],
    ledger: TEAM_IDS.map((teamId) => ({ id: `opening-${teamId}`, teamId, amount: startingBankroll, type: "opening-grant", description: "Opening bankroll", createdAt: new Date().toISOString(), actorId: "jimmy" })),
    bankAdjustments: [],
    settings: {
      startingBankroll,
      minimumBet: 25_000,
      maximumBet: 500_000,
      houseEdge: 0.05,
      payouts: {
        smash: 350_000,
        boomerang: 400_000,
        worms: 575_000,
        "mario-party": 900_000,
        "mario-kart": 500_000,
        "nfl-blitz": 450_000,
        billiards: 450_000,
        "golden-tee": 750_000,
        "mortal-kombat": 400_000,
      },
    },
    economySeasons: [],
  };
}

function normalizeGame(game: Game, fallback?: Game): Game {
  const merged = { ...fallback, ...game };
  if (merged.basePurse === undefined && Number.isSafeInteger(merged.payout)) merged.basePurse = merged.payout;
  if (merged.expectedMinutes === undefined) merged.needsDurationCalibration = true;
  return merged;
}

export function normalizeState(value: AppState): AppState {
  const initial = createInitialState();
  const gamesById = Object.fromEntries(Object.entries(value.games ?? {}).map(([gameId, game]) => [gameId, normalizeGame(game, initial.games[gameId])]));
  return {
    ...initial,
    ...value,
    teams: { ...initial.teams, ...value.teams },
    players: { ...initial.players, ...value.players },
    games: { ...initial.games, ...gamesById },
    balances: { ...initial.balances, ...value.balances },
    settings: {
      ...initial.settings,
      ...value.settings,
      payouts: { ...initial.settings.payouts, ...value.settings?.payouts },
    },
    events: value.events ?? [],
    bets: value.bets ?? [],
    ledger: value.ledger ?? [],
    bankAdjustments: value.bankAdjustments ?? (value.ledger ?? []).filter((entry) => entry.type === "admin-adjustment").map((entry) => ({ id: entry.id, teamId: entry.teamId, amount: entry.amount, note: entry.description, actorId: entry.actorId ?? "jimmy", createdAt: entry.createdAt, ledgerEntryId: entry.id })),
    gameNight: value.gameNight ? {
      ...value.gameNight,
      activeEventIds: [...new Set(value.gameNight.activeEventIds ?? (value.gameNight.activeEventId ? [value.gameNight.activeEventId] : []))],
    } : undefined,
    economySeasons: value.economySeasons ?? [],
  };
}

export function observedDurationsMinutes(state: AppState, gameId: GameId): number[] {
  return state.events
    .filter((event) => event.gameId === gameId && event.status === "completed" && event.startedAt && event.settledAt)
    .map((event) => (new Date(event.settledAt!).getTime() - new Date(event.startedAt!).getTime()) / 60_000)
    .filter((minutes) => Number.isFinite(minutes) && minutes > 0)
    .sort((a, b) => a - b);
}

export function medianObservedMinutes(state: AppState, gameId: GameId): number | undefined {
  const samples = observedDurationsMinutes(state, gameId);
  if (samples.length < 3) return undefined;
  const middle = Math.floor(samples.length / 2);
  return samples.length % 2 ? samples[middle] : (samples[middle - 1] + samples[middle]) / 2;
}
