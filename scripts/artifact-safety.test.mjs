import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { deepStrictEqual, match } from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { scanArtifactPaths } from "./check-artifact-safety.mjs";

test("the repository artifact scan helper has no false positives for an empty input", () => {
  deepStrictEqual(scanArtifactPaths({ paths: [] }), []);
});

test("protected credential filenames are rejected without reading contents", () => {
  const root = mkdtempSync(join(tmpdir(), "branduel-artifacts-"));
  try {
    const path = join(root, ".dev.vars");
    writeFileSync(
      path,
      "pbkdf2$100000$" + "a".repeat(32) + "$" + "b".repeat(64),
    );
    const failures = scanArtifactPaths({ rootDir: root, paths: [path] });
    match(failures.join("\n"), /credential filename/);
    deepStrictEqual(
      failures.filter((failure) => failure.includes("PBKDF2")),
      [],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recognized synthetic secret material in an uploadable bundle is rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "branduel-artifacts-"));
  try {
    const directory = join(root, "dist");
    mkdirSync(directory, { recursive: true });
    const path = join(directory, "bundle.js");
    writeFileSync(
      path,
      "const synthetic = 'pbkdf2$100000$" +
        "a".repeat(32) +
        "$" +
        "b".repeat(64) +
        "';",
    );
    const failures = scanArtifactPaths({ rootDir: root, paths: [path] });
    match(failures.join("\n"), /PBKDF2 credential hash/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
