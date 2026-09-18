import { useState } from "react";
import { Target } from "@phosphor-icons/react";
import { getGameRecords } from "../engine";
import { useStore } from "../store";
import type { GameId } from "../types";
import { ICONS } from "./shared";

export function RatingsView() {
  const { state } = useStore();
  const [gameId, setGameId] = useState<GameId>("smash");
  const records = getGameRecords(state, gameId);
  return (
    <div className="page page-enter">
      <div className="page-header"><div><p className="eyebrow">Power ratings</p><h1>Ratings</h1><p>See each player's form by game. The house uses these ratings when it sets the line.</p></div></div>
      <div className="game-tabs" role="tablist">
        {Object.keys(state.games).map((id) => { const Icon = ICONS[id as GameId] ?? Target; return <button role="tab" aria-selected={gameId === id} className={gameId === id ? "active" : ""} onClick={() => setGameId(id as GameId)} key={id}><Icon size={19} />{state.games[id].shortName}</button>; })}
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

