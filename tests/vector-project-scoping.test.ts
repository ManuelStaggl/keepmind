// SPDX-License-Identifier: Apache-2.0
//
// Guards project-scoped vector search against the post-filter trap.
//
// queryKnn used to fetch the GLOBAL top-k and drop non-matching projects in JS.
// That made a project-scoped search depend on how the entire corpus ranks:
// measured on a real 18-project store, the global top-32 contained zero rows of
// the requested project for every query tried, and the first matching row sat at
// global rank #55 / #103 / #299. The search returned nothing while the documents
// were present and correctly embedded.
//
// It stayed hidden because the previous embedder spread its distances widely
// enough that the true match dominated globally. Under an embedder that packs
// the neighbourhood into a narrow band, rank inside that band is decided by
// corpus density rather than relevance and the post-filter collapses. So the
// invariant under test is: a project-scoped result must NOT depend on how many
// other-project rows outrank it.
//
// Hand-built vectors, no model: the bug is in filtering and ranking, and a
// 120 MB download would only make this slower and flakier.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync } from 'fs';
import { join } from 'path';
import { SqliteVecManager, type VecChunk } from '../src/services/vector/SqliteVecManager.js';
import { EMBED_DIM } from '../src/services/vector/EmbedderService.js';
import { DATA_DIR } from '../src/shared/paths.js';

/**
 * A unit vector whose similarity to `probe()` falls off with `offset`.
 * Two dimensions are enough to order rows deterministically.
 */
function vectorAt(offset: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  // Keep every angle inside [0, π/2) so cosine similarity is strictly
  // DECREASING in `offset`. Past π it turns around again, which silently makes
  // a larger offset look closer and produces a fixture that tests nothing.
  const angle = (offset * Math.PI) / 4096;
  v[0] = Math.cos(angle);
  v[1] = Math.sin(angle);
  return v;
}

/** The query vector: closest to offset 0, monotonically further as offset grows. */
function probe(): Float32Array {
  return vectorAt(0);
}

function chunk(id: number, project: string, offset: number): VecChunk & { vector: Float32Array } {
  return {
    chunk_key: `${project}_${id}`,
    document: `doc ${id}`,
    sqlite_id: id,
    doc_type: 'observation',
    field_type: 'primary',
    project,
    merged_into_project: null,
    platform_source: 'claude',
    obs_type: 'discovery',
    created_at_epoch: 1_700_000_000,
    metadata: { sqlite_id: id, doc_type: 'observation', project },
    vector: vectorAt(offset),
  };
}

let vec: SqliteVecManager;

/** Insert chunks with predetermined vectors, bypassing the embedder entirely. */
function seed(rows: Array<VecChunk & { vector: Float32Array }>): void {
  const db = vec.load();
  const ins = db.prepare(`
    INSERT INTO vec_documents (
      embedding, sqlite_id, doc_type, obs_type, project,
      merged_into_project, platform_source, created_at_epoch, chunk_key, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const r of rows) {
    ins.run(
      new Uint8Array(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength),
      BigInt(r.sqlite_id),
      r.doc_type,
      r.obs_type ?? '',
      r.project,
      r.merged_into_project ?? '',
      r.platform_source ?? '',
      BigInt(r.created_at_epoch),
      r.chunk_key,
      JSON.stringify(r.metadata),
    );
  }
}

describe('project-scoped vector search', () => {
  beforeEach(() => {
    try { rmSync(join(DATA_DIR, 'vector-db'), { recursive: true, force: true }); } catch { /* ignore */ }
    SqliteVecManager.instance().close();
    vec = SqliteVecManager.instance();
  });

  afterEach(() => {
    try { SqliteVecManager.instance().close(); } catch { /* ignore */ }
  });

  it('finds the target even when hundreds of other-project rows are closer', async () => {
    // 300 rows of a foreign project, all nearer to the probe than anything of
    // the requested project. Under the old post-filter this returned NOTHING,
    // because the global top-k was entirely foreign.
    const rows = [];
    for (let i = 0; i < 300; i++) rows.push(chunk(1000 + i, 'other-project', i));
    rows.push(chunk(42, 'wanted-project', 500));
    rows.push(chunk(43, 'wanted-project', 501));
    seed(rows);

    const result = await vec.queryKnnWithVector(probe(), 5, { project: 'wanted-project' });

    expect(result.ids).toContain(42);
    expect(result.ids[0]).toBe(42); // nearest within the project comes first
    // Nothing foreign may leak through.
    expect(result.ids.every((id) => id === 42 || id === 43)).toBe(true);
  });

  it('still matches rows adopted into the project via merged_into_project', async () => {
    // vec0 cannot OR, so the two columns are queried separately and merged;
    // dropping one would silently lose every adopted worktree row.
    const rows = [chunk(7, 'wanted-project', 10)];
    const adopted = chunk(8, 'origin-project', 5);
    adopted.merged_into_project = 'wanted-project';
    rows.push(adopted);
    seed(rows);

    const result = await vec.queryKnnWithVector(probe(), 5, { project: 'wanted-project' });

    expect(result.ids).toContain(8);
    expect(result.ids).toContain(7);
    // Merged results must be re-sorted by distance, not concatenated blindly.
    expect(result.ids[0]).toBe(8);
  });

  it('returns global neighbours when no project is requested', async () => {
    seed([chunk(1, 'a', 0), chunk(2, 'b', 10), chunk(3, 'c', 20)]);

    const result = await vec.queryKnnWithVector(probe(), 5, {});

    expect(result.ids).toEqual([1, 2, 3]);
  });

  it('applies doc_type alongside the project filter', async () => {
    const wanted = chunk(11, 'wanted-project', 5);
    const other = chunk(12, 'wanted-project', 1);
    other.doc_type = 'user_prompt';
    seed([wanted, other]);

    const result = await vec.queryKnnWithVector(probe(), 5, {
      project: 'wanted-project',
      doc_type: 'observation',
    });

    expect(result.ids).toEqual([11]);
  });
});
