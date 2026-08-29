
import { DatabaseManager } from './DatabaseManager.js';
import { SessionManager } from './SessionManager.js';
import { logger } from '../../utils/logger.js';
import {
  buildInitPrompt,
  buildBatchedObservationPrompt,
  buildStatelessObservationPrompt,
  buildSummaryPrompt,
  buildContinuationPrompt,
  buildObserverSystemPrompt,
  clampFieldMaxChars,
} from '../../sdk/prompts.js';
import { deterministicFieldsForBatch } from '../../sdk/deterministic-fields.js';
import { shouldCompressBatch, logGateDecision, readCaptureProfile } from './observation-gate.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH, OBSERVER_SESSIONS_DIR, ensureDir, paths } from '../../shared/paths.js';
import { buildIsolatedEnvWithFreshOAuth, getAuthMethodDescription } from '../../shared/EnvManager.js';
import { findClaudeExecutable } from '../../shared/find-claude-executable.js';
import type { ActiveSession, SDKUserMessage, PendingMessage, PendingMessageWithId } from '../worker-types.js';
import { ModeManager } from '../domain/ModeManager.js';
import { processAgentResponse, type WorkerRef } from './agents/index.js';
import {
  createSdkSpawnFactory,
  getSdkProcessForSession,
  ensureSdkProcessExit,
  waitForSlot,
} from '../../supervisor/process-registry.js';
import { sanitizeEnv } from '../../supervisor/env-sanitizer.js';
import {
  globalRateLimitStore,
  shouldAbortForQuota,
  type RateLimitInfo,
} from './RateLimitStore.js';

// @ts-ignore - Agent SDK types may not be available
import { query } from '@anthropic-ai/claude-agent-sdk';
import { buildHardenedSdkOptions } from '../../sdk/hardened-options.js';
import { ClassifiedProviderError } from './provider-errors.js';
import { resolveTierAlias } from './model-aliases.js';
import { clearDependencyStatus, recordClaudeCliSetupRequired } from '../../shared/dependency-health.js';

/**
 * Module-scoped guard so the "effort parameter" hint only fires once per
 * worker process. The underlying cause (a leaked CLAUDE_CODE_EFFORT_LEVEL in
 * ~/.keepmind/.env, see #2357) is environmental — re-logging it on every
 * SDK call would spam the logs without adding signal.
 *
 * Exported solely for tests to reset the latch between cases.
 */
let effortHintLogged = false;
export function __resetEffortHintLatchForTesting(): void {
  effortHintLogged = false;
}

/**
 * Classify a ClaudeProvider error (executable spawn failures, SDK errors,
 * Anthropic API errors). Provider-specific because it relies on:
 *   - SDK error class names (e.g. OverloadedError) when present
 *   - spawn errors (ENOENT) when the Claude executable is missing
 *   - Anthropic-specific message strings ("Invalid API key", "Prompt is too long")
 */
export function classifyClaudeError(err: unknown): ClassifiedProviderError {
  const message = err instanceof Error ? err.message : String(err);
  const errAny = err as { name?: string; status?: number; error?: { type?: string }; body?: unknown };

  // S12 — a missing LOGIN, which reaches us as the CLI's own text result
  // rather than as an HTTP status or an API-key message. Checked BEFORE the
  // spawn branch: 'Failed to authenticate' arrives from a process that started
  // perfectly well, and misreading it as a setup problem is what produced
  // "Install or update Claude Code CLI" as the advice for an expired session.
  if (
    message.includes('Failed to authenticate') ||
    message.includes('OAuth session expired') ||
    message.includes('could not be refreshed') ||
    message.includes('OAuth token has expired')
  ) {
    return new ClassifiedProviderError(message, { kind: 'auth_expired', cause: err });
  }

  // Executable / spawn issues — unrecoverable, no point retrying.
  if (
    message.includes('Claude executable not found') ||
    message.includes('Every Claude CLI found is too old') ||
    message.includes('CLAUDE_CODE_PATH') ||
    (message.includes('desktop app') && message.includes('headless mode')) ||
    message.includes('ENOENT') ||
    message.startsWith('spawn ')
  ) {
    return new ClassifiedProviderError(message, { kind: 'setup_required', cause: err });
  }

  // Anthropic auth failures.
  if (
    errAny.status === 401 ||
    errAny.status === 403 ||
    message.includes('Invalid API key') ||
    message.includes('API_KEY_INVALID') ||
    message.includes('API key expired') ||
    message.includes('API key not valid')
  ) {
    return new ClassifiedProviderError(message, { kind: 'auth_invalid', cause: err });
  }

  // SDK-level overloaded — Anthropic emits OverloadedError or 529 with type:'overloaded_error'.
  if (
    errAny.name === 'OverloadedError' ||
    errAny.status === 529 ||
    errAny.error?.type === 'overloaded_error'
  ) {
    return new ClassifiedProviderError(message || 'Anthropic overloaded', { kind: 'transient', cause: err });
  }

  // Rate limit.
  if (errAny.status === 429) {
    return new ClassifiedProviderError(message, { kind: 'rate_limit', cause: err });
  }

  // Quota.
  if (message.toLowerCase().includes('quota exceeded')) {
    return new ClassifiedProviderError(message, { kind: 'quota_exhausted', cause: err });
  }

  // Context overflow — unrecoverable in this session, requires reset.
  if (
    message.includes('Prompt is too long') ||
    message.includes('prompt is too long') ||
    message.includes('context window')
  ) {
    return new ClassifiedProviderError(message, { kind: 'unrecoverable', cause: err });
  }

  // HTTP 400 from the Anthropic SDK — bad request, never recoverable. Mirrors
  // the pattern in GeminiProvider.classifyGeminiError / classifyOpenRouterError
  // (see #2357: the SDK forwards `effort` to the Messages API when
  // CLAUDE_CODE_EFFORT_LEVEL leaks into the subprocess env, and models like
  // Haiku/Sonnet 4.5 reject with 400 — without this branch the default
  // `transient` classification retried indefinitely).
  if (errAny.status === 400) {
    // Inspect both the message and any structured body for the effort marker.
    const bodyText = (() => {
      const body = errAny.body;
      if (typeof body === 'string') return body;
      if (body && typeof body === 'object') {
        try { return JSON.stringify(body); } catch { return ''; }
      }
      return '';
    })();
    const haystack = `${message}\n${bodyText}`;
    if (/effort parameter/i.test(haystack) && !effortHintLogged) {
      effortHintLogged = true;
      logger.warn(
        'SDK',
        'Anthropic API rejected request with HTTP 400: this model does not support the `effort` parameter. ' +
          'CLAUDE_CODE_EFFORT_LEVEL is likely leaking into the SDK subprocess env via ~/.keepmind/.env — ' +
          'remove it or scope it to models that support effort. See https://github.com/ManuelStaggl/keepmind/issues/2357.',
        { status: 400 }
      );
    }
    return new ClassifiedProviderError(
      message || 'Anthropic bad request (status 400)',
      { kind: 'unrecoverable', cause: err },
    );
  }

  // Status-less Anthropic 400s — SDK wrapping can drop `.status`, leaving only
  // the message or an `invalid_request_error` body; classify those as
  // unrecoverable so the worker stops retrying a permanent config error (#2656).
  // The status guard keeps statused 4xx/5xx on their own branches.
  if (
    typeof errAny.status !== 'number' &&
    (errAny.error?.type === 'invalid_request_error' ||
      /\bthe provided model identifier is invalid\b/i.test(message) ||
      /\binvalid_request_error\b/i.test(message))
  ) {
    return new ClassifiedProviderError(message, { kind: 'unrecoverable', cause: err });
  }

  // Server errors → transient.
  if (typeof errAny.status === 'number' && errAny.status >= 500 && errAny.status < 600) {
    return new ClassifiedProviderError(message, { kind: 'transient', cause: err });
  }

  // Default: treat unknown errors as transient (preserve old behavior of
  // retrying everything not explicitly marked unrecoverable).
  return new ClassifiedProviderError(message, { kind: 'transient', cause: err });
}

