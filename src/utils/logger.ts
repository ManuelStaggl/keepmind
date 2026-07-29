
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { paths } from '../shared/paths.js';
import { emitDiagnostic } from '../shared/hook-io.js';

// Delete daily log files older than this. Logs previously accumulated forever
// (~6 MB/day) with no rotation (perf plan R5). Pruned once per process at
// log-file init — cheap and best-effort.
const LOG_RETENTION_DAYS = 14;

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4
}

export type Component =
  | 'AGENTS_MD'
  | 'BRANCH'
  | 'CHROMA'
  | 'VECTOR_SYNC'
  | 'VEC'
  | 'EMBEDDER'
  | 'CLAUDE_MD'
  | 'CONFIG'
  | 'CONSOLE'
  | 'CURSOR'
  | 'DB'
  | 'DEDUP'
  | 'ENV'
  | 'FOLDER_INDEX'
  | 'GIT'
  | 'HOOK'
  | 'HTTP'
  | 'IMPORT'
  | 'INGEST'
  | 'OAUTH'
  | 'OPENCODE'
  | 'PARSER'
  | 'PROCESS'
  | 'PROJECT_NAME'
  | 'QUEUE'
  | 'SDK'
  | 'SDK_SPAWN'
  | 'SEARCH'
  | 'SECURITY'
  | 'SESSION'
  | 'SETTINGS'
  | 'SHUTDOWN'
  | 'SYSTEM'
  | 'TELEGRAM'
  | 'TRANSCRIPT'
  | 'WINDSURF'
  | 'WORKER';

interface LogContext {
  sessionId?: string | number;
  memorySessionId?: string;
  correlationId?: string | number;
  [key: string]: any;
}

/**
 * Optional error sink. The logger must NEVER import the telemetry client (that
 * would create an import cycle: telemetry → logger via instrument.ts → ...).
 * Instead worker/telemetry init injects a sink via logger.setErrorSink(); when
 * present, logger.error()/logger.failure() route their Error payload through it
 * (consent + rate-limit + kill-switch all enforced INSIDE the sink, i.e.
 * captureException). The sink is optional and swallow-all so logging keeps
 * working with telemetry disabled or uninstalled.
 */
export type ErrorSink = (err: unknown, ctx?: Record<string, unknown>) => void;
let errorSink: ErrorSink | null = null;

// ---------------------------------------------------------------------------
// Repeat suppression
//
// A single recurring cause could write one line per event forever: a missing
// sqlite-vec produced 2157 identical ERROR lines in one day (each carrying a
// multi-line "Require stack:" in its message), and 55.8 MB of logs across 15
// files. The information content of line 2000 is zero — what matters is that it
// happened and how often.
//
// So: the first occurrence of a (level, component, message) triple inside a
// window is written in full; further occurrences are counted, not written. The
// next line emitted after the window closes carries the suppressed count, so no
// occurrence is ever silently lost. Context/data payloads of the suppressed
// repeats ARE dropped — that is the point; the first one is representative.
const DEDUP_WINDOW_MS = 60_000;
const DEDUP_MAX_KEYS = 500;

interface DedupEntry {
  windowStartedAt: number;
  suppressed: number;
}

const dedupState = new Map<string, DedupEntry>();

/** Test hook: drop the repeat-suppression state between cases. */
export function resetLogDedupForTesting(): void {
  dedupState.clear();
}


/**
 * A cheap, bounded fingerprint of a line's variable payload.
 *
 * Keying suppression on the message text alone would collapse genuinely
 * DIFFERENT events that share a message — "Batch embed/insert failed" for three
 * separate batches, or a per-session warning across sessions — and the detail
 * that distinguishes them lives entirely in `context`/`data`. Folding those into
 * the key keeps distinct failures distinct while still collapsing the case this
 * exists for: a repeated module-load error whose context is identical every time.
 *
 * Truncated because the key is built on the hot path and never read back.
 */
