// SPDX-License-Identifier: Apache-2.0
//
// Phase 4 / Step 7 — low-priority background maintenance loop in the shared
// worker. Idle-gated, unref'd timer, ONE bounded job per tick (round-robin), all
// jobs wrapped in try/catch. It only *schedules* already-built Step 1–6 ops, so
// it adds no new data semantics. Behind memoryQuality.optimizer.enabled.

import type { SessionStore } from '../sqlite/SessionStore.js';
import type { MemoryQualityConfig } from '../config/memory-quality.js';
import { logger } from '../../utils/logger.js';
import { expireStaleObservations } from '../expiry/expiry.js';
import { redactSecrets, redactSecretsDeep } from '../redaction/redact-secrets.js';

const RETRO_SCRUB_SENTINEL = 9001; // schema_versions marker: retro-scrub complete
const MIN_IDLE_MS = 30_000;

export interface MaintenanceDeps {
  getStore: () => SessionStore;
  activeSessions: () => number;
  getConfig: () => MemoryQualityConfig;
  /** epoch of last observed worker activity (acquire/release/observation). */
  lastActivity?: () => number;
}

export class MaintenanceLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private jobIndex = 0;
  private lastVacuum = 0;
  private retroScrubDone = false;

  constructor(private deps: MaintenanceDeps) {}

  start(): void {
    const cfg = this.deps.getConfig().optimizer;
    if (!cfg.enabled) {
      logger.debug('SYSTEM', 'MaintenanceLoop disabled by config');
      return;
    }
    const tickMs = Math.max(1, cfg.tickMinutes) * 60_000;
    this.timer = setInterval(() => { void this.tick(); }, tickMs);
    // Never keep the process alive — the idle-shutdown lifecycle owns liveness.
    (this.timer as { unref?: () => void }).unref?.();
    logger.info('SYSTEM', 'MaintenanceLoop started', { tickMinutes: cfg.tickMinutes, vacuumHours: cfg.vacuumHours });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Idle-gated single-job tick. Public for tests. */
  async tick(): Promise<void> {
    if (this.busy) return;
    if (this.deps.activeSessions() > 0) return;
    if (this.deps.lastActivity && Date.now() - this.deps.lastActivity() < MIN_IDLE_MS) return;

    this.busy = true;
    try {
      const jobs = [
        () => this.jobExpire(),
        () => this.jobRetroScrub(),
        () => this.jobWalCheckpoint(),
        () => this.jobVacuum(),
      ];
      const job = jobs[this.jobIndex % jobs.length];
      this.jobIndex++;
      await job();
    } catch (error) {
      logger.warn('SYSTEM', 'MaintenanceLoop tick failed', {}, error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.busy = false;
    }
  }

  private jobExpire(): void {
    const cfg = this.deps.getConfig();
    if (!cfg.expiry.enabled) return;
    const store = this.deps.getStore();
    expireStaleObservations(store.db, {
      ttlDays: cfg.expiry.ttlDays,
      importanceFloor: cfg.expiry.importanceFloor,
      hardDelete: cfg.expiry.hardDelete,
      limit: 200,
    });
  }

  // One-time backfill: redact historical rows written before Step 1 shipped.
  private jobRetroScrub(): void {
    if (this.retroScrubDone) return;
    const store = this.deps.getStore();
    try {
      const done = store.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(RETRO_SCRUB_SENTINEL);
      if (done) { this.retroScrubDone = true; return; }

      const rows = store.db.prepare(`
        SELECT id, title, subtitle, narrative, facts
        FROM observations
        WHERE COALESCE(json_extract(metadata, '$.scrubbed'), 0) = 0
        ORDER BY id
        LIMIT 200
      `).all() as Array<{ id: number; title: string | null; subtitle: string | null; narrative: string | null; facts: string | null }>;

      if (rows.length === 0) {
        store.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(RETRO_SCRUB_SENTINEL, new Date().toISOString());
        this.retroScrubDone = true;
        logger.info('SYSTEM', 'MaintenanceLoop retro-scrub complete');
        return;
      }

      const upd = store.db.prepare(`
        UPDATE observations
           SET title = ?, subtitle = ?, narrative = ?, facts = ?,
               metadata = json_set(COALESCE(metadata, '{}'), '$.scrubbed', json('true'))
         WHERE id = ?
      `);
      const tx = store.db.transaction(() => {
        for (const r of rows) {
          let facts = r.facts;
          try {
            if (typeof r.facts === 'string') facts = JSON.stringify(redactSecretsDeep(JSON.parse(r.facts)));
          } catch { /* leave facts as-is */ }
          upd.run(redactSecrets(r.title), redactSecrets(r.subtitle), redactSecrets(r.narrative), facts, r.id);
        }
      });
      tx();
      logger.info('SYSTEM', 'MaintenanceLoop retro-scrubbed historical rows', { count: rows.length });
    } catch (error) {
      logger.warn('SYSTEM', 'MaintenanceLoop retro-scrub failed', {}, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private jobWalCheckpoint(): void {
    try {
      this.deps.getStore().db.run('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (error) {
      logger.debug('SYSTEM', 'wal_checkpoint failed', {}, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private jobVacuum(): void {
    const vacuumHours = this.deps.getConfig().optimizer.vacuumHours;
    const now = Date.now();
    if (now - this.lastVacuum < vacuumHours * 3_600_000) return;
    this.lastVacuum = now;
    try {
      this.deps.getStore().db.run('VACUUM');
      logger.info('SYSTEM', 'MaintenanceLoop VACUUM complete');
    } catch (error) {
      logger.debug('SYSTEM', 'VACUUM failed', {}, error instanceof Error ? error : new Error(String(error)));
    }
  }
}
