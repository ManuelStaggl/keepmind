
import { logger } from '../../../utils/logger.js';
import { parseAgentXml, type ParsedObservation, type ParsedSummary } from '../../../sdk/parser.js';
import {
  classifyObserverOutput,
  isQuotaLimitedObserverOutput,
  previewOutput,
} from '../../../sdk/output-classifier.js';
import { ingestSummary } from '../http/shared.js';
import { updateCursorContextForProject } from '../../integrations/CursorHooksInstaller.js';
import { notifyTelegram } from '../../integrations/TelegramNotifier.js';
import { updateFolderClaudeMdFiles } from '../../../utils/claude-md-utils.js';
import { getWorkerPort } from '../../../shared/worker-utils.js';
import { SettingsDefaultsManager } from '../../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../../shared/paths.js';
import type { ActiveSession } from '../../worker-types.js';
import type { DatabaseManager } from '../DatabaseManager.js';
import type { SessionManager } from '../SessionManager.js';
import type { WorkerRef, StorageResult } from './types.js';
import { broadcastObservation, broadcastSummary } from './ObservationBroadcaster.js';

/** S21 reasons, one per classifier verdict. See classifyObserverOutput. */
const SKIP_REASONS: Record<'idle' | 'prose' | 'xml', string> = {
  idle: 'model_returned_nothing',
  prose: 'model_returned_prose',
  xml: 'model_returned_unparsable_xml',
};