function payloadFingerprint(context?: LogContext, data?: unknown): string {
  try {
    let out = '';
    if (context) {
      for (const key of Object.keys(context).sort()) {
        out += `${key}=${String((context as Record<string, unknown>)[key])};`;
        if (out.length > 200) break;
      }
    }
    if (data instanceof Error) out += `E:${data.message}`;
    else if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') out += `D:${data}`;
    else if (data) out += 'D:obj';
    return out.slice(0, 200);
  } catch {
    // A getter that throws must not break logging.
    return '';
  }
}

/**
 * Decide whether this line is written, and with what repeat suffix.
 *
 * Returns null when the line is a repeat inside an open window (caller drops
 * it), or a suffix string ('' or ' (repeated N× in the previous Ms)') to append
 * when it is written.
 */
export function classifyRepeat(
  level: LogLevel,
  component: string,
  message: string,
  now: number,
  context?: LogContext,
  data?: unknown,
): string | null {
  const key = `${level}|${component}|${message}|${payloadFingerprint(context, data)}`;
  const entry = dedupState.get(key);

  if (entry && now - entry.windowStartedAt < DEDUP_WINDOW_MS) {
    entry.suppressed++;
    return null;
  }

  // Map insertion order is iteration order, so the first key is the least
  // recently *started* window — good enough for a bounded cache whose only job
  // is to stop unbounded growth.
  if (!entry && dedupState.size >= DEDUP_MAX_KEYS) {
    const oldest = dedupState.keys().next();
    if (!oldest.done) dedupState.delete(oldest.value);
  }

  const suppressed = entry?.suppressed ?? 0;
  const windowSeconds = entry ? Math.round((now - entry.windowStartedAt) / 1000) : 0;
  dedupState.set(key, { windowStartedAt: now, suppressed: 0 });

  return suppressed > 0
    ? ` (repeated ${suppressed}× in the previous ${windowSeconds}s)`
    : '';
}

class Logger {
  private level: LogLevel | null = null;
  private useColor: boolean;
  private logFilePath: string | null = null;
  private logFileInitialized: boolean = false;

  constructor() {
    this.useColor = process.stdout.isTTY ?? false;
    // Don't initialize log file in constructor - do it lazily to avoid circular dependency
  }

  private ensureLogFileInitialized(): void {
    if (this.logFileInitialized) return;
    this.logFileInitialized = true;

    try {
      const logsDir = paths.logsDir();

      if (!existsSync(logsDir)) {
        mkdirSync(logsDir, { recursive: true });
      }

      const date = new Date().toISOString().split('T')[0];
      this.logFilePath = join(logsDir, `keepmind-${date}.log`);
      this.pruneOldLogs(logsDir);
    } catch (error: unknown) {
      console.error('[LOGGER] Failed to initialize log file:', error instanceof Error ? error.message : String(error));
      this.logFilePath = null;
    }
  }

  /** Best-effort deletion of daily log files older than LOG_RETENTION_DAYS. */
  private pruneOldLogs(logsDir: string): void {
    try {
      const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
      for (const name of readdirSync(logsDir)) {
        const match = /^keepmind-(\d{4}-\d{2}-\d{2})\.log$/.exec(name);
        if (!match) continue;
        const fileTime = Date.parse(match[1]);
        if (Number.isFinite(fileTime) && fileTime < cutoff) {
          try { unlinkSync(join(logsDir, name)); } catch { /* best-effort */ }
        }
      }
    } catch {
      // Retention is best-effort and must NEVER break logging.
    }
  }

  private getLevel(): LogLevel {
    if (this.level === null) {
      try {
        const settingsPath = paths.settings();
        if (existsSync(settingsPath)) {
          const settingsData = readFileSync(settingsPath, 'utf-8');
          const settings = JSON.parse(settingsData);
          const envLevel = (settings.KEEPMIND_LOG_LEVEL || 'INFO').toUpperCase();
          this.level = LogLevel[envLevel as keyof typeof LogLevel] ?? LogLevel.INFO;
        } else {
          this.level = LogLevel.INFO;
        }
      } catch (error: unknown) {
        console.error('[LOGGER] Failed to load log level from settings:', error instanceof Error ? error.message : String(error));
        this.level = LogLevel.INFO;
      }
    }
    return this.level;
  }

