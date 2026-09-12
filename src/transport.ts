import type { Action } from "./domain";
import type { AppState, PlayerId } from "./types";
export type PendingRequest = { requestId: string; playerId: PlayerId; action: Action; createdAt: string };
export type ServerSnapshot = { state: AppState; revision: number; serverTime: string | number; playerId: PlayerId };
type ActionResponse = { kind: "accepted"; payload: ServerSnapshot } | { kind: "rejected"; message: string } | { kind: "uncertain"; message: string; unauthorized?: boolean };
async function interpret(response: Response, expectedPlayerId: PlayerId): Promise<ActionResponse> {
  const payload = await response.json() as Partial<ServerSnapshot> & { error?: string; code?: string };
  if (response.ok && payload.state && typeof payload.revision === "number") {
    if (payload.playerId !== expectedPlayerId) return { kind: "uncertain", unauthorized: true, message: "The browser session changed. Sign in as the original player to resolve this receipt." };
    return { kind: "accepted", payload: payload as ServerSnapshot };
  }
  if ([400, 403, 404, 409, 422].includes(response.status)) return { kind: "rejected", message: payload.error ?? "The house rejected this request. No change was accepted." };
  return { kind: "uncertain", unauthorized: response.status === 401, message: payload.error ?? "Confirmation is missing. Resolve this request before making another change." };
}
export async function postAction(request: PendingRequest, fetcher: typeof fetch = fetch): Promise<ActionResponse> {
  try {
    const response = await fetcher("/api/actions", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ action: request.action, requestId: request.requestId, expectedPlayerId: request.playerId }), signal: AbortSignal.timeout(12000) });
    return await interpret(response, request.playerId);
  } catch { return { kind: "uncertain", message: "The response did not arrive. This request may already be accepted. Retry its saved receipt to confirm." }; }
}
export async function resolveRequest(request: PendingRequest, fetcher: typeof fetch = fetch): Promise<ActionResponse> {
  try {
    const response = await fetcher(`/api/actions/${encodeURIComponent(request.requestId)}?expectedPlayerId=${encodeURIComponent(request.playerId)}`, { cache: "no-store", signal: AbortSignal.timeout(12000) });
    if (response.status === 404) {
      const payload = await response.clone().json() as { code?: string };
      if (payload.code === "REQUEST_UNKNOWN") return postAction(request, fetcher);
    }
    return await interpret(response, request.playerId);
  } catch { return { kind: "uncertain", message: "The receipt could not be checked. Keep this saved request and try again when connected." }; }
}
