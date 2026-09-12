import { maxFreeForAllPlayers, TEAM_IDS } from "./data";
import type { AppState, EventType, MatchResult, ScheduledEvent, SettlementPayout, SettlementRecord, SettlementTeamRanking, TeamId } from "./types";

const FFA_CURVES: Record<number, number[]> = {
  2: [7500, 2500],
  3: [6500, 2500, 1000],
  4: [6000, 2500, 1000, 500],
};
const HEAD_TO_HEAD_SINGLE = [7500, 2500];
const HEAD_TO_HEAD_THREE = [6000, 2500, 1500];
const HEAD_TO_HEAD_BRACKET = [6000, 2500, 1000, 500];
const HEAD_TO_HEAD_NO_CONSOLATION = [6000, 2500, 750, 750];
const FFA_PLAYER_MULTIPLIERS: Record<number, number> = {
  2: 0.70,
  3: 0.80,
  4: 0.90,
  5: 1.00,
  6: 1.10,
  7: 1.20,
  8: 1.30,
};

export interface SettlementPreview {
  eventId: string;
  input: SettlementRecord["input"];
  teamRankings: SettlementTeamRanking[];
  payouts: SettlementPayout[];
  bankrollChanges: Record<TeamId, number>;
}

export function getFfaPlayerMultiplier(playerCount: number) {
  return FFA_PLAYER_MULTIPLIERS[playerCount];
}

function eventType(event: ScheduledEvent): EventType {
  return event.eventType ?? (event.format === "free-for-all" ? "FFA" : "HEAD_TO_HEAD");
}

function purseFor(event: ScheduledEvent, state: AppState) {
  const purse = event.housePurse ?? event.purse ?? state.settings.payouts[event.gameId];
  if (!Number.isSafeInteger(purse) || purse < 0) throw new Error("House purse must be an integer dollar amount.");
  return purse;
}

function allocate(purse: number, ranked: Array<{ teamId: TeamId; rank: number }>, percentages: number[]): SettlementPayout[] {
  const payouts = ranked.map((item, index) => ({ teamId: item.teamId, rank: item.rank, percentage: percentages[index] / 100, amount: Math.floor(purse * percentages[index] / 10000) }));
  let remainder = purse - payouts.reduce((sum, item) => sum + item.amount, 0);
  for (const payout of payouts) {
    if (remainder <= 0) break;
    payout.amount += 1;
    remainder -= 1;
  }
  return payouts;
}

function tiedPercentages(ranks: number[], curve: number[]) {
  const percentages: number[] = [];
  ranks.forEach((rank, index) => {
    if (index > 0 && ranks[index - 1] === rank) {
      percentages.push(percentages[index - 1]);
      return;
    }
    const group = ranks.filter((candidate) => candidate === rank).length;
    const start = index;
    const total = curve.slice(start, start + group).reduce((sum, value) => sum + value, 0);
    percentages.push(total / group);
  });
  return percentages;
}

function ffaPreview(event: ScheduledEvent, state: AppState, result: MatchResult, purse: number) {
  const players = result.orderedPlayerIds ?? [];
  const playerCountMultiplier = getFfaPlayerMultiplier(players.length);
  if (playerCountMultiplier === undefined || players.length > maxFreeForAllPlayers(event.gameId)) throw new Error("This FFA requires two to eight players for its game type.");
  const totals = new Map<TeamId, { numerator: number; count: number }>();
  players.forEach((playerId, index) => {
    const teamId = state.players[playerId].teamId;
    const current = totals.get(teamId) ?? { numerator: 0, count: 0 };
    current.numerator += players.length - (index + 1);
    current.count += 1;
    totals.set(teamId, current);
  });
  const ordered = [...totals.entries()].sort(([a, left], [b, right]) => {
    const comparison = right.numerator * left.count - left.numerator * right.count;
    return comparison || a.localeCompare(b);
  });
  const rankings: SettlementTeamRanking[] = [];
  let rank = 1;
  ordered.forEach(([teamId, score]) => {
    const previous = rankings[rankings.length - 1];
    const teamScore = score.numerator / score.count / Math.max(1, players.length - 1);
    const tied = previous && previous.score === teamScore;
    rankings.push({ teamId, rank: tied ? previous.rank : rank, score: teamScore });
    rank += 1;
  });
  // Two FFA players can belong to the same team. The frozen purse must still be fully
  // distributed even though there is only one represented team after aggregation.
  const curve = rankings.length === 1 ? [10000] : FFA_CURVES[rankings.length] ?? [];
  const percentages = curve.length ? tiedPercentages(rankings.map((item) => item.rank), curve) : [];
  const adjustedPurse = Math.round(purse * playerCountMultiplier);
  return { rankings, payouts: curve.length ? allocate(adjustedPurse, rankings, percentages) : [], playerCountMultiplier, adjustedPurse };
}

function headToHeadPreview(event: ScheduledEvent, state: AppState, result: MatchResult, purse: number) {
  const teams = event.teamIds ?? event.participants?.teamIds ?? [];
  const ordered = result.orderedTeamIds ?? (result.winningTeamId ? [result.winningTeamId, ...teams.filter((teamId) => teamId !== result.winningTeamId)] : []);
  const bracket = (event.bracketSize ?? teams.length) > 2;
  if (!bracket && ordered.length !== 2) throw new Error("A single head-to-head event requires two ranked teams.");
  if (bracket && (ordered.length < 3 || ordered.length > 4)) throw new Error("A fixed-team event requires three or four ranked teams.");
  if (ordered.length === 3) return { rankings: ordered.map((teamId, index) => ({ teamId, rank: index + 1 })), payouts: allocate(purse, ordered.map((teamId, index) => ({ teamId, rank: index + 1 })), HEAD_TO_HEAD_THREE), adjustedPurse: purse, playerCountMultiplier: undefined };
  const ranks = bracket && !event.hasConsolationMatch ? [1, 2, 3, 3] : ordered.map((_, index) => index + 1);
  const rankings = ordered.map((teamId, index) => ({ teamId, rank: ranks[index] }));
  const curve = bracket ? (event.hasConsolationMatch ? HEAD_TO_HEAD_BRACKET : HEAD_TO_HEAD_NO_CONSOLATION) : HEAD_TO_HEAD_SINGLE;
  return { rankings, payouts: allocate(purse, rankings, curve), adjustedPurse: purse, playerCountMultiplier: undefined };
}

export function buildSettlementPreview(event: ScheduledEvent, state: AppState, result: MatchResult): SettlementPreview {
  const type = eventType(event);
  const baseHousePurse = purseFor(event, state);
  const participants = event.participants ?? { playerIds: event.playerIds, teamIds: event.teamIds };
  const calculated = type === "FFA" ? ffaPreview(event, state, result, baseHousePurse) : headToHeadPreview(event, state, result, baseHousePurse);
  const adjustedHousePurse = type === "FFA" ? calculated.adjustedPurse : baseHousePurse;
  const bankrollChanges = Object.fromEntries(TEAM_IDS.map((teamId) => [teamId, calculated.payouts.find((payout) => payout.teamId === teamId)?.amount ?? 0])) as Record<TeamId, number>;
  return {
    eventId: event.id,
    input: { eventType: type, housePurse: baseHousePurse, baseHousePurse, adjustedHousePurse, ...(type === "FFA" ? { playerCountMultiplier: calculated.playerCountMultiplier } : {}), participants, result: structuredClone(result), bracketSize: event.bracketSize, hasConsolationMatch: event.hasConsolationMatch },
    teamRankings: calculated.rankings,
    payouts: calculated.payouts,
    bankrollChanges,
  };
}
