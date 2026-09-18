import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { join } from "node:path";

const PASSCODE = process.env.BRANDUEL_TEST_PASSCODE;
if (!PASSCODE) throw new Error("Browser tests require an ephemeral BRANDUEL_TEST_PASSCODE.");

type Snapshot = {
  state: {
    gameNight?: { activeEventIds?: string[]; status: string };
    events: Array<{ id: string; gameId: string; status: string; purse?: number; odds: Record<string, number>; rules?: { minimumBet: number; maximumBet: number } }>;
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
  await page.getByRole("navigation", { name: phone ? "Mobile primary" : "Primary" }).getByRole("button", { name: phone ? "Setup" : "Match Setup", exact: true }).click();
}

async function readState(page: Page): Promise<Snapshot> {
  const response = await page.request.get("/api/state", { cache: "no-store" });
  expect(response.status()).toBe(200);
  return (await response.json()) as Snapshot;
}

async function action(page: Page, playerId: string, command: Record<string, unknown>) {
  return page.request.post("/api/actions", {
    headers: { origin: new URL(page.url()).origin },
    data: { requestId: crypto.randomUUID(), expectedPlayerId: playerId, action: command },
  });
}

test("recovers an expired market only for Jimmy and preserves the frozen market contract", async ({ browser, page }, testInfo) => {
  testInfo.setTimeout(90_000);
  const phone = testInfo.project.name === "chromium-phone";
  const origin = new URL(process.env.BRANDUEL_BASE_URL ?? "http://127.0.0.1:5173").origin;
  let jasonContext: BrowserContext | undefined;
  try {
    await signIn(page, "jimmy", phone);
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Open Game Night" }).click();
    const created = await action(page, "jimmy", { type: "CREATE_LIVE_EVENT", payload: { gameId: "smash", format: "teams", eventType: "HEAD_TO_HEAD", teamIds: ["jason-ezra", "corey-jimmy"], bracketSize: 2, bettingSeconds: 10 } });
    expect(created.status()).toBe(200);
    const before = await readState(page);
    const event = before.state.events[0];
    const frozen = { purse: event.purse, odds: event.odds, rules: event.rules };

    jasonContext = await browser.newContext({ baseURL: origin, viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, recordVideo: { dir: testInfo.outputDir } });
    const jason = await jasonContext.newPage();
    await signIn(jason, "jason", phone);
    await page.waitForTimeout(10_500);
    const lateBet = await action(jason, "jason", { type: "PLACE_BET", eventId: event.id, selectionId: "jason-ezra", stake: 25_000 });
    expect(lateBet.status()).toBe(409);
    expect((await lateBet.json()).code).toBe("BETTING_CLOSED");

    await page.getByRole("navigation", { name: phone ? "Mobile primary" : "Primary" }).getByRole("button", { name: phone ? "Team Bank" : "Team Bank", exact: true }).click();
    await expect(page.getByText("Smash / expired", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reopen betting" })).toBeVisible();
    await expect(page.getByText("Commissioner recovery")).toBeVisible();
    await page.screenshot({ path: join(testInfo.outputDir, "expired-market-recovery.png"), fullPage: true });
    await page.getByLabel("Reopen window for Smash").selectOption("90");
    await page.getByRole("button", { name: "Reopen betting" }).click();
    await expect(page.getByText(/Betting reopened for 90 seconds/)).toBeVisible();

    const reopened = await readState(page);
    expect(reopened.state.gameNight?.activeEventIds).toEqual([event.id]);
    expect(new Set(reopened.state.gameNight?.activeEventIds ?? []).size).toBe(1);
    const reopenedEvent = reopened.state.events.find((item) => item.id === event.id)!;
    expect({ purse: reopenedEvent.purse, odds: reopenedEvent.odds, rules: reopenedEvent.rules }).toEqual(frozen);

    await jason.getByRole("navigation", { name: phone ? "Mobile primary" : "Primary" }).getByRole("button", { name: phone ? "Home" : "Home", exact: true }).click();
    await jason.locator(".event-card").getByRole("button", { name: /^Jason & Ezra/ }).click();
    await jason.getByRole("button", { name: "Place wager" }).click();
    await expect(jason.getByText("Wager accepted for $25,000.", { exact: true })).toBeVisible();
    await expect.poll(async () => (await readState(page)).state.bets.filter((bet) => bet.status === "open")).toHaveLength(1);
    await expect(jason.getByText("Commissioner recovery")).toHaveCount(0);

    await jason.getByRole("navigation", { name: phone ? "Mobile primary" : "Primary" }).getByRole("button", { name: phone ? "Setup" : "Match Setup", exact: true }).click();
    await jason.getByRole("button", { name: "Start match" }).click();
    await expect(jason.getByText("Match in play", { exact: true })).toBeVisible();
    const afterStart = await action(page, "jimmy", { type: "REOPEN_EVENT", eventId: event.id, bettingSeconds: 90 });
    expect(afterStart.status()).toBe(409);
    expect((await afterStart.json()).code).toBe("INVALID_STATE");
  } finally {
    await jasonContext?.close();
  }
});
