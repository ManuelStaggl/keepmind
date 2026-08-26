// SPDX-License-Identifier: Apache-2.0
//
// One place that answers "is Bun here, and which one".
//
// WHY THIS EXISTS AS THE ONLY ONE. There were three implementations of this
// question and they disagreed, in public, on the same machine in the same
// minute:
//
//   • the installer resolved PATH and then fell back to `~/.bun/bin`, so it
//     found the Bun it had just installed there and reported
//     "Runtime ready (Bun 1.3.14) OK";
//   • `doctor` probed PATH only, so in a shell whose PATH predated that install
//     it reported "Bun runtime not found" — and its remedy told the operator to
//     `winget install Oven-sh.Bun`, which they already had;
//   • THIS module had the most thorough candidate list of the three and NO
//     CALLERS AT ALL.
//
// Reported from a company machine on 2026-08-26, where the install log and the
// health check contradicted each other about the same binary.
//
// A NOTE ON `shell`. Passing an argv array together with `shell: true` trips
// Node's DEP0190 deprecation, which prints a two-line warning to stderr — it is
// the warning that appeared mid-install in that same report. `doctor` had
// already documented the trap next to its own probe; this module had the bug.
// On Windows the whole command therefore goes as ONE string, and `bun` is
// resolved with `where` so a `.cmd`/`.exe` shim is still found.

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { IS_WINDOWS } from './paths.js';

function bunCandidatePaths(): string[] {
  if (IS_WINDOWS) {
    return [
      join(homedir(), '.bun', 'bin', 'bun.exe'),
      join(process.env.USERPROFILE || homedir(), '.bun', 'bin', 'bun.exe'),
    ];
  }

  return [
    join(homedir(), '.bun', 'bin', 'bun'),
    '/usr/local/bin/bun',
    '/opt/homebrew/bin/bun',
    '/home/linuxbrew/.linuxbrew/bin/bun',
  ];
}

/**
 * The command or path to invoke Bun with, or null.
 *
 * PATH first, because that is what the operator's own shell would use. The
 * candidate paths after it are what makes this honest immediately after an
 * install: Bun lands in `~/.bun/bin`, and the shell that ran the installer does
 * not learn about it until it is restarted. Reporting "not found" there is
 * true of the PATH and false of the machine.
 */
export function resolveBunBinaryPath(): string | null {
  // One string, never (args + shell) — see the DEP0190 note above.
  const pathCheck = IS_WINDOWS
    ? spawnSync('where bun', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], shell: true })
    : spawnSync('which', ['bun'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });

  if (pathCheck.status === 0 && pathCheck.stdout?.trim()) {
    return 'bun';
  }

  for (const candidatePath of bunCandidatePaths()) {
    if (existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return null;
}

/** Whether Bun can be invoked at all — the installer's question. */
export function isBunAvailable(): boolean {
  return resolveBunBinaryPath() !== null;
}

/**
 * Bun's version string, or null when it cannot be run.
 *
 * Both the installer and the health check ask this, and they must not be able
 * to answer it differently.
 */
export function resolveBunVersion(): string | null {
  const bunPath = resolveBunBinaryPath();
  if (!bunPath) return null;

  try {
    // `bun` from PATH may be a shim needing a shell; an absolute path never is.
    const result = bunPath === 'bun' && IS_WINDOWS
      ? spawnSync('bun --version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], shell: true })
      : spawnSync(bunPath, ['--version'], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return result.status === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}
