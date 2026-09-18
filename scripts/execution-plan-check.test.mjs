import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { deepStrictEqual, match } from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checkExecutionPlans } from "./execution-plan-check.mjs";

test("the repository execution-plan map passes when no plan is active", () => {
  deepStrictEqual(checkExecutionPlans().failures, []);
});

test("an incomplete required plan is rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "branduel-plan-"));
  try {
    mkdirSync(join(root, "docs", "exec-plans", "active"), { recursive: true });
    writeFileSync(
      join(root, "docs", "exec-plans", "active", "incomplete.md"),
      "# Incomplete\n\n## Objective\nDo work.\n",
    );
    const report = checkExecutionPlans({ rootDir: root });
    match(report.failures.join("\n"), /missing required section/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
