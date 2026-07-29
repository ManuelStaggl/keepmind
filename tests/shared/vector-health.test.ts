import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { rmSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { DATA_DIR } from '../../src/shared/paths.js';
import {
  recordVectorDegraded,
  clearVectorDegraded,
  readVectorHealthMarker,
  readVectorHealthHint,
} from '../../src/shared/vector-health.js';

const MARKER_PATH = join(DATA_DIR, '.vector-health.json');
const DAY = 24 * 60 * 60 * 1000;

describe('vector health marker (A1 — degradation must be visible)', () => {
  beforeEach(() => { try { rmSync(MARKER_PATH, { force: true }); } catch { /* none */ } });
  afterEach(() => { try { rmSync(MARKER_PATH, { force: true }); } catch { /* none */ } });

  it('reports no hint when the vector store is healthy', () => {
    expect(readVectorHealthHint()).toBeNull();
    expect(readVectorHealthMarker()).toBeNull();
  });

  it('records a degradation that the hook side can read back', () => {
    recordVectorDegraded('deps_missing', "Cannot find module 'sqlite-vec'", 'Run `npx keepmind install`.');

    const marker = readVectorHealthMarker();
    expect(marker).not.toBeNull();
    expect(marker!.reason).toBe('deps_missing');
    expect(marker!.detail).toContain('sqlite-vec');
    expect(marker!.remediation).toContain('npx keepmind install');
  });

  it('produces a hint that names both the impact and the fix', () => {
    recordVectorDegraded('deps_missing', 'boom', 'Run `npx keepmind install`.');

    const hint = readVectorHealthHint();
    expect(hint).not.toBeNull();
    expect(hint).toContain('DEGRADED');
    expect(hint).toContain('keywords only');
    expect(hint).toContain('deps_missing');
    expect(hint).toContain('npx keepmind install');
  });

  it('keeps only the first line of a multi-line error (Require stack noise)', () => {
    recordVectorDegraded(
      'deps_missing',
      "Cannot find module 'sqlite-vec'\nRequire stack:\n- /a/b.js\n- /c/d.js",
      'fix it',
    );

    expect(readVectorHealthMarker()!.detail).toBe("Cannot find module 'sqlite-vec'");
  });

  it('clears immediately once the store loads, with no TTL to wait out', () => {
    recordVectorDegraded('deps_missing', 'boom', 'fix it');
    expect(readVectorHealthHint()).not.toBeNull();

    clearVectorDegraded();

    expect(readVectorHealthHint()).toBeNull();
    expect(existsSync(MARKER_PATH)).toBe(false);
  });

  it('clearing a healthy install is a no-op, not an error', () => {
    expect(() => clearVectorDegraded()).not.toThrow();
  });

  it('ignores a marker left by a worker that has not run for a week', () => {
    const now = 1_000_000_000_000;
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(MARKER_PATH, JSON.stringify({
      reason: 'deps_missing',
      detail: 'boom',
      remediation: 'fix it',
      recordedAtEpoch: now - 8 * DAY,
    }));

    expect(readVectorHealthMarker(now)).toBeNull();
    expect(readVectorHealthHint(now)).toBeNull();
  });

  it('still honours a marker inside the staleness window', () => {
    const now = 1_000_000_000_000;
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(MARKER_PATH, JSON.stringify({
      reason: 'binary_missing',
      detail: 'boom',
      remediation: 'fix it',
      recordedAtEpoch: now - 2 * DAY,
    }));

    expect(readVectorHealthMarker(now)!.reason).toBe('binary_missing');
  });

  it('treats a corrupt marker as absent rather than throwing into a hook', () => {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(MARKER_PATH, '{ not json');

    expect(() => readVectorHealthHint()).not.toThrow();
    expect(readVectorHealthHint()).toBeNull();
  });

  it('treats a marker missing required fields as absent', () => {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(MARKER_PATH, JSON.stringify({ detail: 'no reason field' }));

    expect(readVectorHealthMarker()).toBeNull();
  });
});
