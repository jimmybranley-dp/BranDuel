import { describe, expect, it, vi } from "vitest";
import {
  DIAGNOSTIC_EVENTS,
  diagnosticRecord,
  knownActionType,
  logDiagnostic,
  sanitizeDiagnosticRecord,
} from "./observability.ts";
import { fetchExplorerRecords } from "../scripts/diagnostic-summary.mjs";

describe("diagnostic logging safety", () => {
  it("defines every required event without accepting arbitrary event names", () => {
    expect(DIAGNOSTIC_EVENTS).toEqual(
      expect.arrayContaining([
        "login.success",
        "login.failure",
        "action.request",
        "action.accepted",
        "action.rejected",
        "receipt.recovery",
        "revision.conflict",
        "settlement",
        "correction",
        "void.refund",
        "export",
        "health.failure",
        "unexpected.failure",
      ]),
    );
    expect(
      sanitizeDiagnosticRecord({
        schemaVersion: "branduel.diagnostic.v1",
        event: "password.dump",
        timestamp: new Date().toISOString(),
      }),
    ).toBeNull();
  });

  it("does not log passcodes, hashes, cookies, tokens, bodies, or state", () => {
    const passcode = "test-secret-only";
    const sessionToken = "a".repeat(64);
    const credentialHash = `pbkdf2$100000${"$"}${"b".repeat(32)}${"$"}${"c".repeat(64)}`;
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      logDiagnostic("login.failure", {
        actorId: "jimmy",
        responseStatus: 401,
        errorCode: "INVALID_LOGIN",
        passcode,
        cookie: `branduel_session=${sessionToken}`,
        sessionToken,
        credentialHash,
        body: { passcode },
        state: { balances: { "corey-jimmy": 10_000_000 } },
      });
      const serialized = String(output.mock.calls[0][0]);
      expect(serialized).not.toContain(passcode);
      expect(serialized).not.toContain(sessionToken);
      expect(serialized).not.toContain(credentialHash);
      expect(serialized).not.toContain("corey-jimmy");
      expect(serialized).not.toContain("body");
      expect(serialized).not.toContain("cookie");
      expect(serialized).not.toContain("sessionToken");
    } finally {
      output.mockRestore();
    }
  });

  it("keeps request IDs and action types bounded and omits token-shaped IDs", () => {
    expect(knownActionType("SETTLE_TEAM_EVENT")).toBe("SETTLE_TEAM_EVENT");
    expect(knownActionType("passcode-is-not-an-action")).toBe("UNKNOWN");
    const record = diagnosticRecord("action.request", {
      requestId: "a".repeat(64),
      actionType: "SETTLE_TEAM_EVENT",
      actorId: "jimmy",
      responseStatus: 200,
      durationMs: 12.4,
    });
    expect(record.requestId).toBeUndefined();
    expect(record.durationMs).toBe(12);
  });

  it("refuses hosted observability URLs", async () => {
    await expect(
      fetchExplorerRecords(
        "https://example.invalid/cdn-cgi/local/explorer/api/local/observability/query",
      ),
    ).rejects.toThrow("loopback URLs only");
  });
});
