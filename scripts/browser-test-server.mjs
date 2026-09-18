import { mkdirSync, writeFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { assertIsolatedLocalStatePath } from "../src/operation-safety.ts";
import { sanitizeStartupTranscript } from "./diagnostic-summary.mjs";
import { createIsolatedWranglerConfig } from "./isolated-wrangler-config.mjs";

const bootstrapOutput = process.env.BRANDUEL_BOOTSTRAP_OUTPUT;
let transcript = "";
let migrationStatus = "not-started";
let readinessStatus = "not-started";
const startedAt = new Date().toISOString();

function capture(value) {
  transcript = `${transcript}${value}`.slice(-100_000);
  process.stdout.write(value);
}

function writeBootstrap(status, errorCategory, exit = {}) {
  if (!bootstrapOutput) return;
  const output = resolve(bootstrapOutput);
  mkdirSync(resolve(output, ".."), { recursive: true });
  writeFileSync(
    output,
    `${JSON.stringify(
      {
        schemaVersion: "branduel.bootstrap.v1",
        status,
        phase: migrationStatus === "failed" ? "migration" : "server-readiness",
        errorCategory,
        startedAt,
        completedAt: new Date().toISOString(),
        runtime: { node: process.version, platform: process.platform },
        loopbackOrigin: "http://127.0.0.1:5173",
        stateDirectory: basename(statePath),
        configFile: "wrangler.jsonc",
        migration: migrationStatus,
        readiness: readinessStatus,
        exit,
        startupTranscript: sanitizeStartupTranscript(transcript),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

const statePath = process.env.BRANDUEL_STATE_PATH
  ? assertIsolatedLocalStatePath(process.env.BRANDUEL_STATE_PATH)
  : resolve(".wrangler", `browser-test-${Date.now()}`);
mkdirSync(statePath, { recursive: true });
console.log("BRANDUEL_BOOTSTRAP phase=migration status=starting");

const isolatedConfigPath = await createIsolatedWranglerConfig(statePath);

const wrangler = resolve("node_modules", "wrangler", "bin", "wrangler.js");
const migration = spawnSync(
  process.execPath,
  [
    wrangler,
    "d1",
    "migrations",
    "apply",
    "branduel-db",
    "--local",
    "--persist-to",
    statePath,
  ],
  { encoding: "utf8", shell: false },
);
capture(migration.stdout ?? "");
capture(migration.stderr ?? "");
if (migration.status !== 0) {
  migrationStatus = "failed";
  writeBootstrap("failed", "migration-failure", {
    code: migration.status ?? 1,
  });
  process.exit(migration.status ?? 1);
}
migrationStatus = "passed";
console.log("BRANDUEL_BOOTSTRAP phase=migration status=passed");

const vite = resolve("node_modules", "vite", "bin", "vite.js");
console.log("BRANDUEL_BOOTSTRAP phase=server-readiness status=starting");
readinessStatus = "starting";
const server = spawn(
  process.execPath,
  [
    vite,
    "--config",
    "vite.config.ts",
    "--host",
    "127.0.0.1",
    "--port",
    "5173",
    "--strictPort",
  ],
  {
    env: {
      ...process.env,
      BRANDUEL_STATE_PATH: statePath,
      BRANDUEL_WRANGLER_CONFIG_PATH: isolatedConfigPath,
    },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  },
);
server.stdout?.on("data", capture);
server.stderr?.on("data", capture);
let ready = false;
for (let attempt = 0; attempt < 240; attempt += 1) {
  if (server.exitCode !== null) {
    readinessStatus = "failed";
    writeBootstrap("failed", "server-exited-before-readiness", {
      code: server.exitCode,
    });
    process.exit(server.exitCode ?? 1);
  }
  try {
    const response = await fetch("http://127.0.0.1:5173/api/session", {
      signal: AbortSignal.timeout(500),
    });
    if (response.status === 200 || response.status === 401) {
      ready = true;
      break;
    }
  } catch {
    // The server is still starting.
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
}
if (!ready) {
  readinessStatus = "failed";
  server.kill();
  writeBootstrap("failed", "readiness-timeout");
  process.exit(1);
}
readinessStatus = "passed";
console.log("BRANDUEL_BOOTSTRAP phase=server-readiness status=passed");
writeBootstrap("ready", null);
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
server.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
