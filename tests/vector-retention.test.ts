import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../src/services/sqlite/SessionStore.js';
import {
  lastActivityByProject,
  isProjectInactive,
  evictInactiveProjectVectors,
} from '../src/services/vector/vector-retention.js';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

/** Stand-in for SqliteVecManager: the retention logic only needs these two. */
class FakeVec {
  constructor(private byProject: Record<string, number>) {}
  listProjects(): string[] { return Object.keys(this.byProject); }
  deleteByProject(project: string): number {
    const n = this.byProject[project] ?? 0;
    delete this.byProject[project];
    return n;
  }
  remaining(): string[] { return Object.keys(this.byProject); }
}

describe('vector retention (D1)', () => {
  let store: SessionStore;
  let dbPath: string;

  function seed(project: string, createdAt: number, lastUsed: number | null = null): void {
    const sessionDbId = store.createSDKSession(`c-${crypto.randomUUID()}`, project, 'p');
    const memorySessionId = `m-${crypto.randomUUID()}`;
    store.ensureMemorySessionIdRegistered(sessionDbId, memorySessionId);
    store.storeObservation(memorySessionId, project, {
      type: 'discovery', title: 't', subtitle: 's', facts: ['f'], narrative: 'n', concepts: ['c'],
    } as never);
    store.db.prepare(
      'UPDATE observations SET created_at_epoch = ?, last_used_at = ? WHERE project = ?',
    ).run(createdAt, lastUsed, project);
  }

  beforeEach(() => {
    dbPath = `/tmp/test-retention-${crypto.randomUUID()}.db`;
    store = new SessionStore(dbPath);
  });
  afterEach(() => {
    store.close();
    try { require('fs').unlinkSync(dbPath); } catch { /* ignore */ }
  });

  describe('activity', () => {
    it('reports the newest write per project', () => {
      seed('alpha', NOW - 10 * DAY);
      seed('beta', NOW - 200 * DAY);

      const activity = lastActivityByProject(store.db);
      expect(activity.get('alpha')).toBe(NOW - 10 * DAY);
      expect(activity.get('beta')).toBe(NOW - 200 * DAY);
    });

    it('counts RETRIEVAL as activity, not just writes', () => {
      // A finished project whose memories are still being read is not dormant.
      seed('gamma', NOW - 200 * DAY, NOW - 3 * DAY);

      const activity = lastActivityByProject(store.db);
      expect(activity.get('gamma')).toBe(NOW - 3 * DAY);
      expect(isProjectInactive(activity, 'gamma', 90, NOW)).toBe(false);
    });
  });

  describe('isProjectInactive', () => {
    const activity = new Map<string, number>([
      ['recent', NOW - 10 * DAY],
      ['old', NOW - 200 * DAY],
      ['edge', NOW - 90 * DAY],
    ]);

    it('keeps a recently active project', () => {
      expect(isProjectInactive(activity, 'recent', 90, NOW)).toBe(false);
    });

    it('flags a long-dormant project', () => {
      expect(isProjectInactive(activity, 'old', 90, NOW)).toBe(true);
    });

    it('treats exactly-at-the-boundary as still active', () => {
      expect(isProjectInactive(activity, 'edge', 90, NOW)).toBe(false);
    });

    it('treats an unknown project as inactive — nothing to keep vectors for', () => {
      expect(isProjectInactive(activity, 'ghost', 90, NOW)).toBe(true);
    });

    it('honours a custom window', () => {
      expect(isProjectInactive(activity, 'recent', 5, NOW)).toBe(true);
    });
  });

  describe('eviction', () => {
    it('evicts dormant projects and keeps active ones', () => {
      seed('active', NOW - 5 * DAY);
      seed('dormant', NOW - 200 * DAY);
      const vec = new FakeVec({ active: 100, dormant: 250 });

      const result = evictInactiveProjectVectors(store.db, vec, { inactiveDays: 90, now: NOW });

      expect(result.evictedProjects).toEqual(['dormant']);
      expect(result.vectorRowsRemoved).toBe(250);
      expect(vec.remaining()).toEqual(['active']);
    });

    it('leaves the observations themselves untouched — eviction is reversible', () => {
      seed('dormant', NOW - 200 * DAY);
      const before = store.db.prepare('SELECT COUNT(*) AS n FROM observations').get() as { n: number };

      evictInactiveProjectVectors(store.db, new FakeVec({ dormant: 10 }), { inactiveDays: 90, now: NOW });

      const after = store.db.prepare('SELECT COUNT(*) AS n FROM observations').get() as { n: number };
      expect(after.n).toBe(before.n);
    });

    it('bounds how many projects one pass evicts', () => {
      for (const p of ['a', 'b', 'c', 'd']) seed(p, NOW - 200 * DAY);
      const vec = new FakeVec({ a: 1, b: 1, c: 1, d: 1 });

      const result = evictInactiveProjectVectors(store.db, vec, { inactiveDays: 90, now: NOW, limit: 2 });

      expect(result.evictedProjects).toHaveLength(2);
      expect(vec.remaining()).toHaveLength(2);
    });

    it('does nothing when every project is active', () => {
      seed('active', NOW - 1 * DAY);
      const vec = new FakeVec({ active: 5 });

      const result = evictInactiveProjectVectors(store.db, vec, { inactiveDays: 90, now: NOW });

      expect(result.evictedProjects).toHaveLength(0);
      expect(result.vectorRowsRemoved).toBe(0);
    });

    it('keeps going when one project fails to evict', () => {
      seed('bad', NOW - 200 * DAY);
      seed('good', NOW - 200 * DAY);
      const vec = {
        listProjects: () => ['bad', 'good'],
        deleteByProject: (p: string) => {
          if (p === 'bad') throw new Error('locked');
          return 7;
        },
      };

      const result = evictInactiveProjectVectors(store.db, vec, { inactiveDays: 90, now: NOW });

      expect(result.evictedProjects).toEqual(['good']);
      expect(result.vectorRowsRemoved).toBe(7);
    });
  });
});
