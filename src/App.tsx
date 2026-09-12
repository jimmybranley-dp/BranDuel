import { useEffect, useMemo, useState, type ComponentType, type FormEvent } from "react";
import {
  ArrowArcLeft,
  Bank,
  Bug,
  CalendarBlank,
  ChartBar,
  Check,
  Circle,
  Clock,
  DiceFive,
  FlagCheckered,
  Football,
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
import { maxFreeForAllPlayers, PLAYER_IDS, TEAM_IDS } from "./data";
import { buildSettlementPreview, type SettlementPreview } from "./settlement";
import {
  canPlayerBet,
  formatAmericanOdds,
  formatMoney,
  getBetRestrictionReason,
  getGameRecords,
  isBettingOpen,
} from "./engine";
import { useStore } from "./store";
import type { AppSettings, GameId, PlayerId, ScheduledEvent, TeamId } from "./types";
import { MAX_ACTIVE_EVENTS } from "./domain";
import brandLogoBlue from "./assets/branduel-logo-blue.png";
import brandLogoWhite from "./assets/branduel-logo-white.png";

type View = "home" | "events" | "log" | "leaderboards" | "bank";

const ICONS: Partial<Record<GameId, ComponentType<IconProps>>> = {
  smash: Sword,
  boomerang: ArrowArcLeft,
  worms: Bug,
  "mario-party": DiceFive,
  "mario-kart": FlagCheckered,
  "nfl-blitz": Football,
  billiards: Circle,
};

const NAV: Array<{ id: View; label: string; icon: ComponentType<IconProps> }> = [
  { id: "home", label: "Home", icon: House },
  { id: "log", label: "Log Result", icon: Trophy },
  { id: "leaderboards", label: "Leaders", icon: ChartBar },
  { id: "bank", label: "Team Bank", icon: Wallet },
];

function BrandMark({ darkSurface = false }: { darkSurface?: boolean }) {
  return (
    <div className="brand-lockup" aria-label="BranDuel">
      {darkSurface ? <img className="brand-logo" src={brandLogoWhite} alt="BranDuel" /> : <picture>
        <source media="(prefers-color-scheme: light)" srcSet={brandLogoBlue} />
        <img className="brand-logo" src={brandLogoWhite} alt="BranDuel" />
      </picture>}
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

function GameBadge({ gameId }: { gameId: GameId }) {
  const { state } = useStore();
  const Icon = ICONS[gameId] ?? Target;
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
    return <>{event.teamIds.map((teamId, index) => <span key={teamId}>{index > 0 && <> <span className="versus">vs</span> </>}{state.teams[teamId].name}</span>)}</>;
  }
  return <>{event.playerIds?.map((id) => state.players[id].name).join(", ")}</>;
}

function PlayerPicker() {
  const { logout, busy, pending } = useStore();
  return (
    <button className="player-picker" disabled={busy || !!pending} onClick={() => void logout()}>
      <UserCircle size={20} weight="fill" />
      Sign out
    </button>
  );
}

function LoginScreen() {
  const { state, login, pending, busy, error } = useStore();
  const [player, setPlayer] = useState<PlayerId | "">(pending?.playerId ?? "");
  const [passcode, setPasscode] = useState("");
  return <div className="login-page"><BrandMark /><form className="login-card" onSubmit={async (e) => { e.preventDefault(); if (player && await login(player, passcode)) setPasscode(""); }}>
    <h1>Take your seat.</h1><p>Choose your name. Your name is also your password.</p>
    {pending && <p className="notice">A request from {state.players[pending.playerId].name} needs confirmation. Sign in with that account to recover it.</p>}
    <label>Player<select required autoComplete="username" value={player} disabled={busy || !!pending} onChange={(e) => setPlayer(e.target.value as PlayerId)}><option value="">Choose your name</option>{PLAYER_IDS.map((id) => <option value={id} key={id}>{state.players[id].name}</option>)}</select></label>
    <label>Passcode<input required type="password" autoComplete="current-password" value={passcode} disabled={busy} onChange={(e) => setPasscode(e.target.value)} /></label>
    {error && <p role="alert" className="form-error">{error}</p>}
    <button className="primary-button full" disabled={!player || !passcode || busy}>{busy ? "Signing in..." : "Sign in"}</button>
  </form></div>;
}

function RequestStatus() {
  const { pending, busy, error, syncStatus, lastSync, retryPending, refresh } = useStore();
  if (!pending && !error && syncStatus === "shared") return null;
  return <div className="request-status" role="status" aria-live="polite">
    <strong>{busy ? "Waiting for the house to confirm..." : pending ? "This request needs confirmation" : syncStatus !== "shared" ? "Showing the last confirmed state" : "Request not accepted"}</strong>
    {error && <p>{error}</p>}
    {pending && <p>Saved {formatDate(pending.createdAt)}. Changes are locked until this receipt is resolved. Refreshing the page keeps the receipt.</p>}
    {lastSync && <small>Last synchronized: {new Date(lastSync).toLocaleTimeString()}</small>}
    <div>{pending && <button className="primary-button" disabled={busy} onClick={() => void retryPending()}>Resolve saved request</button>}<button className="secondary-button" disabled={busy} onClick={() => void refresh()}>Refresh confirmed state</button></div>
  </div>;
}

function exportData(data: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}

function RecoveryPanel({ notify }: { notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const [correcting, setCorrecting] = useState("");
  const unfinished = state.events.filter((event) => ["scheduled", "betting", "in-progress"].includes(event.status));
  const completed = state.events.filter((event) => event.status === "completed" && state.gameNight?.status === "active" && state.gameNight.eventIds.includes(event.id));
  const selected = completed.find((event) => event.id === correcting);
  return <section className="recovery-panel"><h2>Commissioner recovery</h2>
    <div className="recovery-actions"><button className="secondary-button" onClick={async () => { if (await dispatch({ type: "PAUSE_BETTING", paused: !state.bettingPaused })) notify(state.bettingPaused ? "Betting resumed within the existing deadlines." : "All new wagers are paused."); }}>{state.bettingPaused ? "Resume betting" : "Pause all betting"}</button><button className="secondary-button" onClick={() => exportData(state, `branduel-${state.gameNight?.id ?? "event"}.json`)}>Export confirmed data</button></div>
    {state.bettingPaused && <p className="notice">All new wagers are paused. Existing deadlines still apply.</p>}
    <div className="admin-events">{unfinished.map((event) => <div key={event.id}><span><strong>{state.games[event.gameId].shortName} / {event.status}</strong><small><ParticipantNames event={event} /></small></span><div>
      {event.status === "scheduled" && (state.gameNight?.activeEventIds?.length ?? (state.gameNight?.activeEventId ? 1 : 0)) < MAX_ACTIVE_EVENTS && <button onClick={async () => { if (await dispatch({ type: "REOPEN_EVENT", eventId: event.id, bettingSeconds: 60 })) notify("Draft opened. Betting closes in 60 seconds."); }}>Open for 60s</button>}
      <button className="danger" onClick={async () => { const reason = window.prompt("Void this round and refund its open wagers? Enter the reason:"); if (reason?.trim() && await dispatch({ type: "CANCEL_EVENT", eventId: event.id, reason })) notify("Round voided. Open wagers refunded."); }}>Void / refund</button>
    </div></div>)}</div>
    {completed.length > 0 && <label>Correct a settled round<select value={correcting} onChange={(e) => setCorrecting(e.target.value)}><option value="">Select a round</option>{completed.map((event) => <option key={event.id} value={event.id}>{state.games[event.gameId].shortName} / {formatDate(event.createdAt)} / {event.id.slice(-6)}</option>)}</select></label>}
    {selected && <><LiveResultControls key={selected.id} event={selected} notify={(message) => { notify(message); setCorrecting(""); }} correction /><button className="danger-button" onClick={async () => { const reason = window.prompt("Void this completed round? Its result and payouts will be reversed and tickets refunded. Enter the reason:"); if (reason?.trim() && await dispatch({ type: "CANCEL_EVENT", eventId: selected.id, reason })) { notify("Completed round voided. Payouts reversed and tickets refunded."); setCorrecting(""); } }}>Void completed round / refund</button></>}
  </section>;
}

function Shell({ view, onView, children }: { view: View; onView: (view: View) => void; children: React.ReactNode }) {
  const { state, syncStatus, canWrite } = useStore();
  const player = state.players[state.currentPlayerId];
  const liveNight = state.gameNight?.status === "active";
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <BrandMark darkSurface />
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
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="mobile-brand"><BrandMark /></div>
          <span className={`sync-status ${syncStatus}`} title={syncStatus === "shared" ? "Connected to the shared BranDuel house" : "Shared house unavailable. Showing the last confirmed state."}>
            <i aria-hidden="true" />
            {syncStatus === "shared" ? "Shared live" : syncStatus === "offline" ? "Read-only / offline" : "Connecting"}
          </span>
          <div className="topbar-context">
            <span>Playing as</span>
            <strong>{player.name}</strong>
          </div>
          <PlayerPicker />
        </header>
        <main><RequestStatus /><fieldset className="write-guard" disabled={!canWrite}>{children}</fieldset></main>
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
          <img className="bank-hero-mark" src={brandLogoWhite} alt="" aria-hidden="true" />
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
        <SectionHeading title="Game desk" />
        <div className="game-desk">
          {Object.keys(state.games).map((gameId) => {
            const records = getGameRecords(state, gameId);
            const leader = records[0];
            const Icon = ICONS[gameId] ?? Target;
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
  const rules = event.rules ?? state.settings;
  const [stake, setStake] = useState(rules.minimumBet);
  const selections = event.format === "teams" ? event.teamIds ?? [] : event.playerIds ?? [];
  const game = state.games[event.gameId];
  const now = useNow();
  const open = !state.bettingPaused && isBettingOpen(event, now);
  const currentTeamId = state.players[state.currentPlayerId].teamId;
  const existingTicket = state.bets.find((bet) => bet.eventId === event.id && bet.teamId === currentTeamId && bet.status === "open");
  const existingExposure = existingTicket?.stake ?? 0;
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
                <strong>{Number.isFinite(event.odds[id]) ? formatAmericanOdds(event.odds[id]) : "Opens with market"}</strong>
              </button>
            );
          })}
        </div>
      ) : <div className="no-market"><ShieldCheck size={20} /> Results only. Mario Party has no betting market.</div>}

      {game.bettable && open && restrictionReason && <div className="bet-restriction"><ShieldCheck size={18} weight="fill" />{restrictionReason}</div>}
      {game.bettable && open && blockedSelections.length > 0 && <p className="market-help"><ShieldCheck size={16} weight="fill" /> Some choices are unavailable because teammate and self-bet rules apply.</p>}

      {selection && open && (
        <div className="bet-slip">
          <div>
            <label htmlFor={`stake-${event.id}`}>Wager</label>
            <select id={`stake-${event.id}`} value={stake} onChange={(e) => setStake(Number(e.target.value))}>
              {[...new Set([rules.minimumBet, 25_000, 50_000, 100_000, 250_000, 500_000, rules.maximumBet])].sort((a, b) => a - b)
                .filter((value) => value >= rules.minimumBet && value <= rules.maximumBet)
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
  const { serverOffset } = useStore();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now + serverOffset;
}

function LiveRoundBuilder({ notify, mode = "derby" }: { notify: (message: string) => void; mode?: "derby" | "prep" }) {
  const { state, dispatch } = useStore();
  const [gameId, setGameId] = useState<GameId>("smash");
  const [format, setFormat] = useState<"teams" | "free-for-all">("teams");
  const [selectedTeams, setSelectedTeams] = useState<TeamId[]>(["jason-ezra", "corey-jimmy"]);
  const [selectedPlayers, setSelectedPlayers] = useState<PlayerId[]>(["jason", "corey", "brandon", "bruce"]);
  const [bettingSeconds, setBettingSeconds] = useState(90);
  const [error, setError] = useState("");

  function togglePlayer(playerId: PlayerId) {
    setSelectedPlayers((current) => current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId]);
  }
  function toggleTeam(teamId: TeamId) {
    setSelectedTeams((current) => current.includes(teamId) ? current.filter((id) => id !== teamId) : current.length < 4 ? [...current, teamId] : current);
  }

  async function openRound(event: FormEvent) {
    event.preventDefault();
    if (format === "teams" && (selectedTeams.length < 2 || selectedTeams.length > 4)) {
      setError("Select two to four teams.");
      return;
    }
    const maxPlayers = maxFreeForAllPlayers(gameId);
    if (format === "free-for-all" && (selectedPlayers.length < 2 || selectedPlayers.length > maxPlayers)) {
      setError(`Choose two to ${maxPlayers} players for ${state.games[gameId].shortName}.`);
      return;
    }
    const payload = {
        gameId,
        format,
        eventType: format === "teams" ? ("HEAD_TO_HEAD" as const) : ("FFA" as const),
        bracketSize: format === "teams" ? selectedTeams.length as 2 | 3 | 4 : undefined,
        teamIds: format === "teams" ? selectedTeams : undefined,
        playerIds: format === "free-for-all" ? selectedPlayers : undefined,
      };
    const accepted = await dispatch(mode === "prep"
      ? { type: "CREATE_PREP_EVENT", payload }
      : { type: "CREATE_LIVE_EVENT", payload: { ...payload, bettingSeconds } });
    if (accepted) notify(mode === "prep" ? "Prep game posted. Log the result when it is finished." : "Round posted. The betting window is open.");
  }

  return (
    <form className="live-builder" onSubmit={openRound}>
      <div className="live-builder-title">
        <div><span>{mode === "prep" ? "Ratings warmup" : "Next round"}</span><h2>{mode === "prep" ? "Log a prep game" : "Build the matchup"}</h2></div>
        <Target size={30} weight="bold" />
      </div>
      <div className="live-builder-grid">
        <label>Game<select value={gameId} onChange={(event) => { const nextGame = event.target.value as GameId; setGameId(nextGame); setSelectedPlayers((current) => current.slice(0, maxFreeForAllPlayers(nextGame))); }}>{Object.keys(state.games).map((id) => <option key={id} value={id}>{state.games[id].name}</option>)}</select></label>
        {mode === "derby" ? <label>Betting window<select value={bettingSeconds} onChange={(event) => setBettingSeconds(Number(event.target.value))}><option value={60}>60 seconds</option><option value={90}>90 seconds</option><option value={120}>2 minutes</option></select></label> : <p className="field-note">No betting, purse, or bankroll changes. Prep results count toward ratings at half strength.</p>}
      </div>
      <fieldset>
        <legend>Match format</legend>
        <div className="segmented"><button type="button" className={format === "teams" ? "active" : ""} onClick={() => setFormat("teams")}>Fixed teams</button><button type="button" className={format === "free-for-all" ? "active" : ""} onClick={() => setFormat("free-for-all")}>Free for all</button></div>
      </fieldset>
      {format === "teams" ? (
        <>
          <fieldset>
            <legend>Teams <small>{selectedTeams.length}/4 selected</small></legend>
            <div className="player-check-grid">{TEAM_IDS.map((id) => <button type="button" className={selectedTeams.includes(id) ? "selected" : ""} onClick={() => toggleTeam(id)} key={id}><span>{state.teams[id].name}</span>{selectedTeams.includes(id) && <Check size={17} weight="bold" />}</button>)}</div>
          </fieldset>
        </>
      ) : (
        <fieldset>
          <legend>Players <small>{selectedPlayers.length}/{maxFreeForAllPlayers(gameId)} selected</small></legend>
          <div className="player-check-grid">{PLAYER_IDS.map((id) => <button type="button" className={selectedPlayers.includes(id) ? "selected" : ""} onClick={() => togglePlayer(id)} key={id}><span>{state.players[id].name}</span>{selectedPlayers.includes(id) && <Check size={17} weight="bold" />}</button>)}</div>
        </fieldset>
      )}
      {error && <p className="form-error">{error}</p>}
      <button className="primary-button full" type="submit"><Plus size={18} weight="bold" /> {mode === "prep" ? "Start prep game" : "Open betting"}</button>
    </form>
  );
}

function LiveResultControls({ event, notify, correction = false }: { event: ScheduledEvent; notify: (message: string) => void; correction?: boolean }) {
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
    const impact = event.mode === "prep" ? "Ratings will update. No money or wagers are involved." : "Team banks, wagers and records will update.";
    if (!window.confirm(`${correction ? "Correct this result" : "Settle this result"}?\n${summary}\n\n${impact}`)) return;
    const accepted = correction
      ? await dispatch({ type: "CORRECT_RESULT", eventId: event.id, result, reason })
      : await dispatch({ type: "SETTLE_EVENT", eventId: event.id, result });
    if (accepted) notify(event.mode === "prep" ? (correction ? "Prep result corrected. Ratings updated." : "Prep result recorded. Ratings updated.") : (correction ? "Result corrected. Banks, wagers and records updated." : "Round settled. Banks and ratings are updated."));
  }

  return (
    <div className="live-result">
      <div className="in-play-banner"><span>{event.mode === "prep" ? "Ratings-only prep game" : correction ? "Correct settled result" : "Match in play"}</span><strong><ParticipantNames event={event} /></strong><GameBadge gameId={event.gameId} /></div>
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

function PayoutBreakdown({ event }: { event: ScheduledEvent }) {
  const { state } = useStore();
  if (!event.result) return null;
  const settlement = event.settlements?.at(-1) ?? buildSettlementPreview(event, state, event.result);
  return <div className="payout-breakdown"><h3>Team settlement</h3>{settlement.teamRankings.map((ranking) => { const payout = settlement.payouts.find((item) => item.teamId === ranking.teamId); return <div className="payout-player-row" key={ranking.teamId}><span><strong>#{ranking.rank} {state.teams[ranking.teamId].name}</strong><small>{payout ? `${payout.percentage}% of house purse` : "No competitive payout"}</small></span><strong className={payout?.amount ? "positive" : "muted-amount"}>{payout?.amount ? `+${formatMoney(payout.amount)}` : "-"}</strong></div>; })}</div>;
}

function SettlementRecap({ event, notify }: { event: ScheduledEvent; notify: (message: string) => void }) {
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

function GameNightView({ notify }: { notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const now = useNow();
  const night = state.gameNight!;
  const nightMode = night.mode ?? "live";
  const activeIds = night.activeEventIds ?? (night.activeEventId ? [night.activeEventId] : []);
  const activeEvents = activeIds.map((id) => state.events.find((event) => event.id === id)).filter((event): event is ScheduledEvent => !!event);
  const recapEvent = night.lastSettledEventId ? state.events.find((event) => event.id === night.lastSettledEventId) : undefined;
  const player = state.players[state.currentPlayerId];
  const team = state.teams[player.teamId];
  const completedCount = night.eventIds.filter((id) => state.events.find((event) => event.id === id)?.status === "completed").length;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeIds.join(","), activeEvents.map((event) => `${event.id}:${event.status}`).join(","), recapEvent?.id]);
  return (
    <div className="page page-enter game-night-page">
      <div className="night-header">
        <div><p className="eyebrow">Game Night live</p><h1>The desk is open.</h1><p>{activeEvents.length} of {MAX_ACTIVE_EVENTS} markets active. Run games in parallel, then keep moving.</p></div>
        <div className="night-bank"><span>{team.name}</span><strong>{formatMoney(state.balances[team.id])}</strong></div>
      </div>
      <div className="night-status-strip"><span><Clock size={17} /> Started {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(night.startedAt))}</span><strong>{nightMode === "prep" ? "Prep mode" : "Live Night"} · {completedCount} rounds settled</strong>{state.currentPlayerId === "jimmy" && !activeEvents.length && nightMode === "live" && <button onClick={async () => { if (window.confirm("Enable Prep mode? This is only available before live play begins.")) { if (await dispatch({ type: "SET_GAME_NIGHT_MODE", mode: "prep" })) notify("Prep mode enabled for everyone."); } }}>Enable Prep mode</button>}{state.currentPlayerId === "jimmy" && !activeEvents.length && nightMode === "prep" && <button onClick={async () => { if (window.confirm("Start Live Night? Prep mode will close for everyone and betting rounds can begin.")) { if (await dispatch({ type: "SET_GAME_NIGHT_MODE", mode: "live" })) notify("Live Night started. Betting rounds are available."); } }}>Start Live Night</button>}{state.currentPlayerId === "jimmy" && !activeEvents.length && <button onClick={async () => { if (window.confirm("Close Game Night and freeze final standings? All matchups and wagers must be finished or voided. This archive cannot be edited.")) { if (await dispatch({ type: "END_GAME_NIGHT" })) notify("Game Night closed. Final standings are archived."); } }}>Review closeout</button>}</div>

      {activeEvents.map((activeEvent) => {
        const secondsLeft = activeEvent.bettingClosesAt ? Math.max(0, Math.floor((new Date(activeEvent.bettingClosesAt).getTime() - now) / 1000)) : 0;
        return <div key={activeEvent.id}>
          {activeEvent.status === "betting" && (
        <section className="live-market">
          <div className="live-market-clock"><div><span>Betting window</span><strong>{secondsLeft > 0 ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` : "Closed"}</strong></div><p>{secondsLeft > 0 ? "Place or update the team ticket before play begins." : "The timer expired. Start the match when the controllers are ready."}</p></div>
          <EventCard event={activeEvent} notify={notify} />
          <div className="live-market-actions"><button className="primary-button" onClick={async () => { if (await dispatch({ type: "START_MATCH", eventId: activeEvent.id })) notify("Betting locked. Match in play."); }}><Play size={18} weight="fill" /> Start match</button></div>
        </section>
      )}
          {activeEvent.status === "in-progress" && <LiveResultControls event={activeEvent} notify={notify} />}
        </div>;
      })}
      {!activeEvents.length && recapEvent && <SettlementRecap event={recapEvent} notify={notify} />}
      {activeEvents.length < MAX_ACTIVE_EVENTS && !recapEvent && <LiveRoundBuilder mode={nightMode === "prep" ? "prep" : "derby"} notify={notify} />}
      {state.currentPlayerId === "jimmy" && <RecoveryPanel notify={notify} />}
    </div>
  );
}

function NightSummary() {
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

function SchedulePanel({ onDone, notify }: { onDone: () => void; notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const [gameId, setGameId] = useState<GameId>("smash");
  const [format, setFormat] = useState<"teams" | "free-for-all">("teams");
  const [selectedTeams, setSelectedTeams] = useState<TeamId[]>(["jason-ezra", "corey-jimmy"]);
  const [selectedPlayers, setSelectedPlayers] = useState<PlayerId[]>(["jason", "corey"]);
  const defaultTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
  defaultTime.setMinutes(0, 0, 0);
  const [scheduledAt, setScheduledAt] = useState(defaultTime.toISOString().slice(0, 16));
  const [error, setError] = useState("");

  function togglePlayer(playerId: PlayerId) {
    setSelectedPlayers((current) => current.includes(playerId) ? current.filter((id) => id !== playerId) : [...current, playerId]);
  }
  function toggleTeam(teamId: TeamId) {
    setSelectedTeams((current) => current.includes(teamId) ? current.filter((id) => id !== teamId) : current.length < 4 ? [...current, teamId] : current);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (new Date(scheduledAt).getTime() <= Date.now()) {
      setError("Choose a future start time.");
      return;
    }
    if (format === "teams" && (selectedTeams.length < 2 || selectedTeams.length > 4)) {
      setError("Select two to four teams.");
      return;
    }
    const maxPlayers = maxFreeForAllPlayers(gameId);
    if (format === "free-for-all" && (selectedPlayers.length < 2 || selectedPlayers.length > maxPlayers)) {
      setError(`Select two to ${maxPlayers} players for ${state.games[gameId].shortName}.`);
      return;
    }
    const accepted = await dispatch({
      type: "SCHEDULE_EVENT",
      payload: {
        gameId,
        format,
        scheduledAt: new Date(scheduledAt).toISOString(),
        eventType: format === "teams" ? "HEAD_TO_HEAD" : "FFA",
        bracketSize: format === "teams" ? selectedTeams.length as 2 | 3 | 4 : undefined,
        teamIds: format === "teams" ? selectedTeams : undefined,
        playerIds: format === "free-for-all" ? selectedPlayers : undefined,
      },
    });
    if (accepted) { notify("Matchup saved as a draft. Betting stays closed until opened."); onDone(); }
  }

  return (
    <form className="schedule-panel" onSubmit={submit}>
      <div className="panel-title"><div><h2>Schedule event</h2><p>Drafts have no wagers. Jimmy opens one market when the room is ready.</p></div><button type="button" className="icon-button" onClick={onDone} aria-label="Close"><X size={22} /></button></div>
      <div className="form-grid">
        <label>Game<select value={gameId} onChange={(e) => { const nextGame = e.target.value as GameId; setGameId(nextGame); setSelectedPlayers((current) => current.slice(0, maxFreeForAllPlayers(nextGame))); }}>{Object.keys(state.games).map((id) => <option value={id} key={id}>{state.games[id].name}</option>)}</select></label>
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
        <>
          <fieldset>
            <legend>Teams <small>{selectedTeams.length}/4 selected</small></legend>
            <div className="player-check-grid">{TEAM_IDS.map((id) => <button type="button" className={selectedTeams.includes(id) ? "selected" : ""} onClick={() => toggleTeam(id)} key={id}><span>{state.teams[id].name}</span>{selectedTeams.includes(id) && <Check size={17} weight="bold" />}</button>)}</div>
          </fieldset>
        </>
      ) : (
        <fieldset>
          <legend>Players <small>{selectedPlayers.length}/{maxFreeForAllPlayers(gameId)} selected</small></legend>
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
        {state.gameNight?.status === "active" && <button className="primary-button" onClick={() => setScheduling(true)}><Plus size={18} weight="bold" /> Save draft</button>}
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
  return <LiveResultControls key={event.id} event={event} notify={notify} />;
}

function LogView({ notify, onHome }: { notify: (message: string) => void; onHome: () => void }) {
  const { state } = useStore();
  const liveNight = state.gameNight?.status === "active" ? state.gameNight : undefined;
  const scheduled = [...state.events].filter((event) => event.status === "in-progress").sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  if (liveNight) {
    const completed = liveNight.eventIds
      .map((id) => state.events.find((event) => event.id === id))
      .filter((event): event is ScheduledEvent => event?.status === "completed")
      .reverse();
    return (
      <div className="page page-enter">
        <div className="page-header"><div><p className="eyebrow">Game Night record</p><h1>Results</h1><p>Live rounds are settled from the current matchup on Home.</p></div><button className="primary-button" onClick={onHome}>Return to live round</button></div>
        <div className="result-list">
          {completed.map((event) => <article className="result-entry" key={event.id}><div className="result-summary"><div><GameBadge gameId={event.gameId} /><h3><ParticipantNames event={event} /></h3><span>{formatDate(event.scheduledAt)}</span></div><span className="settled-label"><Check size={18} weight="bold" /> {event.mode === "prep" ? "Prep result" : "Settled"}</span></div>{state.currentPlayerId === "jimmy" && event.mode !== "prep" && <PayoutBreakdown event={event} />}</article>)}
          {!completed.length && <EmptyState icon={Trophy} title="No settled rounds yet" body="Completed matches will appear here as the night moves." />}
        </div>
      </div>
    );
  }
  return (
    <div className="page page-enter">
      <div className="page-header"><div><p className="eyebrow">Official results</p><h1>Log a result</h1><p>Any signed-in player can report results after Jimmy starts the match.</p></div></div>
      <div className="notice"><ShieldCheck size={22} weight="fill" /><p><strong>Honor system active.</strong> Review every winner and finishing position before confirming.</p></div>
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
        {Object.keys(state.games).map((id) => { const Icon = ICONS[id] ?? Target; return <button role="tab" aria-selected={gameId === id} className={gameId === id ? "active" : ""} onClick={() => setGameId(id)} key={id}><Icon size={19} />{state.games[id].shortName}</button>; })}
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
  const [teamNames, setTeamNames] = useState<Record<TeamId, string>>(() => Object.fromEntries(TEAM_IDS.map((teamId) => [teamId, state.teams[teamId].name])) as Record<TeamId, string>);
  const [adjustTeam, setAdjustTeam] = useState<TeamId>(TEAM_IDS[0]);
  const [adjustment, setAdjustment] = useState(100_000);
  const [newGame, setNewGame] = useState({ id: "", name: "", shortName: "", payout: 1_500_000, bettable: true });

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    if (await dispatch({ type: "UPDATE_SETTINGS", settings })) notify("League economy updated.");
  }

  async function saveTeamNames(event: FormEvent) {
    event.preventDefault();
    if (await dispatch({ type: "UPDATE_TEAM_NAMES", teamNames })) notify("Team names updated.");
  }

  async function addGame(event: FormEvent) {
    event.preventDefault();
    const id = newGame.id.trim().toLowerCase();
    if (await dispatch({ type: "ADD_GAME", payload: { ...newGame, id } })) {
      setSettings((current) => ({ ...current, payouts: { ...current.payouts, [id]: newGame.payout } }));
      setNewGame({ id: "", name: "", shortName: "", payout: 1_500_000, bettable: true });
      notify("Game added to the pool.");
    }
  }

  return (
    <section className="admin-panel">
      <div className="admin-title"><ShieldCheck size={24} weight="fill" /><div><h2>Commissioner controls</h2><p>Authenticated commissioner: Jimmy.</p></div></div>
      <form onSubmit={saveTeamNames}>
        <h3>Team names</h3>
        <div className="admin-grid">
          {TEAM_IDS.map((teamId) => <label key={teamId}>{state.teams[teamId].name}<input value={teamNames[teamId]} maxLength={60} onChange={(e) => setTeamNames({ ...teamNames, [teamId]: e.target.value })} /></label>)}
        </div>
        <button className="secondary-button" type="submit">Save team names</button>
      </form>
      <form onSubmit={saveSettings}>
        <h3>Economy</h3>
        <div className="admin-grid">
          <label>Minimum bet<input type="number" step="5000" value={settings.minimumBet} onChange={(e) => setSettings({ ...settings, minimumBet: Number(e.target.value) })} /></label>
          <label>Maximum bet<input type="number" step="25000" value={settings.maximumBet} onChange={(e) => setSettings({ ...settings, maximumBet: Number(e.target.value) })} /></label>
          {Object.keys(state.games).map((gameId) => <label key={gameId}>{state.games[gameId].shortName} payout<input type="number" step="50000" value={settings.payouts[gameId]} onChange={(e) => setSettings({ ...settings, payouts: { ...settings.payouts, [gameId]: Number(e.target.value) } })} /></label>)}
        </div>
        <button className="secondary-button" type="submit">Save economy</button>
      </form>
      <form onSubmit={addGame}>
        <h3>Game pool</h3>
        <div className="admin-grid">
          <label>Game ID<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="rocket-league" value={newGame.id} onChange={(e) => setNewGame({ ...newGame, id: e.target.value })} /></label>
          <label>Display name<input required maxLength={80} placeholder="Rocket League" value={newGame.name} onChange={(e) => setNewGame({ ...newGame, name: e.target.value })} /></label>
          <label>Short name<input required maxLength={30} placeholder="Rocket League" value={newGame.shortName} onChange={(e) => setNewGame({ ...newGame, shortName: e.target.value })} /></label>
          <label>House payout<input required type="number" min="1" step="50000" value={newGame.payout} onChange={(e) => setNewGame({ ...newGame, payout: Number(e.target.value) })} /></label>
          <label className="checkbox-label"><input type="checkbox" checked={newGame.bettable} onChange={(e) => setNewGame({ ...newGame, bettable: e.target.checked })} /> Allow betting</label>
        </div>
        <button className="secondary-button" type="submit">Add game to pool</button>
      </form>
      <div className="admin-block">
        <h3>Bank adjustment</h3>
        <div className="adjust-row"><select value={adjustTeam} onChange={(e) => setAdjustTeam(e.target.value as TeamId)}>{TEAM_IDS.map((id) => <option value={id} key={id}>{state.teams[id].name}</option>)}</select><input type="number" step="50000" value={adjustment} onChange={(e) => setAdjustment(Number(e.target.value))} /><button className="secondary-button" onClick={async () => { const note = window.prompt("Reason for this bank adjustment:"); if (note?.trim() && await dispatch({ type: "ADJUST_BALANCE", teamId: adjustTeam, amount: adjustment, note })) notify("Team balance adjusted."); }}>Apply</button></div>
      </div>
      <div className="admin-block">
        <h3>Adjustment history</h3>
        {state.bankAdjustments.length ? <div className="adjustment-history">{state.bankAdjustments.map((adjustment) => <div key={adjustment.id}><div><strong>{state.teams[adjustment.teamId].name}</strong><small>{adjustment.note} · {state.players[adjustment.actorId].name} · {formatDate(adjustment.createdAt)}</small></div><strong className={adjustment.amount >= 0 ? "positive" : "negative"}>{adjustment.amount >= 0 ? "+" : ""}{formatMoney(adjustment.amount)}</strong></div>)}</div> : <p className="muted">No commissioner adjustments recorded.</p>}
      </div>
      <RecoveryPanel notify={notify} />
    </section>
  );
}

function BankView({ notify }: { notify: (message: string) => void }) {
  const { state } = useStore();
  const player = state.players[state.currentPlayerId];
  const team = state.teams[player.teamId];
  const entries = state.ledger.filter((entry) => entry.teamId === team.id);
  const gamePayoutIds = new Set(entries.filter((entry) => entry.type === "game-payout").map((entry) => entry.id));
  const gameEarnings = entries.filter((entry) => entry.type === "game-payout" || (entry.type === "reversal" && !!entry.reversesEntryId && gamePayoutIds.has(entry.reversesEntryId))).reduce((sum, entry) => sum + entry.amount, 0);
  const commissioner = state.currentPlayerId === "jimmy";
  const bankRows = TEAM_IDS.map((teamId) => ({
    teamId,
    balance: state.balances[teamId],
    exposure: state.bets.filter((bet) => bet.teamId === teamId && bet.status === "open").reduce((sum, bet) => sum + bet.stake, 0),
  }));
  const [tab, setTab] = useState<"activity" | "bets">("activity");
  return (
    <div className="page page-enter">
      <div className="bank-page-head"><div><p className="eyebrow">{commissioner ? "League treasury" : "Team treasury"}</p><h1>{commissioner ? "All team banks" : team.name}</h1><span>{commissioner ? "Commissioner overview" : "Shared cash balance"}</span></div><strong>{formatMoney(state.balances[team.id])}</strong></div>
      {commissioner && <div className="commissioner-banks">{bankRows.map(({ teamId, balance, exposure }) => <div className="commissioner-bank" key={teamId}><span>{state.teams[teamId].name}</span><strong>{formatMoney(balance)}</strong><small>{exposure ? `${formatMoney(exposure)} open exposure` : "No open exposure"}</small></div>)}</div>}
      <div className="bank-kpis"><div><span>Game earnings</span><strong>{formatMoney(gameEarnings)}</strong></div><div><span>Open exposure</span><strong>{formatMoney(state.bets.filter((b) => b.teamId === team.id && b.status === "open").reduce((sum, b) => sum + b.stake, 0))}</strong></div></div>
      <div className="tabs"><button className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>Activity</button><button className={tab === "bets" ? "active" : ""} onClick={() => setTab("bets")}>Wagers</button></div>
      {tab === "activity" ? (
        entries.length ? <div className="ledger">{entries.map((entry) => <div key={entry.id}><span className={`ledger-icon ${entry.amount >= 0 ? "positive" : "negative"}`}>{entry.amount >= 0 ? <Plus size={18} /> : <Receipt size={18} />}</span><div><strong>{entry.description}</strong><small>{formatDate(entry.createdAt)}</small></div><strong className={entry.amount >= 0 ? "positive" : "negative"}>{entry.amount >= 0 ? "+" : ""}{formatMoney(entry.amount)}</strong></div>)}</div> : <EmptyState icon={Bank} title="No activity yet" body="Game payouts, wagers, refunds, and adjustments will appear here." />
      ) : <BetHistory />}
      {state.currentPlayerId === "jimmy" && state.gameNight?.status !== "ended" && <AdminPanel notify={notify} />}
    </div>
  );
}

export function App() {
  const { playerId, sessionReady } = useStore();
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

  if (!sessionReady) return <div className="login-page"><BrandMark /><p>Checking your session...</p></div>;
  if (!playerId) return <LoginScreen />;
  return (
    <Shell view={view} onView={setView}>
      {content}
      {toast && <div className="toast" role="status"><Check size={19} weight="bold" />{toast}</div>}
    </Shell>
  );
}
