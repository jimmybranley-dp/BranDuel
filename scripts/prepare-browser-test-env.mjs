import { appendFileSync } from "node:fs";
import { createEphemeralBrowserCredentials } from "./browser-test-credentials.mjs";

const githubEnv = process.env.GITHUB_ENV;
if (!githubEnv) throw new Error("This helper must run inside GitHub Actions.");

const { passcode, hashes } = createEphemeralBrowserCredentials();

appendFileSync(githubEnv, `BRANDUEL_TEST_PASSCODE=${passcode}\nPLAYER_PASSCODES=${JSON.stringify(hashes)}\n`);
