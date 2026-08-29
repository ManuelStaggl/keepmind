// S22 — the active checkpoint must be findable in an ordinary search.
//
// Measured 29.08.2026 against the running worker (4.4.7). `Nummernkollision`
// occurs verbatim in exactly ONE row of the whole store — the active keepmind
// checkpoint #16021. Keyword-only search ranked it 1 of 1. The unified search
// returned three observations, none of them that one, and filled the rest with
// user prompts reading "ja", "erledigt" and "passt". The six-word query from
// the finding behaved the same way and additionally returned a RETIRED Krossr
// checkpoint while two active ones were missing entirely.
//
// The arithmetic behind it: RRF at k=60 scores a rank-1 sparse hit
// 0.25/61 ≈ 0.0041 and a rank-120 dense hit 0.75/180 ≈ 0.0042, so a unique
// exact keyword match sits below roughly the first 120 semantic neighbours
// before the result limit is even applied.

import { describe, it, expect, beforeEach, afterEach } from '../../bun-test-shim.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SessionSearch } from '../../../src/services/sqlite/SessionSearch.js';
import { SessionStore } from '../../../src/services/sqlite/SessionStore.js';
import { CHECKPOINT_TYPE } from '../../../src/shared/checkpoint.js';

let dir: string;
let store: SessionStore;
let search: SessionSearch;

function writeCheckpoint(project: string, body: string): number {
  return store.storeCheckpoint(project, body).id;
}

describe('S22 — active checkpoints are findable by keyword', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'km-s22-'));
    store = new SessionStore(join(dir, 'keepmind.db'));
    search = new SessionSearch(store.db);
  });

  afterEach(() => {
    try { store.close(); } catch { /* best-effort */ }
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds the active checkpoint by a word only it contains', () => {
    writeCheckpoint('keepmind', 'Die Nummernkollision zwischen S12 und S20 ist behoben.');

    const ids = search.activeCheckpointIdsMatching('Nummernkollision');

    expect(ids.length).toBe(1);
  });

  it('never returns a RETIRED checkpoint', () => {
    const first = writeCheckpoint('keepmind', 'Nummernkollision behoben, erster Stand.');
    const second = writeCheckpoint('keepmind', 'Nummernkollision behoben, zweiter Stand.');

    // storeCheckpoint closes the previous revision for the same project — that
    // is the "exactly one active checkpoint per project" rule.
    const ids = search.activeCheckpointIdsMatching('Nummernkollision');

    expect(ids).toEqual([second]);
    expect(ids).not.toContain(first);
  });

  it('returns nothing when the words are not in any checkpoint', () => {
    writeCheckpoint('keepmind', 'Ein Stand ohne das gesuchte Wort.');

    expect(search.activeCheckpointIdsMatching('Nummernkollision')).toEqual([]);
  });

  it('does not answer with ordinary observations', () => {
    const memorySessionId = store.getOrCreateManualSession('keepmind');
    store.storeObservations(memorySessionId, 'keepmind', [
      {
        type: 'discovery',
        title: 'Nummernkollision im Log',
        subtitle: null,
        facts: [],
        narrative: 'Nummernkollision beobachtet.',
        concepts: [],
        files_read: [],
        files_modified: [],
      },
    ], null, 1, 0);

    const ids = search.activeCheckpointIdsMatching('Nummernkollision');

    expect(ids).toEqual([]);
  });

  it('honours the project filter — a baton belongs to its project', () => {
    const mine = writeCheckpoint('keepmind', 'Nummernkollision behoben.');
    writeCheckpoint('7DTD', 'Nummernkollision auch hier erwähnt.');

    expect(search.activeCheckpointIdsMatching('Nummernkollision', { project: 'keepmind' }))
      .toEqual([mine]);
  });

  it('every row it returns really is an active checkpoint', () => {
    writeCheckpoint('keepmind', 'Nummernkollision behoben.');

    const ids = search.activeCheckpointIdsMatching('Nummernkollision');
    for (const id of ids) {
      const row = store.db.prepare('SELECT type, valid_to FROM observations WHERE id = ?').get(id) as
        { type: string; valid_to: number | null };
      expect(row.type).toBe(CHECKPOINT_TYPE);
      expect(row.valid_to).toBe(null);
    }
  });
});
