// S15 — a detected outage has to reach the PERSON.
//
// VERIFIED 29.08.2026 on the running system: the Claude Code Desktop App shows
// neither a hook's `systemMessage` nor a status line (Issue #41456). A hook
// emitted both fields cleanly at 36% context; the model got the
// additionalContext and the user saw nothing. So the only proven route is
// `additionalContext` carrying an explicit instruction to the model to relay
// the message — that instruction is the load-bearing part, and it is what these
// tests guard.

import { describe, it, expect, beforeEach, afterEach } from '../bun-test-shim.js';
import {
  collectUserAlerts,
  renderAlertsForModel,
  renderAlertsForTerminal,
  type UserAlert,
} from '../../src/shared/user-alerts.js';
import {
  clearGeneratorHealthForTesting,
  recordGeneratorFailure,
} from '../../src/shared/generator-health.js';
import { clearStaleMarker } from '../../src/shared/oauth-token.js';

describe('S15 — user alerts', () => {
  beforeEach(() => {
    clearGeneratorHealthForTesting();
    clearStaleMarker();
  });

  afterEach(() => {
    clearGeneratorHealthForTesting();
    clearStaleMarker();
  });

  it('says nothing when nothing is wrong — no per-session token tax', () => {
    expect(renderAlertsForModel([])).toBe('');
    expect(renderAlertsForTerminal([])).toBe('');
  });

  it('the model block carries an explicit instruction to relay it', () => {
    const alerts: UserAlert[] = [
      { id: 'generator', line: '🔴 keepmind is NOT recording.', remediation: 'Run `claude auth login`.' },
    ];

    const block = renderAlertsForModel(alerts);

    expect(block).toContain('🔴 keepmind is NOT recording.');
    expect(block).toContain('Run `claude auth login`.');
    // The three properties the Desktop App finding makes non-negotiable:
    // the model is told to speak, told WHEN, and told WHY it is the only route.
    expect(block).toContain('Tell the user');
    expect(block).toContain('one sentence');
    expect(block).toContain('cannot see this');
  });

  it('the terminal block carries no relay instruction — the reader IS the person', () => {
    const alerts: UserAlert[] = [
      { id: 'vector', line: '⚠ semantic search is DEGRADED', remediation: '' },
    ];

    const block = renderAlertsForTerminal(alerts);

    expect(block).toContain('semantic search is DEGRADED');
    expect(block).not.toContain('Tell the user');
  });

  it('a degraded generator becomes an alert that names the outage and the fix', () => {
    recordGeneratorFailure(
      'claude',
      'Failed to authenticate: OAuth session expired and could not be refreshed',
    );

    const alerts = collectUserAlerts();
    const generator = alerts.find(a => a.id === 'generator');

    expect(generator).toBeDefined();
    // "not recording" is the fact the user actually needs; the error text alone
    // does not say that memory has stopped.
    expect(generator!.line).toContain('NOT recording');
    expect(generator!.remediation).toContain('claude auth login');
  });

  it('the generator alert comes first — it is the one that stops capture', () => {
    recordGeneratorFailure('claude', 'Failed to authenticate');

    const alerts = collectUserAlerts();

    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].id).toBe('generator');
  });
});
