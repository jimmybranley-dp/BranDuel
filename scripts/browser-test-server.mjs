import { mkdirSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const statePath = resolve(".wrangler", `browser-test-${Date.now()}`);
mkdirSync(statePath, { recursive: true });

const wrangler = resolve("node_modules", "wrangler", "bin", "wrangler.js");
const migration = spawnSync(process.execPath, [wrangler, "d1", "migrations", "apply", "branduel-db", "--local", "--persist-to", statePath], { stdio: "inherit", shell: false });
if (migration.status !== 0) process.exit(migration.status ?? 1);

const vite = resolve("node_modules", "vite", "bin", "vite.js");
const server = spawn(process.execPath, [vite, "--config", "vite.config.ts", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], {
  env: { ...process.env, BRANDUEL_STATE_PATH: statePath },
  stdio: "inherit",
  shell: false,
});
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
server.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
