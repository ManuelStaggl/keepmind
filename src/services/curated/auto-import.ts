// SPDX-License-Identifier: Apache-2.0
//
// The curated corpus keeps itself up to date.
//
// WHY THIS EXISTS. Until now something outside keepmind had to remember to run
// `curated:import` — a scheduled script, or a person. Both forget quietly. The
// last gap lasted four days and was found by accident, and for those four days
// every answer keepmind gave about the corpus was confidently out of date.
// Nothing about that failure was visible from inside a session, which is where
// the answers were being used.
//
// Two triggers, because they fail differently:
//
//   • ON START — the worker comes up (which the first hook of every session
//     does) and compares the sources against the last successful import. This
//     is the one that catches a change made while nothing was running, and a
//     previous import that failed.
//   • ON CHANGE — a watcher on the source directories. This is the one that
//     makes an edit findable within seconds instead of at the next session.
//
// Neither trigger is allowed to run two imports at once. The importer is
// idempotent by replacing what a file previously produced, and two overlapping
// runs would each be replacing the other's rows.
//
// It never deletes and never rewrites a record's text: it runs exactly the
// import a person would have run, and stamps what happened where the session
// start and `keepmind doctor` can read it.

import { realpathSync, watch, type FSWatcher } from 'node:fs';
import { logger } from '../../utils/logger.js';
import { DATA_DIR } from '../../shared/paths.js';
import { runCuratedImport, type CuratedImportReport } from './import-run.js';
import { loadCuratedProject, loadCuratedSources, missingSources, sourcesByProject, type CuratedSource } from './sources.js';
import { importIsStale, readImportState, stampSources, writeImportState } from './import-state.js';

export type ImportTrigger = 'startup' | 'file-change' | 'requested';

export interface CuratedStore {
  db: unknown;
  curatedObservationIds(project: string): number[];
  curatedProjects(): string[];
}

export interface CuratedIndexer {
  ensureObservationsIndexed(
    project: string,
    ids: number[],
  ): Promise<{ indexed: boolean; total: number; missing: number[]; repaired: boolean }>;
}

export interface AutoImportHost {
  /** The store the worker already has open, or null while it is not ready. */
  store(): CuratedStore | null;
  /** The worker's vector sync, or null when vector search is unavailable here. */
  indexer(): CuratedIndexer | null;
}

export interface AutoImportOutcome {
  project: string;
  trigger: ImportTrigger;
  ran: boolean;
  /** Why it did not run, when it did not. */
  skipped?: string;
  report?: CuratedImportReport;
  indexed?: boolean;
  indexReason?: string;
}

