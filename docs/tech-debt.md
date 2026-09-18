# Technical debt

These items are evidence-backed follow-up work, not silently resolved product policy.

- **Legacy scheduling compatibility:** the `scheduled` event status remains in the persisted type so old snapshots can be safely voided, but no new scheduling action exists. Remove the compatibility state only through an additive, data-safe migration if ever appropriate.
- **Legacy settlement repair:** older completed results may lack linked settlement ledger IDs and cannot be reversed automatically. Define a commissioner reconciliation workflow before relying on correction for legacy rounds.
- **Protected production workflow:** `wrangler.jsonc` and local wrappers have target checks, but the externally protected production deployment/reviewer workflow is not in this repository.
- **Hosted rehearsal evidence:** staging and real-device rehearsal remain operational prerequisites; local checks do not establish hosted health or venue connectivity.
- **Health semantics:** `/api/health` checks D1 before authentication and is therefore an anonymous database health probe, while earlier documentation described an authenticated health check. Keep the route behavior and the operational wording aligned.
