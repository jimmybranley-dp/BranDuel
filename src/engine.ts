import { PLAYER_IDS } from "./data";
import type { AppState, EventFormat, GameId, PlayerId, ScheduledEvent, TeamId } from "./types";

export interface PlayerRecord {
  playerId: PlayerId;
  wins: number;
  losses: number;
  rating: number;
}

const K_FACTOR = 28;

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
      const deltaA = K_FACTOR * (event.ratingWeight ?? 1) * (scoreA - expectedScore(ratingA, ratingB));
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
          const delta = (K_FACTOR * (event.ratingWeight ?? 1) / Math.max(1, ordered.length - 1)) * (1 - expectedScore(winner.rating, loser.rating));
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

function softmaxRatings(entries: Array<[string, number]>, houseEdge: number) {
  const strengths = entries.map(([id, rating]) => [id, Math.pow(10, rating / 400)] as const);
  const total = strengths.reduce((sum, [, strength]) => sum + strength, 0);
  return Object.fromEntries(
    strengths.map(([id, strength]) => {
      const probability = strength / total;
      const decimal = Math.max(1.05, (1 - houseEdge) / probability);
      return [id, Math.round(decimal * 100) / 100];
    }),
  );
}

export function generateOdds(
  state: AppState,
  gameId: GameId,
  format: EventFormat,
  participantIds: string[],
) {
  if (format === "free-for-all") {
    const entries = participantIds.map((id) => [id, getBlendedPlayerRating(state, id as PlayerId, gameId)] as [string, number]);
    return softmaxRatings(entries, state.settings.houseEdge);
  }

  const entries = participantIds.map((id) => {
    const team = state.teams[id as TeamId];
    const rating = team.playerIds.reduce((sum, playerId) => sum + getBlendedPlayerRating(state, playerId, gameId), 0) / 2;
    return [id, rating] as [string, number];
  });
  return softmaxRatings(entries, state.settings.houseEdge);
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
