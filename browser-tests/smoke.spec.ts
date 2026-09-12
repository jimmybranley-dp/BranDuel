import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("commissioner can sign in and start an isolated game night", async ({ page }) => {
  const credentials = JSON.parse(await readFile(".private-player-passcodes.json", "utf8")) as Record<string, string>;

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Take your seat." })).toBeVisible();
  await page.getByLabel("Player").selectOption("jimmy");
  await page.getByLabel("Passcode").fill(credentials.jimmy);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Jimmy, your team is live." })).toBeVisible();
  await expect(page.getByText("Game desk")).toBeVisible();
  await page.getByRole("button", { name: "Start Game Night" }).click();

  await expect(page.getByRole("heading", { name: "The desk is open." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Build the matchup" })).toBeVisible();
  await expect(page.getByText("Live Night · 0 rounds settled")).toBeVisible();
});
