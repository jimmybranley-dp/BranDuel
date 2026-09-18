import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const IMPORT_PATTERN =
  /\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']/;
const BROWSER_IMPORTS = /^(?:react(?:-dom)?(?:\/.*)?|@phosphor-icons\/react)$/;
const BROWSER_GLOBALS =
  /\b(?:window\s*\.|document\s*\.|navigator\s*\.|localStorage\s*\.|sessionStorage\s*\.|indexedDB\s*\.)/;
const LAYERS = {
  "src/types.ts": { name: "data/types", kind: "data", allowed: [] },
  "src/data.ts": { name: "data/types", allowed: ["src/types.ts"] },
  "src/engine.ts": {
    name: "pure domain rules",
    allowed: ["src/data.ts", "src/types.ts"],
  },
  "src/settlement.ts": {
    name: "settlement",
    allowed: ["src/data.ts", "src/types.ts"],
  },
  "src/domain.ts": {
    name: "pure domain rules",
    allowed: [
      "src/data.ts",
      "src/engine.ts",
      "src/settlement.ts",
      "src/types.ts",
    ],
  },
  "src/transport.ts": {
    name: "client transport",
    allowed: ["src/domain.ts", "src/types.ts"],
  },
  "src/store.tsx": {
    name: "client store",
    allowed: [
      "src/data.ts",
      "src/domain.ts",
      "src/transport.ts",
      "src/types.ts",
    ],
  },
  "src/App.tsx": {
    name: "React UI",
    allowed: [
      "src/data.ts",
      "src/domain.ts",
      "src/engine.ts",
      "src/settlement.ts",
      "src/store.tsx",
      "src/types.ts",
      "src/frontend/auth.tsx",
      "src/frontend/bank.tsx",
      "src/frontend/commissioner.tsx",
      "src/frontend/live-betting.tsx",
      "src/frontend/match-setup.tsx",
      "src/frontend/ratings.tsx",
      "src/frontend/results.tsx",
      "src/frontend/shared.tsx",
      "src/frontend/shell.tsx",
    ],
  },
  "src/main.tsx": {
    name: "React UI",
    allowed: ["src/App.tsx", "src/store.tsx"],
  },
  "src/economy-sim.ts": {
    name: "test simulation",
    allowed: ["src/data.ts", "src/domain.ts", "src/engine.ts", "src/types.ts"],
  },
  "worker/index.ts": {
    name: "Worker/API",
    allowed: [
      "src/data.ts",
      "src/domain.ts",
      "src/types.ts",
      "worker/observability.ts",
    ],
  },
  "worker/observability.ts": {
    name: "Worker diagnostics",
    kind: "Worker diagnostics",
    allowed: [],
  },
  "src/operation-safety.ts": {
    name: "operation safety",
    allowed: [],
  },
};

const PURE_FILES = new Set([
  "src/types.ts",
  "src/data.ts",
  "src/engine.ts",
  "src/settlement.ts",
  "src/domain.ts",
]);
const LINE_GUIDANCE_LIMIT = 900;
const COMPLEXITY_GUIDANCE_LIMIT = 160;
const SOURCE_ROOTS = ["src", "worker"];
const EXCEPTION_RULES = [
  { pattern: /(?:^|\/)\w[\w.-]*\.test\.tsx?$/, name: "test module" },
  { pattern: /^src\/vite-env\.d\.ts$/, name: "Vite declaration module" },
];

function displayPath(rootDir, filePath) {
  return relative(rootDir, filePath).replaceAll("\\", "/");
}

function discoverSourceFiles(rootDir) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const filePath = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (
        [".ts", ".tsx"].some((extension) => entry.name.endsWith(extension))
      )
        files.push(filePath);
    }
  }
  SOURCE_ROOTS.map((directory) => resolve(rootDir, directory))
    .filter(existsSync)
    .forEach(visit);
  return files;
}

function exceptionFor(file) {
  return EXCEPTION_RULES.find(({ pattern }) => pattern.test(file));
}

function normalizeRole(role) {
  if (!role) return null;
  if (typeof role === "string") return { name: role, kind: role };
  return role;
}

function roleFor(file, roles, frontendFiles) {
  const explicit = normalizeRole(roles[file]);
  if (explicit) return explicit;
  if (LAYERS[file]) {
    const role = normalizeRole(LAYERS[file]);
    if (file === "src/App.tsx")
      return {
        ...role,
        allowed: [...new Set([...(role.allowed ?? []), ...frontendFiles])],
      };
    return role;
  }
  if (frontendFiles.has(file))
    return {
      name: "React UI",
      kind: "React UI",
      allowed: [
        "src/data.ts",
        "src/domain.ts",
        "src/engine.ts",
        "src/settlement.ts",
        "src/store.tsx",
        "src/types.ts",
        ...frontendFiles,
      ],
    };
  return null;
}

function resolveModule(rootDir, filePath, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(filePath), specifier);
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = `${base}${extension}`;
    if (existsSync(candidate)) return displayPath(rootDir, candidate);
  }
  return existsSync(base) &&
    SOURCE_EXTENSIONS.some((extension) => base.endsWith(extension))
    ? displayPath(rootDir, base)
    : null;
}

function importedSpecifiers(source) {
  return source
    .split(/\r?\n/)
    .map(
      (line) =>
        line.match(IMPORT_PATTERN)?.[1] ?? line.match(IMPORT_PATTERN)?.[2],
    )
    .filter(Boolean);
}

