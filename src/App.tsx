import { useEffect, useMemo, useState, type ComponentType, type FormEvent } from "react";
import {
  ArrowArcLeft,
  Bank,
  Bug,
  CalendarBlank,
  CaretRight,
  ChartBar,
  Check,
  Clock,
  DiceFive,
  House,
  Medal,
  Play,
  Plus,
  Repeat,
  Receipt,
  ShieldCheck,
  Sword,
  Target,
  Trophy,
  UserCircle,
  Wallet,
  X,
  type IconProps,
} from "@phosphor-icons/react";
import { GAME_IDS, PLAYER_IDS, TEAM_IDS } from "./data";
import {
  canPlayerBet,
  formatAmericanOdds,
  formatMoney,
  getBetRestrictionReason,
  getGameRecords,
  getFreeForAllShares,
  isBettingOpen,
} from "./engine";
import { useStore } from "./store";
import type { AppSettings, GameId, PlayerId, ScheduledEvent, TeamId } from "./types";

type View = "home" | "events" | "log" | "leaderboards" | "bank";

const ICONS: Record<GameId, ComponentType<IconProps>> = {
  smash: Sword,
  boomerang: ArrowArcLeft,
  worms: Bug,
  "mario-party": DiceFive,
};

const NAV: Array<{ id: View; label: string; icon: ComponentType<IconProps> }> = [
  { id: "home", label: "Home", icon: House },
  { id: "events", label: "Events", icon: CalendarBlank },
  { id: "log", label: "Log Result", icon: Trophy },
  { id: "leaderboards", label: "Leaders", icon: ChartBar },
  { id: "bank", label: "Team Bank", icon: Wallet },
];

function BrandMark() {
  return (
    <div className="brand-lockup" aria-label="BranDuel">
      <span className="brand-shield">B</span>
      <span className="brand-name">BranDuel</span>
    </div>
  );
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatTimeUntil(iso: string) {
  const hours = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000));
  if (hours < 1) return "Starting soon";
  if (hours < 24) return `In ${hours} hr`;
  const days = Math.round(hours / 24);
  return `In ${days} ${days === 1 ? "day" : "days"}`;
}

function GameBadge({ gameId }: { gameId: GameId }) {
  const { state } = useStore();
  const Icon = ICONS[gameId];
  return (
    <span className="game-badge">
      <Icon size={18} weight="bold" />
      {state.games[gameId].shortName}
    </span>
  );
}

function ParticipantNames({ event }: { event: ScheduledEvent }) {
  const { state } = useStore();
  if (event.format === "teams" && event.teamIds) {
    return <>{state.teams[event.teamIds[0]].name} <span className="versus">vs</span> {state.teams[event.teamIds[1]].name}</>;
  }
  return <>{event.playerIds?.map((id) => state.players[id].name).join(", ")}</>;
}

function PlayerPicker() {
  const { state, dispatch } = useStore();
  return (
    <label className="player-picker">
      <UserCircle size={20} weight="fill" />
      <span className="sr-only">Current player</span>
      <select
        value={state.currentPlayerId}
        onChange={(event) => dispatch({ type: "SET_PLAYER", playerId: event.target.value as PlayerId })}
      >
        {PLAYER_IDS.map((id) => <option value={id} key={id}>{state.players[id].name}</option>)}
      </select>
    </label>
  );
}

