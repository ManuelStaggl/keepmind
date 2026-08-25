import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { SessionSearch } from '../../src/services/sqlite/SessionSearch.js';
import { exportBundle } from '../../src/services/portability/export.js';
import { importBundle, restoreBundledSettings } from '../../src/services/portability/import.js';
import { BUNDLE_TABLES, MANIFEST_FILE, type BundleManifest } from '../../src/services/portability/bundle.js';
import { authorCuratedRecord, type AuthoringStore } from '../../src/services/curated/authoring.js';
import { applySupersessions } from '../../src/services/curated/supersession.js';

const PROJECT = 'portabel';
const OTHER = 'anderes-projekt';

let dir: string;
let source: SessionStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'keepmind-bundle-'));
  source = new SessionStore(':memory:');
  seed(source);
});

afterEach(() => {
  source.close();
  rmSync(dir, { recursive: true, force: true });
});

function openSession(store: SessionStore, contentSessionId: string, project: string, prompt: string): string {
  const sessionDbId = store.createSDKSession(contentSessionId, project, prompt);
  const memorySessionId = `mem-${contentSessionId}`;
  store.ensureMemorySessionIdRegistered(sessionDbId, memorySessionId);
  return memorySessionId;
}

function memorySessionFor(store: SessionStore, contentSessionId: string): string {
  const row = store.db.prepare(
    'SELECT memory_session_id FROM sdk_sessions WHERE content_session_id = ?',
  ).get(contentSessionId) as { memory_session_id: string } | undefined;
  return row?.memory_session_id ?? '';
}

/** A store holding one of everything the bundle claims to carry. */
function seed(store: SessionStore): void {
  const memorySessionId = openSession(store, 'content-1', PROJECT, 'Wie halten wir Entscheidungen fest?');
  store.saveUserPrompt('content-1', 1, 'Wie halten wir Entscheidungen fest?');

  store.storeObservation(memorySessionId, PROJECT, {
    type: 'decision', title: 'Beobachteter Eintrag', subtitle: 'vom Beobachter',
    facts: ['ein Fakt'], narrative: 'Der Beobachter hat das aufgezeichnet.',
    concepts: ['Gedächtnis'], files_read: ['a.ts'], files_modified: [],
  });
  store.storeSummary(memorySessionId, PROJECT, {
    request: 'Frage', investigated: 'Untersucht', learned: 'Gelernt',
    completed: 'Fertig', next_steps: 'Weiter', notes: null,
  });

  // Two curated records with a declared, applied supersession, plus an edit —
  // so the bundle carries a validity window that was CLOSED as well as one
  // that is open.
  const s = store as unknown as AuthoringStore;
  authorCuratedRecord(s, {
    title: 'Alte Regel', status: 'gilt', date: '01.08.2026',
    body: '## Entscheidung\n\nSo galt es zuerst.',
  }, { project: PROJECT });
  authorCuratedRecord(s, {
    recordId: '0001', title: 'Alte Regel', status: 'gilt', date: '01.08.2026',
    body: '## Entscheidung\n\nSo galt es zuerst, zweite Fassung.',
  }, { project: PROJECT, expect: 'existing' });
  authorCuratedRecord(s, {
    title: 'Neue Regel', status: 'gilt', date: '20.08.2026',
    relations: [{ relation: 'supersedes', targets: ['0001'] }],
    body: '## Entscheidung\n\nAb jetzt gilt das hier.',
  }, { project: PROJECT });
  applySupersessions(store.db as never, PROJECT);

  store.storeCheckpoint(PROJECT, '# Stand\n\nExport und Import sind gebaut.', { focus: 'weg-b' });

  // A second project, so the project filter has something to leave out.
  store.storeObservation(openSession(store, 'content-2', OTHER, 'anderes Thema'), OTHER, {
    type: 'discovery', title: 'Fremder Eintrag', subtitle: null, facts: [],
    narrative: 'Gehört nicht dazu.', concepts: [], files_read: [], files_modified: [],
  });
}

function exportTo(store: SessionStore, outDir: string, projects: string[] = []): BundleManifest {
  return exportBundle(store.db, {
    outDir, projects, keepmindVersion: '0.0.0-test',
    createdAt: '2026-08-25T00:00:00.000Z',
  }).manifest;
}

