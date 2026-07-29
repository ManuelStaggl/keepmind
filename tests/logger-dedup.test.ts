import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { paths } from '../src/shared/paths.js';
import { logger, resetLogDedupForTesting, classifyRepeat, LogLevel } from '../src/utils/logger.js';

// The logger appends to a per-day file; read it back to assert on what was
// actually written rather than on internal state.
function logFilePath(): string {
  const date = new Date().toISOString().split('T')[0];
  return join(paths.logsDir(), `keepmind-${date}.log`);
}

function linesMatching(needle: string): string[] {
  const path = logFilePath();
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf-8').split('\n').filter(l => l.includes(needle));
}

let counter = 0;
/** Unique per test so cases cannot see each other's lines in the shared file. */
function uniqueMessage(): string {
  return `dedup-probe-${process.pid}-${counter++}`;
}

describe('logger repeat suppression (A3 — one cause must not write 2157 lines)', () => {
  beforeEach(() => {
    resetLogDedupForTesting();
    delete process.env.KEEPMIND_LOG_DEDUP;
    mkdirSync(paths.logsDir(), { recursive: true });
  });
  afterEach(() => {
    resetLogDedupForTesting();
    delete process.env.KEEPMIND_LOG_DEDUP;
  });

  it('writes the first occurrence in full', () => {
    const msg = uniqueMessage();
    logger.error('SYSTEM', msg, {}, new Error('boom'));

    const lines = linesMatching(msg);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('boom');
  });

  it('collapses a burst of identical lines into one', () => {
    const msg = uniqueMessage();
    for (let i = 0; i < 100; i++) {
      logger.error('SYSTEM', msg, {}, new Error("Cannot find module 'sqlite-vec'"));
    }

    expect(linesMatching(msg)).toHaveLength(1);
  });

  it('does not annotate the first line of a window', () => {
    const msg = uniqueMessage();
    for (let i = 0; i < 10; i++) logger.error('SYSTEM', msg);

    expect(linesMatching(msg)).toHaveLength(1);
    expect(linesMatching(msg)[0]).not.toContain('repeated');
  });

  it('does not suppress different messages from the same component', () => {
    const a = uniqueMessage();
    const b = uniqueMessage();
    logger.error('SYSTEM', a);
    logger.error('SYSTEM', b);

    expect(linesMatching(a)).toHaveLength(1);
    expect(linesMatching(b)).toHaveLength(1);
  });

  it('does not suppress the same message from different components', () => {
    const msg = uniqueMessage();
    logger.error('SYSTEM', msg);
    logger.error('WORKER', msg);

    expect(linesMatching(msg)).toHaveLength(2);
  });

  it('does not suppress the same message at different levels', () => {
    const msg = uniqueMessage();
    logger.error('SYSTEM', msg);
    logger.warn('SYSTEM', msg);

    expect(linesMatching(msg)).toHaveLength(2);
  });

  // The window-close behaviour needs a controllable clock, so exercise the
  // classifier directly — logger.log() reads Date.now() internally.
  describe('window accounting (classifyRepeat)', () => {
    it('admits the first call and suppresses the rest of the window', () => {
      const t0 = 1_000_000;
      expect(classifyRepeat(LogLevel.ERROR, 'SYSTEM', 'x', t0)).toBe('');
      expect(classifyRepeat(LogLevel.ERROR, 'SYSTEM', 'x', t0 + 1)).toBeNull();
      expect(classifyRepeat(LogLevel.ERROR, 'SYSTEM', 'x', t0 + 59_000)).toBeNull();
    });

    it('annotates the first line after the window with the suppressed count', () => {
      const t0 = 1_000_000;
      classifyRepeat(LogLevel.ERROR, 'SYSTEM', 'x', t0);
      for (let i = 1; i <= 41; i++) classifyRepeat(LogLevel.ERROR, 'SYSTEM', 'x', t0 + i);

      const suffix = classifyRepeat(LogLevel.ERROR, 'SYSTEM', 'x', t0 + 61_000);

      expect(suffix).toBe(' (repeated 41× in the previous 61s)');
    });

    it('resets the count after the annotated line, so counts never accumulate', () => {
      const t0 = 1_000_000;
      classifyRepeat(LogLevel.ERROR, 'SYSTEM', 'x', t0);
      classifyRepeat(LogLevel.ERROR, 'SYSTEM', 'x', t0 + 1);
      classifyRepeat(LogLevel.ERROR, 'SYSTEM', 'x', t0 + 61_000);

      expect(classifyRepeat(LogLevel.ERROR, 'SYSTEM', 'x', t0 + 122_000)).toBe('');
    });
  });

  it('does not collapse different failures that share a message', () => {
    // "Batch embed/insert failed" for three separate batches is three events;
    // the detail that distinguishes them lives in the context, not the message.
    const msg = uniqueMessage();
    logger.error('VECTOR_SYNC', msg, { batch: 1 });
    logger.error('VECTOR_SYNC', msg, { batch: 2 });
    logger.error('VECTOR_SYNC', msg, { batch: 3 });

    expect(linesMatching(msg)).toHaveLength(3);
  });

  it('does not collapse the same message carrying different errors', () => {
    const msg = uniqueMessage();
    logger.error('SYSTEM', msg, {}, new Error('disk full'));
    logger.error('SYSTEM', msg, {}, new Error('permission denied'));

    expect(linesMatching(msg)).toHaveLength(2);
  });

  it('still collapses a repeat whose payload is identical every time', () => {
    // The sqlite-vec flood: same message, same empty context, same error.
    const msg = uniqueMessage();
    for (let i = 0; i < 50; i++) {
      logger.error('SYSTEM', msg, {}, new Error("Cannot find module 'sqlite-vec'"));
    }

    expect(linesMatching(msg)).toHaveLength(1);
  });

  it('KEEPMIND_LOG_DEDUP=0 restores a line per event for tracing', () => {
    const msg = uniqueMessage();
    process.env.KEEPMIND_LOG_DEDUP = '0';

    for (let i = 0; i < 5; i++) logger.error('SYSTEM', msg);

    expect(linesMatching(msg)).toHaveLength(5);
  });
});