/**
 * L5 — pure model-pin decision (extracted so it is unit-testable without driving
 * the SDK). Within a resumed conversation the model stays pinned so tier routing
 * can't flip it and invalidate the model-scoped prompt cache; a fresh SDK session
 * resolves the tier-routed model and signals that it should be (re-)pinned.
 * `resolveFresh` stays a thunk to preserve the original short-circuit (the
 * settings read only happens when there is no override).
 */
export function pinModelForSession(
  shouldResume: boolean,
  pinnedModel: string | undefined,
  resolveFresh: () => string,
): { modelId: string; pinned: boolean } {
  if (shouldResume && pinnedModel) return { modelId: pinnedModel, pinned: false };
  return { modelId: resolveFresh(), pinned: true };
}

/**
 * L3 — clamp KEEPMIND_MAX_CONTEXT_MESSAGES. 0/negative = unbounded; a finite
 * positive value is floored at 4 so a misconfiguration can't thrash a fresh init
 * on nearly every turn; anything non-finite falls back to the default (40).
 */
export function clampMaxContextTurns(raw: number): number {
  if (!Number.isFinite(raw)) return 40;
  if (raw <= 0) return 0;
  return Math.max(raw, 4);
}

/** L3 — whether the current resumed conversation has hit its turn cap. */
export function shouldForceFreshSession(contextTurnCount: number, maxContextTurns: number): boolean {
  return maxContextTurns > 0 && contextTurnCount >= maxContextTurns;
}

/**
 * Give a stateless observer session an id to group its observations under.
 *
 * In the conversational path this came from the SDK's own `session_id`, because
 * one long-lived SDK conversation existed to name. Statelessly there is a new
 * SDK session per compression, so that id is neither stable nor meaningful.
 * Worse, waiting for it fails SILENTLY: `processAgentResponse` finds no
 * memorySessionId, logs "deferring storage until next round", and every
 * observation is discarded without an error anywhere.
 *
 * So the id is minted up front — the same thing the HTTP providers already do,
 * for the same reason. It identifies the MEMORY session, not the SDK one.
 * Exported for the regression test; a session that reaches compression without
 * an id records nothing at all.
 */
export function ensureStatelessMemorySessionId(
  session: Pick<ActiveSession, 'memorySessionId' | 'contentSessionId' | 'sessionDbId'>,
  store: { updateMemorySessionId(sessionDbId: number, memorySessionId: string | null): void },
  now: number = Date.now()
): string {
  if (session.memorySessionId) return session.memorySessionId;
  const synthetic = `stateless-${session.contentSessionId}-${now}`;
  session.memorySessionId = synthetic;
  try {
    store.updateMemorySessionId(session.sessionDbId, synthetic);
  } catch (error) {
    logger.error('SESSION', 'Failed to persist the stateless memory session id', {
      sessionId: session.sessionDbId,
    }, error instanceof Error ? error : new Error(String(error)));
  }
  logger.info('SESSION', `MEMORY_ID_GENERATED | sessionDbId=${session.sessionDbId} | mode=stateless | memorySessionId=${synthetic}`, {
    sessionId: session.sessionDbId,
    memorySessionId: synthetic,
  });
  return synthetic;
}

/**
 * A compression turn whose assistant message carried no text, held back until
 * the turn ends. See ClaudeProvider.flushEmptyTurn.
 */
type EmptyTurn = { discoveryTokens: number; originalTimestamp: number | null } | null;

export class ClaudeProvider {
  private dbManager: DatabaseManager;
  private sessionManager: SessionManager;

  constructor(dbManager: DatabaseManager, sessionManager: SessionManager) {
    this.dbManager = dbManager;
    this.sessionManager = sessionManager;
  }

