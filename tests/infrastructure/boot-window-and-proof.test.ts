// S9 — the cold-boot window is settable.
// S7 — killing a process needs PROOF that it is ours.
//
// Both are small functions carrying a large consequence, and both were paid for
// by the same measurement on 29.08.2026: three worker-service processes alive at
// once, two of them unreferenced, one for 4h14m at 860s CPU — and all of them
// holding keepmind.db open, which is the `database is locked` that wedged a
// worker for 28 hours on 27.08.

import { describe, it, expect, afterEach } from '../bun-test-shim.js';
import {
  getBootWindowMs,
  getPlatformTimeout,
  WORKER_BOOT_WINDOW_DEFAULT_MS,
} from '../../src/services/infrastructure/ProcessManager.js';
import { isProvenWorkerProcess } from '../../src/supervisor/process-registry.js';

const ENV_KEY = 'KEEPMIND_WORKER_BOOT_TIMEOUT_MS';

describe('S9 — the cold-boot window', () => {
  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('defaults generously — 15s was too little on the machine that failed', () => {
    delete process.env[ENV_KEY];
    expect(WORKER_BOOT_WINDOW_DEFAULT_MS).toBeGreaterThan(15_000);
    expect(getBootWindowMs()).toBe(getPlatformTimeout(WORKER_BOOT_WINDOW_DEFAULT_MS));
  });

  it('is settable, which is the actual complaint — 123 settings and none of them this one', () => {
    process.env[ENV_KEY] = '45000';
    expect(getBootWindowMs()).toBe(getPlatformTimeout(45_000));
  });

  it('falls back rather than to zero — a window of 0 respawns on every hook', () => {
    for (const bad of ['0', '-1', 'nonsense', '', '999999999']) {
      process.env[ENV_KEY] = bad;
      expect(getBootWindowMs()).toBe(getPlatformTimeout(WORKER_BOOT_WINDOW_DEFAULT_MS));
    }
  });

  it('still doubles on Windows, where the slow boots were measured', () => {
    process.env[ENV_KEY] = '20000';
    const expected = process.platform === 'win32' ? 40_000 : 20_000;
    expect(getBootWindowMs()).toBe(expected);
  });
});

describe('S7 — proof before a kill', () => {
  it('refuses without a stored start token', () => {
    // A pid file written by an older build carries no token. `false` here means
    // "cannot prove", and the process is merely forgotten as before — S8's idle
    // shutdown reaps it a few minutes later instead.
    expect(isProvenWorkerProcess({ pid: process.pid, port: 1, startedAt: '' })).toBe(false);
  });

  it('refuses on a token mismatch — that is what PID reuse looks like', () => {
    expect(isProvenWorkerProcess({
      pid: process.pid, port: 1, startedAt: '', startToken: 'definitely-not-this-process',
    })).toBe(false);
  });

  it('refuses for a pid that is not alive', () => {
    expect(isProvenWorkerProcess({ pid: 0x7fffffff, port: 1, startedAt: '', startToken: 'x' })).toBe(false);
  });

  it('refuses for null', () => {
    expect(isProvenWorkerProcess(null)).toBe(false);
  });

  it('is STRICTER than verifyPidFileOwnership, which fails safe the other way', async () => {
    const { verifyPidFileOwnership } = await import('../../src/supervisor/process-registry.js');
    const noToken = { pid: process.pid, port: 1, startedAt: '' };

    // The same input: "wait for it" says yes, "kill it" says no. That asymmetry
    // is the whole point — on Windows a recycled PID belongs to an unrelated
    // program, and the stale-PID branch exists because PID reuse happens there.
    expect(verifyPidFileOwnership(noToken)).toBe(true);
    expect(isProvenWorkerProcess(noToken)).toBe(false);
  });
});
