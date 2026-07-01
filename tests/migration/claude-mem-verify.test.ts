import { describe, it, expect } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { performMigration } from '../../src/npx-cli/commands/migrate.js';
import { verifyMigrated } from '../../src/services/migration/claude-mem-migration.js';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { Database } from '../../src/storage/db.js';

/**
 * The content-hash anti-join is the gate that authorises destructive removal of
 * ~/.claude-mem. These tests exercise it against real SQLite databases. The
 * target DB is keepmind's `DB_PATH`, which the test preload pins to a per-run
 * temp dir — so `performMigration` never touches a real data directory.
 */

/** Build a source claude-mem.db with observations carrying the given hashes. */
function makeSourceDb(hashes: (string | null)[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'cm-src-'));
  const dbPath = join(dir, 'claude-mem.db');
  new SessionStore(dbPath).close(); // create keepmind-compatible schema

  const db = new Database(dbPath);
  try {
    db.exec('PRAGMA foreign_keys=OFF'); // minimal fixture: observations without a parent sdk_session
    const stmt = db.prepare(`
      INSERT INTO observations
        (memory_session_id, project, text, type, title, prompt_number, discovery_tokens, created_at, created_at_epoch, content_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    let i = 0;
    for (const hash of hashes) {
      const epoch = 1782900000000 + i;
      stmt.run(`sess-${hash}`, 'MigrationTestProj', 'body', 'bugfix', `Title ${i}`, 1, 0, new Date(epoch).toISOString(), epoch, hash);
      i++;
    }
  } finally {
    db.close();
  }
  return dbPath;
}

describe('verifyMigrated (content-hash anti-join)', () => {
  it('reports 0 missing after a source is migrated into keepmind', async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const src = makeSourceDb([`hA-${stamp}`, `hB-${stamp}`]);

    const result = await performMigration(src, {});
    expect(result.mode === 'adopt' || result.mode === 'merge').toBe(true);

    const v = verifyMigrated(src);
    expect(v.total).toBe(2);
    expect(v.missing).toBe(0);
  });

  it('reports missing observations for a source that was never migrated', () => {
    const uniq = `NEVER-MIGRATED-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const src = makeSourceDb([uniq]);

    const v = verifyMigrated(src);
    expect(v.total).toBe(1);
    expect(v.missing).toBe(1);
  });

  it('counts hashless legacy rows as unhashable, never as missing (does not block purge)', () => {
    const src = makeSourceDb([null, null]);
    const v = verifyMigrated(src);
    expect(v.total).toBe(2);
    expect(v.missing).toBe(0);
    expect(v.unhashable).toBe(2);
  });

  it('reports 0 missing when the source database does not exist', () => {
    const v = verifyMigrated(join(tmpdir(), 'does-not-exist-claude-mem.db'));
    expect(v).toEqual({ missing: 0, total: 0, unhashable: 0 });
  });
});
