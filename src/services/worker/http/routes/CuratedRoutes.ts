// SPDX-License-Identifier: Apache-2.0
//
// Worker routes for lasting entries authored inside keepmind.
//
// These exist so the entries can be written and CHANGED from a session, which
// is the whole point of the file-free way of working: a decision reached in a
// conversation should be recorded where it will be read, at the moment it is
// made, without a detour through a file that then has to be imported.
//
// The write path is `authorCuratedRecord`, the same one the CLI uses, and it
// talks to plain storage only — nothing here enqueues an observation, so
// nothing here can reach a model. What comes in as text is stored as text.

import express, { Request, Response } from 'express';
import { z } from 'zod';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { validateBody } from '../middleware/validateBody.js';
import { logger } from '../../../../utils/logger.js';
import {
  authorCuratedRecord, draftFromRecordText, setField, setRelations,
  RELATION_NAMES, type AuthoringStore, type CuratedDraft, type DeclaredRelation,
} from '../../../curated/authoring.js';
import type { RelationName } from '../../../curated/relation-lexicon.js';
import type { DatabaseManager } from '../../DatabaseManager.js';
import { curatedKindOfId } from '../../../curated/record-key.js';
import { curatedRelationsOf } from '../../../curated/relations.js';

const relationSchema = z.object({
  relation: z.string().refine(r => (RELATION_NAMES as string[]).includes(r), {
    message: `relation must be one of ${RELATION_NAMES.join(', ')}`,
  }),
  targets: z.array(z.string().trim().min(1)).min(1),
});

const fieldSchema = z.object({ name: z.string().trim().min(1), value: z.string() });

const addSchema = z.object({
  project: z.string().optional(),
  recordId: z.string().trim().optional(),
  title: z.string().trim().min(1),
  status: z.string().optional(),
  date: z.string().optional(),
  decidedBy: z.string().optional(),
  summary: z.string().optional(),
  fields: z.array(fieldSchema).optional(),
  relations: z.array(relationSchema).optional(),
  body: z.string().optional(),
  validFrom: z.number().optional(),
  validTo: z.number().optional(),
  dryRun: z.boolean().optional(),
}).strict();

const editSchema = z.object({
  project: z.string().optional(),
  recordId: z.string().trim().min(1),
  title: z.string().optional(),
  status: z.string().optional(),
  date: z.string().optional(),
  decidedBy: z.string().optional(),
  summary: z.string().optional(),
  fields: z.array(fieldSchema).optional(),
  // Present-but-empty CLEARS the relations; absent leaves them alone. The two
  // must stay distinguishable, or an edit of the title would silently drop
  // every relation the record declares.
  relations: z.array(relationSchema).optional(),
  body: z.string().optional(),
  validFrom: z.number().optional(),
  validTo: z.number().optional(),
  dryRun: z.boolean().optional(),
}).strict();

const supersedeSchema = z.object({
  project: z.string().optional(),
  recordId: z.string().trim().min(1),
  supersedes: z.string().trim().min(1),
}).strict();

const closeSchema = z.object({
  project: z.string().optional(),
  recordId: z.string().trim().min(1),
  reason: z.string().optional(),
}).strict();

const getSchema = z.object({
  project: z.string().optional(),
  recordId: z.string().trim().min(1),
  revisions: z.boolean().optional(),
}).strict();

const ensureIndexedSchema = z.object({
  project: z.string().optional(),
}).strict();

