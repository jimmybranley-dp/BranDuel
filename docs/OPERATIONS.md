# Operations

## Local setup

Use Node 24.19.0 (or a compatible Node 24 release):

```powershell
npm ci
npm run setup:passcodes
npm run db:migrate:local
npm run dev
```

The Windows helper is `.\Start-BranDuel.ps1`; the default client is `http://127.0.0.1:5173`. Keep credential files private. For a disposable event server, follow [TESTING.md](TESTING.md#local-state-isolation).

## Staging

Staging is available at `https://branduel2.jimmybranley.com` (and remains available at `https://branduel-staging.jimmybranley.workers.dev`) with Worker/D1 target names `branduel-staging`. The custom domain is isolated from the production hostname so the new build can be compared directly with the old site. Use the named wrappers, which validate `wrangler.jsonc` and require the exact target string:

```powershell
npm run db:migrate:staging -- --confirm-target branduel-staging/staging/branduel-staging/migrate
npm run deploy:staging -- --confirm-target branduel-staging/staging/branduel-staging/deploy
npm run secret:put:staging -- --confirm-target branduel-staging/staging/branduel-staging/secret-put
```

Run staging migration and deployment only with the product owner's authorization and never as part of ordinary tests. Rehearse login, shared sessions, betting, settlement, recovery, and closeout on actual devices before using production.

## Production

Production is `https://branduel.jimmybranley.com` (and remains available at `https://branduel-production.jimmybranley.workers.dev`) with Worker/D1 target names `branduel-production`. This local harness must not deploy or change production. The local package commands are plan-only:

```powershell
npm run db:migrate:production -- --confirm-target branduel-production/production/branduel-production/migrate
npm run deploy:production -- --confirm-target branduel-production/production/branduel-production/deploy
npm run secret:put:production -- --confirm-target branduel-production/production/branduel-production/secret-put
```

They execute no production command locally. Any real production operation needs an external protected mechanism with a human reviewer; that workflow is not present in this repository.

## Migrations

Migrations are additive. `0001_shared_state.sql` creates the snapshot, legacy request, and ledger tables. `0002_authoritative_actions.sql` adds receipts, write guards, sessions, login throttling, and ledger context without deleting legacy rows. Never reset a database to repair a migration or test.

## Backups and recovery

Before and after a real event, the authenticated commissioner should export the final/working archive through `/api/export` and retain the release identifier with it. D1 export and point-in-time recovery are disaster-recovery tools; rehearse a restore and coordinate it because restoring a database can remove legitimate later actions. Use a correction for an individual result or ticket mistake and restore only for a broader database failure. A code rollback does not roll back D1 state.

## Deployment verification

After any hosted change, verify the intended root and `/api/health`, then verify login, a clean revision, zero events, and four $200,000 starting balances before inviting players. Confirm the selected environment and D1 target in `wrangler.jsonc` first. Do not report success without endpoint verification.

## Recovery

For a pending client request, follow [RELIABILITY.md](RELIABILITY.md#uncertain-request-recovery). For a stale session after credential rotation, hard-refresh or close/reopen the phone tab and sign in again. For unresolved legacy settlement data, preserve the state and escalate to the commissioner; do not reset it.

Local diagnostic capture and the safe fields available to Codex are documented in [OBSERVABILITY.md](OBSERVABILITY.md). This repository does not query hosted logs or use `wrangler tail` during tests.

Hosted observability is configuration-only in this change. An authorized human can inspect the intended staging or production Worker’s Workers Logs in the Cloudflare dashboard after a separately authorized deployment; no deployment or hosted query is part of local verification. The named environment configuration keeps invocation logs off, persists only the Worker’s allowlisted structured diagnostics, and uses full sampling for the small event workload.
