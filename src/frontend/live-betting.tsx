import { useEffect, useState } from "react";
import { CalendarBlank, Receipt, ShieldCheck } from "@phosphor-icons/react";
import { allowedMaximumBet, canPlayerBet, effectiveAvailableBank, formatAmericanOdds, formatMoney, getBetRestrictionReason, isBettingOpen } from "../engine";
import { useStore } from "../store";
import type { PlayerId, ScheduledEvent, TeamId } from "../types";
import { EmptyState, GameBadge, ParticipantNames, formatDate } from "./shared";

export function useNow() {
  const { serverOffset } = useStore();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now + serverOffset;
}

export function EventCard({ event, notify }: { event: ScheduledEvent; notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const [selection, setSelection] = useState("");
  const rules = event.rules ?? state.settings;
  const [stake, setStake] = useState(rules.minimumBet);
  const selections = event.format === "teams" ? event.teamIds ?? [] : event.playerIds ?? [];
  const game = state.games[event.gameId];
  const now = useNow();
  const open = !state.bettingPaused && isBettingOpen(event, now);
  const currentTeamId = state.players[state.currentPlayerId].teamId;
  const existingTicket = state.bets.find((bet) => bet.eventId === event.id && bet.teamId === currentTeamId && bet.status === "open");
  const existingExposure = existingTicket?.stake ?? 0;
  const availableBank = effectiveAvailableBank(state, event, currentTeamId);
  const allowedMaximum = allowedMaximumBet(state, event, currentTeamId);
  const minimumAvailable = allowedMaximum >= rules.minimumBet;
  const restrictionReason = getBetRestrictionReason(state, event, state.currentPlayerId);
  const blockedSelections = selections.filter((id) => !canPlayerBet(state, event, id, state.currentPlayerId));

  async function placeBet() {
    if (!selection) return;
    if (!canPlayerBet(state, event, selection, state.currentPlayerId)) {
      notify("That wager conflicts with the teammate and self-bet rules.");
      return;
    }
    if (!await dispatch({ type: "PLACE_BET", eventId: event.id, selectionId: selection, stake })) return;
    notify(`${existingTicket ? "Team ticket updated" : "Wager accepted"} for ${formatMoney(stake)}.`);
    setSelection("");
  }

  return (
    <article className="event-card">
      <div className="event-card-head">
        <div><GameBadge gameId={event.gameId} /><span className="format-label">{event.format === "teams" ? "Team matchup" : "Free for all"}</span></div>
        <span className={`market-status ${open ? "open" : "closed"}`}>{open ? "Betting open" : "Betting closed"}</span>
      </div>
      <h3><ParticipantNames event={event} /></h3>
      <p className="event-time"><CalendarBlank size={17} /> {formatDate(event.scheduledAt)} · {game.standardContest ?? "Standard contest not recorded"}{game.expectedMinutes ? ` · about ${game.expectedMinutes} min` : ""}</p>
      {game.bettable ? (
        <div className="line-grid">
          {selections.map((id) => {
            const label = event.format === "teams" ? state.teams[id as TeamId].name : state.players[id as PlayerId].name;
            const allowed = canPlayerBet(state, event, id, state.currentPlayerId);
            return (
              <button
                className={selection === id ? "selected" : ""}
                disabled={!open || !allowed}
                onClick={() => setSelection(id)}
                key={id}
                title={!allowed ? "Unavailable under teammate and self-bet rules" : undefined}
              >
                <span>{label}</span>
                <strong>{Number.isFinite(event.odds[id]) ? formatAmericanOdds(event.odds[id]) : "Opens with market"}</strong>
              </button>
            );
          })}
        </div>
      ) : <div className="no-market"><ShieldCheck size={20} /> Results only. Mario Party has no betting market.</div>}

      {game.bettable && open && restrictionReason && <div className="bet-restriction"><ShieldCheck size={18} weight="fill" />{restrictionReason}</div>}
      {game.bettable && open && blockedSelections.length > 0 && <p className="market-help"><ShieldCheck size={16} weight="fill" /> Some choices are unavailable because teammate and self-bet rules apply.</p>}

      {game.bettable && open && <div className="bet-limit-grid" aria-label="Ticket limits"><div><span>Available team bank</span><strong>{formatMoney(availableBank)}</strong></div><div><span>Minimum ticket</span><strong>{formatMoney(rules.minimumBet)}</strong></div><div><span>Your maximum</span><strong>{formatMoney(allowedMaximum)}</strong></div><div><span>Hard maximum</span><strong>{formatMoney(rules.maximumBet)}</strong></div></div>}
      {game.bettable && open && !minimumAvailable && <p className="notice" role="status">Your team needs more available bank to place another {formatMoney(rules.minimumBet)} minimum ticket.</p>}

      {selection && open && (
        <div className="bet-slip">
          <div>
            <label htmlFor={`stake-${event.id}`}>Wager</label>
            <select id={`stake-${event.id}`} value={stake} onChange={(e) => setStake(Number(e.target.value))} disabled={!minimumAvailable}>
              {[...new Set([rules.minimumBet, 25_000, 50_000, 100_000, 250_000, 500_000, rules.maximumBet])].sort((a, b) => a - b)
                .filter((value) => value >= rules.minimumBet && value <= allowedMaximum)
                .map((value) => <option value={value} key={value}>{formatMoney(value)}</option>)}
            </select>
          </div>
          <div className="to-win"><span>Total return</span><strong>{formatMoney(stake * event.odds[selection])}</strong></div>
          <button className="primary-button" onClick={placeBet} disabled={!minimumAvailable}>{existingTicket ? "Update ticket" : "Place wager"}</button>
        </div>
      )}
      {existingExposure > 0 && <p className="exposure"><Receipt size={15} /> {state.teams[currentTeamId].name} has {formatMoney(existingExposure)} on this market, last changed by {state.players[existingTicket!.placedBy].name}</p>}
    </article>
  );
}

export function activeNightEvents(state: ReturnType<typeof useStore>["state"]) {
  const activeIds = [...new Set(state.gameNight?.activeEventIds ?? (state.gameNight?.activeEventId ? [state.gameNight.activeEventId] : []))];
  return activeIds.map((id) => state.events.find((event) => event.id === id)).filter((event): event is ScheduledEvent => !!event);
}

export function LiveBetsView({ notify }: { notify: (message: string) => void }) {
  const { state } = useStore();
  const player = state.players[state.currentPlayerId];
  const team = state.teams[player.teamId];
  const activeEvents = activeNightEvents(state);
  const bettingEvents = activeEvents.filter((event) => event.status === "betting");
  const openBets = state.bets.filter((bet) => bet.teamId === team.id && bet.status === "open");

  return <div className="page page-enter game-night-page">
    <div className="night-header">
      <div><p className="eyebrow">Live bets</p><h1>Make your pick.</h1><p>{bettingEvents.length ? "The clock is running. Lock in your team before the match starts." : "No betting markets are open right now."}</p></div>
      <div className="night-bank"><span>{team.name} wallet</span><strong>{formatMoney(state.balances[team.id])}</strong></div>
    </div>
    <div className="metric-strip">
      <div><span>Live markets</span><strong>{bettingEvents.length}</strong></div>
      <div><span>Your open bets</span><strong>{openBets.length}</strong></div>
      <div><span>At risk</span><strong>{formatMoney(openBets.reduce((sum, bet) => sum + bet.stake, 0), true)}</strong></div>
    </div>
    <section className="live-market-list">
      {bettingEvents.map((event) => <EventCard event={event} notify={notify} key={event.id} />)}
      {!bettingEvents.length && <EmptyState icon={Receipt} title="No live bets" body="The next market will show up here as soon as Match Setup opens it." />}
    </section>
  </div>;
}
