import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";
import process from "node:process";

export default defineConfig({
  plugins: [react(), cloudflare({ persistState: process.env.BRANDUEL_STATE_PATH ? { path: process.env.BRANDUEL_STATE_PATH } : true })],
  test: {
    environment: "node",
  },
});
