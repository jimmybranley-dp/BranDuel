import { readFileSync } from "node:fs";
import { test } from "node:test";
import { deepStrictEqual, equal } from "node:assert/strict";

const config = JSON.parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
);

test("staging and production retain explicit Cloudflare Workers Logs configuration", () => {
  for (const environment of ["staging", "production"]) {
    const logs = config.env?.[environment]?.observability?.logs;
    equal(logs?.enabled, true, `${environment} Workers Logs must be enabled`);
    equal(logs?.persist, true, `${environment} Workers Logs must persist`);
    equal(
      logs?.invocation_logs,
      false,
      `${environment} invocation metadata must stay disabled`,
    );
    equal(
      logs?.head_sampling_rate,
      1,
      `${environment} sampling must remain deliberate`,
    );
    equal(
      logs?.destinations,
      undefined,
      `${environment} must not add a third-party log destination`,
    );
  }
});

test("observability config does not silently enable traces or local hosted querying", () => {
  deepStrictEqual(config.observability, undefined);
  deepStrictEqual(config.env?.staging?.observability?.traces, undefined);
  deepStrictEqual(config.env?.production?.observability?.traces, undefined);
});
