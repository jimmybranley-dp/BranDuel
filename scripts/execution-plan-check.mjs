import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const REQUIRED_SECTIONS = [
  "Objective",
  "Scope",
  "Contracts consulted",
  "Affected user journeys",
  "Safety boundaries",
  "Implementation milestones",
  "Acceptance criteria",
  "Verification commands",
  "Database and hosted-environment impact",
  "Unresolved owner decisions",
  "Completion evidence",
];

function plans(rootDir, directory) {
  const path = resolve(rootDir, "docs", "exec-plans", directory);
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        entry.name !== "README.md",
    )
    .map((entry) => resolve(path, entry.name));
}

function display(rootDir, path) {
  return path.slice(rootDir.length + 1).replaceAll("\\", "/");
}

export function checkExecutionPlans({ rootDir = ROOT } = {}) {
  const failures = [];
  for (const directory of ["active", "completed"]) {
    for (const path of plans(rootDir, directory)) {
      const name = display(rootDir, path);
      const source = readFileSync(path, "utf8");
      for (const section of REQUIRED_SECTIONS) {
        const heading = new RegExp(
          `^##\\s+${section.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*$`,
          "m",
        );
        if (!heading.test(source))
          failures.push(
            `${name}: missing required section "${section}". Remediation: use docs/exec-plans/PLAN-TEMPLATE.md.`,
          );
      }
      if (!/docs\/[^)\s]+\.md/.test(source))
        failures.push(
          `${name}: no authoritative contract link found. Remediation: link the relevant docs/ contract.`,
        );
      if (!/\bnpm(?:\.cmd)?\s+(?:run\s+\S+|test|ci)\b/.test(source))
        failures.push(
          `${name}: no exact verification command found. Remediation: record the commands that prove completion.`,
        );
      if (directory === "completed" && !/^Status:\s*Completed\b/im.test(source))
        failures.push(
          `${name}: completed plan must declare Status: Completed. Remediation: preserve final status and evidence.`,
        );
    }
  }
  return { failures };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report = checkExecutionPlans();
  if (report.failures.length) {
    console.error("Execution-plan check failed:");
    for (const failure of report.failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(
      "Execution-plan check passed: all active and completed plans satisfy the lightweight contract.",
    );
  }
}
