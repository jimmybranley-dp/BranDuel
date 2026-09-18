import { PLAYER_IDS } from "./data";
import type { AppState, EventFormat, EventMode, GameId, PlayerId, ScheduledEvent, TeamId } from "./types";

export interface PlayerRecord {
  playerId: PlayerId;
  wins: number;
  losses: number;
  rating: number;
}

const K_FACTOR = 28;

/** Calibration constants for the entertainment-oriented current-night line. */
export const HEAT_CONFIG = {
  nightFormWeight: 0.65,
  gameFormWeight: 0.35,
  recencyWeights: [1, 0.65, 0.4, 0.25] as const,
  exponentialSensitivity: 0.31,
  twoWayMinimum: 0.28,
  twoWayMaximum: 0.72,
  multiwayMinimumFactor: 0.5,
  multiwayMaximumFactor: 2.2,
  multiwayMaximum: 0.55,
} as const;

export interface HeatAppearance {
  eventId: string;
  gameId: GameId;
  playerId: PlayerId;
  mode: EventMode | "live";
  completedAt: string;
  performance: number;
  ratingWeight: number;
}

export interface PlayerHeat {
  playerId: PlayerId;
  gameId: GameId;
  nightForm: number;
  gameForm: number;
  lineScore: number;
  nightAppearances: HeatAppearance[];
  gameAppearances: HeatAppearance[];
}

export function formatMoney(value: number, compact = false) {
  if (compact) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: value >= 1_000_000 ? 1 : 0,
      notation: "compact",
    }).format(value);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatAmericanOdds(decimalOdds: number) {
  if (decimalOdds >= 2) return `+${Math.round((decimalOdds - 1) * 100)}`;
  return `${Math.round(-100 / (decimalOdds - 1))}`;
}

export function isBettingOpen(event: ScheduledEvent, now = Date.now()) {
  return event.status === "betting" && Number.isFinite(Date.parse(event.bettingClosesAt ?? ""))
    && Date.parse(event.bettingClosesAt!) > now;
}
function expectedScore(a: number, b: number) {
  return 1 / (1 + Math.pow(10, (b - a) / 400));
}

function safeRatingWeight(value: number | undefined) {
  return value === undefined ? 1 : Number.isFinite(value) && value >= 0 ? value : 0;
}

function eventBelongsToNight(event: ScheduledEvent, state: AppState) {
  const night = state.gameNight;
  if (!night) return false;
  return event.gameNightId === night.id || (event.gameNightId === undefined && night.eventIds.includes(event.id));
}

function orderedTeamIds(event: ScheduledEvent) {
  const participants = event.teamIds ?? event.participants?.teamIds ?? [];
  if (event.result?.orderedTeamIds) return event.result.orderedTeamIds;
  if (event.result?.winningTeamId) return [event.result.winningTeamId, ...participants.filter((id) => id !== event.result?.winningTeamId)];
  return [];
}

function resultPerformances(state: AppState, event: ScheduledEvent) {
  const weight = safeRatingWeight(event.ratingWeight);
  if (event.format === "teams") {
    const ordered = orderedTeamIds(event);
    const participants = event.teamIds ?? event.participants?.teamIds ?? [];
    if (ordered.length < 2 || ordered.length > 4 || ordered.length !== participants.length || new Set(ordered).size !== ordered.length || ordered.some((id) => !participants.includes(id) || !state.teams[id])) return [];
    return ordered.flatMap((teamId, index) => {
      const performance = 1 - (2 * index) / (ordered.length - 1);
      return state.teams[teamId].playerIds.map((playerId) => ({ playerId, performance, ratingWeight: weight }));
    });
  }

  const ordered = event.result?.orderedPlayerIds ?? [];
  const participants = event.playerIds ?? event.participants?.playerIds ?? [];
  if (ordered.length < 2 || ordered.length > 8 || ordered.length !== participants.length || new Set(ordered).size !== ordered.length || ordered.some((id) => !participants.includes(id) || !state.players[id])) return [];
  return ordered.map((playerId, index) => ({ playerId, performance: 1 - (2 * index) / (ordered.length - 1), ratingWeight: weight }));
}

