import { describe, it, expect } from 'bun:test';
import {
  isSyntheticMemorySessionId,
  carryOverMemorySessionId,
} from '../../src/services/worker/memory-session-id.js';

/**
 * SessionManager clears memory_session_id whenever it rebuilds a session, so a
 * dead SDK conversation is never resumed (Issue #817). That is right for an
 * SDK-issued id and wrong for a synthetic one: a synthetic id has no remote
 * state to go stale, and dropping it mints a new one on every generator
 * restart — splitting a single working session across several memory sessions
 * and fragmenting both its summary and its session-start injection.
 */
describe('memory session id carry-over', () => {
  it('recognises the synthetic prefixes', () => {
    expect(isSyntheticMemorySessionId('stateless-content-abc-1754700000000')).toBe(true);
    expect(isSyntheticMemorySessionId('gemini-content-abc-1754700000000')).toBe(true);
    expect(isSyntheticMemorySessionId('openrouter-content-abc-1754700000000')).toBe(true);
  });

  it('does not mistake an SDK id for a synthetic one', () => {
    // SDK ids are bare UUIDs.
    expect(isSyntheticMemorySessionId('44491efb-9882-4787-a314-7bc8695cbfca')).toBe(false);
    expect(isSyntheticMemorySessionId(null)).toBe(false);
    expect(isSyntheticMemorySessionId(undefined)).toBe(false);
    expect(isSyntheticMemorySessionId('')).toBe(false);
  });

  it('carries a synthetic id across a rebuild', () => {
    const id = 'stateless-content-abc-1754700000000';
    expect(carryOverMemorySessionId(id)).toBe(id);
  });

  it('drops an SDK id so a fresh one is captured', () => {
    expect(carryOverMemorySessionId('44491efb-9882-4787-a314-7bc8695cbfca')).toBeNull();
    expect(carryOverMemorySessionId(null)).toBeNull();
  });
});
