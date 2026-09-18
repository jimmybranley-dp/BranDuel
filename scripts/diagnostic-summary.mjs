import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { sanitizeDiagnosticRecord } from "../worker/observability.ts";

export const DEFAULT_SLOW_ACTION_MS = 1_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PRIVATE_PATH =
  /(^|[\\/])(?:\.dev\.vars(?:\..*)?|\.private-player-[^\\/]+|[^\\/]*(?:credentials|secrets)\.(?:json|txt|env))$/i;

export function safeLocalPath(value) {
  if (typeof value !== "string" || PRIVATE_PATH.test(value))
    throw new Error(
      "Diagnostic paths must not point to credential or secret files.",
    );
  return resolve(value);
}

export function sanitizeStartupTranscript(
  text,
  { rootDir = process.cwd() } = {},
) {
  return text
    .replace(
      /pbkdf2\$\d+\$[0-9a-f]{32,}\$[0-9a-f]{64,}/gi,
      "<redacted-credential-hash>",
    )
    .replace(
      /(passcode|password|cookie|authorization|token|secret)\s*[:=]\s*[^\s,;]+/gi,
      "$1=<redacted>",
    )
    .replace(
      /branduel-(?:event|browser|vite|vitest|types)-[A-Za-z0-9_-]+/g,
      "branduel-<temporary-run>",
    )
    .replaceAll(rootDir, "<repository>")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-200)
    .map((line) => (line.length > 400 ? `${line.slice(0, 397)}...` : line))
    .join("\n")
    .slice(-32_000);
}

function safeExplorerUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Local Explorer URL must be an absolute loopback URL.");
  }
  if (
    !LOOPBACK_HOSTS.has(url.hostname.toLowerCase()) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error(
      "Local Explorer queries accept loopback URLs only; hosted data is refused.",
    );
  return url.toString();
}

export function parseDiagnosticLines(text) {
  const records = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const record = sanitizeDiagnosticRecord(JSON.parse(line));
      if (record) records.push(record);
    } catch {
      // Wrangler/Vite also write human-readable lines. They are intentionally ignored.
    }
  }
  return records;
}

export function parseExplorerRows(columns, rows) {
  const messageIndex = columns.indexOf("message");
  if (messageIndex < 0) return [];
  const records = [];
  for (const row of rows) {
    let value = row[messageIndex];
    for (let depth = 0; depth < 3; depth += 1) {
      if (typeof value !== "string") break;
      try {
        value = JSON.parse(value);
      } catch {
        break;
      }
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      let candidate = item;
      if (typeof candidate === "string") {
        try {
          candidate = JSON.parse(candidate);
        } catch {
          candidate = null;
        }
      }
      const record = sanitizeDiagnosticRecord(candidate);
      if (record) records.push(record);
    }
  }
  return records;
}

export async function fetchExplorerRecords(explorerUrl) {
  const response = await fetch(safeExplorerUrl(explorerUrl), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sql: "SELECT ts_ms, level, message, operation FROM logs WHERE message LIKE '%branduel.diagnostic.v1%' ORDER BY ts_ms DESC LIMIT 500",
    }),
  });
  if (!response.ok)
    throw new Error(
      `Local Explorer observability query failed with HTTP ${response.status}.`,
    );
  const payload = await response.json();
  if (
    !payload?.success ||
    !Array.isArray(payload.result?.columns) ||
    !Array.isArray(payload.result?.rows)
  )
    throw new Error("Local Explorer returned an invalid observability result.");
  return parseExplorerRows(payload.result.columns, payload.result.rows);
}

function summaryFields(record) {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key]) =>
        (key !== "schemaVersion" && key !== "timestamp") ||
        ["timestamp"].includes(key),
    ),
  );
}

export function summarizeDiagnostics(
  records,
  {
    now = Date.now(),
    windowMinutes = 60,
    slowActionMs = DEFAULT_SLOW_ACTION_MS,
  } = {},
) {
  const cutoff = now - windowMinutes * 60_000;
  const recent = records.filter(
    (record) =>
      Date.parse(record.timestamp) >= cutoff &&
      Date.parse(record.timestamp) <= now + 60_000,
  );
  const failed = recent.filter(
    (record) =>
      (record.responseStatus ?? 0) >= 400 ||
      ["health.failure", "unexpected.failure"].includes(record.event),
  );
  const slowActions = recent.filter(
    (record) =>
      record.event === "action.request" &&
      (record.durationMs ?? 0) >= slowActionMs,
  );
  const eventCounts = Object.fromEntries(
    [...new Set(recent.map((record) => record.event))]
      .sort()
      .map((event) => [
        event,
        recent.filter((record) => record.event === event).length,
      ]),
  );
  return {
    schemaVersion: "branduel.diagnostic.summary.v1",
    generatedAt: new Date(now).toISOString(),
    source: "local-cloudflare-observability",
    windowMinutes,
    slowActionMs,
    recordCount: recent.length,
    eventCounts,
    failedRequests: failed.map(summaryFields),
    slowActions: slowActions.map(summaryFields),
    records: recent.slice(-500),
  };
}

function option(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

export async function main(argv = process.argv.slice(2)) {
  const input = option(argv, "--input");
  const explorerUrl = option(argv, "--explorer-url");
  if (!input && !explorerUrl)
    throw new Error(
      "Usage: npm run diagnostics:local -- --input <local-worker-log> | --explorer-url <local-explorer-query-url> [--output <sanitized-json>] [--window-minutes <n>] [--slow-action-ms <n>]",
    );
  const output = option(
    argv,
    "--output",
    "diagnostics/branduel-local-diagnostics.json",
  );
  const windowMinutes = Number(option(argv, "--window-minutes", "60"));
  const slowActionMs = Number(
    option(argv, "--slow-action-ms", String(DEFAULT_SLOW_ACTION_MS)),
  );
  if (
    !Number.isFinite(windowMinutes) ||
    windowMinutes <= 0 ||
    !Number.isFinite(slowActionMs) ||
    slowActionMs < 0
  )
    throw new Error(
      "Diagnostic window and slow-action threshold must be finite positive numbers.",
    );
  const records = explorerUrl
    ? await fetchExplorerRecords(explorerUrl)
    : parseDiagnosticLines(readFileSync(safeLocalPath(input), "utf8"));
  const artifact = summarizeDiagnostics(records, {
    windowMinutes,
    slowActionMs,
  });
  const outputPath = safeLocalPath(output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(
    `Sanitized diagnostic artifact written (${artifact.recordCount} recent records, ${artifact.failedRequests.length} failures, ${artifact.slowActions.length} slow actions).`,
  );
}

if (process.argv[1]?.endsWith("diagnostic-summary.mjs")) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Diagnostic summary failed.",
    );
    process.exitCode = 1;
  }
}
