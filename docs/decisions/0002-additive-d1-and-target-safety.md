# ADR 0002: additive D1 and target safety

Status: Accepted

Migrations retain existing snapshots, legacy requests, and ledger rows. Local rehearsals use a new state path outside `.wrangler/state`. Named Cloudflare wrappers validate Worker/D1 configuration and exact target confirmation; local production commands are plan-only and cannot supply human approval.

This protects real event data and prevents accidental production changes. See [OPERATIONS.md](../OPERATIONS.md) and [SECURITY.md](../SECURITY.md).
