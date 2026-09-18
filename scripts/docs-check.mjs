import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REQUIRED_INDEX_LINKS = [
  "PRODUCT.md",
  "ARCHITECTURE.md",
  "RELIABILITY.md",
  "SECURITY.md",
  "TESTING.md",
  "OPERATIONS.md",
  "FRONTEND.md",
  "OBSERVABILITY.md",
  "tech-debt.md",
  "decisions/0001-authoritative-action-boundary.md",
  "decisions/0002-additive-d1-and-target-safety.md",
  "decisions/0003-open-product-decisions.md",
  "exec-plans/active/README.md",
  "exec-plans/completed/README.md",
];
const BUILTIN_NPM_COMMANDS = new Set([
  "ci",
  "install",
  "test",
  "--version",
  "version",
]);

function markdownFiles(rootDir) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", ".git", "dist", ".wrangler"].includes(entry.name))
        continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (extname(entry.name).toLowerCase() === ".md") files.push(path);
    }
  };
  visit(rootDir);
  return files;
}

function displayPath(rootDir, path) {
  return relative(rootDir, path).replaceAll("\\", "/");
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function localTarget(target) {
  const clean = target.trim().replace(/^<|>$/g, "");
  if (!clean || clean.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(clean))
    return null;
  return decodeURIComponent(clean.split("#", 1)[0].split("?", 1)[0]);
}

function addFailure(failures, file, line, message, remediation) {
  failures.push(`${file}:${line}: ${message} Remediation: ${remediation}`);
}

function checkLinks(rootDir, files, failures) {
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(linkPattern)) {
      const target = localTarget(match[1]);
      if (target === null) continue;
      const resolved = resolve(dirname(path), target);
      const exists =
        existsSync(resolved) ||
        existsSync(resolve(resolved, "README.md")) ||
        existsSync(resolve(resolved, "index.md"));
      if (!exists)
        addFailure(
          failures,
          displayPath(rootDir, path),
          lineOf(source, match.index ?? 0),
          `local Markdown link target does not exist: ${target}`,
          "fix the relative link or add the referenced repository file",
        );
    }
  }
}

function checkCommands(rootDir, files, failures) {
  const packagePath = resolve(rootDir, "package.json");
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const scripts = new Set(Object.keys(packageJson.scripts ?? {}));
  const commandPattern =
    /\bnpm(?:\.cmd)?\s+(?:run\s+([A-Za-z0-9:_-]+)|([a-z-]+))/g;
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(commandPattern)) {
      const command = match[1] ?? match[2];
      if (match[1] && !scripts.has(command))
        addFailure(
          failures,
          displayPath(rootDir, path),
          lineOf(source, match.index ?? 0),
          `documented npm command does not exist: npm run ${command}`,
          "change the documentation to an existing package script or add the script intentionally",
        );
      else if (match[2] && !BUILTIN_NPM_COMMANDS.has(command))
        addFailure(
          failures,
          displayPath(rootDir, path),
          lineOf(source, match.index ?? 0),
          `documented npm command is not a recognized built-in: npm ${command}`,
          "use npm run <script> for repository commands",
        );
    }
  }
}

function checkIndex(rootDir, files, failures) {
  const indexPath = resolve(rootDir, "docs", "index.md");
  if (!existsSync(indexPath)) {
    addFailure(
      failures,
      "docs/index.md",
      1,
      "documentation map is missing",
      "restore docs/index.md",
    );
    return;
  }
  const source = readFileSync(indexPath, "utf8");
  for (const required of REQUIRED_INDEX_LINKS) {
    const index = source.indexOf(`(${required})`);
    if (index < 0)
      addFailure(
        failures,
        "docs/index.md",
        1,
        `documentation map does not link ${required}`,
        "add the authoritative document to docs/index.md",
      );
  }
  const decisionFiles = files.filter(
    (path) =>
      displayPath(rootDir, path).startsWith("docs/decisions/") &&
      path !== indexPath,
  );
  for (const decision of decisionFiles) {
    const name = displayPath(rootDir, decision);
    if (
      !source.includes(`(${name.slice("docs/".length)})`) &&
      !source.includes(`(${name})`)
    )
      addFailure(
        failures,
        name,
        1,
        "decision record is not linked from the documentation map",
        "add the decision record to docs/index.md",
      );
  }
}

function checkHistoricalReview(rootDir, files, failures) {
  for (const path of files) {
    const source = readFileSync(path, "utf8");
    source.split(/\r?\n/).forEach((line, index) => {
      if (!/MONDAY-REVIEW\.md/i.test(line)) return;
      if (
        !/(historical|non-authoritative|not current authority|historical review)/i.test(
          line,
        )
      )
        addFailure(
          failures,
          displayPath(rootDir, path),
          index + 1,
          "MONDAY-REVIEW.md is referenced without an explicit historical/non-authoritative qualifier",
          "refer to current docs/ contracts and label the historical review as non-authoritative",
        );
    });
  }
}

function checkExecutionPlanReferences(rootDir, files, failures) {
  for (const path of files) {
    const name = displayPath(rootDir, path);
    if (
      !/^docs\/exec-plans\/(active|completed)\/[^/]+\.md$/.test(name) ||
      name.endsWith("/README.md")
    )
      continue;
    const source = readFileSync(path, "utf8");
    if (!/docs\/[^)\s]+\.md/.test(source))
      addFailure(
        failures,
        name,
        1,
        "execution plan does not link an authoritative contract",
        "link the relevant docs/ contract",
      );
    if (!/\bnpm(?:\.cmd)?\s+(?:run\s+\S+|test|ci)\b/.test(source))
      addFailure(
        failures,
        name,
        1,
        "execution plan does not record verification evidence",
        "list the exact npm verification command(s)",
      );
  }
}

export function checkDocumentation({
  rootDir = ROOT,
  files = markdownFiles(rootDir),
} = {}) {
  const failures = [];
  checkLinks(rootDir, files, failures);
  checkCommands(rootDir, files, failures);
  checkIndex(rootDir, files, failures);
  checkHistoricalReview(rootDir, files, failures);
  checkExecutionPlanReferences(rootDir, files, failures);
  return { failures };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report = checkDocumentation();
  if (report.failures.length) {
    console.error("Documentation check failed:");
    for (const failure of report.failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(
      "Documentation check passed: local links, commands, map coverage, and historical boundaries are valid.",
    );
  }
}
