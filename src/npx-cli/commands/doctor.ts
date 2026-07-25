/**
 * `npx keepmind doctor` — an onboarding & diagnostics tool that probes every
 * layer a new user (or an operator debugging a broken install) would otherwise
 * check by hand (#2548). Read-only: it never mutates state.
 *
 * Dual-mode: when the worker daemon is running, checks query its authoritative
 * read-only HTTP endpoints (/api/health, /api/stats, /api/chroma/status);
 * when it is down, the same facts are inferred from files and a read-only DB
 * open, so a fresh install still yields a useful config verdict.
 *
 * Output is grouped by concern. Exits 0 when all REQUIRED checks pass, 1
 * otherwise, so it is CI/script friendly. `--json` emits the full result set as
 * machine-readable JSON (ideal for support pastes) and suppresses the human
 * rendering.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import pc from 'picocolors';
import {
  isPluginInstalled,
  marketplaceDirectory,
  pluginsDirectory,
  IS_WINDOWS,
} from '../utils/paths.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import {
  resolveDataDir,
  resolveOpenDbPath,
  VECTOR_DB_DIR,
  paths,
} from '../../shared/paths.js';
import { Database } from '../../storage/db.js';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  /** When false, a 'fail' does not affect the overall exit code. */
  required: boolean;
}

export interface CheckGroup {
  title: string;
  checks: CheckResult[];
}

export interface DoctorReport {
  groups: CheckGroup[];
  ok: boolean;
  hardFailures: number;
}

// ---------------------------------------------------------------------------
// Worker HTTP response shapes (parsed defensively — every field optional).
// ---------------------------------------------------------------------------

interface HealthResponse {
  status?: string;
  version?: string;
  initialized?: boolean;
  mcpReady?: boolean;
  ai?: {
    provider?: string;
    authMethod?: string;
    lastInteraction?: { timestamp?: number; success?: boolean; error?: string } | null;
  };
}

interface StatsResponse {
  worker?: { version?: string; uptime?: number };
  database?: { observations?: number; sessions?: number; summaries?: number; size?: number };
}

interface ChromaStatusResponse {
  status?: string;
  connected?: boolean;
  backend?: string;
  vec_version?: string;
  probe?: { ok?: boolean; queryLatencyMs?: number; embedderWarm?: boolean; error?: string };
}

