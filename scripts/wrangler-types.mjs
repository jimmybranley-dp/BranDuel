import { mkdtemp, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outputDefault = resolve(root, "worker-configuration.d.ts");

function valueAfter(argv, name, fallback) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : fallback;
}

export async function runWranglerTypes(argv = process.argv.slice(2)) {
  const mode = argv[0] ?? "generate";
  if (!["generate", "check"].includes(mode))
    throw new Error(
      "Usage: node scripts/wrangler-types.mjs <generate|check> [--output <path>]",
    );

  const output = resolve(valueAfter(argv, "--output", outputDefault));
  const outputArgument = relative(root, output) || ".";
  const config = valueAfter(argv, "--config");
  const logRoot = await mkdtemp(join(tmpdir(), "branduel-wrangler-logs-"));
  const wrangler = resolve(
    root,
    "node_modules",
    "wrangler",
    "bin",
    "wrangler.js",
  );
  const args = [wrangler, "types", outputArgument];
  if (config) args.push("--config", resolve(config));
  if (mode === "check") args.push("--check");

  try {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env: {
        ...process.env,
        CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false",
        WRANGLER_LOG_PATH: logRoot,
      },
      stdio: "inherit",
      shell: false,
    });
    if (result.error) throw result.error;
    return result.status ?? 1;
  } finally {
    await rm(logRoot, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
}

if (process.argv[1]?.endsWith("wrangler-types.mjs")) {
  try {
    process.exitCode = await runWranglerTypes();
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : "Wrangler type generation failed.",
    );
    process.exitCode = 1;
  }
}
