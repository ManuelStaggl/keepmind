// SPDX-License-Identifier: Apache-2.0
//
// Telling apart the two kinds of memory session id.
//
// An SDK-issued id names a live Claude Agent SDK conversation. After a worker
// restart that conversation is gone, and resuming it would fail or — worse —
// resume the wrong thing, which is why SessionManager clears the id when it
// rebuilds a session (Issue #817).
//
// A SYNTHETIC id names nothing but itself: it is a grouping key for the
// observations of one working session, minted locally by the stateless observer
// path and by the HTTP providers. It cannot go stale, because there is no remote
// state behind it. Clearing it does real damage instead — every generator
// restart mints another one, and a single working session ends up split across
// several memory sessions, which fragments its summary and its session-start
// injection.
//
// So: clear SDK ids, keep synthetic ones.

/** Prefixes used by every provider that mints its own memory session id. */
const SYNTHETIC_PREFIXES = ['stateless-', 'gemini-', 'openrouter-'];

export function isSyntheticMemorySessionId(id: string | null | undefined): id is string {
  if (typeof id !== 'string' || id.length === 0) return false;
  return SYNTHETIC_PREFIXES.some(prefix => id.startsWith(prefix));
}

/**
 * The id a rebuilt session should start with: a synthetic id survives, an
 * SDK-issued one is dropped so a fresh one gets captured.
 */
export function carryOverMemorySessionId(stored: string | null | undefined): string | null {
  return isSyntheticMemorySessionId(stored) ? stored : null;
}
