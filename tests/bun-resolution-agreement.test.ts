import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveBunBinaryPath, resolveBunVersion, isBunAvailable } from '../src/npx-cli/utils/bun-resolver.js';

const __dirname = import.meta.dirname;
const SRC = join(__dirname, '..', 'src');

/**
 * Reported from a company machine, minutes apart, about the same binary:
 *
 *   installer:  "Runtime ready (Bun 1.3.14) OK"
 *   doctor:     "Bun runtime not found — … `winget install Oven-sh.Bun`"
 *
 * Three implementations of "where is Bun" existed. The installer resolved PATH
 * and fell back to `~/.bun/bin`, so it saw the Bun it had just put there; the
 * health check probed PATH only, and the shell that ran the installer had not
 * learned about it yet; and the module written to be the shared one had NO
 * CALLERS AT ALL.
 */
describe('bun resolution', () => {
  it('gives one answer, and the version agrees with it', () => {
    const path = resolveBunBinaryPath();
    expect(isBunAvailable()).toBe(path !== null);

    const version = resolveBunVersion();
    if (path === null) {
      expect(version).toBeNull();
      return;
    }
    // Whatever this machine has, a resolvable Bun must be runnable — the split
    // being guarded against is precisely "found by one rule, not by the other".
    expect(version).not.toBeNull();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  // The bug was not that a rule was wrong; it was that there were several.
  it('is asked in exactly one place', () => {
    const offenders: string[] = [];
    for (const file of ['npx-cli/install/setup-runtime.ts', 'npx-cli/commands/doctor.ts']) {
      const source = readFileSync(join(SRC, file), 'utf8');
      source.split('\n').forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        // A candidate path or a version probe spelled out locally is a second rule.
        if (/'\.bun'|"\.bun"/.test(line)) offenders.push(`${file}:${index + 1}: ${trimmed}`);
        if (/spawnSync\(\s*'bun'/.test(line)) offenders.push(`${file}:${index + 1}: ${trimmed}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  /**
   * Passing an argv array together with `shell: true` trips Node's DEP0190 and
   * prints a two-line deprecation warning to stderr — seen mid-install in the
   * same report, immediately before the "Runtime ready (Bun …)" line.
   */
  it('never passes an argv array together with shell:true', () => {
    const source = readFileSync(join(SRC, 'npx-cli/utils/bun-resolver.ts'), 'utf8');
    // Each spawnSync call, from its opening paren to the closing brace of options.
    const calls = source.match(/spawnSync\([^;]*?\}\)/gs) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const passesArgv = /spawnSync\(\s*[^,]+,\s*\[/.test(call);
      const usesShell = /shell:\s*(true|IS_WINDOWS)/.test(call);
      expect(passesArgv && usesShell).toBe(false);
    }
  });
});