interface WorkerProbe {
  reachable: boolean;
  port: number;
  pidAlive: boolean;
  pidPort: number | null;
  health?: HealthResponse;
  stats?: StatsResponse;
  chroma?: ChromaStatusResponse;
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function probeVersion(bin: string): string | null {
  try {
    // On Windows, bun/uv resolve to .cmd/.exe shims that need a shell. Pass the
    // whole command as ONE string (never args + shell:true together — that trips
    // Node's DEP0190 deprecation warning and prints noise to stderr).
    const result = IS_WINDOWS
      ? spawnSync(`${bin} --version`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: true,
        })
      : spawnSync(bin, ['--version'], {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
    return result.status === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

/** Parse the credentials-only ~/.keepmind/.env into the SET of keys with a non-empty value. Values are never returned or logged. */
function readEnvFileKeys(): Set<string> {
  const keys = new Set<string>();
  try {
    const raw = readFileSync(paths.envFile(), 'utf-8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && value) keys.add(key);
    }
  } catch {
    // no .env file — return empty set
  }
  return keys;
}

/** Resolve the worker's ACTUAL bound port from worker.pid (ephemeral-fallback aware), plus whether its process is alive. Falls back to the configured port. */
function resolveWorkerPidInfo(): { port: string; pidAlive: boolean; pidPort: number | null } {
  try {
    const pidPath = paths.workerPid();
    if (existsSync(pidPath)) {
      const info = JSON.parse(readFileSync(pidPath, 'utf-8')) as { pid?: number; port?: number };
      if (typeof info.pid === 'number' && typeof info.port === 'number') {
        let alive = false;
        try {
          process.kill(info.pid, 0);
          alive = true;
        } catch (err) {
          if ((err as NodeJS.ErrnoException)?.code === 'EPERM') alive = true;
        }
        return { port: String(info.port), pidAlive: alive, pidPort: info.port };
      }
    }
  } catch {
    // fall through to configured port
  }
  return {
    port: SettingsDefaultsManager.get('KEEPMIND_WORKER_PORT'),
    pidAlive: false,
    pidPort: null,
  };
}

async function fetchJson<T>(url: string, timeoutMs: number): Promise<T | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function probeWorker(): Promise<WorkerProbe> {
  const { port, pidAlive, pidPort } = resolveWorkerPidInfo();
  const base = `http://127.0.0.1:${port}`;
  const health = await fetchJson<HealthResponse>(`${base}/api/health`, 3000);
  if (!health) {
    return { reachable: false, port: Number(port), pidAlive, pidPort };
  }
  // Worker is up — gather the richer read-only snapshots in parallel.
  const [stats, chroma] = await Promise.all([
    fetchJson<StatsResponse>(`${base}/api/stats`, 3000),
    fetchJson<ChromaStatusResponse>(`${base}/api/chroma/status?deep=true`, 8000),
  ]);
  return {
    reachable: true,
    port: Number(port),
    pidAlive,
    pidPort,
    health,
    stats: stats ?? undefined,
    chroma: chroma ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Pure check functions (exported for tests)
// ---------------------------------------------------------------------------

export function checkNodeVersion(version: string = process.version): CheckResult {
  const m = /^v?(\d+)\.(\d+)/.exec(version);
  const major = m ? parseInt(m[1], 10) : 0;
  const minor = m ? parseInt(m[2], 10) : 0;
  const ok = major > 22 || (major === 22 && minor >= 5);
  return {
    name: 'Node.js >= 22.5',
    status: ok ? 'ok' : 'fail',
    detail: ok
      ? version
      : `${version} is too old — keepmind needs Node >= 22.5 (node:sqlite). Install: https://nodejs.org`,
    required: true,
  };
}

const VALID_PROVIDERS = ['claude', 'gemini', 'openrouter'] as const;
const VALID_CLAUDE_AUTH = ['subscription', 'api-key', 'gateway', 'cli'] as const;

export interface ProviderContext {
  provider: string;
  claudeAuthMethod: string;
  geminiKey: string;
  openrouterKey: string;
  /** Keys present (with non-empty values) in ~/.keepmind/.env and/or process.env. */
  envKeys: Set<string>;
  /** Contents of oauth-stale.marker if present. */
  staleMarker?: string;
}

export function checkProviderReadiness(ctx: ProviderContext): CheckResult {
  const name = 'AI provider';
  if (!VALID_PROVIDERS.includes(ctx.provider as (typeof VALID_PROVIDERS)[number])) {
    return {
      name,
      status: 'fail',
      detail: `KEEPMIND_PROVIDER='${ctx.provider}' is invalid — must be one of ${VALID_PROVIDERS.join(', ')}`,
      required: true,
    };
  }

  if (ctx.provider === 'gemini') {
    const has = ctx.geminiKey.trim() !== '' || ctx.envKeys.has('GEMINI_API_KEY');
    return has
      ? { name, status: 'ok', detail: 'gemini — API key configured', required: true }
      : {
          name,
          status: 'fail',
          detail:
            'gemini selected but no API key — set KEEPMIND_GEMINI_API_KEY in settings.json or GEMINI_API_KEY in ~/.keepmind/.env',
          required: true,
        };
  }

  if (ctx.provider === 'openrouter') {
    const has = ctx.openrouterKey.trim() !== '' || ctx.envKeys.has('OPENROUTER_API_KEY');
    return has
      ? { name, status: 'ok', detail: 'openrouter — API key configured', required: true }
      : {
          name,
          status: 'fail',
          detail:
            'openrouter selected but no API key — set KEEPMIND_OPENROUTER_API_KEY in settings.json or OPENROUTER_API_KEY in ~/.keepmind/.env',
          required: true,
        };
  }

  // provider === 'claude'
  if (!VALID_CLAUDE_AUTH.includes(ctx.claudeAuthMethod as (typeof VALID_CLAUDE_AUTH)[number])) {
    return {
      name,
      status: 'fail',
      detail: `claude auth method '${ctx.claudeAuthMethod}' is invalid — must be one of ${VALID_CLAUDE_AUTH.join(', ')}`,
      required: true,
    };
  }

  switch (ctx.claudeAuthMethod) {
    case 'api-key':
      return ctx.envKeys.has('ANTHROPIC_API_KEY')
        ? { name, status: 'ok', detail: 'claude — ANTHROPIC_API_KEY configured', required: true }
        : {
            name,
            status: 'fail',
            detail: 'claude api-key auth selected but ANTHROPIC_API_KEY missing — add it to ~/.keepmind/.env',
            required: true,
          };
    case 'gateway':
      return ctx.envKeys.has('ANTHROPIC_BASE_URL')
        ? { name, status: 'ok', detail: 'claude — gateway (ANTHROPIC_BASE_URL) configured', required: true }
        : {
            name,
            status: 'fail',
            detail: 'claude gateway auth selected but ANTHROPIC_BASE_URL missing — add it to ~/.keepmind/.env',
            required: true,
          };
    case 'subscription':
      return ctx.staleMarker
        ? {
            name,
            status: 'warn',
            detail: 'claude subscription — OAuth token is STALE; re-login by running `claude` interactively once',
            required: true,
          }
        : { name, status: 'ok', detail: 'claude — subscription (OAuth)', required: true };
    case 'cli':
    default:
      return { name, status: 'ok', detail: 'claude — uses Claude Code CLI auth', required: true };
  }
}

/** Interpret /api/health ai.lastInteraction into a "did compression actually work" check. */
export function checkLastInteraction(
  ai: HealthResponse['ai'] | undefined,
): CheckResult {
  const name = 'Last compression';
  const li = ai?.lastInteraction;
  if (!li || typeof li.success !== 'boolean') {
    return {
      name,
      status: 'skip',
      detail: 'no compression has run yet — end a session to generate the first observation',
      required: false,
    };
  }
  if (li.success) {
    return { name, status: 'ok', detail: 'most recent summarizer call succeeded', required: false };
  }
  return {
    name,
    status: 'warn',
    detail: `most recent summarizer call FAILED: ${li.error ?? 'unknown error'}`,
    required: false,
  };
}

/** Compute the overall verdict / exit code from all groups. */
export function summarizeReport(groups: CheckGroup[]): DoctorReport {
  const all = groups.flatMap((g) => g.checks);
  const hardFailures = all.filter((c) => c.required && c.status === 'fail').length;
  return { groups, ok: hardFailures === 0, hardFailures };
}

// ---------------------------------------------------------------------------
// Group builders
// ---------------------------------------------------------------------------

function buildRuntimeGroup(dataDir: string): CheckGroup {
  const checks: CheckResult[] = [];

  checks.push(checkNodeVersion());

  // Bun is OPTIONAL as of the in-process-vector-search era: the worker boots and
  // runs core memory (capture + keyword/FTS search) on the Node built-in
  // node:sqlite without it (zod is bundled; native deps lazy-load). Bun is only
  // needed to INSTALL the native deps (@huggingface/transformers, sqlite-vec)
  // that power SEMANTIC vector search — its absence degrades that one feature
  // (already a non-required warn below), it does not break the install. Reporting
  // it as a required failure made a healthy, working install look broken.
  const bunVersion = probeVersion('bun');
  checks.push({
    name: 'Bun runtime',
    status: bunVersion ? 'ok' : 'warn',
    detail: bunVersion
      ? `v${bunVersion.replace(/^v/, '')}`
      : 'not found — optional; core memory works without it, but it installs the native deps for semantic vector search. Install: `winget install Oven-sh.Bun` (Windows) or https://bun.sh, then `npx keepmind install`.',
    required: false,
  });

  const installed = isPluginInstalled();
  checks.push({
    name: 'Plugin installed',
    status: installed ? 'ok' : 'fail',
    detail: installed ? marketplaceDirectory() : 'run `npx keepmind install`',
    required: true,
  });

  // Runtime deps live in the cache dir (where `repair` installs them and where
  // Claude Code actually resolves the plugin at runtime), with `install` also
  // populating the marketplace clone's plugin/ subdir. Check both so the report
  // stays consistent with whichever remediation the user ran — the marketplace
  // ROOT never receives node_modules, so checking it there was a false failure.
  // The cache is versioned (…/cache/keepmind/keepmind/<version>/node_modules);
  // scan for any version dir that carries deps rather than resolving a version
  // (version resolution walks the npm bundle layout and is fragile from dev dist).
  const cacheHasDeps = (() => {
    const base = join(pluginsDirectory(), 'cache', 'keepmind', 'keepmind');
    try {
      return readdirSync(base, { withFileTypes: true }).some(
        (e) => e.isDirectory() && existsSync(join(base, e.name, 'node_modules')),
      );
    } catch {
      return false;
    }
  })();
  const marketplacePluginDeps = join(marketplaceDirectory(), 'plugin', 'node_modules');
  const depsPresent = cacheHasDeps || existsSync(marketplacePluginDeps);
  checks.push({
    name: 'Plugin deps',
    status: installed ? (depsPresent ? 'ok' : 'fail') : 'warn',
    detail: depsPresent ? 'node_modules present' : 'missing — run `npx keepmind repair`',
    required: installed,
  });

  // uv is legacy: vector search moved in-process (sqlite-vec) in Phase 2, so uv
  // is no longer required. Report presence informationally, never as a failure.
  const uvVersion = probeVersion('uv');
  checks.push({
    name: 'uv (optional)',
    status: 'ok',
    detail: uvVersion
      ? `${uvVersion} — present (no longer required; vector search is in-process)`
      : 'not installed — optional; vector search runs in-process, uv is not needed',
    required: false,
  });

  // Surface a recorded install error and its remediation, if any.
  const lastErrorPath = join(dataDir, 'last-install-error.json');
  if (existsSync(lastErrorPath)) {
    let detail = `present at ${lastErrorPath}`;
    try {
      const record = JSON.parse(readFileSync(lastErrorPath, 'utf-8'));
      if (record && typeof record === 'object') {
        detail = `${record.categoryId ?? 'error'}: ${record.remediation ?? detail}`;
      }
    } catch {
      // keep generic detail
    }
    checks.push({ name: 'Last install error', status: 'warn', detail, required: false });
  }

  return { title: 'Runtime & Install', checks };
}

function buildProviderGroup(probe: WorkerProbe): CheckGroup {
  const checks: CheckResult[] = [];

  const envKeys = readEnvFileKeys();
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY']) {
    if (process.env[k] && process.env[k]!.trim() !== '') envKeys.add(k);
  }

  let staleMarker: string | undefined;
  try {
    const markerPath = join(resolveDataDir(), 'oauth-stale.marker');
    if (existsSync(markerPath)) staleMarker = readFileSync(markerPath, 'utf-8');
  } catch {
    // ignore
  }

  checks.push(
    checkProviderReadiness({
      provider: SettingsDefaultsManager.get('KEEPMIND_PROVIDER'),
      claudeAuthMethod: SettingsDefaultsManager.get('KEEPMIND_CLAUDE_AUTH_METHOD'),
      geminiKey: SettingsDefaultsManager.get('KEEPMIND_GEMINI_API_KEY'),
      openrouterKey: SettingsDefaultsManager.get('KEEPMIND_OPENROUTER_API_KEY'),
      envKeys,
      staleMarker,
    }),
  );

  // "Did compression actually work" — only meaningful when the worker is up.
  if (probe.reachable) {
    checks.push(checkLastInteraction(probe.health?.ai));
  }

  return { title: 'AI Provider', checks };
}

function buildWorkerGroup(probe: WorkerProbe): CheckGroup {
  const checks: CheckResult[] = [];

  if (probe.reachable) {
    const h = probe.health ?? {};
    const bits = [
      `v${(h.version ?? '?').replace(/^v/, '')}`,
      h.initialized === false ? 'initializing' : 'initialized',
      h.mcpReady ? 'MCP ready' : 'MCP pending',
    ];
    const healthy = h.status !== 'degraded' && h.initialized !== false;
    checks.push({
      name: 'Worker daemon',
      status: healthy ? 'ok' : 'warn',
      detail: `${healthy ? 'healthy' : 'degraded'} at http://127.0.0.1:${probe.port} (${bits.join(', ')})`,
      required: false,
    });
  } else {
    checks.push({
      name: 'Worker daemon',
      status: 'fail',
      detail: `no response on port ${probe.port} — start with \`npx keepmind start\``,
      required: false, // worker can be intentionally stopped; don't hard-fail
    });
  }

  // PID file health: a stale worker.pid (pointing at a dead process) is a
  // classic cause of "worker won't start" and confusing status output.
  if (probe.pidPort === null) {
    checks.push({
      name: 'Worker PID file',
      status: probe.reachable ? 'warn' : 'skip',
      detail: probe.reachable
        ? 'worker responded but no valid worker.pid on disk'
        : 'no worker.pid — worker has not been started',
      required: false,
    });
  } else if (probe.pidAlive) {
    // A "live" PID whose daemon does NOT answer on the port is the classic
    // reused/stale-PID trap on Windows: the recorded PID was recycled by an
    // unrelated process, so it looks alive while no worker is actually serving.
    // Reporting a green "live" here hid the real cause of "worker won't start".
    checks.push({
      name: 'Worker PID file',
      status: probe.reachable ? 'ok' : 'warn',
      detail: probe.reachable
        ? `live (port ${probe.pidPort})`
        : `PID alive but daemon not responding on port ${probe.pidPort} — likely a reused/stale PID; clear with \`npx keepmind restart\``,
      required: false,
    });
  } else {
    checks.push({
      name: 'Worker PID file',
      status: 'warn',
      detail: `STALE — worker.pid points at a dead process; clear with \`npx keepmind restart\``,
      required: false,
    });
  }

  return { title: 'Worker', checks };
}

function readDbCountsDirect(): { obs: number | null; schema: number | null; error?: string } {
  const dbPath = resolveOpenDbPath();
  if (!existsSync(dbPath)) return { obs: null, schema: null, error: 'no database file yet' };
  let db: Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true });
    const obsRow = db.prepare<{ n: number }>('SELECT COUNT(*) AS n FROM observations').get();
    let schema: number | null = null;
    try {
      const verRow = db.prepare<{ v: number }>('SELECT MAX(version) AS v FROM schema_versions').get();
      schema = verRow?.v ?? null;
    } catch {
      // schema_versions may not exist on a very old DB
    }
    return { obs: obsRow?.n ?? 0, schema };
  } catch (err) {
    return { obs: null, schema: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    db?.close();
  }
}

function buildMemoryGroup(probe: WorkerProbe): CheckGroup {
  const checks: CheckResult[] = [];

  // Database — prefer the live worker's /api/stats, fall back to a read-only open.
  if (probe.reachable && probe.stats?.database) {
    const d = probe.stats.database;
    checks.push({
      name: 'Database',
      status: 'ok',
      detail: `${d.observations ?? 0} observations, ${d.sessions ?? 0} sessions (${formatBytes(d.size)})`,
      required: false,
    });
  } else {
    const { obs, schema, error } = readDbCountsDirect();
    if (error && obs === null) {
      checks.push({
        name: 'Database',
        status: obs === null && error === 'no database file yet' ? 'warn' : 'fail',
        detail:
          error === 'no database file yet'
            ? 'no database yet — created on first session'
            : `cannot open database read-only: ${error}`,
        required: false,
      });
    } else {
      checks.push({
        name: 'Database',
        status: 'ok',
        detail: `${obs ?? 0} observations${schema !== null ? `, schema v${schema}` : ''} (read-only probe)`,
        required: false,
      });
    }
  }

  // Vector search — live deep probe when possible, else settings + file presence.
  const vectorEnabled = SettingsDefaultsManager.get('KEEPMIND_CHROMA_ENABLED') !== 'false';
  if (!vectorEnabled) {
    checks.push({
      name: 'Vector search',
      status: 'warn',
      detail: 'disabled via KEEPMIND_CHROMA_ENABLED=false — semantic search falls back to SQLite/BM25',
      required: false,
    });
  } else if (probe.reachable && probe.chroma) {
    const c = probe.chroma;
    if (c.status === 'disabled') {
      // Settings say enabled, but the live worker was started with vector search
      // off — a stale KEEPMIND_CHROMA_ENABLED=false in the worker's environment.
      checks.push({
        name: 'Vector search',
        status: 'warn',
        detail:
          'worker has vector search OFF (started with KEEPMIND_CHROMA_ENABLED=false in its env) — restart without that flag to enable',
        required: false,
      });
    } else if (c.probe) {
      const p = c.probe;
      checks.push({
        name: 'Vector search',
        status: p.ok ? 'ok' : 'warn',
        detail: p.ok
          ? `ready (${c.backend ?? 'sqlite-vec'}, embedder ${p.embedderWarm ? 'warm' : 'cold'}, ${p.queryLatencyMs ?? '?'}ms)`
          : `unhealthy: ${p.error ?? 'probe failed'}`,
        required: false,
      });
    } else {
      checks.push({
        name: 'Vector search',
        status: c.connected ? 'ok' : 'warn',
        detail: `${c.status ?? 'unknown'} (${c.backend ?? 'sqlite-vec'})`,
        required: false,
      });
    }
  } else {
    const vecPresent = existsSync(join(VECTOR_DB_DIR, 'vectors.db'));
    checks.push({
      name: 'Vector search',
      status: vecPresent ? 'ok' : 'skip',
      detail: vecPresent
        ? 'enabled; vector store present (start worker for a live readiness probe)'
        : 'enabled but no vector store yet — built on first backfill',
      required: false,
    });
  }

  return { title: 'Memory Store', checks };
}

async function buildConnectivityGroup(): Promise<CheckGroup> {
  const checks: CheckResult[] = [];

  let tlsStatus: CheckStatus = 'ok';
  let tlsDetail = 'api.anthropic.com reachable, certificate trusted';
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    tlsDetail = `reachable (HTTP ${res.status}), certificate trusted`;
  } catch (err) {
    const code =
      (err as { cause?: { code?: string } })?.cause?.code ??
      (err as NodeJS.ErrnoException)?.code ??
      '';
    const certCodes = [
      'CERT_HAS_EXPIRED',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'CERT_UNTRUSTED',
    ];
    if (certCodes.includes(code)) {
      tlsStatus = 'fail';
      tlsDetail =
        `certificate rejected (${code}) — corporate TLS interception. ` +
        `Export your corporate root CA to a .pem and set NODE_EXTRA_CA_CERTS to it. ` +
        `On Windows, Claude Code's bundled runtime currently IGNORES CA env vars ` +
        `(upstream bug #71581); until fixed, workaround: NODE_TLS_REJECT_UNAUTHORIZED=0.`;
    } else {
      tlsStatus = 'warn';
      tlsDetail = `could not reach api.anthropic.com (${code || 'network error'}) — offline or blocked`;
    }
  }
  checks.push({
    name: 'API TLS reachability',
    status: tlsStatus,
    detail: tlsDetail,
    required: false, // environmental (offline/proxy varies); surface loudly, don't hard-fail CI
  });

  return { title: 'Connectivity', checks };
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Rendering & entry point
// ---------------------------------------------------------------------------

const icon = (s: CheckStatus): string =>
  s === 'ok'
    ? pc.green('✓')
    : s === 'warn'
      ? pc.yellow('!')
      : s === 'skip'
        ? pc.dim('·')
        : pc.red('✗');

function renderReport(report: DoctorReport): void {
  console.log(pc.bold('\nkeepmind doctor\n'));
  for (const group of report.groups) {
    console.log(pc.bold(pc.cyan(`  ${group.title}`)));
    for (const c of group.checks) {
      console.log(`    ${icon(c.status)} ${c.name.padEnd(22)} ${pc.dim(c.detail)}`);
    }
    console.log('');
  }

  if (report.ok) {
    console.log(pc.green('All required checks passed.'));
  } else {
    console.log(pc.red(`${report.hardFailures} required check(s) failed — see remediation above.`));
  }
}

// ---------------------------------------------------------------------------
// Updates — is a newer keepmind published than the one installed/running?
// ---------------------------------------------------------------------------

const NPM_LATEST_URL = 'https://registry.npmjs.org/keepmind/latest';
const UPDATE_CHECK_TIMEOUT_MS = 3000;

/** Best-effort: the version that is actually installed/running on this machine. */
function currentInstalledVersion(probe: WorkerProbe): string | null {
  // Prefer the live worker's self-reported version; fall back to the installed
  // plugin manifest so the check still works when the daemon is stopped.
  const running = probe.health?.version;
  if (typeof running === 'string' && running.trim()) return running.replace(/^v/, '');
  try {
    const manifest = join(marketplaceDirectory(), 'plugin', 'package.json');
    if (existsSync(manifest)) {
      const pkg = JSON.parse(readFileSync(manifest, 'utf-8')) as { version?: string };
      if (typeof pkg.version === 'string' && pkg.version.trim()) return pkg.version.replace(/^v/, '');
    }
  } catch {
    // fall through — version simply unknown
  }
  return null;
}

/** Latest version published to npm, or null when the registry can't be reached. */
async function fetchLatestNpmVersion(): Promise<string | null> {
  try {
    const res = await fetch(NPM_LATEST_URL, { signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS) });
    if (!res.ok) return null;
    const body = await res.json() as { version?: string };
    return typeof body.version === 'string' && body.version.trim() ? body.version.replace(/^v/, '') : null;
  } catch {
    return null;
  }
}

/** Numeric x.y.z compare (prerelease tags ignored). >0 if a is newer than b. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function buildUpdatesGroup(probe: WorkerProbe): Promise<CheckGroup> {
  const current = currentInstalledVersion(probe);
  const latest = await fetchLatestNpmVersion();

  let check: CheckResult;
  if (!current) {
    check = {
      name: 'Version',
      status: 'skip',
      detail: 'could not determine the installed keepmind version',
      required: false,
    };
  } else if (!latest) {
    check = {
      name: 'Version',
      status: 'skip',
      detail: `v${current} installed — could not reach npm to check for a newer version`,
      required: false,
    };
  } else if (compareVersions(latest, current) > 0) {
    check = {
      name: 'Update available',
      status: 'warn',
      detail:
        `v${current} installed, v${latest} on npm. In Claude Code: ` +
        '`/plugin marketplace update keepmind` then `/plugin install keepmind@keepmind`. ' +
        'Tip: enable auto-update (/plugin → Marketplaces → keepmind) so updates apply automatically.',
      required: false,
    };
  } else {
    check = {
      name: 'Version',
      status: 'ok',
      detail: `v${current} (up to date)`,
      required: false,
    };
  }
  return { title: 'Updates', checks: [check] };
}

export async function runDoctorCommand(argv: string[] = []): Promise<void> {
  const jsonOutput = argv.includes('--json');
  const dataDir = resolveDataDir();

  const probe = await probeWorker();

  const groups: CheckGroup[] = [
    buildRuntimeGroup(dataDir),
    await buildUpdatesGroup(probe),
    buildProviderGroup(probe),
    buildWorkerGroup(probe),
    buildMemoryGroup(probe),
    await buildConnectivityGroup(),
  ];

  const report = summarizeReport(groups);

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    renderReport(report);
  }

  process.exit(report.ok ? 0 : 1);
}
