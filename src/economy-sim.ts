import { createInitialState, GAME_IDS, PLAYER_IDS, TEAM_IDS } from "./data";
import { applyAction, type Action } from "./domain";
import { allowedMaximumBet, canPlayerBet, selectionWon } from "./engine";
import type { AppState, PlayerId, ScheduledEvent, TeamId } from "./types";

export type EconomyProfile = "conservative" | "max-bettor" | "loss-chaser" | "self-backer" | "random-legal" | "coordinated";
export interface SimulationOptions { seed: number; nights?: number; rounds?: number; }
export interface SimulationReport {
  nights: number; seed: number; endingBalances: Record<TeamId, number[]>; debtNights: number;
  largestGap: number; housePurseMoney: number; wagerVolume: number; corrections: number; voids: number;
  outcomes: Record<EconomyProfile, { wagers: number; won: number; lost: number; refunded: number; volume: number }>;
  extremes: Array<{ seed: number; gap: number; balances: Record<TeamId, number> }>;
}
export interface EconomyNightInspection {
  seed: number; finalBalances: Record<TeamId, number>;
  events: Array<{ gameId: string; format: string; status: string; purse: number; corrections: number; bets: Record<string, number> }>;
  ledgerTotals: Record<TeamId, { gamePayout: number; betStake: number; betRefund: number; betWin: number; reversals: number }>;
}

