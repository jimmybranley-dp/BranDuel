# BranDuel documentation map

This directory is the current, repository-local knowledge base. Read the linked contract before changing the corresponding code. Code and tests are the evidence for implemented behavior; a section marked **Open** is not a settled product decision.

## Start here

1. [Product](PRODUCT.md) — rules, roles, journeys, invariants, and unresolved decisions.
2. [Architecture](ARCHITECTURE.md) — ownership, flow, and boundaries.
3. [Reliability](RELIABILITY.md) and [Security](SECURITY.md) — mutation and trust guarantees.
4. [Testing](TESTING.md), [Operations](OPERATIONS.md), and [Frontend](FRONTEND.md) — how to verify, run, and present the system.
5. [Observability](OBSERVABILITY.md) — structured local Worker diagnostics and safe CI artifacts.

## Working records

- [Technical debt](tech-debt.md) tracks evidence-backed follow-up work.
- [Decision record 0001](decisions/0001-authoritative-action-boundary.md), [decision record 0002](decisions/0002-additive-d1-and-target-safety.md), [decision record 0003](decisions/0003-open-product-decisions.md), [decision record 0004](decisions/0004-economy-v1.md), and [decision record 0005](decisions/0005-current-night-heat.md) contain accepted decisions and open product questions.
- [Active execution plans](exec-plans/active/README.md) and [completed execution plans](exec-plans/completed/README.md) are delivery records, not replacements for the contracts above.

`MONDAY-REVIEW.md` remains at the repository root as a historical review. It is explicitly non-authoritative; use [the current docs](PRODUCT.md) for present behavior.
