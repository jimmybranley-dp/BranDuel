import type { AppState, Game, GameId, Player, PlayerId, ScheduledEvent, Team, TeamId } from "./types";

export const PLAYER_IDS: PlayerId[] = ["jason", "ezra", "corey", "jimmy", "brandon", "andrew", "bruce", "ryan"];
export const TEAM_IDS: TeamId[] = ["jason-ezra", "corey-jimmy", "brandon-andrew", "bruce-ryan"];
export const GAME_IDS: GameId[] = ["smash", "boomerang", "worms", "mario-party", "mario-kart", "nfl-blitz", "billiards"];

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
  smash: { id: "smash", name: "Super Smash Bros.", shortName: "Smash", payout: 1_500_000, bettable: true },
  boomerang: { id: "boomerang", name: "Boomerang Fu", shortName: "Boomerang", payout: 1_250_000, bettable: true },
  worms: { id: "worms", name: "Worms", shortName: "Worms", payout: 1_750_000, bettable: true },
  "mario-party": { id: "mario-party", name: "Mario Party", shortName: "Mario Party", payout: 3_000_000, bettable: false },
  "mario-kart": { id: "mario-kart", name: "Mario Kart", shortName: "Mario Kart", payout: 1_500_000, bettable: true },
  "nfl-blitz": { id: "nfl-blitz", name: "NFL Blitz", shortName: "NFL Blitz", payout: 1_750_000, bettable: true },
  billiards: { id: "billiards", name: "Billiards", shortName: "Billiards", payout: 1_250_000, bettable: true },
};

function offsetIso(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export function sampleEvents(): ScheduledEvent[] {
  return [
    {
      id: "evt-smash-opener",
      gameId: "smash",
      format: "teams",
      scheduledAt: offsetIso(30),
      status: "scheduled",
      teamIds: ["jason-ezra", "corey-jimmy"],
      odds: { "jason-ezra": 1.91, "corey-jimmy": 1.91 },
      createdBy: "jimmy",
      createdAt: new Date().toISOString(),
    },
    {
      id: "evt-boomerang-ffa",
      gameId: "boomerang",
      format: "free-for-all",
      scheduledAt: offsetIso(54),
      status: "scheduled",
      playerIds: ["ezra", "corey", "andrew", "ryan"],
      odds: { ezra: 3.81, corey: 3.81, andrew: 3.81, ryan: 3.81 },
      createdBy: "jimmy",
      createdAt: new Date().toISOString(),
    },
    {
      id: "evt-worms-night",
      gameId: "worms",
      format: "teams",
      scheduledAt: offsetIso(78),
      status: "scheduled",
      teamIds: ["brandon-andrew", "bruce-ryan"],
      odds: { "brandon-andrew": 1.91, "bruce-ryan": 1.91 },
      createdBy: "brandon",
      createdAt: new Date().toISOString(),
    },
  ];
}

export function createInitialState(): AppState {
  const startingBankroll = 10_000_000;
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
        smash: 1_500_000,
        boomerang: 1_250_000,
        worms: 1_750_000,
        "mario-party": 3_000_000,
        "mario-kart": 1_500_000,
        "nfl-blitz": 1_750_000,
        billiards: 1_250_000,
      },
    },
  };
}

export function normalizeState(value: AppState): AppState {
  const initial = createInitialState();
  return {
    ...initial,
    ...value,
    teams: { ...initial.teams, ...value.teams },
    players: { ...initial.players, ...value.players },
    games: { ...initial.games, ...value.games },
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
      activeEventIds: value.gameNight.activeEventIds ?? (value.gameNight.activeEventId ? [value.gameNight.activeEventId] : []),
    } : undefined,
  };
}
