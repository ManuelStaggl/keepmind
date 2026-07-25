
import { DatabaseManager } from './DatabaseManager.js';
import { SessionManager } from './SessionManager.js';
import { logger } from '../../utils/logger.js';
import { buildInitPrompt, buildBatchedObservationPrompt, buildSummaryPrompt, buildContinuationPrompt, buildObserverSystemPrompt } from '../../sdk/prompts.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH, OBSERVER_SESSIONS_DIR, ensureDir, paths } from '../../shared/paths.js';
import { buildIsolatedEnvWithFreshOAuth, getAuthMethodDescription } from '../../shared/EnvManager.js';
import { findClaudeExecutable } from '../../shared/find-claude-executable.js';
import type { ActiveSession, SDKUserMessage } from '../worker-types.js';
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
