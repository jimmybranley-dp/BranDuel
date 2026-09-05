export type GameId = "smash" | "boomerang" | "worms" | "mario-party";
export type PlayerId = "jason" | "ezra" | "corey" | "jimmy" | "brandon" | "andrew" | "bruce" | "ryan";
export type TeamId = "jason-ezra" | "corey-jimmy" | "brandon-andrew" | "bruce-ryan";

export type EventStatus = "scheduled" | "betting" | "in-progress" | "completed" | "cancelled";
export type EventFormat = "teams" | "free-for-all";

export interface Player {
  id: PlayerId;
  name: string;
  teamId: TeamId;
}

export interface Team {
  id: TeamId;
  name: string;
  playerIds: [PlayerId, PlayerId];
}

export interface Game {
  id: GameId;
  name: string;
  shortName: string;
  payout: number;
  bettable: boolean;
}

export interface MatchResult {
  orderedPlayerIds?: PlayerId[];
  winningTeamId?: TeamId;
}

export interface ScheduledEvent {
  id: string;
  gameId: GameId;
  format: EventFormat;
  scheduledAt: string;
  status: EventStatus;
  teamIds?: [TeamId, TeamId];
  playerIds?: PlayerId[];
  odds: Record<string, number>;
  result?: MatchResult;
  createdBy: PlayerId;
  createdAt: string;
  bettingReopened?: boolean;
  bettingClosesAt?: string;
  gameNightId?: string;
}

export interface Bet {
  id: string;
  eventId: string;
  teamId: TeamId;
  placedBy: PlayerId;
  selectionId: string;
  stake: number;
  decimalOdds: number;
  status: "open" | "won" | "lost" | "refunded" | "replaced";
  payout: number;
  placedAt: string;
}

export interface LedgerEntry {
  id: string;
  teamId: TeamId;
  amount: number;
  type: "game-payout" | "bet-stake" | "bet-win" | "bet-refund" | "admin-adjustment";
  description: string;
  createdAt: string;
}

export interface AppSettings {
  startingBankroll: number;
  minimumBet: number;
  maximumBet: number;
  houseEdge: number;
  payouts: Record<GameId, number>;
}

export interface GameNight {
  id: string;
  status: "active" | "ended";
  startedAt: string;
  endedAt?: string;
  eventIds: string[];
  activeEventId?: string;
  lastSettledEventId?: string;
}

export interface AppState {
  currentPlayerId: PlayerId;
  teams: Record<TeamId, Team>;
  players: Record<PlayerId, Player>;
  games: Record<GameId, Game>;
  balances: Record<TeamId, number>;
  events: ScheduledEvent[];
  bets: Bet[];
  ledger: LedgerEntry[];
  settings: AppSettings;
  gameNight?: GameNight;
}
