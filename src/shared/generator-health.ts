// SPDX-License-Identifier: Apache-2.0
//
// The net under everything unknown (S13) and the state that survives the
// process that noticed it (S14).
//
// WHY THIS EXISTS
// ---------------
// On 28.08.2026 the worker was fully healthy for 31 hours — it accepted hooks,
// finalised sessions, answered MCP calls, and `/api/readiness` would have been
// green the whole time. Only the compression subprocess failed, 47 times, with
// `Failed to authenticate: OAuth session expired and could not be refreshed`.
// That text matched no branch of `classifyClaudeError`, so it fell into the
// generic arm and ended as one `logger.error` line. End of chain.
//
// Two rules follow, and the second is the load-bearing one:
//
//  - A KNOWN failure gets a named diagnosis and the right remediation (S12).
//    `auth_expired` is deliberately NOT `setup_required`: the latter's
//    remediation is "install or update the Claude CLI", which is the wrong
//    instruction when the executable is present and only the login is gone.
//
//  - An UNKNOWN failure still has to be noticed (S13). The pattern list will
//    always be incomplete — it was incomplete on 28.08. and it is incomplete
//    now — so N consecutive failures raise a state regardless of what the text
//    said. Without this, the next unrecognised error repeats the same silent
//    outage.
//
// And the state is written to disk (S14) rather than kept in a Map, because
// every process that could TELL the user — the session-start hook, `keepmind
// doctor` — is short-lived and does not share memory with the worker. The
// in-RAM `dependency-health.ts` map was only ever readable by asking the worker,
// which nobody does while things look fine.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import path from 'path';
import { DATA_DIR } from './paths.js';
import { logger } from '../utils/logger.js';

/** How the failure was diagnosed. `unknown` is the S13 net. */
export type GeneratorFailureKind = 'auth_expired' | 'setup_required' | 'unknown';

export interface GeneratorHealthState {
  /** Consecutive generator failures with no success in between. */
  consecutiveFailures: number;
  /** Epoch ms of the first failure in the current run. */
  firstFailureAtMs: number;
  /** Epoch ms of the most recent failure. */
  lastFailureAtMs: number;
  /** Verbatim message of the most recent failure, clipped. */
  lastError: string;
  /** Provider the failures came from. */
  provider: string;
  kind: GeneratorFailureKind;
  /**
   * True once the state is worth telling a person about: either a recognised
   * fatal kind, or `consecutiveFailures >= threshold`.
   */
  degraded: boolean;
  /** What the person should actually do. Empty when not degraded. */
  remediation: string;
}

const EMPTY: GeneratorHealthState = {
  consecutiveFailures: 0,
  firstFailureAtMs: 0,
  lastFailureAtMs: 0,
  lastError: '',
  provider: '',
  kind: 'unknown',
  degraded: false,
  remediation: '',
};

/**
 * Three, not one: a single failure is routinely transient (an aborted
 * subprocess, a network blip), and raising a state for it would train the
 * reader to ignore the channel. Three in a row with no success in between has
 * never been transient in the measured record.
 */
export const GENERATOR_FAIL_THRESHOLD_DEFAULT = 3;

export const AUTH_EXPIRED_REMEDIATION =
  'The Claude CLI is installed but not logged in. Run `claude auth login`, then keepmind resumes on its own.';

const UNKNOWN_REMEDIATION =
  'The observer subprocess keeps failing. Check ~/.keepmind/logs for the "Generator failed" lines, ' +
  'and run `keepmind doctor`.';

const MAX_ERROR_CHARS = 400;

function stateDir(): string {
  return path.join(DATA_DIR, 'state');
}

function statePath(): string {
  return path.join(stateDir(), 'generator-health.json');
}

export function readGeneratorHealth(): GeneratorHealthState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf-8')) as Partial<GeneratorHealthState>;
    const num = (v: unknown): number =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
    return {
      consecutiveFailures: num(parsed.consecutiveFailures),
      firstFailureAtMs: num(parsed.firstFailureAtMs),
      lastFailureAtMs: num(parsed.lastFailureAtMs),
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : '',
      provider: typeof parsed.provider === 'string' ? parsed.provider : '',
      kind:
        parsed.kind === 'auth_expired' || parsed.kind === 'setup_required' ? parsed.kind : 'unknown',
      degraded: parsed.degraded === true,
      remediation: typeof parsed.remediation === 'string' ? parsed.remediation : '',
    };
  } catch {
    return { ...EMPTY };
  }
}

