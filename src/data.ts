import type { AppState, Game, GameId, Player, PlayerId, ScheduledEvent, Team, TeamId } from "./types";

export const PLAYER_IDS: PlayerId[] = ["jason", "ezra", "corey", "jimmy", "brandon", "andrew", "bruce", "ryan"];
export const TEAM_IDS: TeamId[] = ["jason-ezra", "corey-jimmy", "brandon-andrew", "bruce-ryan"];
export const GAME_IDS: GameId[] = ["smash", "boomerang", "worms", "mario-party"];

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
  smash: { id: "smash", name: "Super Smash Bros.", shortName: "Smash", payout: 500_000, bettable: true },
  boomerang: { id: "boomerang", name: "Boomerang Fu", shortName: "Boomerang", payout: 250_000, bettable: true },
  worms: { id: "worms", name: "Worms", shortName: "Worms", payout: 250_000, bettable: true },
  "mario-party": { id: "mario-party", name: "Mario Party", shortName: "Mario Party", payout: 100_000, bettable: false },
};

function offsetIso(hours: number) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function sampleEvents(): ScheduledEvent[] {
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
    teams,
    players,
    games,
    balances: {
      "jason-ezra": startingBankroll,
      "corey-jimmy": startingBankroll,
      "brandon-andrew": startingBankroll,
      "bruce-ryan": startingBankroll,
    },
    events: sampleEvents(),
    bets: [],
    ledger: [],
    settings: {
      startingBankroll,
      minimumBet: 25_000,
      maximumBet: 500_000,
      houseEdge: 0.05,
      payouts: {
        smash: 500_000,
        boomerang: 250_000,
        worms: 250_000,
        "mario-party": 100_000,
      },
    },
  };
}
