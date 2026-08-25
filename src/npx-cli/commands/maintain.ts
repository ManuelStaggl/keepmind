// SPDX-License-Identifier: Apache-2.0
//
// `keepmind maintain` — reclaim what the vector store holds and does not need,
// and SHOW that the answers did not move.
//
// A maintenance run has two claims, and the second is the one that is usually
// missing: it got smaller, AND it still says the same thing. Reporting the
// first alone is how a run that shrank a store by losing part of it reads as a
// success. So the searches are asked before and after, over the same route a
// person uses, and the result lists are compared id by id.
//
// The probes are read out of the corpus rather than written down here: the
// titles of records spread across the store, so any install has probes about
// its own content. A fixed list of German phrases would measure nothing on a
// machine whose memory is in English.
//
// The work itself happens in the WORKER, not here. It is the process that has
// vectors.db open, and VACUUM rewrites the whole file — a second connection
// doing it from outside is a lock fight with the process that is actively
// embedding.

import pc from 'picocolors';

export interface MaintainOptions {
  json: boolean;
  project?: string;
  /** How many probe searches to compare before and after. */
  probes: number;
}

export function parseMaintainOptions(args: string[]): MaintainOptions {
  const flag = (name: string): string | undefined => {
    const index = args.indexOf(`--${name}`);
    if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1];
    return args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  };
  const probes = Number(flag('probes'));
  return {
    json: args.includes('--json'),
    project: flag('project'),
    probes: Number.isFinite(probes) && probes > 0 ? Math.min(probes, 50) : 10,
  };
}

function mb(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(2)} MB`;
}

/** Probe queries: titles spread across the store, so they are about real content. */
async function probeQueries(count: number, project?: string): Promise<Array<{ query: string; project: string }>> {
  const { SessionStore } = await import('../../services/sqlite/SessionStore.js');
  const store = new SessionStore() as unknown as {
    db: { prepare: (sql: string) => { all: (...p: unknown[]) => Array<{ title: string | null; project: string | null }> } };
    close?: () => void;
  };
  try {
    const rows = store.db
      .prepare(
        `SELECT title, project FROM observations
          WHERE title IS NOT NULL AND length(title) > 20
            ${project ? 'AND project = ?' : ''}
          ORDER BY id`,
      )
      .all(...(project ? [project] : []));
    if (rows.length === 0) return [];

    const stride = Math.max(1, Math.floor(rows.length / count));
    const out: Array<{ query: string; project: string }> = [];
    for (let i = 0; i < rows.length && out.length < count; i += stride) {
      const row = rows[i];
      if (!row.title || !row.project) continue;
      out.push({ query: row.title, project: row.project });
    }
    return out;
  } finally {
    store.close?.();
  }
}

/** The ids one probe returns, in rank order. */
async function resultIds(
  request: (path: string, init?: Record<string, unknown>) => Promise<{ ok: boolean; json(): Promise<unknown> }>,
  probe: { query: string; project: string },
): Promise<number[] | null> {
  const path =
    `/api/search?query=${encodeURIComponent(probe.query)}` +
    `&project=${encodeURIComponent(probe.project)}&limit=10&format=json`;
  const response = await request(path);
  if (!response.ok) return null;
  const body = (await response.json()) as { observations?: Array<{ id?: number }> };
  return (body.observations ?? []).map(row => Number(row.id)).filter(Number.isFinite);
}

export async function runMaintainCommand(options: MaintainOptions): Promise<void> {
  const { ensureWorkerRunning, workerHttpRequest } = await import('../../shared/worker-utils.js');

  let running = false;
  try {
    running = await ensureWorkerRunning();
  } catch (error) {
    running = false;
    if (!options.json) console.error(pc.red(`  The worker could not be started — ${error instanceof Error ? error.message : error}`));
  }
  if (!running) {
    if (options.json) console.log(JSON.stringify({ success: false, reason: 'the worker could not be started' }, null, 2));
    else console.error(pc.red('  The worker could not be started, so nothing could be maintained.'));
    process.exitCode = 1;
    return;
  }

  const probes = await probeQueries(options.probes, options.project);
  if (!options.json) {
    console.log('');
    console.log(pc.bold('  Vector store maintenance'));
    console.log(pc.dim(`  ${probes.length} probe search(es) taken from the corpus`));
  }

  const before: Array<number[] | null> = [];
  for (const probe of probes) before.push(await resultIds(workerHttpRequest, probe));

  const response = await workerHttpRequest('/api/chroma/compact', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    timeoutMs: 300_000,
  });
  if (!response.ok) {
    if (options.json) console.log(JSON.stringify({ success: false, reason: `the worker replied ${response.status}` }, null, 2));
    else console.error(pc.red(`  The worker replied ${response.status}.`));
    process.exitCode = 1;
    return;
  }

  const result = (await response.json()) as {
    success?: boolean;
    reason?: string;
    bytesBefore?: number;
    bytesAfter?: number;
    rowsBefore?: number;
    rowsAfter?: number;
    compacted?: number;
  };
  if (result.success !== true) {
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.error(pc.red(`  Nothing was maintained — ${result.reason ?? 'no reason given'}`));
    process.exitCode = 1;
    return;
  }

  const after: Array<number[] | null> = [];
  for (const probe of probes) after.push(await resultIds(workerHttpRequest, probe));

  const comparable = probes.map((_, i) => before[i] !== null && after[i] !== null);
  const compared = comparable.filter(Boolean).length;
  const identical = probes.filter((_, i) => comparable[i] && JSON.stringify(before[i]) === JSON.stringify(after[i])).length;

  const bytesBefore = result.bytesBefore ?? 0;
  const bytesAfter = result.bytesAfter ?? 0;
  const rowsHeld = result.rowsBefore === result.rowsAfter;
  const answersHeld = compared > 0 && identical === compared;

  if (options.json) {
    console.log(JSON.stringify({ ...result, probes: probes.length, compared, identical, rowsHeld, answersHeld }, null, 2));
  } else {
    const saved = bytesBefore - bytesAfter;
    console.log('');
    console.log(`  size      ${mb(bytesBefore)} → ${mb(bytesAfter)}   ${saved > 0 ? pc.green(`−${mb(saved)}`) : pc.dim('nothing to reclaim')}`);
    console.log(`  rows      ${result.rowsBefore} → ${result.rowsAfter}   ${rowsHeld ? pc.green('unchanged') : pc.red('CHANGED — a vector was lost')}`);
    if (result.compacted) console.log(pc.dim(`  dropped   ${result.compacted} stored metadata copies the read path never used`));
    console.log(
      `  answers   ${compared === 0 ? pc.yellow('not compared — no probe could be run') : identical === compared ? pc.green(`identical in all ${compared} probe(s)`) : pc.red(`${identical}/${compared} identical — the answers MOVED`)}`,
    );
    console.log('');
  }

  // A run that shrank the store by losing part of it, or that moved the
  // answers, is a failed run however good the number looks.
  if (!rowsHeld || (compared > 0 && !answersHeld)) process.exitCode = 1;
}