  async startSession(session: ActiveSession, worker?: WorkerRef): Promise<void> {
    const cwdTracker = { lastCwd: undefined as string | undefined };

    // Find and validate Claude executable (shared utility, closes #2222)
    let claudePath: string;
    try {
      claudePath = findClaudeExecutable('SDK');
      clearDependencyStatus('claude_cli');
    } catch (error) {
      const classified = classifyClaudeError(error);
      if (classified.kind === 'setup_required') {
        recordClaudeCliSetupRequired(classified.message);
        throw classified;
      }
      throw error;
    }

    // The stateless path does not resume a conversation, so none of the
    // resume/pin/context-cap bookkeeping below applies to it.
    if (this.getObserverSessionMode() === 'stateless') {
      await this.runStatelessSession(session, worker, claudePath, cwdTracker);
      return;
    }

    const hasRealMemorySessionId = !!session.memorySessionId;
    const shouldResume = hasRealMemorySessionId && session.lastPromptNumber > 1 && !session.forceInit;

    // L5: pin the model for the lifetime of a resumed conversation so tier
    // routing (which recomputes modelOverride per session-init) can't flip the
    // model on a generator restart and blow the model-scoped prompt cache. A
    // fresh SDK session (not resuming, e.g. init or forceInit) re-resolves the
    // model from tier routing and re-pins; a resume reuses the pinned model.
    const { modelId, pinned } = pinModelForSession(
      shouldResume,
      session.pinnedModel,
      () => session.modelOverride || this.getModelId(),
    );
    if (pinned) {
      session.pinnedModel = typeof modelId === 'string' ? modelId : undefined;
      // L3: a fresh (non-resumed) SDK session resets the bounded-context turn
      // counter — this conversation's context window starts empty again.
      session.contextTurnCount = 0;
    }
    session.lastModelId = typeof modelId === 'string' ? modelId : undefined;
    // Each query() starts a fresh SDK process, so its total_cost_usd
    // accumulator starts from zero — reset the per-turn cost baseline with it.
    session.lastResultTotalCostUsd = null;

    // The conversational path wrote no cost record at all until 3.4.2, only the
    // INFO line the metrics channel was created to replace — so the documented
    // fallback (KEEPMIND_OBSERVER_SESSION_MODE=conversational) could not be
    // measured against the mode it is a fallback from.
    session.metricsContext = {
      model: typeof modelId === 'string' ? modelId : undefined,
      captureProfile: readCaptureProfile(),
      trigger: this.getObserveTrigger(),
      observerMode: 'conversational',
    };

    const messageGenerator = this.createMessageGenerator(session, cwdTracker);

    if (session.forceInit) {
      logger.info('SDK', 'forceInit flag set, starting fresh SDK session', {
        sessionDbId: session.sessionDbId,
        previousMemorySessionId: session.memorySessionId
      });
      session.forceInit = false;
    }

    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
    const maxConcurrent = parseInt(settings.KEEPMIND_MAX_CONCURRENT_AGENTS, 10) || 2;
    await waitForSlot(maxConcurrent, session.abortController.signal);

    const isolatedEnv = sanitizeEnv(await buildIsolatedEnvWithFreshOAuth());
    const authMethod = getAuthMethodDescription();

    logger.info('SDK', 'Starting SDK query', {
      sessionDbId: session.sessionDbId,
      contentSessionId: session.contentSessionId,
      memorySessionId: session.memorySessionId ?? undefined,
      hasRealMemorySessionId,
      shouldResume,
      resume_parameter: shouldResume ? session.memorySessionId : '(none - fresh start)',
      lastPromptNumber: session.lastPromptNumber,
      authMethod
    });

    if (session.lastPromptNumber > 1) {
      logger.debug('SDK', `[ALIGNMENT] Resume Decision | contentSessionId=${session.contentSessionId} | memorySessionId=${session.memorySessionId} | prompt#=${session.lastPromptNumber} | hasRealMemorySessionId=${hasRealMemorySessionId} | shouldResume=${shouldResume} | resumeWith=${shouldResume ? session.memorySessionId : 'NONE'}`);
    } else {
      const hasStaleMemoryId = hasRealMemorySessionId;
      logger.debug('SDK', `[ALIGNMENT] First Prompt (INIT) | contentSessionId=${session.contentSessionId} | prompt#=${session.lastPromptNumber} | hasStaleMemoryId=${hasStaleMemoryId} | action=START_FRESH | Will capture new memorySessionId from SDK response`);
      if (hasStaleMemoryId) {
        logger.warn('SDK', `Skipping resume for INIT prompt despite existing memorySessionId=${session.memorySessionId} - SDK context was lost (worker restart or crash recovery)`);
      }
    }

    ensureDir(OBSERVER_SESSIONS_DIR);
    // L4: the identity + output-format scaffold rides in the SDK systemPrompt
    // (cached, resume-independent) instead of every user turn. Same active mode
    // the message generator uses, so the format contract stays consistent.
    const observerSystemPrompt = buildObserverSystemPrompt(ModeManager.getInstance().getActiveMode());
    const queryResult = query({
      prompt: messageGenerator,
      options: buildHardenedSdkOptions({
        source: 'Observer',
        sessionDbId: session.sessionDbId,
        contentSessionId: session.contentSessionId,
        project: session.project,
        model: modelId,
        env: isolatedEnv,  // Use isolated credentials from ~/.keepmind/.env, not process.env
        pathToClaudeCodeExecutable: claudePath,
        systemPrompt: observerSystemPrompt,
        abortController: session.abortController,
        ...(shouldResume && session.memorySessionId ? { resume: session.memorySessionId } : {}),
        spawnClaudeCodeProcess: createSdkSpawnFactory(session.sessionDbId),
      }),
    });

    // An assistant message with no text is not an answer — see flushEmptyTurn.
    let pendingEmptyTurn: EmptyTurn = null;

    try {
      for await (const message of queryResult) {
        // Quota-aware wall-clock guard (#2234): the SDK pushes `system` events
        // with subtype `rate_limit` carrying live subscription quota state.
        // Capture the snapshot, then bail out of the loop before issuing
        // another request if we've crossed a per-window threshold. API-key
        // users are exempt — they authorized per-call spend.
        if (
          (message as any)?.type === 'system' &&
          (message as any)?.subtype === 'rate_limit'
        ) {
          const info = (message as any).rate_limit_info as RateLimitInfo | undefined;
          if (info) {
            globalRateLimitStore.set(info);
          }
          const decision = shouldAbortForQuota(authMethod, globalRateLimitStore);
          if (decision.abort) {
            logger.warn('SDK', `Aborting session for quota guard: ${decision.reason}`, {
              sessionDbId: session.sessionDbId,
              window: decision.window,
              authMethod,
            });
            session.abortReason = `quota:${decision.window ?? 'unknown'}`;
            try {
              session.abortController.abort();
            } catch {
              // best-effort
            }
            break;
          }
        }

        if (message.session_id && message.session_id !== session.memorySessionId) {
          const previousId = session.memorySessionId;
          session.memorySessionId = message.session_id;
          this.dbManager.getSessionStore().ensureMemorySessionIdRegistered(
            session.sessionDbId,
            message.session_id
          );
          const verification = this.dbManager.getSessionStore().getSessionById(session.sessionDbId);
          const dbVerified = verification?.memory_session_id === message.session_id;
          const logMessage = previousId
            ? `MEMORY_ID_CHANGED | sessionDbId=${session.sessionDbId} | from=${previousId} | to=${message.session_id} | dbVerified=${dbVerified}`
            : `MEMORY_ID_CAPTURED | sessionDbId=${session.sessionDbId} | memorySessionId=${message.session_id} | dbVerified=${dbVerified}`;
          logger.info('SESSION', logMessage, {
            sessionId: session.sessionDbId,
            memorySessionId: message.session_id,
            previousId
          });
          if (!dbVerified) {
            logger.error('SESSION', `MEMORY_ID_MISMATCH | sessionDbId=${session.sessionDbId} | expected=${message.session_id} | got=${verification?.memory_session_id}`, {
              sessionId: session.sessionDbId
            });
          }
          logger.debug('SDK', `[ALIGNMENT] ${previousId ? 'Updated' : 'Captured'} | contentSessionId=${session.contentSessionId} → memorySessionId=${message.session_id} | Future prompts will resume with this ID`);
        }

        if (message.type === 'assistant') {
          const content = message.message.content;
          const textContent = Array.isArray(content)
            ? content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
            : typeof content === 'string' ? content : '';

          const responseSize = textContent.length;

          const tokensBeforeResponse = session.cumulativeInputTokens + session.cumulativeOutputTokens;

          const usage = message.message.usage;
          if (usage) {
            session.cumulativeInputTokens += usage.input_tokens || 0;
            session.cumulativeOutputTokens += usage.output_tokens || 0;

            if (usage.cache_creation_input_tokens) {
              session.cumulativeInputTokens += usage.cache_creation_input_tokens;
            }

            // Cache reads are billed but are NOT new information, so they are
            // kept out of cumulativeInputTokens (which feeds discovery-token
            // accounting) and totalled separately for the cost record.
            session.cumulativeCacheReadTokens += usage.cache_read_input_tokens || 0;

            // Real per-response usage for telemetry (tokens_input includes the
            // full context the model read: fresh + cache writes + cache reads).
            session.lastUsage = {
              input: (usage.input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0) +
                (usage.cache_read_input_tokens || 0),
              output: usage.output_tokens || 0,
            };

            logger.debug('SDK', 'Token usage captured', {
              sessionId: session.sessionDbId,
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              cacheCreation: usage.cache_creation_input_tokens || 0,
              cacheRead: usage.cache_read_input_tokens || 0,
              cumulativeInput: session.cumulativeInputTokens,
              cumulativeOutput: session.cumulativeOutputTokens
            });
          }

          const discoveryTokens = (session.cumulativeInputTokens + session.cumulativeOutputTokens) - tokensBeforeResponse;

          const originalTimestamp = session.earliestPendingTimestamp;

          if (responseSize > 0) {
            const truncatedResponse = responseSize > 100
              ? textContent.substring(0, 100) + '...'
              : textContent;
            logger.dataOut('SDK', `Response received (${responseSize} chars)`, {
              sessionId: session.sessionDbId,
              promptNumber: session.lastPromptNumber
            }, truncatedResponse);
          }

          if (typeof textContent === 'string' && textContent.includes('Invalid API key')) {
            throw new Error('Invalid API key: check your API key configuration in ~/.keepmind/settings.json or ~/.keepmind/.env');
          }

          if (!textContent) {
            pendingEmptyTurn = { discoveryTokens, originalTimestamp };
            continue;
          }
          pendingEmptyTurn = null;

          await processAgentResponse(
            textContent,
            session,
            this.dbManager,
            this.sessionManager,
            worker,
            discoveryTokens,
            originalTimestamp,
            'SDK',
            cwdTracker.lastCwd,
            modelId
          );
        }

        if (message.type === 'result') {
          // The turn is over: an empty message that nothing followed WAS the
          // answer, so hand it to the skip path now.
          await this.flushEmptyTurn(pendingEmptyTurn, session, worker, cwdTracker.lastCwd, modelId);
          pendingEmptyTurn = null;

          // The result message carries the turn's finalized usage (per-turn,
          // not cumulative — verified empirically against the SDK) plus a
          // CUMULATIVE total_cost_usd; per-compression cost is the delta
          // between consecutive results. The assistant message's
          // usage.output_tokens is an early-streaming placeholder and must
          // never feed telemetry.
          const resultUsage = (message as any).usage as {
            input_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
            output_tokens?: number;
          } | undefined;
          const totalCostUsd = (message as any).total_cost_usd as number | undefined;
          let turnCostUsd: number | undefined;
          if (typeof totalCostUsd === 'number') {
            const prior = session.lastResultTotalCostUsd ?? 0;
            // A total below the prior baseline means the SDK session restarted
            // and its accumulator reset — the new total IS the turn's cost.
            turnCostUsd = totalCostUsd >= prior ? totalCostUsd - prior : totalCostUsd;
            session.lastResultTotalCostUsd = totalCostUsd;
          }
        }
      }
    } finally {
      const tracked = getSdkProcessForSession(session.sessionDbId);
      if (tracked && tracked.process.exitCode === null) {
        await ensureSdkProcessExit(tracked, 5000);
      }
    }

    const sessionDuration = Date.now() - session.startTime;
    logger.success('SDK', 'Agent completed', {
      sessionId: session.sessionDbId,
      duration: `${(sessionDuration / 1000).toFixed(1)}s`
    });
  }

