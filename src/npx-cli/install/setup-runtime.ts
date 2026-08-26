import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { createHash } from 'crypto';
import { exec, execSync, spawnSync } from 'child_process';
import { createRequire } from 'module';
import { awaitDepsInstallLock } from '../../shared/plugin-workspace.js';
import { join } from 'path';
import { homedir } from 'os';
import { ErrorSeverity } from './error-taxonomy.js';
import { installerError, type InstallSummary } from './error-reporter.js';
import { IS_WINDOWS } from '../utils/paths.js';
import { envValue } from '../../shared/legacy-env.js';
import { certErrorCodeOf, describeCertInterception, findCertErrorCode } from '../../shared/tls-errors.js';
import { isBunAvailable, resolveBunBinaryPath, resolveBunVersion } from '../utils/bun-resolver.js';

const INSTALL_TIMEOUT_MS = (() => {
  const override = envValue('KEEPMIND_INSTALL_TIMEOUT_MS');
  if (override && Number.isFinite(Number(override))) return Number(override);
  return 5 * 60 * 1000;
})();

/**
 * Platform-specific manual-install instructions, surfaced as the PRIMARY ABORT
 * message when auto-install fails or the binary can't be found afterward.
 */
export function platformBunRemediation(): string {
  return IS_WINDOWS
    ? 'Install Bun manually: `winget install Oven-sh.Bun` (or `powershell -c "irm bun.sh/install.ps1 | iex"`), then re-run `npx keepmind install`.'
    : 'Install Bun manually: `curl -fsSL https://bun.sh/install | bash` (or `brew install oven-sh/bun/bun`), then re-run `npx keepmind install`.';
}

interface MarkerSchema {
  version: string;
  bun?: string;
  installedAt?: string;
  /** Fingerprint of the manifest's dependency set at install time — see pruneIfDependencySetChanged. */
  deps?: string;
}

/**
 * Stable fingerprint of a manifest's declared dependency set (deps + the
 * overrides that redirect them). Only what we declare, never the resolved
 * closure — the point is to notice when WE change what should be installed.
 */