function complexityTokens(source) {
  return (source.match(/\b(?:if|for|while|case|catch)\b|&&|\|\|/g) ?? [])
    .length;
}

function addFailure(failures, filePath, message, remediation) {
  failures.push(`${filePath}: ${message} Remediation: ${remediation}`);
}

export function checkArchitecture({ rootDir = ROOT, files, roles = {} } = {}) {
  const failures = [];
  const warnings = [];
  const discovered = discoverSourceFiles(rootDir).map((filePath) =>
    displayPath(rootDir, filePath),
  );
  const frontendFiles = new Set(
    discovered.filter((file) => file.startsWith("src/frontend/")),
  );
  const selectedFiles = files ?? discovered;
  const absoluteFiles = selectedFiles.map((file) =>
    isAbsolute(file) ? file : resolve(rootDir, file),
  );

  for (const filePath of absoluteFiles) {
    const file = displayPath(rootDir, filePath);
    let source;
    try {
      source = readFileSync(filePath, "utf8");
    } catch {
      addFailure(
        failures,
        file,
        "file could not be read",
        "restore the file or remove it from the architecture rule set",
      );
      continue;
    }

    if (exceptionFor(file)) continue;
    const role = roleFor(file, roles, frontendFiles);
    if (!role) {
      addFailure(
        failures,
        file,
        "no architectural role is defined for this governed source module",
        "add an explicit path rule and ownership entry, or place the file in a documented test/declaration exception category",
      );
      continue;
    }
    if (role) {
      for (const specifier of importedSpecifiers(source)) {
        const target = resolveModule(rootDir, filePath, specifier);
        if (target && role.allowed && !role.allowed.includes(target)) {
          addFailure(
            failures,
            file,
            `the ${role.name} layer imports ${target}, which is outside its permitted direction`,
            `move the dependency behind the owning layer or update docs/ARCHITECTURE.md and this allowlist with a narrow rationale`,
          );
        }
      }
    }

    if (PURE_FILES.has(file) || role.kind === "pure domain rules") {
      for (const specifier of importedSpecifiers(source)) {
        if (BROWSER_IMPORTS.test(specifier)) {
          addFailure(
            failures,
            file,
            `pure logic imports browser/React module ${specifier}`,
            "keep browser concerns in transport, store, or UI modules",
          );
        }
      }
      if (BROWSER_GLOBALS.test(source)) {
        addFailure(
          failures,
          file,
          "pure logic references a browser global",
          "pass data into a deterministic rule function instead of reading browser state",
        );
      }
    }

    if (
      file === "src/App.tsx" ||
      file === "src/main.tsx" ||
      role.kind === "React UI"
    ) {
      const bypasses = [
        [/\bfetch\s*\(/, "direct network access"],
        [
          /\b(?:localStorage|sessionStorage)\s*\./,
          "direct browser storage write/read",
        ],
        [/\/api\/actions/, "direct action endpoint access"],
        [/\bapplyAction\s*\(/, "direct domain mutation"],
        [
          /\b(?:addLedger|recordPayout|settleEvent|adjustBalance)\s*\(/,
          "direct financial/result mutation helper",
        ],
        [
          /\b(?:state|snapshot|currentState|nextState)\.(?:balances|bets|ledger|events)\s*(?:\[[^\]]+\]|\.[A-Za-z_$][\w$]*)?\s*(?:\+=|-=|\*=|\/=|=|\.(?:push|unshift|splice)\s*\()/,
          "direct financial/result state mutation",
        ],
      ];
      for (const [pattern, label] of bypasses) {
        if (pattern.test(source)) {
          addFailure(
            failures,
            file,
            `UI contains ${label}`,
            "send an allowlisted action through store.dispatch and keep confirmation in transport/Worker",
          );
        }
      }
    }

    if (file === "worker/index.ts" || role.kind === "Worker/API") {
      if (!/\bparseAction\s*\(\s*data\.action\s*\)/.test(source)) {
        addFailure(
          failures,
          file,
          "Worker request input does not pass through parseAction(data.action)",
          "parse and runtime-validate the untrusted action immediately before applyAction",
        );
      }
      if (/\bapplyAction\s*\([^,]+,\s*data\.action\b/.test(source)) {
        addFailure(
          failures,
          file,
          "Worker applies raw request input",
          "apply the parsed Action value returned by parseAction, never data.action directly",
        );
      }
    }

    const lines = source.split(/\r?\n/).length;
    if (lines > LINE_GUIDANCE_LIMIT) {
      warnings.push(
        `${file}: ${lines} lines exceeds the ${LINE_GUIDANCE_LIMIT}-line guidance threshold; split only when a cohesive responsibility emerges.`,
      );
    }
    const complexity = complexityTokens(source);
    if (complexity > COMPLEXITY_GUIDANCE_LIMIT) {
      warnings.push(
        `${file}: approximately ${complexity} branch tokens exceeds the ${COMPLEXITY_GUIDANCE_LIMIT}-token guidance threshold; prefer focused helpers in future changes.`,
      );
    }
  }

  return { failures, warnings };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const report = checkArchitecture();
  if (report.warnings.length) {
    console.warn("Architecture guidance (advisory):");
    for (const warning of report.warnings) console.warn(`- ${warning}`);
  }
  if (report.failures.length) {
    console.error("Architecture check failed:");
    for (const failure of report.failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  } else {
    console.log(
      "Architecture check passed: permitted layer directions and mutation boundaries hold.",
    );
  }
}
