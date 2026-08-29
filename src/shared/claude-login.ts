// SPDX-License-Identifier: Apache-2.0
//
// "Is the login usable again?" — the recheck S17 asks for.
//
// WHY THIS EXISTS
// ---------------
// The recheck path in SessionRoutes proved a repaired dependency by calling
// `findClaudeExecutable`. For a missing binary that is the right proof. For an
// expired login it proves nothing at all: the executable is exactly where it
// always was, so the check passes, the status is cleared, and the worker walks
// straight back into the same failure. Measured 29.08.2026: 44 attempts in one
// day, each one a spawned subprocess, none of them able to succeed.
//
// The proof for a login is the credential itself, read from the same place the
// spawn reads it (`readClaudeOAuthToken`) — so "the recheck says yes" and "the
// spawn will work" cannot disagree.

import { readClaudeOAuthToken } from './oauth-token.js';
import { loadKeepmindEnv } from './EnvManager.js';

export interface ClaudeLoginVerdict {
  usable: boolean;
  reason: string;
}

/**
 * Whether the Claude subprocess has a credential it can authenticate with.
 *
 * An explicitly configured API key / auth token / gateway is reported usable
 * without touching the keychain: OAuth is not the credential in play there, and
 * answering "not logged in" about a machine that never uses a login would block
 * the generator over a question that does not apply to it.
 */
export async function isClaudeLoginUsable(): Promise<ClaudeLoginVerdict> {
  const env = loadKeepmindEnv();
  if (
    env.ANTHROPIC_API_KEY ||
    env.ANTHROPIC_AUTH_TOKEN ||
    env.ANTHROPIC_BASE_URL ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN
  ) {
    return { usable: true, reason: 'explicit API credentials configured' };
  }

  try {
    const result = await readClaudeOAuthToken();
    if (result.kind === 'present') {
      return { usable: true, reason: `OAuth token present (${result.source})` };
    }
    return { usable: false, reason: result.reason };
  } catch (error) {
    // An unreadable credential store is NOT proof of a working login. Saying
    // "usable" here would restore the 44-attempts-a-day storm through the back
    // door; saying "not usable" costs one cooldown window and a log line.
    return {
      usable: false,
      reason: `credential store unreadable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
