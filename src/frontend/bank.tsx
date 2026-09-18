import { useState } from "react";
import { Bank, Plus, Receipt } from "@phosphor-icons/react";
import { TEAM_IDS } from "../data";
import { formatAmericanOdds, formatMoney } from "../engine";
import { useStore } from "../store";
import type { PlayerId, TeamId } from "../types";
import { AdminPanel } from "./commissioner";
import { EmptyState, formatDate } from "./shared";

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

export function BankView({ notify }: { notify: (message: string) => void }) {
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

