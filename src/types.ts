/** Built-in IDs are exported from data.ts; custom game IDs are also supported. */
export type GameId = string;
export type PlayerId = "jason" | "ezra" | "corey" | "jimmy" | "brandon" | "andrew" | "bruce" | "ryan";
export type TeamId = "jason-ezra" | "corey-jimmy" | "brandon-andrew" | "bruce-ryan";

/** `scheduled` is retained only so legacy snapshots can be safely voided; new commands never create it. */
export type EventStatus = "scheduled" | "betting" | "in-progress" | "completed" | "cancelled";
export type EventFormat = "teams" | "free-for-all";
export type EventType = "FFA" | "HEAD_TO_HEAD";
export type EventMode = "derby" | "prep";
export type GameNightMode = "prep" | "live";

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
  /** Standard contest wording shown to players and commissioners. */
  standardContest?: string;
  /** Expected wall-clock duration for newly configured contests. */
  expectedMinutes?: number;
  /** Duration-calibrated purse before an optional commissioner override. */
  basePurse?: number;
  /** Historical custom games without duration metadata need explicit calibration. */
  needsDurationCalibration?: boolean;
  purseOverride?: { amount: number; reason: string };
  payout: number;
  bettable: boolean;
}

export interface MatchResult {
  orderedPlayerIds?: PlayerId[];
  winningTeamId?: TeamId;
  orderedTeamIds?: TeamId[];
}

export interface SettlementTeamRanking {
  teamId: TeamId;
  rank: number;
  score?: number;
}

export interface SettlementPayout {
  teamId: TeamId;
  rank: number;
  percentage: number;
  amount: number;
}

export interface SettlementRecord {
  id: string;
  eventId: string;
  committedAt: string;
  input: {
    eventType: EventType;
    housePurse: number;
    baseHousePurse: number;
    adjustedHousePurse: number;
    playerCountMultiplier?: number;
    participants: { playerIds?: PlayerId[]; teamIds?: TeamId[] };
    result: MatchResult;
    bracketSize?: 2 | 3 | 4;
    hasConsolationMatch?: boolean;
  };
  teamRankings: SettlementTeamRanking[];
  payouts: SettlementPayout[];
  bankrollChanges: Record<TeamId, number>;
}

export interface ScheduledEvent {
  id: string;
  gameId: GameId;
  name?: string;
  eventType?: EventType;
  housePurse?: number;
  format: EventFormat;
  /** Historical event timestamp used for ordering; calendar scheduling is not supported. */
  scheduledAt: string;
  status: EventStatus;
  mode?: EventMode;
  ratingWeight?: number;
  teamIds?: TeamId[];
  playerIds?: PlayerId[];
  participants?: { playerIds?: PlayerId[]; teamIds?: TeamId[] };
  bracketSize?: 2 | 3 | 4;
  hasConsolationMatch?: boolean;
  odds: Record<string, number>;
  result?: MatchResult;
  createdBy: PlayerId;
  createdAt: string;
  /** Set by the server when START_MATCH is accepted. */
  startedAt?: string;
  bettingReopened?: boolean;
  bettingClosesAt?: string;
  gameNightId?: string;
  purse?: number;
  rules?: AppSettings;
  settledAt?: string;
  settlementLedgerIds?: string[];
  settlements?: SettlementRecord[];
  corrections?: Array<{ at: string; actorId: PlayerId; reason: string; previousResult: MatchResult; result?: MatchResult }>;
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
  type: "opening-grant" | "game-payout" | "bet-stake" | "bet-win" | "bet-refund" | "admin-adjustment" | "reversal";
  description: string;
  createdAt: string;
  eventId?: string;
  betId?: string;
  actorId?: PlayerId;
  reversesEntryId?: string;
  seasonId?: string;
  priorBalance?: number;
  newBalance?: number;
  reason?: string;
}

export interface BankAdjustment {
  id: string;
  teamId: TeamId;
  amount: number;
  note: string;
  actorId: PlayerId;
  createdAt: string;
  ledgerEntryId: string;
}

export interface AppSettings {
  startingBankroll: number;
  minimumBet: number;
  maximumBet: number;
  houseEdge: number;
  payouts: Record<GameId, number>;
}

export interface EconomySeason {
  id: string;
  startedAt: string;
  actorId: PlayerId;
  reason: string;
  priorBalances: Record<TeamId, number>;
  newBalances: Record<TeamId, number>;
  ledgerEntryIds: string[];
}

export interface GameNight {
  id: string;
  status: "active" | "ended";
  mode?: GameNightMode;
  startedAt: string;
  endedAt?: string;
  eventIds: string[];
  /** Active event IDs. Older persisted state may only have activeEventId. */
  activeEventIds?: string[];
  activeEventId?: string;
  lastSettledEventId?: string;
  startingBalances?: Record<TeamId, number>;
  finalSnapshot?: {
    balances: Record<TeamId, number>;
    startingBalances: Record<TeamId, number>;
    settings: AppSettings;
    events: ScheduledEvent[];
    bets: Bet[];
    ledger: LedgerEntry[];
  };
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
  bankAdjustments: BankAdjustment[];
  settings: AppSettings;
  gameNight?: GameNight;
  gameNightArchives?: GameNight[];
  economySeasons?: EconomySeason[];
  bettingPaused?: boolean;
}
