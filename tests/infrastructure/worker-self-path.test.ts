import { describe, it, expect } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { selfScriptPath } from '../../src/services/worker-service.js';

// node ESM has no __dirname (bun provides it); node 20.11+ exposes import.meta.dirname.
const __dirname = import.meta.dirname;
const WORKER_SOURCE = path.join(__dirname, '../../src/services/worker-service.ts');

/**
 * `__dirname` and `__filename` exist in the CJS bundle that ships and under
 * bun, and are a ReferenceError under raw ESM — a THROW, not a wrong value.
 * This file had four spellings of "where am I", three of them bare. Two hid
 * behind `??` and fired only when the resolver ahead of them came up empty;
 * the third killed `start` outright, and a fourth bare `__dirname` aborted
 * `initializeBackground` halfway with a single ERROR line.
 *
 * None of them could be SEEN before 4.4.1, because until the entry guard was
 * fixed nothing in this file ran under ESM at all.
 */
describe('worker-service self path', () => {
  it('answers with a file that exists, under either runtime', () => {
    const resolved = selfScriptPath();
    expect(resolved.length).toBeGreaterThan(0);
    expect(existsSync(resolved)).toBe(true);
    expect(path.basename(resolved)).toMatch(/^worker-service\.(ts|cjs|js)$/);
  });

  // The helpers are the containment: anything else naming these globals is a
  // new copy of the rule, and a copy is how one of them goes back to throwing.
  it('names __dirname/__filename only inside the two guarded helpers', () => {
    const source = readFileSync(WORKER_SOURCE, 'utf8');
    const offenders: string[] = [];

    source.split('\n').forEach((line, index) => {
      if (!/__dirname|__filename/.test(line)) return;
      const trimmed = line.trim();
      // Prose about the globals is not a use of them.
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      // The guarded helpers, which are the only sanctioned mention.
      if (/typeof __dirname !== 'undefined'/.test(line)) return;
      if (/typeof __filename !== 'undefined'/.test(line)) return;
      offenders.push(`${index + 1}: ${trimmed}`);
    });

    expect(offenders).toEqual([]);
  });
});