function debounceMs(): number {
  const raw = Number(process.env.KEEPMIND_CURATED_WATCH_DEBOUNCE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 3_000;
}

function watchingEnabled(): boolean {
  return process.env.KEEPMIND_CURATED_WATCH !== 'false';
}

export class CuratedAutoImport {
  private watchers: FSWatcher[] = [];
  private timer: NodeJS.Timeout | null = null;
  /** The run in flight. Everything queues behind it. */
  private running: Promise<unknown> = Promise.resolve();
  private inFlight = false;
  /** A change that arrived while a run was in flight, so the run repeats. */
  private rerunRequested = false;
  private stopped = false;

  /**
   * `dataDir` is where the import stamp lives. It is a parameter so a test can
   * point a whole importer at a scratch directory without reaching into module
   * state that is frozen at load time.
   */
  constructor(
    private readonly host: AutoImportHost,
    private readonly dataDir: string = DATA_DIR,
  ) {}

  /**
   * Check freshness once, then watch. Returns after the startup check so a
   * caller can log its outcome; the watchers keep running until stop().
   */
  async start(): Promise<AutoImportOutcome[]> {
    const outcomes = await this.runIfStale('startup');
    if (watchingEnabled()) this.installWatchers();
    return outcomes;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    for (const watcher of this.watchers) {
      try { watcher.close(); } catch { /* already gone */ }
    }
    this.watchers = [];
  }

  /** Import every project whose sources have moved since its last success. */
  async runIfStale(trigger: ImportTrigger): Promise<AutoImportOutcome[]> {
    const configured = loadCuratedSources(this.dataDir);
    if (configured.rejected.length > 0) {
      for (const item of configured.rejected) {
        logger.warn('DB', 'Curated source rejected — not imported', { entry: item.entry, reason: item.reason });
      }
    }
    if (configured.sources.length === 0) return [];

    const store = this.host.store();
    const fallback = this.resolveFallbackProject(store);
    if (!fallback) {
      // Not guessed. Filing a whole corpus under the wrong project hides it
      // from every project-filtered read, and the mistake looks exactly like an
      // import that never ran. Same rule as the source `kind`: declared, or not
      // done at all.
      const reason = 'no project to import into — set "KEEPMIND_CURATED_PROJECT" in ~/.keepmind/settings.json, '
        + 'or give each entry in "curatedSources" its own "project"';
      logger.warn('DB', 'Curated auto-import skipped', { reason });
      return [{ project: '(unknown)', trigger, ran: false, skipped: reason }];
    }
    const grouped = sourcesByProject(configured.sources, fallback);

    const outcomes: AutoImportOutcome[] = [];
    for (const [project, sources] of grouped) {
      const verdict = importIsStale(readImportState(project, this.dataDir), stampSources(sources));
      if (!verdict.stale) {
        outcomes.push({ project, trigger, ran: false, skipped: 'up to date' });
        continue;
      }
      logger.info('DB', 'Curated sources are ahead of the store — importing', { project, trigger, reason: verdict.reason });
      outcomes.push(await this.runNow(project, sources, trigger));
    }
    return outcomes;
  }

  /**
   * Where sources that name no project are filed.
   *
   * Configuration first. Failing that, the store itself: if exactly one project
   * already holds curated rows, that is where this corpus has always gone — an
   * observed fact, not a guess. Several such projects, or none, and the
   * question genuinely needs an answer from the operator.
   */
  private resolveFallbackProject(store: CuratedStore | null): string | null {
    const configured = loadCuratedProject(this.dataDir);
    if (configured) return configured;
    if (!store) return null;
    try {
      const existing = store.curatedProjects();
      if (existing.length === 1) {
        logger.info('DB', 'Curated auto-import filing under the only project that holds curated rows', { project: existing[0] });
        return existing[0];
      }
      if (existing.length > 1) {
        logger.warn('DB', 'Several projects hold curated rows — which one an unattended import writes to must be configured', { projects: existing });
      }
    } catch {
      /* an unreadable store is reported by the caller's skip message */
    }
    return null;
  }

  /**
   * Run one import, queued behind whatever is already running.
   *
   * The queue is a promise chain rather than a lock that rejects: a caller that
   * asked for an import wants one to have happened when it returns, and a
   * rejected lock would turn a busy moment into a skipped update.
   */
  runNow(project: string, sources: CuratedSource[], trigger: ImportTrigger): Promise<AutoImportOutcome> {
    const next = this.running.then(() => this.execute(project, sources, trigger));
    // Keep the chain alive even when a run rejects, or every later import would
    // inherit the failure.
    this.running = next.catch(() => undefined);
    return next;
  }

  private async execute(project: string, sources: CuratedSource[], trigger: ImportTrigger): Promise<AutoImportOutcome> {
    const store = this.host.store();
    if (!store) return { project, trigger, ran: false, skipped: 'the store is not open' };

    const absent = missingSources(sources);
    if (absent.length > 0) {
      // A configured directory that is not there is a broken configuration, not
      // an empty corpus. Importing the rest would silently retire every record
      // the missing directory holds.
      const reason = `source director(y|ies) missing: ${absent.map(s => s.path).join(', ')}`;
      logger.warn('DB', 'Curated import skipped — configured sources are missing', { project, absent: absent.map(s => s.path) });
      this.stamp(project, sources, null, false, reason);
      return { project, trigger, ran: false, skipped: reason };
    }

    this.inFlight = true;
    const nowEpoch = Date.now();
    try {
      const report = await runCuratedImport(store, sources, { project, nowEpoch });

      let indexed = false;
      let indexReason: string | undefined;
      const indexer = this.host.indexer();
      if (!indexer) {
        indexReason = 'vector search is unavailable in this worker';
      } else {
        try {
          const result = await indexer.ensureObservationsIndexed(project, store.curatedObservationIds(project));
          indexed = result.indexed;
          if (!indexed) indexReason = `${result.missing.length} of ${result.total} curated row(s) have no vector`;
        } catch (error) {
          indexReason = error instanceof Error ? error.message : String(error);
        }
      }

      const failure = report.failedTotal > 0
        ? `${report.failedTotal} file(s) failed to import`
        : indexed ? null : `not indexed — ${indexReason ?? 'unknown reason'}`;

      this.stamp(project, sources, report, indexed, failure);

      if (failure) {
        logger.warn('DB', 'Curated import finished with a problem', { project, trigger, failure, records: report.records });
      } else {
        logger.info('DB', 'Curated import complete', {
          project, trigger, records: report.records, edges: report.edges, indexed: true,
        });
      }
      return { project, trigger, ran: true, report, indexed, indexReason };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('DB', 'Curated import failed', { project, trigger }, error instanceof Error ? error : undefined);
      this.stamp(project, sources, null, false, message);
      return { project, trigger, ran: false, skipped: message };
    } finally {
      this.inFlight = false;
    }
  }

  /**
   * Record the run. Only a clean run may move the source fingerprint: stamping
   * after a failure would mark the sources as covered by an import that did not
   * cover them, and every later freshness check would then stay quiet.
   */
  private stamp(
    project: string,
    sources: CuratedSource[],
    report: CuratedImportReport | null,
    indexed: boolean,
    failure: string | null,
  ): void {
    const previous = readImportState(project, this.dataDir);
    const now = Date.now();
    const success = failure === null && report !== null && indexed;
    writeImportState({
      project,
      lastAttemptEpoch: now,
      lastSuccessEpoch: success ? now : previous?.lastSuccessEpoch ?? null,
      records: success ? report.records : previous?.records ?? 0,
      edges: success ? report.edges : previous?.edges ?? 0,
      indexed,
      failure,
      sources: success ? stampSources(sources) : previous?.sources ?? [],
    }, this.dataDir);
  }

  private installWatchers(): void {
    const configured = loadCuratedSources(this.dataDir);
    for (const source of configured.sources) {
      try {
        // Watch the path the OS itself uses. On Windows a recursive watch whose
        // directory argument is a short (8.3) or differently-cased form of the
        // real path trips an assertion INSIDE libuv — `!_wcsnicmp(filename,
        // dir, dirlen)` in fs-event.c — which aborts the process outright. It
        // is not an exception and cannot be caught, so a source directory
        // reached through `C:\Users\ADMINI~1\…` would kill the worker rather
        // than fail to watch. Canonicalising first is the whole fix.
        const target = realpathSync.native(source.path);
        const watcher = watch(target, { recursive: true, persistent: false }, () => this.onChange());
        watcher.on('error', error => {
          logger.warn('DB', 'Curated source watcher failed — changes there will only be picked up at the next session start',
            { path: source.path }, error instanceof Error ? error : undefined);
        });
        this.watchers.push(watcher);
      } catch (error) {
        // A watcher that cannot be installed degrades to the startup check,
        // which is a slower answer rather than a wrong one.
        logger.warn('DB', 'Could not watch a curated source directory', { path: source.path },
          error instanceof Error ? error : undefined);
      }
    }
    if (this.watchers.length > 0) {
      logger.info('DB', 'Watching curated sources for changes', { directories: this.watchers.length, debounceMs: debounceMs() });
    }
  }

  /**
   * A file moved. Wait for the burst to end before importing — an editor saving
   * one file emits several events, and a person editing a corpus emits many.
   */
  private onChange(): void {
    if (this.stopped) return;
    if (this.inFlight) {
      // Re-check AFTER the current run: it may have read the file mid-write.
      this.rerunRequested = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runIfStale('file-change')
        .then(() => {
          if (!this.rerunRequested) return;
          this.rerunRequested = false;
          return this.runIfStale('file-change');
        })
        .catch(error => {
          logger.warn('DB', 'Curated auto-import after a file change failed', {},
            error instanceof Error ? error : undefined);
        });
    }, debounceMs());
    // The timer must not hold the worker open on its own.
    this.timer.unref?.();
  }
}
