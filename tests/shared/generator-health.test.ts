// S12 / S13 / S14 — the observer generator's own health.
//
// The three acceptances from the finding:
//   S12  a subprocess failure carrying the OAuth text produces a health state
//        whose instruction is `claude auth login` — NOT "Install or update
//        Claude Code CLI", which is what `setup_required` says and which is the
//        wrong advice when only the login is gone.
//   S13  three consecutive failures produce a state REGARDLESS of the text,
//        because the pattern list will always be incomplete. It was incomplete
//        on 28.08.2026, which is how 47 failures produced no state at all.
//   S14  the state survives the process that noticed it — every process that
//        can tell the user (the session-start hook, `keepmind doctor`) is
//        short-lived and shares no memory with the worker.

import { describe, it, expect, beforeEach } from '../bun-test-shim.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { DATA_DIR } from '../../src/shared/paths.js';
import {
  classifyGeneratorFailure,
  clearGeneratorHealthForTesting,
  readGeneratorHealth,
  recordGeneratorFailure,
  recordGeneratorSuccess,
} from '../../src/shared/generator-health.js';

const STATE_FILE = join(DATA_DIR, 'state', 'generator-health.json');

describe('generator health (S12/S13/S14)', () => {
  beforeEach(() => {
    clearGeneratorHealthForTesting();
  });

  it('S12 — the real OAuth text yields auth_expired and says to log in', () => {
    const state = recordGeneratorFailure(
      'claude',
      'Claude Code returned an error result: Failed to authenticate: OAuth session expired and could not be refreshed',
    );

    expect(state.kind).toBe('auth_expired');
    expect(state.degraded).toBe(true);
    expect(state.remediation).toContain('claude auth login');
    // The remediation that was actually given for 31 hours, explicitly excluded.
    expect(state.remediation).not.toContain('Install or update Claude Code CLI');
    expect(state.remediation).not.toContain('npm install -g');
  });

  it('S12 — a missing executable is still setup_required, not auth_expired', () => {
    expect(classifyGeneratorFailure('spawn claude ENOENT')).toBe('setup_required');
    expect(classifyGeneratorFailure('Claude executable not found')).toBe('setup_required');
  });

  it('S13 — an invented error text still raises a state after three in a row', () => {
    const nonsense = 'Xyzzy transport frobnicated (code 9911)';

    expect(recordGeneratorFailure('claude', nonsense).degraded).toBe(false);
    expect(recordGeneratorFailure('claude', nonsense).degraded).toBe(false);
    const third = recordGeneratorFailure('claude', nonsense);

    expect(third.kind).toBe('unknown');
    expect(third.degraded).toBe(true);
    expect(third.consecutiveFailures).toBe(3);
    expect(third.remediation.length).toBeGreaterThan(0);
  });

  it('S14 — the state is on disk, readable without asking the worker', () => {
    recordGeneratorFailure('claude', 'Failed to authenticate: OAuth session expired');

    expect(existsSync(STATE_FILE)).toBe(true);
    // Read as bytes, the way a short-lived foreign process would: no shared
    // module instance, no worker call.
    const onDisk = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    expect(onDisk.degraded).toBe(true);
    expect(onDisk.kind).toBe('auth_expired');
    expect(String(onDisk.lastError)).toContain('OAuth session expired');
    expect(String(onDisk.remediation)).toContain('claude auth login');
  });

  it('a success clears the state — a recovered generator must stop alarming', () => {
    recordGeneratorFailure('claude', 'Failed to authenticate');
    expect(readGeneratorHealth().degraded).toBe(true);

    recordGeneratorSuccess();

    const state = readGeneratorHealth();
    expect(state.degraded).toBe(false);
    expect(state.consecutiveFailures).toBe(0);
  });

  it('the counter is CONSECUTIVE — a success in between resets it', () => {
    recordGeneratorFailure('claude', 'weird one');
    recordGeneratorFailure('claude', 'weird one');
    recordGeneratorSuccess();
    const after = recordGeneratorFailure('claude', 'weird one');

    expect(after.consecutiveFailures).toBe(1);
    expect(after.degraded).toBe(false);
  });

  it('a cleared state reads as healthy, not as unknown-and-alarming', () => {
    const state = readGeneratorHealth();
    expect(state.degraded).toBe(false);
    expect(state.consecutiveFailures).toBe(0);
  });
});
