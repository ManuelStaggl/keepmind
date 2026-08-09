import type { ActiveSession } from '../../worker-types.js';
import type { SessionManager } from '../SessionManager.js';
import type { SessionCompletionHandler } from './SessionCompletionHandler.js';
import { logger } from '../../../utils/logger.js';
import { getSdkProcessForSession, ensureSdkProcessExit } from '../../../supervisor/process-registry.js';
import { recordSessionMetrics } from '../session-metrics.js';

export interface GeneratorExitDependencies {
  sessionManager: SessionManager;
  completionHandler: SessionCompletionHandler;
}

/**
 * Post-generator-exit handler.
 *
 * The generator's message iterator only ends on abort (idle / shutdown) or when
 * the SDK stream throws, so most exits mean this session is done. Quota exits
 * are different: claimed work has already been reset to pending, so leave the
 * session and in-RAM buffer alive for a later generator start.
 *
 * For non-quota exits we do NOT respawn on remaining buffered work: the old
 * respawn-on-pending loop, driven by the durable pending_messages queue, was the
 * retry storm. Buffered work lives only in RAM now; anything still buffered is
 * dropped here and recovered, if needed, by replaying the Claude Code
 * transcript. Continuation of a session that is still live happens naturally —
 * the next observation ingest calls ensureGeneratorRunning, which starts a
 * fresh generator that drains whatever is buffered.
 */
export async function handleGeneratorExit(
  session: ActiveSession,
  reason: ActiveSession['abortReason'],
  deps: GeneratorExitDependencies
): Promise<void> {
  const { sessionManager, completionHandler } = deps;
  const sessionDbId = session.sessionDbId;

  const tracked = getSdkProcessForSession(sessionDbId);
  if (tracked && !tracked.process.killed && tracked.process.exitCode === null) {
    await ensureSdkProcessExit(tracked, 5000);
  }

  session.generatorPromise = null;
  session.currentProvider = null;

  if ((reason ?? '').split(':')[0] === 'quota') {
    logger.warn('SESSION', 'Generator paused for quota; preserving buffered work', {
      sessionId: sessionDbId,
      pendingCount: sessionManager.getMessageBuffer().getPendingCount(sessionDbId),
    });
    return;
  }

  // The cost record for this session, written here and nowhere else.
  //
  // Two earlier placements were both wrong in the same direction — they went
  // quiet exactly when something had gone wrong. The original was a single INFO
  // line, dropped at KEEPMIND_LOG_LEVEL=WARN. Its 3.4.1 replacement wrote a
  // proper record but did so at the end of the stateless loop, which is skipped
  // whenever that loop throws or is aborted, and which the conversational path
  // never reaches at all.
  //
  // This handler runs on every non-quota generator exit, successful or not, so
  // the balance exists whenever the session does. Quota exits return above:
  // that session is paused, not finished, and its counters keep accruing.
  const turns = session.compressionTurns ?? 0;
  const gated = session.gatedBatches ?? 0;
  recordSessionMetrics({
    endedAt: Date.now(),
    sessionDbId,
    contentSessionId: session.contentSessionId,
    project: session.project,
    compressionTurns: turns,
    gatedBatches: gated,
    skippedBatches: session.skippedBatches ?? 0,
    observationsProduced: session.observationsProduced ?? 0,
    inputTokens: session.cumulativeInputTokens,
    cacheReadInputTokens: session.cumulativeCacheReadTokens ?? 0,
    outputTokens: session.cumulativeOutputTokens,
    durationMs: Date.now() - session.startTime,
    ...session.metricsContext,
  });

  logger.info('SESSION', 'Compression economics', {
    sessionId: sessionDbId,
    compressionTurns: turns,
    gatedBatches: gated,
    skippedBatches: session.skippedBatches ?? 0,
    gatedShare: turns + gated > 0 ? `${Math.round((gated / (turns + gated)) * 100)}%` : '0%',
    observationsProduced: session.observationsProduced ?? 0,
  });

  logger.info('SESSION', 'Generator exited — finalizing session', { sessionId: sessionDbId, reason });

  try {
    await completionHandler.finalizeSession(sessionDbId);
  } catch (e) {
    const normalized = e instanceof Error ? e : new Error(String(e));
    logger.error('SESSION', 'Finalization failed; forcing in-memory session removal', {
      sessionId: sessionDbId,
      reason
    }, normalized);
  } finally {
    sessionManager.removeSessionImmediate(sessionDbId);
  }
}
