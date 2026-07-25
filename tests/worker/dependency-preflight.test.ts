import { describe, it, expect, beforeEach } from 'bun:test';
import { runWorkerDependencyPreflight } from '../../src/services/worker/dependency-preflight.js';
import {
  getDependencyStatus,
  recordDependencyStatus,
  resetDependencyStatusesForTesting,
} from '../../src/shared/dependency-health.js';

function classifier(error: unknown): { kind: string; message: string } {
  return {
    kind: error instanceof Error && /Claude executable not found/.test(error.message)
      ? 'setup_required'
      : 'transient',
    message: error instanceof Error ? error.message : String(error),
  };
}

describe('worker dependency preflight', () => {
  beforeEach(() => {
    resetDependencyStatusesForTesting();
  });

  it('does not check Claude for a non-Claude provider and treats uvx as satisfied (in-process vector search)', () => {
    let claudeChecked = false;

    const snapshot = runWorkerDependencyPreflight({
      settings: {
        KEEPMIND_PROVIDER: 'gemini',
        KEEPMIND_CHROMA_ENABLED: 'true',
      },
      classifyClaudeError: classifier,
      findClaudeExecutable: () => {
        claudeChecked = true;
        throw new Error('Claude should not be checked for Gemini');
      },
      env: { PATH: '/tmp/no-uvx' },
      platform: 'linux',
      homedir: () => '/tmp/home',
      pathExists: () => false,
      isFile: () => false,
    });

    expect(claudeChecked).toBe(false);
    // Vector search moved in-process (sqlite-vec + transformers.js), so a missing
    // uvx no longer degrades the worker — the 'uvx' dependency is always cleared.
    expect(snapshot.degraded).toBe(false);
    expect(getDependencyStatus('uvx')).toBeNull();
  });

  it('clears stale Claude CLI setup status when a non-Claude provider is selected', () => {
    recordDependencyStatus('claude_cli', 'setup_required', 'old failure');

    runWorkerDependencyPreflight({
      settings: {
        KEEPMIND_PROVIDER: 'openrouter',
        KEEPMIND_CHROMA_ENABLED: 'false',
      },
      classifyClaudeError: classifier,
      findClaudeExecutable: () => {
        throw new Error('Claude should not be checked for OpenRouter');
      },
      env: { PATH: '' },
      platform: 'linux',
      homedir: () => '/tmp/home',
      pathExists: () => false,
      isFile: () => false,
    });

    expect(getDependencyStatus('claude_cli')).toBeNull();
  });

  it('records Claude CLI setup_required when Claude is selected and discovery fails', () => {
    runWorkerDependencyPreflight({
      settings: {
        KEEPMIND_PROVIDER: 'claude',
        KEEPMIND_CHROMA_ENABLED: 'false',
      },
      classifyClaudeError: classifier,
      findClaudeExecutable: () => {
        throw new Error('Claude executable not found. Please install Claude Code CLI.');
      },
      env: { PATH: '' },
      platform: 'linux',
      homedir: () => '/tmp/home',
      pathExists: () => false,
      isFile: () => false,
    });

    expect(getDependencyStatus('claude_cli')).toMatchObject({
      dependency: 'claude_cli',
      kind: 'setup_required',
      message: 'Claude executable not found. Please install Claude Code CLI.',
    });
    expect(getDependencyStatus('claude_cli')?.remediation).toContain('Claude Code CLI');
  });
});
