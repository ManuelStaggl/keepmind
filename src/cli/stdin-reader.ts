
import { logger } from '../utils/logger.js';

function isStdinAvailable(): boolean {
  try {
    const stdin = process.stdin;

    if (stdin.isTTY) {
      return false;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    stdin.readable;
    return true;
  } catch (error) {
    logger.debug('HOOK', 'stdin not available (expected for some runtimes)', { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

function tryParseJson(input: string): { success: true; value: unknown } | { success: false } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { success: false };
  }

  try {
    const value = JSON.parse(trimmed);
    return { success: true, value };
  } catch (error) {
    logger.debug('HOOK', 'JSON parse attempt incomplete', { error: error instanceof Error ? error.message : String(error) });
    return { success: false };
  }
}

const SAFETY_TIMEOUT_MS = 30000;

/**
 * Perf plan P1: when bun-runner.js loads this client IN-PROCESS (instead of
 * spawning a second Node), it has already drained `process.stdin` to produce the
 * #2188 empty-payload diagnostic. Listening on stdin here would hang until the
 * safety timeout, so the runner hands the payload over on this global instead.
 *
 * One-shot by contract: the property is deleted on read, so a second call falls
 * through to the normal stdin path and a stale payload can never be replayed.
 */
const PRE_READ_STDIN_KEY = '__KEEPMIND_HOOK_STDIN';

function takePreReadStdin(): string | null {
  const holder = globalThis as unknown as Record<string, unknown>;
  const raw = holder[PRE_READ_STDIN_KEY];
  if (raw === undefined || raw === null) {
    return null;
  }
  delete holder[PRE_READ_STDIN_KEY];

  if (typeof raw === 'string') return raw;
  if (Buffer.isBuffer(raw)) return raw.toString('utf-8');

  logger.warn('HOOK', 'Pre-read stdin payload had an unexpected type, ignoring it', { type: typeof raw });
  return null;
}

export async function readJsonFromStdin(): Promise<unknown> {
  const preRead = takePreReadStdin();
  if (preRead !== null) {
    // Mirrors the stream path's EOF semantics exactly: blank input resolves to
    // undefined, malformed input throws (hookCommand turns that into a blocking
    // error), valid JSON resolves.
    if (!preRead.trim()) {
      return undefined;
    }
    const parsed = tryParseJson(preRead);
    if (parsed.success) {
      return parsed.value;
    }
    throw new Error(`Malformed JSON in pre-read hook payload: ${preRead.slice(0, 100)}...`);
  }

  if (!isStdinAvailable()) {
    return undefined;
  }

  return new Promise((resolve, reject) => {
    let input = '';
    let resolved = false;

    const cleanup = () => {
      try {
        process.stdin.removeAllListeners('data');
        process.stdin.removeAllListeners('end');
        process.stdin.removeAllListeners('error');
      } catch {
        // Ignore cleanup errors
      }
    };

    const resolveWith = (value: unknown) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(safetyTimeoutId);
      cleanup();
      resolve(value);
    };

    const rejectWith = (error: Error) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(safetyTimeoutId);
      cleanup();
      reject(error);
    };

    const tryResolveWithJson = () => {
      const result = tryParseJson(input);
      if (result.success) {
        resolveWith(result.value);
        return true;
      }
      return false;
    };

    const safetyTimeoutId = setTimeout(() => {
      if (!resolved) {
        if (!tryResolveWithJson()) {
          if (input.trim()) {
            rejectWith(new Error(`Incomplete JSON after ${SAFETY_TIMEOUT_MS}ms: ${input.slice(0, 100)}...`));
          } else {
            resolveWith(undefined);
          }
        }
      }
    }, SAFETY_TIMEOUT_MS);

    const onData = (chunk: Buffer | string) => {
      input += chunk;

      if (tryResolveWithJson()) {
        return;
      }
    };

    const onEnd = () => {
      if (!resolved) {
        if (!tryResolveWithJson()) {
          if (input.trim()) {
            rejectWith(new Error(`Malformed JSON at stdin EOF: ${input.slice(0, 100)}...`));
          } else {
            resolveWith(undefined);
          }
        }
      }
    };

    const onError = () => {
      if (!resolved) {
        resolveWith(undefined);
      }
    };

    try {
      process.stdin.on('data', onData);
      process.stdin.on('end', onEnd);
      process.stdin.on('error', onError);
    } catch (error) {
      logger.debug('HOOK', 'Failed to attach stdin listeners', { error: error instanceof Error ? error.message : String(error) });
      resolved = true;
      clearTimeout(safetyTimeoutId);
      cleanup();
      resolve(undefined);
    }
  });
}
