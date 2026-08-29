import { describe, it, expect } from 'bun:test';
import { SessionRefCounter } from '../../src/services/worker/SessionRefCounter.js';

// Activity-based idle lifecycle (v1.3.3): the worker shuts down after `idleMs`
// of no activity, once it has served ≥1 request. Pure logic with an injectable
// clock; maybeShutdown() stands in for the periodic interval tick.
function make(idleMs: number, clock: { t: number }) {
  let shutdowns = 0;
  const rc = new SessionRefCounter({
    idleMs,
    checkIntervalMs: 1000,
    onIdleShutdown: () => { shutdowns++; },
    now: () => clock.t,
  });
  return { rc, shutdowns: () => shutdowns };
}

describe('SessionRefCounter (activity-based idle shutdown)', () => {
  it('never shuts down before the worker has served any activity', () => {
    const clock = { t: 0 };
    const { rc, shutdowns } = make(5 * 60_000, clock);
    clock.t = 999_999_999;           // ages past any idle window
    rc.maybeShutdown();
    expect(shutdowns()).toBe(0);     // everActive is false → stays up
    expect(rc.isIdle()).toBe(false);
  });

  it('shuts down after idleMs of inactivity once active', () => {
    const clock = { t: 1000 };
    const { rc, shutdowns } = make(5 * 60_000, clock);
    rc.recordActivity();             // now active
    clock.t += 4 * 60_000;           // 4 min later — not yet idle
    rc.maybeShutdown();
    expect(shutdowns()).toBe(0);
    clock.t += 2 * 60_000;           // total 6 min since activity — idle
    expect(rc.isIdle()).toBe(true);
    rc.maybeShutdown();
    expect(shutdowns()).toBe(1);
  });

  it('activity resets the idle clock (keeps the worker alive)', () => {
    const clock = { t: 0 };
    const { rc, shutdowns } = make(5 * 60_000, clock);
    rc.recordActivity();
    for (let i = 0; i < 10; i++) {
      clock.t += 4 * 60_000;         // 4 min gaps, each under the 5 min window
      rc.recordActivity();           // ...refreshed by activity
      rc.maybeShutdown();
    }
    expect(shutdowns()).toBe(0);
  });

  it('acquire counts as activity and increments the acquired count (S11)', () => {
    const clock = { t: 0 };
    const { rc, shutdowns } = make(60_000, clock);
    expect(rc.acquire('s1')).toBe(1);
    expect(rc.acquire('s2')).toBe(2);
    expect(rc.acquiredCount()).toBe(2);
    clock.t += 30_000;               // 30s — under the window
    rc.maybeShutdown();
    expect(shutdowns()).toBe(0);
  });

  it('release decrements the acquired count but is not required for shutdown', () => {
    const clock = { t: 0 };
    const { rc } = make(60_000, clock);
    rc.acquire('s1');
    expect(rc.release('s1')).toBe(0);
    expect(rc.release('s1')).toBe(0); // never goes negative
  });

  it('fires onIdleShutdown at most once', () => {
    const clock = { t: 0 };
    const { rc, shutdowns } = make(1000, clock);
    rc.recordActivity();
    clock.t += 5000;
    rc.maybeShutdown();
    rc.maybeShutdown();
    rc.maybeShutdown();
    expect(shutdowns()).toBe(1);
  });

  it('idleMs <= 0 disables auto-shutdown entirely', () => {
    const clock = { t: 0 };
    const { rc, shutdowns } = make(0, clock);
    rc.recordActivity();
    clock.t += 10 * 60 * 60_000;     // 10h later
    expect(rc.isIdle()).toBe(false);
    rc.maybeShutdown();
    expect(shutdowns()).toBe(0);
  });

  it('stop() prevents any further shutdown', () => {
    const clock = { t: 0 };
    const { rc, shutdowns } = make(1000, clock);
    rc.recordActivity();
    rc.stop();
    clock.t += 5000;
    rc.maybeShutdown();
    expect(shutdowns()).toBe(0);
  });

  // S8 — the orphan case. `everActive` is set only by the first request a
  // worker is GIVEN, and an orphan is orphaned before that ever happens: the
  // launcher decided it was too slow, spawned a replacement, and stopped
  // referencing it. So the old `everActive &&` guard excluded exactly the
  // worker that needed reaping. Measured 29.08.2026: one such process alive
  // 4h14m at 860s CPU, and holding keepmind.db open — which is the
  // `database is locked` that wedged a worker for 28 hours on 27.08.
  it('S8 — a ready worker that is never used shuts down after the idle window', () => {
    const clock = { t: 0 };
    const { rc, shutdowns } = make(60_000, clock);

    rc.markReady();
    clock.t += 59_000;
    rc.maybeShutdown();
    expect(shutdowns()).toBe(0);

    clock.t += 2_000;
    rc.maybeShutdown();
    expect(shutdowns()).toBe(1);
  });

  it('S8 — the window starts at readiness, so a slow cold boot is not reaped', () => {
    const clock = { t: 0 };
    const { rc, shutdowns } = make(60_000, clock);

    // 10 minutes of cold booting: no readiness yet, so nothing may fire.
    clock.t += 600_000;
    rc.maybeShutdown();
    expect(shutdowns()).toBe(0);

    rc.markReady();
    clock.t += 30_000;
    rc.maybeShutdown();
    expect(shutdowns()).toBe(0);
  });

  it('S8 — a worker that IS used follows the activity clock, not the ready clock', () => {
    const clock = { t: 0 };
    const { rc, shutdowns } = make(60_000, clock);

    rc.markReady();
    clock.t += 50_000;
    rc.recordActivity();
    clock.t += 50_000;   // 100s since ready, but only 50s since activity
    rc.maybeShutdown();
    expect(shutdowns()).toBe(0);

    clock.t += 11_000;
    rc.maybeShutdown();
    expect(shutdowns()).toBe(1);
  });

  it('markReady is idempotent — a re-initialisation cannot restart the window', () => {
    const clock = { t: 0 };
    const { rc, shutdowns } = make(60_000, clock);

    rc.markReady();
    clock.t += 40_000;
    rc.markReady();
    clock.t += 25_000;
    rc.maybeShutdown();
    expect(shutdowns()).toBe(1);
  });
});
