import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { createEphemeralBrowserCredentials } from "./browser-test-credentials.mjs";
import { parseBrowserArgs, selectBrowserRuns } from "./browser-test-plan.mjs";

let options;
try {
  options = parseBrowserArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const externalBase = process.env.BRANDUEL_BASE_URL;
const local = !externalBase;
const temporaryRoot = local
  ? await mkdtemp(join(tmpdir(), "branduel-browser-"))
  : undefined;
const runs = local
  ? selectBrowserRuns(options)
  : [
      {
        project: "chromium",
        name: "external",
        file: "browser-tests/critical-journeys.spec.ts",
      },
    ];
let exitCode = 0;

try {
  const environment = { ...process.env };
  if (local) {
    environment.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "true";
    environment.WRANGLER_LOG_PATH = join(temporaryRoot, "wrangler-logs");
  } else if (!environment.BRANDUEL_TEST_PASSCODE) {
    throw new Error(
      "BRANDUEL_TEST_PASSCODE is required when BRANDUEL_BASE_URL points at an external rehearsal target.",
    );
  }

  const playwright = resolve("node_modules", "@playwright", "test", "cli.js");
  for (const run of runs) {
    const runEnvironment = { ...environment, BRANDUEL_BROWSER_RUN: run.name };
    if (local) {
      const { passcode, hashes } = createEphemeralBrowserCredentials();
      runEnvironment.BRANDUEL_TEST_PASSCODE = passcode;
      runEnvironment.PLAYER_PASSCODES = JSON.stringify(hashes);
      runEnvironment.BRANDUEL_STATE_PATH = join(
        temporaryRoot,
        `state-${run.name}`,
      );
    }
    if (options.keepGoing) runEnvironment.BRANDUEL_BROWSER_KEEP_GOING = "1";
    runEnvironment.BRANDUEL_BOOTSTRAP_OUTPUT = resolve(
      "diagnostics",
      `branduel-browser-${run.name}.json`,
    );
    const result = spawnSync(
      process.execPath,
      [playwright, "test", run.file, `--project=${run.project}`],
      {
        cwd: process.cwd(),
        env: runEnvironment,
        stdio: "inherit",
        shell: false,
      },
    );
    if (result.error) throw result.error;
    if ((result.status ?? 1) !== 0) {
      exitCode = result.status ?? 1;
      const bootstrapPath = runEnvironment.BRANDUEL_BOOTSTRAP_OUTPUT;
      try {
        const bootstrap = JSON.parse(await readFile(bootstrapPath, "utf8"));
        bootstrap.testStatus = "failed";
        bootstrap.testExitCode = exitCode;
        if (bootstrap.status !== "failed")
          bootstrap.errorCategory = result.error
            ? "browser-launch-failure"
            : "test-assertion-failure";
        await writeFile(
          bootstrapPath,
          `${JSON.stringify(bootstrap, null, 2)}\n`,
          "utf8",
        );
      } catch {
        // The server-startup artifact remains the authoritative bootstrap evidence.
      }
      if (!options.keepGoing) {
        console.error(
          `Stopped after ${run.name} failed. Use --full-matrix to continue all selected browser runs.`,
        );
        break;
      }
    }
  }
} finally {
  if (temporaryRoot) {
    try {
      await rm(temporaryRoot, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    } catch {
      console.error("Unable to clean the temporary browser-test directory.");
      exitCode = 1;
    }
  }
}

process.exitCode = exitCode;
