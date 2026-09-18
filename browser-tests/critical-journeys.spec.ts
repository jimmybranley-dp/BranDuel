import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { join } from "node:path";

const PASSCODE = process.env.BRANDUEL_TEST_PASSCODE;
if (!PASSCODE)
  throw new Error("Browser tests require an ephemeral BRANDUEL_TEST_PASSCODE.");

type Snapshot = {
  state: {
    gameNight?: {
      activeEventId?: string;
      activeEventIds?: string[];
      status: string;
    };
    events: Array<{ id: string; status: string; format: string }>;
    bets: Array<{
      eventId: string;
      teamId: string;
      stake: number;
      status: string;
    }>;
  };
};

function nav(page: Page, phone: boolean, label: string) {
  const navigation = page.getByRole("navigation", {
    name: phone ? "Mobile primary" : "Primary",
  });
  return navigation.getByRole("button", {
    name: phone && label === "Match Setup" ? "Setup" : label,
    exact: true,
  });
}

async function goToView(page: Page, phone: boolean, label: string) {
  await page.goto("/");
  await expect(nav(page, phone, label)).toBeVisible();
  await nav(page, phone, label).click();
}

async function signIn(page: Page, playerId: string, phone: boolean) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Take your seat." }),
  ).toBeVisible();
  await expect(page.getByLabel("Player")).toBeVisible();
  await page.getByLabel("Player").selectOption(playerId);
  await page.getByLabel("Passcode").fill(PASSCODE!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Shared live", { exact: true })).toBeVisible();
  await expect(nav(page, phone, "Match Setup")).toBeVisible();
}

async function readState(page: Page): Promise<Snapshot> {
  const response = await page.request.get("/api/state", { cache: "no-store" });
  expect(response.status()).toBe(200);
  return (await response.json()) as Snapshot;
}

async function acceptNextDialog(page: Page) {
  page.once("dialog", (dialog) => void dialog.accept());
}

async function acceptNextPrompt(page: Page, value: string) {
  page.once("dialog", async (dialog) => {
    expect(dialog.type()).toBe("prompt");
    await dialog.accept(value);
  });
}

async function settleWithConfirmation(page: Page) {
  await acceptNextDialog(page);
  await page.getByRole("button", { name: "Review and settle" }).click();
}

async function settleFfaWithConfirmation(page: Page) {
  await page.getByLabel("I checked every finishing position.").check();
  await expect(
    page.getByRole("button", { name: "Review and settle" }),
  ).toBeEnabled();
  await settleWithConfirmation(page);
}

test.describe.configure({ mode: "serial" });

