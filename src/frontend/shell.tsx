import type { ReactNode } from "react";
import { Check } from "@phosphor-icons/react";
import { formatMoney } from "../engine";
import { useStore } from "../store";
import { RequestStatus } from "./auth";
import { BrandMark, NAV, PlayerPicker, type View } from "./shared";

export function Shell({ view, onView, children, toast }: { view: View; onView: (view: View) => void; children: ReactNode; toast: string }) {
  const { state, syncStatus, canWrite } = useStore();
  const player = state.players[state.currentPlayerId];
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
                {item.label}
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
              <span>{item.label === "Match Setup" ? "Setup" : item.label}</span>
            </button>
          );
        })}
      </nav>
      {toast && <div className="toast" role="status"><Check size={19} weight="bold" />{toast}</div>}
    </div>
  );
}
