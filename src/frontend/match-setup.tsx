import { useEffect, useState, type FormEvent } from "react";
import { Check, Clock, Play, Plus, Target } from "@phosphor-icons/react";
import { maxFreeForAllPlayers, PLAYER_IDS, PREP_RATING_COPY, TEAM_IDS } from "../data";
import { MAX_ACTIVE_EVENTS } from "../domain";
import { formatMoney } from "../engine";
import { useStore } from "../store";
import type { GameId, PlayerId, TeamId } from "../types";
import { activeNightEvents, useNow } from "./live-betting";
import { LiveResultControls, NightSummary, SettlementRecap } from "./results";
import { MatchHost, ParticipantNames } from "./shared";

export function LiveRoundBuilder({ notify, mode = "derby", title, submitLabel }: { notify: (message: string) => void; mode?: "derby" | "prep"; title?: string; submitLabel?: string }) {
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
    <form className="live-builder" aria-describedby={error ? "matchup-error" : undefined} onSubmit={openRound}>
      <div className="live-builder-title">
        <div><span>{mode === "prep" ? "Heat warmup" : title ? "Next market" : "Next round"}</span><h2>{mode === "prep" ? "Log a prep game" : title ?? "Build the matchup"}</h2></div>
        <Target size={30} weight="bold" />
      </div>
      <div className="live-builder-grid">
        <label>Game<select value={gameId} onChange={(event) => { const nextGame = event.target.value as GameId; setGameId(nextGame); setSelectedPlayers((current) => current.slice(0, maxFreeForAllPlayers(nextGame))); }}>{Object.keys(state.games).map((id) => <option key={id} value={id}>{state.games[id].name}</option>)}</select></label>
        {mode === "derby" ? <label>Betting window<select value={bettingSeconds} onChange={(event) => setBettingSeconds(Number(event.target.value))}><option value={60}>60 seconds</option><option value={90}>90 seconds</option><option value={120}>2 minutes</option></select></label> : <p className="field-note">{PREP_RATING_COPY}</p>}
      </div>
      <div className="game-economy-summary"><strong>{state.games[gameId].standardContest ?? "Standard contest not recorded"}</strong><span>{state.games[gameId].expectedMinutes ? `Expected ${state.games[gameId].expectedMinutes} minutes` : "Duration calibration needed"}</span><span>{mode === "prep" ? "No purse in prep mode" : `${formatMoney(state.games[gameId].payout)} base purse`}</span><span>{state.games[gameId].bettable ? "Betting allowed" : "Results only"}</span></div>
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
      {error && <p id="matchup-error" role="alert" className="form-error">{error}</p>}
      <button className="primary-button full" type="submit"><Plus size={18} weight="bold" /> {mode === "prep" ? "Start prep game" : submitLabel ?? "Open betting"}</button>
    </form>
  );
}

