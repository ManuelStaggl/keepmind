import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../src/services/sqlite/SessionStore.js';
import { USAGE_CHANNEL_COLUMNS, type UsageChannel } from '../src/services/sqlite/types.js';

// C1': relevance_count was bumped from exactly two places — SessionStart
// injection and an explicit get_observations fetch — while neither FTS nor
// vector search touched it. A "96% never used" reading measured the
// instrument, not the corpus. These tests pin the channels apart.

describe('observation usage channels', () => {
  let store: SessionStore;
  let dbPath: string;
  let observationId: number;

  function seedObservation(type = 'discovery'): number {
    const sessionDbId = store.createSDKSession(`content-${crypto.randomUUID()}`, 'proj', 'prompt');
    const memorySessionId = `mem-${crypto.randomUUID()}`;
    store.ensureMemorySessionIdRegistered(sessionDbId, memorySessionId);
    const result = store.storeObservation(memorySessionId, 'proj', {
      type,
      title: 'Test observation',
      subtitle: 'sub',
      facts: ['f'],
      narrative: 'n',
      concepts: ['c'],
    } as never);
    return (result as { id: number }).id ?? (result as unknown as number);
  }

  function counters(id: number): Record<string, number> {
    const row = store.db.prepare(
      `SELECT relevance_count, injection_count, explicit_fetch_count, fts_hit_count,
              vector_hit_count, last_used_at
         FROM observations WHERE id = ?`,
    ).get(id) as Record<string, number>;
    return row;
  }

  beforeEach(() => {
    dbPath = `/tmp/test-usage-${crypto.randomUUID()}.db`;
    store = new SessionStore(dbPath);
    observationId = seedObservation();
  });

  afterEach(() => {
    store.close();
    try { require('fs').unlinkSync(dbPath); } catch { /* ignore */ }
  });

  it('creates a column per retrieval channel', () => {
    const cols = (store.db.query('PRAGMA table_info(observations)').all() as Array<{ name: string }>)
      .map(c => c.name);
    for (const column of Object.values(USAGE_CHANNEL_COLUMNS)) {
      expect(cols).toContain(column);
    }
  });

  it('starts every counter at zero', () => {
    const c = counters(observationId);
    expect(c.relevance_count ?? 0).toBe(0);
    expect(c.injection_count ?? 0).toBe(0);
    expect(c.explicit_fetch_count ?? 0).toBe(0);
    expect(c.fts_hit_count ?? 0).toBe(0);
    expect(c.vector_hit_count ?? 0).toBe(0);
  });

  const channels: Array<[UsageChannel, string]> = [
    ['injection', 'injection_count'],
    ['explicit_fetch', 'explicit_fetch_count'],
    ['fts', 'fts_hit_count'],
    ['vector', 'vector_hit_count'],
  ];

  for (const [channel, column] of channels) {
    it(`counts a ${channel} hit against ${column} only`, () => {
      store.markObservationsUsed([observationId], channel);

      const c = counters(observationId);
      expect(c[column]).toBe(1);
      for (const other of Object.values(USAGE_CHANNEL_COLUMNS)) {
        if (other !== column) expect(c[other] ?? 0).toBe(0);
      }
    });
  }

  it('keeps relevance_count as the total across channels', () => {
    store.markObservationsUsed([observationId], 'injection');
    store.markObservationsUsed([observationId], 'fts');
    store.markObservationsUsed([observationId], 'vector');
    store.markObservationsUsed([observationId], 'explicit_fetch');

    const c = counters(observationId);
    expect(c.relevance_count).toBe(4);
    expect(c.injection_count).toBe(1);
    expect(c.fts_hit_count).toBe(1);
    expect(c.vector_hit_count).toBe(1);
    expect(c.explicit_fetch_count).toBe(1);
  });

  it('defaults to explicit_fetch when no channel is named', () => {
    store.markObservationsUsed([observationId]);
    expect(counters(observationId).explicit_fetch_count).toBe(1);
  });

  it('accumulates repeated hits on the same channel', () => {
    store.markObservationsUsed([observationId], 'vector');
    store.markObservationsUsed([observationId], 'vector');
    store.markObservationsUsed([observationId], 'vector');

    expect(counters(observationId).vector_hit_count).toBe(3);
  });

  it('resets the expiry timer on a SEARCH hit, not just on injection', () => {
    // Previously only injection and explicit fetches wrote last_used_at, so a
    // record search surfaced daily still aged out as untouched.
    expect(counters(observationId).last_used_at).toBeNull();

    store.markObservationsUsed([observationId], 'fts', 1_700_000_000_000);

    expect(counters(observationId).last_used_at).toBe(1_700_000_000_000);
  });

  it('marks every id in the batch', () => {
    const second = seedObservation();
    store.markObservationsUsed([observationId, second], 'vector');

    expect(counters(observationId).vector_hit_count).toBe(1);
    expect(counters(second).vector_hit_count).toBe(1);
  });

  it('is a no-op on an empty batch', () => {
    expect(() => store.markObservationsUsed([], 'vector')).not.toThrow();
    expect(counters(observationId).vector_hit_count ?? 0).toBe(0);
  });

  it('stores security observation types (they were never filtered out)', () => {
    const alertId = seedObservation('security_alert');
    const row = store.db.prepare('SELECT type FROM observations WHERE id = ?').get(alertId) as { type: string };
    expect(row.type).toBe('security_alert');

    store.markObservationsUsed([alertId], 'vector');
    expect(counters(alertId).vector_hit_count).toBe(1);
  });
});
