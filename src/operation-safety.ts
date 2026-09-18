import { isAbsolute, relative, resolve } from "node:path";

export const STAGING_HOSTNAME = "branduel-staging.jimmybranley.workers.dev";
export const PRODUCTION_HOSTNAME = "branduel-production.jimmybranley.workers.dev";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function asUrl(target: string | URL): URL {
  if (target instanceof URL) return target;
  try {
    return new URL(target);
  } catch {
    throw new Error("Destructive test target must be an absolute URL.");
  }
}

function isLoopback(url: URL): boolean {
  return LOOPBACK_HOSTNAMES.has(url.hostname.toLowerCase()) && ["http:", "https:"].includes(url.protocol);
}

function isAllowedStaging(url: URL): boolean {
  return url.hostname.toLowerCase() === STAGING_HOSTNAME && url.protocol === "https:" && ["", "443"].includes(url.port);
}

export function assertDestructiveTestTarget(target: string | URL, operation: string): URL {
  const url = asUrl(target);
  const hostname = url.hostname.toLowerCase();

  if (url.username || url.password) {
    throw new Error(`Refusing ${operation}: target URLs must not contain credentials.`);
  }
  if (hostname === PRODUCTION_HOSTNAME) {
    throw new Error(`Refusing ${operation} against the production hostname. Destructive tests accept loopback or ${STAGING_HOSTNAME} only.`);
  }
  if (!isLoopback(url) && !isAllowedStaging(url)) {
    throw new Error(`Refusing ${operation}: destructive tests accept loopback or ${STAGING_HOSTNAME} only.`);
  }
  return url;
}

/**
 * Return the normalized absolute path used for an isolated local rehearsal.
 * `path.resolve` handles both trailing separators and `..` segments using the
 * host platform's filesystem rules.
 */
export function resolveRehearsalStatePath(statePath: string, cwd = process.cwd()): string {
  const platformSeparators = process.platform === "win32" ? statePath.replaceAll("/", "\\") : statePath.replaceAll("\\", "/");
  return resolve(cwd, platformSeparators);
}

export function protectedLocalStatePath(cwd = process.cwd()): string {
  return resolve(cwd, ".wrangler", "state");
}

export function assertIsolatedLocalStatePath(statePath: string, cwd = process.cwd()): string {
  const candidate = resolveRehearsalStatePath(statePath, cwd);
  const protectedPath = protectedLocalStatePath(cwd);
  const pathFromProtected = relative(protectedPath, candidate);
  const insideProtected = pathFromProtected === ""
    || (pathFromProtected !== ".."
      && !pathFromProtected.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
      && !isAbsolute(pathFromProtected));

  if (insideProtected) {
    throw new Error(`Refusing isolated rehearsal: BRANDUEL_STATE_PATH resolves to the ordinary ${protectedPath} database.`);
  }
  return candidate;
}
