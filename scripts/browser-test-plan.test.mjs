import { deepStrictEqual, equal, throws } from "node:assert/strict";
import { test } from "node:test";
import {
  allBrowserRuns,
  parseBrowserArgs,
  selectBrowserRuns,
} from "./browser-test-plan.mjs";

test("the default browser matrix has an isolated run for every suite and viewport", () => {
  equal(allBrowserRuns().length, 7);
  equal(
    selectBrowserRuns({ suite: "critical", project: "chromium" })[0].name,
    "desktop-critical",
  );
});

test("suite and project selectors narrow the run without changing its identity", () => {
  const options = parseBrowserArgs([
    "--suite=concurrent",
    "--project",
    "chromium-phone",
  ]);
  deepStrictEqual(
    selectBrowserRuns(options).map((run) => run.name),
    ["phone-concurrent"],
  );
});

test("browser execution defaults to fail-fast and supports an explicit full matrix", () => {
  equal(parseBrowserArgs([]).keepGoing, false);
  equal(parseBrowserArgs(["--full-matrix"]).keepGoing, true);
  throws(
    () => parseBrowserArgs(["--project", "firefox"]),
    /Unknown browser project/,
  );
});
