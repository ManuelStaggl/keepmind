// SPDX-License-Identifier: Apache-2.0
//
// VectorSync — per-tenant sync/query facade over the in-process vector store
// (sqlite-vec + transformers.js). Drop-in replacement for the former ChromaSync
// (which proxied an out-of-process chroma-mcp/uvx subprocess). The chunkers
// (formatObservationDocs/formatSummaryDocs/formatUserPromptDoc), the watermark
// bump logic, and the backfill pipeline are storage-agnostic and ported
// verbatim; only the storage backend calls changed:
//   ensureCollectionExists → SqliteVecManager.load()
//   addDocuments           → SqliteVecManager.addChunks() (embed + vec0 upsert)
//   queryChroma            → SqliteVecManager.queryKnn() (+ where-filter translate)
//   getExistingChromaIds / bootstrapWatermarksFromChroma → vec MAX(sqlite_id)
//   updateMergedIntoProject → vec UPDATE
//
// The public surface (method names + return shapes) is preserved so
// SearchManager / SearchOrchestrator / the search strategies / WorktreeAdoption
// keep compiling and working unchanged. `ChromaSync.ts` re-exports this as
// `ChromaSync` for the remaining type/value importers.

import { ChromaSyncState, ProjectWatermarks } from './ChromaSyncState.js';
import { ParsedObservation, ParsedSummary } from '../../sdk/parser.js';
import { SessionStore as SessionStoreImpl } from '../sqlite/SessionStore.js';
import { logger } from '../../utils/logger.js';
import { normalizePlatformSource } from '../../shared/platform-source.js';
import * as SqliteFilesModule from '../sqlite/observations/files.js';

type SessionStoreType = InstanceType<typeof SessionStoreImpl>;
import { SqliteVecManager, type VecChunk, type VecFilter } from '../vector/SqliteVecManager.js';

type SessionStore = SessionStoreType;
type SessionStoreCtor = new () => SessionStoreType;

// These were previously loaded via a runtime createRequire() of their relative
// paths. In the esbuild bundle that resolves against the on-disk bundle location
// (plugin/scripts/worker-service.cjs), where the modules do not exist — so every
// startup backfill died with "Cannot find module '../sqlite/SessionStore.js'".
// Static imports let esbuild bundle them; there is no import cycle back here.
function loadSessionStoreCtor(): SessionStoreCtor {
  return SessionStoreImpl as unknown as SessionStoreCtor;
}

function loadFilesHelper(): typeof SqliteFilesModule {
  return SqliteFilesModule;
}

/** A storage-agnostic document chunk (id + text + metadata bag). */
export interface ChromaDocument {
  id: string;
  document: string;
  metadata: Record<string, string | number>;
}

interface StoredObservation {
  id: number;
  memory_session_id: string;
  project: string;
  merged_into_project: string | null;
  platform_source?: string | null;
  text: string | null;
  type: string;
  title: string | null;
  subtitle: string | null;
  facts: string | null;
  narrative: string | null;
  concepts: string | null;
  files_read: string | null;
  files_modified: string | null;
  prompt_number: number;
  created_at_epoch: number;
}

interface StoredSummary {
  id: number;
  memory_session_id: string;
  project: string;
  merged_into_project: string | null;
  platform_source?: string | null;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  notes: string | null;
  prompt_number: number;
  created_at_epoch: number;
}

interface StoredUserPrompt {
  id: number;
  content_session_id: string;
  prompt_number: number;
  prompt_text: string;
  created_at_epoch: number;
  memory_session_id: string;
  project: string;
  platform_source: string;
}

/** Translate a Chroma mongo-style where-filter (built by SearchManager) into a flat VecFilter. */
function translateWhere(where?: Record<string, any>): VecFilter {
  const f: VecFilter = {};
  const visit = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node.$and)) { node.$and.forEach(visit); return; }
    if (Array.isArray(node.$or)) {
      // The only $or SearchManager emits is {project | merged_into_project}.
      const proj = node.$or.find((o: any) => o && o.project)?.project
        ?? node.$or.find((o: any) => o && o.merged_into_project)?.merged_into_project;
      if (proj) f.project = proj;
      return;
    }
    if (node.doc_type) f.doc_type = node.doc_type;
    if (node.type) f.obs_type = node.type;            // SearchManager uses {type} for obs_type
    if (node.platform_source) f.platform_source = node.platform_source;
    if (node.project) f.project = node.project;
    if (node.merged_into_project && !f.project) f.project = node.merged_into_project;
  };
  visit(where);
  return f;
}