  /**
   * Run an observer session as a series of INDEPENDENT one-shot compressions.
   *
   * The conversational path pushes every observation into the same resumed SDK
   * session, so turn N re-reads turns 1..N-1. That re-read was 91.7% of all
   * tokens keepmind billed. Here each batch gets its own `query()` with no
   * `resume`: the only thing carried across compressions is a fixed-size context
   * block (see buildStatelessContextBlock), so per-turn input is a function of
   * the batch, not of session length.
   *
   * The system prompt is byte-identical on every call, so it stays a cache hit
   * across compressions — the part that SHOULD be re-read still is, cheaply.
   */
  private async runStatelessSession(
    session: ActiveSession,
    worker: WorkerRef | undefined,
    claudePath: string,
    cwdTracker: { lastCwd: string | undefined }
  ): Promise<void> {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
    const maxConcurrent = parseInt(settings.KEEPMIND_MAX_CONCURRENT_AGENTS, 10) || 2;
    const observationBatchMax = this.getObservationBatchMax();
    const observationCoalesceMs = this.getObservationCoalesceMs();
    const fieldMaxChars = this.getFieldMaxChars();
    const modelId = session.modelOverride || this.getModelId();
    session.lastModelId = modelId;

    const mode = ModeManager.getInstance().getActiveMode();
    const systemPrompt = buildObserverSystemPrompt(mode);
    ensureDir(OBSERVER_SESSIONS_DIR);

    // memorySessionId groups the observations of one working session. In the
    // conversational path it was harvested from the SDK's own session_id,
    // because there WAS one long-lived SDK conversation to name. Statelessly
    // there is a new SDK session per compression, so that id is neither stable
    // nor meaningful — and waiting for it means `processAgentResponse` finds no
    // id and defers storage forever, silently discarding every observation.
    //
    // So the id is minted here instead, exactly as the HTTP providers already
    // do for the same reason. It identifies the memory session, not the SDK one.
    ensureStatelessMemorySessionId(session, this.dbManager.getSessionStore());

    // 'session-end' defers every compression until the turn stops, so a working
    // stretch costs one pass instead of one per tool burst. There was no such
    // mode before: the coalesce window could only ever merge tool uses that
    // happened within a few seconds of each other, which is why a single working
    // session still produced dozens of compressions.
    const trigger = this.getObserveTrigger();
    const deferred: PendingMessageWithId[] = [];
    // A hard ceiling so an unusually long stretch cannot grow the buffer without
    // bound; past it the oldest work is compressed and the buffer drains.
    const DEFERRED_MAX = 200;

    // Stamped up front, not at the end of the loop: the cost record is written
    // by the generator exit handler, which also runs when this loop throws or
    // is aborted. Writing the record here meant an aborted session produced no
    // balance at all — the same silent absence the metrics channel exists to
    // prevent.
    session.metricsContext = {
      model: modelId,
      captureProfile: readCaptureProfile(),
      trigger,
      observerMode: 'stateless',
    };

    logger.info('SDK', 'Starting stateless observer session', {
      sessionDbId: session.sessionDbId,
      contentSessionId: session.contentSessionId,
      project: session.project,
      model: modelId,
      captureProfile: readCaptureProfile(),
      trigger,
    });

    for await (const message of this.sessionManager.getMessageIterator(session.sessionDbId)) {
      session.pendingAgentId = message.agentId ?? null;
      session.pendingAgentType = message.agentType ?? null;
      if (message.cwd) cwdTracker.lastCwd = message.cwd;

      if (message.type === 'observation') {
        if (message.prompt_number !== undefined) {
          session.lastPromptNumber = message.prompt_number;
        }

        if (trigger === 'session-end') {
          deferred.push(message);
          if (deferred.length < DEFERRED_MAX) continue;
          logger.debug('SDK', 'Deferred buffer full, compressing early', {
            sessionId: session.sessionDbId,
            buffered: deferred.length,
          });
          await this.compressDeferred(session, worker, deferred, {
            systemPrompt, modelId, claudePath, maxConcurrent,
            lastCwd: cwdTracker.lastCwd, fieldMaxChars, batchSize: observationBatchMax,
          });
          continue;
        }

        const batch = [message];
        if (observationBatchMax > 1) {
          if (observationCoalesceMs > 0) {
            await this.sessionManager.getMessageBuffer().waitForCoalesceWindow({
              sessionDbId: session.sessionDbId,
              target: observationBatchMax - 1,
              windowMs: observationCoalesceMs,
              signal: session.abortController.signal,
            });
          }
          const extra = this.sessionManager.drainAdditionalObservations(
            session.sessionDbId,
            observationBatchMax - 1
          );
          for (const extraMsg of extra) {
            if (extraMsg.prompt_number !== undefined) {
              session.lastPromptNumber = extraMsg.prompt_number;
            }
            batch.push(extraMsg);
          }
        }

        // The cheap decision, made before any network cost is incurred. A gated
        // batch is NOT a compression turn — nothing was sent — so it must not
        // be counted as one, or the skip ratio stops being a ratio.
        const decision = shouldCompressBatch(batch, { userPrompt: session.userPrompt });
        if (!decision.compress) {
          session.gatedBatches = (session.gatedBatches ?? 0) + 1;
          logGateDecision(session.sessionDbId, batch.length, decision);
          // S21: a gated position is decided, so it leaves the queue with its
          // closing line. Before this it was merely `continue`d — still claimed,
          // still buffered, re-yielded and re-gated by every later generator
          // pass, and invisible at INFO. That is what made "the queue is not
          // being drained" indistinguishable from "the gate drops everything".
          await this.retireBatch(session, batch, 'gated', decision.reason);
          continue;
        }
        session.compressionTurns = (session.compressionTurns ?? 0) + 1;

        // Recorded from the hook payload, never from the model.
        session.pendingDeterministicFiles = deterministicFieldsForBatch(batch);

        const prompt = buildStatelessObservationPrompt(
          batch.map(m => ({
            id: 0,
            tool_name: m.tool_name!,
            tool_input: JSON.stringify(m.tool_input),
            tool_output: JSON.stringify(m.tool_response),
            created_at_epoch: Date.now(),
            cwd: m.cwd,
          })),
          {
            userPrompt: session.userPrompt,
            recentTitles: this.getRecentTitles(session),
          },
          fieldMaxChars
        );

        await this.runOneShot(session, worker, {
          prompt,
          systemPrompt,
          modelId,
          claudePath,
          maxConcurrent,
          lastCwd: cwdTracker.lastCwd,
          source: 'ingest',
        });
      } else if (message.type === 'summarize') {
        // The working stretch has ended — this is the "once per work segment"
        // point the trigger mode is named after.
        if (deferred.length > 0) {
          await this.compressDeferred(session, worker, deferred, {
            systemPrompt, modelId, claudePath, maxConcurrent,
            lastCwd: cwdTracker.lastCwd, fieldMaxChars, batchSize: observationBatchMax,
          });
        }

        const summaryPrompt = buildSummaryPrompt({
          id: session.sessionDbId,
          memory_session_id: session.memorySessionId,
          project: session.project,
          user_prompt: session.userPrompt,
          last_assistant_message: message.last_assistant_message || '',
        }, mode);

        session.pendingDeterministicFiles = undefined;
        session.compressionTurns = (session.compressionTurns ?? 0) + 1;
        await this.runOneShot(session, worker, {
          prompt: summaryPrompt,
          systemPrompt,
          modelId,
          claudePath,
          maxConcurrent,
          lastCwd: cwdTracker.lastCwd,
          source: 'summarize',
        });
      }
    }

    logger.debug('SDK', 'Stateless observer loop ended', {
      sessionId: session.sessionDbId,
      compressionTurns: session.compressionTurns ?? 0,
      gatedBatches: session.gatedBatches ?? 0,
    });
  }

