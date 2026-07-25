import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRequire } from 'node:module';
import { spawnSync as nodeSpawnSync, spawn as nodeSpawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Data-dir tripwire (Phase 6, worker-restart plan): no test may ever touch the
 * real ~/.claude-mem. src/shared/paths.ts freezes DATA_DIR at first evaluation
 * (env KEEPMIND_DATA_DIR wins), and module-level consts like ProcessManager's
 * PID_FILE inherit that frozen value — so the env var must point at a safe
 * directory BEFORE any module loads. This preload runs first (bunfig.toml
 * [test].preload), so when the env var is unset we pin it to a fresh per-run
 * temp dir. Tests that want tighter isolation still override it per-file /
 * per-test; this only fills the default so nothing can fall through to the
 * real data dir. The leaked temp dir per run is deliberate: correctness over
 * cleanup (an afterAll here could rip the dir out from under frozen module
 * constants while later test files still run).
 */
if (!process.env.KEEPMIND_DATA_DIR) {
  process.env.KEEPMIND_DATA_DIR = mkdtempSync(join(tmpdir(), 'claude-mem-test-run-'));
}

// ── Node-runtime compat globals ──────────────────────────────────────────────
// The suite was authored for bun, which exposes a global `require` even in ESM
// and a `Bun` runtime namespace. Under `node --import tsx` neither exists, so a
// handful of test files fail at load with `require is not defined` / `Bun is not
// defined`. These shims provide the narrow surface the suite actually uses
// (bare + relative require, Bun.spawnSync/spawn/file) mapped onto node built-ins.
const g = globalThis as unknown as Record<string, unknown>;

if (typeof g.require === 'undefined') {
  // Resolve the first stack frame outside this preload so a RELATIVE
  // `require('../../src/x.js')` resolves against the CALLING test file (bun/CJS
  // semantics) rather than this preload's location. Bare specifiers ('fs', 'os')
  // resolve from the project root either way.
  const fallbackRequire = createRequire(import.meta.url);
  function callerFile(): string | undefined {
    const stack = new Error().stack ?? '';
    for (const line of stack.split('\n').slice(2)) {
      if (line.includes('preload.ts')) continue;
      if (line.includes('node:')) continue;
      // The trailing `\/[^():]+` alternative matches bare POSIX absolute paths
      // (`/home/…`) that tsx emits under Linux/CI — without it a relative
      // require() resolved from the project root instead of the caller.
      const m = line.match(/\(?(file:\/\/\/[^):]+|[A-Za-z]:[\\/][^):]+|\/[^():]+)(?::\d+:\d+)?\)?$/);
      if (m) {
        const raw = m[1];
        try { return raw.startsWith('file:') ? fileURLToPath(raw) : raw; } catch { return raw; }
      }
    }
    return undefined;
  }
  g.require = (specifier: string): unknown => {
    if (specifier.startsWith('.')) {
      const caller = callerFile();
      if (caller) return createRequire(pathToFileURL(caller).href)(specifier);
    }
    return fallbackRequire(specifier);
  };
}

if (typeof g.Bun === 'undefined') {
  const toPath = (p: unknown): string =>
    p instanceof URL ? fileURLToPath(p) : String(p);
  g.Bun = {
    // bun's spawnSync({cmd,cwd,env,stdout,stderr}) → {stdout,stderr:Uint8Array,exitCode}
    spawnSync(opts: { cmd: string[]; cwd?: string; env?: NodeJS.ProcessEnv }) {
      const [command, ...args] = opts.cmd;
      const r = nodeSpawnSync(command, args, { cwd: opts.cwd, env: opts.env });
      return {
        stdout: r.stdout ?? new Uint8Array(),
        stderr: r.stderr ?? new Uint8Array(),
        exitCode: r.status ?? 0,
        success: (r.status ?? 0) === 0,
      };
    },
    // bun's spawn(cmd[], opts) → subprocess with `.exited` promise + `.exitCode`.
    spawn(cmd: string[]) {
      const [command, ...args] = cmd;
      const child = nodeSpawn(command, args, { stdio: 'ignore' });
      const sub: { exitCode: number | null; exited: Promise<number> } = {
        exitCode: null,
        exited: new Promise<number>((resolve) => {
          child.on('close', (code) => { sub.exitCode = code ?? 0; resolve(code ?? 0); });
          child.on('error', () => { sub.exitCode = 1; resolve(1); });
        }),
      };
      return sub;
    },
    // bun's Bun.file(path).text() — path may be a string or URL.
    file(p: unknown) {
      const path = toPath(p);
      return { text: async () => readFileSync(path, 'utf-8') };
    },
  };
}

// ── Default mode load ────────────────────────────────────────────────────────
// ModeManager.getActiveMode() throws "No mode loaded. Call loadMode() first."
// until a mode is loaded. Several suites transitively reach it (parseAgentXml,
// response processing) without an explicit setup. Load the bundled `code` mode
// once here — no test asserts the unloaded-throw as desired behavior, and the
// suites that DO care about mode state manage it explicitly (loadMode / reset).
try {
  const { ModeManager } = await import('../src/services/domain/ModeManager.js');
  ModeManager.getInstance().loadMode('code');
} catch {
  // Non-fatal: a missing bundled mode surfaces in the suites that need it.
}
