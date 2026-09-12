// The original defect reproductions have been replaced by regression coverage.
// Kept as a redirect for links in MONDAY-REVIEW.md.
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, [
  'node_modules/vitest/vitest.mjs', 'run', '--config', 'vite.config.ts',
  'src/domain.test.ts', 'worker/index.test.mjs', 'src/transport.test.ts',
], { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