  /**
   * S21: retire a batch that will never reach the model, with one closing line
   * per position. `claimedMessageIds` is trimmed in the same step — leaving the
   * ids on the session would have the next `confirmClaimedMessages` try to
   * resolve them a second time.
   */
  private async retireBatch(
    session: ActiveSession,
    batch: readonly PendingMessageWithId[],
    outcome: 'gated' | 'skipped' | 'failed',
    reason?: string
  ): Promise<void> {
    const ids = batch.map(m => m._persistentId);
    this.sessionManager.getMessageBuffer().resolveMany(ids, outcome, reason);
    const retired = new Set(ids);
    session.claimedMessageIds = session.claimedMessageIds.filter(id => !retired.has(id));
    if (session.claimedMessageIds.length === 0) {
      session.earliestPendingTimestamp = null;
    }
  }

  /**
   * Drain the session-end buffer: chunk it into batches of the configured size,
   * gate each one, and compress what survives. The buffer is emptied in place so
   * the caller can keep using the same array.
   */
  private async compressDeferred(
    session: ActiveSession,
    worker: WorkerRef | undefined,
    deferred: PendingMessageWithId[],
    args: {
      systemPrompt: string;
      modelId: string;
      claudePath: string;
      maxConcurrent: number;
      lastCwd: string | undefined;
      fieldMaxChars: number;
      batchSize: number;
    }
  ): Promise<void> {
    const pending = deferred.splice(0, deferred.length);
    const size = Math.max(1, args.batchSize);

    for (let i = 0; i < pending.length; i += size) {
      if (session.abortController.signal.aborted) return;
      const batch = pending.slice(i, i + size);

      const decision = shouldCompressBatch(batch, { userPrompt: session.userPrompt });
      if (!decision.compress) {
        session.gatedBatches = (session.gatedBatches ?? 0) + 1;
        logGateDecision(session.sessionDbId, batch.length, decision);
        await this.retireBatch(session, batch, 'gated', decision.reason);
        continue;
      }
      session.compressionTurns = (session.compressionTurns ?? 0) + 1;

      session.pendingDeterministicFiles = deterministicFieldsForBatch(batch);

      const prompt = buildStatelessObservationPrompt(
        batch.map(m => ({
          id: 0,
          tool_name: m.tool_name!,
          tool_input: JSON.stringify(m.tool_input),
          tool_output: JSON.stringify(m.tool_response),
          created_at_epoch: Date.now(),
          cwd: m.cwd,
        })),
        { userPrompt: session.userPrompt, recentTitles: this.getRecentTitles(session) },
        args.fieldMaxChars
      );

      await this.runOneShot(session, worker, {
        prompt,
        systemPrompt: args.systemPrompt,
        modelId: args.modelId,
        claudePath: args.claudePath,
        maxConcurrent: args.maxConcurrent,
        lastCwd: args.lastCwd,
        source: 'ingest',
      });
    }
  }

