import { findClaudeExecutable as defaultFindClaudeExecutable } from '../../shared/find-claude-executable.js';
import { logger } from '../../utils/logger.js';
import {
  clearDependencyStatus,
  recordClaudeCliSetupRequired,
  recordVectorSearchSetupRequired,
  snapshotDependencyHealth,
  type DependencyHealthSnapshot,
} from '../../shared/dependency-health.js';
import { probeVectorDeps, type VectorDepsProbe } from '../vector/vector-deps-repair.js';

interface DependencyPreflightSettings {
  KEEPMIND_PROVIDER?: string;
  KEEPMIND_CHROMA_ENABLED?: string;
}

interface ClassifiedClaudeSetupError {
  kind: string;
  message: string;
}

export interface WorkerDependencyPreflightOptions {
  settings: DependencyPreflightSettings;
  classifyClaudeError: (error: unknown) => ClassifiedClaudeSetupError;
  findClaudeExecutable?: () => string;
  /** Injectable for tests; defaults to the real module-load probe. */
  probeVectorDeps?: () => VectorDepsProbe;
}

/**
 * Preflight the worker's two runtime dependencies: the Claude CLI (only when
 * Claude is the selected provider) and the native vector-search modules.
 *
 * The vector check used to be absent entirely, on the reasoning that in-process
 * vector search has no external dependency. It does: sqlite-vec ships a
 * per-platform native binary that must resolve from node_modules, and it can be
 * missing. The result was a preflight that reported "passed" four milliseconds
 * before the vector store failed to load — the check was structurally incapable
 * of catching the one failure that actually happened, for weeks. So probe the
 * real module load here, not a proxy for it.
 */
export function runWorkerDependencyPreflight(options: WorkerDependencyPreflightOptions): DependencyHealthSnapshot {
  const provider = options.settings.KEEPMIND_PROVIDER || 'claude';

  if (provider === 'claude') {
    const findClaudeExecutable = options.findClaudeExecutable ?? (() => defaultFindClaudeExecutable('WORKER'));
    try {
      const executable = findClaudeExecutable();
      clearDependencyStatus('claude_cli');
      logger.debug('SYSTEM', 'Dependency preflight: Claude CLI resolved', { executable });
    } catch (error) {
      const classified = options.classifyClaudeError(error);
      const message = classified.kind === 'setup_required'
        ? classified.message
        : `Claude CLI preflight failed: ${error instanceof Error ? error.message : String(error)}`;
      recordClaudeCliSetupRequired(message);
      // The caller (worker-service) warns once with the full status snapshot;
      // keep the discovery-level detail (classification + raw cause) here.
      logger.debug('SYSTEM', 'Dependency preflight: Claude CLI discovery failed', {
        kind: classified.kind,
        message,
      });
    }
  } else {
    clearDependencyStatus('claude_cli');
    logger.debug('SYSTEM', 'Dependency preflight: skipped Claude CLI check', { provider });
  }

  if (options.settings.KEEPMIND_CHROMA_ENABLED === 'false') {
    // Vector search is off by configuration — a missing native dep is then not a
    // degradation, it is the requested state.
    clearDependencyStatus('vector_search');
    logger.debug('SYSTEM', 'Dependency preflight: skipped vector check (vector search disabled)');
  } else {
    const probe = (options.probeVectorDeps ?? probeVectorDeps)();
    if (probe.ok) {
      clearDependencyStatus('vector_search');
      logger.debug('SYSTEM', 'Dependency preflight: vector deps resolved');
    } else {
      recordVectorSearchSetupRequired(probe.message);
      logger.debug('SYSTEM', 'Dependency preflight: vector deps unavailable', {
        reason: probe.reason,
        message: probe.message,
      });
    }
  }

  return snapshotDependencyHealth();
}
