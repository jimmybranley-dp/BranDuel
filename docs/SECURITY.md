# Security and safety boundaries

## Credentials and secrets

- `PLAYER_PASSCODES` is a Worker secret containing server-verified credential hashes. It is required in staging and production.
- Local setup may create `.dev.vars`, `.private-player-hashes.json`, and `.private-player-passcodes.json`. These are ignored credential material. Never access, print, paste, copy, commit, or upload them.
- Test credentials should be generated ephemerally by the browser harness. Never use memorable local passcodes for the real event.
- `npm run check:artifacts` checks tracked files plus known generated, report, diagnostic, and deployable-output roots for credential filenames and recognized secret material. It checks filenames before content and never opens protected credential sources such as `.dev.vars` or `.private-player-*.json`.

## Sessions and authentication

Login validates a player ID and passcode, throttles attempts per player and IP window, and issues a random HttpOnly, SameSite=Strict cookie. HTTPS cookies are Secure and expire after seven days. Session records bind the player to a hash of the configured credential, so credential rotation invalidates old sessions.

Mutating requests require the same-origin check, a valid session, the session-derived actor, and a matching `expectedPlayerId`. The API does not trust a client-supplied role or actor field.

## Roles

The only commissioner is Jimmy (`jimmy`) in the current product model. The Worker enforces commissioner-only corrections, voids/refunds, betting pause, economy/team/game changes, bank adjustments, mode changes, reset, closeout, and export. Ordinary players retain the normal round and result flow; details are in [PRODUCT.md](PRODUCT.md).

## Prohibited actions

- Never run a test, rehearsal, migration, reset, or deployment against the production hostname or production D1.
- Never expose passcodes, hashes, cookies, tokens, raw credential JSON, or secret transcripts.
- Never bypass the Worker action allowlist, revision checks, receipt recovery, audit writes, or D1 transaction boundary.
- Never point an isolated rehearsal at `.wrangler/state` or a path inside it.
- Never treat a static CLI flag as production authorization. The local wrapper is plan-only for production.

## Production safety

`wrangler.jsonc` has distinct staging and production Worker/D1 targets. Named staging wrappers require an exact target confirmation and config match. Local production commands only print validated plans; actual production execution needs an externally protected human reviewer, which is not present in this repository. See [OPERATIONS.md](OPERATIONS.md).