  /** How observation batches are dispatched. */
  private getObserveTrigger(): 'batched' | 'session-end' {
    try {
      const settings = SettingsDefaultsManager.loadFromFile(paths.settings());
      const raw = String(settings.KEEPMIND_OBSERVE_TRIGGER ?? '').toLowerCase();
      return raw === 'session-end' ? 'session-end' : 'batched';
    } catch {
      return 'batched';
    }
  }

  /**
   * One compression = one `query()` = one SDK conversation with exactly one user
   * turn. No `resume`, so nothing accumulates between calls.
   */
  private async runOneShot(
    session: ActiveSession,
    worker: WorkerRef | undefined,
    args: {
      prompt: string;
      systemPrompt: string;
      modelId: string;
      claudePath: string;
      maxConcurrent: number;
      lastCwd: string | undefined;
      source: 'ingest' | 'summarize';
    }
  ): Promise<void> {
    await waitForSlot(args.maxConcurrent, session.abortController.signal);
    if (session.abortController.signal.aborted) return;

    const isolatedEnv = sanitizeEnv(await buildIsolatedEnvWithFreshOAuth());
    const authMethod = getAuthMethodDescription();

    session.lastPromptSentAt = Date.now();
    session.lastGeneratorSource = args.source;
    session.lastResultTotalCostUsd = null;

    const queryResult = query({
      prompt: args.prompt,
      options: buildHardenedSdkOptions({
        source: 'Observer',
        sessionDbId: session.sessionDbId,
        contentSessionId: session.contentSessionId,
        project: session.project,
        model: args.modelId,
        env: isolatedEnv,
        pathToClaudeCodeExecutable: args.claudePath,
        systemPrompt: args.systemPrompt,
        abortController: session.abortController,
        spawnClaudeCodeProcess: createSdkSpawnFactory(session.sessionDbId),
      }),
    });

    // An assistant message with no text is not an answer — see flushEmptyTurn.
    let pendingEmptyTurn: EmptyTurn = null;

    try {
      for await (const message of queryResult) {
        if (
          (message as any)?.type === 'system' &&
          (message as any)?.subtype === 'rate_limit'
        ) {
          const info = (message as any).rate_limit_info as RateLimitInfo | undefined;
          if (info) globalRateLimitStore.set(info);
          const decision = shouldAbortForQuota(authMethod, globalRateLimitStore);
          if (decision.abort) {
            logger.warn('SDK', `Aborting session for quota guard: ${decision.reason}`, {
              sessionDbId: session.sessionDbId,
              window: decision.window,
              authMethod,
            });
            session.abortReason = `quota:${decision.window ?? 'unknown'}`;
            try { session.abortController.abort(); } catch { /* best-effort */ }
            break;
          }
        }

        if (message.type === 'assistant') {
          const content = message.message.content;
          const textContent = Array.isArray(content)
            ? content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
            : typeof content === 'string' ? content : '';

          const tokensBefore = session.cumulativeInputTokens + session.cumulativeOutputTokens;
          const usage = message.message.usage;
          if (usage) {
            session.cumulativeInputTokens += usage.input_tokens || 0;
            session.cumulativeOutputTokens += usage.output_tokens || 0;
            if (usage.cache_creation_input_tokens) {
              session.cumulativeInputTokens += usage.cache_creation_input_tokens;
            }
            // Billed but not new information — see the ingest path above.
            session.cumulativeCacheReadTokens += usage.cache_read_input_tokens || 0;
            session.lastUsage = {
              input: (usage.input_tokens || 0) +
                (usage.cache_creation_input_tokens || 0) +
                (usage.cache_read_input_tokens || 0),
              output: usage.output_tokens || 0,
            };
            logger.debug('SDK', 'One-shot usage', {
              sessionId: session.sessionDbId,
              inputTokens: usage.input_tokens,
              cacheRead: usage.cache_read_input_tokens || 0,
              cacheCreation: usage.cache_creation_input_tokens || 0,
              outputTokens: usage.output_tokens,
            });
          }

          if (typeof textContent === 'string' && textContent.includes('Invalid API key')) {
            throw new Error('Invalid API key: check your API key configuration in ~/.keepmind/settings.json or ~/.keepmind/.env');
          }

          const discoveryTokens =
            (session.cumulativeInputTokens + session.cumulativeOutputTokens) - tokensBefore;

          if (!textContent) {
            pendingEmptyTurn = {
              discoveryTokens,
              originalTimestamp: session.earliestPendingTimestamp,
            };
            continue;
          }
          pendingEmptyTurn = null;

          await processAgentResponse(
            textContent,
            session,
            this.dbManager,
            this.sessionManager,
            worker,
            discoveryTokens,
            session.earliestPendingTimestamp,
            'SDK',
            args.lastCwd,
            args.modelId
          );
        }

        if (message.type === 'result') {
          // The turn is over: an empty message that nothing followed WAS the
          // answer, so hand it to the skip path now.
          await this.flushEmptyTurn(pendingEmptyTurn, session, worker, args.lastCwd, args.modelId);
          pendingEmptyTurn = null;
        }
      }
    } finally {
      const tracked = getSdkProcessForSession(session.sessionDbId);
      if (tracked && tracked.process.exitCode === null) {
        await ensureSdkProcessExit(tracked, 5000);
      }
    }
  }

