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
import { join, sep } from 'path';
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
import { readVectorHealthMarker } from '../../shared/vector-health.js';
import { probeVectorDeps } from '../../services/vector/vector-deps-repair.js';
import { depsInstallRoot, depsRoot, pluginDepsPresent } from '../../shared/plugin-node-modules.js';
import { spoolDepth } from '../../shared/hook-spool.js';
import { checkSourceTreeDrift } from '../utils/source-tree-drift.js';
import { curatedHealth, describeCuratedHealth, type CuratedHealth } from '../../services/curated/health.js';
import { readCuratedRecordCounts } from '../../services/curated/stored-records.js';
import { certErrorCodeOf, findCertErrorCode } from '../../shared/tls-errors.js';
import { resolveBunVersion } from '../utils/bun-resolver.js';

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

export interface WorkerProbe {
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

// `probeVersion` lived here and probed PATH only. Its one caller now uses
// `resolveBunVersion`, and leaving it behind would recreate exactly what this
// change removes: a second, subtly different answer to a question that already
// has one. The DEP0190 warning its comment described is fixed at the source, in
// `utils/bun-resolver.ts`.

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

/**
 * Report whether the per-session cost balance is actually observable.
 *
 * The balance is written to ~/.keepmind/logs/metrics-<date>.jsonl, which no log
 * level can suppress. The prose log line is a convenience copy at INFO, so
 * KEEPMIND_LOG_LEVEL=WARN or ERROR drops it.
 *
 * That combination burned a real measurement: the documented "grep the log for
 * 'Stateless observer session ended'" returned zero matches on a WARN machine,
 * which is indistinguishable from "the observer did nothing". Surfacing it here
 * is cheap and catches exactly that case before it is mistaken for data.
 */
export function checkMetricsVisibility(dataDir: string, logLevel: string): CheckResult {
  const name = 'Cost metrics';
  const level = (logLevel || 'INFO').toUpperCase();
  const logLineHidden = level === 'WARN' || level === 'ERROR' || level === 'SILENT';

  let metricsFiles = 0;
  try {
    metricsFiles = readdirSync(join(dataDir, 'logs'))
      .filter(f => f.startsWith('metrics-') && f.endsWith('.jsonl')).length;
  } catch {
    // logs dir may not exist yet on a fresh install
  }

  const where = `${join(dataDir, 'logs')}${sep}metrics-<date>.jsonl`;
  if (metricsFiles > 0) {
    // Point at the command rather than the file: read by hand, the file invites
    // two aggregation mistakes (nulls counted as zero, per-session values
    // averaged) that both understate or distort the result.
    const read = 'read with `npx keepmind metrics`';
    return {
      name,
      status: 'ok',
      detail: logLineHidden
        ? `${metricsFiles} file(s) in ${where} — ${read} (the log copy is hidden at KEEPMIND_LOG_LEVEL=${level}; the metrics file is not)`
        : `${metricsFiles} file(s) in ${where} — ${read}`,
      required: false,
    };
  }
  return {
    name,
    status: 'skip',
    detail: `none yet — written when a session ends, to ${where}`,
    required: false,
  };
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
      // Phrased as the expected state, not as a defect. After an install or an
      // update this is what a healthy system looks like, and reading it as a
      // fault sends people looking for a problem that is not there.
      detail: 'none yet — expected after an install or update; the first one runs when a session ends',
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
  // The SAME resolver the installer uses. Probing PATH alone made this report
  // "not found" minutes after the installer reported "Runtime ready (Bun
  // 1.3.14) OK" on the same machine — Bun lands in `~/.bun/bin`, and the shell
  // that ran the installer does not learn about it until it is restarted. The
  // remedy printed below then told the operator to install what they had.
  const bunVersion = resolveBunVersion();
  checks.push({
    name: 'Bun runtime',
    status: bunVersion ? 'ok' : 'warn',
    detail: bunVersion
      ? `v${bunVersion.replace(/^v/, '')}`
      // Bun INSTALLS the native deps; it does not run them. Once they are in
      // place semantic search keeps working without bun on PATH — reported from
      // the field on 2026-08-09, where vector search was `ready` on a machine
      // with no bun. Saying "needed for semantic search" flatly is therefore
      // wrong in the common case and sends people installing something they do
      // not need. Check "Vector search" below for the state that actually
      // matters.
      : 'not found — optional. It installs the native deps for semantic search; if those are already present (see Vector search), everything keeps working without it. Only needed to install or update them: `winget install Oven-sh.Bun` (Windows) or https://bun.sh, then `npx keepmind install`.',
    required: false,
  });

  const installed = isPluginInstalled();
  checks.push({
    name: 'Plugin installed',
    status: installed ? 'ok' : 'fail',
    detail: installed ? marketplaceDirectory() : 'run `npx keepmind install`',
    required: true,
  });

  // Runtime deps live in the plugin data directory, which survives the host
  // restoring the plugin root from git. Report what actually RESOLVES rather
  // than whether a node_modules directory exists: a partial tree left by a
  // failed install passes a directory check while the worker still cannot
  // start, and that is precisely the state doctor exists to catch.
  //
  // The legacy locations (the version cache, the marketplace plugin dir) still
  // satisfy the resolver, so an install that has not been migrated yet reports
  // ok — with a hint, because that tree is one host refresh away from deletion.
  const depsInstalled = depsInstallRoot();
  const activeDepsRoot = depsRoot();
  const depsPresent = pluginDepsPresent();
  const onLegacyLayout = depsPresent && activeDepsRoot !== null && activeDepsRoot !== depsInstalled;

  // When the deps are gone, the FIRST question is "why didn't the worker just
  // reinstall them?" — and the answer is usually the repair latch: a failed
  // repair is recorded so every hook doesn't relaunch a multi-minute install
  // against a broken network. Without surfacing it here the user sees a worker
  // that stays down and no reason anywhere. Read-only; the latch is cleared by
  // the repair path itself, never by doctor.
  const repairFailure = (() => {
    if (depsPresent) return null;
    try {
      const marker = JSON.parse(readFileSync(join(dataDir, '.deps-repair-failed.json'), 'utf-8'));
      if (typeof marker?.failedAt !== 'string') return null;
      return { reason: typeof marker.reason === 'string' ? marker.reason : 'unknown', failedAt: marker.failedAt };
    } catch {
      return null;
    }
  })();

  checks.push({
    name: 'Plugin deps',
    status: installed ? (depsPresent ? (onLegacyLayout ? 'warn' : 'ok') : 'fail') : 'warn',
    detail: !depsPresent
      ? repairFailure
        ? `not resolvable — self-repair failed (${repairFailure.reason}) at ${repairFailure.failedAt}; run \`npx keepmind repair\` (expected in ${depsInstalled})`
        : `not resolvable — run \`npx keepmind repair\` (expected in ${depsInstalled})`
      : onLegacyLayout
        ? `at legacy location ${activeDepsRoot} — run \`npx keepmind install\` to migrate`
        : `resolving from ${activeDepsRoot}`,
    required: installed,
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

  // Reported whether or not the worker answers: the metrics files are on disk,
  // and "can I even measure this?" is most worth answering when something else
  // already looks wrong.
  checks.push(
    checkMetricsVisibility(resolveDataDir(), SettingsDefaultsManager.get('KEEPMIND_LOG_LEVEL')),
  );

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

  checks.push(checkSourceTreeDrift(marketplaceDirectory(), probe.health?.version));

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
    // No live worker to ask. Presence of vectors.db proves only that a vector
    // store was built at some point — the install that prompted this had one AND
    // a sqlite-vec that had not loaded for weeks, so "file exists" reported ok
    // for the exact failure being looked for. Report what the last worker
    // recorded, and fall back to probing the module directly.
    const marker = readVectorHealthMarker();
    const vecPresent = existsSync(join(VECTOR_DB_DIR, 'vectors.db'));
    if (marker) {
      checks.push({
        name: 'Vector search',
        status: 'warn',
        detail: `DEGRADED (${marker.reason}): ${marker.detail || 'vector store failed to load'} — ${marker.remediation}`,
        required: false,
      });
    } else {
      const probe = probeVectorDeps();
      checks.push({
        name: 'Vector search',
        status: probe.ok ? (vecPresent ? 'ok' : 'skip') : 'warn',
        detail: probe.ok
          ? (vecPresent
            ? 'enabled; native deps load and vector store present (start worker for a live readiness probe)'
            : 'enabled; native deps load but no vector store yet — built on first backfill')
          : `native deps unavailable (${probe.reason}): ${probe.message}`,
        required: false,
      });
    }
  }

  // Hook payloads buffered because no worker could take them. A non-empty spool
  // is not itself a fault — it is memory that would previously have been lost —
  // but a spool that stays full means the drain is not running.
  const queued = spoolDepth();
  if (queued > 0) {
    checks.push({
      name: 'Buffered hook calls',
      status: 'warn',
      detail: `${queued} call(s) waiting for replay — they are drained when the worker is idle and ready. A count that never falls means the worker is not starting.`,
      required: false,
    });
  }

  return { title: 'Memory Store', checks };
}

/**
 * The curated corpus — the part of memory a person wrote by hand.
 *
 * Every check here is REQUIRED, unlike most of the rest of this report. The
 * others describe a system that is degraded but honest; these describe a
 * corpus that answers questions confidently with the wrong contents, which is
 * the failure this whole path exists to prevent. A machine with no curated
 * sources configured skips the group entirely rather than passing it.
 */
export function buildCuratedGroup(probe: WorkerProbe, dataDir: string = resolveDataDir()): CheckGroup {
  const checks: CheckResult[] = [];

  let entries: CuratedHealth[] = [];
  try {
    entries = curatedHealth(dataDir, { storedRecords: readCuratedRecordCounts() });
  } catch (error) {
    checks.push({
      name: 'Curated corpus',
      status: 'fail',
      detail: `state could not be read: ${error instanceof Error ? error.message : String(error)}`,
      required: true,
    });
    return { title: 'Curated Corpus', checks };
  }

  if (entries.length === 0) {
    return {
      title: 'Curated Corpus',
      checks: [{
        name: 'Curated sources',
        status: 'skip',
        detail: 'none configured (`curatedSources` in ~/.keepmind/settings.json)',
        required: false,
      }],
    };
  }

  // Configured for a corpus this machine does not have — no sources reachable
  // and no records held. keepmind is developed on one machine and used on
  // another, and a settings file that travels ahead of the corpus must not turn
  // `doctor` red on every machine it reaches first. Nothing here is broken;
  // there is nothing here.
  if (entries.every(entry => entry.presence === 'absent')) {
    return {
      title: 'Curated Corpus',
      checks: [{
        name: 'Curated sources',
        status: 'skip',
        detail: `configured for ${entries.map(entry => entry.project).join(', ')}, `
          + 'but neither the source directories nor any records are on this machine',
        required: false,
      }],
    };
  }

  // Strict here, tolerant elsewhere. A stopped worker is a legitimate state on
  // a machine that only records observations — but it is not one on a machine
  // that carries a hand-written corpus AND its sources: nothing imports them
  // and nothing embeds them while it is down, and the corpus silently ages.
  // A detached corpus cannot age — nothing feeds it — so the same stopped
  // worker is reported there without failing the run.
  const feeds = entries.some(entry => entry.presence === 'present' || entry.presence === 'unknown');
  checks.push({
    name: 'Worker (keeps the corpus current)',
    status: probe.reachable ? 'ok' : feeds ? 'fail' : 'warn',
    detail: probe.reachable
      ? `reachable on port ${probe.port}`
      : feeds
        ? `no response on port ${probe.port} — nothing is importing or indexing the corpus. Start it with \`npx keepmind start\`.`
        : `no response on port ${probe.port} — the held records are not being served while it is down.`,
    required: feeds,
  });

  const { obs, error } = readDbCountsDirect();
  checks.push({
    name: 'Database',
    status: error && obs === null ? 'fail' : 'ok',
    detail: error && obs === null ? `not readable: ${error}` : `readable (${obs ?? 0} observations)`,
    required: true,
  });

  for (const entry of entries) {
    if (entry.presence === 'absent') continue;

    // What a missing source MEANS depends on whether the records are here.
    //
    //   present  — every configured directory is readable; nothing to report.
    //   detached — the records are held and searchable, the files are on
    //              another machine. A real thing to know, not a fault: the
    //              import is not failing here, it has nothing to do here.
    //   unknown  — the store could not be counted, so the broken-configuration
    //              reading cannot be ruled out and keeps its failure.
    if (entry.absentSources.length > 0) {
      const detached = entry.presence === 'detached';
      checks.push({
        name: `Sources [${entry.project}]`,
        status: detached ? 'warn' : 'fail',
        detail: detached
          ? `not on this machine: ${entry.absentSources.map(source => source.path).join(', ')} `
            + '— the records themselves are held here'
          : `not readable: ${entry.absentSources.map(source => source.path).join(', ')}`,
        required: !detached,
      });
    } else if (entry.sources.length > 0) {
      checks.push({
        name: `Sources [${entry.project}]`,
        status: 'ok',
        detail: `${entry.sources.length} director(y|ies) readable`,
        required: true,
      });
    }

    const detached = entry.presence === 'detached';
    checks.push({
      name: detached ? `Records held [${entry.project}]` : `Last import [${entry.project}]`,
      status: entry.ok ? 'ok' : detached ? 'warn' : entry.lastSuccessEpoch === null ? 'fail' : 'warn',
      detail: describeCuratedHealth(entry),
      required: !detached,
    });

    // Only where an import can actually run. On a detached machine the flag
    // records what the last run on THIS machine managed, and the last run had
    // no sources to read — which says nothing about whether the records are
    // embedded, and `curated:import` cannot answer it either.
    if (!entry.indexed && entry.lastSuccessEpoch !== null && !detached) {
      checks.push({
        name: `Semantic index [${entry.project}]`,
        status: 'fail',
        detail: 'the last import did not verify the index — semantic search may not see the corpus. Re-run `npx keepmind curated:import`.',
        required: true,
      });
    }
  }

  return { title: 'Curated Corpus', checks };
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
    // The list of "the chain was rejected" verdicts lives in one place, because
    // the installer recognises them too and a second copy is how one of them
    // starts missing a code the other has.
    const certCode = certErrorCodeOf(err) ?? (findCertErrorCode(code));
    if (certCode) {
      tlsStatus = 'fail';
      tlsDetail =
        `certificate rejected (${certCode}) — corporate TLS interception. ` +
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
    buildCuratedGroup(probe, dataDir),
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