function MatchSetupView({ notify }: { notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  if (state.gameNight?.status === "ended") return <NightSummary />;
  if (state.gameNight?.status !== "active") {
    return <div className="page page-enter">
      <div className="page-header"><div><p className="eyebrow">Match Setup</p><h1>Open the Derby.</h1><p>Start the shared game night when the players are ready. Then build each matchup as it happens.</p></div></div>
      <div className="live-builder"><div className="live-builder-title"><div><span>Ready room</span><h2>Start Game Night</h2></div><Target size={30} weight="bold" /></div><p className="field-note">This opens the live board for everyone. No matchup or wager is created yet.</p>{state.currentPlayerId === "jimmy" ? <button className="primary-button full" onClick={async () => { if (window.confirm("Open Game Night for everyone? You can build the first matchup next.")) await dispatch({ type: "START_GAME_NIGHT" }); }}><Play size={18} weight="fill" /> Open Game Night</button> : <p className="notice">Jimmy must open Game Night before rounds can begin.</p>}</div>
    </div>;
  }

  return <ActiveMatchSetup notify={notify} />;
}

export function ActiveMatchSetup({ notify }: { notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const now = useNow();
  const night = state.gameNight!;
  const nightMode = night.mode ?? "live";
  const activeEvents = activeNightEvents(state);
  const recapEvent = night.lastSettledEventId ? state.events.find((event) => event.id === night.lastSettledEventId) : undefined;
  const completedCount = night.eventIds.filter((id) => state.events.find((event) => event.id === id)?.status === "completed").length;
  const canOpenAnotherMarket = nightMode === "live" && !recapEvent && activeEvents.length < MAX_ACTIVE_EVENTS;
  const activeEventSignature = activeEvents.map((event) => `${event.id}:${event.status}`).join(",");
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeEventSignature, recapEvent?.id]);
  return (
    <div className="page page-enter game-night-page">
      <div className="night-header">
      <div><p className="eyebrow">Match Setup</p><h1>Run the next round.</h1><p>{activeEvents.length} of {MAX_ACTIVE_EVENTS} rounds active. Open a matchup, start play, then log the official result. Prep sets the opening live Heat.</p></div>
      </div>
      <div className="night-status-strip"><span><Clock size={17} /> Started {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(night.startedAt))}</span><strong>{nightMode === "prep" ? "Prep mode" : "Live Night"} · {completedCount} rounds settled</strong>{state.currentPlayerId === "jimmy" && !activeEvents.length && nightMode === "live" && <button onClick={async () => { if (window.confirm("Enable Prep mode? This is only available before live play begins.")) { if (await dispatch({ type: "SET_GAME_NIGHT_MODE", mode: "prep" })) notify("Prep mode enabled for everyone."); } }}>Enable Prep mode</button>}{state.currentPlayerId === "jimmy" && !activeEvents.length && nightMode === "prep" && <button onClick={async () => { if (window.confirm("Start Live Night? Prep mode will close for everyone and betting rounds can begin.")) { if (await dispatch({ type: "SET_GAME_NIGHT_MODE", mode: "live" })) notify("Live Night started. Betting rounds are available."); } }}>Start Live Night</button>}{state.currentPlayerId === "jimmy" && !activeEvents.length && <button onClick={async () => { if (window.confirm("Close Game Night and freeze final standings? All matchups and wagers must be finished or voided. This archive cannot be edited.")) { if (await dispatch({ type: "END_GAME_NIGHT" })) notify("Game Night closed. Final standings are archived."); } }}>Review closeout</button>}</div>

      {canOpenAnotherMarket && <section className="next-market" aria-labelledby={activeEvents.length ? "next-market-title" : undefined}>
        {activeEvents.length > 0 && <div className="section-heading compact-heading"><div><p className="eyebrow">Next action</p><h2 id="next-market-title">Open another market</h2><p>Markets can run side by side. Opening this one will not change the rounds already in progress.</p></div></div>}
        <LiveRoundBuilder mode="derby" title={activeEvents.length ? "Open another market" : undefined} submitLabel={activeEvents.length ? "Open next betting market" : undefined} notify={notify} />
      </section>}
      {activeEvents.length >= MAX_ACTIVE_EVENTS && <p className="notice market-limit" role="status"><strong>Four markets are active.</strong> Finish or void one before opening another.</p>}
      {activeEvents.length > 0 && <section className="active-rounds" aria-labelledby="active-rounds-title">
        <div className="section-heading compact-heading"><div><p className="eyebrow">In the room</p><h2 id="active-rounds-title">Active markets</h2><p>Each round keeps its own clock, tickets, and result. Work on one without changing the others.</p></div></div>
      {activeEvents.map((activeEvent) => {
        const secondsLeft = activeEvent.bettingClosesAt ? Math.max(0, Math.floor((new Date(activeEvent.bettingClosesAt).getTime() - now) / 1000)) : 0;
        return <div className="active-round" key={activeEvent.id}>
          {activeEvent.status === "betting" && (
        <section className="live-market">
          <div className="live-market-clock"><div><span>Betting window</span><strong>{secondsLeft > 0 ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` : "Closed"}</strong></div><p><strong>{state.games[activeEvent.gameId].shortName}: </strong><ParticipantNames event={activeEvent} /> {secondsLeft > 0 ? "— start the match when betting closes." : "— betting is locked and play can begin."}</p><MatchHost event={activeEvent} /></div>
          <div className="live-market-actions"><button className="primary-button" onClick={async () => { if (await dispatch({ type: "START_MATCH", eventId: activeEvent.id })) notify("Betting locked. Match in play."); }}><Play size={18} weight="fill" /> Start match</button></div>
        </section>
      )}
          {activeEvent.status === "in-progress" && <LiveResultControls event={activeEvent} notify={notify} />}
        </div>;
      })}
      </section>}
      {!activeEvents.length && recapEvent && <SettlementRecap event={recapEvent} notify={notify} />}
      {!activeEvents.length && !recapEvent && nightMode === "prep" && <LiveRoundBuilder mode="prep" notify={notify} />}
    </div>
  );
}

export function MatchSetupPage({ notify }: { notify: (message: string) => void }) {
  return <MatchSetupView notify={notify} />;
}
