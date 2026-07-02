import { describe, it, expect, afterEach, mock } from 'bun:test';

// Substrate canary for the test-mocking layer. The suite runs under Node's
// --experimental-test-module-mocks via tests/bun-test-shim.ts, whose semantics
// have drifted across Node versions and platforms and cost real debugging time:
//   1. relative mock.module() specifiers must resolve against the CALLER — broke
//      under Linux/CI when tsx emitted bare POSIX stack frames the shim's regex
//      didn't match.
//   2. mock.module REPLACES the whole namespace — unmocked exports become
//      undefined, they do NOT fall through to the real module. A partial mock
//      must therefore provide EVERY export its consumer touches (this is the
//      contract the cli/handlers tests rely on).
//   3. mocking a builtin must skip NON-CONFIGURABLE exports (e.g. fs/os
//      `constants`) or node:test throws "Cannot redefine property" and crashes
//      the WHOLE run (seen on Node 24.18).
// If a future Node/tsx bump regresses any of these, THIS one test fails with a
// clear pointer — instead of dozens of scattered, cryptic failures elsewhere.

afterEach(() => { mock.restore(); });

describe('module-mock substrate canary', () => {
  it('resolves a relative mock.module specifier against the caller (not the shim)', async () => {
    mock.module('./fixtures/mock-canary-target.js', () => ({
      alpha: () => 'mocked-alpha',
      beta: () => 'mocked-beta',
    }));
    const mod = await import('./fixtures/mock-canary-target.js');
    expect(mod.alpha()).toBe('mocked-alpha');
  });

  it('REPLACES the namespace — an unmocked export is undefined, not the real one', async () => {
    mock.module('./fixtures/mock-canary-target.js', () => ({
      alpha: () => 'mocked-alpha',
      // beta intentionally omitted → the mock replaces the namespace, so beta is
      // NOT the real export; it is undefined. (Hence partial mocks must provide
      // every export the code-under-test imports.)
    }));
    const mod = await import('./fixtures/mock-canary-target.js');
    expect(mod.alpha()).toBe('mocked-alpha');
    expect((mod as { beta?: unknown }).beta).toBeUndefined();
  });

  it('mocks a builtin safely when non-configurable exports are skipped (no "Cannot redefine")', async () => {
    const realOs = (await import('node:os')).default ?? (await import('node:os'));
    // Build the factory the way runtime code must: copy only CONFIGURABLE own
    // props, so node:test never tries to ObjectDefineProperty a frozen export.
    const safe: Record<string, unknown> = {};
    for (const key of Object.keys(realOs as Record<string, unknown>)) {
      const d = Object.getOwnPropertyDescriptor(realOs, key);
      if (d && d.configurable === false) continue;
      safe[key] = (realOs as Record<string, unknown>)[key];
    }
    expect(() => {
      mock.module('node:os', () => ({ ...safe, hostname: () => 'canary-host' }));
    }).not.toThrow();

    const os = await import('node:os');
    expect(os.hostname()).toBe('canary-host');
  });
});
