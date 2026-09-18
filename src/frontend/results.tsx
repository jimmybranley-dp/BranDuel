import { useMemo, useState } from "react";
import { Bank, Check, Medal, Plus, Repeat, Trophy } from "@phosphor-icons/react";
import { PREP_RATING_COPY, TEAM_IDS } from "../data";
import { buildSettlementPreview, type SettlementPreview } from "../settlement";
import { formatMoney } from "../engine";
import { useStore } from "../store";
import type { PlayerId, ScheduledEvent, TeamId } from "../types";
import { GameBadge, MatchHost, ParticipantNames, exportData, formatDate } from "./shared";

export function LiveResultControls({ event, notify, correction = false }: { event: ScheduledEvent; notify: (message: string) => void; correction?: boolean }) {
  const { state, dispatch } = useStore();
  const [winner, setWinner] = useState<string>("");
  const [reason, setReason] = useState("");
  const [orderConfirmed, setOrderConfirmed] = useState(false);
  const [order, setOrder] = useState<PlayerId[]>(event.playerIds ?? []);
  const [teamOrder, setTeamOrder] = useState<TeamId[]>(event.teamIds ?? []);
  const bracket = event.format === "teams" && (event.bracketSize ?? event.teamIds?.length ?? 2) > 2;
  const preview = useMemo(() => {
    const result = event.format === "teams" ? (bracket ? { orderedTeamIds: teamOrder } : { winningTeamId: winner as TeamId }) : { orderedPlayerIds: order };
    if (event.format === "teams" && ((bracket && teamOrder.length !== (event.teamIds?.length ?? 0)) || (!bracket && !winner))) return null;
    if (event.format === "free-for-all" && order.length < 2) return null;
    if (event.mode === "prep") return null;
    try { return buildSettlementPreview(event, state, result); } catch { return null; }
  }, [bracket, event, order, state, teamOrder, winner]);

  function move(playerId: PlayerId, direction: -1 | 1) {
    setOrder((current) => {
      const next = [...current];
      const index = next.indexOf(playerId);
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function moveTeam(teamId: TeamId, direction: -1 | 1) {
    setTeamOrder((current) => {
      const next = [...current]; const index = next.indexOf(teamId); const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]]; return next;
    });
  }

  async function settle() {
    const result = event.format === "teams" ? (bracket ? { orderedTeamIds: teamOrder } : { winningTeamId: winner as TeamId }) : { orderedPlayerIds: order };
    const summary = event.format === "teams" ? (bracket ? teamOrder.map((id, index) => `${index + 1}. ${state.teams[id].name}`).join("\n") : `${state.teams[winner as TeamId]?.name} wins`) : order.map((id, index) => `${index + 1}. ${state.players[id].name}`).join("\n");
    const impact = event.mode === "prep" ? PREP_RATING_COPY : "Team banks, wagers and records will update.";
    if (!window.confirm(`${correction ? "Correct this result" : "Settle this result"}?\n${summary}\n\n${impact}`)) return;
    const accepted = correction
      ? await dispatch({ type: "CORRECT_RESULT", eventId: event.id, result, reason })
      : await dispatch({ type: "SETTLE_EVENT", eventId: event.id, result });
    if (accepted) notify(event.mode === "prep" ? (correction ? "Prep result corrected. Heat updated." : "Prep result recorded. Heat updated.") : (correction ? "Result corrected. Banks, wagers and records updated." : "Round settled. Banks, wagers and Heat updated."));
  }

  return (
    <div className="live-result">
      <div className="in-play-banner"><span>{event.mode === "prep" ? "Heat-only prep game" : correction ? "Correct settled result" : "Match in play"}</span><strong><ParticipantNames event={event} /></strong><GameBadge gameId={event.gameId} /><MatchHost event={event} /></div>
      {event.format === "teams" ? (
        bracket ? <fieldset><legend>Set the final bracket order</legend><div className="ranking-editor">{teamOrder.map((teamId, index) => <div key={teamId}><strong>{index + 1}</strong><span>{state.teams[teamId].name}</span><div><button type="button" disabled={index === 0} onClick={() => moveTeam(teamId, -1)}>Up</button><button type="button" disabled={index === teamOrder.length - 1} onClick={() => moveTeam(teamId, 1)}>Down</button></div></div>)}</div></fieldset>
          : <fieldset><legend>Tap the winner</legend><div className="winner-grid">{event.teamIds?.map((teamId) => <button type="button" className={winner === teamId ? "selected" : ""} onClick={() => setWinner(teamId)} key={teamId}><Trophy size={21} weight={winner === teamId ? "fill" : "regular"} />{state.teams[teamId].name}</button>)}</div></fieldset>
      ) : (
        <fieldset><legend>Set the final order</legend><div className="ranking-editor">{order.map((playerId, index) => <div key={playerId}><strong>{index + 1}</strong><span>{state.players[playerId].name}</span><div><button type="button" disabled={index === 0} onClick={() => move(playerId, -1)} aria-label={`Move ${state.players[playerId].name} up`}>Up</button><button type="button" disabled={index === order.length - 1} onClick={() => move(playerId, 1)} aria-label={`Move ${state.players[playerId].name} down`}>Down</button></div></div>)}</div></fieldset>
      )}
      {preview && <SettlementPreviewCard preview={preview} />}
      {event.mode !== "prep" && <div className="payout-note"><Bank size={20} /><span>House purse</span><strong>{formatMoney(event.purse ?? state.settings.payouts[event.gameId])}</strong></div>}
      {event.format === "free-for-all" && <label className="confirm-order"><input type="checkbox" checked={orderConfirmed} onChange={(e) => setOrderConfirmed(e.target.checked)} /> I checked every finishing position.</label>}
      {correction && <label>Reason for correction<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Explain the mistaken result" /></label>}
      <button className="primary-button full" disabled={(event.format === "teams" ? (bracket ? teamOrder.length !== 4 : !winner) : !orderConfirmed) || (correction && !reason.trim())} onClick={settle}><Check size={18} weight="bold" /> {correction ? "Review correction" : "Review and settle"}</button>
    </div>
  );
}

function SettlementPreviewCard({ preview }: { preview: SettlementPreview }) {
  const { state } = useStore();
  return <div className="settlement-preview"><div className="settlement-preview-head"><h3>Settlement preview</h3><span>{formatMoney(preview.input.adjustedHousePurse)} house purse</span></div>{preview.input.eventType === "FFA" && preview.input.playerCountMultiplier !== undefined && <small className="settlement-preview-note">{preview.input.result.orderedPlayerIds?.length ?? 0} players -&gt; {preview.input.playerCountMultiplier.toFixed(2)}x purse multiplier</small>}{preview.teamRankings.length ? preview.teamRankings.map((ranking) => { const payout = preview.payouts.find((item) => item.teamId === ranking.teamId); return <div className="settlement-preview-row" key={ranking.teamId}><span><strong>#{ranking.rank} {state.teams[ranking.teamId].name}</strong>{ranking.score !== undefined && <small>Team score {ranking.score.toFixed(3)}</small>}</span><strong className={payout?.amount ? "positive" : "muted-amount"}>{payout?.amount ? `+${formatMoney(payout.amount)}` : "No payout"}</strong></div>; }) : <p>No competitive payout for this event.</p>}<small className="settlement-preview-note">This preview is recalculated and recorded by the house when you confirm.</small></div>;
}

export function PayoutBreakdown({ event }: { event: ScheduledEvent }) {
  const { state } = useStore();
  if (!event.result) return null;
  const settlement = event.settlements?.at(-1) ?? buildSettlementPreview(event, state, event.result);
  return <div className="payout-breakdown"><h3>Team settlement</h3>{settlement.teamRankings.map((ranking) => { const payout = settlement.payouts.find((item) => item.teamId === ranking.teamId); return <div className="payout-player-row" key={ranking.teamId}><span><strong>#{ranking.rank} {state.teams[ranking.teamId].name}</strong><small>{payout ? `${payout.percentage}% of house purse` : "No competitive payout"}</small></span><strong className={payout?.amount ? "positive" : "muted-amount"}>{payout?.amount ? `+${formatMoney(payout.amount)}` : "-"}</strong></div>; })}</div>;
}

export function SettlementRecap({ event, notify }: { event: ScheduledEvent; notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const winnerName = event.format === "teams"
    ? state.teams[event.result!.winningTeamId ?? event.result!.orderedTeamIds![0]].name
    : state.players[event.result!.orderedPlayerIds![0]].name;
  const tickets = state.bets.filter((bet) => bet.eventId === event.id && ["won", "lost"].includes(bet.status));
  const standings = TEAM_IDS.map((id) => ({ id, balance: state.balances[id] })).sort((a, b) => b.balance - a.balance);
  return (
    <div className="settlement-recap">
      <div className="settlement-winner"><Medal size={36} weight="fill" /><span>Round settled</span><h2>{winnerName} wins</h2><p>{state.games[event.gameId].name} moved {formatMoney(event.purse ?? state.settings.payouts[event.gameId])} through the house purse.</p></div>
      <div className="settlement-grid">
        <div><h3>Team banks</h3>{standings.map((team, index) => <div className="mini-standing" key={team.id}><span>{index + 1}. {state.teams[team.id].name}</span><strong>{formatMoney(team.balance)}</strong></div>)}</div>
        <div><h3>Wager settlement</h3>{tickets.length ? tickets.map((bet) => <div className="mini-standing" key={bet.id}><span>{state.teams[bet.teamId].name} <small>{bet.status}</small></span><strong className={bet.status === "won" ? "positive" : "negative"}>{bet.status === "won" ? `+${formatMoney(bet.payout - bet.stake)}` : `-${formatMoney(bet.stake)}`}</strong></div>) : <p className="no-tickets">No team tickets were placed.</p>}</div>
      </div>
      {state.currentPlayerId === "jimmy" && <PayoutBreakdown event={event} />}
      <div className="next-round-actions">
        <button className="primary-button" onClick={async () => { if (await dispatch({ type: "RUN_IT_BACK", eventId: event.id, bettingSeconds: 90 })) notify("Run it back. Betting is open for 90 seconds."); }}><Repeat size={18} weight="bold" /> Run it back</button>
        <button className="secondary-button" onClick={() => dispatch({ type: "DISMISS_RECAP" })}><Plus size={18} /> New matchup</button>
      </div>
    </div>
  );
}

export function NightSummary() {
  const { state } = useStore();
  const [archiveId, setArchiveId] = useState("");
  const night = state.gameNightArchives?.find((item) => item.id === archiveId) ?? state.gameNight!;
  const snapshot = night.finalSnapshot;
  const completedEvents = night.eventIds.map((id) => (snapshot?.events ?? state.events).find((event) => event.id === id)).filter((event): event is ScheduledEvent => event?.status === "completed");
  const tickets = (snapshot?.bets ?? state.bets).filter((bet) => night.eventIds.includes(bet.eventId));
  const biggest = [...tickets].sort((a, b) => b.stake - a.stake)[0];
  const gameCounts = Object.keys(state.games).map((gameId) => ({ gameId, count: completedEvents.filter((event) => event.gameId === gameId).length })).filter((item) => item.count > 0);
  const standings = TEAM_IDS.map((id) => ({ id, balance: (snapshot?.balances ?? state.balances)[id] })).sort((a, b) => b.balance - a.balance);
  return (
    <div className="page page-enter night-summary">
      <div className="summary-hero"><p className="eyebrow">Final horn</p><h1>Game Night complete.</h1><p>{completedEvents.length} {completedEvents.length === 1 ? "round" : "rounds"} settled across {gameCounts.length} {gameCounts.length === 1 ? "game" : "games"}.</p></div>
      <div className="summary-metrics"><div><span>Rounds</span><strong>{completedEvents.length}</strong></div><div><span>Biggest ticket</span><strong>{biggest ? formatMoney(biggest.stake) : "$0"}</strong></div><div><span>Bank leader</span><strong>{state.teams[standings[0].id].name}</strong></div></div>
      <div className="summary-columns"><div><h2>Final banks</h2>{standings.map((team, index) => <div className="summary-row" key={team.id}><strong>{index + 1}</strong><span>{state.teams[team.id].name}</span><b>{formatMoney(team.balance)}</b></div>)}</div><div><h2>Games played</h2>{gameCounts.length ? gameCounts.map(({ gameId, count }) => <div className="summary-row summary-game-row" key={gameId}><GameBadge gameId={gameId} /><b>{count}</b></div>) : <p>No completed rounds.</p>}</div></div>
      <p>These final standings and the event rules were frozen at closeout.</p>
      <button className="primary-button" onClick={() => exportData(night, `branduel-final-${night.id}.json`)}>Export final archive</button>
      {!!state.gameNightArchives?.length && <label>Previous nights<select value={archiveId} onChange={(e) => setArchiveId(e.target.value)}><option value="">Latest night</option>{state.gameNightArchives.map((item) => <option key={item.id} value={item.id}>{formatDate(item.startedAt)}</option>)}</select></label>}
    </div>
  );
}