/** Completed current-night appearances, with prep and live sharing one sequence. */
export function getCurrentNightHeatAppearances(state: AppState): HeatAppearance[] {
  if (!state.gameNight) return [];
  return state.events
    .filter((event) => eventBelongsToNight(event, state) && event.status === "completed" && Boolean(event.result))
    .flatMap((event) => resultPerformances(state, event).map(({ playerId, performance, ratingWeight }) => ({
      eventId: event.id,
      gameId: event.gameId,
      playerId,
      mode: (event.mode === "prep" ? "prep" : "live") as EventMode | "live",
      completedAt: event.settledAt ?? event.scheduledAt ?? event.createdAt,
      performance,
      ratingWeight,
    })))
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt) || b.eventId.localeCompare(a.eventId));
}

function recentAppearances(appearances: HeatAppearance[], playerId: PlayerId, gameId?: GameId) {
  return appearances.filter((appearance) => appearance.playerId === playerId && (gameId === undefined || appearance.gameId === gameId)).slice(0, HEAT_CONFIG.recencyWeights.length);
}

function weightedForm(appearances: HeatAppearance[]) {
  return appearances.reduce((sum, appearance, index) => sum + appearance.performance * appearance.ratingWeight * HEAT_CONFIG.recencyWeights[index], 0);
}

export function getPlayerHeat(state: AppState, playerId: PlayerId, gameId: GameId): PlayerHeat {
  const appearances = getCurrentNightHeatAppearances(state);
  const nightAppearances = recentAppearances(appearances, playerId);
  const gameAppearances = recentAppearances(appearances, playerId, gameId);
  const nightForm = weightedForm(nightAppearances);
  const gameForm = weightedForm(gameAppearances);
  return { playerId, gameId, nightForm, gameForm, lineScore: HEAT_CONFIG.nightFormWeight * nightForm + HEAT_CONFIG.gameFormWeight * gameForm, nightAppearances, gameAppearances };
}

export function getCurrentNightHeat(state: AppState, gameId: GameId) {
  return Object.fromEntries(PLAYER_IDS.map((playerId) => [playerId, getPlayerHeat(state, playerId, gameId)])) as Record<PlayerId, PlayerHeat>;
}

export function getHeatLineScore(state: AppState, playerId: PlayerId, gameId: GameId) {
  return getPlayerHeat(state, playerId, gameId).lineScore;
}

export function getGameRecords(state: AppState, gameId: GameId): PlayerRecord[] {
  const table = Object.fromEntries(
    PLAYER_IDS.map((playerId) => [playerId, { playerId, wins: 0, losses: 0, rating: 1000 }]),
  ) as Record<PlayerId, PlayerRecord>;

  const completed = state.events
    .filter((event) => event.status === "completed" && event.gameId === gameId && event.result)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  for (const event of completed) {
    if (event.format === "teams" && event.teamIds && event.result?.winningTeamId) {
      const [teamAId, teamBId] = event.teamIds;
      const teamA = state.teams[teamAId];
      const teamB = state.teams[teamBId];
      const ratingA = teamA.playerIds.reduce((sum, id) => sum + table[id].rating, 0) / 2;
      const ratingB = teamB.playerIds.reduce((sum, id) => sum + table[id].rating, 0) / 2;
      const scoreA = event.result.winningTeamId === teamAId ? 1 : 0;
      const deltaA = K_FACTOR * safeRatingWeight(event.ratingWeight) * (scoreA - expectedScore(ratingA, ratingB));
      teamA.playerIds.forEach((id) => {
        table[id].rating += deltaA;
        table[id][scoreA ? "wins" : "losses"] += 1;
      });
      teamB.playerIds.forEach((id) => {
        table[id].rating -= deltaA;
        table[id][scoreA ? "losses" : "wins"] += 1;
      });
    }

    if (event.format === "free-for-all" && event.result?.orderedPlayerIds) {
      const ordered = event.result.orderedPlayerIds;
      ordered.forEach((playerId, index) => {
        table[playerId][index === 0 ? "wins" : "losses"] += 1;
      });
      for (let a = 0; a < ordered.length; a += 1) {
        for (let b = a + 1; b < ordered.length; b += 1) {
          const winner = table[ordered[a]];
          const loser = table[ordered[b]];
          const delta = (K_FACTOR * safeRatingWeight(event.ratingWeight) / Math.max(1, ordered.length - 1)) * (1 - expectedScore(winner.rating, loser.rating));
          winner.rating += delta;
          loser.rating -= delta;
        }
      }
    }
  }

  return Object.values(table).sort((a, b) => b.rating - a.rating || b.wins - a.wins);
}

