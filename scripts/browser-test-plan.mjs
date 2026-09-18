export const BROWSER_SUITES = ["smoke", "critical", "concurrent", "recovery"];
export const BROWSER_PROJECTS = ["chromium", "chromium-phone"];

const RUNS = [
  {
    suite: "smoke",
    project: "chromium",
    name: "desktop-smoke",
    file: "browser-tests/smoke.spec.ts",
  },
  {
    suite: "critical",
    project: "chromium",
    name: "desktop-critical",
    file: "browser-tests/critical-journeys.spec.ts",
  },
  {
    suite: "critical",
    project: "chromium-phone",
    name: "phone-critical",
    file: "browser-tests/critical-journeys.spec.ts",
  },
  {
    suite: "concurrent",
    project: "chromium",
    name: "desktop-concurrent",
    file: "browser-tests/concurrent-markets.spec.ts",
  },
  {
    suite: "concurrent",
    project: "chromium-phone",
    name: "phone-concurrent",
    file: "browser-tests/concurrent-markets.spec.ts",
  },
  {
    suite: "recovery",
    project: "chromium",
    name: "desktop-recovery",
    file: "browser-tests/recovery.spec.ts",
  },
  {
    suite: "recovery",
    project: "chromium-phone",
    name: "phone-recovery",
    file: "browser-tests/recovery.spec.ts",
  },
];

function readValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${option} requires a value.`);
  return value;
}

export function parseBrowserArgs(argv) {
  const options = { keepGoing: false, suite: null, project: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--keep-going" || argument === "--full-matrix")
      options.keepGoing = true;
    else if (argument === "--suite")
      options.suite = readValue(argv, index++, argument);
    else if (argument.startsWith("--suite=")) options.suite = argument.slice(8);
    else if (argument === "--project")
      options.project = readValue(argv, index++, argument);
    else if (argument.startsWith("--project="))
      options.project = argument.slice(10);
    else if (argument === "--help") options.help = true;
    else throw new Error(`Unknown browser option: ${argument}`);
  }
  if (options.suite && !BROWSER_SUITES.includes(options.suite))
    throw new Error(`Unknown browser suite: ${options.suite}`);
  if (options.project && !BROWSER_PROJECTS.includes(options.project))
    throw new Error(`Unknown browser project: ${options.project}`);
  return options;
}

export function selectBrowserRuns({ suite = null, project = null } = {}) {
  return RUNS.filter(
    (run) =>
      (!suite || run.suite === suite) && (!project || run.project === project),
  );
}

export function allBrowserRuns() {
  return RUNS.map((run) => ({ ...run }));
}
