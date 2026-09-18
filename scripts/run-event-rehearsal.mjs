import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { createEphemeralBrowserCredentials } from "./browser-test-credentials.mjs";
import {
  safeLocalPath,
  sanitizeStartupTranscript,
} from "./diagnostic-summary.mjs";

const temporaryRoot = await mkdtemp(join(tmpdir(), "branduel-event-"));
const statePath = join(temporaryRoot, "state");
const { passcode, hashes } = createEphemeralBrowserCredentials();
const environment = {
  ...process.env,
  BRANDUEL_STATE_PATH: statePath,
  BRANDUEL_TEST_PASSCODE: passcode,
  PLAYER_PASSCODES: JSON.stringify(hashes),
  BRANDUEL_BOOTSTRAP_OUTPUT: resolve(
    "diagnostics/branduel-event-bootstrap.json",
  ),
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "true",
  WRANGLER_LOG_PATH: join(statePath, "wrangler-logs"),
};
const server = spawn(
  process.execPath,
  [resolve("scripts/browser-test-server.mjs")],
  {
    cwd: process.cwd(),
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  },
);
let capturedOutput = "";
const capture = (chunk) => {
  if (capturedOutput.length < 5_000_000) capturedOutput += chunk.toString();
};
server.stdout?.on("data", capture);
server.stderr?.on("data", capture);
let stopping = false;
let serverExit = { code: null, signal: null };
server.on("exit", (code, signal) => {
  serverExit = { code, signal };
  if (!stopping) process.exitCode = code ?? (signal ? 1 : 0);
});
let exitCode = 1;
let phase = "migration";
let errorCategory = null;
let readinessReached = false;
let actionsAttempted = false;

function classifyBootstrapFailure(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/migration/i.test(message)) return "migration-failure";
  if (/exited before becoming ready/i.test(message))
    return "server-exited-before-readiness";
  if (/timed out waiting/i.test(message)) return "readiness-timeout";
  if (/browser|playwright/i.test(message)) return "browser-launch-failure";
  return "bootstrap-failure";
}

async function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    new Promise((resolvePromise) => setTimeout(resolvePromise, timeoutMs)),
  ]);
}

try {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      phase = "server-readiness";
      throw new Error(
        `Local rehearsal server exited before becoming ready (${serverExit.code ?? "signal"}).`,
      );
    }
    try {
      const response = await fetch("http://127.0.0.1:5173/api/session", {
        signal: AbortSignal.timeout(500),
      });
      if (response.status === 200 || response.status === 401) break;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (attempt === 119) {
      phase = "server-readiness";
      throw new Error("Timed out waiting for the isolated rehearsal server.");
    }
  }

  readinessReached = true;
  phase = "event-actions";
  actionsAttempted = true;
  const result = spawnSync(
    process.execPath,
    [resolve("scripts/event-smoke.mjs"), "http://127.0.0.1:5173"],
    {
      cwd: process.cwd(),
      env: environment,
      stdio: "inherit",
      shell: false,
    },
  );
  if (result.error) throw result.error;
  exitCode = result.status ?? 1;
  if (exitCode !== 0) errorCategory = "test-assertion-failure";
} catch (error) {
  errorCategory = classifyBootstrapFailure(error);
  console.error(
    error instanceof Error
      ? error.message
      : "Event rehearsal bootstrap failed.",
  );
} finally {
  const rawLogPath = join(temporaryRoot, "local-cloudflare-console.log");
  await writeFile(rawLogPath, capturedOutput, "utf8");
  const diagnosticOutput = resolve(
    process.env.BRANDUEL_DIAGNOSTIC_OUTPUT ??
      "diagnostics/branduel-event-rehearsal.json",
  );
  const diagnosticScript = resolve("scripts/diagnostic-summary.mjs");
  let diagnostic = spawnSync(
    process.execPath,
    [
      diagnosticScript,
      "--explorer-url",
      "http://127.0.0.1:5173/cdn-cgi/local/explorer/api/local/observability/query",
      "--output",
      diagnosticOutput,
    ],
    { cwd: process.cwd(), stdio: "inherit", shell: false },
  );
  if (diagnostic.status !== 0)
    diagnostic = spawnSync(
      process.execPath,
      [diagnosticScript, "--input", rawLogPath, "--output", diagnosticOutput],
      { cwd: process.cwd(), stdio: "inherit", shell: false },
    );
  if (diagnostic.error || diagnostic.status !== 0)
    exitCode = exitCode === 0 ? (diagnostic.status ?? 1) : exitCode;
  stopping = true;
  if (server.exitCode === null) {
    server.kill();
    await waitForExit(server);
    if (server.exitCode === null) {
      server.kill("SIGKILL");
      await waitForExit(server, 1_000);
    }
  }
  const diagnosticPath = safeLocalPath(diagnosticOutput);
  let artifact = {
    schemaVersion: "branduel.diagnostic.summary.v1",
    records: [],
  };
  try {
    artifact = JSON.parse(await readFile(diagnosticPath, "utf8"));
  } catch {
    // Bootstrap diagnostics remain useful even when the Explorer/log parser cannot run.
  }
  const records = Array.isArray(artifact.records) ? artifact.records : [];
  const workerRequestCount = records.filter((record) =>
    ["action.request", "login.success", "login.failure"].includes(record.event),
  ).length;
  artifact.bootstrap = {
    schemaVersion: "branduel.bootstrap.v1",
    status: exitCode === 0 && readinessReached ? "passed" : "failed",
    phase,
    errorCategory,
    runtime: { node: process.version, platform: process.platform },
    loopbackOrigin: "http://127.0.0.1:5173",
    stateDirectory: basename(statePath),
    configFile: "wrangler.jsonc",
    migration: capturedOutput.includes("phase=migration status=passed")
      ? "passed"
      : "failed-or-unknown",
    serverReadiness: readinessReached ? "passed" : "failed",
    exit: serverExit,
    workerRequestsRan: workerRequestCount > 0,
    workerRequestCount,
    startupTranscript: sanitizeStartupTranscript(capturedOutput),
    actionsAttempted,
  };
  await writeFile(
    diagnosticPath,
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );
  await rm(temporaryRoot, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}

process.exitCode = exitCode;