export function getBlendedPlayerRating(state: AppState, playerId: PlayerId, gameId: GameId) {
  const gameRating = getGameRecords(state, gameId).find((record) => record.playerId === playerId)?.rating ?? 1000;
  const overall = Object.keys(state.games).reduce((sum, id) => {
    return sum + (getGameRecords(state, id).find((record) => record.playerId === playerId)?.rating ?? 1000);
  }, 0) / Math.max(1, Object.keys(state.games).length);
  return gameRating * 0.75 + overall * 0.25;
}

function boundedNormalize(strengths: number[]) {
  const count = strengths.length;
  if (!count) return [];
  const total = strengths.reduce((sum, value) => sum + value, 0);
  const normalized = strengths.map((value) => value / total);
  if (count === 2) {
    if (Math.abs(normalized[0] - normalized[1]) < Number.EPSILON) return [0.5, 0.5];
    const favorite = normalized[0] > normalized[1] ? 0 : 1;
    const favoriteProbability = Math.min(HEAT_CONFIG.twoWayMaximum, Math.max(0.5, normalized[favorite]));
    const result = [0, 0];
    result[favorite] = favoriteProbability;
    result[1 - favorite] = 1 - favoriteProbability;
    return result;
  }

  const minimum = HEAT_CONFIG.multiwayMinimumFactor / count;
  const maximum = Math.min(HEAT_CONFIG.multiwayMaximum, HEAT_CONFIG.multiwayMaximumFactor / count);
  const result = Array<number>(count).fill(0);
  const open = normalized.map((_, index) => index);
  let remaining = 1;
  while (open.length) {
    const strengthTotal = open.reduce((sum, index) => sum + strengths[index], 0);
    const lower = open.filter((index) => (remaining * strengths[index]) / strengthTotal < minimum);
    const upper = open.filter((index) => (remaining * strengths[index]) / strengthTotal > maximum);
    if (!lower.length && !upper.length) {
      open.forEach((index) => { result[index] = (remaining * strengths[index]) / strengthTotal; });
      break;
    }
    [...lower, ...upper].forEach((index) => {
      result[index] = lower.includes(index) ? minimum : maximum;
      remaining -= result[index];
      open.splice(open.indexOf(index), 1);
    });
  }
  const residual = 1 - result.reduce((sum, value) => sum + value, 0);
  if (Math.abs(residual) > 1e-12) {
    const target = result.findIndex((value) => value > minimum + 1e-12 && value < maximum - 1e-12);
    if (target >= 0) result[target] += residual;
  }
  return result;
}

/** Converts Heat scores to fair probabilities before applying the house edge. */
export function getFairProbabilities(entries: Array<[string, number]>) {
  const strengths = entries.map(([, score]) => {
    const safeScore = Number.isFinite(score) ? Math.max(-100, Math.min(100, score)) : 0;
    return Math.exp(HEAT_CONFIG.exponentialSensitivity * safeScore);
  });
  const probabilities = boundedNormalize(strengths);
  return Object.fromEntries(entries.map(([id], index) => [id, probabilities[index]]));
}

