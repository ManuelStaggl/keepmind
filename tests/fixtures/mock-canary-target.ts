// Fixture for tests/mock-substrate-canary.test.ts. Two independent exports so
// the canary can partially mock one and assert the other falls through to the
// real module (node:test module-mock behavior). Kept trivial and dependency-free.
export function alpha(): string {
  return 'real-alpha';
}
export function beta(): string {
  return 'real-beta';
}