class Random {
  constructor(private value: number) {}
  next() { this.value |= 0; this.value = (this.value + 0x6D2B79F5) | 0; let t = Math.imul(this.value ^ this.value >>> 15, 1 | this.value); t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  int(limit: number) { return Math.floor(this.next() * limit); }
  pick<T>(items: readonly T[]) { return items[this.int(items.length)]; }
  chance(rate: number) { return this.next() < rate; }
}

const profileByTeam: Record<TeamId, EconomyProfile> = {
  "jason-ezra": "conservative", "corey-jimmy": "max-bettor", "brandon-andrew": "loss-chaser", "bruce-ryan": "self-backer",
};
const allProfiles: EconomyProfile[] = ["conservative", "max-bettor", "loss-chaser", "self-backer", "random-legal", "coordinated"];

export class EconomySimulationError extends Error {
  constructor(message: string, readonly seed: number, readonly trace: string[], readonly state: AppState) { super(message); }
  replayCommand() { return `set ECONOMY_SEED=${this.seed}&& npm run sim:economy:replay`; }
}

function teamPlayers(state: AppState, team: TeamId) { return state.teams[team].playerIds; }
function chooseActor(state: AppState, team: TeamId, random: Random) { return random.pick(teamPlayers(state, team)); }
function resultFor(event: ScheduledEvent, random: Random) {
  return event.format === "teams"
    ? { winningTeamId: random.pick(event.teamIds!) }
    : { orderedPlayerIds: [...event.playerIds!].sort(() => random.next() - 0.5) };
}
function ffaPlayers(state: AppState, random: Random, count: number) {
  const shuffled = [...PLAYER_IDS].sort(() => random.next() - .5).slice(0, count);
  if (count === 2 && state.players[shuffled[0]].teamId === state.players[shuffled[1]].teamId) {
    const replacement = PLAYER_IDS.find((playerId) => state.players[playerId].teamId !== state.players[shuffled[0]].teamId && !shuffled.includes(playerId));
    if (replacement) shuffled[1] = replacement;
  }
  return shuffled;
}
function stateSummary(state: AppState) {
  return JSON.stringify({ balances: state.balances, events: state.events.map(e => ({ id: e.id, status: e.status, purse: e.purse })), bets: state.bets.map(b => ({ eventId: b.eventId, teamId: b.teamId, status: b.status, stake: b.stake })), ledgerEntries: state.ledger.length });
}

export function assertEconomyInvariants(state: AppState) {
  for (const teamId of TEAM_IDS) {
    const entries = state.ledger.filter(entry => entry.teamId === teamId);
    if (entries.reduce((sum, entry) => sum + entry.amount, 0) !== state.balances[teamId]) throw new Error(`Ledger does not reconcile for ${teamId}.`);
    if (!Number.isSafeInteger(state.balances[teamId]) || entries.some(entry => !Number.isSafeInteger(entry.amount))) throw new Error(`Unsafe accounting value for ${teamId}.`);
  }
  const runningBalances = Object.fromEntries(TEAM_IDS.map(teamId => [teamId, 0])) as Record<TeamId, number>;
  for (const entry of [...state.ledger].reverse()) {
    if (entry.type === "bet-stake" && runningBalances[entry.teamId] < -entry.amount) throw new Error(`Ticket ${entry.betId} spent more than available funds.`);
    runningBalances[entry.teamId] += entry.amount;
  }
  for (const bet of state.bets) {
    const stakes = state.ledger.filter(entry => entry.betId === bet.id && entry.type === "bet-stake");
    if (stakes.length !== 1 || stakes[0].amount !== -bet.stake) throw new Error(`Ticket ${bet.id} lacks its exact stake entry.`);
    if (bet.status === "open" && state.ledger.filter(entry => entry.betId === bet.id && entry.type === "bet-stake" && entry.amount < 0).length !== 1) throw new Error(`Open ticket ${bet.id} lacks one negative stake.`);
    if (bet.status === "replaced" && state.ledger.filter(entry => entry.betId === bet.id && entry.type === "bet-refund").length !== 1) throw new Error(`Replacement ${bet.id} was not refunded exactly once.`);
  }
  for (const event of state.events) {
    const open = state.bets.filter(bet => bet.eventId === event.id && bet.status === "open");
    for (const teamId of TEAM_IDS) if (open.filter(bet => bet.teamId === teamId).length > 1) throw new Error(`More than one open ticket for ${teamId} on ${event.id}.`);
    const reversed = state.ledger.filter(entry => entry.eventId === event.id && entry.type === "reversal");
    if (new Set(reversed.map(entry => entry.reversesEntryId)).size !== reversed.length) throw new Error(`Settlement entry reversed more than once for ${event.id}.`);
    if (event.status === "completed") {
      const current = new Set(event.settlementLedgerIds ?? []);
      const gamePayout = state.ledger.filter(entry => current.has(entry.id) && entry.type === "game-payout").reduce((sum, entry) => sum + entry.amount, 0);
      const settledPurse = event.settlements?.at(-1)?.input.adjustedHousePurse ?? event.purse;
      if (gamePayout !== settledPurse) throw new Error(`Frozen purse does not reconcile for ${event.id}.`);
      for (const bet of state.bets.filter(bet => bet.eventId === event.id && ["won", "lost"].includes(bet.status))) {
        const expected = selectionWon(event, bet.selectionId) ? Math.round(bet.stake * bet.decimalOdds) : 0;
        if (bet.payout !== expected) throw new Error(`Incorrect wager payout for ${bet.id}.`);
      }
    }
    if (event.status === "cancelled" && open.length) throw new Error(`Voided event ${event.id} retains open tickets.`);
  }
  if (state.gameNight?.status === "ended") {
    const snapshot = state.gameNight.finalSnapshot;
    const finalEvents = state.events.filter(event => event.gameNightId === state.gameNight!.id);
    const finalBets = state.bets.filter(bet => state.gameNight!.eventIds.includes(bet.eventId));
    if (!snapshot || JSON.stringify(snapshot.balances) !== JSON.stringify(state.balances) || JSON.stringify(snapshot.settings) !== JSON.stringify(state.settings) || JSON.stringify(snapshot.events) !== JSON.stringify(finalEvents) || JSON.stringify(snapshot.bets) !== JSON.stringify(finalBets) || JSON.stringify(snapshot.ledger) !== JSON.stringify(state.ledger)) throw new Error("Closeout snapshot differs from final state.");
  }
}

function runNight(seed: number, rounds: number, report: SimulationReport) {
  const random = new Random(seed); let state = createInitialState(); const trace: string[] = []; const betProfiles = new Map<string, EconomyProfile>();
  const accept = (actor: PlayerId, action: Action) => {
    try { state = applyAction(state, action, actor); trace.push(`${actor} ${JSON.stringify(action)}`); assertEconomyInvariants(state); return state; }
    catch (error) { throw new EconomySimulationError(`${error instanceof Error ? error.message : error}\n${stateSummary(state)}`, seed, trace, state); }
  };
  accept("jimmy", { type: "START_GAME_NIGHT" });
  for (let index = 0; index < rounds; index += 1) {
    const format = random.chance(.35) ? "free-for-all" : "teams";
    const gameId = random.pick(GAME_IDS);
    const participants = format === "teams"
      ? (() => { const teamIds = [...TEAM_IDS].sort(() => random.next() - .5).slice(0, random.chance(.2) ? 4 : 2); return { teamIds, ...(teamIds.length === 4 ? { bracketSize: 4 as const, hasConsolationMatch: random.chance(.5) } : {}) }; })()
      : { playerIds: ffaPlayers(state, random, gameId === "smash" || gameId === "worms" ? 2 + random.int(7) : 2 + random.int(3)) };
    accept("jimmy", { type: "CREATE_LIVE_EVENT", payload: { gameId, format, ...participants, bettingSeconds: 60 } } as Action);
    const event = state.events[0];
    for (const teamId of TEAM_IDS) {
      const profile = allProfiles[(index + TEAM_IDS.indexOf(teamId)) % allProfiles.length] ?? profileByTeam[teamId];
      const actor = chooseActor(state, teamId, random);
      const legal = Object.keys(event.odds).filter(selection => canPlayerBet(state, event, selection, actor));
      if (!legal.length || !state.games[gameId].bettable) continue;
      const priorLost = state.bets.some(bet => bet.teamId === teamId && bet.status === "lost");
      const max = allowedMaximumBet(state, event, teamId);
      if (max < event.rules!.minimumBet) continue;
      const stake = profile === "max-bettor" ? max : profile === "loss-chaser" && priorLost ? max : profile === "conservative" ? event.rules!.minimumBet : random.chance(.5) ? max : event.rules!.minimumBet;
      const selection = profile === "self-backer" ? legal.find(id => id === teamId || id === actor) ?? random.pick(legal) : random.pick(legal);
      if (state.balances[teamId] >= stake) { accept(actor, { type: "PLACE_BET", eventId: event.id, selectionId: selection, stake }); betProfiles.set(state.bets[0].id, profile); }
      const openTicket = state.bets.find(bet => bet.eventId === event.id && bet.teamId === teamId && bet.status === "open");
      if (openTicket && (profile === "coordinated" || profile === "max-bettor" || random.chance(.35))) {
        const teammate = teamPlayers(state, teamId).find(id => id !== actor)!;
        const teammateLegal = Object.keys(event.odds).filter(selection => canPlayerBet(state, event, selection, teammate));
        if (!teammateLegal.length) continue;
        const replacementMaximum = allowedMaximumBet(state, event, teamId);
        if (replacementMaximum < event.rules!.minimumBet) continue;
        const replacement = openTicket.stake === replacementMaximum ? event.rules!.minimumBet : replacementMaximum;
        const replacementSelection = teammateLegal.find(id => id !== openTicket.selectionId) ?? teammateLegal[0];
        if (replacement === openTicket.stake && replacementSelection === openTicket.selectionId) continue;
        accept(teammate, { type: "PLACE_BET", eventId: event.id, selectionId: replacementSelection, stake: replacement }); betProfiles.set(state.bets[0].id, profile);
      }
    }
    if (random.chance(.15)) { try { applyAction(state, { type: "END_GAME_NIGHT" }, "jimmy"); throw new Error("Closeout accepted while round unresolved."); } catch (error) { if (!(error instanceof Error) || !String(error.message).includes("Finish or void")) throw error; } }
    accept("jimmy", { type: "START_MATCH", eventId: event.id });
    const result = resultFor(event, random);
    accept(random.pick(PLAYER_IDS), { type: "SETTLE_EVENT", eventId: event.id, result });
    report.housePurseMoney += event.settlements?.at(-1)?.input.adjustedHousePurse ?? event.purse ?? 0;
    if (random.chance(.22)) { const corrected = resultFor(event, random); if (JSON.stringify(corrected) !== JSON.stringify(result)) { accept("jimmy", { type: "CORRECT_RESULT", eventId: event.id, result: corrected, reason: "Seeded economy correction" }); report.corrections++; } }
    if (random.chance(.16)) { accept("jimmy", { type: "CANCEL_EVENT", eventId: event.id, reason: "Seeded economy void" }); report.voids++; }
  }
  accept("jimmy", { type: "END_GAME_NIGHT" });
  for (const teamId of TEAM_IDS) report.endingBalances[teamId].push(state.balances[teamId]);
  if (TEAM_IDS.some(teamId => state.balances[teamId] < 0)) report.debtNights++;
  const values = TEAM_IDS.map(teamId => state.balances[teamId]); const gap = Math.max(...values) - Math.min(...values); report.largestGap = Math.max(report.largestGap, gap);
  report.extremes.push({ seed, gap, balances: structuredClone(state.balances) });
  for (const bet of state.bets) { const profile = betProfiles.get(bet.id) ?? profileByTeam[bet.teamId]; const row = report.outcomes[profile]; row.wagers++; row.volume += bet.stake; if (bet.status === "won") row.won++; if (bet.status === "lost") row.lost++; if (["refunded", "replaced"].includes(bet.status)) row.refunded++; report.wagerVolume += bet.stake; }
  return state;
}

export function simulateEconomy(options: SimulationOptions): SimulationReport {
  const nights = options.nights ?? 25; const report: SimulationReport = { nights, seed: options.seed, endingBalances: { "jason-ezra": [], "corey-jimmy": [], "brandon-andrew": [], "bruce-ryan": [] }, debtNights: 0, largestGap: 0, housePurseMoney: 0, wagerVolume: 0, corrections: 0, voids: 0, outcomes: Object.fromEntries(allProfiles.map(profile => [profile, { wagers: 0, won: 0, lost: 0, refunded: 0, volume: 0 }])) as SimulationReport["outcomes"], extremes: [] };
  for (let night = 0; night < nights; night++) runNight(options.seed + night, options.rounds ?? 8, report);
  report.extremes.sort((a, b) => b.gap - a.gap).splice(5);
  return report;
}

export function inspectEconomyNight(seed: number, rounds = 8): EconomyNightInspection {
  const report = simulateEconomy({ seed, nights: 0, rounds });
  const state = runNight(seed, rounds, report);
  const ledgerTotals = Object.fromEntries(TEAM_IDS.map(teamId => [teamId, { gamePayout: 0, betStake: 0, betRefund: 0, betWin: 0, reversals: 0 }])) as EconomyNightInspection["ledgerTotals"];
  for (const entry of state.ledger) {
    const totals = ledgerTotals[entry.teamId];
    if (entry.type === "game-payout") totals.gamePayout += entry.amount;
    if (entry.type === "bet-stake") totals.betStake += entry.amount;
    if (entry.type === "bet-refund") totals.betRefund += entry.amount;
    if (entry.type === "bet-win") totals.betWin += entry.amount;
    if (entry.type === "reversal") totals.reversals += entry.amount;
  }
  return {
    seed, finalBalances: state.balances,
    events: state.events.map(event => ({ gameId: event.gameId, format: event.format, status: event.status, purse: event.purse ?? 0, corrections: event.corrections?.length ?? 0, bets: Object.fromEntries(["won", "lost", "refunded", "replaced"].map(status => [status, state.bets.filter(bet => bet.eventId === event.id && bet.status === status).length])) })),
    ledgerTotals,
  };
}
