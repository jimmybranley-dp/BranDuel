# ADR 0001: authoritative action boundary

Status: Accepted

The Worker is the only authority for authenticated mutations. React submits an allowlisted action with a request ID; the Worker derives the actor, validates the command, applies the domain transition, and commits state, audit, and receipt together. The client renders only confirmed state and treats network loss as uncertainty/read-only mode.

This preserves financial safety, retry recovery, and convergence across phones. See [ARCHITECTURE.md](../ARCHITECTURE.md) and [RELIABILITY.md](../RELIABILITY.md).
