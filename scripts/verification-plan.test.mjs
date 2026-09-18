import { deepStrictEqual, equal, match, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  createVerificationSteps,
  parseVerificationArgs,
  selectVerificationSteps,
} from "./verification-plan.mjs";

test("the default verification plan excludes expensive full-only stages", () => {
  deepStrictEqual(
    createVerificationSteps().map((step) => step.id),
    [
      "lint",
      "format",
      "docs",
      "plans",
      "artifact-fixtures",
      "binding-fixture",
      "bindings",
      "architecture",
      "observability",
      "typecheck",
      "vitest",
      "bundle",
      "artifact-safety",
    ],
  );
});

test("a failed late stage can be rerun alone or resumed without earlier stages", () => {
  equal(selectVerificationSteps({ stage: "browser" })[0].id, "browser");
  deepStrictEqual(
    selectVerificationSteps({ from: "event" }).map((step) => step.id),
    ["event", "browser"],
  );
});

test("browser matrix options are passed only to the browser stage", () => {
  const options = parseVerificationArgs([
    "--full",
    "--browser-suite",
    "critical",
    "--browser-project=chromium-phone",
    "--full-matrix",
  ]);
  deepStrictEqual(options.browserArgs, [
    "--suite",
    "critical",
    "--project",
    "chromium-phone",
    "--full-matrix",
  ]);
  match(
    selectVerificationSteps(options).at(-1).args.join(" "),
    /test:browser --suite critical --project chromium-phone --full-matrix/,
  );
});

test("ambiguous or unknown stage selections fail before starting a child process", () => {
  throws(
    () => parseVerificationArgs(["--stage", "vitest", "--from", "event"]),
    /either --stage or --from/,
  );
  throws(
    () => parseVerificationArgs(["--stage", "nope"]),
    /Unknown verification stage/,
  );
});
