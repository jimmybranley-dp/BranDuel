import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const GENERATED_ARTIFACT_ROOTS = [
  "dist",
  "build",
  "coverage",
  "diagnostics",
  "playwright-report",
  "test-results",
];
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".mjs",
  ".ts",
  ".txt",
  ".xml",
  ".map",
]);
const CREDENTIAL_FILENAME =
  /(^|[\\/])(?:\.dev\.vars(?:\..*)?|\.env(?:\..*)?|\.private-player-[^\\/]+|[^\\/]*(?:credentials|secrets)\.(?:json|txt|env))$/i;
const SECRET_PATTERNS = [
  {
    name: "private key material",
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
  },
  {
    name: "PBKDF2 credential hash",
    pattern: /pbkdf2\$\d+\$[0-9a-f]{32,}\$[0-9a-f]{64,}/i,
  },
  {
    name: "literal PLAYER_PASSCODES value",
    pattern:
      /PLAYER_PASSCODES\s*[:=]\s*["'`](?!\$\{|\s*["'`])[^"'`\r\n]{24,}["'`]/,
  },
];

function trackedPaths(rootDir) {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: rootDir,
    encoding: "utf8",
  });
  return output
    .split("\0")
    .filter(Boolean)
    .map((path) => resolve(rootDir, path));
}

function artifactPaths(directory) {
  if (!existsSync(directory)) return [];
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...artifactPaths(path));
    else found.push(path);
  }
  return found;
}

function displayPath(rootDir, path) {
  return relative(rootDir, path).replaceAll("\\", "/");
}

export function inspectArtifactFile(path, display, failures) {
  // Check the name first. Protected credential sources are never opened.
  if (CREDENTIAL_FILENAME.test(display)) {
    failures.push(`${display}: credential filename`);
    return;
  }
  if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) return;
  let content;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const { name, pattern } of SECRET_PATTERNS) {
    if (pattern.test(content)) failures.push(`${display}: ${name}`);
  }
}

export function scanArtifactPaths({ rootDir = ROOT, paths }) {
  const failures = [];
  for (const path of paths) {
    if (existsSync(path))
      inspectArtifactFile(path, displayPath(rootDir, path), failures);
  }
  return failures;
}

export function scanRepositoryArtifacts(rootDir = ROOT) {
  const paths = trackedPaths(rootDir);
  for (const directory of GENERATED_ARTIFACT_ROOTS)
    paths.push(...artifactPaths(resolve(rootDir, directory)));
  return scanArtifactPaths({ rootDir, paths });
}

const failures = scanRepositoryArtifacts();

if (failures.length) {
  console.error("Artifact and secret-safety check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    "Artifact and secret-safety check passed: no credential filenames or recognized secret material found.",
  );
}
