// SPDX-License-Identifier: Apache-2.0
//
// Phase 4 / Step 6 — auto-expiry of stale, unused, low-importance facts.
// Soft by default: sets valid_to + metadata.expired=true (recoverable archive),
// the same window-close mechanism as supersession. Hard DELETE only when
// explicitly enabled. Default OFF.

import type { Database } from '../../storage/db.js';
import { logger } from '../../utils/logger.js';

export interface ExpiryOptions {
  ttlDays: number;
  importanceFloor: number;
  hardDelete: boolean;
  now?: number;
  limit?: number;
}

export interface ExpiryResult {
  candidates: number;
  expired: number;
  mode: 'soft' | 'hard';
}

/**
 * Expire stale observations. Candidates are currently-valid, non-global,
 * below the importance floor, untouched past the TTL, and never recalled
 * (no observation_feedback rows). Bounded by `limit` for the optimizer.
 */
export function expireStaleObservations(db: Database, opts: ExpiryOptions): ExpiryResult {
  const now = opts.now ?? Date.now();
  const ttlMs = opts.ttlDays * 86_400_000;
  const cutoff = now - ttlMs;
  const limit = opts.limit ?? 200;

  // Guard: the bitemporal/last_used columns must exist (added by migration v35/v36).
  const cols = db.query('PRAGMA table_info(observations)').all() as Array<{ name: string }>;
  if (!cols.some(c => c.name === 'valid_to') || !cols.some(c => c.name === 'last_used_at')) {
    return { candidates: 0, expired: 0, mode: opts.hardDelete ? 'hard' : 'soft' };
  }
  const hasFeedback = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observation_feedback'").all() as { name: string }[]).length > 0;
  const feedbackClause = hasFeedback
    ? 'AND id NOT IN (SELECT observation_id FROM observation_feedback)'
    : '';

  const selectSql = `
    SELECT id FROM observations
    WHERE valid_to IS NULL
      AND type != 'global'
      AND COALESCE(importance, 5) < ?
      AND COALESCE(last_used_at, created_at_epoch) < ?
      ${feedbackClause}
    LIMIT ?
  `;
  const ids = (db.prepare(selectSql).all(opts.importanceFloor, cutoff, limit) as { id: number }[]).map(r => r.id);
  if (ids.length === 0) {
    return { candidates: 0, expired: 0, mode: opts.hardDelete ? 'hard' : 'soft' };
  }

  const placeholders = ids.map(() => '?').join(',');
  try {
    if (opts.hardDelete) {
      db.prepare(`DELETE FROM observations WHERE id IN (${placeholders})`).run(...ids);
      logger.info('DB', 'Hard-deleted stale observations', { count: ids.length });
      return { candidates: ids.length, expired: ids.length, mode: 'hard' };
    }
    db.prepare(`
      UPDATE observations
         SET valid_to = ?,
             metadata = json_set(COALESCE(metadata, '{}'), '$.expired', json('true'))
       WHERE id IN (${placeholders})
    `).run(now, ...ids);
    logger.info('DB', 'Soft-expired stale observations (archived via valid_to)', { count: ids.length });
    return { candidates: ids.length, expired: ids.length, mode: 'soft' };
  } catch (error) {
    logger.warn('DB', 'expireStaleObservations failed', {}, error instanceof Error ? error : new Error(String(error)));
    return { candidates: ids.length, expired: 0, mode: opts.hardDelete ? 'hard' : 'soft' };
  }
}
