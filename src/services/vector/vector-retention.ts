// SPDX-License-Identifier: Apache-2.0
//
// Inactivity-based retention for the vector index (D1).
//
// Nothing ever aged out. One measured install still carried vectors for
// projects last touched in May — Adobe Acrobat, surface-app, doppelmayr-hyper-v,
// a dozen more — months after the work ended, in a 275 MB vector store. They
// cost disk, they cost embedding time on every backfill sweep, and they dilute
// every semantic search with results from work nobody is doing any more.
//
// Retention here is deliberately limited to the VECTOR index, not the
// observations themselves. Evicting a vector is reversible: the SQLite row is
// untouched, keyword/FTS search still finds it, and the moment the project
// becomes active again the normal backfill re-embeds it from scratch (the
// watermark is derived from what is in the vec store, so an emptied project
// re-indexes automatically). Deleting observations is not reversible, so it
// stays behind the existing opt-in expiry feature.

import type { Database } from '../../storage/db.js';
import { logger } from '../../utils/logger.js';

export interface VectorRetentionOptions {
  inactiveDays: number;
  now?: number;
  /** Max projects to evict in one pass, so a tick stays bounded. */
  limit?: number;
}

export interface VectorRetentionResult {
  evictedProjects: string[];
  vectorRowsRemoved: number;
}

/**
 * Most recent activity for a project, as an epoch. Uses the newest of
 * created_at_epoch and last_used_at: a project nobody has written to in months
 * is still active if its memories are being retrieved.
 */
export function lastActivityByProject(db: Database): Map<string, number> {
  const rows = db.prepare(`
    SELECT project,
           MAX(MAX(COALESCE(created_at_epoch, 0)), MAX(COALESCE(last_used_at, 0))) AS last_activity
      FROM observations
     WHERE project IS NOT NULL
     GROUP BY project
  `).all() as Array<{ project: string; last_activity: number }>;

  const out = new Map<string, number>();
  for (const row of rows) {
    out.set(row.project, Number(row.last_activity) || 0);
  }
  return out;
}

/**
 * True when a project has had no write and no retrieval inside the window.
 *
 * A project with no observations at all reads as inactive — there is nothing to
 * keep vectors for.
 */
export function isProjectInactive(
  activity: Map<string, number>,
  project: string,
  inactiveDays: number,
  now: number = Date.now(),
): boolean {
  const last = activity.get(project);
  if (last === undefined || last === 0) return true;
  return now - last > inactiveDays * 86_400_000;
}

/**
 * Evict vectors for projects that have been inactive past the window.
 *
 * Best-effort per project: one failing eviction must not abort the rest.
 */
export function evictInactiveProjectVectors(
  db: Database,
  vec: { listProjects(): string[]; deleteByProject(project: string): number },
  opts: VectorRetentionOptions,
): VectorRetentionResult {
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? 5;
  const result: VectorRetentionResult = { evictedProjects: [], vectorRowsRemoved: 0 };

  const activity = lastActivityByProject(db);

  for (const project of vec.listProjects()) {
    if (result.evictedProjects.length >= limit) break;
    if (!isProjectInactive(activity, project, opts.inactiveDays, now)) continue;

    try {
      const removed = vec.deleteByProject(project);
      if (removed > 0) {
        result.evictedProjects.push(project);
        result.vectorRowsRemoved += removed;
      }
    } catch (error) {
      logger.warn('VEC', 'Vector retention could not evict a project', {
        project,
      }, error instanceof Error ? error : new Error(String(error)));
    }
  }

  if (result.evictedProjects.length > 0) {
    logger.info('VEC', 'Evicted vectors for inactive projects (SQLite rows kept; re-embedded on next use)', {
      projects: result.evictedProjects,
      vectorRowsRemoved: result.vectorRowsRemoved,
      inactiveDays: opts.inactiveDays,
    });
  }
  return result;
}