export class CuratedRoutes extends BaseRouteHandler {
  constructor(
    private dbManager: DatabaseManager,
    private defaultProject: string,
  ) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.post('/api/curated/add', validateBody(addSchema), this.handleAdd.bind(this));
    app.post('/api/curated/edit', validateBody(editSchema), this.handleEdit.bind(this));
    app.post('/api/curated/supersede', validateBody(supersedeSchema), this.handleSupersede.bind(this));
    app.post('/api/curated/close', validateBody(closeSchema), this.handleClose.bind(this));
    app.post('/api/curated/get', validateBody(getSchema), this.handleGet.bind(this));
    app.post('/api/curated/ensure-indexed', validateBody(ensureIndexedSchema), this.handleEnsureIndexed.bind(this));
  }

  private resolveProject(explicit?: string): string {
    const trimmed = typeof explicit === 'string' && explicit.trim() ? explicit.trim() : undefined;
    return trimmed || this.defaultProject;
  }

  private store(): AuthoringStore {
    return this.dbManager.getSessionStore() as unknown as AuthoringStore;
  }

  /**
   * Index what was just written.
   *
   * The route writes rows directly and enqueues nothing, so nothing else tells
   * the vector sync they exist. Best-effort and never fatal: the record is
   * stored either way, and the response says which of the two happened rather
   * than reporting success for both.
   */
  private async index(project: string): Promise<{ indexed: boolean; reason?: string }> {
    const sync = this.dbManager.getChromaSync();
    if (!sync) return { indexed: false, reason: 'vector sync unavailable' };
    try {
      await sync.ensureBackfilled(project);
      return { indexed: true };
    } catch (error) {
      return { indexed: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  private handleAdd = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const body = req.body as z.infer<typeof addSchema>;
    const project = this.resolveProject(body.project);
    try {
      const result = authorCuratedRecord(this.store(), toDraft(body), {
        project,
        dryRun: body.dryRun === true,
        expect: body.recordId ? 'new' : undefined,
      });
      const indexed = body.dryRun ? null : await this.index(project);
      logger.info('HTTP', 'Curated record added', { project, recordId: result.recordId, id: result.id });
      res.json({ success: true, project, ...result, indexed });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  private handleEdit = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const body = req.body as z.infer<typeof editSchema>;
    const project = this.resolveProject(body.project);
    const store = this.dbManager.getSessionStore();

    // Rebuild from the STORED TEXT, then apply only what the caller named.
    // Anything the caller did not mention survives untouched — including header
    // labels this route has no field for.
    const existing = store.getCuratedRecord(project, body.recordId, { includeClosed: true });
    if (!existing) {
      res.status(404).json({ success: false, error: `No record ${body.recordId} in project "${project}".` });
      return;
    }

    const draft = draftFromRecordText(
      body.recordId,
      stripRecordPrefix(existing.title, body.recordId),
      existing.narrative ?? '',
    );
    if (body.title !== undefined) draft.title = body.title;
    if (body.status !== undefined) setField(draft, 'Stand', body.status);
    if (body.date !== undefined) setField(draft, 'Datum', body.date);
    if (body.decidedBy !== undefined) setField(draft, 'Entschieden von', body.decidedBy);
    if (body.summary !== undefined) setField(draft, 'Kurz', body.summary);
    for (const field of body.fields ?? []) setField(draft, field.name, field.value);
    if (body.relations !== undefined) setRelations(draft, body.relations as DeclaredRelation[]);
    if (body.body !== undefined) draft.body = body.body;
    if (body.validFrom !== undefined) draft.validFrom = body.validFrom;
    if (body.validTo !== undefined) draft.validTo = body.validTo;

    try {
      const result = authorCuratedRecord(this.store(), draft, {
        project, dryRun: body.dryRun === true, expect: 'existing',
      });
      const indexed = body.dryRun ? null : await this.index(project);
      logger.info('HTTP', 'Curated record edited in place', {
        project, recordId: result.recordId, id: result.id, revisionsClosed: result.revisionsClosed,
      });
      res.json({ success: true, project, ...result, indexed });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  private handleSupersede = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const { recordId, supersedes, project: raw } = req.body as z.infer<typeof supersedeSchema>;
    const project = this.resolveProject(raw);
    const store = this.dbManager.getSessionStore();

    const successor = store.getCuratedRecord(project, recordId);
    if (!successor) {
      res.status(404).json({ success: false, error: `No active record ${recordId} in project "${project}".` });
      return;
    }
    if (!store.getCuratedRecord(project, supersedes)) {
      // A supersession pointing at nothing retires nothing, and the report
      // would say a record had been replaced when it does not exist.
      res.status(404).json({ success: false, error: `No active record ${supersedes} in project "${project}".` });
      return;
    }

    const draft = draftFromRecordText(recordId, stripRecordPrefix(successor.title, recordId), successor.narrative ?? '');
    // Only an existing SUPERSESSION blocks this. `schränkt 0001 ein` and
    // `löst 0001 ab` are different statements about the same pair, and the
    // graph is built to hold both.
    if (store.getEdges(project).some(e => e.from_record === recordId && e.to_record === supersedes && e.relation === 'supersedes')) {
      res.status(409).json({
        success: false,
        error: `${recordId} already declares that it supersedes ${supersedes}. Declaring it twice would put two citations in the graph for one statement.`,
      });
      return;
    }
    draft.relations = [{ relation: 'supersedes' as RelationName, targets: [supersedes] }];

    try {
      const result = authorCuratedRecord(this.store(), draft, { project, expect: 'existing' });
      const { applySupersessions } = await import('../../../curated/supersession.js');
      const report = applySupersessions(store.db as never, project);
      const indexed = await this.index(project);
      logger.info('HTTP', 'Curated supersession declared and applied', {
        project, recordId, supersedes, closed: report.closed.length,
      });
      res.json({ success: true, project, ...result, supersession: report, indexed });
    } catch (error) {
      res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  private handleClose = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const { recordId, reason, project: raw } = req.body as z.infer<typeof closeSchema>;
    const project = this.resolveProject(raw);
    const result = this.dbManager.getSessionStore().closeCuratedRecord(project, recordId, { reason: reason ?? null });
    if (result.closed === 0) {
      res.status(404).json({ success: false, error: `No active record ${recordId} in project "${project}".` });
      return;
    }
    logger.info('HTTP', 'Curated record closed', { project, recordId, ...result });
    res.json({ success: true, project, recordId, ...result });
  });

  private handleGet = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const { recordId, revisions, project: raw } = req.body as z.infer<typeof getSchema>;
    const project = this.resolveProject(raw);
    const store = this.dbManager.getSessionStore();
    const current = store.getCuratedRecord(project, recordId);
    // A retired entry is not a missing one, and the difference is the whole
    // promise the curated path rests on: nothing is deleted, a superseded or
    // closed entry keeps its text and stays searchable, it just stops counting
    // as current. `getCuratedRecord` filters to the active revision, so this
    // route answered "No record 0064" about a record that exists, still reads,
    // and was retired for a reason recorded right there — and the caller's next
    // move on that answer is to write a new entry under a number already taken,
    // or to conclude the decision was never made.
    //
    // It matters here more than anywhere else: `supersedes` edges point at
    // retired entries BY CONSTRUCTION, so a relation graph you cannot follow to
    // the far end is half built.
    const retired = current ? null : store.getCuratedRecord(project, recordId, { includeClosed: true });
    const entry = current ?? retired;
    const all = revisions ? store.getCuratedRevisions(project, recordId) : undefined;
    if (!entry && (!all || all.length === 0)) {
      res.status(404).json({ success: false, error: `No record ${recordId} in project "${project}".` });
      return;
    }
    // Relations are not behind a flag, and that is the whole point. The
    // direction a reader cannot know to ask for is the INCOMING one: arriving
    // at 0090 you have no reason to suspect that 0138 replaced it, and a
    // retired record that does not say so reads as current. A flag would put
    // the burden of suspicion back on the reader.
    const relations = curatedRelationsOf(store as never, project, recordId);

    // `kind` at the top level, not buried in the metadata blob: a decision and
    // an open work item read almost identically as text, and a caller that
    // cannot tell them apart will answer "what did we decide" with open tasks.
    res.json({
      success: true,
      project,
      recordId,
      kind: entry?.kind ?? curatedKindOfId(recordId) ?? 'akte',
      // Stated, not left to be inferred from a null. Why it was retired is not
      // repeated here: an entry replaced by another says so through its own
      // incoming `superseded by` relation below, and one closed by hand carries
      // its reason in its metadata. Restating either would be a second source
      // for the same fact.
      status: current ? 'current' : 'retired',
      entry,
      current,
      retiredAt: entry?.valid_to ?? null,
      revisions: all,
      relations,
    });
  });

  /**
   * "Is every curated record in this project actually findable?" — and make it
   * so if it is not.
   *
   * The one endpoint a writer can call to turn its own success claim into a
   * verified one. It lives in the worker because the worker owns the vector
   * store and the watermarks: a CLI process that lowered a watermark on its own
   * would be overwritten by the worker's cached copy, so the repair has to
   * happen where the cache lives.
   *
   * Answers with the truth in both directions. `indexed: false` plus the count
   * that is missing is a usable answer; a 200 with no detail would not be.
   */
  private handleEnsureIndexed = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const body = req.body as z.infer<typeof ensureIndexedSchema>;
    const project = this.resolveProject(body.project);
    const sync = this.dbManager.getChromaSync();
    if (!sync) {
      res.json({ success: true, project, indexed: false, total: 0, missing: 0, reason: 'vector search is unavailable in this worker' });
      return;
    }

    const store = this.dbManager.getSessionStore();
    const ids = store.curatedObservationIds(project);
    try {
      const result = await sync.ensureObservationsIndexed(project, ids);
      logger.info('HTTP', 'Curated index check', {
        project, total: result.total, missing: result.missing.length, repaired: result.repaired,
      });
      res.json({
        success: true,
        project,
        indexed: result.indexed,
        total: result.total,
        missing: result.missing.length,
        missingSample: result.missing.slice(0, 10),
        repaired: result.repaired,
        reason: result.indexed ? undefined : `${result.missing.length} of ${result.total} curated row(s) have no vector`,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn('HTTP', 'Curated index check failed', { project, reason });
      res.json({ success: true, project, indexed: false, total: ids.length, missing: ids.length, reason });
    }
  });
}

/** Stored titles are `0068 — Title`; the draft carries the title alone. */
function stripRecordPrefix(title: string | null, recordId: string): string {
  return (title ?? '').replace(new RegExp(`^${recordId}\\s*[—–-]\\s*`), '');
}

function toDraft(body: z.infer<typeof addSchema>): CuratedDraft {
  return {
    recordId: body.recordId,
    title: body.title,
    status: body.status,
    date: body.date,
    decidedBy: body.decidedBy,
    summary: body.summary,
    fields: body.fields,
    relations: body.relations as DeclaredRelation[] | undefined,
    body: body.body,
    validFrom: body.validFrom,
    validTo: body.validTo,
  };
}
