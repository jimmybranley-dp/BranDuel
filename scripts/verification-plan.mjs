export const VERIFICATION_STAGE_IDS = [
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
  "event",
  "browser",
];

const BASE_STAGES = new Set(VERIFICATION_STAGE_IDS.slice(0, -2));

export function createVerificationSteps({
  full = false,
  browserArgs = [],
} = {}) {
  const steps = [
    { id: "lint", name: "Lint", args: ["run", "lint"] },
    { id: "format", name: "Formatting", args: ["run", "format:check"] },
    { id: "docs", name: "Documentation map", args: ["run", "docs:check"] },
    {
      id: "plans",
      name: "Execution-plan contract",
      args: ["run", "execution-plans:check"],
    },
    {
      id: "artifact-fixtures",
      name: "Artifact-safety fixtures",
      args: ["run", "test:artifacts"],
    },
    {
      id: "binding-fixture",
      name: "Binding freshness fixture",
      args: ["run", "test:types"],
    },
    {
      id: "bindings",
      name: "Generated Worker bindings",
      args: ["run", "types:check"],
    },
    {
      id: "architecture",
      name: "Architecture tests",
      args: ["run", "test:architecture"],
    },
    {
      id: "observability",
      name: "Observability configuration",
      args: ["run", "test:observability"],
    },
    { id: "typecheck", name: "TypeScript check", args: ["run", "check"] },
    { id: "vitest", name: "Vitest", args: ["test"] },
    {
      id: "bundle",
      name: "Production bundle",
      args: ["run", "build:bundle"],
    },
    {
      id: "artifact-safety",
      name: "Artifact and secret safety",
      args: ["run", "check:artifacts"],
    },
    { id: "event", name: "Event rehearsal", args: ["run", "test:event"] },
    {
      id: "browser",
      name: "Playwright",
      args: ["run", "test:browser", ...browserArgs],
    },
  ];
  return full ? steps : steps.filter((step) => BASE_STAGES.has(step.id));
}

function readValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${option} requires a stage id.`);
  return value;
}

export function parseVerificationArgs(argv) {
  const options = {
    full: false,
    stage: null,
    from: null,
    list: false,
    browserArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--full") options.full = true;
    else if (argument === "--list") options.list = true;
    else if (argument === "--stage")
      options.stage = readValue(argv, index++, argument);
    else if (argument.startsWith("--stage=")) options.stage = argument.slice(8);
    else if (argument === "--from")
      options.from = readValue(argv, index++, argument);
    else if (argument.startsWith("--from=")) options.from = argument.slice(7);
    else if (
      argument === "--full-matrix" ||
      argument === "--browser-keep-going"
    )
      options.browserArgs.push("--full-matrix");
    else if (argument === "--browser-suite") {
      options.browserArgs.push("--suite", readValue(argv, index++, argument));
    } else if (argument.startsWith("--browser-suite=")) {
      options.browserArgs.push("--suite", argument.slice(16));
    } else if (argument === "--browser-project") {
      options.browserArgs.push("--project", readValue(argv, index++, argument));
    } else if (argument.startsWith("--browser-project=")) {
      options.browserArgs.push("--project", argument.slice(18));
    } else {
      throw new Error(`Unknown verification option: ${argument}`);
    }
  }

  if (options.stage && options.from)
    throw new Error("Use either --stage or --from, not both.");
  if (options.stage && !VERIFICATION_STAGE_IDS.includes(options.stage))
    throw new Error(`Unknown verification stage: ${options.stage}`);
  if (options.from && !VERIFICATION_STAGE_IDS.includes(options.from))
    throw new Error(`Unknown verification stage: ${options.from}`);
  if (options.stage === "event" || options.stage === "browser")
    options.full = true;
  if (options.from === "event" || options.from === "browser")
    options.full = true;
  return options;
}

export function selectVerificationSteps({
  full = false,
  stage,
  from,
  browserArgs = [],
} = {}) {
  const allSteps = createVerificationSteps({ full: true, browserArgs });
  if (stage) return [allSteps.find((step) => step.id === stage)];
  if (from)
    return allSteps.slice(allSteps.findIndex((step) => step.id === from));
  return full ? allSteps : allSteps.slice(0, -2);
}
