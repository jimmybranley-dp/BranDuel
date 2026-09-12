import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createInitialState, normalizeState } from "./data";
import type { Action } from "./domain";
import type { AppState, PlayerId } from "./types";
import { postAction, resolveRequest, type PendingRequest, type ServerSnapshot } from "./transport";

const CACHE_KEY = "branduel-confirmed-state-v3";
const PENDING_KEY = "branduel-pending-request-v1";
export type SyncStatus = "connecting" | "shared" | "offline";
type StoreValue = {
  state: AppState; dispatch: (action: Action) => Promise<boolean>; syncStatus: SyncStatus;
  playerId: PlayerId | null; sessionReady: boolean; busy: boolean; pending: PendingRequest | null;
  error: string; lastSync: number | null; serverOffset: number; canWrite: boolean;
  login: (playerId: PlayerId, passcode: string) => Promise<boolean>; logout: () => Promise<void>;
  retryPending: () => Promise<void>; refresh: () => Promise<void>;
};
const StoreContext = createContext<StoreValue | null>(null);
function readSaved<T>(key: string, storage: Storage): T | null {
  try { return JSON.parse(storage.getItem(key) ?? "null") as T | null; } catch { return null; }
}
export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>(() => normalizeState(readSaved<AppState>(CACHE_KEY, localStorage) ?? createInitialState()));
  const [playerId, setPlayerId] = useState<PlayerId | null>(null);
  const playerRef = useRef<PlayerId | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("connecting");
  const syncRef = useRef<SyncStatus>("connecting");
  const [pending, setPending] = useState<PendingRequest | null>(() => readSaved<PendingRequest>(PENDING_KEY, sessionStorage));
  const pendingRef = useRef(pending);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const revision = useRef(-1);
  const status = useCallback((value: SyncStatus) => { syncRef.current = value; setSyncStatus(value); }, []);
  const identity = useCallback((value: PlayerId | null) => { playerRef.current = value; setPlayerId(value); }, []);
  const hydrate = useCallback((payload: ServerSnapshot) => {
    if (!playerRef.current) return;
    if (payload.playerId !== playerRef.current) {
      identity(null); status("offline"); setError("This browser signed in as another player. Sign in again before making changes."); return;
    }
    if (payload.revision >= revision.current && playerRef.current) {
      revision.current = payload.revision;
      const accepted = { ...normalizeState(payload.state), currentPlayerId: playerRef.current };
      setState(accepted);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(accepted)); } catch { /* Cache is optional. */ }
    }
    const serverTime = typeof payload.serverTime === "number" ? payload.serverTime : Date.parse(payload.serverTime);
    if (Number.isFinite(serverTime)) setServerOffset(serverTime - Date.now());
    setConnectionError(""); setLastSync(Date.now()); status("shared");
  }, [identity, status]);
  const refresh = useCallback(async () => {
    if (!playerRef.current) return;
    try {
      const response = await fetch("/api/state", { cache: "no-store", signal: AbortSignal.timeout(12000) });
      if (response.status === 401) { identity(null); throw new Error("Your session expired. Sign in again to continue."); }
      if (!response.ok) throw new Error("The shared house is unavailable. The last confirmed view is read-only.");
      hydrate(await response.json() as ServerSnapshot);
    } catch (cause) { status("offline"); setConnectionError(cause instanceof TypeError || (cause instanceof DOMException && cause.name === "TimeoutError") ? "The shared house is unavailable. Your last confirmed view is read-only until it reconnects." : cause instanceof Error ? cause.message : "Could not refresh the shared house."); }
  }, [hydrate, identity, status]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/session", { cache: "no-store", signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error("Could not check your session. Try signing in.");
        const session = await response.json() as { playerId: PlayerId | null };
        if (!active) return;
        if (pendingRef.current && session.playerId !== pendingRef.current.playerId) {
          identity(null); setError(`Sign in as ${pendingRef.current.playerId} to resolve the saved request.`); return;
        }
        identity(session.playerId);
        if (session.playerId) await refresh();
      } catch (cause) { if (active) { status("offline"); setError(cause instanceof Error ? cause.message : "Connection unavailable."); } }
      finally { if (active) setSessionReady(true); }
    })();
    const interval = window.setInterval(() => { if (active) void refresh(); }, 2000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener("focus", focus); };
  }, [identity, refresh, status]);
  const clearPending = useCallback(() => {
    sessionStorage.removeItem(PENDING_KEY); pendingRef.current = null; setPending(null);
  }, []);
  const send = useCallback(async (request: PendingRequest, recover = false): Promise<boolean> => {
    busyRef.current = true; setBusy(true); setError("");
    try {
      const result = await (recover ? resolveRequest(request) : postAction(request));
      if (result.kind === "accepted") { hydrate(result.payload); clearPending(); if (recover) await refresh(); return true; }
      if (result.kind === "rejected") { clearPending(); setError(result.message); await refresh(); return false; }
      if (result.unauthorized) identity(null);
      status("offline"); setError(result.message); return false;
    } finally { busyRef.current = false; setBusy(false); }
  }, [clearPending, hydrate, identity, refresh, status]);
  const dispatch = useCallback(async (action: Action) => {
    if (busyRef.current || pendingRef.current || !playerRef.current || syncRef.current !== "shared") {
      setError("Wait for the current request to be resolved and the shared house to reconnect."); return false;
    }
    const request: PendingRequest = { requestId: crypto.randomUUID(), playerId: playerRef.current, action, createdAt: new Date().toISOString() };
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(request)); }
    catch { setError("This browser cannot save a recovery receipt. Enable browser storage before making changes."); return false; }
    pendingRef.current = request; setPending(request);
    return send(request);
  }, [send]);
  const retryPending = useCallback(async () => {
    const request = pendingRef.current;
    if (!request || busyRef.current) return;
    if (playerRef.current !== request.playerId) { setError(`Sign in as ${request.playerId} to resolve this request.`); return; }
    await send(request, true);
  }, [send]);
  const login = useCallback(async (id: PlayerId, passcode: string) => {
    if (busyRef.current) return false;
    if (pendingRef.current && pendingRef.current.playerId !== id) { setError(`Resolve the pending request as ${pendingRef.current.playerId} first.`); return false; }
    busyRef.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playerId: id, passcode }), signal: AbortSignal.timeout(12000) });
      const payload = await response.json() as { playerId?: PlayerId; error?: string };
      if (!response.ok || !payload.playerId) throw new Error(payload.error ?? "Sign-in failed.");
      identity(payload.playerId); revision.current = -1; await refresh(); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign in. Check the connection and try again."); return false; }
    finally { busyRef.current = false; setBusy(false); }
  }, [identity, refresh]);
  const logout = useCallback(async () => {
    if (busyRef.current || pendingRef.current) { setError("Resolve the pending request before signing out."); return; }
    busyRef.current = true; setBusy(true);
    try {
      const response = await fetch("/api/logout", { method: "POST", signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error("Could not sign out. Try again.");
      identity(null); revision.current = -1; status("connecting"); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign out."); }
    finally { busyRef.current = false; setBusy(false); }
  }, [identity, status]);
  const value = useMemo(() => ({ state, dispatch, syncStatus, playerId, sessionReady, busy, pending, error: error || connectionError, lastSync, serverOffset, canWrite: !!playerId && syncStatus === "shared" && !busy && !pending, login, logout, retryPending, refresh }), [state, dispatch, syncStatus, playerId, sessionReady, busy, pending, error, connectionError, lastSync, serverOffset, login, logout, retryPending, refresh]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useStore must be used inside StoreProvider");
  return context;
}
