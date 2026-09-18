import { useState, type FormEvent } from "react";
import { ShieldCheck } from "@phosphor-icons/react";
import { basePurse, medianObservedMinutes, TEAM_IDS } from "../data";
import { formatMoney, isBettingOpen } from "../engine";
import { useStore } from "../store";
import type { TeamId } from "../types";
import { LiveResultControls } from "./results";
import { useNow } from "./live-betting";
import { ParticipantNames, exportData, formatDate } from "./shared";

export function RecoveryPanel({ notify }: { notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const [correcting, setCorrecting] = useState("");
  const [reopenSeconds, setReopenSeconds] = useState(60);
  const now = useNow();
  const unfinished = state.events.filter((event) => ["scheduled", "betting", "in-progress"].includes(event.status));
  const completed = state.events.filter((event) => event.status === "completed" && state.gameNight?.status === "active" && state.gameNight.eventIds.includes(event.id));
  const selected = completed.find((event) => event.id === correcting);
  async function reopen(eventId: string) {
    const accepted = await dispatch({ type: "REOPEN_EVENT", eventId, bettingSeconds: reopenSeconds });
    notify(accepted ? `Betting reopened for ${reopenSeconds} seconds. Frozen odds, purse, and stake limits were preserved.` : "Reopen was not confirmed; no market change was accepted. Refresh confirmed state before retrying.");
  }
  return <section className="recovery-panel"><h2>Commissioner recovery</h2>
    <div className="recovery-actions"><button className="secondary-button" onClick={async () => { if (await dispatch({ type: "PAUSE_BETTING", paused: !state.bettingPaused })) notify(state.bettingPaused ? "Betting resumed within the existing deadlines." : "All new wagers are paused."); }}>{state.bettingPaused ? "Resume betting" : "Pause all betting"}</button><button className="secondary-button" onClick={() => exportData(state, `branduel-${state.gameNight?.id ?? "event"}.json`)}>Export confirmed data</button></div>
    {state.bettingPaused && <p className="notice">All new wagers are paused. Existing deadlines still apply.</p>}
    <div className="admin-events">{unfinished.map((event) => { const expired = event.status === "betting" && !isBettingOpen(event, now); return <div key={event.id}><span><strong>{state.games[event.gameId].shortName} / {expired ? "expired" : event.status}</strong><small><ParticipantNames event={event} /></small></span><div className="recovery-event-actions">
      {expired && <><label className="reopen-window">New betting window<select aria-label={`Reopen window for ${state.games[event.gameId].shortName}`} value={reopenSeconds} onChange={(e) => setReopenSeconds(Number(e.target.value))}><option value={60}>60 seconds</option><option value={90}>90 seconds</option><option value={120}>2 minutes</option></select></label><button className="secondary-button" onClick={() => void reopen(event.id)}>Reopen betting</button></>}
      <button className="danger" onClick={async () => { const reason = window.prompt("Void this round and refund its open wagers? Enter the reason:"); if (reason?.trim() && await dispatch({ type: "CANCEL_EVENT", eventId: event.id, reason })) notify("Round voided. Open wagers refunded."); }}>Void / refund</button>
    </div></div>; })}</div>
    {completed.length > 0 && <label>Correct a settled round<select value={correcting} onChange={(e) => setCorrecting(e.target.value)}><option value="">Select a round</option>{completed.map((event) => <option key={event.id} value={event.id}>{state.games[event.gameId].shortName} / {formatDate(event.createdAt)} / {event.id.slice(-6)}</option>)}</select></label>}
    {selected && <><LiveResultControls key={selected.id} event={selected} notify={(message) => { notify(message); setCorrecting(""); }} correction /><button className="danger-button" onClick={async () => { const reason = window.prompt("Void this completed round? Its result and payouts will be reversed and tickets refunded. Enter the reason:"); if (reason?.trim() && await dispatch({ type: "CANCEL_EVENT", eventId: selected.id, reason })) { notify("Completed round voided. Payouts reversed and tickets refunded."); setCorrecting(""); } }}>Void completed round / refund</button></>}
  </section>;
}

type GameDraft = { id: string; name: string; shortName: string; standardContest: string; expectedMinutes: number; bettable: boolean; overridePurse?: number; overrideReason?: string };

function draftFor(game: { name?: string; shortName?: string; standardContest?: string; expectedMinutes?: number; bettable?: boolean; purseOverride?: { amount: number; reason: string } } | undefined, id: string): GameDraft {
  return { id, name: game?.name ?? "", shortName: game?.shortName ?? "", standardContest: game?.standardContest ?? "", expectedMinutes: game?.expectedMinutes ?? 10, bettable: game?.bettable ?? true, overridePurse: game?.purseOverride?.amount, overrideReason: game?.purseOverride?.reason };
}
function previewPurse(minutes: number) {
  try { return Number.isFinite(minutes) && minutes > 0 ? formatMoney(basePurse(minutes)) : "—"; } catch { return "—"; }
}

export function AdminPanel({ notify }: { notify: (message: string) => void }) {
  const { state, dispatch } = useStore();
  const [teamNames, setTeamNames] = useState<Record<TeamId, string>>(() => Object.fromEntries(TEAM_IDS.map((teamId) => [teamId, state.teams[teamId].name])) as Record<TeamId, string>);
  const [adjustTeam, setAdjustTeam] = useState<TeamId>(TEAM_IDS[0]);
  const [adjustment, setAdjustment] = useState(100_000);
  const [newGame, setNewGame] = useState<GameDraft>({ id: "", name: "", shortName: "", standardContest: "", expectedMinutes: 10, bettable: true });
  const [gameDrafts, setGameDrafts] = useState<Record<string, GameDraft>>(() => Object.fromEntries(Object.entries(state.games).map(([id, game]) => [id, draftFor(game, id)])));

  async function saveTeamNames(event: FormEvent) {
    event.preventDefault();
    if (await dispatch({ type: "UPDATE_TEAM_NAMES", teamNames })) notify("Team names updated.");
  }
  async function saveGame(event: FormEvent, draft: GameDraft) {
    event.preventDefault();
    if (await dispatch({ type: "UPDATE_GAME", payload: { ...draft, overridePurse: draft.overridePurse || undefined, overrideReason: draft.overrideReason || undefined } })) notify(`${draft.shortName} economy updated for future rounds.`);
  }
  async function addGame(event: FormEvent) {
    event.preventDefault();
    const id = newGame.id.trim().toLowerCase();
    if (await dispatch({ type: "ADD_GAME", payload: { ...newGame, id, overridePurse: newGame.overridePurse || undefined, overrideReason: newGame.overrideReason || undefined } })) {
      setNewGame({ id: "", name: "", shortName: "", standardContest: "", expectedMinutes: 10, bettable: true });
      notify("Game added to the pool.");
    }
  }
  return <section className="admin-panel">
    <div className="admin-title"><ShieldCheck size={24} weight="fill" /><div><h2>Commissioner controls</h2><p>Authenticated commissioner: Jimmy.</p></div></div>
    <form onSubmit={saveTeamNames}><h3>Team names</h3><div className="admin-grid">{TEAM_IDS.map((teamId) => <label key={teamId}>{state.teams[teamId].name}<input value={teamNames[teamId]} maxLength={60} onChange={(e) => setTeamNames({ ...teamNames, [teamId]: e.target.value })} /></label>)}</div><button className="secondary-button" type="submit">Save team names</button></form>
    <div className="admin-block"><h3>Economy guardrails</h3><div className="metric-strip"><div><span>Opening bankroll</span><strong>{formatMoney(state.settings.startingBankroll)}</strong></div><div><span>Minimum ticket</span><strong>{formatMoney(state.settings.minimumBet)}</strong></div><div><span>Hard maximum</span><strong>{formatMoney(state.settings.maximumBet)}</strong></div><div><span>House edge</span><strong>5%</strong></div></div><p className="field-note">Purses are duration-calibrated. Changes apply to future markets; open and historical markets keep their frozen purse and rules.</p></div>
    <div className="admin-block"><h3>Game catalog and calibration</h3><div className="admin-game-list">{Object.values(state.games).map((game) => { const draft = gameDrafts[game.id] ?? draftFor(game, game.id); const median = medianObservedMinutes(state, game.id); const suggested = median === undefined ? undefined : basePurse(median); return <form className="admin-game" key={game.id} onSubmit={(event) => void saveGame(event, draft)}>
      <div className="admin-game-head"><div><strong>{game.name}</strong><small>{game.bettable ? "Betting allowed" : "Results only"} · configured purse {formatMoney(game.payout)}</small></div><span>{game.needsDurationCalibration ? "Needs calibration" : `${game.expectedMinutes ?? "—"} min`}</span></div>
      <div className="admin-grid"><label>Display name<input value={draft.name} onChange={(e) => setGameDrafts({ ...gameDrafts, [game.id]: { ...draft, name: e.target.value } })} /></label><label>Short name<input value={draft.shortName} onChange={(e) => setGameDrafts({ ...gameDrafts, [game.id]: { ...draft, shortName: e.target.value } })} /></label><label>Standard contest<input value={draft.standardContest} onChange={(e) => setGameDrafts({ ...gameDrafts, [game.id]: { ...draft, standardContest: e.target.value } })} /></label><label>Expected minutes<input type="number" min="1" step="1" value={draft.expectedMinutes} onChange={(e) => setGameDrafts({ ...gameDrafts, [game.id]: { ...draft, expectedMinutes: Number(e.target.value) } })} /></label><label>Calculated base purse<output>{previewPurse(draft.expectedMinutes)}</output></label><label className="checkbox-label"><input type="checkbox" checked={draft.bettable} onChange={(e) => setGameDrafts({ ...gameDrafts, [game.id]: { ...draft, bettable: e.target.checked } })} /> Allow betting</label><label>Override purse (optional)<input type="number" step="25000" min="150000" value={draft.overridePurse ?? ""} onChange={(e) => setGameDrafts({ ...gameDrafts, [game.id]: { ...draft, overridePurse: e.target.value ? Number(e.target.value) : undefined } })} /></label><label>Override reason{draft.overridePurse !== undefined && <input required value={draft.overrideReason ?? ""} onChange={(e) => setGameDrafts({ ...gameDrafts, [game.id]: { ...draft, overrideReason: e.target.value } })} />}</label></div>
      {median !== undefined && <p className="field-note">Observed median: {median.toFixed(1)} minutes · suggested future purse: {formatMoney(suggested!)}</p>}<button className="secondary-button" type="submit">Save future-round settings</button>
    </form>; })}</div></div>
    <form onSubmit={addGame}><h3>Add game</h3><p className="field-note">Enter the standard contest and expected minutes. The base purse is calculated automatically; an override must be within ±20%, rounded to $25,000, with a reason.</p><div className="admin-grid"><label>Game ID<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="rocket-league" value={newGame.id} onChange={(e) => setNewGame({ ...newGame, id: e.target.value })} /></label><label>Display name<input required maxLength={80} placeholder="Rocket League" value={newGame.name} onChange={(e) => setNewGame({ ...newGame, name: e.target.value })} /></label><label>Short name<input required maxLength={30} placeholder="Rocket League" value={newGame.shortName} onChange={(e) => setNewGame({ ...newGame, shortName: e.target.value })} /></label><label>Standard contest<input required maxLength={160} placeholder="One standard match" value={newGame.standardContest} onChange={(e) => setNewGame({ ...newGame, standardContest: e.target.value })} /></label><label>Expected minutes<input required type="number" min="1" step="1" value={newGame.expectedMinutes} onChange={(e) => setNewGame({ ...newGame, expectedMinutes: Number(e.target.value) })} /></label><label>Calculated base purse<output>{previewPurse(newGame.expectedMinutes)}</output></label><label>Override purse (optional)<input type="number" step="25000" min="150000" value={newGame.overridePurse ?? ""} onChange={(e) => setNewGame({ ...newGame, overridePurse: e.target.value ? Number(e.target.value) : undefined })} /></label><label>Override reason{newGame.overridePurse !== undefined && <input required value={newGame.overrideReason ?? ""} onChange={(e) => setNewGame({ ...newGame, overrideReason: e.target.value })} />}</label><label className="checkbox-label"><input type="checkbox" checked={newGame.bettable} onChange={(e) => setNewGame({ ...newGame, bettable: e.target.checked })} /> Allow betting</label></div><button className="secondary-button" type="submit">Add game to pool</button></form>
    <div className="admin-block"><h3>Start a new economy season</h3><p className="field-note">Available only after the night is closed and all tickets are resolved. Archives and history are preserved.</p><button className="secondary-button" disabled={state.gameNight?.status === "active" || state.events.some((event) => !["completed", "cancelled"].includes(event.status))} onClick={async () => { const reason = window.prompt("Reason for starting the new $200,000 economy season:"); if (reason?.trim() && await dispatch({ type: "START_ECONOMY_SEASON", reason })) notify("New economy season started at $200,000 per team."); }}>Start new economy season</button></div>
    <div className="admin-block"><h3>Bank adjustment</h3><div className="adjust-row"><select value={adjustTeam} onChange={(e) => setAdjustTeam(e.target.value as TeamId)}>{TEAM_IDS.map((id) => <option value={id} key={id}>{state.teams[id].name}</option>)}</select><input type="number" step="50000" value={adjustment} onChange={(e) => setAdjustment(Number(e.target.value))} /><button className="secondary-button" onClick={async () => { const note = window.prompt("Reason for this bank adjustment:"); if (note?.trim() && await dispatch({ type: "ADJUST_BALANCE", teamId: adjustTeam, amount: adjustment, note })) notify("Team balance adjusted."); }}>Apply</button></div></div>
    <div className="admin-block"><h3>Adjustment history</h3>{state.bankAdjustments.length ? <div className="adjustment-history">{state.bankAdjustments.map((adjustment) => <div key={adjustment.id}><div><strong>{state.teams[adjustment.teamId].name}</strong><small>{adjustment.note} · {state.players[adjustment.actorId].name} · {formatDate(adjustment.createdAt)}</small></div><strong className={adjustment.amount >= 0 ? "positive" : "negative"}>{adjustment.amount >= 0 ? "+" : ""}{formatMoney(adjustment.amount)}</strong></div>)}</div> : <p className="muted">No commissioner adjustments recorded.</p>}</div>
    <RecoveryPanel notify={notify} />
  </section>;
}
