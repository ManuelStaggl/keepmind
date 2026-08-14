
import express, { Request, Response } from 'express';
import { z } from 'zod';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { validateBody } from '../middleware/validateBody.js';
import { logger } from '../../../../utils/logger.js';
import type { DatabaseManager } from '../../DatabaseManager.js';

const saveMemorySchema = z.object({
  text: z.string().trim().min(1),
  title: z.string().optional(),
  project: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const deleteByProjectSchema = z.object({
  project: z.string().trim().min(1),
  confirm: z.boolean().optional(),
  dryRun: z.boolean().optional(),
}).strict();

export class MemoryRoutes extends BaseRouteHandler {
  constructor(
    private dbManager: DatabaseManager,
    private defaultProject: string
  ) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.post('/api/memory/save', validateBody(saveMemorySchema), this.handleSaveMemory.bind(this));
    app.post('/api/memory/delete-by-project', validateBody(deleteByProjectSchema), this.handleDeleteByProject.bind(this));
  }

  private handleDeleteByProject = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const { project, confirm, dryRun } = req.body as z.infer<typeof deleteByProjectSchema>;
    const sessionStore = this.dbManager.getSessionStore();

    // A non-dryRun delete requires explicit confirm:true (irreversible).
    if (!dryRun && confirm !== true) {
      res.status(400).json({ success: false, error: 'Refusing to delete without confirm:true (or pass dryRun:true to preview counts).' });
      return;
    }

    try {
      const result = sessionStore.deleteObservationsByProject(project, { dryRun: dryRun === true });

      // Vectors live in their own database, so deleting the rows leaves every
      // embedding behind — pointing at ids that no longer exist. Measured
      // after two delete-and-reimport cycles: 459 orphaned vectors for one
      // project and not a single live row with an embedding, because the
      // orphans still answered the KNN query and hydrating their ids produced
      // nothing. Semantic search for that project went silently blind while
      // reporting no error at all.
      //
      // Retention already knows how to drop a project's vectors; it was simply
      // never asked to here.
      let vectorsDeleted = 0;
      if (!dryRun) {
        try {
          const { SqliteVecManager } = await import('../../../vector/SqliteVecManager.js');
          vectorsDeleted = SqliteVecManager.instance().deleteByProject(project);
        } catch (error) {
          // Reported, not fatal: the rows are already gone, and a delete that
          // half-succeeded must say so rather than claim success.
          logger.warn('HTTP', 'delete-by-project: vectors could not be removed', { project }, error instanceof Error ? error : undefined);
        }
      }

      const payload = { ...result, vectorsDeleted };
      logger.info('HTTP', 'delete-by-project', payload);
      res.json({ success: true, ...payload });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  private handleSaveMemory = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const { text, title, project, metadata } = req.body as z.infer<typeof saveMemorySchema>;
    const explicitProject = typeof project === 'string' && project.trim()
      ? project.trim()
      : undefined;
    const metadataProject = typeof metadata?.project === 'string' && metadata.project.trim()
      ? metadata.project.trim()
      : undefined;
    const targetProject = explicitProject || metadataProject || this.defaultProject;

    const sessionStore = this.dbManager.getSessionStore();
    const chromaSync = this.dbManager.getChromaSync();

    const memorySessionId = sessionStore.getOrCreateManualSession(targetProject);

    const observation = {
      type: 'discovery',  // Use existing valid type
      title: title || text.substring(0, 60).trim() + (text.length > 60 ? '...' : ''),
      subtitle: 'Manual memory',
      facts: [] as string[],
      narrative: text,
      concepts: [] as string[],
      files_read: [] as string[],
      files_modified: [] as string[],
      metadata: metadata ? JSON.stringify(metadata) : null,
    };

    const result = sessionStore.storeObservation(
      memorySessionId,
      targetProject,
      observation,
      0,  // promptNumber
      0   
    );

    logger.info('HTTP', 'Manual observation saved', {
      id: result.id,
      project: targetProject,
      title: observation.title
    });

    if (!chromaSync) {
      logger.debug('CHROMA', 'ChromaDB sync skipped (chromaSync not available)', { id: result.id });
      res.json({
        success: true,
        id: result.id,
        title: observation.title,
        project: targetProject,
        message: `Memory saved as observation #${result.id}`
      });
      return;
    }
    chromaSync.syncObservation(
      result.id,
      memorySessionId,
      targetProject,
      observation,
      0,
      result.createdAtEpoch
    ).catch(err => {
      logger.error('CHROMA', 'ChromaDB sync failed', { id: result.id }, err as Error);
    });

    res.json({
      success: true,
      id: result.id,
      title: observation.title,
      project: targetProject,
      message: `Memory saved as observation #${result.id}`
    });
  });
}
