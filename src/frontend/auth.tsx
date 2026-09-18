import { useState } from "react";
import { PLAYER_IDS } from "../data";
import { useStore } from "../store";
import type { PlayerId } from "../types";
import { BrandMark, formatDate } from "./shared";

export function LoginScreen() {
  const { state, login, pending, busy, error } = useStore();
  const [player, setPlayer] = useState<PlayerId | "">(pending?.playerId ?? "");
  const [passcode, setPasscode] = useState("");
  return <div className="login-page"><BrandMark /><form className="login-card" onSubmit={async (e) => { e.preventDefault(); if (player && await login(player, passcode)) setPasscode(""); }}>
    <h1>Take your seat.</h1><p>Choose your name and enter your Derby passcode.</p>
    {pending && <p className="notice">A request from {state.players[pending.playerId].name} needs confirmation. Sign in with that account to recover it.</p>}
    <label htmlFor="login-player">Player<select id="login-player" required autoComplete="username" aria-describedby={error ? "login-error" : undefined} value={player} disabled={busy || !!pending} onChange={(e) => setPlayer(e.target.value as PlayerId)}><option value="">Choose your name</option>{PLAYER_IDS.map((id) => <option value={id} key={id}>{state.players[id].name}</option>)}</select></label>
    <label htmlFor="login-passcode">Passcode<input id="login-passcode" required type="password" autoComplete="current-password" aria-describedby={error ? "login-error" : undefined} value={passcode} disabled={busy} onChange={(e) => setPasscode(e.target.value)} /></label>
    {error && <p id="login-error" role="alert" className="form-error">{error}</p>}
    <button className="primary-button full" disabled={!player || !passcode || busy}>{busy ? "Signing in..." : "Sign in"}</button>
  </form></div>;
}

export function RequestStatus() {
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