function dependencyFingerprint(targetDir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
      overrides?: Record<string, string>;
    };
    const flatten = (obj: Record<string, string> | undefined): string =>
      Object.entries(obj ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}@${v}`).join(',');
    return createHash('sha256')
      .update(`${flatten(pkg.dependencies)}|${flatten(pkg.overrides)}`)
      .digest('hex')
      .slice(0, 16);
  } catch {
    return null;
  }
}

const LEGACY_VERSION_MARKER_RE =
  /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function markerPath(targetDir: string): string {
  return join(targetDir, '.install-version');
}

// "Where is Bun" is answered in exactly one place — `utils/bun-resolver.ts`.
// There used to be three answers to it, and two of them contradicted each other
// on a live machine: this file reported "Runtime ready (Bun 1.3.14) OK" while
// `doctor`, probing PATH only, reported "not found" and told the operator to
// install what they already had. The local copies also passed an argv array
// together with `shell: true`, which is Node's DEP0190 — the deprecation
// warning that appeared mid-install in that same report.
function getBunPath(): string | null {
  return resolveBunBinaryPath();
}

function isBunInstalled(): boolean {
  return isBunAvailable();
}

function getBunVersion(): string | null {
  return resolveBunVersion();
}

/** How much of a dead child's output is evidence, and how much is noise. */
const EXEC_ERROR_MAX_LINES = 8;

/** Keep a multi-line explanation visually under the warning it belongs to. */
function indentBlock(text: string): string {
  return text.split('\n').map(line => (line ? `    ${line}` : '')).join('\n');
}

function clipOutput(text: string): string {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length <= EXEC_ERROR_MAX_LINES) return lines.join('\n');
  const shown = lines.slice(0, EXEC_ERROR_MAX_LINES).join('\n');
  return `${shown}\n    … ${lines.length - EXEC_ERROR_MAX_LINES} more line(s)`;
}

/**
 * Explain a dead child process — and when the explanation is known, GIVE it
 * rather than handing over the corpse.
 *
 * Two faults, both measured on a real company-machine install:
 *
 *   • It printed the same output twice. Node's `exec` builds its error message
 *     as `Command failed: <cmd>` followed by the child's stderr, so appending
 *     `stderr:` after it repeats every line — for a child that died on an
 *     unhandled 'error' event, that is two full crash traces, about 30 lines,
 *     for ONE non-fatal warning.
 *   • It never named the cause. A rejected TLS chain is a specific, common and
 *     fixable condition that `doctor` has always diagnosed by name, and the
 *     installer showed the operator a stack trace instead. A successful install
 *     read as a crash.
 *
 * `retryWith` is the command that re-attempts what just failed, so the remedy
 * ends with a step instead of a diagnosis.
 */
export function describeExecError(error: unknown, retryWith?: string): string {
  if (!error || typeof error !== 'object') return String(error);

  const e = error as { message?: string; stdout?: Buffer | string; stderr?: Buffer | string };
  const message = e.message?.trim() ?? '';
  const stderr = e.stderr ? e.stderr.toString().trim() : '';
  const stdout = e.stdout ? e.stdout.toString().trim() : '';

  const parts: string[] = [];
  if (message) parts.push(message);
  // Only what the message does not already carry. `exec` folds stderr into it;
  // `execSync` and a plain Error do not.
  if (stderr && !message.includes(stderr)) parts.push(`stderr: ${stderr}`);
  if (!stderr && stdout && !message.includes(stdout)) parts.push(`stdout: ${stdout}`);
  const raw = parts.join('\n');

  const certCode = certErrorCodeOf(error) ?? findCertErrorCode(raw);
  if (!certCode) return clipOutput(raw);

  // The code is the evidence; the trace around it is not. Keep the one line
  // that names it so the diagnosis can still be checked, and drop the rest.
  const evidence = raw.split(/\r?\n/).find(line => line.includes(certCode))?.trim();
  return [
    describeCertInterception(certCode, retryWith),
    ...(evidence ? ['', `Reported as: ${evidence}`] : []),
  ].join('\n');
}

function installBun(): void {
  try {
    if (IS_WINDOWS) {
      execSync('powershell -c "irm bun.sh/install.ps1 | iex"', {
        stdio: 'pipe',
        timeout: INSTALL_TIMEOUT_MS,
        shell: process.env.ComSpec ?? 'cmd.exe',
      });
    } else {
      execSync('curl -fsSL https://bun.sh/install | bash', {
        stdio: 'pipe',
        timeout: INSTALL_TIMEOUT_MS,
        shell: '/bin/bash',
      });
    }

    if (!isBunInstalled()) {
      throw new Error(
        'Bun installation completed but binary not found. Please restart your terminal and try again.',
      );
    }
  } catch (error) {
    const manualInstructions = IS_WINDOWS
      ? '  - winget install Oven-sh.Bun\n  - Or: powershell -c "irm bun.sh/install.ps1 | iex"'
      : '  - curl -fsSL https://bun.sh/install | bash\n  - Or: brew install oven-sh/bun/bun';
    throw new Error(
      `Failed to install Bun. Please install manually:\n${manualInstructions}\nThen restart your terminal and try again.\n` +
        `Underlying error: ${describeExecError(error, 'npx keepmind install')}`,
    );
  }
}

/**
 * Subpath imports the bundled worker requires transitively (via
 * @modelcontextprotocol/sdk / @anthropic-ai/claude-agent-sdk). A stale/partial
 * install can leave the `zod` directory present while these subpath exports fail
 * to resolve — surfacing later as a runtime `Cannot find module 'zod/v3'`. We
 * assert them at install time so a broken closure fails LOUD here. Version-agnostic:
 * we resolve subpaths, never a pinned version.
 */
const ZOD_REQUIRED_SUBPATHS = ['zod/v3', 'zod/v4', 'zod/v4-mini'] as const;

export function verifyCriticalModules(targetDir: string): void {
  const pkg = JSON.parse(readFileSync(join(targetDir, 'package.json'), 'utf-8'));
  const dependencies = Object.keys(pkg.dependencies || {});

  const nodeModulesPath = join(targetDir, 'node_modules');
  // A require anchored inside the install tree so require.resolve honors the
  // installed package.json `exports` map for subpath resolution.
  const requireFromTarget = createRequire(join(nodeModulesPath, 'noop.js'));
  const resolvePaths = [nodeModulesPath];

  const unresolvable: string[] = [];
  const escaped: string[] = [];

  /**
   * Resolution must land INSIDE the install tree. Node walks parent directories,
   * so a package sitting in an unrelated node_modules above the target (a user's
   * ~/node_modules, a repo checkout) satisfies `resolve` while the tree we just
   * built is missing it — turning a broken install into a green one that fails
   * later at runtime, somewhere else. This matters more now that the tree lives
   * under ~/.claude rather than beside the bundle.
   */
  const resolvesInsideTarget = (spec: string): boolean => {
    const resolved = requireFromTarget.resolve(spec, { paths: resolvePaths });
    return resolved.startsWith(nodeModulesPath);
  };

  // Each declared dependency must be installed, not merely a directory on disk.
  for (const dep of dependencies) {
    try {
      if (!resolvesInsideTarget(dep)) escaped.push(dep);
    } catch {
      // Bare-name resolution can fail for a perfectly-installed package that has
      // no importable entry point — e.g. bin-only packages like `tree-sitter-cli`
      // (package.json has `bin` but no `main`/`module`/`exports`/`index.js`).
      // Fall back to resolving its package.json to distinguish "installed but
      // bin-only" from "genuinely missing": a truly absent package fails both.
      // This preserves the original "is it installed" guarantee while still
      // upgrading from directory-existence to real module resolution (#2730).
      try {
        if (!resolvesInsideTarget(`${dep}/package.json`)) escaped.push(dep);
      } catch {
        unresolvable.push(dep);
      }
    }
  }

  // zod ships its public API behind subpath exports the worker bundle requires.
  // The package dir existing does NOT imply these subpaths resolve (#2730).
  if (dependencies.includes('zod')) {
    for (const subpath of ZOD_REQUIRED_SUBPATHS) {
      try {
        if (!resolvesInsideTarget(subpath)) escaped.push(subpath);
      } catch {
        unresolvable.push(subpath);
      }
    }
  }

  if (unresolvable.length > 0) {
    throw new Error(
      `Post-install check failed: unresolvable modules: ${unresolvable.join(', ')}`,
    );
  }

  if (escaped.length > 0) {
    throw new Error(
      `Post-install check failed: ${escaped.join(', ')} resolved from outside ${nodeModulesPath}. ` +
        `The install tree is incomplete and an unrelated node_modules is masking it.`,
    );
  }
}

/** Build an ephemeral summary so callers (e.g. repair) may omit it. */
function summaryOrEphemeral(summary?: InstallSummary): InstallSummary {
  return summary ?? { warnings: [], failedIDEs: [], retryCount: {} };
}

export async function ensureBun(summary?: InstallSummary): Promise<{ bunPath: string; version: string }> {
  const sum = summaryOrEphemeral(summary);
  if (!isBunInstalled()) {
    // installBun throws a platform-specific Error on failure; route it through
    // the central decision point so it becomes a loud ABORT (bun is mandatory
    // for hooks — there is no opt-out).
    try {
      installBun();
    } catch (error: unknown) {
      installerError(ErrorSeverity.ABORT, {
        component: 'bun-install',
        phase: 'setup-runtime',
        cause: error,
        remediation: platformBunRemediation(),
      }, sum);
    }
  }

  // The candidate paths are inside the resolver now, so a second sweep here
  // would only re-ask the same question with a shorter list.
  const bunPath = getBunPath();
  if (!bunPath) {
    installerError(ErrorSeverity.ABORT, {
      component: 'bun-install',
      phase: 'setup-runtime',
      cause: new Error('Bun executable not found after auto-install attempt'),
      remediation: platformBunRemediation(),
    }, sum);
    throw new Error('unreachable'); // installerError(ABORT) always throws
  }

  let version = getBunVersion();
  if (!version) {
    // A fresh binary sometimes needs a moment before --version responds.
    await new Promise((r) => setTimeout(r, 1000));
    version = getBunVersion();
  }
  if (!version) {
    installerError(ErrorSeverity.WARN_CONTINUE, {
      component: 'bun-version-probe',
      phase: 'setup-runtime',
      cause: new Error(`Bun at ${bunPath} did not respond to --version after retry`),
    }, sum);
    return { bunPath, version: 'unknown' };
  }
  return { bunPath, version };
}

export async function installPluginDependencies(targetDir: string, bunPath: string): Promise<void> {
  if (!existsSync(join(targetDir, 'package.json'))) {
    throw new Error(`installPluginDependencies: no package.json at ${targetDir}`);
  }

  const bunCmd = IS_WINDOWS && bunPath.includes(' ') ? `"${bunPath}"` : bunPath;

  // Every install path now writes to the same tree, so hold the install lock
  // for the whole prune-and-install. The installer WAITS for it rather than
  // skipping: it was invoked explicitly and has a progress spinner, so
  // returning "someone else is installing" would leave the user with a command
  // that silently did nothing.
  const releaseLock = await awaitDepsInstallLock(targetDir);
  try {
    pruneIfDependencySetChanged(targetDir);

    try {
      // Per CHANGELOG v12.6.1 -> v12.6.2: tree-sitter-swift's nested
      // tree-sitter-cli postinstall downloads a Rust binary and can hang the
      // install. Bun honors trustedDependencies; npm does not. We additionally
      // pass --ignore-scripts as belt-and-suspenders and bound it with a timeout.
      // Async exec (not execSync): a blocked event loop freezes the installer's
      // clack spinner for the duration of the install, which reads as a stall.
      await new Promise<void>((resolve, reject) => {
        exec(`${bunCmd} install --frozen-lockfile --ignore-scripts`, {
          cwd: targetDir,
          timeout: INSTALL_TIMEOUT_MS,
          maxBuffer: 16 * 1024 * 1024,
          ...(IS_WINDOWS ? { shell: process.env.ComSpec ?? 'cmd.exe' } : {}),
        }, (error, stdout, stderr) =>
          // exec errors don't carry stdio; attach so describeExecError can report it.
          error ? reject(Object.assign(error, { stdout, stderr })) : resolve());
      });
    } catch (error) {
      throw new Error(`bun install failed in ${targetDir}\n${describeExecError(error, 'npx keepmind repair')}`);
    }

    await ensureTreeSitterCliBinary(targetDir);
  } finally {
    releaseLock();
  }

  verifyCriticalModules(targetDir);
}

/**
 * Discard node_modules when the declared dependency set has changed since the
 * last install.
 *
 * `bun install` — including with --frozen-lockfile — ADDS what the manifest asks
 * for but never REMOVES what it no longer asks for. Verified against a real
 * install: after trimming the shipped grammar set and stubbing out
 * onnxruntime-web, a fresh install produced 422 MB while an upgrade of the same
 * version produced 947 MB, because every dropped package was still sitting
 * there. Removals only ever reached users who installed from scratch, and an
 * upgrade could only ever grow.
 *
 * So do it ourselves, and only when it matters: a changed fingerprint means
 * packages may have been dropped, which is exactly when the ~60s clean install
 * is worth paying. An unchanged one keeps the fast incremental path.
 */
/**
 * Download the tree-sitter CLI executable that `--ignore-scripts` skipped.
 *
 * `tree-sitter-cli` ships JS only; its Rust executable arrives via its `install`
 * script, which every keepmind install path suppresses on purpose (a nested
 * tree-sitter-cli postinstall once hung this very installer). The manifest's
 * `trustedDependencies` cannot override an explicit CLI flag — so 3.2.0 shipped
 * a dependency tree with cli.js and no binary, and structural search returned
 * zero symbols for EVERY language while looking like an unsupported-file error.
 *
 * Doing it here, as its own bounded step, keeps the hang-avoidance (no arbitrary
 * package's postinstall runs) while restoring the one binary we cannot work
 * without. Only tree-sitter-cli's own downloader is invoked, never a nested one.
 *
 * Non-fatal: memory capture, search and injection all work without a parser, so
 * a blocked download must degrade structural search, not fail the install.
 */
async function ensureTreeSitterCliBinary(targetDir: string): Promise<void> {
  const packageDir = join(targetDir, 'node_modules', 'tree-sitter-cli');
  const installScript = join(packageDir, 'install.js');
  const executable = join(packageDir, IS_WINDOWS ? 'tree-sitter.exe' : 'tree-sitter');

  if (existsSync(executable)) return;
  if (!existsSync(installScript)) {
    console.warn('  ⚠ tree-sitter-cli is missing its downloader; structural search (smart_outline / smart_search) will be unavailable.');
    return;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      // cwd MUST be the package directory: install.js writes the executable
      // relative to CWD, not to its own __dirname.
      exec(`"${process.execPath}" "${installScript}"`, {
        cwd: packageDir,
        timeout: INSTALL_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        ...(IS_WINDOWS ? { shell: process.env.ComSpec ?? 'cmd.exe' } : {}),
      }, (error, stdout, stderr) =>
        error ? reject(Object.assign(error, { stdout, stderr })) : resolve());
    });
  } catch (error) {
    console.warn('  ⚠ Could not download the tree-sitter CLI; structural search will be unavailable until the next attempt.');
    console.warn(indentBlock(describeExecError(error, 'npx keepmind repair')));
    return;
  }

  // install.js can exit 0 having written a truncated file, so verify rather
  // than trust the exit code.
  if (!existsSync(executable)) {
    console.warn('  ⚠ The tree-sitter CLI downloader reported success but produced no executable; structural search will be unavailable.');
  }
}

function pruneIfDependencySetChanged(targetDir: string): void {
  const nodeModules = join(targetDir, 'node_modules');
  if (!existsSync(nodeModules)) return;

  const current = dependencyFingerprint(targetDir);
  if (!current) return; // unreadable manifest — bun will fail loudly enough

  const marker = readInstallMarker(targetDir);
  // No recorded fingerprint means the tree predates this check and its contents
  // are unknown, so it cannot be trusted to match the manifest.
  if (marker?.deps === current) return;

  try {
    rmSync(nodeModules, { recursive: true, force: true });
  } catch {
    // Locked files (running worker, AV scan) — fall through to a plain install.
    // Worst case is the old behaviour: stale packages linger.
  }
}

export function readInstallMarker(targetDir: string): MarkerSchema | null {
  const path = markerPath(targetDir);
  if (!existsSync(path)) return null;
  const content = readFileSync(path, 'utf-8');
  try {
    const marker = JSON.parse(content);
    if (marker && typeof marker === 'object' && typeof marker.version === 'string') {
      return marker as MarkerSchema;
    }
  } catch {
    // Legacy installs wrote only the version string as plain text.
  }

  const legacyVersion = content.trim();
  if (LEGACY_VERSION_MARKER_RE.test(legacyVersion)) {
    return { version: legacyVersion.replace(/^v/i, '') };
  }

  return null;
}

export function writeInstallMarker(
  targetDir: string,
  version: string,
  bunVersion: string,
): void {
  const deps = dependencyFingerprint(targetDir);
  const payload: MarkerSchema = {
    version,
    bun: bunVersion,
    installedAt: new Date().toISOString(),
    ...(deps ? { deps } : {}),
  };
  writeFileSync(markerPath(targetDir), JSON.stringify(payload));
}

export function isInstallCurrent(targetDir: string, expectedVersion: string): boolean {
  if (!existsSync(join(targetDir, 'node_modules'))) return false;
  const marker = readInstallMarker(targetDir);
  if (!marker) return false;
  if (marker.version !== expectedVersion) return false;
  const currentBun = getBunVersion();
  if (currentBun && !marker.bun) return false;
  if (!currentBun && marker.bun) return false;
  if (currentBun && marker.bun && currentBun !== marker.bun) return false;
  // A same-version rebuild can still change what should be installed (the
  // dependency set is generated at build time), and that change is precisely
  // the case bun cannot reconcile on its own.
  const deps = dependencyFingerprint(targetDir);
  if (deps && marker.deps !== deps) return false;
  return true;
}