export class VectorSync {
  private project: string;
  private collectionName: string;
  private readonly BATCH_SIZE = 100;
  private readonly vec = SqliteVecManager.instance();

  constructor(project: string) {
    this.project = project;
    const sanitized = project
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/[^a-zA-Z0-9]+$/, '');
    this.collectionName = `cm__${sanitized || 'unknown'}`;
  }

  public getCollectionName(): string {
    return this.collectionName;
  }

  /** Idempotent: ensure the vec store is loaded (schema created on first call). */
  public async ensureCollectionExists(): Promise<void> {
    this.vec.load();
  }

  private chunkFromDoc(doc: ChromaDocument): VecChunk {
    const m = doc.metadata as Record<string, any>;
    return {
      chunk_key: doc.id,
      document: doc.document,
      sqlite_id: Number(m.sqlite_id),
      doc_type: String(m.doc_type),
      field_type: m.field_type != null ? String(m.field_type) : null,
      project: String(m.project ?? ''),
      merged_into_project: m.merged_into_project != null ? String(m.merged_into_project) : null,
      platform_source: m.platform_source != null ? String(m.platform_source) : null,
      obs_type: m.type != null ? String(m.type) : null,
      created_at_epoch: Number(m.created_at_epoch ?? 0),
      metadata: doc.metadata,
    };
  }

  private formatObservationDocs(obs: StoredObservation): ChromaDocument[] {
    const documents: ChromaDocument[] = [];

    const facts = obs.facts ? JSON.parse(obs.facts) : [];
    const concepts = obs.concepts ? JSON.parse(obs.concepts) : [];
    const filesHelper = loadFilesHelper();
    const files_read = filesHelper.parseFileList(obs.files_read);
    const files_modified = filesHelper.parseFileList(obs.files_modified);

    const baseMetadata: Record<string, string | number | null> = {
      sqlite_id: obs.id,
      doc_type: 'observation',
      memory_session_id: obs.memory_session_id,
      project: obs.project,
      merged_into_project: obs.merged_into_project ?? null,
      platform_source: obs.platform_source
        ? normalizePlatformSource(obs.platform_source)
        : normalizePlatformSource(undefined),
      created_at_epoch: obs.created_at_epoch,
      type: obs.type || 'discovery',
      title: obs.title || 'Untitled'
    };

    if (obs.subtitle) baseMetadata.subtitle = obs.subtitle;
    if (concepts.length > 0) baseMetadata.concepts = concepts.join(',');
    if (files_read.length > 0) baseMetadata.files_read = files_read.join(',');
    if (files_modified.length > 0) baseMetadata.files_modified = files_modified.join(',');

    // R1 (perf plan): collapse the former 5.4-vectors/item chunking (one doc per
    // narrative/text + one per fact) down to ≤2 docs/item. The search read path
    // already dedupes results by `${doc_type}:${sqlite_id}` (SqliteVecManager
    // .queryKnn), so per-field/per-fact rows never surfaced independently —
    // they only inflated vectors.db. One "primary" doc (title + subtitle +
    // narrative + text, the human-readable gist) and one "facts" doc (all facts
    // joined) preserve recall on both the prose and the atomic-fact signal while
    // cutting stored vectors ~2.7×.
    const primaryText = [obs.title, obs.subtitle, obs.narrative, obs.text]
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      .join('\n\n');
    if (primaryText) {
      documents.push({ id: `obs_${obs.id}_primary`, document: primaryText, metadata: { ...baseMetadata, field_type: 'primary' } });
    }
    const factsText = facts
      .filter((f: unknown): f is string => typeof f === 'string' && f.trim().length > 0)
      .join('\n');
    if (factsText) {
      documents.push({ id: `obs_${obs.id}_facts`, document: factsText, metadata: { ...baseMetadata, field_type: 'facts' } });
    }

    return documents;
  }

  private formatSummaryDocs(summary: StoredSummary): ChromaDocument[] {
    const documents: ChromaDocument[] = [];

    const baseMetadata: Record<string, string | number | null> = {
      sqlite_id: summary.id,
      doc_type: 'session_summary',
      memory_session_id: summary.memory_session_id,
      project: summary.project,
      merged_into_project: summary.merged_into_project ?? null,
      platform_source: summary.platform_source
        ? normalizePlatformSource(summary.platform_source)
        : normalizePlatformSource(undefined),
      created_at_epoch: summary.created_at_epoch,
      prompt_number: summary.prompt_number || 0
    };

    // R1 (perf plan): collapse the former 6-docs/summary chunking into ≤2 docs.
    // "context" = what the session was about + what was found (request +
    // investigated + learned); "outcome" = what changed and what's next
    // (completed + next_steps + notes). Result dedupe by `${doc_type}:${sqlite_id}`
    // means these never surfaced separately anyway.
    const contextText = [summary.request, summary.investigated, summary.learned]
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      .join('\n\n');
    if (contextText) {
      documents.push({ id: `summary_${summary.id}_context`, document: contextText, metadata: { ...baseMetadata, field_type: 'context' } });
    }
    const outcomeText = [summary.completed, summary.next_steps, summary.notes]
      .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
      .join('\n\n');
    if (outcomeText) {
      documents.push({ id: `summary_${summary.id}_outcome`, document: outcomeText, metadata: { ...baseMetadata, field_type: 'outcome' } });
    }

    return documents;
  }

  private formatUserPromptDoc(prompt: StoredUserPrompt): ChromaDocument {
    return {
      id: `prompt_${prompt.id}`,
      document: prompt.prompt_text,
      metadata: {
        sqlite_id: prompt.id,
        doc_type: 'user_prompt',
        memory_session_id: prompt.memory_session_id,
        project: prompt.project,
        platform_source: prompt.platform_source,
        created_at_epoch: prompt.created_at_epoch,
        prompt_number: prompt.prompt_number
      }
    };
  }

  /**
   * Embed and upsert `documents` into the vec store in BATCH_SIZE batches.
   * Returns the number successfully written. Per-batch failures are logged and
   * tolerated (the loop continues) so callers can advance their watermark only
   * on a full write.
   */
  public async addDocuments(documents: ChromaDocument[]): Promise<number> {
    if (documents.length === 0) return 0;
    this.vec.load();

    let written = 0;
    for (let i = 0; i < documents.length; i += this.BATCH_SIZE) {
      const batch = documents.slice(i, i + this.BATCH_SIZE);
      try {
        const n = await this.vec.addChunks(batch.map((d) => this.chunkFromDoc(d)));
        written += n;
      } catch (error) {
        logger.error('VECTOR_SYNC', 'Batch embed/insert failed — watermark will not advance for this batch', {
          collection: this.collectionName,
          batchStart: i,
          batchSize: batch.length
        }, error as Error);
      }
      // Yield to the event loop after each embed batch so the worker's HTTP
      // server (especially /health) stays responsive during large backfills.
      // Local embedding is CPU-bound; back-to-back batches otherwise starve the
      // loop and health checks time out — which surfaced as "worker unreachable"
      // hook failures during the big post-migration first-boot backfill.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    logger.debug('VECTOR_SYNC', 'Documents added', { collection: this.collectionName, requested: documents.length, written });
    return written;
  }

  async syncObservation(
    observationId: number,
    memorySessionId: string,
    project: string,
    obs: ParsedObservation,
    promptNumber: number,
    createdAtEpoch: number,
    platformSource?: string
  ): Promise<void> {
    const stored: StoredObservation = {
      id: observationId,
      memory_session_id: memorySessionId,
      project,
      merged_into_project: null,
      platform_source: platformSource ? normalizePlatformSource(platformSource) : normalizePlatformSource(undefined),
      text: null,
      type: obs.type,
      title: obs.title,
      subtitle: obs.subtitle,
      facts: JSON.stringify(obs.facts),
      narrative: obs.narrative,
      concepts: JSON.stringify(obs.concepts),
      files_read: JSON.stringify(obs.files_read),
      files_modified: JSON.stringify(obs.files_modified),
      prompt_number: promptNumber,
      created_at_epoch: createdAtEpoch
    };

    const documents = this.formatObservationDocs(stored);
    logger.info('VECTOR_SYNC', 'Syncing observation', { observationId, documentCount: documents.length, project });

    const written = await this.addDocuments(documents);
    if (written === documents.length) {
      ChromaSyncState.bump(project, 'observations', observationId);
    } else {
      logger.warn('VECTOR_SYNC', 'Observation watermark bump skipped — partial write', { observationId, project, requested: documents.length, written });
    }
  }

  async syncSummary(
    summaryId: number,
    memorySessionId: string,
    project: string,
    summary: ParsedSummary,
    promptNumber: number,
    createdAtEpoch: number,
    platformSource?: string
  ): Promise<void> {
    const stored: StoredSummary = {
      id: summaryId,
      memory_session_id: memorySessionId,
      project,
      merged_into_project: null,
      platform_source: platformSource ? normalizePlatformSource(platformSource) : normalizePlatformSource(undefined),
      request: summary.request,
      investigated: summary.investigated,
      learned: summary.learned,
      completed: summary.completed,
      next_steps: summary.next_steps,
      notes: summary.notes,
      prompt_number: promptNumber,
      created_at_epoch: createdAtEpoch
    };

    const documents = this.formatSummaryDocs(stored);
    logger.info('VECTOR_SYNC', 'Syncing summary', { summaryId, documentCount: documents.length, project });

    const written = await this.addDocuments(documents);
    if (written === documents.length) {
      ChromaSyncState.bump(project, 'summaries', summaryId);
    } else {
      logger.warn('VECTOR_SYNC', 'Summary watermark bump skipped — partial write', { summaryId, project, requested: documents.length, written });
    }
  }

  async syncUserPrompt(
    promptId: number,
    memorySessionId: string,
    project: string,
    promptText: string,
    promptNumber: number,
    createdAtEpoch: number,
    platformSource?: string
  ): Promise<void> {
    const stored: StoredUserPrompt = {
      id: promptId,
      content_session_id: '',
      prompt_number: promptNumber,
      prompt_text: promptText,
      created_at_epoch: createdAtEpoch,
      memory_session_id: memorySessionId,
      project,
      platform_source: normalizePlatformSource(platformSource)
    };

    const document = this.formatUserPromptDoc(stored);
    logger.info('VECTOR_SYNC', 'Syncing user prompt', { promptId, project });

    const written = await this.addDocuments([document]);
    if (written === 1) {
      ChromaSyncState.bump(project, 'prompts', promptId);
    } else {
      logger.warn('VECTOR_SYNC', 'Prompt watermark bump skipped — write failed', { promptId, project, written });
    }
  }

  async bootstrapWatermarksFromChroma(project: string): Promise<void> {
    this.vec.load();
    const max = this.vec.getMaxIdsByDocType(project);
    ChromaSyncState.replace(project, {
      observations: max.observations,
      summaries: max.summaries,
      prompts: max.prompts
    });
    logger.info('VECTOR_SYNC', 'Bootstrapped watermarks from vec store', { project, watermarks: ChromaSyncState.get(project) });
  }

  async ensureBackfilled(projectOverride?: string, storeOverride?: SessionStore): Promise<void> {
    const backfillProject = projectOverride ?? this.project;
    logger.info('VECTOR_SYNC', 'Starting smart backfill', { project: backfillProject });

    this.vec.load();
    const watermarks = ChromaSyncState.get(backfillProject);

    const SessionStoreCtor = loadSessionStoreCtor();
    const db = storeOverride ?? new SessionStoreCtor();

    try {
      await this.runBackfillPipeline(db, backfillProject, watermarks);
    } catch (error) {
      logger.error('VECTOR_SYNC', 'Backfill failed', { project: backfillProject }, error instanceof Error ? error : new Error(String(error)));
      throw new Error(`Backfill failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (!storeOverride) db.close();
    }
  }

  private async runBackfillPipeline(db: SessionStore, backfillProject: string, watermarks: ProjectWatermarks): Promise<void> {
    const allDocs = await this.backfillObservations(db, backfillProject, watermarks.observations);
    const summaryDocs = await this.backfillSummaries(db, backfillProject, watermarks.summaries);
    const promptDocs = await this.backfillPrompts(db, backfillProject, watermarks.prompts);

    // Flatten: the logger stringifies nested objects as "[object Object]", so the
    // counts and watermarks this line exists to report were unreadable in the log.
    const marks = ChromaSyncState.get(backfillProject);
    logger.info('VECTOR_SYNC', 'Smart backfill complete', {
      project: backfillProject,
      observationDocs: allDocs.length,
      summaryDocs: summaryDocs.length,
      promptDocs: promptDocs.length,
      watermarkObservations: marks.observations,
      watermarkSummaries: marks.summaries,
      watermarkPrompts: marks.prompts,
    });
  }

  private async backfillObservations(db: SessionStore, backfillProject: string, watermark: number): Promise<ChromaDocument[]> {
    const observations = db.db.prepare(`
      SELECT o.*, COALESCE(NULLIF(s.platform_source, ''), 'claude') as platform_source
      FROM observations o
      LEFT JOIN sdk_sessions s ON s.memory_session_id = o.memory_session_id
      WHERE o.project = ? AND o.id > ?
      ORDER BY o.id ASC
    `).all(backfillProject, watermark) as StoredObservation[];

    if (observations.length === 0) return [];

    const totalObsCount = db.db.prepare(`SELECT COUNT(*) as count FROM observations WHERE project = ?`).get(backfillProject) as { count: number };
    logger.info('VECTOR_SYNC', 'Backfilling observations', { project: backfillProject, missing: observations.length, watermark, total: totalObsCount.count });

    const allDocs: ChromaDocument[] = [];
    const obsByDocCount: Array<{ obs: StoredObservation; docs: ChromaDocument[] }> = [];
    for (const obs of observations) {
      const docs = this.formatObservationDocs(obs);
      allDocs.push(...docs);
      obsByDocCount.push({ obs, docs });
    }

    let writtenDocs = 0;
    let lastSyncedObsIdx = -1;
    let hadGap = false;
    for (let i = 0; i < allDocs.length; i += this.BATCH_SIZE) {
      const batch = allDocs.slice(i, i + this.BATCH_SIZE);
      const writtenInBatch = await this.addDocuments(batch);
      if (writtenInBatch < batch.length) {
        hadGap = true;
        logger.debug('VECTOR_SYNC', 'Skipping watermark bump for failed/partial batch', { project: backfillProject, batchStart: i, requested: batch.length, written: writtenInBatch });
        continue;
      }
      if (hadGap) {
        logger.debug('VECTOR_SYNC', 'Skipping watermark bump after prior gap', { project: backfillProject, batchStart: i });
        continue;
      }
      writtenDocs += writtenInBatch;

      let cursor = 0;
      for (let j = 0; j < obsByDocCount.length; j++) {
        cursor += obsByDocCount[j].docs.length;
        if (cursor <= writtenDocs) lastSyncedObsIdx = j;
        else break;
      }
      if (lastSyncedObsIdx >= 0) {
        ChromaSyncState.bump(backfillProject, 'observations', obsByDocCount[lastSyncedObsIdx].obs.id);
      }
      logger.debug('VECTOR_SYNC', 'Backfill progress', { project: backfillProject, progress: `${Math.min(i + this.BATCH_SIZE, allDocs.length)}/${allDocs.length}` });
    }

    return allDocs;
  }

  private async backfillSummaries(db: SessionStore, backfillProject: string, watermark: number): Promise<ChromaDocument[]> {
    const summaries = db.db.prepare(`
      SELECT ss.*, COALESCE(NULLIF(s.platform_source, ''), 'claude') as platform_source
      FROM session_summaries ss
      LEFT JOIN sdk_sessions s ON s.memory_session_id = ss.memory_session_id
      WHERE ss.project = ? AND ss.id > ?
      ORDER BY ss.id ASC
    `).all(backfillProject, watermark) as StoredSummary[];

    if (summaries.length === 0) return [];

    const totalSummaryCount = db.db.prepare(`SELECT COUNT(*) as count FROM session_summaries WHERE project = ?`).get(backfillProject) as { count: number };
    logger.info('VECTOR_SYNC', 'Backfilling summaries', { project: backfillProject, missing: summaries.length, watermark, total: totalSummaryCount.count });

    const summaryDocs: ChromaDocument[] = [];
    const summaryByDocCount: Array<{ summary: StoredSummary; docs: ChromaDocument[] }> = [];
    for (const summary of summaries) {
      const docs = this.formatSummaryDocs(summary);
      summaryDocs.push(...docs);
      summaryByDocCount.push({ summary, docs });
    }

    let writtenDocs = 0;
    let lastSyncedIdx = -1;
    let hadGap = false;
    for (let i = 0; i < summaryDocs.length; i += this.BATCH_SIZE) {
      const batch = summaryDocs.slice(i, i + this.BATCH_SIZE);
      const writtenInBatch = await this.addDocuments(batch);
      if (writtenInBatch < batch.length) {
        hadGap = true;
        logger.debug('VECTOR_SYNC', 'Skipping watermark bump for failed/partial batch', { project: backfillProject, batchStart: i, requested: batch.length, written: writtenInBatch });
        continue;
      }
      if (hadGap) {
        logger.debug('VECTOR_SYNC', 'Skipping watermark bump after prior gap', { project: backfillProject, batchStart: i });
        continue;
      }
      writtenDocs += writtenInBatch;

      let cursor = 0;
      for (let j = 0; j < summaryByDocCount.length; j++) {
        cursor += summaryByDocCount[j].docs.length;
        if (cursor <= writtenDocs) lastSyncedIdx = j;
        else break;
      }
      if (lastSyncedIdx >= 0) {
        ChromaSyncState.bump(backfillProject, 'summaries', summaryByDocCount[lastSyncedIdx].summary.id);
      }
      logger.debug('VECTOR_SYNC', 'Backfill progress', { project: backfillProject, progress: `${Math.min(i + this.BATCH_SIZE, summaryDocs.length)}/${summaryDocs.length}` });
    }

    return summaryDocs;
  }

  private async backfillPrompts(db: SessionStore, backfillProject: string, watermark: number): Promise<ChromaDocument[]> {
    const prompts = db.db.prepare(`
      SELECT up.*, s.project, s.memory_session_id,
             COALESCE(NULLIF(s.platform_source, ''), 'claude') as platform_source
      FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id
      WHERE s.project = ? AND up.id > ?
      ORDER BY up.id ASC
    `).all(backfillProject, watermark) as StoredUserPrompt[];

    if (prompts.length === 0) return [];

    const totalPromptCount = db.db.prepare(`
      SELECT COUNT(*) as count FROM user_prompts up
      JOIN sdk_sessions s ON up.session_db_id = s.id WHERE s.project = ?
    `).get(backfillProject) as { count: number };
    logger.info('VECTOR_SYNC', 'Backfilling user prompts', { project: backfillProject, missing: prompts.length, watermark, total: totalPromptCount.count });

    const promptDocs: ChromaDocument[] = [];
    for (const prompt of prompts) promptDocs.push(this.formatUserPromptDoc(prompt));

    let hadGap = false;
    for (let i = 0; i < promptDocs.length; i += this.BATCH_SIZE) {
      const batch = promptDocs.slice(i, i + this.BATCH_SIZE);
      const writtenInBatch = await this.addDocuments(batch);
      const upTo = Math.min(i + this.BATCH_SIZE, prompts.length);
      if (writtenInBatch < batch.length) {
        hadGap = true;
        logger.debug('VECTOR_SYNC', 'Skipping prompt watermark bump for failed/partial batch', { project: backfillProject, batchStart: i, requested: batch.length, written: writtenInBatch });
        continue;
      }
      if (hadGap) {
        logger.debug('VECTOR_SYNC', 'Skipping prompt watermark bump after prior gap', { project: backfillProject, batchStart: i });
        continue;
      }
      ChromaSyncState.bump(backfillProject, 'prompts', prompts[upTo - 1].id);
      logger.debug('VECTOR_SYNC', 'Backfill progress', { project: backfillProject, progress: `${upTo}/${promptDocs.length}` });
    }

    return promptDocs;
  }

  /**
   * Semantic KNN query. Returns SQLite row ids (deduped per entity, ranked by
   * distance) with aligned distances + metadata bags — identical shape to the
   * former ChromaSync.queryChroma. Degrades to an empty result (so callers fall
   * back to BM25) when the embedder is cold/unavailable rather than throwing.
   */
  async queryChroma(
    query: string,
    limit: number,
    whereFilter?: Record<string, any>
  ): Promise<{ ids: number[]; distances: number[]; metadatas: any[] }> {
    try {
      this.vec.load();
      return await this.vec.queryKnn(query, limit, translateWhere(whereFilter));
    } catch (error) {
      logger.warn('VECTOR_SYNC', 'Semantic query failed; degrading to keyword search', { project: this.project }, error as Error);
      return { ids: [], distances: [], metadatas: [] };
    }
  }

  async updateMergedIntoProject(sqliteIds: number[], mergedIntoProject: string): Promise<void> {
    if (sqliteIds.length === 0) return;
    this.vec.load();
    let totalPatched = 0;
    for (let i = 0; i < sqliteIds.length; i += this.BATCH_SIZE) {
      const idBatch = sqliteIds.slice(i, i + this.BATCH_SIZE);
      totalPatched += this.vec.updateMergedIntoProject(idBatch, mergedIntoProject);
    }
    logger.info('VECTOR_SYNC', 'merged_into_project metadata patched', { collection: this.collectionName, mergedIntoProject, sqliteIdCount: sqliteIds.length, vecRowsPatched: totalPatched });
  }

  // Serial (1) by design: the embedder funnels all inference through one shared
  // onnxruntime session anyway, so parallel projects gained no embed throughput
  // but multiplied peak RAM (3 projects' padded attention tensors at once — the
  // 7.5 GB backfill blowup). One project at a time keeps the warmup RAM-lean.
  private static readonly BACKFILL_CONCURRENCY_LIMIT = 1;
  private static backfillInProgress = false;

  static async backfillAllProjects(storeOverride?: SessionStore): Promise<void> {
    if (VectorSync.backfillInProgress) {
      logger.info('VECTOR_SYNC', 'Backfill already in progress, skipping duplicate run');
      return;
    }

    let db: SessionStore | undefined;
    let sync: VectorSync | undefined;
    try {
      const SessionStoreCtor = loadSessionStoreCtor();
      db = storeOverride ?? new SessionStoreCtor();
      sync = new VectorSync('keepmind');
    } catch (error) {
      logger.error('VECTOR_SYNC', 'Failed to initialize backfill resources', {}, error instanceof Error ? error : new Error(String(error)));
      if (db && !storeOverride) {
        try { db.close(); } catch { /* ignore */ }
      }
      throw error;
    }

    VectorSync.backfillInProgress = true;
    try {
      const projects = db.db.prepare(
        'SELECT DISTINCT project FROM observations WHERE project IS NOT NULL AND project != ?'
      ).all('') as { project: string }[];

      logger.info('VECTOR_SYNC', `Backfill check for ${projects.length} projects`);

      if (!ChromaSyncState.exists()) {
        logger.info('VECTOR_SYNC', 'Watermark cache missing — bootstrapping from vec store (one-time)');
        for (const { project } of projects) {
          try {
            await sync.bootstrapWatermarksFromChroma(project);
          } catch (error) {
            logger.error('VECTOR_SYNC', `Bootstrap failed for project: ${project}`, {}, error instanceof Error ? error : new Error(String(error)));
          }
        }
        logger.info('VECTOR_SYNC', 'Bootstrap complete — incremental backfills will use watermarks');
      }

      const concurrency = VectorSync.BACKFILL_CONCURRENCY_LIMIT;
      for (let i = 0; i < projects.length; i += concurrency) {
        const chunk = projects.slice(i, i + concurrency);
        const chunkResults = await Promise.allSettled(
          chunk.map(({ project }) => sync!.ensureBackfilled(project, db!))
        );
        for (let j = 0; j < chunkResults.length; j++) {
          const result = chunkResults[j];
          if (result.status === 'rejected') {
            const project = chunk[j].project;
            const error = result.reason;
            if (error instanceof Error) logger.error('VECTOR_SYNC', `Backfill failed for project: ${project}`, {}, error);
            else logger.error('VECTOR_SYNC', `Backfill failed for project: ${project}`, { error: String(error) });
          }
        }
      }
    } finally {
      VectorSync.backfillInProgress = false;
      if (sync) {
        try { await sync.close(); } catch (closeError) {
          logger.debug('VECTOR_SYNC', 'sync.close() failed during backfill teardown', {}, closeError instanceof Error ? closeError : new Error(String(closeError)));
        }
      }
      if (!storeOverride && db) {
        try { db.close(); } catch (closeError) {
          logger.debug('VECTOR_SYNC', 'db.close() failed during backfill teardown', {}, closeError instanceof Error ? closeError : new Error(String(closeError)));
        }
      }
    }
  }

  async close(): Promise<void> {
    // The vec store connection is a process singleton (SqliteVecManager); per-
    // instance close is a no-op, mirroring the old ChromaSync.close().
    logger.info('VECTOR_SYNC', 'VectorSync closed', { project: this.project });
  }
}
