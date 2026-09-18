# Reliability contract

## Confirmed state

The Worker/D1 snapshot is authoritative. The client may cache the last confirmed snapshot for display, but it must label it stale/read-only when disconnected. It must not update balances, tickets, result status, or success messages before the Worker confirms a write.

`src/store.tsx` polls every two seconds and on focus. It tracks the latest revision and server-time offset; an older response cannot overwrite a newer confirmed snapshot.

## Request IDs and receipts

Every mutation gets a request ID and the expected player ID. The browser saves the complete pending request in session storage before sending it. The Worker binds a request ID to the authenticated actor and canonical action payload. A reused ID with a different actor or payload is rejected.

Accepted and terminal rejected requests are durable receipts. A duplicate accepted request returns the original response state/revision, so it cannot apply money twice. Legacy `action_requests` rows without verifiable receipts are blocked from replay and require reconciliation.

## Uncertain-request recovery

Timeouts, network failures, and non-terminal responses are **uncertain**, not rejected. The UI keeps the request, blocks additional mutations and sign-out, and offers `Resolve saved request`. Resolution first checks `/api/actions/:requestId`; if no receipt exists it retries the same request ID. If the session changed, the original player must sign in again.

Do not delete a pending request to make the UI available. A disconnected page shows the last confirmed state only.

## Revision conflicts

The Worker reads a revision, applies the command to that snapshot, then updates `app_state` with a compare-and-set revision predicate. The D1 batch includes a write guard that forces rollback if the CAS changed no rows. On a conflict, the Worker reloads and retries the same validated command. Concurrent distinct actions therefore rebase without losing ledger entries; concurrent duplicates are still receipt-idempotent.

## Reconciliation

For each team, the state balance must equal the sum of its state ledger entries. Opening grants are part of that ledger. Wagers debit stake, winning payouts and game payouts credit, replacements/voids refund, and corrections add explicit reversal entries. The export joins relational `ledger_audit` with `ledger_context` for request and actor provenance.

If a legacy completed result lacks a complete `settlementLedgerIds` audit, automatic reversal is blocked. Reconcile it manually through the commissioner process or use a new isolated database for a rehearsal; do not reset real event data.

## Correction and void behavior

- A correction is commissioner-only, requires a changed result and a reason, reverses linked game/wager payouts, reopens settled tickets, then applies the replacement result.
- The accepted odds remain the odds snapshotted when the market opened.
- Corrections retain previous result, replacement result, actor, time, and reason.
- Voiding an unfinished round refunds open tickets. Voiding a completed Derby result first reverses settlement, then refunds tickets; it requires a reason.
- Prep results have no economic settlement, so their correction/void path changes rating history without settlement reversal.
- Closeout is allowed only when no event is unfinished and no ticket is open; the final snapshot is then frozen.
- `START_MATCH` records the Worker/domain acceptance time as `startedAt`; settlement records `settledAt`. Duration calibration uses only completed, non-voided events with both timestamps, and never changes a frozen market.
- Economy-season rebases are ordinary authoritative actions: each team receives an explicit ledger adjustment with prior/new balances, season ID, actor, and reason, committed with the snapshot revision, receipt, and ledger audit rows in one D1 batch.