  private formatData(data: any): string {
    if (data === null || data === undefined) return '';
    if (typeof data === 'string') return data;
    if (typeof data === 'number') return data.toString();
    if (typeof data === 'boolean') return data.toString();

    if (typeof data === 'object') {
      if (data instanceof Error) {
        return this.getLevel() === LogLevel.DEBUG
          ? `${data.message}\n${data.stack}`
          : data.message;
      }

      if (Array.isArray(data)) {
        return `[${data.length} items]`;
      }

      const keys = Object.keys(data);
      if (keys.length === 0) return '{}';
      if (keys.length <= 3) {
        return JSON.stringify(data);
      }
      return `{${keys.length} keys: ${keys.slice(0, 3).join(', ')}...}`;
    }

    return String(data);
  }

  formatTool(toolName: string, toolInput?: any): string {
    if (!toolInput) return toolName;

    let input = toolInput;
    if (typeof toolInput === 'string') {
      try {
        input = JSON.parse(toolInput);
      } catch (_parseError: unknown) {
        input = toolInput;
      }
    }

    if (toolName === 'Bash' && input.command) {
      return `${toolName}(${input.command})`;
    }

    if (input.file_path) {
      return `${toolName}(${input.file_path})`;
    }

    if (input.notebook_path) {
      return `${toolName}(${input.notebook_path})`;
    }

    if (toolName === 'Glob' && input.pattern) {
      return `${toolName}(${input.pattern})`;
    }

    if (toolName === 'Grep' && input.pattern) {
      return `${toolName}(${input.pattern})`;
    }

    if (input.url) {
      return `${toolName}(${input.url})`;
    }

    if (input.query) {
      return `${toolName}(${input.query})`;
    }

    if (toolName === 'Task') {
      if (input.subagent_type) {
        return `${toolName}(${input.subagent_type})`;
      }
      if (input.description) {
        return `${toolName}(${input.description})`;
      }
    }

    if (toolName === 'Skill' && input.skill) {
      return `${toolName}(${input.skill})`;
    }

    if (toolName === 'LSP' && input.operation) {
      return `${toolName}(${input.operation})`;
    }

    return toolName;
  }