/** The logical state a restore has to reproduce, for one project. */
function snapshot(store: SessionStore, project: string) {
  const rows = store.db.prepare(`
    SELECT id, type, title, narrative, subtitle, source_kind, source_path, source_line,
           valid_from, valid_to, metadata, created_at_epoch
      FROM observations WHERE project = ? ORDER BY id
  `).all(project);
  const edges = store.db.prepare(`
    SELECT from_record, to_record, relation, certainty, source_path, source_line
      FROM decision_edges WHERE project = ? ORDER BY from_record, to_record, relation
  `).all(project);
  const summaries = store.db.prepare(
    'SELECT id, request, learned, created_at_epoch FROM session_summaries WHERE project = ? ORDER BY id',
  ).all(project);
  const sessions = store.db.prepare(
    'SELECT id, content_session_id, memory_session_id, project FROM sdk_sessions WHERE project = ? ORDER BY id',
  ).all(project);
  return { rows, edges, summaries, sessions };
}

describe('export → fresh database → import', () => {
  it('reproduces the same logical state, ids and all', () => {
    exportTo(source, dir);

    const target = new SessionStore(':memory:');
    try {
      const report = importBundle(target.db, { bundleDir: dir });
      expect(report.droppedColumns).toEqual({});

      for (const project of [PROJECT, OTHER]) {
        expect(snapshot(target, project)).toEqual(snapshot(source, project));
      }
    } finally {
      target.close();
    }
  });

  it('keeps the validity windows a supersession and an edit closed', () => {
    exportTo(source, dir);
    const target = new SessionStore(':memory:');
    try {
      importBundle(target.db, { bundleDir: dir });

      // 0001 was retired by 0002 and holds two revisions; both facts have to
      // survive, or the restored memory answers with a rule that no longer
      // applies.
      expect(target.getCuratedRecord(PROJECT, '0001')).toBeNull();
      expect(target.getCuratedRevisions(PROJECT, '0001')).toHaveLength(2);
      expect(target.getCuratedRecord(PROJECT, '0002')).not.toBeNull();

      const checkpoints = target.getActiveCheckpoints([PROJECT]);
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0].narrative).toContain('Export und Import sind gebaut.');
    } finally {
      target.close();
    }
  });

  it('finds the same records by keyword search after the restore', () => {
    exportTo(source, dir);
    const target = new SessionStore(':memory:');
    try {
      importBundle(target.db, { bundleDir: dir });

      const ask = (store: SessionStore, query: string) =>
        new SessionSearch(store.db).searchObservations(query, { project: PROJECT, limit: 50 })
          .map(r => r.id).sort((a, b) => a - b);

      // Keyword search is the channel a restore can be held to without a
      // model: vectors are rebuilt from this same text by whatever embedder the
      // target has, so asserting on them here would assert on the embedder.
      for (const query of ['Regel', 'Entscheidung', 'Beobachter']) {
        expect(ask(target, query)).toEqual(ask(source, query));
      }
    } finally {
      target.close();
    }
  });

  it('exports only the projects it was asked for', () => {
    const manifest = exportTo(source, dir, [PROJECT]);
    expect(manifest.projects).toEqual([PROJECT]);

    const target = new SessionStore(':memory:');
    try {
      const report = importBundle(target.db, { bundleDir: dir });
      expect(report.projects).toEqual([PROJECT]);
      expect(snapshot(target, PROJECT)).toEqual(snapshot(source, PROJECT));
      expect(snapshot(target, OTHER).rows).toEqual([]);
    } finally {
      target.close();
    }
  });
});

