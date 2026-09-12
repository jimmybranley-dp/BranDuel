import { describe, expect, it, vi } from "vitest";
import { createInitialState } from "./data";
import { postAction, resolveRequest, type PendingRequest } from "./transport";

const request: PendingRequest = {
  requestId: "saved-receipt-123", playerId: "jimmy", createdAt: "2026-09-05T20:00:00Z",
  action: { type: "ADJUST_BALANCE", teamId: "jason-ezra", amount: 100000, note: "Prize correction" },
};
const snapshot = { state: createInitialState(), revision: 2, serverTime: "2026-09-05T20:00:00Z", playerId: "jimmy" };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

describe("confirmed client requests", () => {
  it("sends identity expectation and original receipt, then accepts only a server snapshot", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json(snapshot));
    const result = await postAction(request, fetcher);
    expect(result.kind).toBe("accepted");
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({ action: request.action, requestId: request.requestId, expectedPlayerId: "jimmy" });
  });
  it("recovers a committed action after its response was lost without another write", async () => {
    let writes = 0;
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      if (options?.method === "POST") { writes++; throw new TypeError("Connection lost after commit"); }
      return json(snapshot);
    });
    expect((await postAction(request, fetcher)).kind).toBe("uncertain");
    expect((await resolveRequest(request, fetcher)).kind).toBe("accepted");
    expect(writes).toBe(1);
    expect(fetcher.mock.calls[1][0]).toBe("/api/actions/saved-receipt-123?expectedPlayerId=jimmy");
  });
  it("replays the same request only when its receipt is definitively unknown", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(json({ code: "REQUEST_UNKNOWN" }, 404)).mockResolvedValueOnce(json(snapshot));
    expect((await resolveRequest(request, fetcher)).kind).toBe("accepted");
    expect(JSON.parse(fetcher.mock.calls[1][1]!.body as string)).toEqual({ action: request.action, requestId: request.requestId, expectedPlayerId: "jimmy" });
  });
  it("never replays on an unavailable receipt lookup", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ code: "SERVICE_UNAVAILABLE" }, 503));
    expect((await resolveRequest(request, fetcher)).kind).toBe("uncertain");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([400, 403, 404, 409])("recognizes a definitive rejection (%s), including a stored rejected receipt", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ code: "INVALID_RESULT", error: "Result rejected." }, status));
    expect(await resolveRequest(request, fetcher)).toEqual({ kind: "rejected", message: "Result rejected." });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retains uncertainty when the cookie changed to a different player", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ code: "SESSION_CHANGED", error: "Sign in as Jimmy." }, 401));
    expect(await postAction(request, fetcher)).toEqual({ kind: "uncertain", unauthorized: true, message: "Sign in as Jimmy." });
  });
  it("does not accept a receipt from another identity", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ...snapshot, playerId: "corey" }));
    expect(await resolveRequest(request, fetcher)).toMatchObject({ kind: "uncertain", unauthorized: true });
  });
  it("keeps a malformed success response uncertain", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(json({ ok: true }));
    expect((await postAction(request, fetcher)).kind).toBe("uncertain");
  });
});
