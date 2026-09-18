import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const targets = {
  staging: { worker: "branduel-staging", environment: "staging", database: "branduel-staging" },
  production: { worker: "branduel-production", environment: "production", database: "branduel-production" },
};

export const actions = new Set(["migrate", "deploy", "secret-put"]);

export function expectedTargetConfirmation(environment, action) {
  const target = targets[environment];
  if (!target || !actions.has(action)) throw new Error("Unknown Cloudflare operation target or action.");
  return `${target.worker}/${target.environment}/${target.database}/${action}`;
}

export function validateWranglerConfiguration(config, environment) {
  const target = targets[environment];
  const environmentConfig = config?.env?.[environment];
  const configuredDatabase = environmentConfig?.d1_databases?.find((database) => database.binding === "DB");
  if (!target || environmentConfig?.name !== target.worker || configuredDatabase?.database_name !== target.database) {
    throw new Error(`Refusing remote operation: wrangler.jsonc does not match the declared ${environment} Worker and D1 target.`);
  }
  return target;
}

export function buildOperationPlan(action, environment) {
  const target = targets[environment];
  if (!target || !actions.has(action)) throw new Error("Unknown Cloudflare operation target or action.");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const wranglerArgs = ["--env", target.environment, "--config", "wrangler.jsonc"];

  if (action === "migrate") {
    return [{ command: npx, args: ["wrangler", "d1", "migrations", "apply", target.database, "--remote", ...wranglerArgs] }];
  }
  if (action === "deploy") {
    return [
      { command: npm, args: ["run", "build"], env: { CLOUDFLARE_ENV: target.environment } },
      { command: npm, args: ["run", "check:artifacts"] },
      { command: npx, args: ["wrangler", "deploy", ...wranglerArgs] },
    ];
  }
  return [{ command: npx, args: ["wrangler", "secret", "put", "PLAYER_PASSCODES", ...wranglerArgs] }];
}

export function validateOperation({ action, environment, confirmedTarget, config, mode = "execute", staticProductionFlag = false }) {
  const target = validateWranglerConfiguration(config, environment);
  const expected = expectedTargetConfirmation(environment, action);
  if (confirmedTarget !== expected) {
    throw new Error(`Refusing remote operation until the exact target is confirmed with --confirm-target ${expected}.`);
  }
  if (environment === "production" && mode === "execute") {
    const flagNote = staticProductionFlag ? " A command-line flag cannot provide that authorization." : "";
    throw new Error(`Refusing production ${action}: this local wrapper is read-only; external human authorization is required.${flagNote}`);
  }
  return { target, expected, plan: buildOperationPlan(action, environment) };
}

export function runOperation(request, { config, run = runCommand, env = process.env } = {}) {
  const validated = validateOperation({ ...request, config, mode: "execute" });
  for (const operation of validated.plan) run(operation.command, operation.args, { ...env, ...operation.env });
  return validated.plan;
}

export function runCommand(command, args, env = process.env) {
  // Windows exposes npm executables as .cmd shims, which require a shell when
  // launched through Node's child-process API. Keep the command and argument
  // list separate so the fixed operation plan remains auditable on both OSes.
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited with code ${result.status ?? 1}.`);
}

function readConfig() {
  return JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
}

function parseCli(argv) {
  const [first, second, ...rest] = argv;
  const planning = first === "plan";
  const action = planning ? rest.shift() : first;
  const environment = planning ? second : second;
  const flags = planning ? rest : rest;
  const confirmationIndex = flags.indexOf("--confirm-target");
  return {
    action,
    environment,
    mode: planning ? "plan" : "execute",
    confirmedTarget: confirmationIndex >= 0 ? flags[confirmationIndex + 1] : undefined,
    staticProductionFlag: flags.includes("--confirm-production-deploy"),
  };
}

export function main(argv = process.argv.slice(2)) {
  const request = parseCli(argv);
  if (!actions.has(request.action) || !targets[request.environment]) {
    throw new Error("Usage: node scripts/cloudflare-operation.mjs <migrate|deploy|secret-put> <staging|production> [--confirm-target <worker>/<environment>/<database>/<action>]\n       or: node scripts/cloudflare-operation.mjs plan <production> <migrate|deploy|secret-put> [--confirm-target <worker>/<environment>/<database>/<action>]");
  }

  const target = targets[request.environment];
  console.log(`Remote operation target\nAction: ${request.action}\nWorker: ${target.worker}\nEnvironment: ${target.environment}\nD1 database: ${target.database}`);
  const validated = validateOperation({ ...request, config: readConfig() });
  if (request.mode === "plan") {
    console.log("Production operation plan only: no command was executed.");
    console.log(JSON.stringify(validated.plan, null, 2));
    console.log("External human authorization is still required through a protected deployment mechanism.");
    return;
  }
  for (const operation of validated.plan) runCommand(operation.command, operation.args, { ...process.env, ...operation.env });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
