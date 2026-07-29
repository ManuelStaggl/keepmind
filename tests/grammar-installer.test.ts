import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { DATA_DIR } from '../src/shared/paths.js';
import {
  requestGrammarInstall,
  resolveOnDemandGrammar,
  resetGrammarInstallerForTesting,
  type GrammarInstallDeps,
} from '../src/services/smart-file-read/grammar-installer.js';

const GRAMMARS_DIR = join(DATA_DIR, 'grammars');
const STATE_PATH = join(GRAMMARS_DIR, '.install-state.json');

/** Records what would have been run. Never spawns a process or hits the network. */
function fakeDeps(outcome: Error | null = null, bun: string | null = '/fake/bun') {
  const calls: Array<{ command: string; cwd: string }> = [];
  const deps: GrammarInstallDeps = {
    findBun: () => bun,
    runInstall: (command, cwd, done) => {
      calls.push({ command, cwd });
      done(outcome);
    },
  };
  return { deps, calls };
}

function readFailures(): Record<string, number> {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8')).failures ?? {};
  } catch {
    return {};
  }
}

describe('on-demand grammar installer', () => {
  beforeEach(() => {
    resetGrammarInstallerForTesting();
    delete process.env.KEEPMIND_GRAMMAR_AUTOINSTALL;
    try { rmSync(GRAMMARS_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });
  afterEach(() => {
    resetGrammarInstallerForTesting();
    delete process.env.KEEPMIND_GRAMMAR_AUTOINSTALL;
    try { rmSync(GRAMMARS_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('opt-out', () => {
    it('spawns nothing when KEEPMIND_GRAMMAR_AUTOINSTALL=0', () => {
      process.env.KEEPMIND_GRAMMAR_AUTOINSTALL = '0';
      const { deps, calls } = fakeDeps();

      expect(requestGrammarInstall('swift', 'tree-sitter-swift', undefined, deps)).toBe(false);
      expect(calls).toHaveLength(0);
      expect(existsSync(GRAMMARS_DIR)).toBe(false);
    });

    it('does not consume the language attempt while opted out', () => {
      // Otherwise lifting the flag mid-process would silently never install.
      process.env.KEEPMIND_GRAMMAR_AUTOINSTALL = '0';
      const { deps: offDeps } = fakeDeps();
      requestGrammarInstall('swift', 'tree-sitter-swift', undefined, offDeps);
      requestGrammarInstall('swift', 'tree-sitter-swift', undefined, offDeps);

      delete process.env.KEEPMIND_GRAMMAR_AUTOINSTALL;
      const { deps, calls } = fakeDeps();
      expect(requestGrammarInstall('swift', 'tree-sitter-swift', undefined, deps)).toBe(true);
      expect(calls).toHaveLength(1);
    });
  });

  describe('install command', () => {
    it('runs `bun add` for the package, into the grammar directory', () => {
      const { deps, calls } = fakeDeps();

      expect(requestGrammarInstall('swift', 'tree-sitter-swift', undefined, deps)).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0].command).toContain('add tree-sitter-swift');
      expect(calls[0].cwd).toBe(GRAMMARS_DIR);
    });

    it('skips postinstall scripts', () => {
      // Grammars ship prebuilt binaries; running untrusted postinstalls to parse
      // a source file would be a poor trade.
      const { deps, calls } = fakeDeps();
      requestGrammarInstall('swift', 'tree-sitter-swift', undefined, deps);
      expect(calls[0].command).toContain('--ignore-scripts');
    });

    it('pins a version when one is given', () => {
      const { deps, calls } = fakeDeps();
      requestGrammarInstall('swift', 'tree-sitter-swift', '0.7.1', deps);
      expect(calls[0].command).toContain('tree-sitter-swift@0.7.1');
    });

    it('creates a private workspace so the plugin lockfile is untouched', () => {
      const { deps } = fakeDeps();
      requestGrammarInstall('swift', 'tree-sitter-swift', undefined, deps);

      const pkg = JSON.parse(readFileSync(join(GRAMMARS_DIR, 'package.json'), 'utf-8'));
      expect(pkg.private).toBe(true);
      expect(pkg.name).toBe('keepmind-grammars');
    });

    it('does nothing but record a failure when Bun is absent', () => {
      const { deps, calls } = fakeDeps(null, null);

      expect(requestGrammarInstall('swift', 'tree-sitter-swift', undefined, deps)).toBe(false);
      expect(calls).toHaveLength(0);
      expect(readFailures().swift).toBeGreaterThan(0);
    });
  });

  describe('once per process', () => {
    it('attempts a language at most once per worker lifetime', () => {
      // A burst of 2000 files in one language must trigger one install, not 2000.
      const { deps, calls } = fakeDeps();

      expect(requestGrammarInstall('swift', 'tree-sitter-swift', undefined, deps)).toBe(true);
      expect(requestGrammarInstall('swift', 'tree-sitter-swift', undefined, deps)).toBe(false);
      expect(requestGrammarInstall('swift', 'tree-sitter-swift', undefined, deps)).toBe(false);
      expect(calls).toHaveLength(1);
    });

    it('tracks languages independently', () => {
      const { deps, calls } = fakeDeps();
      requestGrammarInstall('swift', 'tree-sitter-swift', undefined, deps);
      expect(requestGrammarInstall('scala', 'tree-sitter-scala', undefined, deps)).toBe(true);
      expect(calls).toHaveLength(2);
    });
  });

  describe('failure cooldown', () => {
    it('records a failure when the install fails', () => {
      const { deps } = fakeDeps(new Error('offline'));
      requestGrammarInstall('swift', 'tree-sitter-swift', undefined, deps);
      expect(readFailures().swift).toBeGreaterThan(0);
    });

    it('clears the recorded failure after a success', () => {
      mkdirSync(GRAMMARS_DIR, { recursive: true });
      // Must be OUTSIDE the cooldown, or the retry never runs to clear it.
      writeFileSync(STATE_PATH, JSON.stringify({ failures: { swift: Date.now() - 24 * 60 * 60 * 1000 } }));

      const { deps } = fakeDeps(null);
      requestGrammarInstall('swift', 'tree-sitter-swift', undefined, deps);

      expect(readFailures().swift).toBeUndefined();
    });

    it('skips a language whose recent attempt failed', () => {
      mkdirSync(GRAMMARS_DIR, { recursive: true });
      writeFileSync(STATE_PATH, JSON.stringify({ failures: { swift: Date.now() } }));

      const { deps, calls } = fakeDeps();
      expect(requestGrammarInstall('swift', 'tree-sitter-swift', undefined, deps)).toBe(false);
      expect(calls).toHaveLength(0);
    });

    it('retries once the cooldown has elapsed', () => {
      mkdirSync(GRAMMARS_DIR, { recursive: true });
      writeFileSync(STATE_PATH, JSON.stringify({ failures: { swift: Date.now() - 24 * 60 * 60 * 1000 } }));

      const { deps, calls } = fakeDeps();
      expect(requestGrammarInstall('swift', 'tree-sitter-swift', undefined, deps)).toBe(true);
      expect(calls).toHaveLength(1);
    });

    it('treats a corrupt state file as no recorded failures', () => {
      mkdirSync(GRAMMARS_DIR, { recursive: true });
      writeFileSync(STATE_PATH, '{ not json');

      const { deps } = fakeDeps();
      expect(() => requestGrammarInstall('swift', 'tree-sitter-swift', undefined, deps)).not.toThrow();
    });
  });

  describe('resolution', () => {
    it('returns null for a grammar that was never fetched', () => {
      expect(resolveOnDemandGrammar('tree-sitter-swift')).toBeNull();
    });

    it('returns null rather than throwing for a nonsense package name', () => {
      expect(resolveOnDemandGrammar('@keepmind/definitely-not-real')).toBeNull();
    });

    it('does not create the grammar directory just by resolving', () => {
      resolveOnDemandGrammar('tree-sitter-swift');
      expect(existsSync(GRAMMARS_DIR)).toBe(false);
    });
  });
});
