import { pbkdf2Sync, randomBytes } from "node:crypto";

export const browserTestPlayers = ["jason", "ezra", "corey", "jimmy", "brandon", "andrew", "bruce", "ryan"];

export function createEphemeralBrowserCredentials() {
  const passcode = randomBytes(32).toString("base64url");
  const hashes = Object.fromEntries(browserTestPlayers.map((player) => {
    const salt = randomBytes(16).toString("hex");
    const hash = pbkdf2Sync(passcode, Buffer.from(salt, "hex"), 100_000, 32, "sha256").toString("hex");
    return [player, `pbkdf2$100000$${salt}$${hash}`];
  }));
  return { passcode, hashes };
}
