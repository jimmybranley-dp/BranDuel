import { defineConfig, devices } from "@playwright/test";
import { assertDestructiveTestTarget } from "./src/operation-safety";

const baseURL = process.env.BRANDUEL_BASE_URL ?? "http://127.0.0.1:5173";
assertDestructiveTestTarget(baseURL, "browser test");

export default defineConfig({
  testDir: "./browser-tests",
  fullyParallel: false,
  workers: 1,
  maxFailures: process.env.BRANDUEL_BROWSER_KEEP_GOING === "1" ? undefined : 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: `playwright-report/${process.env.BRANDUEL_BROWSER_RUN ?? "direct"}`,
        open: "never",
      },
    ],
  ],
  outputDir: `test-results/${process.env.BRANDUEL_BROWSER_RUN ?? "direct"}`,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: process.env.BRANDUEL_BASE_URL
    ? undefined
    : {
        command: "node scripts/browser-test-server.mjs",
        url: "http://127.0.0.1:5173",
        reuseExistingServer: false,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "chromium-phone",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