export async function processAgentResponse(
  text: string,
  session: ActiveSession,
  dbManager: DatabaseManager,
  sessionManager: SessionManager,
  worker: WorkerRef | undefined,
  discoveryTokens: number,
  originalTimestamp: number | null,
  agentName: string,
  projectRoot?: string,
  modelId?: string
): Promise<void> {
  const processingStartedAt = Date.now();
  session.lastGeneratorActivity = Date.now();

  if (text) {
    session.conversationHistory.push({ role: 'assistant', content: text });
  }

  const parsed = parseAgentXml(text, session.contentSessionId);


  if (!parsed.valid) {
    if (isQuotaLimitedObserverOutput(text)) {
      session.consecutiveInvalidOutputs = 0;

      logger.warn('PARSER', `${agentName} returned quota-limit prose — pausing generator and preserving queued batch`, {
        sessionId: session.sessionDbId,
        outputClass: 'prose',
        preview: previewOutput(text),
      });

      await sessionManager.resetProcessingToPending(session.sessionDbId);
      session.abortReason = 'quota:observer_text';
      try {
        session.abortController.abort();
      } catch {
        // best-effort; AbortController.abort() should not throw in normal use.
      }
      worker?.broadcastProcessingStatus?.();
      return;
    }

    // Classify the non-XML output so a dropped batch is visible, not silent.
    // Ordinary idle/prose is a claimed no-op batch: confirm it and do not build
    // any respawn debt from repeated skip acknowledgements.
    const outputClass = classifyObserverOutput(text);
    const preview = previewOutput(text);
    session.consecutiveInvalidOutputs = 0;

    // An empty/prose answer is the prompt working as designed ("skip anything not
    // worth recording") — not a warning. Logging it at WARN produced ~3.1k false
    // warnings a day, drowning the real ones. It IS the key cost signal though, so
    // it stays visible at DEBUG and is counted per session (see skippedBatches)
    // so the batching change can be measured rather than guessed at.
    session.skippedBatches = (session.skippedBatches ?? 0) + 1;
    logger.debug('PARSER', `${agentName} skipped a queued batch (${outputClass})`, {
      sessionId: session.sessionDbId,
      outputClass,
      preview,
      skippedBatches: session.skippedBatches,
      compressionTurns: session.compressionTurns ?? 0,
    });

    // Plain-text skip responses are intentionally ignored. Re-queueing them
    // creates an observer loop where the same low-signal batch is retried.
    // S21: `skipped` is the closing line — the model was asked and returned
    // nothing usable, which is a different fact from "the gate never asked".
    // The reason spells out WHICH of the three it was, because 'xml' on its own
    // reads as success in a log line about a dropped batch.
    await sessionManager.confirmClaimedMessages(
      session.sessionDbId,
      'skipped',
      SKIP_REASONS[outputClass],
    );
    session.earliestPendingTimestamp = null;
    return;
  }

  // Valid parse — clear the invalid-output counter so transient misses don't
  // accumulate toward a respawn across a healthy session.
  session.consecutiveInvalidOutputs = 0;

  if (!session.memorySessionId) {
    logger.warn('SDK', 'memorySessionId not yet captured; deferring storage until next round', {
      sessionId: session.sessionDbId
    });
    // Reset any claimed-but-undelivered messages back to pending so they don't
    // count as "in progress" and trigger a respawn loop while we wait for the
    // memory session id to appear. The next generator pass will re-claim them.
    await sessionManager.resetProcessingToPending(session.sessionDbId);
    return;
  }

  const { observations, summary } = parsed;
  const summaryForStore = normalizeSummaryForStorage(summary);
  session.observationsProduced = (session.observationsProduced ?? 0) + observations.length;

  const sessionStore = dbManager.getSessionStore();
  sessionStore.ensureMemorySessionIdRegistered(session.sessionDbId, session.memorySessionId, getWorkerPort());

  logger.info('DB', `STORING | sessionDbId=${session.sessionDbId} | memorySessionId=${session.memorySessionId} | obsCount=${observations.length} | hasSummary=${!!summaryForStore}`, {
    sessionId: session.sessionDbId,
    memorySessionId: session.memorySessionId
  });

  // File lists come from the hook payload, not from the model. The observer only
  // ever saw a truncated copy of the tool input, so anything it echoed back was
  // at best a re-transcription and at worst invented; the hook has the exact
  // path. When no deterministic list is available (summaries, the conversational
  // path, other providers) the parsed values stand, so this is additive.
  const deterministic = session.pendingDeterministicFiles;
  const labeledObservations = observations.map(obs => ({
    ...obs,
    ...(deterministic
      ? { files_read: deterministic.files_read, files_modified: deterministic.files_modified }
      : {}),
    agent_type: session.pendingAgentType ?? null,
    agent_id: session.pendingAgentId ?? null
  }));

  let result: ReturnType<typeof sessionStore.storeObservations>;
  try {
    result = sessionStore.storeObservations(
      session.memorySessionId,
      session.project,
      labeledObservations,
      summaryForStore,
      session.lastPromptNumber,
      discoveryTokens,
      originalTimestamp ?? undefined,
      modelId
    );
  } finally {
    session.pendingAgentId = null;
    session.pendingAgentType = null;
  }

  logger.info('DB', `STORED | sessionDbId=${session.sessionDbId} | memorySessionId=${session.memorySessionId} | obsCount=${result.observationIds.length} | obsIds=[${result.observationIds.join(',')}] | summaryId=${result.summaryId || 'none'}`, {
    sessionId: session.sessionDbId,
    memorySessionId: session.memorySessionId
  });

  session.lastSummaryStored = result.summaryId !== null;

  // Reset per-compression session accounting (previously read for a telemetry
  // event that no longer exists).
  session.lastUsage = null;
  session.lastPromptSentAt = null;

  if (summary && (summary.skipped || session.lastSummaryStored)) {
    await ingestSummary({
      kind: 'parsed',
      sessionDbId: session.sessionDbId,
      messageId: -1,
      contentSessionId: session.contentSessionId,
      parsed: summary,
    });
  }

  await sessionManager.confirmClaimedMessages(
    session.sessionDbId,
    'stored',
    `obs=${result.observationIds.length}${result.summaryId ? ' summary=1' : ''}`
  );
  session.earliestPendingTimestamp = null;
  worker?.broadcastProcessingStatus?.();

  void notifyTelegram({
    observations: labeledObservations,
    observationIds: result.observationIds,
    project: session.project,
    memorySessionId: session.memorySessionId,
  });

  await syncAndBroadcastObservations(
    observations,
    result,
    session,
    dbManager,
    worker,
    agentName,
    projectRoot
  );

  await syncAndBroadcastSummary(
    summary,
    summaryForStore,
    result,
    session,
    dbManager,
    worker,
    agentName
  );
}

function normalizeSummaryForStorage(summary: ParsedSummary | null): {
  request: string;
  investigated: string;
  learned: string;
  completed: string;
  next_steps: string;
  notes: string | null;
} | null {
  if (!summary) return null;
  if (summary.skipped) return null;

  return {
    request: summary.request || '',
    investigated: summary.investigated || '',
    learned: summary.learned || '',
    completed: summary.completed || '',
    next_steps: summary.next_steps || '',
    notes: summary.notes
  };
}

