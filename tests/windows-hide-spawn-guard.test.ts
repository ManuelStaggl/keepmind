import { describe, it, expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

// Regression guard: on Windows, a child process spawned without `windowsHide:
// true` flashes a console window. On hot paths (every hook resolves the project
// via `git rev-parse`, every compression spawns the SDK CLI) that means terminal
// windows flashing constantly — a real, reported UX bug. Every child_process
// spawn on a runtime path MUST pass windowsHide (or go through spawnHidden,
// which defaults it). This test fails the build if a new unguarded spawn lands.

const SRC_DIR = join(import.meta.dirname, '..', 'src');

// The spawn family that can open a console window on Windows. `spawnHidden` is
// our wrapper that defaults windowsHide, so it counts as guarded. Plain regex/DB
// `.exec(` is not a process spawn and is excluded by requiring the child_process
// verbs by name.
const SPAWN_RE = /\b(spawnSync|execFileSync|execSync|execFileAsync|execAsync|spawnHidden|(?<![.\w])spawn)\s*\(/g;

// Files where a console is acceptable / expected: one-time install commands and
// interactive CLI subcommands the user runs in their own terminal (not a
// background hook), so a visible child window is not a "flash" surprise.
const EXEMPT_FILE_PATTERNS: RegExp[] = [
  /npx-cli[\\/]install[\\/]/,            // installer runtime (bun/uv install)
  /npx-cli[\\/]utils[\\/]bun-resolver\./,// install-time bun resolution
  /npx-cli[\\/]commands[\\/]doctor\./,   // diagnostic CLI (user terminal)
  /npx-cli[\\/]commands[\\/]ide-detection\./,
  /integrations[\\/].*Installer\./,      // interactive IDE installers
];

// Commands only ever spawned on non-Windows (guarded by a process.platform
// branch): they never run on Windows, so windowsHide is moot. Keyed by the
// literal first argument passed to the spawn call.
const POSIX_ONLY_CMDS = new Set(["'ps'", '"ps"', "'which'", '"which"', "'tar'", '"tar"', "'sh'", '"sh"', "'bash'", '"bash"']);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.ts$/.test(entry) && !/\.d\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

describe('windowsHide spawn guard', () => {
  it('every runtime child_process spawn passes windowsHide (or uses spawnHidden)', () => {
    const offenders: string[] = [];

    for (const file of walk(SRC_DIR)) {
      const rel = relative(join(SRC_DIR, '..'), file).replace(/\\/g, '/');
      if (EXEMPT_FILE_PATTERNS.some(p => p.test(file))) continue;

      const content = readFileSync(file, 'utf-8');
      let m: RegExpExecArray | null;
      SPAWN_RE.lastIndex = 0;
      while ((m = SPAWN_RE.exec(content)) !== null) {
        const verb = m[1];
        if (verb === 'spawnHidden') continue; // wrapper defaults windowsHide

        // Skip matches inside comments (JSDoc mentions like "on every … spawn",
        // "Uses execFileSync (…)", or `// … after spawn (…)`): they are prose,
        // not calls. Check the match's own line up to the match index.
        const lineStart = content.lastIndexOf('\n', m.index) + 1;
        const before = content.slice(lineStart, m.index);
        const trimmed = before.trimStart();
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
        if (before.includes('//')) continue; // trailing line comment

        // Inspect the call's argument region (up to its options object).
        const region = content.slice(m.index, m.index + 400);

        // POSIX-only commands (first arg) never run on Windows.
        const firstArg = region.match(/\(\s*(['"][^'"]+['"])/)?.[1];
        if (firstArg && POSIX_ONLY_CMDS.has(firstArg)) continue;

        if (!/windowsHide/.test(region)) {
          const line = content.slice(0, m.index).split('\n').length;
          offenders.push(`${rel}:${line}  ${verb}(`);
        }
      }
    }

    if (offenders.length > 0) {
      throw new Error(
        'Found child_process spawn(s) without windowsHide on a runtime path — these flash a ' +
        'console window on Windows. Add `windowsHide: true` (or use spawnHidden), or exempt the ' +
        'site if it is install-time/CLI-only:\n  ' + offenders.join('\n  '),
      );
    }
    expect(offenders.length).toBe(0);
  });
});
