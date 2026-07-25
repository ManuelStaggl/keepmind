import { findClaudeExecutable as defaultFindClaudeExecutable } from '../../shared/find-claude-executable.js';
import { logger } from '../../utils/logger.js';
import {
  clearDependencyStatus,
  recordClaudeCliSetupRequired,
  snapshotDependencyHealth,
  type DependencyHealthSnapshot,
} from '../../shared/dependency-health.js';

interface DependencyPreflightSettings {
  KEEPMIND_PROVIDER?: string;
}

interface ClassifiedClaudeSetupError {
  kind: string;
  message: string;
}

export interface WorkerDependencyPreflightOptions {
  settings: DependencyPreflightSettings;
  classifyClaudeError: (error: unknown) => ClassifiedClaudeSetupError;
  findClaudeExecutable?: () => string;
}

/**
 * Vector search is in-process (sqlite-vec + transformers.js), so the only
 * external dependency the worker can be missing is the Claude CLI — and only
 * when Claude is the selected provider.
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

  return snapshotDependencyHealth();
}
