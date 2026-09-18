import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { join } from "node:path";

const PASSCODE = process.env.BRANDUEL_TEST_PASSCODE;
if (!PASSCODE) throw new Error("Browser tests require an ephemeral BRANDUEL_TEST_PASSCODE.");

type Snapshot = {
  state: {
    gameNight?: { activeEventIds?: string[]; activeEventId?: string; status: string };
    events: Array<{ id: string; gameId: string; status: string; bettingClosesAt?: string; odds: Record<string, number> }>;
    bets: Array<{ eventId: string; status: string; stake: number }>;
  };
};

async function signIn(page: Page, playerId: string, phone: boolean) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Take your seat." })).toBeVisible();
  await page.getByLabel("Player").selectOption(playerId);
  await page.getByLabel("Passcode").fill(PASSCODE!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Shared live", { exact: true })).toBeVisible();
  const navName = phone ? "Mobile primary" : "Primary";
  await page.getByRole("navigation", { name: navName }).getByRole("button", { name: phone ? "Setup" : "Match Setup", exact: true }).click();
}

async function readState(page: Page): Promise<Snapshot> {
  const response = await page.request.get("/api/state", { cache: "no-store" });
  expect(response.status()).toBe(200);
  return (await response.json()) as Snapshot;
}

async function confirm(page: Page) {
  page.once("dialog", (dialog) => void dialog.accept());
}

test("opens concurrent markets, isolates their actions, and enforces the four-market cap", async ({ browser, page }, testInfo) => {
  testInfo.setTimeout(120_000);
  const phone = testInfo.project.name === "chromium-phone";
  const origin = new URL(process.env.BRANDUEL_BASE_URL ?? "http://127.0.0.1:5173").origin;
  let jasonContext: BrowserContext | undefined;
  try {
    await signIn(page, "jimmy", phone);
    await confirm(page);
    await page.getByRole("button", { name: "Open Game Night" }).click();
    await expect(page.getByRole("heading", { name: "Build the matchup" })).toBeVisible();

    await page.getByRole("button", { name: "Open betting" }).click();
    const nextMarket = page.locator(".next-market");
    await expect(nextMarket.locator("#next-market-title")).toBeVisible();
    const nextMarketBox = await nextMarket.boundingBox();
    expect(nextMarketBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(phone ? 844 : 900);
    await nextMarket.getByLabel("Game").focus();
    await expect.poll(async () => nextMarket.getByLabel("Game").evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");

    async function openAnother(gameId: string) {
      await nextMarket.getByLabel("Game").selectOption(gameId);
      await nextMarket.getByRole("button", { name: "Open next betting market" }).click();
    }

    await openAnother("worms");
    await openAnother("mario-kart");
    await openAnother("nfl-blitz");
    await expect(page.getByRole("heading", { name: "Active markets" })).toBeVisible();
    await expect(page.getByText("Betting window", { exact: true })).toHaveCount(4);
    await expect(page.getByRole("heading", { name: "Open another market" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open next betting market" })).toHaveCount(0);
    await expect(page.getByText("Four markets are active.", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const before = await readState(page);
    const activeIds = before.state.gameNight?.activeEventIds ?? [];
    expect(activeIds).toHaveLength(4);
    expect(new Set(activeIds).size).toBe(4);
    const secondBefore = before.state.events.find((event) => event.id === activeIds[1]);
    expect(secondBefore).toBeTruthy();

    await page.getByRole("navigation", { name: phone ? "Mobile primary" : "Primary" }).getByRole("button", { name: phone ? "Home" : "Home", exact: true }).click();
    await expect(page.locator(".event-card")).toHaveCount(4);

    jasonContext = await browser.newContext({ baseURL: origin, viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, recordVideo: { dir: testInfo.outputDir } });
    const jason = await jasonContext.newPage();
    await signIn(jason, "jason", phone);
    await jason.getByRole("navigation", { name: phone ? "Mobile primary" : "Primary" }).getByRole("button", { name: phone ? "Home" : "Home", exact: true }).click();
    const cards = jason.locator(".event-card");
    await expect(cards).toHaveCount(4);
    await cards.nth(0).getByRole("button", { name: /^Jason & Ezra/ }).click();
    await cards.nth(0).getByRole("button", { name: "Place wager" }).click();
    await expect(jason.getByText("Wager accepted for $25,000.", { exact: true })).toBeVisible();

    await expect.poll(async () => (await readState(page)).state.bets.filter((bet) => bet.status === "open")).toHaveLength(1);
    const after = await readState(page);
    const secondAfter = after.state.events.find((event) => event.id === activeIds[1]);
    expect(secondAfter).toEqual(secondBefore);
    expect(after.state.bets.filter((bet) => bet.status === "open")[0].eventId).toBe(activeIds[0]);
    await page.getByRole("navigation", { name: phone ? "Mobile primary" : "Primary" }).getByRole("button", { name: phone ? "Setup" : "Match Setup", exact: true }).click();
    const firstRound = page.locator(".active-round").filter({ hasText: "Smash" }).first();
    await firstRound.getByRole("button", { name: "Start match" }).click();
    await firstRound.locator(".live-result").getByRole("button", { name: /^Jason & Ezra$/ }).click();
    await confirm(page);
    await firstRound.getByRole("button", { name: "Review and settle" }).click();
    const afterSettle = await readState(page);
    expect(afterSettle.state.events.find((event) => event.id === activeIds[0])?.status).toBe("completed");
    expect(afterSettle.state.events.find((event) => event.id === activeIds[1])).toEqual(secondBefore);
    expect(afterSettle.state.gameNight?.activeEventIds).toHaveLength(3);
    expect(afterSettle.state.gameNight?.activeEventIds).not.toContain(activeIds[0]);
    await page.screenshot({ path: join(testInfo.outputDir, "concurrent-markets.png"), fullPage: true });
  } finally {
    await jasonContext?.close();
  }
});
