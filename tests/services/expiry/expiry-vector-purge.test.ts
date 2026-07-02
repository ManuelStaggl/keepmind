import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../../src/services/sqlite/SessionStore.js';
import { expireStaleObservations } from '../../../src/services/expiry/expiry.js';
import { SqliteVecManager } from '../../../src/services/vector/SqliteVecManager.js';

// R2 (perf plan): expiry must report the ids it expired so the maintenance loop
// can purge the matching vec_documents rows (stops unbounded vectors.db growth
// and keeps expired observations out of semantic search). These tests cover the
// contract MaintenanceLoop.jobExpire relies on.
describe('expireStaleObservations — expiredIds contract (R2)', () => {
  let store: SessionStore;
  const NOW = 1_000_000_000_000; // fixed epoch so TTL math is deterministic
  const DAY = 86_400_000;

  beforeEach(() => {
    store = new SessionStore(':memory:');
    // Unit test of the expiry SELECT/UPDATE logic — FK to sdk_sessions is not
    // under test, so drop the constraint and insert observations directly.
    store.db.run('PRAGMA foreign_keys = OFF');
  });

  afterEach(() => {
    store.close();
  });

  function insertObs(opts: {
    id: number;
    type?: string;
    importance?: number;
    lastUsedAt?: number | null;
    createdAtEpoch?: number;
  }): void {
    store.db.prepare(`
      INSERT INTO observations (id, memory_session_id, project, text, type, created_at, created_at_epoch, importance, last_used_at, valid_to)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(
      opts.id,
      'sess-1',
      'proj',
      `observation ${opts.id}`,
      opts.type ?? 'discovery',
      new Date(opts.createdAtEpoch ?? NOW).toISOString(),
      opts.createdAtEpoch ?? NOW,
      opts.importance ?? 1,
      opts.lastUsedAt ?? null,
    );
  }

  it('returns the ids of soft-expired observations', () => {
    // Two stale, low-importance, never-recalled observations, untouched past TTL.
    insertObs({ id: 1, createdAtEpoch: NOW - 40 * DAY });
    insertObs({ id: 2, createdAtEpoch: NOW - 40 * DAY });

    const result = expireStaleObservations(store.db, {
      ttlDays: 30,
      importanceFloor: 5,
      hardDelete: false,
      now: NOW,
    });

    expect(result.mode).toBe('soft');
    expect(result.expired).toBe(2);
    expect(result.expiredIds.sort()).toEqual([1, 2]);

    // The rows were archived (valid_to set), not deleted.
    const rows = store.db.prepare('SELECT id, valid_to FROM observations ORDER BY id').all() as Array<{ id: number; valid_to: number | null }>;
    expect(rows.map(r => r.id)).toEqual([1, 2]);
    expect(rows.every(r => r.valid_to !== null)).toBe(true);
  });

  it('excludes protected observations from expiredIds', () => {
    insertObs({ id: 1, createdAtEpoch: NOW - 40 * DAY });               // stale → expires
    insertObs({ id: 2, type: 'global', createdAtEpoch: NOW - 40 * DAY }); // global → protected
    insertObs({ id: 3, importance: 9, createdAtEpoch: NOW - 40 * DAY });  // high importance → protected
    insertObs({ id: 4, createdAtEpoch: NOW - 1 * DAY });                  // recent → protected

    const result = expireStaleObservations(store.db, {
      ttlDays: 30,
      importanceFloor: 5,
      hardDelete: false,
      now: NOW,
    });

    expect(result.expiredIds).toEqual([1]);
  });

  it('returns expiredIds for hard-deleted observations', () => {
    insertObs({ id: 1, createdAtEpoch: NOW - 40 * DAY });

    const result = expireStaleObservations(store.db, {
      ttlDays: 30,
      importanceFloor: 5,
      hardDelete: true,
      now: NOW,
    });

    expect(result.mode).toBe('hard');
    expect(result.expiredIds).toEqual([1]);
    const remaining = store.db.prepare('SELECT COUNT(*) AS c FROM observations').get() as { c: number };
    expect(remaining.c).toBe(0);
  });

  it('returns an empty expiredIds when nothing is stale', () => {
    insertObs({ id: 1, createdAtEpoch: NOW - 1 * DAY });
    const result = expireStaleObservations(store.db, {
      ttlDays: 30,
      importanceFloor: 5,
      hardDelete: false,
      now: NOW,
    });
    expect(result.expired).toBe(0);
    expect(result.expiredIds).toEqual([]);
  });
});

describe('SqliteVecManager.deleteBySqliteIds — best-effort guards (R2)', () => {
  it('is a no-op returning 0 for an empty id list', () => {
    expect(SqliteVecManager.instance().deleteBySqliteIds('observation', [])).toBe(0);
  });
});