describe('the bundle is reviewable and checkable', () => {
  it('writes one JSONL file per table plus a manifest with counts and hashes', () => {
    const manifest = exportTo(source, dir);
    expect(manifest.kind).toBe('keepmind-export');
    for (const table of BUNDLE_TABLES) {
      const entry = manifest.tables[table];
      expect(entry).toBeDefined();
      const path = join(dir, entry.file);
      expect(existsSync(path)).toBe(true);
      const lines = readFileSync(path, 'utf8').split('\n').filter(l => l.trim());
      expect(lines).toHaveLength(entry.rows);
      for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    // Vectors are named as absent, with the reason — a bundle has to say what
    // it does NOT contain, or the operator skips the rebuild.
    expect(Object.keys(manifest.excluded)).toContain('vec_documents');
  });

  it('is byte-identical when the same database is exported twice', () => {
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    exportTo(source, a);
    exportTo(source, b);
    for (const table of BUNDLE_TABLES) {
      expect(readFileSync(join(a, `${table}.jsonl`), 'utf8'))
        .toBe(readFileSync(join(b, `${table}.jsonl`), 'utf8'));
    }
  });
});

describe('the importer refuses rather than half-restores', () => {
  it('rejects a file that no longer matches its manifest hash', () => {
    exportTo(source, dir);
    const path = join(dir, 'observations.jsonl');
    writeFileSync(path, `${readFileSync(path, 'utf8')}{"id":9999,"project":"x"}\n`, 'utf8');

    const target = new SessionStore(':memory:');
    try {
      expect(() => importBundle(target.db, { bundleDir: dir })).toThrow(/manifest hash/);
      // Nothing was written: the check runs before the transaction opens.
      const count = target.db.prepare('SELECT COUNT(*) AS c FROM observations').get() as { c: number };
      expect(count.c).toBe(0);
    } finally {
      target.close();
    }
  });

  it('rejects a bundle written by a newer keepmind', () => {
    exportTo(source, dir);
    const path = join(dir, MANIFEST_FILE);
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as BundleManifest;
    manifest.schemaVersion = 999;
    writeFileSync(path, JSON.stringify(manifest), 'utf8');

    const target = new SessionStore(':memory:');
    try {
      expect(() => importBundle(target.db, { bundleDir: dir })).toThrow(/newer than this keepmind/);
    } finally {
      target.close();
    }
  });

  it('rejects a directory that is not a bundle', () => {
    const target = new SessionStore(':memory:');
    try {
      expect(() => importBundle(target.db, { bundleDir: dir })).toThrow(/Not a keepmind bundle/);
    } finally {
      target.close();
    }
  });

  it('refuses to restore over an existing project unless told how', () => {
    exportTo(source, dir);
    const target = new SessionStore(':memory:');
    try {
      importBundle(target.db, { bundleDir: dir });
      expect(() => importBundle(target.db, { bundleDir: dir })).toThrow(/already holds/);

      // --merge keeps what is there and reports every row as already present,
      // rather than overwriting it.
      const merged = importBundle(target.db, { bundleDir: dir, mode: 'merge' });
      expect(merged.inserted.observations ?? 0).toBe(0);
      expect(merged.skipped.observations ?? 0).toBeGreaterThan(0);
      expect(snapshot(target, PROJECT)).toEqual(snapshot(source, PROJECT));
    } finally {
      target.close();
    }
  });

  it('--replace clears the bundled projects first and restores them exactly', () => {
    exportTo(source, dir);
    const target = new SessionStore(':memory:');
    try {
      importBundle(target.db, { bundleDir: dir });
      target.storeObservation(
        memorySessionFor(target, 'content-1'),
        PROJECT,
        { type: 'discovery', title: 'Später dazugekommen', subtitle: null, facts: [], narrative: 'x', concepts: [], files_read: [], files_modified: [] },
      );
      expect(snapshot(target, PROJECT).rows.length).toBeGreaterThan(snapshot(source, PROJECT).rows.length);

      importBundle(target.db, { bundleDir: dir, mode: 'replace' });
      expect(snapshot(target, PROJECT)).toEqual(snapshot(source, PROJECT));
    } finally {
      target.close();
    }
  });

  it('a dry run verifies and writes nothing', () => {
    exportTo(source, dir);
    const target = new SessionStore(':memory:');
    try {
      const report = importBundle(target.db, { bundleDir: dir, dryRun: true });
      expect(report.inserted.observations).toBeGreaterThan(0);
      const count = target.db.prepare('SELECT COUNT(*) AS c FROM observations').get() as { c: number };
      expect(count.c).toBe(0);
    } finally {
      target.close();
    }
  });
});

describe('a row whose parent session is gone is still memory', () => {
  /**
   * Reproduce what the live store actually holds. Measured on the real corpus:
   * 1830 observations and 408 session summaries name a session row that no
   * longer exists — pre-3.x rows SQLite never re-checked. Enforcing the
   * foreign key on the way in rejected the WHOLE 19,032-row bundle with a bare
   * "FOREIGN KEY constraint failed", so the real corpus could not be restored
   * at all.
   */
  function orphanTheSessions(store: SessionStore, contentSessionId: string): void {
    const memorySessionId = memorySessionFor(store, contentSessionId);
    store.db.run('PRAGMA foreign_keys = OFF');
    store.db.prepare('DELETE FROM sdk_sessions WHERE memory_session_id = ?').run(memorySessionId);
    store.db.run('PRAGMA foreign_keys = ON');
  }

  it('restores the row and counts it, rather than refusing the bundle', () => {
    const memorySessionId = memorySessionFor(source, 'content-1');
    const orphaned = (source.db.prepare(
      'SELECT COUNT(*) AS c FROM observations WHERE memory_session_id = ?',
    ).get(memorySessionId) as { c: number }).c;
    expect(orphaned).toBeGreaterThan(0);
    const total = (source.db.prepare('SELECT COUNT(*) AS c FROM observations').get() as { c: number }).c;

    orphanTheSessions(source, 'content-1');

    exportTo(source, dir);
    const target = new SessionStore(':memory:');
    try {
      const report = importBundle(target.db, { bundleDir: dir });
      // Everything is restored — the orphans included, which is the point.
      expect(report.inserted.observations).toBe(total);
      expect(report.dangling.observations).toBe(orphaned);
      expect(report.dangling.session_summaries).toBe(1);
      expect(snapshot(target, PROJECT)).toEqual(snapshot(source, PROJECT));
    } finally {
      target.close();
    }
  });

  it('leaves foreign key enforcement on afterwards', () => {
    exportTo(source, dir);
    const target = new SessionStore(':memory:');
    try {
      importBundle(target.db, { bundleDir: dir });
      const pragma = target.db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
      expect(pragma.foreign_keys).toBe(1);
    } finally {
      target.close();
    }
  });

  it('reports nothing dangling when every parent travelled', () => {
    exportTo(source, dir);
    const target = new SessionStore(':memory:');
    try {
      expect(importBundle(target.db, { bundleDir: dir }).dangling).toEqual({});
    } finally {
      target.close();
    }
  });

  it('does not call a row dangling when the target already holds its parent', () => {
    // Under --merge the parent is often already there. Reporting it as
    // dangling sends an operator looking for damage that does not exist.
    exportTo(source, dir);
    const target = new SessionStore(':memory:');
    try {
      importBundle(target.db, { bundleDir: dir });
      // Second pass: sessions are present in the target, absent from nothing.
      const again = importBundle(target.db, { bundleDir: dir, mode: 'merge' });
      expect(again.dangling).toEqual({});
    } finally {
      target.close();
    }
  });
});

describe('the bundled settings are accounted for, never silently dropped', () => {
  it('carries them but does not apply them unless asked', () => {
    const settingsPath = join(dir, 'source-settings.json');
    writeFileSync(settingsPath, JSON.stringify({ KEEPMIND_PROVIDER: 'claude' }), 'utf8');
    const bundleDir = join(dir, 'bundle');
    const manifest = exportBundle(source.db, {
      outDir: bundleDir, keepmindVersion: '0.0.0-test',
      includeSettings: true, settingsPath,
    }).manifest;
    expect(manifest.settingsFile).toBe('settings.json');

    const target = join(dir, 'target-settings.json');
    writeFileSync(target, JSON.stringify({ KEEPMIND_PROVIDER: 'gemini' }), 'utf8');

    const untouched = restoreBundledSettings(bundleDir, manifest, target, false);
    expect(untouched).toEqual({ present: true, applied: false, targetPath: target });
    expect(JSON.parse(readFileSync(target, 'utf8')).KEEPMIND_PROVIDER).toBe('gemini');

    const applied = restoreBundledSettings(bundleDir, manifest, target, true);
    expect(applied.applied).toBe(true);
    expect(JSON.parse(readFileSync(target, 'utf8')).KEEPMIND_PROVIDER).toBe('claude');
    // Nothing is deleted to make room for something newer.
    expect(JSON.parse(readFileSync(applied.backupPath!, 'utf8')).KEEPMIND_PROVIDER).toBe('gemini');
  });

  it('says so when the bundle has no settings at all', () => {
    const bundleDir = join(dir, 'no-settings');
    const manifest = exportBundle(source.db, {
      outDir: bundleDir, keepmindVersion: '0.0.0-test', includeSettings: false,
    }).manifest;
    expect(manifest.settingsFile).toBeNull();
    expect(restoreBundledSettings(bundleDir, manifest, join(dir, 'x.json'), true))
      .toEqual({ present: false, applied: false });
  });
});