function writeAtomic(state: GeneratorHealthState): void {
  const dest = statePath();
  const tmp = `${dest}.tmp`;
  try {
    const dir = stateDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    renameSync(tmp, dest);
  } catch (error: unknown) {
    logger.debug('SYSTEM', 'Failed to persist generator-health state', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * The one place a failure text is turned into a diagnosis.
 *
 * Kept separate from `classifyClaudeError` on purpose: that function answers
 * "should this be retried", this one answers "what should the person do". They
 * disagreed about exactly this case — an expired login classified as
 * `transient`, retried 44 times in one day, with nothing said to anyone.
 */
export function classifyGeneratorFailure(message: string): GeneratorFailureKind {
  const text = message.toLowerCase();
  if (
    text.includes('failed to authenticate') ||
    text.includes('oauth session expired') ||
    text.includes('could not be refreshed') ||
    text.includes('oauth token has expired') ||
    text.includes('please run `claude login`') ||
    text.includes('please run /login')
  ) {
    return 'auth_expired';
  }
  if (
    text.includes('claude executable not found') ||
    text.includes('enoent') ||
    text.includes('every claude cli found is too old')
  ) {
    return 'setup_required';
  }
  return 'unknown';
}

function remediationFor(kind: GeneratorFailureKind): string {
  if (kind === 'auth_expired') return AUTH_EXPIRED_REMEDIATION;
  if (kind === 'setup_required') {
    return 'The Claude CLI could not be started. Run `claude update` or `npm install -g @anthropic-ai/claude-code@latest`.';
  }
  return UNKNOWN_REMEDIATION;
}

/**
 * Count one generator failure and persist the result.
 *
 * A recognised fatal kind (`auth_expired`, `setup_required`) is degraded from
 * the FIRST occurrence — there is nothing transient about a missing login, and
 * waiting for three costs three more sessions with no memory. Everything else
 * needs `threshold` in a row, which is S13's whole point: the state does not
 * depend on the text being recognised.
 */
export function recordGeneratorFailure(
  provider: string,
  message: string,
  threshold: number = GENERATOR_FAIL_THRESHOLD_DEFAULT,
): GeneratorHealthState {
  const previous = readGeneratorHealth();
  const kind = classifyGeneratorFailure(message);
  const now = Date.now();
  const consecutiveFailures = previous.consecutiveFailures + 1;
  const degraded = kind !== 'unknown' || consecutiveFailures >= threshold;

  const next: GeneratorHealthState = {
    consecutiveFailures,
    firstFailureAtMs: previous.firstFailureAtMs || now,
    lastFailureAtMs: now,
    lastError: message.slice(0, MAX_ERROR_CHARS),
    provider,
    kind,
    degraded,
    remediation: degraded ? remediationFor(kind) : '',
  };
  writeAtomic(next);

  if (degraded && !previous.degraded) {
    // WARN, not debug: this is the moment the outage becomes knowable, and a
    // signal that only shows at DEBUG is the failure mode this file exists to
    // end.
    logger.warn('SYSTEM', 'Observer generator is failing — memory capture is stopped', {
      provider,
      kind,
      consecutiveFailures,
      remediation: next.remediation,
      error: next.lastError,
    });
  }
  return next;
}

/** A generator that ran to completion clears the state. */
export function recordGeneratorSuccess(): void {
  const previous = readGeneratorHealth();
  if (previous.consecutiveFailures === 0 && !previous.degraded) return;
  if (previous.degraded) {
    logger.info('SYSTEM', 'Observer generator recovered — memory capture resumed', {
      afterFailures: previous.consecutiveFailures,
      kind: previous.kind,
    });
  }
  writeAtomic({ ...EMPTY });
}

/** Test seam: forget the persisted state without touching the disk layout. */
export function clearGeneratorHealthForTesting(): void {
  writeAtomic({ ...EMPTY });
}