  /**
   * Hand a turn that produced NO text to the parser, once, after the fact.
   *
   * An assistant message with no text is not an answer. Claude Code 2.1.234
   * splits a compression turn in two — a thinking-only message first, the XML
   * second (measured; see `hardened-options.ts`, which now suppresses the split
   * with `maxThinkingTokens: 0`). Parsing the first one is not merely wasteful:
   * `processAgentResponse('')` takes the invalid-output branch and confirms the
   * claimed batch as `skipped`, so the batch is closed while its real answer is
   * still in flight. The empty message is therefore held back and only parsed
   * if the TURN ends without any text at all — which is the case the skip path
   * was written for, a model that genuinely returned nothing usable.
   *
   * Deliberately NOT flushed when the stream ends without a `result` (error or
   * abort): leaving the batch claimed lets the existing recovery re-queue it,
   * and re-queueing beats closing an errored turn as `skipped`.
   */
  private async flushEmptyTurn(
    pending: EmptyTurn,
    session: ActiveSession,
    worker: WorkerRef | undefined,
    lastCwd: string | undefined,
    modelId: string | undefined
  ): Promise<void> {
    if (!pending) return;
    await processAgentResponse(
      '',
      session,
      this.dbManager,
      this.sessionManager,
      worker,
      pending.discoveryTokens,
      pending.originalTimestamp,
      'SDK',
      lastCwd,
      modelId
    );
  }

  /**
   * The "already recorded" hint for the stateless context block. Read from the
   * database rather than kept in memory so it survives a worker restart and
   * stays correct when several sessions touch the same project.
   */
  private getRecentTitles(session: ActiveSession): string[] {
    try {
      const rows = this.dbManager.getSessionStore().getRecentObservations(session.project, 8);
      return rows
        .map(r => (typeof r.text === 'string' ? r.text : ''))
        .filter(t => t.length > 0);
    } catch (error) {
      logger.debug('SDK', 'Recent-title lookup failed; sending context block without it', {
        sessionId: session.sessionDbId,
      }, error instanceof Error ? error : undefined);
      return [];
    }
  }

