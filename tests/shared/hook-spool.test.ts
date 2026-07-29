import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { DATA_DIR } from '../../src/shared/paths.js';
import {
  spoolWorkerCall,
  drainHookSpool,
  isReplayableRoute,
  spoolDepth,
  resetHookSpoolForTesting,
  type SpoolEntry,
} from '../../src/shared/hook-spool.js';

const SPOOL_DIR = join(DATA_DIR, 'spool');

function entryNames(): string[] {
  try {
    return readdirSync(SPOOL_DIR).filter(n => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
}

describe('hook spool (A2 — buffered hook calls)', () => {
  beforeEach(() => {
    try { rmSync(SPOOL_DIR, { recursive: true, force: true }); } catch { /* none */ }
  });
  afterEach(() => {
    resetHookSpoolForTesting();
    try { rmSync(SPOOL_DIR, { recursive: true, force: true }); } catch { /* none */ }
  });

  describe('route whitelist', () => {
    it('accepts the write paths whose loss loses data', () => {
      expect(isReplayableRoute('/api/sessions/observations')).toBe(true);
      expect(isReplayableRoute('/api/sessions/summarize')).toBe(true);
      expect(isReplayableRoute('/api/sessions/init')).toBe(true);
      expect(isReplayableRoute('/api/memory/save')).toBe(true);
    });

    it('rejects reads and the session refcount — replaying those is wrong, not merely useless', () => {
      expect(isReplayableRoute('/api/context/inject?projects=a')).toBe(false);
      expect(isReplayableRoute('/api/context/semantic')).toBe(false);
      expect(isReplayableRoute('/api/session/acquire')).toBe(false);
    });

    it('ignores the query string when matching', () => {
      expect(isReplayableRoute('/api/sessions/observations?platformSource=claude-code')).toBe(true);
    });
  });

  describe('spoolWorkerCall', () => {
    it('persists a replayable POST', () => {
      expect(spoolWorkerCall('/api/sessions/observations', 'POST', { tool_name: 'Read' })).toBe(true);
      expect(spoolDepth()).toBe(1);
    });

    it('does not persist GETs', () => {
      expect(spoolWorkerCall('/api/context/inject', 'GET', undefined)).toBe(false);
      expect(spoolDepth()).toBe(0);
    });

    it('does not persist a non-whitelisted POST', () => {
      expect(spoolWorkerCall('/api/session/acquire', 'POST', { sessionId: 'x' })).toBe(false);
      expect(spoolDepth()).toBe(0);
    });

    it('drops an oversized payload rather than filling the disk', () => {
      const huge = { blob: 'x'.repeat(600 * 1024) };
      expect(spoolWorkerCall('/api/sessions/observations', 'POST', huge)).toBe(false);
      expect(spoolDepth()).toBe(0);
    });

    it('leaves no .tmp files behind (write-then-rename)', () => {
      spoolWorkerCall('/api/sessions/observations', 'POST', { a: 1 });
      const all = readdirSync(SPOOL_DIR);
      expect(all.filter(n => n.endsWith('.tmp'))).toHaveLength(0);
    });
  });

  describe('drainHookSpool', () => {
    it('replays entries and removes them on success', async () => {
      spoolWorkerCall('/api/sessions/observations', 'POST', { tool_name: 'Read' });
      spoolWorkerCall('/api/sessions/summarize', 'POST', { contentSessionId: 's1' });

      const seen: string[] = [];
      const result = await drainHookSpool(async (entry: SpoolEntry) => {
        seen.push(entry.url);
        return { ok: true, permanent: false };
      });

      expect(result.replayed).toBe(2);
      expect(seen).toContain('/api/sessions/observations');
      expect(seen).toContain('/api/sessions/summarize');
      expect(spoolDepth()).toBe(0);
    });

    it('preserves the original body through the round trip', async () => {
      const body = { tool_name: 'Edit', cwd: 'C:/proj', nested: { a: [1, 2] } };
      spoolWorkerCall('/api/sessions/observations', 'POST', body);

      let received: unknown;
      await drainHookSpool(async (entry) => {
        received = entry.body;
        return { ok: true, permanent: false };
      });

      expect(received).toEqual(body);
    });

    it('keeps a transiently failed entry for the next drain', async () => {
      spoolWorkerCall('/api/sessions/observations', 'POST', { a: 1 });

      const result = await drainHookSpool(async () => ({ ok: false, permanent: false }));

      expect(result.deferred).toBe(1);
      expect(result.replayed).toBe(0);
      expect(spoolDepth()).toBe(1);
    });

    it('drops a permanently rejected entry instead of retrying it forever', async () => {
      spoolWorkerCall('/api/sessions/observations', 'POST', { a: 1 });

      const result = await drainHookSpool(async () => ({ ok: false, permanent: true }));

      expect(result.dropped).toBe(1);
      expect(spoolDepth()).toBe(0);
    });

    it('gives up on a poison entry after the attempt cap so it cannot block the queue', async () => {
      spoolWorkerCall('/api/sessions/observations', 'POST', { a: 1 });

      await drainHookSpool(async () => ({ ok: false, permanent: false }));
      expect(spoolDepth()).toBe(1);
      await drainHookSpool(async () => ({ ok: false, permanent: false }));
      expect(spoolDepth()).toBe(1);
      const third = await drainHookSpool(async () => ({ ok: false, permanent: false }));

      expect(third.dropped).toBe(1);
      expect(spoolDepth()).toBe(0);
    });

    it('discards a corrupt entry rather than failing the whole drain', async () => {
      mkdirSync(SPOOL_DIR, { recursive: true });
      writeFileSync(join(SPOOL_DIR, '000000000000001-1-0.json'), '{not json');
      spoolWorkerCall('/api/sessions/observations', 'POST', { a: 1 });

      const result = await drainHookSpool(async () => ({ ok: true, permanent: false }));

      expect(result.dropped).toBe(1);
      expect(result.replayed).toBe(1);
      expect(spoolDepth()).toBe(0);
    });

    it('discards an entry older than the age cap without dispatching it', async () => {
      mkdirSync(SPOOL_DIR, { recursive: true });
      const ancient = {
        url: '/api/sessions/observations',
        method: 'POST',
        body: { a: 1 },
        queuedAtEpoch: Date.now() - 30 * 24 * 60 * 60 * 1000,
        attempts: 0,
      };
      writeFileSync(join(SPOOL_DIR, '000000000000001-1-0.json'), JSON.stringify(ancient));

      let dispatched = false;
      const result = await drainHookSpool(async () => {
        dispatched = true;
        return { ok: true, permanent: false };
      });

      expect(dispatched).toBe(false);
      expect(result.dropped).toBe(1);
    });

    it('is a no-op when nothing was ever spooled', async () => {
      const result = await drainHookSpool(async () => ({ ok: true, permanent: false }));
      expect(result).toEqual({ replayed: 0, dropped: 0, deferred: 0 });
    });

    it('replays oldest first', async () => {
      mkdirSync(SPOOL_DIR, { recursive: true });
      const mk = (name: string, marker: string) => writeFileSync(
        join(SPOOL_DIR, name),
        JSON.stringify({
          url: '/api/sessions/observations',
          method: 'POST',
          body: { marker },
          queuedAtEpoch: Date.now(),
          attempts: 0,
        }),
      );
      mk('000000000000003-1-0.json', 'third');
      mk('000000000000001-1-0.json', 'first');
      mk('000000000000002-1-0.json', 'second');

      const order: string[] = [];
      await drainHookSpool(async (entry) => {
        order.push((entry.body as { marker: string }).marker);
        return { ok: true, permanent: false };
      });

      expect(order).toEqual(['first', 'second', 'third']);
    });
  });

  it('never throws out of spoolWorkerCall — a hook must not fail over buffering', () => {
    // A file where the spool directory belongs makes every write fail.
    try { rmSync(SPOOL_DIR, { recursive: true, force: true }); } catch { /* none */ }
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(SPOOL_DIR, 'not a directory');
    try {
      expect(() => spoolWorkerCall('/api/sessions/observations', 'POST', { a: 1 })).not.toThrow();
      expect(spoolWorkerCall('/api/sessions/observations', 'POST', { a: 1 })).toBe(false);
    } finally {
      if (existsSync(SPOOL_DIR)) rmSync(SPOOL_DIR, { force: true });
    }
  });
});