  private formatTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
  }

  private log(
    level: LogLevel,
    component: Component,
    message: string,
    context?: LogContext,
    data?: any
  ): void {
    if (level < this.getLevel()) return;

    // Repeat suppression runs BEFORE any formatting so a hot loop of identical
    // lines costs a map lookup, not a JSON.stringify. Opt out with
    // KEEPMIND_LOG_DEDUP=0 when chasing an exact per-event trace.
    let repeatSuffix = '';
    if (process.env.KEEPMIND_LOG_DEDUP !== '0') {
      const classified = classifyRepeat(level, component, message, Date.now(), context, data);
      if (classified === null) return;
      repeatSuffix = classified;
    }

    this.ensureLogFileInitialized();

    const timestamp = this.formatTimestamp(new Date());
    const levelStr = LogLevel[level].padEnd(5);
    const componentStr = component.padEnd(6);

    let correlationStr = '';
    if (context?.correlationId) {
      correlationStr = `[${context.correlationId}] `;
    } else if (context?.sessionId) {
      correlationStr = `[session-${context.sessionId}] `;
    }

    let dataStr = '';
    if (data !== undefined && data !== null) {
      if (data instanceof Error) {
        dataStr = this.getLevel() === LogLevel.DEBUG
          ? `\n${data.message}\n${data.stack}`
          : ` ${data.message}`;
      } else if (this.getLevel() === LogLevel.DEBUG && typeof data === 'object') {
        try {
          dataStr = '\n' + JSON.stringify(data, null, 2);
        } catch {
          dataStr = ' ' + this.formatData(data);
        }
      } else {
        dataStr = ' ' + this.formatData(data);
      }
    }

    let contextStr = '';
    if (context) {
      const { sessionId, memorySessionId, correlationId, ...rest } = context;
      if (Object.keys(rest).length > 0) {
        const pairs = Object.entries(rest).map(([k, v]) => `${k}=${v}`);
        contextStr = ` {${pairs.join(', ')}}`;
      }
    }

    const logLine = `[${timestamp}] [${levelStr}] [${componentStr}] ${correlationStr}${message}${repeatSuffix}${contextStr}${dataStr}`;

    if (this.logFilePath) {
      try {
        appendFileSync(this.logFilePath, logLine + '\n', 'utf8');
      } catch (error: unknown) {
        // DIAGNOSTIC: route through hook-io so the message bypasses the Phase 2
        // hook stderr buffer (#2292). Outside the hook context emitDiagnostic
        // writes straight to real stderr, so non-hook callers are unaffected.
        emitDiagnostic(`[LOGGER] Failed to write to log file: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    } else {
      // DIAGNOSTIC: see note above.
      emitDiagnostic(logLine + '\n');
    }
  }

  debug(component: Component, message: string, context?: LogContext, data?: any): void {
    this.log(LogLevel.DEBUG, component, message, context, data);
  }

  info(component: Component, message: string, context?: LogContext, data?: any): void {
    this.log(LogLevel.INFO, component, message, context, data);
  }

  warn(component: Component, message: string, context?: LogContext, data?: any): void {
    this.log(LogLevel.WARN, component, message, context, data);
  }

  /**
   * Installs (or clears, with null) the optional error sink. Called once by
   * worker/telemetry init to bridge logged errors into captureException without
   * the logger importing telemetry (no import cycle). Never throws.
   */
  setErrorSink(sink: ErrorSink | null): void {
    errorSink = sink;
  }

  error(component: Component, message: string, context?: LogContext, data?: any): void {
    this.log(LogLevel.ERROR, component, message, context, data);
    this.routeErrorToSink(message, context, data);
  }

  /**
   * Routes a logged Error through the optional error sink (captureException).
   * Only fires when `data` is an actual Error so we never ship arbitrary log
   * payloads as exceptions. Swallow-all: the sink failing (or being absent)
   * must never break logging. `failure()` delegates to `error()`, so it is
   * covered too — but it passes the same `data` object, so we de-dupe by only
   * routing from the single `error()` entry point.
   */
  private routeErrorToSink(message: string, context?: LogContext, data?: any): void {
    try {
      if (!errorSink || !(data instanceof Error)) return;
      // Pass the message as context so the sink can fingerprint on it too; the
      // sink (captureException) scrubs everything through error-scrub /
      // scrubProperties, so an unsafe message here cannot leak — but `message`
      // is not whitelisted, so it is dropped by scrubProperties anyway. We pass
      // only the Error itself; context is intentionally minimal.
      errorSink(data);
    } catch {
      // Telemetry/error-sink must never break logging.
    }
  }

  dataIn(component: Component, message: string, context?: LogContext, data?: any): void {
    this.info(component, `→ ${message}`, context, data);
  }

  dataOut(component: Component, message: string, context?: LogContext, data?: any): void {
    this.info(component, `← ${message}`, context, data);
  }

  success(component: Component, message: string, context?: LogContext, data?: any): void {
    this.info(component, `✓ ${message}`, context, data);
  }

  failure(component: Component, message: string, context?: LogContext, data?: any): void {
    this.error(component, `✗ ${message}`, context, data);
  }

  happyPathError<T = string>(
    component: Component,
    message: string,
    context?: LogContext,
    data?: any,
    fallback: T = '' as T
  ): T {
    const stack = new Error().stack || '';
    const stackLines = stack.split('\n');
    const callerLine = stackLines[2] || '';
    const callerMatch = callerLine.match(/at\s+(?:.*\s+)?\(?([^:]+):(\d+):(\d+)\)?/);
    const location = callerMatch
      ? `${callerMatch[1].split('/').pop()}:${callerMatch[2]}`
      : 'unknown';

    const enhancedContext = {
      ...context,
      location
    };

    this.warn(component, `[HAPPY-PATH] ${message}`, enhancedContext, data);

    return fallback;
  }
}

export const logger = new Logger();