  private async *createMessageGenerator(
    session: ActiveSession,
    cwdTracker: { lastCwd: string | undefined }
  ): AsyncIterableIterator<SDKUserMessage> {
    const mode = ModeManager.getInstance().getActiveMode();
    // Perf plan L1: coalesce up to N buffered observations into one compression
    // turn. Read once per generator pass; 1 = unchanged one-turn-per-tool-use.
    const observationBatchMax = this.getObservationBatchMax();
    // Perf plan L1b: batching can only coalesce what is already buffered, and the
    // buffer is normally empty (tool uses arrive one at a time). Linger briefly so
    // siblings can land in the same turn — this is what makes L1 actually engage.
    const observationCoalesceMs = this.getObservationCoalesceMs();
    // Perf plan L3: after this many compression turns in one resumed conversation
    // force a fresh SDK session so the context window / resume payload stays
    // bounded (else quadratic cost + eventual "prompt is too long"). 0 = off.
    const maxContextTurns = this.getMaxContextTurns();

    const isInitPrompt = session.lastPromptNumber === 1;
    logger.info('SDK', 'Creating message generator', {
      sessionDbId: session.sessionDbId,
      contentSessionId: session.contentSessionId,
      lastPromptNumber: session.lastPromptNumber,
      isInitPrompt,
      promptType: isInitPrompt ? 'INIT' : 'CONTINUATION'
    });

    const initPrompt = isInitPrompt
      ? buildInitPrompt(session.project, session.contentSessionId, session.userPrompt, mode)
      : buildContinuationPrompt(session.userPrompt, session.lastPromptNumber, session.contentSessionId, mode);

    session.conversationHistory.push({ role: 'user', content: initPrompt });

    session.lastPromptSentAt = Date.now();
    session.lastGeneratorSource = 'init';
    // Every dispatched prompt is a paid turn, including this one — a generator
    // respawn re-sends the init prompt. Counting only ingest turns made
    // skippedBatches/compressionTurns exceed 1.0, which is not a ratio.
    session.compressionTurns = (session.compressionTurns ?? 0) + 1;
    yield {
      type: 'user',
      message: {
        role: 'user',
        content: initPrompt
      },
      session_id: session.contentSessionId,
      parent_tool_use_id: null,
      isSynthetic: true
    };

    for await (const message of this.sessionManager.getMessageIterator(session.sessionDbId)) {
      session.pendingAgentId = message.agentId ?? null;
      session.pendingAgentType = message.agentType ?? null;

      if (message.cwd) {
        cwdTracker.lastCwd = message.cwd;
      }

      if (message.type === 'observation') {
        if (message.prompt_number !== undefined) {
          session.lastPromptNumber = message.prompt_number;
        }

        // L1: coalesce this observation with any other buffered observations into
        // one turn. drainAdditionalObservations claims their ids onto the session
        // too, so confirm/reset still cover the whole batch. batchMax=1 (default)
        // claims nothing extra → single-observation prompt identical to before.
        const batch = [message];
        if (observationBatchMax > 1) {
          if (observationCoalesceMs > 0) {
            const waited = await this.sessionManager.getMessageBuffer().waitForCoalesceWindow({
              sessionDbId: session.sessionDbId,
              target: observationBatchMax - 1,
              windowMs: observationCoalesceMs,
              signal: session.abortController.signal,
            });
            logger.debug('SESSION', 'Coalesce window closed', {
              sessionId: session.sessionDbId,
              siblingsWaiting: waited,
              batchMax: observationBatchMax,
              windowMs: observationCoalesceMs,
            });
          }
          const extra = this.sessionManager.drainAdditionalObservations(
            session.sessionDbId,
            observationBatchMax - 1
          );
          for (const extraMsg of extra) {
            if (extraMsg.prompt_number !== undefined) {
              session.lastPromptNumber = extraMsg.prompt_number;
            }
            batch.push(extraMsg);
          }
        }

        const obsPrompt = buildBatchedObservationPrompt(batch.map(m => ({
          id: 0, // Not used in prompt
          tool_name: m.tool_name!,
          tool_input: JSON.stringify(m.tool_input),
          tool_output: JSON.stringify(m.tool_response),
          created_at_epoch: Date.now(),
          cwd: m.cwd
        })));

        session.conversationHistory.push({ role: 'user', content: obsPrompt });

        session.lastPromptSentAt = Date.now();
        session.lastGeneratorSource = 'ingest';
        yield {
          type: 'user',
          message: {
            role: 'user',
            content: obsPrompt
          },
          session_id: session.contentSessionId,
          parent_tool_use_id: null,
          isSynthetic: true
        };

        // L3: bound the resumed conversation. Count this ingest turn; once we hit
        // the cap, request a fresh SDK session (forceInit) and end this generator.
        // Ending the prompt stream lets the SDK finish the turn we just yielded;
        // any still-buffered observations stay pending and are picked up by the
        // fresh session (which resets contextTurnCount via startSession). Keeping
        // conversationHistory trimmed bounds the in-memory array too.
        session.contextTurnCount = (session.contextTurnCount ?? 0) + 1;
        // Lifetime turn counter (see worker-types.ts): paired with skippedBatches
        // it gives the skip ratio that justifies the batching settings.
        session.compressionTurns = (session.compressionTurns ?? 0) + 1;
        if (shouldForceFreshSession(session.contextTurnCount, maxContextTurns)) {
          session.forceInit = true;
          if (session.conversationHistory.length > 2) {
            session.conversationHistory = session.conversationHistory.slice(-2);
          }
          logger.info('SDK', 'L3 context cap reached — forcing a fresh SDK session', {
            sessionDbId: session.sessionDbId,
            turns: session.contextTurnCount,
            maxContextTurns,
          });
          return;
        }
      } else if (message.type === 'summarize') {
        const summaryPrompt = buildSummaryPrompt({
          id: session.sessionDbId,
          memory_session_id: session.memorySessionId,
          project: session.project,
          user_prompt: session.userPrompt,
          last_assistant_message: message.last_assistant_message || ''
        }, mode);

        session.conversationHistory.push({ role: 'user', content: summaryPrompt });

        session.lastPromptSentAt = Date.now();
        session.lastGeneratorSource = 'summarize';
        session.compressionTurns = (session.compressionTurns ?? 0) + 1;
        yield {
          type: 'user',
          message: {
            role: 'user',
            content: summaryPrompt
          },
          session_id: session.contentSessionId,
          parent_tool_use_id: null,
          isSynthetic: true
        };
      }
    }
  }

  /**
   * 'stateless' (default) gives each compression its own SDK conversation;
   * 'conversational' restores the resumed-session behaviour. Kept switchable
   * because the two differ in cost by an order of magnitude and a regression in
   * observation quality must be reversible without a rebuild.
   */
  private getObserverSessionMode(): 'stateless' | 'conversational' {
    try {
      const settings = SettingsDefaultsManager.loadFromFile(paths.settings());
      const raw = String(settings.KEEPMIND_OBSERVER_SESSION_MODE ?? '').toLowerCase();
      return raw === 'conversational' ? 'conversational' : 'stateless';
    } catch {
      return 'stateless';
    }
  }

  /** Per-field character budget for observation prompts (clamped). */
  private getFieldMaxChars(): number {
    try {
      const settings = SettingsDefaultsManager.loadFromFile(paths.settings());
      return clampFieldMaxChars(parseInt(settings.KEEPMIND_OBS_FIELD_MAX_CHARS, 10));
    } catch {
      return clampFieldMaxChars(NaN);
    }
  }

  private getModelId(): string {
    const settingsPath = paths.settings();
    const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
    // Resolve $TIER:<fast|smart|simple|summary> aliases at request time (#2289).
    return resolveTierAlias(settings.KEEPMIND_MODEL, settings);
  }

  /**
   * Max observations to coalesce into one compression turn (perf plan L1).
   * Clamped to [1, 12]: 1 keeps the historical one-turn-per-tool-use behavior;
   * the upper bound guards against an oversized prompt (each field is already
   * truncated, but very large batches would still bloat the turn).
   */
  private getObservationBatchMax(): number {
    try {
      const settings = SettingsDefaultsManager.loadFromFile(paths.settings());
      const raw = parseInt(settings.KEEPMIND_OBSERVATION_BATCH_MAX, 10);
      if (Number.isFinite(raw) && raw >= 1) return Math.min(raw, 12);
    } catch {
      // fall through to safe default
    }
    return 1;
  }

  /**
   * How long to wait for sibling observations before compressing (perf plan L1b).
   * Clamped to [0, 15000]; 0 disables the window (batch only what already
   * happens to be buffered, i.e. the pre-L1b behavior).
   */
  private getObservationCoalesceMs(): number {
    try {
      const settings = SettingsDefaultsManager.loadFromFile(paths.settings());
      const raw = parseInt(settings.KEEPMIND_OBSERVATION_COALESCE_MS, 10);
      if (Number.isFinite(raw) && raw >= 0) return Math.min(raw, 15_000);
    } catch {
      // fall through to safe default
    }
    return 0;
  }

  /**
   * Max compression turns in one resumed Claude conversation before a fresh
   * session is forced (perf plan L3). 0 = unbounded (legacy). Clamped to a sane
   * floor of 4 when enabled so a misconfiguration can't thrash the session with
   * a fresh init on nearly every turn. Invalid/negative → the default (40).
   */
  private getMaxContextTurns(): number {
    try {
      const settings = SettingsDefaultsManager.loadFromFile(paths.settings());
      return clampMaxContextTurns(parseInt(settings.KEEPMIND_MAX_CONTEXT_MESSAGES, 10));
    } catch {
      // fall through to safe default
      return 40;
    }
  }
}
