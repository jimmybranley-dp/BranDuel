import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { equal, notEqual } from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runWranglerTypes } from "./wrangler-types.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

test("generated binding freshness fails after a controlled generated-file change", async () => {
  const root = await mkdtemp(join(tmpdir(), "branduel-types-"));
  const output = join(root, "worker-configuration.d.ts");
  const configPath = join(root, "wrangler.jsonc");
  try {
    equal(await runWranglerTypes(["generate", "--output", output]), 0);
    equal(await runWranglerTypes(["check", "--output", output]), 0);
    const config = JSON.parse(
      await readFile(resolve(rootDir, "wrangler.jsonc"), "utf8"),
    );
    config.vars = { CONTROLLED_STALE_BINDING: "fixture" };
    config.main = resolve(rootDir, config.main);
    config.assets.directory = resolve(rootDir, config.assets.directory);
    config.d1_databases = config.d1_databases.map((database) => ({
      ...database,
      migrations_dir: resolve(rootDir, database.migrations_dir),
    }));
    await writeFile(configPath, `${JSON.stringify(config)}\n`, "utf8");
    notEqual(
      await runWranglerTypes([
        "check",
        "--output",
        output,
        "--config",
        configPath,
      ]),
      0,
    );
  } finally {
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 50,
    });
  }
});
