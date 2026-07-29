import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const BUN_RUNNER_PATH = join(import.meta.dirname, '..', 'plugin', 'scripts', 'bun-runner.js');
const source = readFileSync(BUN_RUNNER_PATH, 'utf-8');

describe('bun-runner.js findBun: DEP0190 regression guard (#1503)', () => {
  it('does not use separate args array with shell:true (DEP0190 trigger pattern)', () => {
    const vulnerablePattern = /spawnSync\s*\(\s*(?:IS_WINDOWS\s*\?\s*['"]where['"]\s*:[^)]+|['"]where['"]),\s*\[[^\]]+\],\s*\{[^}]*shell\s*:\s*(?:true|IS_WINDOWS)/;
    expect(vulnerablePattern.test(source)).toBe(false);
  });

  it('uses a single string command for Windows where-node lookup', () => {
    // Runner migrated to the Node runtime: the Windows lookup is now `where node`.
    expect(source).toContain("spawnSync('where node'");
  });

  it('uses no shell option for Unix which-node lookup', () => {
    const unixCallMatch = source.match(/spawnSync\('which',\s*\['node'\],\s*\{([^}]+)\}/)
    if (unixCallMatch) {
      expect(unixCallMatch[1]).not.toContain('shell');
    }
    expect(source).toContain("spawnSync('which', ['node']");
  });
});

describe('bun-runner.js hook path: single Node process (perf plan P1)', () => {
  it('loads the slim hook client in-process via createRequire', () => {
    expect(source).toContain("import { createRequire } from 'module'");
    expect(source).toContain('createRequire(import.meta.url)(inProcessClient)');
  });

  it('only takes the in-process path for hook commands with a payload', () => {
    // KEEPMIND_HOOK_SPAWN=1 is the escape hatch back to the legacy two-process path.
    expect(source.includes('if (inProcessClient && hasPayload && !forceSpawn) {')).toBe(true);
    expect(source.includes("const forceSpawn = process.env.KEEPMIND_HOOK_SPAWN === '1';")).toBe(true);
    // inProcessClient is set ONLY inside the `hook` branch, so lifecycle
    // commands (start/stop/restart/status) can never reach the in-process path.
    const hookBranch = source.match(/if \(args\.includes\('hook'\)\) \{[\s\S]*?\n\}/);
    expect(hookBranch).not.toBeNull();
    // resolve()d, not the raw join: createRequire treats a relative string as a
    // bare module specifier and would look it up in node_modules.
    expect(hookBranch![0]).toContain('inProcessClient = resolve(slimClient)');
  });

  it('hands the already-drained payload over on the agreed global', () => {
    // Must match PRE_READ_STDIN_KEY in src/cli/stdin-reader.ts.
    expect(source).toContain('globalThis.__KEEPMIND_HOOK_STDIN = stdinData');
  });

  it('rewrites argv so the client still finds platform at argv[3] and event at argv[4]', () => {
    expect(source).toContain('process.argv = [process.argv[0], inProcessClient, ...args.slice(1)]');
  });

  it('falls back to spawning when the in-process load throws', () => {
    const fallbackBlock = source.match(/catch \(err\) \{[\s\S]*?spawnChild\(\);[\s\S]*?\}/);
    expect(fallbackBlock).not.toBeNull();
    expect(fallbackBlock![0]).toContain('delete globalThis.__KEEPMIND_HOOK_STDIN');
  });

  it('keeps the spawn path for everything that is not an in-process hook', () => {
    expect(source).toMatch(/\}\s*else\s*\{\s*\n\s*spawnChild\(\);\s*\n\}/);
  });

  it('still reports an empty stdin payload for hooks (#2188) before either path', () => {
    expect(source).toContain('function reportEmptyStdinAndExit()');
    expect(source).toMatch(/if \(!hasPayload && !isLifecycle\) \{\s*\n\s*reportEmptyStdinAndExit\(\);/);
    expect(source).toContain('CAPTURE_BROKEN');
  });
});
