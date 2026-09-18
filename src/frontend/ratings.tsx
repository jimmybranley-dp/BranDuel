import { useState } from "react";
import { Target } from "@phosphor-icons/react";
import { getGameRecords, getPlayerHeat } from "../engine";
import { useStore } from "../store";
import type { GameId } from "../types";
import { ICONS } from "./shared";

export function RatingsView() {
  const { state } = useStore();
  const [gameId, setGameId] = useState<GameId>("smash");
  const records = getGameRecords(state, gameId).sort((a, b) => getPlayerHeat(state, b.playerId, gameId).lineScore - getPlayerHeat(state, a.playerId, gameId).lineScore || b.wins - a.wins || a.playerId.localeCompare(b.playerId));
  const night = state.gameNight;
  function heatLabel(value: number) {
    if (value >= 0.25) return "Hot";
    if (value <= -0.25) return "Cold";
    return "Even";
  }
  function appearanceLabel(appearance: ReturnType<typeof getPlayerHeat>["nightAppearances"][number]) {
    const game = state.games[appearance.gameId];
    return `${game?.shortName ?? appearance.gameId} · ${appearance.mode === "prep" ? "Prep" : "Live"} · ${appearance.performance >= 0 ? "+" : ""}${appearance.performance.toFixed(2)}`;
  }
  return (
    <div className="page page-enter">
      <div className="page-header"><div><p className="eyebrow">Current Night Heat</p><h1>Heat</h1><p>Heat is an entertainment-oriented current-night signal, not a precise long-term skill estimate. Open-market odds are frozen when the market opens.</p></div></div>
      <div className="game-tabs" role="tablist">
        {Object.keys(state.games).map((id) => { const Icon = ICONS[id as GameId] ?? Target; return <button role="tab" aria-selected={gameId === id} className={gameId === id ? "active" : ""} onClick={() => setGameId(id as GameId)} key={id}><Icon size={19} />{state.games[id].shortName}</button>; })}
      </div>
      <p className="field-note">Prep sets the opening line. Prep and live results count at full weight, then cool as newer appearances replace them. Only the four most recent applicable appearances count.</p>
      <div className="leaderboard">
        <div className="leaderboard-head"><span>Rank</span><span>Player</span><span>Record</span><span>Heat</span></div>
        {records.map((record, index) => {
          const player = state.players[record.playerId];
          const heat = getPlayerHeat(state, record.playerId, gameId);
          return (
            <div className="leader-row" key={record.playerId}>
              <strong className={`rank rank-${index + 1}`}>{index + 1}</strong>
              <div className="leader-player"><span className="avatar">{player.name.slice(0, 1)}</span><div><strong>{player.name}</strong><small>{state.teams[player.teamId].name}</small><small>Night: {heat.nightAppearances.length ? heat.nightAppearances.map(appearanceLabel).join(" · ") : "No current-night results"}</small><small>{state.games[gameId].shortName}: {heat.gameAppearances.length ? heat.gameAppearances.map(appearanceLabel).join(" · ") : "No game-specific results"}</small></div></div>
              <span className="record">{record.wins}-{record.losses}</span>
              <strong className="rating">{heatLabel(heat.lineScore)}<small>{heat.lineScore.toFixed(2)}</small></strong>
            </div>
          );
        })}
      </div>
      {!night && <p className="field-note">Start a Game Night to begin with neutral Heat.</p>}
    </div>
  );
}