export function generateOdds(
  state: AppState,
  gameId: GameId,
  format: EventFormat,
  participantIds: string[],
) {
  const entries = participantIds.map((id) => {
    if (format === "free-for-all") return [id, getHeatLineScore(state, id as PlayerId, gameId)] as [string, number];
    const team = state.teams[id as TeamId];
    const score = team ? team.playerIds.reduce((sum, playerId) => sum + getHeatLineScore(state, playerId, gameId), 0) / team.playerIds.length : 0;
    return [id, score] as [string, number];
  });
  const fair = getFairProbabilities(entries);
  return Object.fromEntries(entries.map(([id]) => {
    const probability = fair[id] ?? 1 / Math.max(1, entries.length);
    const decimal = Math.max(1.05, (1 - state.settings.houseEdge) / probability);
    return [id, Math.round(decimal * 100) / 100];
  }));
}

export function getFreeForAllShares(count: number) {
  if (count === 2) return [0.7, 0.3];
  if (count === 3) return [0.6, 0.3, 0.1];
  if (count === 4) return [0.5, 0.3, 0.15, 0.05];
  if (count === 5) return [0.4, 0.25, 0.15, 0.12, 0.08];
  if (count === 6) return [0.35, 0.25, 0.15, 0.1, 0.1, 0.05];
  if (count === 7) return [0.3, 0.22, 0.16, 0.12, 0.09, 0.07, 0.04];
  if (count === 8) return [0.28, 0.2, 0.15, 0.12, 0.09, 0.07, 0.05, 0.04];
  throw new Error("Free-for-all events require two to eight players.");
}

export function canPlayerBet(state: AppState, event: ScheduledEvent, selectionId: string, playerId: PlayerId) {
  const player = state.players[playerId];
  const teammateId = state.teams[player.teamId].playerIds.find((id) => id !== playerId);

  if (event.format === "teams") {
    const ownTeamIsPlaying = event.teamIds?.includes(player.teamId) ?? false;
    return ownTeamIsPlaying ? selectionId === player.teamId : true;
  }

  const selfIsPlaying = event.playerIds?.includes(playerId) ?? false;
  const teammateIsPlaying = teammateId ? event.playerIds?.includes(teammateId) ?? false : false;
  if (selfIsPlaying) return selectionId === playerId;
  if (teammateIsPlaying) return false;
  return true;
}

export function getBetRestrictionReason(state: AppState, event: ScheduledEvent, playerId: PlayerId) {
  const player = state.players[playerId];
  const teammateId = state.teams[player.teamId].playerIds.find((id) => id !== playerId);

  if (event.format === "teams" && event.teamIds?.includes(player.teamId)) {
    return `Your team is playing. You can only back ${state.teams[player.teamId].name}.`;
  }
  if (event.format === "free-for-all" && event.playerIds?.includes(playerId)) {
    return `You are playing. You can only back ${player.name}.`;
  }
  if (event.format === "free-for-all" && teammateId && event.playerIds?.includes(teammateId)) {
    return `${state.players[teammateId].name} is playing, so your team cannot bet on this match.`;
  }
  return undefined;
}

export function selectionWon(event: ScheduledEvent, selectionId: string) {
  if (event.format === "teams") return event.result?.winningTeamId === selectionId;
  return event.result?.orderedPlayerIds?.[0] === selectionId;
}

export function effectiveAvailableBank(state: AppState, event: ScheduledEvent, teamId: string) {
  const existingStake = state.bets.find((bet) => bet.eventId === event.id && bet.teamId === teamId && bet.status === "open")?.stake ?? 0;
  return state.balances[teamId as keyof AppState["balances"]] + existingStake;
}

/**
 * Returns the actual maximum stake for this team and market. The market rules
 * are frozen at open; only the confirmed team balance changes between tickets.
 */
export function allowedMaximumBet(state: AppState, event: ScheduledEvent, teamId: string) {
  const rules = event.rules ?? state.settings;
  const available = Math.max(0, effectiveAvailableBank(state, event, teamId));
  const bankrollMaximum = Math.floor((available * 0.5) / 25_000) * 25_000;
  return Math.min(rules.maximumBet, bankrollMaximum);
}
