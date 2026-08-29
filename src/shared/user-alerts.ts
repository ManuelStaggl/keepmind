// SPDX-License-Identifier: Apache-2.0
//
// Getting a failure in front of the PERSON (S15).
//
// WHY THIS SHAPE, AND NOT `systemMessage`
// ---------------------------------------
// Detecting an outage is worth nothing if the detection never leaves the
// machine. keepmind had three detectors — the stale-OAuth marker, the vector
// degradation marker, and (now) the generator-health state — and all three
// spoke through channels the user does not read: a log file, a terminal line,
// and `keepmind doctor`, which nobody runs while things look fine.
//
// `systemMessage` looks like the answer and is not. VERIFIED 29.08.2026 on the
// running system: a `UserPromptSubmit` hook emitted
// `{"systemMessage":"…","additionalContext":"…"}` cleanly at 36% context; the
// model received the additionalContext, and the user did NOT see the
// systemMessage line in the Claude Code Desktop App (confirmed by asking).
// `statusLine` is unsupported there as well (Issue #41456). In the Desktop App
// — which is the only client this user runs — there is no direct channel to
// the person at all.
//
// So the ONE proven route is `additionalContext` carrying an explicit
// instruction to the MODEL to relay the message. That is the load-bearing part
// of this file, and it is why the alert text is written twice: once addressed
// to the model with the relay instruction, once as a plain line for the
// terminal. `systemMessage` is still set — it works in the terminal and costs
// nothing — but nothing may depend on it.
//
// The relay instruction is deliberately concrete ("tell the user in one
// sentence, they cannot see this"). A bare warning in additionalContext gets
// read as background and summarised away.

import { readGeneratorHealth } from './generator-health.js';
import { readStaleMarker } from './oauth-token.js';
import { readVectorHealthHint } from './vector-health.js';

export interface UserAlert {
  /** Stable id, so a caller can suppress or test one alert specifically. */
  id: 'generator' | 'oauth' | 'vector';
  /** One line, already prefixed with a severity marker. */
  line: string;
  /** What the person has to do. May be empty. */
  remediation: string;
}

/**
 * The relay instruction. Everything above it in the block is context; this
 * sentence is what actually moves the message the last step.
 */
const RELAY_INSTRUCTION =
  'Tell the user about this in one sentence at the start of your reply, in their language, ' +
  'including what they need to do. They cannot see this notice themselves — the Claude Code ' +
  'Desktop App shows neither hook system messages nor a status line, so you are the only ' +
  'channel. Then carry on with their request.';

function ageHours(sinceMs: number): string {
  if (!sinceMs) return '';
  const hours = (Date.now() - sinceMs) / 3_600_000;
  if (hours < 1) return ' (started less than an hour ago)';
  return ` (started ${Math.floor(hours)}h ago)`;
}

/** Everything currently worth telling the user, most urgent first. */
export function collectUserAlerts(): UserAlert[] {
  const alerts: UserAlert[] = [];

  // First, because it means memory is NOT being written right now. The other
  // two degrade quality; this one stops capture outright.
  const generator = readGeneratorHealth();
  if (generator.degraded) {
    const since = ageHours(generator.firstFailureAtMs);
    alerts.push({
      id: 'generator',
      line:
        `🔴 keepmind is NOT recording: the observer subprocess has failed ` +
        `${generator.consecutiveFailures}× in a row${since}. Nothing from these sessions is being ` +
        `written to memory. Last error: ${generator.lastError}`,
      remediation: generator.remediation,
    });
  }

  const staleReason = readStaleMarker();
  if (staleReason) {
    alerts.push({
      id: 'oauth',
      line: `⚠ keepmind: the Claude OAuth token is stale or missing (${staleReason.trim()}).`,
      remediation: 'Re-login via Claude Desktop or run `claude auth login`.',
    });
  }

  const vectorHint = readVectorHealthHint();
  if (vectorHint) {
    alerts.push({ id: 'vector', line: vectorHint, remediation: '' });
  }

  return alerts;
}

/**
 * The block that goes into `additionalContext`, addressed to the model.
 * Returns '' when there is nothing to report — an empty alert block would cost
 * tokens on every single session start for no reason.
 */
export function renderAlertsForModel(alerts: readonly UserAlert[]): string {
  if (alerts.length === 0) return '';
  const body = alerts
    .map(a => (a.remediation ? `${a.line}\n  → ${a.remediation}` : a.line))
    .join('\n');
  return `<keepmind_alert>\n${body}\n\n${RELAY_INSTRUCTION}\n</keepmind_alert>`;
}

/**
 * The same alerts as a plain block for `systemMessage`. Works in the terminal,
 * is invisible in the Desktop App, and therefore carries no relay instruction —
 * whoever reads this IS the person.
 */
export function renderAlertsForTerminal(alerts: readonly UserAlert[]): string {
  if (alerts.length === 0) return '';
  return alerts
    .map(a => (a.remediation ? `${a.line} ${a.remediation}` : a.line))
    .join('\n');
}
