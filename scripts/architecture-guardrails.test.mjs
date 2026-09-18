import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { deepStrictEqual, match } from "node:assert/strict";
import { checkArchitecture } from "./check-architecture.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

test("repository architecture satisfies the permitted dependency directions", () => {
  const report = checkArchitecture({ rootDir });
  deepStrictEqual(report.failures, []);
});

test("controlled invalid UI fixture is rejected for bypassing store.dispatch", () => {
  const fixture = "scripts/fixtures/invalid-ui-bypass.tsx";
  const report = checkArchitecture({
    rootDir,
    files: [fixture],
    roles: { [fixture]: "React UI" },
  });
  match(report.failures.join("\n"), /direct network access/);
  match(report.failures.join("\n"), /store\.dispatch/);
  readFileSync(`${rootDir}/${fixture}`, "utf8");
});

test("automatically discovers a new frontend module and rejects a direct API bypass", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "branduel-architecture-"));
  try {
    mkdirSync(join(temporaryRoot, "src", "frontend"), { recursive: true });
    writeFileSync(
      join(temporaryRoot, "src", "frontend", "new-market.tsx"),
      "export async function bypass() { return fetch('/api/state'); }\n",
    );
    const report = checkArchitecture({ rootDir: temporaryRoot });
    match(
      report.failures.join("\n"),
      /new-market\.tsx: UI contains direct network access/,
    );
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("fails clearly when a governed module has no architectural role", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "branduel-architecture-"));
  try {
    mkdirSync(join(temporaryRoot, "src"), { recursive: true });
    writeFileSync(
      join(temporaryRoot, "src", "new-layer.ts"),
      "export const value = 1;\n",
    );
    const report = checkArchitecture({ rootDir: temporaryRoot });
    match(report.failures.join("\n"), /no architectural role is defined/);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