async function syncAndBroadcastObservations(
  observations: ParsedObservation[],
  result: StorageResult,
  session: ActiveSession,
  dbManager: DatabaseManager,
  worker: WorkerRef | undefined,
  agentName: string,
  projectRoot?: string
): Promise<void> {
  const memorySessionId = session.memorySessionId;
  if (!memorySessionId) {
    return;
  }

  // Dedupe observation IDs before sync/broadcast: storeObservations may collapse
  // multiple parsed observations onto the same row via content_hash, producing
  // duplicate IDs. Syncing them 1:1 triggers repeated Chroma "IDs already exist"
  // reconciles. See issue #2240.
  const uniqueObservationIds = [...new Set(result.observationIds)];

  for (const obsId of uniqueObservationIds) {
    const observationIndex = result.observationIds.indexOf(obsId);
    const obs = observations[observationIndex];
    if (!obs) {
      logger.warn('DB', `${agentName} storage returned observation id without matching parsed observation`, {
        sessionId: session.sessionDbId,
        obsId,
        observationIndex
      });
      continue;
    }
    const chromaStart = Date.now();

    dbManager.getChromaSync()?.syncObservation(
      obsId,
      memorySessionId,
      session.project,
      obs,
      session.lastPromptNumber,
      result.createdAtEpoch,
      session.platformSource
    ).then(() => {
      const chromaDuration = Date.now() - chromaStart;
      logger.debug('CHROMA', 'Observation synced', {
        obsId,
        duration: `${chromaDuration}ms`,
        type: obs.type,
        title: obs.title || '(untitled)'
      });
    }).catch((error) => {
      logger.error('CHROMA', `${agentName} chroma sync failed, continuing without vector search`, {
        obsId,
        type: obs.type,
        title: obs.title || '(untitled)'
      }, error);
    });

    broadcastObservation(worker, {
      id: obsId,
      memory_session_id: session.memorySessionId,
      session_id: session.contentSessionId,
      platform_source: session.platformSource,
      type: obs.type,
      title: obs.title,
      subtitle: obs.subtitle,
      text: null,
      narrative: obs.narrative || null,
      facts: JSON.stringify(obs.facts || []),
      concepts: JSON.stringify(obs.concepts || []),
      files_read: JSON.stringify(obs.files_read || []),
      files_modified: JSON.stringify(obs.files_modified || []),
      project: session.project,
      prompt_number: session.lastPromptNumber,
      created_at_epoch: result.createdAtEpoch
    });
  }

  const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
  const settingValue: unknown = settings.KEEPMIND_FOLDER_CLAUDEMD_ENABLED;
  const folderClaudeMdEnabled = settingValue === 'true' || settingValue === true;

  if (folderClaudeMdEnabled) {
    const allFilePaths: string[] = [];
    for (const obs of observations) {
      allFilePaths.push(...(obs.files_modified || []));
      allFilePaths.push(...(obs.files_read || []));
    }

    if (allFilePaths.length > 0) {
      updateFolderClaudeMdFiles(
        allFilePaths,
        session.project,
        getWorkerPort(),
        projectRoot
      ).catch(error => {
        logger.warn('FOLDER_INDEX', 'CLAUDE.md update failed (non-critical)', { project: session.project }, error as Error);
      });
    }
  }
}

async function syncAndBroadcastSummary(
  summary: ParsedSummary | null,
  summaryForStore: { request: string; investigated: string; learned: string; completed: string; next_steps: string; notes: string | null } | null,
  result: StorageResult,
  session: ActiveSession,
  dbManager: DatabaseManager,
  worker: WorkerRef | undefined,
  agentName: string
): Promise<void> {
  if (!summaryForStore || !result.summaryId) {
    return;
  }
  const memorySessionId = session.memorySessionId;
  if (!memorySessionId) {
    return;
  }

  const chromaStart = Date.now();

  dbManager.getChromaSync()?.syncSummary(
    result.summaryId,
    memorySessionId,
    session.project,
    summaryForStore,
    session.lastPromptNumber,
    result.createdAtEpoch,
    session.platformSource
  ).then(() => {
    const chromaDuration = Date.now() - chromaStart;
    logger.debug('CHROMA', 'Summary synced', {
      summaryId: result.summaryId,
      duration: `${chromaDuration}ms`,
      request: summaryForStore.request || '(no request)'
    });
  }).catch((error) => {
    logger.error('CHROMA', `${agentName} chroma sync failed, continuing without vector search`, {
      summaryId: result.summaryId,
      request: summaryForStore.request || '(no request)'
    }, error);
  });

  broadcastSummary(worker, {
    id: result.summaryId,
    session_id: session.contentSessionId,
    platform_source: session.platformSource,
    request: summaryForStore!.request,
    investigated: summaryForStore!.investigated,
    learned: summaryForStore!.learned,
    completed: summaryForStore!.completed,
    next_steps: summaryForStore!.next_steps,
    notes: summaryForStore!.notes,
    project: session.project,
    prompt_number: session.lastPromptNumber,
    created_at_epoch: result.createdAtEpoch
  });

  updateCursorContextForProject(session.project, getWorkerPort()).catch(error => {
    logger.warn('CURSOR', 'Context update failed (non-critical)', { project: session.project }, error as Error);
  });
}
