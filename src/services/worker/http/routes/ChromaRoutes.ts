
import express, { Request, Response } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { SqliteVecManager } from '../../../vector/SqliteVecManager.js';
import { EmbedderService } from '../../../vector/EmbedderService.js';
import { SettingsDefaultsManager } from '../../../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../../../shared/paths.js';

// Status endpoint for the in-process vector store (sqlite-vec + transformers.js).
// Kept at the historical /api/chroma/status path so existing health probes
// (worker-service dispatch list, dashboards) keep working after the chroma-mcp
// subprocess was removed.
export class ChromaRoutes extends BaseRouteHandler {
  /**
   * Optional so the status endpoint keeps working without it. Only the
   * backfill endpoint needs the worker's live sync instance.
   */
  constructor(private dbManager?: { getChromaSync(): { ensureBackfilled(project?: string): Promise<void> } | null }) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.get('/api/chroma/status', this.handleGetStatus.bind(this));
    app.post('/api/chroma/backfill', this.handleBackfill.bind(this));
    app.post('/api/chroma/compact', this.handleCompact.bind(this));
  }

  /**
   * Reclaim what the vector store holds and does not need.
   *
   * IT RUNS HERE RATHER THAN IN THE CLI because the worker is the process that
   * has `vectors.db` open. VACUUM rewrites the whole file and wants no other
   * transaction; a second connection doing it from outside is a lock fight with
   * the process that is actively embedding. The same reason `MaintenanceLoop`
   * owns the periodic version — this endpoint is the on-demand one, for someone
   * who wants to see the number rather than wait a day for it.
   *
   * The row count is reported before AND after for one reason: it is the claim
   * that nothing was lost, and a maintenance run that shrinks a store by losing
   * part of it is the failure this whole endpoint has to be able to rule out.
   */
  private handleCompact = this.wrapHandler(async (_req: Request, res: Response): Promise<void> => {
    const vec = SqliteVecManager.instance();
    try {
      vec.load();
    } catch (error) {
      // Not an error: vector search can be off, or the native module missing.
      // A silent 200 here would read as "nothing to reclaim".
      res.json({ success: false, reason: `the vector store is not available — ${error instanceof Error ? error.message : error}` });
      return;
    }

    const bytesBefore = vec.fileSizeBytes();
    const rowsBefore = vec.countRows();

    const compacted = vec.compactStoredMetadata();
    vec.maintain({ vacuum: true });

    const bytesAfter = vec.fileSizeBytes();
    const rowsAfter = vec.countRows();

    res.json({
      success: true,
      bytesBefore,
      bytesAfter,
      rowsBefore,
      rowsAfter,
      compacted,
    });
  });

  /**
   * Index rows that were written straight to SQLite.
   *
   * The curated importer is a separate process that writes rows itself — it
   * never enqueues anything, which is the guarantee that keeps a curated
   * record away from a model. The cost is that nothing tells the worker new
   * rows exist, so their embeddings only appeared at the next periodic
   * backfill. Until then semantic search returned nothing for them and
   * reported no error: measured right after an import, the vector and worker
   * eval channels scored 0% while the keyword channel scored 75%.
   *
   * Backfill is watermark-driven and idempotent, so asking for it early costs
   * an early pass and nothing else.
   */
  private handleBackfill = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const project = typeof req.body?.project === 'string' ? req.body.project.trim() : '';
    if (!project) {
      res.status(400).json({ success: false, error: 'project is required' });
      return;
    }

    const sync = this.dbManager?.getChromaSync();
    if (!sync) {
      // Not an error: vector search can be off, or the store failed to load.
      // Saying so is the point — a silent 200 here would look like the rows
      // were indexed.
      res.json({ success: false, project, indexed: false, reason: 'vector sync unavailable' });
      return;
    }

    try {
      await sync.ensureBackfilled(project);
      res.json({ success: true, project, indexed: true });
    } catch (error) {
      res.status(500).json({ success: false, project, indexed: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  private handleGetStatus = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
    const vectorEnabled = settings.KEEPMIND_CHROMA_ENABLED !== 'false';

    const deepRaw = req.query.deep;
    const deepEnabled = deepRaw !== undefined && deepRaw !== 'false' && deepRaw !== '0';

    if (!vectorEnabled) {
      res.json({
        status: 'disabled',
        connected: false,
        timestamp: new Date().toISOString(),
        details: 'Vector search is disabled via KEEPMIND_CHROMA_ENABLED=false',
        deep: deepEnabled,
      });
      return;
    }

    const vec = SqliteVecManager.instance();
    let loaded = vec.isLoaded();
    let vecVersion = vec.getVecVersion();
    let loadError: string | undefined;
    if (!loaded) {
      try {
        vec.load();
        loaded = true;
        vecVersion = vec.getVecVersion();
      } catch (error) {
        loadError = error instanceof Error ? error.message : String(error);
      }
    }

    if (!deepEnabled) {
      res.json({
        status: loaded ? 'healthy' : 'unhealthy',
        connected: loaded,
        timestamp: new Date().toISOString(),
        details: loaded
          ? `in-process vector store ready (sqlite-vec ${vecVersion})`
          : `sqlite-vec failed to load: ${loadError ?? 'unknown error'}`,
        deep: false,
        backend: 'sqlite-vec',
        vec_version: vecVersion,
      });
      return;
    }

    // Deep probe: exercise an actual embed round-trip.
    const startedAt = Date.now();
    let probeOk = false;
    let probeError: string | undefined;
    try {
      const v = await EmbedderService.instance().embedOne('ping');
      probeOk = v.length === 384;
      if (!probeOk) probeError = `unexpected embedding length ${v.length}`;
    } catch (error) {
      probeError = error instanceof Error ? error.message : String(error);
    }
    const queryLatencyMs = Date.now() - startedAt;

    res.json({
      status: loaded && probeOk ? 'healthy' : 'unhealthy',
      connected: loaded,
      timestamp: new Date().toISOString(),
      details: probeOk
        ? 'in-process embed + sqlite-vec round-trip succeeded'
        : `deep probe failed: ${probeError ?? 'unknown error'}`,
      deep: true,
      backend: 'sqlite-vec',
      vec_version: vecVersion,
      probe: { ok: probeOk, queryLatencyMs, embedderWarm: EmbedderService.instance().isWarm(), error: probeError },
    });
  });
}
