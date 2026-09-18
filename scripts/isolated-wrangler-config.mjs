import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function resolveConfigPath(rootDir, value) {
  return value ? resolve(rootDir, value) : value;
}

export async function createIsolatedWranglerConfig(statePath) {
  await mkdir(statePath, { recursive: true });
  const config = JSON.parse(
    await readFile(resolve(root, "wrangler.jsonc"), "utf8"),
  );
  config.main = resolveConfigPath(root, config.main);
  config.assets.directory = resolveConfigPath(root, config.assets.directory);
  config.d1_databases = config.d1_databases?.map((database) => ({
    ...database,
    migrations_dir: resolveConfigPath(root, database.migrations_dir),
  }));
  for (const environment of Object.values(config.env ?? {})) {
    environment.d1_databases = environment.d1_databases?.map((database) => ({
      ...database,
      migrations_dir: resolveConfigPath(root, database.migrations_dir),
    }));
  }

  const configPath = resolve(statePath, "wrangler.jsonc");
  await writeFile(configPath, JSON.stringify(config), "utf8");
  return configPath;
}
