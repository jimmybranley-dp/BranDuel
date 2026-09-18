import { spawnSync } from "node:child_process";
import process from "node:process";
import { performance } from "node:perf_hooks";
import {
  parseVerificationArgs,
  selectVerificationSteps,
  VERIFICATION_STAGE_IDS,
} from "./verification-plan.mjs";

const npmExecPath = process.env.npm_execpath;
const npm = npmExecPath
  ? process.execPath
  : process.platform === "win32"
    ? "npm.cmd"
    : "npm";
const npmPrefix = npmExecPath ? [npmExecPath] : [];
let options;
try {
  options = parseVerificationArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`Available stages: ${VERIFICATION_STAGE_IDS.join(", ")}`);
  process.exit(1);
}

if (options.list) {
  console.log(VERIFICATION_STAGE_IDS.join("\n"));
  process.exit(0);
}

const steps = selectVerificationSteps(options);
console.log(
  `Verification selection: ${steps.map((step) => step.id).join(", ")}`,
);

for (const step of steps) {
  const started = performance.now();
  console.log(`\n=== ${step.name} ===`);
  const result = spawnSync(npm, [...npmPrefix, ...step.args], {
    stdio: "inherit",
    shell: false,
  });
  const duration = ((performance.now() - started) / 1000).toFixed(1);

  if (result.error) {
    console.error(
      `${step.name} could not start after ${duration}s: ${result.error.message}`,
    );
    process.exitCode = 1;
    break;
  }

  if (result.status !== 0) {
    const code = result.status ?? 1;
    console.error(
      `${step.name} failed with exit code ${code} after ${duration}s.`,
    );
    console.error(
      `Rerun only this stage with: npm run verify:stage -- ${step.id}`,
    );
    process.exitCode = code;
    break;
  }

  console.log(`${step.name} passed in ${duration}s.`);
}