function Shell({ view, onView, children }: { view: View; onView: (view: View) => void; children: React.ReactNode }) {
  const { state, syncStatus } = useStore();
  const player = state.players[state.currentPlayerId];
  const liveNight = state.gameNight?.status === "active";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <BrandMark />
        <nav className="side-nav" aria-label="Primary">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button className={view === item.id ? "active" : ""} onClick={() => onView(item.id)} key={item.id}>
                <Icon size={21} weight={view === item.id ? "fill" : "regular"} />
                {item.id === "log" && liveNight ? "Results" : item.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bank">
          <span>{state.teams[player.teamId].name}</span>
          <strong>{formatMoney(state.balances[player.teamId], true)}</strong>
          <small>Available balance</small>
        </div>
        <p className="derby-label">Degenerate Derby</p>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="mobile-brand"><BrandMark /></div>
          <span className={`sync-status ${syncStatus}`} title={syncStatus === "shared" ? "Connected to the shared BranDuel house" : syncStatus === "local" ? "Shared house unavailable. Changes remain on this device." : "Connecting to the shared BranDuel house"}>
            <i aria-hidden="true" />
            {syncStatus === "shared" ? "Shared live" : syncStatus === "local" ? "Local mode" : "Connecting"}
          </span>
          <div className="topbar-context">
            <span>Playing as</span>
            <strong>{player.name}</strong>
          </div>
          <PlayerPicker />
        </header>
        <main>{children}</main>
      </div>

      <nav className="bottom-nav" aria-label="Mobile primary">
        {NAV.map((item) => {
          const Icon = item.icon;
          return (
            <button className={view === item.id ? "active" : ""} onClick={() => onView(item.id)} key={item.id}>
              <Icon size={22} weight={view === item.id ? "fill" : "regular"} />
              <span>{item.id === "log" && liveNight ? "Results" : item.label === "Leaderboards" ? "Leaders" : item.label.replace(" Result", "")}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function SectionHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

function EmptyState({ icon: Icon, title, body }: { icon: ComponentType<IconProps>; title: string; body: string }) {
  return (
    <div className="empty-state">
      <Icon size={30} />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function HomeView({ onView, notify }: { onView: (view: View) => void; notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const player = state.players[state.currentPlayerId];
  const team = state.teams[player.teamId];
  if (state.gameNight?.status === "active") return <GameNightView notify={notify} />;
  if (state.gameNight?.status === "ended") return <NightSummary />;
  const upcoming = [...state.events]
    .filter((event) => event.status === "scheduled")
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const openBets = state.bets.filter((bet) => bet.teamId === team.id && bet.status === "open");
  const completed = state.events.filter((event) => event.status === "completed");
  const teamWins = completed.filter((event) => {
    if (event.result?.winningTeamId === team.id) return true;
    const winner = event.result?.orderedPlayerIds?.[0];
    return winner ? state.players[winner].teamId === team.id : false;
  }).length;

  return (
    <div className="page page-enter">
      <div className="home-intro">
        <div>
          <p className="eyebrow">Front office</p>
          <h1>{player.name}, your team is live.</h1>
          <p>Track the schedule, protect the bankroll, and make the next result count.</p>
          <button className="primary-button home-start" onClick={() => dispatch({ type: "START_GAME_NIGHT" })}><Play size={18} weight="fill" /> Start Game Night</button>
        </div>
        <div className="bank-hero">
          <span>{team.name}</span>
          <strong>{formatMoney(state.balances[team.id])}</strong>
          <small>Team cash</small>
        </div>
      </div>

      <div className="metric-strip">
        <div><span>Team wins</span><strong>{teamWins}</strong></div>
        <div><span>Open wagers</span><strong>{openBets.length}</strong></div>
        <div><span>At risk</span><strong>{formatMoney(openBets.reduce((sum, bet) => sum + bet.stake, 0), true)}</strong></div>
      </div>

      <section>
        <SectionHeading title="On deck" action={<button className="text-button" onClick={() => onView("events")}>Full board <CaretRight size={16} /></button>} />
        {upcoming.length ? (
          <div className="on-deck-grid">
            {upcoming.slice(0, 2).map((event, index) => (
              <button className={`deck-event ${index === 0 ? "featured" : ""}`} onClick={() => onView("events")} key={event.id}>
                <div className="deck-top"><GameBadge gameId={event.gameId} /><span>{formatTimeUntil(event.scheduledAt)}</span></div>
                <h3><ParticipantNames event={event} /></h3>
                <div className="deck-meta"><Clock size={16} /> {formatDate(event.scheduledAt)}</div>
                <span className="event-cta">View lines <CaretRight size={16} /></span>
              </button>
            ))}
          </div>
        ) : <EmptyState icon={CalendarBlank} title="The board is clear" body="Schedule a matchup to open the next line." />}
      </section>

      <section>
        <SectionHeading title="Game desk" />
        <div className="game-desk">
          {GAME_IDS.map((gameId) => {
            const records = getGameRecords(state, gameId);
            const leader = records[0];
            const Icon = ICONS[gameId];
            return (
              <button key={gameId} onClick={() => onView("leaderboards")}>
                <Icon size={24} weight="bold" />
                <span>{state.games[gameId].shortName}</span>
                <strong>{state.players[leader.playerId].name}</strong>
                <small>{Math.round(leader.rating)} rating</small>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function EventCard({ event, notify }: { event: ScheduledEvent; notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const [selection, setSelection] = useState("");
  const [stake, setStake] = useState(state.settings.minimumBet);
  const selections = event.format === "teams" ? event.teamIds ?? [] : event.playerIds ?? [];
  const game = state.games[event.gameId];
  const open = isBettingOpen(event);
  const currentTeamId = state.players[state.currentPlayerId].teamId;
  const existingTicket = state.bets.find((bet) => bet.eventId === event.id && bet.teamId === currentTeamId && bet.status === "open");
  const existingExposure = existingTicket?.stake ?? 0;
  const restrictionReason = getBetRestrictionReason(state, event, state.currentPlayerId);

  function placeBet() {
    if (!selection) return;
    if (!canPlayerBet(state, event, selection, state.currentPlayerId)) {
      notify("That wager conflicts with the teammate and self-bet rules.");
      return;
    }
    dispatch({ type: "PLACE_BET", eventId: event.id, selectionId: selection, stake });
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
      <p className="event-time"><CalendarBlank size={17} /> {formatDate(event.scheduledAt)}</p>
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
                <strong>{formatAmericanOdds(event.odds[id])}</strong>
              </button>
            );
          })}
        </div>
      ) : <div className="no-market"><ShieldCheck size={20} /> Results only. Mario Party has no betting market.</div>}

      {game.bettable && open && restrictionReason && <div className="bet-restriction"><ShieldCheck size={18} weight="fill" />{restrictionReason}</div>}

      {selection && open && (
        <div className="bet-slip">
          <div>
            <label htmlFor={`stake-${event.id}`}>Wager</label>
            <select id={`stake-${event.id}`} value={stake} onChange={(e) => setStake(Number(e.target.value))}>
              {[25_000, 50_000, 100_000, 250_000, 500_000]
                .filter((value) => value >= state.settings.minimumBet && value <= state.settings.maximumBet)
                .map((value) => <option value={value} key={value}>{formatMoney(value)}</option>)}
            </select>
          </div>
          <div className="to-win"><span>Total return</span><strong>{formatMoney(stake * event.odds[selection])}</strong></div>
          <button className="primary-button" onClick={placeBet}>{existingTicket ? "Update ticket" : "Place wager"}</button>
        </div>
      )}
      {existingExposure > 0 && <p className="exposure"><Receipt size={15} /> {state.teams[currentTeamId].name} has {formatMoney(existingExposure)} on this market, last changed by {state.players[existingTicket!.placedBy].name}</p>}
    </article>
  );
}

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function LiveRoundBuilder({ notify }: { notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const [gameId, setGameId] = useState<GameId>("smash");
  const [format, setFormat] = useState<"teams" | "free-for-all">("teams");
  const [teamA, setTeamA] = useState<TeamId>("jason-ezra");
  const [teamB, setTeamB] = useState<TeamId>("corey-jimmy");
  const [selectedPlayers, setSelectedPlayers] = useState<PlayerId[]>(["jason", "corey", "brandon", "bruce"]);
  const [bettingSeconds, setBettingSeconds] = useState(90);
  const [error, setError] = useState("");

  function togglePlayer(playerId: PlayerId) {
    setSelectedPlayers((current) => current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId]);
  }

  function openRound(event: FormEvent) {
    event.preventDefault();
    if (format === "teams" && teamA === teamB) {
      setError("Choose two different teams.");
      return;
    }
    if (format === "free-for-all" && (selectedPlayers.length < 2 || selectedPlayers.length > 4)) {
      setError("Choose two to four players.");
      return;
    }
    dispatch({
      type: "CREATE_LIVE_EVENT",
      payload: {
        gameId,
        format,
        teamIds: format === "teams" ? [teamA, teamB] : undefined,
        playerIds: format === "free-for-all" ? selectedPlayers : undefined,
        bettingSeconds,
      },
    });
    notify("Round posted. The betting window is open.");
  }

  return (
    <form className="live-builder" onSubmit={openRound}>
      <div className="live-builder-title">
        <div><span>Next round</span><h2>Build the matchup</h2></div>
        <Target size={30} weight="bold" />
      </div>
      <div className="live-builder-grid">
        <label>Game<select value={gameId} onChange={(event) => setGameId(event.target.value as GameId)}>{GAME_IDS.map((id) => <option key={id} value={id}>{state.games[id].name}</option>)}</select></label>
        <label>Betting window<select value={bettingSeconds} onChange={(event) => setBettingSeconds(Number(event.target.value))}><option value={60}>60 seconds</option><option value={90}>90 seconds</option><option value={120}>2 minutes</option></select></label>
      </div>
      <fieldset>
        <legend>Match format</legend>
        <div className="segmented"><button type="button" className={format === "teams" ? "active" : ""} onClick={() => setFormat("teams")}>Fixed teams</button><button type="button" className={format === "free-for-all" ? "active" : ""} onClick={() => setFormat("free-for-all")}>Free for all</button></div>
      </fieldset>
      {format === "teams" ? (
        <div className="live-builder-grid">
          <label>Team one<select value={teamA} onChange={(event) => setTeamA(event.target.value as TeamId)}>{TEAM_IDS.map((id) => <option key={id} value={id}>{state.teams[id].name}</option>)}</select></label>
          <label>Team two<select value={teamB} onChange={(event) => setTeamB(event.target.value as TeamId)}>{TEAM_IDS.map((id) => <option key={id} value={id}>{state.teams[id].name}</option>)}</select></label>
        </div>
      ) : (
        <fieldset>
          <legend>Players <small>{selectedPlayers.length}/4 selected</small></legend>
          <div className="player-check-grid">{PLAYER_IDS.map((id) => <button type="button" className={selectedPlayers.includes(id) ? "selected" : ""} onClick={() => togglePlayer(id)} key={id}><span>{state.players[id].name}</span>{selectedPlayers.includes(id) && <Check size={17} weight="bold" />}</button>)}</div>
        </fieldset>
      )}
      {error && <p className="form-error">{error}</p>}
      <button className="primary-button full" type="submit"><Plus size={18} weight="bold" /> Open betting</button>
    </form>
  );
}

function LiveResultControls({ event, notify }: { event: ScheduledEvent; notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const [winner, setWinner] = useState<string>(event.teamIds?.[0] ?? "");
  const [order, setOrder] = useState<PlayerId[]>(event.playerIds ?? []);

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

  function settle() {
    if (event.format === "teams") dispatch({ type: "SETTLE_TEAM_EVENT", eventId: event.id, winningTeamId: winner as TeamId });
    else dispatch({ type: "SETTLE_FFA_EVENT", eventId: event.id, orderedPlayerIds: order });
    notify("Round settled. Banks and ratings are updated.");
  }

  return (
    <div className="live-result">
      <div className="in-play-banner"><span>Match in play</span><strong><ParticipantNames event={event} /></strong><GameBadge gameId={event.gameId} /></div>
      {event.format === "teams" ? (
        <fieldset><legend>Tap the winner</legend><div className="winner-grid">{event.teamIds?.map((teamId) => <button type="button" className={winner === teamId ? "selected" : ""} onClick={() => setWinner(teamId)} key={teamId}><Trophy size={21} weight={winner === teamId ? "fill" : "regular"} />{state.teams[teamId].name}</button>)}</div></fieldset>
      ) : (
        <fieldset><legend>Set the final order</legend><div className="ranking-editor">{order.map((playerId, index) => <div key={playerId}><strong>{index + 1}</strong><span>{state.players[playerId].name}</span><div><button type="button" disabled={index === 0} onClick={() => move(playerId, -1)} aria-label={`Move ${state.players[playerId].name} up`}>Up</button><button type="button" disabled={index === order.length - 1} onClick={() => move(playerId, 1)} aria-label={`Move ${state.players[playerId].name} down`}>Down</button></div></div>)}</div></fieldset>
      )}
      <div className="payout-note"><Bank size={20} /><span>House purse</span><strong>{formatMoney(state.settings.payouts[event.gameId])}</strong></div>
      <button className="primary-button full" onClick={settle}><Check size={18} weight="bold" /> Settle round</button>
    </div>
  );
}

function SettlementRecap({ event, notify }: { event: ScheduledEvent; notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const winnerName = event.format === "teams"
    ? state.teams[event.result!.winningTeamId!].name
    : state.players[event.result!.orderedPlayerIds![0]].name;
  const tickets = state.bets.filter((bet) => bet.eventId === event.id && ["won", "lost"].includes(bet.status));
  const standings = TEAM_IDS.map((id) => ({ id, balance: state.balances[id] })).sort((a, b) => b.balance - a.balance);
  return (
    <div className="settlement-recap">
      <div className="settlement-winner"><Medal size={36} weight="fill" /><span>Round settled</span><h2>{winnerName} wins</h2><p>{state.games[event.gameId].name} moved {formatMoney(state.settings.payouts[event.gameId])} through the house purse.</p></div>
      <div className="settlement-grid">
        <div><h3>Team banks</h3>{standings.map((team, index) => <div className="mini-standing" key={team.id}><span>{index + 1}. {state.teams[team.id].name}</span><strong>{formatMoney(team.balance)}</strong></div>)}</div>
        <div><h3>Wager settlement</h3>{tickets.length ? tickets.map((bet) => <div className="mini-standing" key={bet.id}><span>{state.teams[bet.teamId].name} <small>{bet.status}</small></span><strong className={bet.status === "won" ? "positive" : "negative"}>{bet.status === "won" ? `+${formatMoney(bet.payout - bet.stake)}` : `-${formatMoney(bet.stake)}`}</strong></div>) : <p className="no-tickets">No team tickets were placed.</p>}</div>
      </div>
      <div className="next-round-actions">
        <button className="primary-button" onClick={() => { dispatch({ type: "RUN_IT_BACK", eventId: event.id, bettingSeconds: 90 }); notify("Run it back. Betting is open for 90 seconds."); }}><Repeat size={18} weight="bold" /> Run it back</button>
        <button className="secondary-button" onClick={() => dispatch({ type: "DISMISS_RECAP" })}><Plus size={18} /> New matchup</button>
      </div>
    </div>
  );
}

function GameNightView({ notify }: { notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const now = useNow();
  const night = state.gameNight!;
  const activeEvent = night.activeEventId ? state.events.find((event) => event.id === night.activeEventId) : undefined;
  const recapEvent = night.lastSettledEventId ? state.events.find((event) => event.id === night.lastSettledEventId) : undefined;
  const player = state.players[state.currentPlayerId];
  const team = state.teams[player.teamId];
  const secondsLeft = activeEvent?.bettingClosesAt ? Math.max(0, Math.floor((new Date(activeEvent.bettingClosesAt).getTime() - now) / 1000)) : 0;
  const completedCount = night.eventIds.filter((id) => state.events.find((event) => event.id === id)?.status === "completed").length;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeEvent?.id, activeEvent?.status, recapEvent?.id]);
  return (
    <div className="page page-enter game-night-page">
      <div className="night-header">
        <div><p className="eyebrow">Game Night live</p><h1>The desk is open.</h1><p>Round {completedCount + 1}. One market, one result, then keep moving.</p></div>
        <div className="night-bank"><span>{team.name}</span><strong>{formatMoney(state.balances[team.id])}</strong></div>
      </div>
      <div className="night-status-strip"><span><Clock size={17} /> Started {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(night.startedAt))}</span><strong>{completedCount} rounds settled</strong>{state.currentPlayerId === "jimmy" && !activeEvent && <button onClick={() => dispatch({ type: "END_GAME_NIGHT" })}>End Game Night</button>}</div>

      {activeEvent?.status === "betting" && (
        <section className="live-market">
          <div className="live-market-clock"><div><span>Betting window</span><strong>{secondsLeft > 0 ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` : "Closed"}</strong></div><p>{secondsLeft > 0 ? "Place or update the team ticket before play begins." : "The timer expired. Start the match when the controllers are ready."}</p></div>
          <EventCard event={activeEvent} notify={notify} />
          <div className="live-market-actions"><button className="primary-button" onClick={() => { dispatch({ type: "START_MATCH", eventId: activeEvent.id }); notify("Betting locked. Match in play."); }}><Play size={18} weight="fill" /> Start match</button>{state.currentPlayerId === "jimmy" && <button className="danger-button" onClick={() => dispatch({ type: "CANCEL_EVENT", eventId: activeEvent.id })}>Cancel round</button>}</div>
        </section>
      )}
      {activeEvent?.status === "in-progress" && <LiveResultControls event={activeEvent} notify={notify} />}
      {!activeEvent && recapEvent && <SettlementRecap event={recapEvent} notify={notify} />}
      {!activeEvent && !recapEvent && <LiveRoundBuilder notify={notify} />}
    </div>
  );
}

function NightSummary() {
  const { state, dispatch } = useStore();
  const night = state.gameNight!;
  const completedEvents = night.eventIds.map((id) => state.events.find((event) => event.id === id)).filter((event): event is ScheduledEvent => event?.status === "completed");
  const tickets = state.bets.filter((bet) => night.eventIds.includes(bet.eventId));
  const biggest = [...tickets].sort((a, b) => b.stake - a.stake)[0];
  const gameCounts = GAME_IDS.map((gameId) => ({ gameId, count: completedEvents.filter((event) => event.gameId === gameId).length })).filter((item) => item.count > 0);
  const standings = TEAM_IDS.map((id) => ({ id, balance: state.balances[id] })).sort((a, b) => b.balance - a.balance);
  return (
    <div className="page page-enter night-summary">
      <div className="summary-hero"><p className="eyebrow">Final horn</p><h1>Game Night complete.</h1><p>{completedEvents.length} rounds settled across {gameCounts.length} games.</p></div>
      <div className="summary-metrics"><div><span>Rounds</span><strong>{completedEvents.length}</strong></div><div><span>Biggest ticket</span><strong>{biggest ? formatMoney(biggest.stake) : "$0"}</strong></div><div><span>Bank leader</span><strong>{state.teams[standings[0].id].name}</strong></div></div>
      <div className="summary-columns"><div><h2>Final banks</h2>{standings.map((team, index) => <div className="summary-row" key={team.id}><strong>{index + 1}</strong><span>{state.teams[team.id].name}</span><b>{formatMoney(team.balance)}</b></div>)}</div><div><h2>Games played</h2>{gameCounts.length ? gameCounts.map(({ gameId, count }) => <div className="summary-row" key={gameId}><GameBadge gameId={gameId} /><span>{state.games[gameId].name}</span><b>{count}</b></div>) : <p>No completed rounds.</p>}</div></div>
      <button className="primary-button" onClick={() => dispatch({ type: "START_GAME_NIGHT" })}><Play size={18} weight="fill" /> Start another night</button>
    </div>
  );
}

function SchedulePanel({ onDone, notify }: { onDone: () => void; notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const [gameId, setGameId] = useState<GameId>("smash");
  const [format, setFormat] = useState<"teams" | "free-for-all">("teams");
  const [teamA, setTeamA] = useState<TeamId>("jason-ezra");
  const [teamB, setTeamB] = useState<TeamId>("corey-jimmy");
  const [selectedPlayers, setSelectedPlayers] = useState<PlayerId[]>(["jason", "corey"]);
  const defaultTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
  defaultTime.setMinutes(0, 0, 0);
  const [scheduledAt, setScheduledAt] = useState(defaultTime.toISOString().slice(0, 16));
  const [error, setError] = useState("");

  function togglePlayer(playerId: PlayerId) {
    setSelectedPlayers((current) => current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId]);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (new Date(scheduledAt).getTime() <= Date.now()) {
      setError("Choose a future start time.");
      return;
    }
    if (format === "teams" && teamA === teamB) {
      setError("Select two different teams.");
      return;
    }
    if (format === "free-for-all" && (selectedPlayers.length < 2 || selectedPlayers.length > 4)) {
      setError("Select two to four players.");
      return;
    }
    dispatch({
      type: "SCHEDULE_EVENT",
      payload: {
        gameId,
        format,
        scheduledAt: new Date(scheduledAt).toISOString(),
        teamIds: format === "teams" ? [teamA, teamB] : undefined,
        playerIds: format === "free-for-all" ? selectedPlayers : undefined,
      },
    });
    notify("Event scheduled and opening odds posted.");
    onDone();
  }

  return (
    <form className="schedule-panel" onSubmit={submit}>
      <div className="panel-title"><div><h2>Schedule event</h2><p>Lines close automatically at the listed start time.</p></div><button type="button" className="icon-button" onClick={onDone} aria-label="Close"><X size={22} /></button></div>
      <div className="form-grid">
        <label>Game<select value={gameId} onChange={(e) => setGameId(e.target.value as GameId)}>{GAME_IDS.map((id) => <option value={id} key={id}>{state.games[id].name}</option>)}</select></label>
        <label>Start time<input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} /></label>
      </div>
      <fieldset>
        <legend>Format</legend>
        <div className="segmented">
          <button type="button" className={format === "teams" ? "active" : ""} onClick={() => setFormat("teams")}>Fixed teams</button>
          <button type="button" className={format === "free-for-all" ? "active" : ""} onClick={() => setFormat("free-for-all")}>Free for all</button>
        </div>
      </fieldset>
      {format === "teams" ? (
        <div className="form-grid">
          <label>Team one<select value={teamA} onChange={(e) => setTeamA(e.target.value as TeamId)}>{TEAM_IDS.map((id) => <option value={id} key={id}>{state.teams[id].name}</option>)}</select></label>
          <label>Team two<select value={teamB} onChange={(e) => setTeamB(e.target.value as TeamId)}>{TEAM_IDS.map((id) => <option value={id} key={id}>{state.teams[id].name}</option>)}</select></label>
        </div>
      ) : (
        <fieldset>
          <legend>Players <small>{selectedPlayers.length}/4 selected</small></legend>
          <div className="player-check-grid">
            {PLAYER_IDS.map((id) => <button type="button" className={selectedPlayers.includes(id) ? "selected" : ""} onClick={() => togglePlayer(id)} key={id}><span>{state.players[id].name}</span>{selectedPlayers.includes(id) && <Check size={17} weight="bold" />}</button>)}
          </div>
        </fieldset>
      )}
      {error && <p className="form-error">{error}</p>}
      <button className="primary-button full" type="submit">Post event</button>
    </form>
  );
}

function EventsView({ notify }: { notify: (message: string) => void }) {
  const { state } = useStore();
  const [scheduling, setScheduling] = useState(false);
  const [filter, setFilter] = useState<"open" | "history">("open");
  const events = [...state.events]
    .filter((event) => filter === "open" ? event.status === "scheduled" : ["completed", "cancelled"].includes(event.status))
    .sort((a, b) => filter === "open" ? a.scheduledAt.localeCompare(b.scheduledAt) : b.scheduledAt.localeCompare(a.scheduledAt));
  return (
    <div className="page page-enter">
      <div className="page-header">
        <div><p className="eyebrow">Market board</p><h1>Events</h1><p>Every line is priced from game form and overall player rating.</p></div>
        <button className="primary-button" onClick={() => setScheduling(true)}><Plus size={18} weight="bold" /> Schedule</button>
      </div>
      <div className="tabs"><button className={filter === "open" ? "active" : ""} onClick={() => setFilter("open")}>Upcoming</button><button className={filter === "history" ? "active" : ""} onClick={() => setFilter("history")}>History</button></div>
      {scheduling && <SchedulePanel onDone={() => setScheduling(false)} notify={notify} />}
      <div className="event-list">
        {events.map((event) => <EventCard event={event} notify={notify} key={event.id} />)}
        {!events.length && <EmptyState icon={CalendarBlank} title="No events here" body={filter === "open" ? "Schedule the next game to open a market." : "Completed and cancelled games will appear here."} />}
      </div>
    </div>
  );
}

function ResultEntry({ event, notify }: { event: ScheduledEvent; notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const [winner, setWinner] = useState<string>(event.format === "teams" ? event.teamIds?.[0] ?? "" : "");
  const [order, setOrder] = useState<PlayerId[]>(event.playerIds ?? []);
  const [expanded, setExpanded] = useState(false);

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

  function submit() {
    if (event.format === "teams") dispatch({ type: "SETTLE_TEAM_EVENT", eventId: event.id, winningTeamId: winner as TeamId });
    else dispatch({ type: "SETTLE_FFA_EVENT", eventId: event.id, orderedPlayerIds: order });
    notify("Result logged. Payouts and wagers are settled.");
  }

  return (
    <article className="result-entry">
      <button className="result-summary" onClick={() => setExpanded(!expanded)}>
        <div><GameBadge gameId={event.gameId} /><h3><ParticipantNames event={event} /></h3><span>{formatDate(event.scheduledAt)}</span></div>
        <span className="report-label">Report <CaretRight className={expanded ? "rotated" : ""} size={18} /></span>
      </button>
      {expanded && (
        <div className="result-form">
          {event.format === "teams" ? (
            <fieldset><legend>Winner</legend><div className="winner-grid">{event.teamIds?.map((teamId) => <button type="button" className={winner === teamId ? "selected" : ""} onClick={() => setWinner(teamId)} key={teamId}><Trophy size={20} weight={winner === teamId ? "fill" : "regular"} />{state.teams[teamId].name}</button>)}</div></fieldset>
          ) : (
            <fieldset><legend>Final order</legend><div className="ranking-editor">{order.map((playerId, index) => <div key={playerId}><strong>{index + 1}</strong><span>{state.players[playerId].name}</span><div><button type="button" disabled={index === 0} onClick={() => move(playerId, -1)} aria-label={`Move ${state.players[playerId].name} up`}>Up</button><button type="button" disabled={index === order.length - 1} onClick={() => move(playerId, 1)} aria-label={`Move ${state.players[playerId].name} down`}>Down</button></div></div>)}</div></fieldset>
          )}
          <div className="payout-note"><Bank size={20} /><span>House payout</span><strong>{formatMoney(state.settings.payouts[event.gameId])}</strong></div>
          <button className="primary-button full" onClick={submit}>Settle result</button>
        </div>
      )}
    </article>
  );
}

function LogView({ notify, onHome }: { notify: (message: string) => void; onHome: () => void }) {
  const { state } = useStore();
  const liveNight = state.gameNight?.status === "active" ? state.gameNight : undefined;
  const scheduled = [...state.events].filter((event) => event.status === "scheduled").sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  if (liveNight) {
    const completed = liveNight.eventIds
      .map((id) => state.events.find((event) => event.id === id))
      .filter((event): event is ScheduledEvent => event?.status === "completed")
      .reverse();
    return (
      <div className="page page-enter">
        <div className="page-header"><div><p className="eyebrow">Game Night record</p><h1>Results</h1><p>Live rounds are settled from the current matchup on Home.</p></div><button className="primary-button" onClick={onHome}>Return to live round</button></div>
        <div className="result-list">
          {completed.map((event) => <article className="result-entry" key={event.id}><div className="result-summary"><div><GameBadge gameId={event.gameId} /><h3><ParticipantNames event={event} /></h3><span>{formatDate(event.scheduledAt)}</span></div><span className="settled-label"><Check size={18} weight="bold" /> Settled</span></div></article>)}
          {!completed.length && <EmptyState icon={Trophy} title="No settled rounds yet" body="Completed matches will appear here as the night moves." />}
        </div>
      </div>
    );
  }
  return (
    <div className="page page-enter">
      <div className="page-header"><div><p className="eyebrow">Official results</p><h1>Log a result</h1><p>Anyone can report the final order. Settlement happens immediately.</p></div></div>
      <div className="notice"><ShieldCheck size={22} weight="fill" /><p><strong>Honor system active.</strong> Result confirmation will be added when player accounts go live.</p></div>
      <div className="result-list">
        {scheduled.map((event) => <ResultEntry event={event} notify={notify} key={event.id} />)}
        {!scheduled.length && <EmptyState icon={Trophy} title="All caught up" body="Schedule another event before logging its result." />}
      </div>
    </div>
  );
}

function LeaderboardsView() {
  const { state } = useStore();
  const [gameId, setGameId] = useState<GameId>("smash");
  const records = getGameRecords(state, gameId);
  return (
    <div className="page page-enter">
      <div className="page-header"><div><p className="eyebrow">Power ratings</p><h1>Leaderboards</h1><p>Each table is game-specific. Odds also carry 25% of a player's overall rating.</p></div></div>
      <div className="game-tabs" role="tablist">
        {GAME_IDS.map((id) => { const Icon = ICONS[id]; return <button role="tab" aria-selected={gameId === id} className={gameId === id ? "active" : ""} onClick={() => setGameId(id)} key={id}><Icon size={19} />{state.games[id].shortName}</button>; })}
      </div>
      <div className="leaderboard">
        <div className="leaderboard-head"><span>Rank</span><span>Player</span><span>Record</span><span>Rating</span></div>
        {records.map((record, index) => {
          const player = state.players[record.playerId];
          return (
            <div className="leader-row" key={record.playerId}>
              <strong className={`rank rank-${index + 1}`}>{index + 1}</strong>
              <div className="leader-player"><span className="avatar">{player.name.slice(0, 1)}</span><div><strong>{player.name}</strong><small>{state.teams[player.teamId].name}</small></div></div>
              <span className="record">{record.wins}-{record.losses}</span>
              <strong className="rating">{Math.round(record.rating)}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BetHistory() {
  const { state } = useStore();
  const teamId = state.players[state.currentPlayerId].teamId;
  const bets = state.bets.filter((bet) => bet.teamId === teamId);
  if (!bets.length) return <EmptyState icon={Receipt} title="No wagers yet" body="Your team’s accepted wagers will appear here." />;
  return (
    <div className="bet-history">
      {bets.map((bet) => {
        const event = state.events.find((item) => item.id === bet.eventId)!;
        const label = event.format === "teams" ? state.teams[bet.selectionId as TeamId].name : state.players[bet.selectionId as PlayerId].name;
        return <div key={bet.id}><span className={`bet-state ${bet.status}`}>{bet.status}</span><div><strong>{label}</strong><small>{state.games[event.gameId].name} at {formatAmericanOdds(bet.decimalOdds)}</small></div><div className="bet-money"><strong>{formatMoney(bet.stake)}</strong><small>{bet.status === "won" ? `${formatMoney(bet.payout)} returned` : formatDate(bet.placedAt)}</small></div></div>;
      })}
    </div>
  );
}

function AdminPanel({ notify }: { notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const [settings, setSettings] = useState<AppSettings>(state.settings);
  const [adjustTeam, setAdjustTeam] = useState<TeamId>(TEAM_IDS[0]);
  const [adjustment, setAdjustment] = useState(100_000);

  function saveSettings(event: FormEvent) {
    event.preventDefault();
    dispatch({ type: "UPDATE_SETTINGS", settings });
    notify("League economy updated.");
  }

  return (
    <section className="admin-panel">
      <div className="admin-title"><ShieldCheck size={24} weight="fill" /><div><h2>Commissioner controls</h2><p>Visible only while Jimmy is selected.</p></div></div>
      <form onSubmit={saveSettings}>
        <h3>Economy</h3>
        <div className="admin-grid">
          <label>Minimum bet<input type="number" step="5000" value={settings.minimumBet} onChange={(e) => setSettings({ ...settings, minimumBet: Number(e.target.value) })} /></label>
          <label>Maximum bet<input type="number" step="25000" value={settings.maximumBet} onChange={(e) => setSettings({ ...settings, maximumBet: Number(e.target.value) })} /></label>
          {GAME_IDS.map((gameId) => <label key={gameId}>{state.games[gameId].shortName} payout<input type="number" step="50000" value={settings.payouts[gameId]} onChange={(e) => setSettings({ ...settings, payouts: { ...settings.payouts, [gameId]: Number(e.target.value) } })} /></label>)}
        </div>
        <button className="secondary-button" type="submit">Save economy</button>
      </form>
      <div className="admin-block">
        <h3>Bank adjustment</h3>
        <div className="adjust-row"><select value={adjustTeam} onChange={(e) => setAdjustTeam(e.target.value as TeamId)}>{TEAM_IDS.map((id) => <option value={id} key={id}>{state.teams[id].name}</option>)}</select><input type="number" step="50000" value={adjustment} onChange={(e) => setAdjustment(Number(e.target.value))} /><button className="secondary-button" onClick={() => { dispatch({ type: "ADJUST_BALANCE", teamId: adjustTeam, amount: adjustment, note: "Commissioner adjustment" }); notify("Team balance adjusted."); }}>Apply</button></div>
      </div>
      <div className="admin-block">
        <h3>Scheduled events</h3>
        <div className="admin-events">{state.events.filter((event) => event.status === "scheduled").map((event) => <div key={event.id}><span><strong>{state.games[event.gameId].shortName}</strong><small><ParticipantNames event={event} /></small></span><div><button onClick={() => { dispatch({ type: "REOPEN_EVENT", eventId: event.id }); notify("Betting reopened for one hour."); }}>Reopen 1 hr</button><button className="danger" onClick={() => { dispatch({ type: "CANCEL_EVENT", eventId: event.id }); notify("Event cancelled. Open wagers were refunded."); }}>Cancel</button></div></div>)}</div>
      </div>
      <button className="danger-button" onClick={() => { if (window.confirm("Reset all BranDuel test data?")) { dispatch({ type: "RESET" }); notify("Test data reset."); } }}>Reset test data</button>
    </section>
  );
}

function BankView({ notify }: { notify: (message: string) => void }) {
  const { state } = useStore();
  const player = state.players[state.currentPlayerId];
  const team = state.teams[player.teamId];
  const entries = state.ledger.filter((entry) => entry.teamId === team.id);
  const [tab, setTab] = useState<"activity" | "bets">("activity");
  return (
    <div className="page page-enter">
      <div className="bank-page-head"><div><p className="eyebrow">Team treasury</p><h1>{team.name}</h1><span>Shared cash balance</span></div><strong>{formatMoney(state.balances[team.id])}</strong></div>
      <div className="bank-kpis"><div><span>Game earnings</span><strong>{formatMoney(entries.filter((e) => e.type === "game-payout").reduce((sum, e) => sum + e.amount, 0))}</strong></div><div><span>Open exposure</span><strong>{formatMoney(state.bets.filter((b) => b.teamId === team.id && b.status === "open").reduce((sum, b) => sum + b.stake, 0))}</strong></div></div>
      <div className="tabs"><button className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>Activity</button><button className={tab === "bets" ? "active" : ""} onClick={() => setTab("bets")}>Wagers</button></div>
      {tab === "activity" ? (
        entries.length ? <div className="ledger">{entries.map((entry) => <div key={entry.id}><span className={`ledger-icon ${entry.amount >= 0 ? "positive" : "negative"}`}>{entry.amount >= 0 ? <Plus size={18} /> : <Receipt size={18} />}</span><div><strong>{entry.description}</strong><small>{formatDate(entry.createdAt)}</small></div><strong className={entry.amount >= 0 ? "positive" : "negative"}>{entry.amount >= 0 ? "+" : ""}{formatMoney(entry.amount)}</strong></div>)}</div> : <EmptyState icon={Bank} title="No activity yet" body="Game payouts, wagers, refunds, and adjustments will appear here." />
      ) : <BetHistory />}
      {state.currentPlayerId === "jimmy" && <AdminPanel notify={notify} />}
    </div>
  );
}

export function App() {
  const [view, setView] = useState<View>("home");
  const [toast, setToast] = useState("");
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  };
  const content = useMemo(() => {
    if (view === "home") return <HomeView onView={setView} notify={notify} />;
    if (view === "events") return <EventsView notify={notify} />;
    if (view === "log") return <LogView notify={notify} onHome={() => setView("home")} />;
    if (view === "leaderboards") return <LeaderboardsView />;
    return <BankView notify={notify} />;
  }, [view]);

  return (
    <Shell view={view} onView={setView}>
      {content}
      {toast && <div className="toast" role="status"><Check size={19} weight="bold" />{toast}</div>}
    </Shell>
  );
}
