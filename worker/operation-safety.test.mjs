import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertDestructiveTestTarget,
  assertIsolatedLocalStatePath,
  protectedLocalStatePath,
  PRODUCTION_HOSTNAME,
  STAGING_HOSTNAME,
} from "../src/operation-safety";
import {
  buildOperationPlan,
  expectedTargetConfirmation,
  runOperation,
  validateOperation,
} from "../scripts/cloudflare-operation.mjs";
import { browserTestPlayers, createEphemeralBrowserCredentials } from "../scripts/browser-test-credentials.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const wranglerConfig = JSON.parse(readFileSync(resolve(root, "wrangler.jsonc"), "utf8"));

describe("destructive operation safety", () => {
  it.each([
    `https://${PRODUCTION_HOSTNAME}`,
    `https://${PRODUCTION_HOSTNAME}/api/login`,
    `https://${PRODUCTION_HOSTNAME}:443`,
  ])("rejects production before a destructive test can start: %s", (target) => {
    expect(() => assertDestructiveTestTarget(target, "browser test")).toThrow(/production hostname/);
  });

  it.each(["http://127.0.0.1:5173", "http://localhost:5174", "https://[::1]:8443", `https://${STAGING_HOSTNAME}`])("allows the explicit rehearsal target %s", (target) => {
    expect(() => assertDestructiveTestTarget(target, "event rehearsal")).not.toThrow();
  });

  it("event rehearsal refuses production before login or mutation", () => {
    const result = spawnSync(process.execPath, [resolve(root, "scripts/event-smoke.mjs"), `https://${PRODUCTION_HOSTNAME}`], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, BRANDUEL_STATE_PATH: ".wrangler/production-refusal-test" },
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/Refusing event rehearsal against the production hostname/);
  });

  it.each([
    join(".wrangler", "state"),
    `${join(".wrangler", "state")}${process.platform === "win32" ? "\\" : "/"}`,
    join(".wrangler", "example", "..", "state"),
    join(".wrangler", "state", "child"),
    protectedLocalStatePath(root).replaceAll(process.platform === "win32" ? "\\" : "/", process.platform === "win32" ? "/" : "\\"),
  ])("rejects a protected local state path variant: %s", (statePath) => {
    expect(() => assertIsolatedLocalStatePath(statePath, root)).toThrow(/ordinary/);
  });

  it.each([join(".wrangler", "rehearsal-new"), resolve(root, "isolated-browser-state")])("allows a new isolated local state path: %s", (statePath) => {
    expect(assertIsolatedLocalStatePath(statePath, root)).toBe(resolve(root, statePath));
  });

  it("has no ambiguous generic remote migration or deployment entry points", () => {
    const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const scripts = packageJson.scripts;
    expect(scripts["db:migrate:remote"]).toBeUndefined();
    expect(scripts.deploy).toBeUndefined();
    expect(scripts["db:migrate:staging"]).toContain("cloudflare-operation.mjs migrate staging");
    expect(scripts["db:migrate:production"]).toContain("cloudflare-operation.mjs plan production migrate");
    expect(scripts["deploy:staging"]).toContain("cloudflare-operation.mjs deploy staging");
    expect(scripts["deploy:production"]).toContain("cloudflare-operation.mjs plan production deploy");
  });

  it("requires an exact target confirmation", () => {
    expect(() => validateOperation({ action: "migrate", environment: "staging", config: wranglerConfig })).toThrow(/exact target/);
    expect(() => validateOperation({ action: "migrate", environment: "staging", confirmedTarget: "branduel-production/production/branduel-production/migrate", config: wranglerConfig })).toThrow(/exact target/);
  });

  it("rejects a Wrangler Worker or D1 target mismatch before execution", () => {
    const wrongWorker = structuredClone(wranglerConfig);
    wrongWorker.env.staging.name = "wrong-worker";
    expect(() => validateOperation({ action: "deploy", environment: "staging", confirmedTarget: expectedTargetConfirmation("staging", "deploy"), config: wrongWorker })).toThrow(/does not match/);

    const wrongDatabase = structuredClone(wranglerConfig);
    wrongDatabase.env.staging.d1_databases[0].database_name = "wrong-database";
    expect(() => validateOperation({ action: "deploy", environment: "staging", confirmedTarget: expectedTargetConfirmation("staging", "deploy"), config: wrongDatabase })).toThrow(/does not match/);
  });

  it("does not invoke an operation runner after a failed safety check", () => {
    let calls = 0;
    expect(() => runOperation({ action: "deploy", environment: "staging", confirmedTarget: "wrong" }, {
      config: wranglerConfig,
      run: () => { calls += 1; },
    })).toThrow();
    expect(calls).toBe(0);
  });

  it("keeps staging and production as distinct targets", () => {
    expect(expectedTargetConfirmation("staging", "deploy")).not.toBe(expectedTargetConfirmation("production", "deploy"));
    expect(buildOperationPlan("migrate", "staging")[0].args).toContain("branduel-staging");
    expect(buildOperationPlan("migrate", "production")[0].args).toContain("branduel-production");
  });

  it("does not accept a static production flag as human authorization", () => {
    expect(() => validateOperation({
      action: "deploy",
      environment: "production",
      confirmedTarget: expectedTargetConfirmation("production", "deploy"),
      staticProductionFlag: true,
      config: wranglerConfig,
    })).toThrow(/cannot provide that authorization/);
  });

  it("builds a permitted staging plan with the target environment and Wrangler arguments", () => {
    const plan = validateOperation({
      action: "deploy",
      environment: "staging",
      confirmedTarget: expectedTargetConfirmation("staging", "deploy"),
      config: wranglerConfig,
    }).plan;
    expect(plan[0]).toMatchObject({ args: ["run", "build"], env: { CLOUDFLARE_ENV: "staging" } });
    expect(plan[2].args).toEqual(["wrangler", "deploy", "--env", "staging", "--config", "wrangler.jsonc"]);
    expect(buildOperationPlan("migrate", "staging")[0].args).toEqual(["wrangler", "d1", "migrations", "apply", "branduel-staging", "--remote", "--env", "staging", "--config", "wrangler.jsonc"]);
    expect(buildOperationPlan("secret-put", "staging")[0].args).toEqual(["wrangler", "secret", "put", "PLAYER_PASSCODES", "--env", "staging", "--config", "wrangler.jsonc"]);
  });

  it("refuses an unapproved production operation without invoking Wrangler", () => {
    const result = spawnSync(process.execPath, [resolve(root, "scripts/cloudflare-operation.mjs"), "deploy", "production", "--confirm-target", expectedTargetConfirmation("production", "deploy"), "--confirm-production-deploy"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/read-only|cannot provide that authorization/);
  });

  it("requires the ephemeral browser credential interface", () => {
    const smoke = readFileSync(resolve(root, "browser-tests/smoke.spec.ts"), "utf8");
    expect(smoke).toContain("BRANDUEL_TEST_PASSCODE");
    expect(smoke).not.toContain(".private-player-passcodes.json");
  });

  it("keeps Vite build and unit-test wrappers away from repository dotenv files", () => {
    for (const file of ["scripts/run-vite.mjs", "scripts/run-vitest.mjs"]) {
      const source = readFileSync(resolve(root, file), "utf8");
      expect(source).toContain('CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false"');
      expect(source).toContain("createIsolatedWranglerConfig");
    }
  });

  it("uses process-only ephemeral credentials for event and browser rehearsal", () => {
    for (const file of ["scripts/run-event-rehearsal.mjs", "scripts/run-browser-tests.mjs"]) {
      const source = readFileSync(resolve(root, file), "utf8");
      expect(source).toMatch(/CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV\s*[:=]\s*"true"/);
    }
    const server = readFileSync(resolve(root, "scripts/browser-test-server.mjs"), "utf8");
    expect(server).toContain("createIsolatedWranglerConfig");
    expect(server).toContain("BRANDUEL_WRANGLER_CONFIG_PATH: isolatedConfigPath");
  });

  it("prepares fresh high-entropy browser credentials without persistent files", () => {
    const first = createEphemeralBrowserCredentials();
    const second = createEphemeralBrowserCredentials();
    expect(first.passcode.length).toBeGreaterThanOrEqual(40);
    expect(first.passcode).not.toBe(second.passcode);
    expect(Object.keys(first.hashes)).toEqual(browserTestPlayers);
    expect(Object.values(first.hashes).every((hash) => /^pbkdf2\$100000\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(hash))).toBe(true);
    expect(Object.values(first.hashes)).not.toEqual(Object.values(second.hashes));
  });
});
