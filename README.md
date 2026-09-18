# BranDuel

BranDuel is the Degenerate Derby game-night app: four fixed teams share a fictional-dollar economy, play live rounds, optionally wager, and finish with a frozen closeout archive. The hosted system is a Cloudflare Worker with D1; the client is React/Vite/TypeScript.

The repository is canonical at [github.com/jimmybranley-dp/BranDuel](https://github.com/jimmybranley-dp/BranDuel). Start with the [documentation map](docs/index.md), then use the focused documents below.

- [Product rules and open decisions](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Reliability and request recovery](docs/RELIABILITY.md)
- [Security and production boundaries](docs/SECURITY.md)
- [Testing](docs/TESTING.md)
- [Operations](docs/OPERATIONS.md)
- [Frontend expectations](docs/FRONTEND.md)

## Local development

Use Node 24.19.0 (or another compatible Node 24 release). For a new checkout, create local credentials without printing them, migrate local D1, then start the app:

```powershell
npm ci
npm run setup:passcodes
npm run db:migrate:local
npm run dev
```

On Windows, `.\Start-BranDuel.ps1` starts the local app; open `http://127.0.0.1:5173`. Keep local credential files private and ignored. Never inspect or print `.dev.vars` or `.private-player-*.json`.

## Verification

```powershell
npm run verify
npm run verify:full
```

The first command runs configured quality checks, TypeScript, Vitest, the production bundle, and artifact/secret safety. The full command adds the isolated Playwright suite. See [TESTING.md](docs/TESTING.md) for event rehearsals and state isolation.

## Hosted operations

| Environment | URL | Purpose |
| --- | --- | --- |
| Staging | `https://branduel2.jimmybranley.com` | New build for side-by-side comparison; workers.dev fallback: `https://branduel-staging.jimmybranley.workers.dev` |
| Production | `https://branduel-production.jimmybranley.workers.dev` | The real Derby |

Use the named staging wrappers and exact target confirmations in [OPERATIONS.md](docs/OPERATIONS.md). Local production migration, secret, and deploy commands are read-only plans. Do not deploy from this harness.

## Repository landmarks

`worker/index.ts` owns the API boundary; `src/domain.ts` owns rules and transitions; `src/transport.ts` and `src/store.tsx` own confirmed-state request flow; `src/settlement.ts` owns settlement; `migrations/` owns additive D1 schema changes; `wrangler.jsonc` owns deployment configuration. Historical review material is retained in [MONDAY-REVIEW.md](MONDAY-REVIEW.md) and is not current authority.