test("critical game-night journeys converge across roles and devices", async ({
  browser,
  page,
}, testInfo) => {
  testInfo.setTimeout(180_000);
  const phone = testInfo.project.name === "chromium-phone";
  const origin = new URL(
    process.env.BRANDUEL_BASE_URL ?? "http://127.0.0.1:5173",
  ).origin;
  const extraContexts: Array<{
    name: string;
    context: BrowserContext;
    page: Page;
  }> = [];

  async function createExtra(name: string) {
    const context = await browser.newContext({
      baseURL: origin,
      viewport: phone
        ? { width: 390, height: 844 }
        : { width: 1440, height: 900 },
      isMobile: phone,
      hasTouch: phone,
      recordVideo: { dir: testInfo.outputDir },
    });
    const extraPage = await context.newPage();
    const item = { name, context, page: extraPage };
    extraContexts.push(item);
    return extraPage;
  }

  try {
    const jimmy = page;
    const jason = await createExtra("jason");
    const ezra = await createExtra("ezra");

    await jimmy.goto("/");
    await jimmy.screenshot({ path: join(testInfo.outputDir, "login.png"), fullPage: true });

    // Login, role permissions, phone layout, and commissioner-only opening.
    await signIn(jimmy, "jimmy", phone);
    await signIn(jason, "jason", phone);
    await signIn(ezra, "ezra", phone);
    await goToView(jason, phone, "Match Setup");
    await expect(
      jason.getByRole("heading", { name: "Open the Derby." }),
    ).toBeVisible();
    await expect(
      jason.getByText("Jimmy must open Game Night before rounds can begin."),
    ).toBeVisible();
    await expect(
      jason.getByRole("button", { name: "Open Game Night" }),
    ).toHaveCount(0);
    await expect(
      jason.getByRole("navigation", {
        name: phone ? "Mobile primary" : "Primary",
      }),
    ).toBeVisible();
    await expect(
      jimmy.getByRole("navigation", {
        name: phone ? "Mobile primary" : "Primary",
      }),
    ).toBeVisible();
    await goToView(jimmy, phone, "Match Setup");
    await acceptNextDialog(jimmy);
    await jimmy.getByRole("button", { name: "Open Game Night" }).click();
    await expect(
      jimmy.getByRole("heading", { name: "Run the next round." }),
    ).toBeVisible();
    await expect(
      jimmy.getByRole("heading", { name: "Build the matchup" }),
    ).toBeVisible();
    await goToView(jason, phone, "Match Setup");
    await expect(
      jason.getByRole("heading", { name: "Run the next round." }),
    ).toBeVisible();
    await goToView(jason, phone, "Team Bank");
    await expect(
      jason.getByRole("heading", { name: "Jason & Ezra" }),
    ).toBeVisible();
    await expect(jason.getByText("Commissioner controls")).toHaveCount(0);

    // An ordinary player opens a team market, places and edits the team ticket.
    await goToView(jason, phone, "Match Setup");
    await jason.getByRole("button", { name: "Open betting" }).click();
    await expect(
      jason.getByText("Betting window", { exact: true }),
    ).toBeVisible();
    await expect(jason.getByLabel("Match host Jason. Starts the match and submits the result.")).toBeVisible();
    await goToView(jason, phone, "Home");
    const ownTeamPick = jason.getByRole("button", { name: /^Jason & Ezra/ });
    const opposingTeamPick = jason.getByRole("button", {
      name: /^Corey & Jimmy/,
    });
    await expect(ownTeamPick).toBeEnabled();
    await expect(opposingTeamPick).toBeDisabled();
    await ownTeamPick.click();
    await jason.getByLabel("Wager").selectOption("50000");
    await jason.getByRole("button", { name: "Place wager" }).click();
    await expect(
      jason.getByText("Wager accepted for $50,000.", { exact: true }),
    ).toBeVisible();
    await ownTeamPick.click();
    await jason.getByLabel("Wager").selectOption("100000");
    await jason.getByRole("button", { name: "Update ticket" }).click();
    await expect(
      jason.getByText("Team ticket updated for $100,000.", { exact: true }),
    ).toBeVisible();
    await expect(jason.getByText(/has \$100,000 on this market/)).toBeVisible();

    // The server-confirmed state is visible in another browser context.
    await jimmy.reload();
    await goToView(jimmy, phone, "Match Setup");
    await expect(
      jimmy.getByText("Betting window", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await readState(jimmy)).state.bets.filter(
            (bet) => bet.status === "open",
          ).length,
      )
      .toBe(1);

    // Disconnecting retains the last confirmed snapshot and makes the visible start control read-only.
    await goToView(jason, phone, "Match Setup");
    await expect(
      jason.getByRole("button", { name: "Start match" }),
    ).toBeEnabled();
    await jason.context().setOffline(true);
    await expect(
      jason.getByText("Read-only / offline", { exact: true }),
    ).toBeVisible();
    await expect(
      jason.getByRole("button", { name: "Start match" }),
    ).toBeDisabled();
    await jason.screenshot({ path: join(testInfo.outputDir, "offline-read-only.png"), fullPage: true });
    await jason.context().setOffline(false);
    await jason
      .getByRole("button", { name: "Refresh confirmed state" })
      .click();
    await expect(jason.getByText("Shared live", { exact: true })).toBeVisible();

    // Simulate a lost response after the Worker commits. The saved request must lock writes and sign-out.
    await jason.context().route("**/api/actions", async (route) => {
      await route.fetch();
      await route.abort("connectionreset");
    });
    await jason.getByRole("button", { name: "Start match" }).click();
    await expect(
      jason.getByText("This request needs confirmation"),
    ).toBeVisible();
    await expect(
      jason.getByRole("button", { name: "Resolve saved request" }),
    ).toBeEnabled();
    await expect(
      jason.getByRole("button", { name: "Sign out" }),
    ).toBeDisabled();
    await jason.screenshot({ path: join(testInfo.outputDir, "pending-recovery.png"), fullPage: true });
    await jason.context().unroute("**/api/actions");
    await jason.getByRole("button", { name: "Resolve saved request" }).click();
    await expect(jason.getByText("Shared live", { exact: true })).toBeVisible();
    await expect(
      jason.getByText("Match in play", { exact: true }),
    ).toBeVisible();

    // Ordinary player starts play, reviews the preview, and settles the team result.
    await jason.locator(".live-result").getByRole("button", { name: /^Jason & Ezra$/ }).click();
    await expect(
      jason.getByRole("heading", { name: "Settlement preview" }),
    ).toBeVisible();
    await settleWithConfirmation(jason);
    await expect(
      jason.getByText("Round settled", { exact: true }),
    ).toBeVisible();
    await expect(
      jason.getByText("Jason & Ezra wins", { exact: true }),
    ).toBeVisible();
    await jason.screenshot({ path: join(testInfo.outputDir, "settlement-recap.png"), fullPage: true });

    // Jimmy can correct the settled result and then void/refund the corrected round.
    await goToView(jimmy, phone, "Team Bank");
    await expect(jimmy.getByText("Commissioner controls")).toBeVisible();
    const correctionSelect = jimmy.getByLabel("Correct a settled round");
    await correctionSelect.selectOption({ index: 1 });
    await jimmy.getByRole("button", { name: /^Corey & Jimmy$/ }).click();
    await jimmy
      .getByPlaceholder("Explain the mistaken result")
      .fill("Official result correction in browser rehearsal");
    await expect(
      jimmy.getByRole("heading", { name: "Settlement preview" }),
    ).toBeVisible();
    await acceptNextDialog(jimmy);
    await jimmy.getByRole("button", { name: "Review correction" }).click();
    await expect(
      jimmy.getByText("Result corrected. Banks, wagers and records updated.", {
        exact: true,
      }),
    ).toBeVisible();
    await jimmy
      .getByLabel("Correct a settled round")
      .selectOption({ index: 1 });
    await acceptNextPrompt(
      jimmy,
      "Void the corrected round for the browser rehearsal",
    );
    await jimmy
      .getByRole("button", { name: "Void completed round / refund" })
      .click();
    await expect(
      jimmy.getByText(
        "Completed round voided. Payouts reversed and tickets refunded.",
        { exact: true },
      ),
    ).toBeVisible();

    // FFA self-bet and teammate restrictions, plus closeout refusal while work is unresolved.
    await goToView(jason, phone, "Match Setup");
    if (
      await jason
        .getByRole("button", { name: "New matchup" })
        .isVisible()
        .catch(() => false)
    )
      await jason.getByRole("button", { name: "New matchup" }).click();
    await expect(
      jason.getByRole("heading", { name: "Build the matchup" }),
    ).toBeVisible();
    await jason.getByRole("button", { name: "Free for all" }).click();
    await jason.getByLabel("Game").selectOption("boomerang");
    await jason.getByRole("button", { name: "Open betting" }).click();
    await expect(
      jason.getByText("Betting window", { exact: true }),
    ).toBeVisible();
    await goToView(jason, phone, "Home");
    const selfPick = jason.getByRole("button", { name: /^Jason\b/ });
    const otherPlayerPick = jason.getByRole("button", { name: /^Corey\b/ });
    await expect(selfPick).toBeEnabled();
    await expect(otherPlayerPick).toBeDisabled();
    await selfPick.click();
    await jason.getByLabel("Wager").selectOption("50000");
    await jason.getByRole("button", { name: "Place wager" }).click();
    await expect(
      jason.getByText("Wager accepted for $50,000.", { exact: true }),
    ).toBeVisible();
    await goToView(ezra, phone, "Home");
    await expect(
      ezra.getByText(
        "Jason is playing, so your team cannot bet on this match.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(ezra.getByRole("button", { name: /^Jason\b/ })).toBeDisabled();
    await expect(ezra.getByRole("button", { name: /^Corey\b/ })).toBeDisabled();

    await goToView(jimmy, phone, "Match Setup");
    await expect(
      jimmy.getByRole("button", { name: "Review closeout" }),
    ).toHaveCount(0);
    const unresolved = await readState(jimmy);
    const activeEventId =
      unresolved.state.gameNight?.activeEventIds?.[0] ??
      unresolved.state.gameNight?.activeEventId;
    expect(activeEventId).toBeTruthy();
    const closeoutResponse = await jimmy.request.post("/api/actions", {
      headers: { origin, "content-type": "application/json" },
      data: {
        requestId: crypto.randomUUID(),
        expectedPlayerId: "jimmy",
        action: { type: "END_GAME_NIGHT" },
      },
    });
    expect(closeoutResponse.status()).toBe(409);
    expect((await closeoutResponse.json()).code).toBe("INVALID_STATE");

    await goToView(jason, phone, "Match Setup");
    await jason.getByRole("button", { name: "Start match" }).click();
    await expect(
      jason.getByText("Match in play", { exact: true }),
    ).toBeVisible();
    await settleFfaWithConfirmation(jason);
    await expect(jason.getByText("Jason wins", { exact: true })).toBeVisible();

    // Both contexts converge on the same confirmed recap before Jimmy closes the night and exports it.
    await jimmy.reload();
    await goToView(jimmy, phone, "Match Setup");
    await expect(
      jimmy.getByText("Round settled", { exact: true }),
    ).toBeVisible();
    await expect(jimmy.getByText("Jason wins", { exact: true })).toBeVisible();
    await goToView(jason, phone, "Match Setup");
    await expect(
      jason.getByText("Round settled", { exact: true }),
    ).toBeVisible();
    await acceptNextDialog(jimmy);
    await jimmy.getByRole("button", { name: "Review closeout" }).click();
    await expect(
      jimmy.getByRole("heading", { name: "Game Night complete." }),
    ).toBeVisible();
    const download = jimmy.waitForEvent("download");
    await jimmy.getByRole("button", { name: "Export final archive" }).click();
    await expect((await download).suggestedFilename()).toMatch(
      /^branduel-final-.*\.json$/,
    );
  } finally {
    const failed = testInfo.status !== testInfo.expectedStatus;
    for (const { name, context, page: extraPage } of extraContexts) {
      if (failed) {
        try {
          await extraPage.screenshot({
            path: join(testInfo.outputDir, `${name}-failure.png`),
            fullPage: true,
          });
        } catch {
          /* Best-effort failure artifact. */
        }
      }
      try {
        await context.close();
      } catch {
        /* Do not mask the failed assertion with cleanup noise. */
      }
    }
  }
});
