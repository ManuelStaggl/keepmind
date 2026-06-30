
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
  setupRoutes(app: express.Application): void {
    app.get('/api/chroma/status', this.handleGetStatus.bind(this));
  }

  private handleGetStatus = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
    const vectorEnabled = settings.CLAUDE_MEM_CHROMA_ENABLED !== 'false';

    const deepRaw = req.query.deep;
    const deepEnabled = deepRaw !== undefined && deepRaw !== 'false' && deepRaw !== '0';

    if (!vectorEnabled) {
      res.json({
        status: 'disabled',
        connected: false,
        timestamp: new Date().toISOString(),
        details: 'Vector search is disabled via CLAUDE_MEM_CHROMA_ENABLED=false',
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
