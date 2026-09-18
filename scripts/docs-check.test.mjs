import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { deepStrictEqual, match } from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkDocumentation } from "./docs-check.mjs";

test("current documentation passes the mechanical checks", () => {
  deepStrictEqual(checkDocumentation().failures, []);
});

test("broken local links and nonexistent npm scripts are reported with remediation", () => {
  const root = mkdtempSync(join(tmpdir(), "branduel-docs-"));
  try {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ scripts: { ok: "true" } }),
    );
    const file = join(root, "docs", "index.md");
    writeFileSync(file, "[missing](nope.md)\n`npm run missing`\n");
    const report = checkDocumentation({ rootDir: root, files: [file] });
    match(
      report.failures.join("\n"),
      /local Markdown link target does not exist/,
    );
    match(report.failures.join("\n"), /documented npm command does not exist/);
    match(report.failures.join("\n"), /Remediation:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
