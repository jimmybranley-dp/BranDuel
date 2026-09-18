import { expect, test } from "@playwright/test";

test("commissioner can sign in and start an isolated game night", async ({ page }) => {
  const passcode = process.env.BRANDUEL_TEST_PASSCODE;
  if (!passcode) throw new Error("Browser smoke tests require an ephemeral BRANDUEL_TEST_PASSCODE.");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Take your seat." })).toBeVisible();
  await page.getByLabel("Player").selectOption("jimmy");
  await page.getByLabel("Passcode").fill(passcode);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Your Derby wallet")).toBeVisible();
  await page.getByRole("button", { name: "Match Setup", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Open the Derby." })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Open Game Night" }).click();

  await expect(page.getByRole("heading", { name: "Run the next round." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Build the matchup" })).toBeVisible();
  await expect(page.getByText("Live Night · 0 rounds settled")).toBeVisible();
});
