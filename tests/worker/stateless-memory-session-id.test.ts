import { describe, it, expect } from 'bun:test';
import { ensureStatelessMemorySessionId } from '../../src/services/worker/ClaudeProvider.js';

/**
 * Regression test for a SILENT failure.
 *
 * The stateless observer path issues one SDK query per compression, so there is
 * no long-lived SDK session whose `session_id` can serve as the memory session
 * id. When that id is missing, `processAgentResponse` does not throw — it logs
 * "memorySessionId not yet captured; deferring storage until next round" and
 * drops the observation. Every observation. Nothing in the worker log reads as
 * an error, and the only symptom is that memory quietly stops filling.
 *
 * Observed live on 2026-08-09 before the fix.
 */
describe('stateless memory session id', () => {
  function session(overrides: Partial<{ memorySessionId: string | null }> = {}) {
    return {
      sessionDbId: 7,
      contentSessionId: 'content-abc',
      memorySessionId: null as string | null,
      ...overrides,
    };
  }

  it('mints an id when none exists, so storage is never deferred', () => {
    const s = session();
    const writes: Array<{ id: number; value: string | null }> = [];
    const store = {
      updateMemorySessionId: (id: number, value: string | null) => writes.push({ id, value }),
    };

    const result = ensureStatelessMemorySessionId(s, store, 1_754_700_000_000);

    expect(s.memorySessionId).toBe(result);
    expect(result).toBe('stateless-content-abc-1754700000000');
    // Must be persisted too: an in-memory-only id is lost on the next generator
    // pass and the observations would be split across two memory sessions.
    expect(writes).toEqual([{ id: 7, value: 'stateless-content-abc-1754700000000' }]);
  });

  it('keeps an id that is already set', () => {
    const s = session({ memorySessionId: 'existing-id' });
    const writes: string[] = [];
    const store = { updateMemorySessionId: (_id: number, value: string | null) => writes.push(String(value)) };

    const result = ensureStatelessMemorySessionId(s, store, 1_754_700_000_000);

    expect(result).toBe('existing-id');
    expect(writes).toEqual([]);
  });

  it('is stable across calls within a session', () => {
    const s = session();
    const store = { updateMemorySessionId: () => {} };

    const first = ensureStatelessMemorySessionId(s, store, 1_000);
    const second = ensureStatelessMemorySessionId(s, store, 2_000);

    expect(second).toBe(first);
  });

  it('still sets the id in memory when the store write fails', () => {
    // A database problem must not degrade into "records nothing at all".
    const s = session();
    const store = {
      updateMemorySessionId: () => { throw new Error('database is locked'); },
    };

    const result = ensureStatelessMemorySessionId(s, store, 1_754_700_000_000);

    expect(result).toBeTruthy();
    expect(s.memorySessionId).toBe(result);
  });
});
