// Controlled negative fixture: architecture-guardrails.test.mjs must reject this.
export function InvalidFixture() {
  return fetch("/api/actions");
}
