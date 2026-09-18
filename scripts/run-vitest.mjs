import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createIsolatedWranglerConfig } from "./isolated-wrangler-config.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoot = await mkdtemp(join(tmpdir(), "branduel-vitest-"));
const statePath = join(temporaryRoot, "state");
const wranglerConfigPath = await createIsolatedWranglerConfig(statePath);
const vitest = resolve(root, "node_modules", "vitest", "vitest.mjs");
const args = [
  "run",
  "--config",
  resolve(root, "vite.config.ts"),
  ...process.argv.slice(2),
];
const result = spawnSync(process.execPath, [vitest, ...args], {
  cwd: root,
  env: {
    ...process.env,
    BRANDUEL_STATE_PATH: statePath,
    BRANDUEL_WRANGLER_CONFIG_PATH: wranglerConfigPath,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
  },
  encoding: "utf8",
  shell: false,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) {
  console.error(`Vitest could not start: ${result.error.message}`);
  process.exitCode = 1;
} else if (result.status !== 0) {
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const category = /access is denied|eperm/i.test(combined)
    ? "host-filesystem-access"
    : /failed to load config|startup error/i.test(combined)
      ? "test-config-startup"
      : "test-process-failure";
  console.error("Vitest bootstrap diagnostic:");
  console.error(`- runtime: ${process.version}`);
  console.error(`- working directory: ${root}`);
  console.error("- config file: vite.config.ts");
  console.error(`- temporary state directory: ${statePath}`);
  console.error(`- sanitized error category: ${category}`);
  process.exitCode = result.status ?? 1;
} else {
  process.exitCode = 0;
}

await rm(temporaryRoot, {
  recursive: true,
  force: true,
  maxRetries: 3,
  retryDelay: 50,
});
