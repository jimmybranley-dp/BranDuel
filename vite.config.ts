import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const wranglerConfigPath = process.env.BRANDUEL_WRANGLER_CONFIG_PATH
  ? resolve(projectRoot, process.env.BRANDUEL_WRANGLER_CONFIG_PATH)
  : resolve(projectRoot, "wrangler.jsonc");
const persistState = process.env.BRANDUEL_STATE_PATH
  ? { path: resolve(projectRoot, process.env.BRANDUEL_STATE_PATH) }
  : process.env.VITEST
    ? false
    : true;

function removeLocalDevVarsFromBuild() {
  return {
    name: "branduel-remove-local-dev-vars",
    apply: "build" as const,
    closeBundle() {
      const outputRoot = resolve(projectRoot, "dist");
      if (!existsSync(outputRoot)) return;
      const visit = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = resolve(directory, entry.name);
          if (entry.isDirectory()) visit(path);
          else if (entry.name === ".dev.vars") rmSync(path);
        }
      };
      visit(outputRoot);
    },
  };
}

export default defineConfig({
  root: projectRoot,
  plugins: [
    react(),
    cloudflare({ configPath: wranglerConfigPath, persistState }),
    removeLocalDevVarsFromBuild(),
  ],
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "worker/**/*.test.ts",
      "worker/**/*.test.tsx",
      "worker/**/*.test.mjs",
    ],
    exclude: ["node_modules/**", "dist/**", ".wrangler/**", "browser-tests/**"],
  },
});
