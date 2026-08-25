// SPDX-License-Identifier: Apache-2.0
//
// How many lasting entries this machine actually holds, per project.
//
// WHY THIS EXISTS. keepmind runs on machines that stand in three different
// relationships to a curated corpus, and until now it could only tell two of
// them apart:
//
//   • the machine that HAS the corpus and its source files;
//   • the machine that has neither, and should never hear about either;
//   • the machine that has the RECORDS but not the files they came from —
//     a development machine, a restored `keepmind import`, a corpus on a drive
//     that is not mounted right now, or one whose files simply are not there
//     yet.
//
// The third was read as the first and reported as a broken configuration: two
// required failures and the sentence "semantic search cannot see these
// records", about 333 records semantic search could see perfectly well. The
// difference between "detached" and "broken" is not in the state file — a state
// file only knows what the last RUN did — it is in whether the store holds
// anything. So it has to be counted.
//
// Read-only, one indexed count, and a failure answers `null` rather than zero:
// zero would say "this machine has no corpus", which is the loudest wrong
// answer available here.

import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolveOpenDbPath } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';

/**
 * Curated row counts by project, or null when the store could not be read.
 *
 * Null is not an error to report — a machine with no database yet is a normal
 * first-run state. It means "cannot say", and every caller has to treat that
 * differently from "none".
 */
export function readCuratedRecordCounts(dbPath: string = resolveOpenDbPath()): Map<string, number> | null {
  if (!existsSync(dbPath)) return null;

  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const rows = db.prepare(`
      SELECT project, COUNT(*) AS n
        FROM observations
       WHERE source_kind = 'curated' AND project IS NOT NULL AND project != ''
       GROUP BY project
    `).all() as Array<{ project: string; n: number }>;
    return new Map(rows.map(row => [String(row.project), Number(row.n)]));
  } catch (error) {
    logger.debug('DB', 'Curated record counts could not be read', {},
      error instanceof Error ? error : undefined);
    return null;
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}
