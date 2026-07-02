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

  it('acquire counts as activity and increments the approximate size', () => {
    const clock = { t: 0 };
    const { rc, shutdowns } = make(60_000, clock);
    expect(rc.acquire('s1')).toBe(1);
    expect(rc.acquire('s2')).toBe(2);
    expect(rc.size()).toBe(2);
    clock.t += 30_000;               // 30s — under the window
    rc.maybeShutdown();
    expect(shutdowns()).toBe(0);
  });

  it('release decrements the approximate size but is not required for shutdown', () => {
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
});
