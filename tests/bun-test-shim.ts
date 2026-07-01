// SPDX-License-Identifier: Apache-2.0
//
// bun:test → node:test compatibility shim. The suite was written against bun's
// Jest-style API (`describe/it/expect/mock/spyOn`); this shim maps that surface
// onto node:test + a minimal expect/mock so the tests run under
// `node --import tsx --test` with the node-only runtime (no bun dependency).
//
// Every test file imports from here instead of 'bun:test'. Keep the surface in
// sync with what the suite actually uses (see the matchers/mocks below).

import { describe, it, test, before, after, beforeEach, afterEach, mock as nodeMock } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

// Resolve the file URL of the first stack frame outside this shim, so a relative
// `mock.module('../../src/x.js')` resolves against the CALLING test file (bun's
// semantics) rather than this shim's location (node's default).
function callerFileUrl(): string | undefined {
  const stack = new Error().stack ?? '';
  for (const line of stack.split('\n').slice(1)) {
    if (line.includes('bun-test-shim')) continue;
    // Match `(file:///…:line:col)` / `at file:///…` or a bare `(C:\…:line:col)`.
    const m = line.match(/\(?(file:\/\/\/[^):]+|[A-Za-z]:[\\/][^):]+)(?::\d+:\d+)?\)?$/);
    if (m) {
      const raw = m[1];
      return raw.startsWith('file:') ? raw : pathToFileURL(raw).href;
    }
  }
  return undefined;
}

// bun exposes beforeAll/afterAll; node:test's file-level equivalents are before/after.
export const beforeAll = before;
export const afterAll = after;

// bun's `it.if(cond)(name, fn)` / `test.if` — run only when cond is truthy.
type TestFn = typeof it;
function withIf<T extends TestFn>(base: T): T & { if(cond: boolean): T } {
  const wrapped = base as T & { if(cond: boolean): T };
  wrapped.if = (cond: boolean) => (cond ? base : (base.skip as unknown as T));
  return wrapped;
}
const itWithIf = withIf(it);
const testWithIf = withIf(test);
export { itWithIf as it, testWithIf as test, describe, beforeEach, afterEach };

// Tracks spyOn restores so bun's global `mock.restore()` can undo all spies.
const activeSpyRestores: Array<() => void> = [];
// Tracks the live module mock per specifier so a re-mock can restore-then-remock
// (bun allows re-mocking; node:test throws on a duplicate mock).
const activeModuleMocks = new Map<string, { restore(): void }>();

// ── mock / spyOn ────────────────────────────────────────────────────────────
// A callable mock that records calls and supports bun's fluent configuration
// (mockReturnValue / mockResolvedValue / mockImplementation / mockRestore).

export interface MockFn<TArgs extends unknown[] = any[], TRet = any> {
  (...args: TArgs): TRet;
  mock: { calls: TArgs[]; results: Array<{ type: 'return' | 'throw'; value: unknown }> };
  mockReturnValue(v: TRet): MockFn<TArgs, TRet>;
  mockResolvedValue(v: unknown): MockFn<TArgs, TRet>;
  mockRejectedValue(v: unknown): MockFn<TArgs, TRet>;
  mockImplementation(fn: (...args: TArgs) => TRet): MockFn<TArgs, TRet>;
  mockClear(): MockFn<TArgs, TRet>;
  mockReset(): MockFn<TArgs, TRet>;
  mockRestore(): void;
}

function makeMock<TArgs extends unknown[], TRet>(
  initialImpl?: (...args: TArgs) => TRet,
  onRestore?: () => void,
): MockFn<TArgs, TRet> {
  let impl: ((...args: TArgs) => TRet) | undefined = initialImpl;
  const fn = function (this: unknown, ...args: TArgs): TRet {
    fn.mock.calls.push(args);
    try {
      const value = impl ? (impl.apply(this, args) as TRet) : (undefined as TRet);
      fn.mock.results.push({ type: 'return', value });
      return value;
    } catch (err) {
      fn.mock.results.push({ type: 'throw', value: err });
      throw err;
    }
  } as MockFn<TArgs, TRet>;
  fn.mock = { calls: [], results: [] };
  fn.mockReturnValue = (v) => { impl = (() => v) as (...a: TArgs) => TRet; return fn; };
  fn.mockResolvedValue = (v) => { impl = (() => Promise.resolve(v)) as unknown as (...a: TArgs) => TRet; return fn; };
  fn.mockRejectedValue = (v) => { impl = (() => Promise.reject(v)) as unknown as (...a: TArgs) => TRet; return fn; };
  fn.mockImplementation = (f) => { impl = f; return fn; };
  fn.mockClear = () => { fn.mock.calls = []; fn.mock.results = []; return fn; };
  fn.mockReset = () => { impl = undefined; return fn.mockClear(); };
  fn.mockRestore = () => { onRestore?.(); };
  return fn;
}

type MockFactory = (...args: any[]) => any;

/** bun's `mock(impl)` — returns a fresh mock function. */
export interface MockNamespace {
  <TArgs extends unknown[], TRet>(impl?: (...args: TArgs) => TRet): MockFn<TArgs, TRet>;
  module(specifier: string, factory: () => Record<string, unknown>): void;
  /** bun's global mock.restore() — undo every spyOn made since the last restore. */
  restore(): void;
}

export const mock: MockNamespace = Object.assign(
  <TArgs extends unknown[], TRet>(impl?: (...args: TArgs) => TRet) => makeMock<TArgs, TRet>(impl),
  {
    restore(): void {
      while (activeSpyRestores.length) activeSpyRestores.pop()!();
    },
    // Maps bun's `mock.module(spec, () => exports)` onto node:test's
    // `mock.module(spec, { namedExports, defaultExport })`. Requires the runner
    // flag --experimental-test-module-mocks.
    module(specifier: string, factory: () => Record<string, unknown>): void {
      // Relative specifiers must resolve against the caller (bun semantics), not
      // this shim — otherwise node resolves them from tests/bun-test-shim.ts and
      // truncates the path. Absolute/bare specifiers pass through.
      let resolved = specifier;
      if (specifier.startsWith('.')) {
        const base = callerFileUrl();
        if (base) resolved = new URL(specifier, base).href;
      }
      // bun lets a module be re-mocked (the last mock wins); node:test throws
      // ERR_INVALID_STATE on a second mock of the same specifier. Restore the
      // prior mock first so re-mocking behaves like bun.
      const prior = activeModuleMocks.get(resolved);
      if (prior) { try { prior.restore(); } catch { /* already restored */ } }
      // node:test's current API takes the whole module namespace as `exports`
      // (default included as exports.default). bun's factory returns that shape.
      const handle = (nodeMock as unknown as {
        module(s: string, o: { exports: Record<string, unknown> }): { restore(): void };
      }).module(resolved, { exports: factory() });
      activeModuleMocks.set(resolved, handle);
    },
  },
);

/** bun's `spyOn(obj, key)` — replaces obj[key] with a mock, restorable. */
export function spyOn<T extends Record<string, any>, K extends keyof T>(obj: T, key: K): MockFn {
  const original = obj[key];
  let restored = false;
  const restore = () => { if (!restored) { restored = true; obj[key] = original; } };
  const spy = makeMock(
    typeof original === 'function' ? (original.bind(obj) as MockFactory) : undefined,
    restore,
  );
  obj[key] = spy as unknown as T[K];
  activeSpyRestores.push(restore);
  return spy;
}

// ── expect ──────────────────────────────────────────────────────────────────

function fail(message: string): never {
  throw new assert.AssertionError({ message });
}

class Expectation {
  constructor(private actual: any, private negated = false) {}

  private check(pass: boolean, message: string): void {
    if (this.negated ? pass : !pass) fail(message);
  }

  get not(): Expectation {
    return new Expectation(this.actual, !this.negated);
  }

  // Promise matchers: `await expect(p).resolves.toBe(x)` / `.rejects.toThrow()`.
  get resolves(): AsyncExpectation {
    return new AsyncExpectation(this.actual, this.negated, 'resolves');
  }
  get rejects(): AsyncExpectation {
    return new AsyncExpectation(this.actual, this.negated, 'rejects');
  }

  toBe(expected: any): void {
    this.check(Object.is(this.actual, expected), `expected ${format(this.actual)} to${this.negated ? ' not' : ''} be ${format(expected)}`);
  }
  toEqual(expected: any): void {
    this.check(equals(this.actual, expected), `expected ${format(this.actual)} to${this.negated ? ' not' : ''} equal ${format(expected)}`);
  }
  toStrictEqual(expected: any): void {
    let pass = true;
    try { assert.deepStrictEqual(this.actual, expected); } catch { pass = false; }
    this.check(pass, `expected ${format(this.actual)} to${this.negated ? ' not' : ''} strictly equal ${format(expected)}`);
  }
  toContain(item: any): void {
    const pass = typeof this.actual === 'string'
      ? this.actual.includes(item)
      : Array.isArray(this.actual) && this.actual.some((x) => Object.is(x, item) || equals(x, item));
    this.check(pass, `expected ${format(this.actual)} to${this.negated ? ' not' : ''} contain ${format(item)}`);
  }
  toContainEqual(item: any): void {
    const pass = Array.isArray(this.actual) && this.actual.some((x) => equals(x, item));
    this.check(pass, `expected ${format(this.actual)} to${this.negated ? ' not' : ''} contain equal ${format(item)}`);
  }
  toStartWith(prefix: string): void {
    this.check(typeof this.actual === 'string' && this.actual.startsWith(prefix), `expected ${format(this.actual)} to${this.negated ? ' not' : ''} start with ${format(prefix)}`);
  }
  toEndWith(suffix: string): void {
    this.check(typeof this.actual === 'string' && this.actual.endsWith(suffix), `expected ${format(this.actual)} to${this.negated ? ' not' : ''} end with ${format(suffix)}`);
  }
  toInclude(item: string): void { this.toContain(item); }
  toBeDefined(): void { this.check(this.actual !== undefined, `expected ${format(this.actual)} to${this.negated ? ' not' : ''} be defined`); }
  toBeUndefined(): void { this.check(this.actual === undefined, `expected ${format(this.actual)} to${this.negated ? ' not' : ''} be undefined`); }
  toBeNull(): void { this.check(this.actual === null, `expected ${format(this.actual)} to${this.negated ? ' not' : ''} be null`); }
  toBeNaN(): void { this.check(Number.isNaN(this.actual), `expected ${format(this.actual)} to${this.negated ? ' not' : ''} be NaN`); }
  toBeTruthy(): void { this.check(!!this.actual, `expected ${format(this.actual)} to${this.negated ? ' not' : ''} be truthy`); }
  toBeFalsy(): void { this.check(!this.actual, `expected ${format(this.actual)} to${this.negated ? ' not' : ''} be falsy`); }
  toBeGreaterThan(n: number): void { this.check(this.actual > n, `expected ${format(this.actual)} to${this.negated ? ' not' : ''} be > ${n}`); }
  toBeGreaterThanOrEqual(n: number): void { this.check(this.actual >= n, `expected ${format(this.actual)} to${this.negated ? ' not' : ''} be >= ${n}`); }
  toBeLessThan(n: number): void { this.check(this.actual < n, `expected ${format(this.actual)} to${this.negated ? ' not' : ''} be < ${n}`); }
  toBeLessThanOrEqual(n: number): void { this.check(this.actual <= n, `expected ${format(this.actual)} to${this.negated ? ' not' : ''} be <= ${n}`); }
  toBeCloseTo(n: number, digits = 2): void {
    const pass = Math.abs(this.actual - n) < Math.pow(10, -digits) / 2;
    this.check(pass, `expected ${format(this.actual)} to${this.negated ? ' not' : ''} be close to ${n}`);
  }
  toMatch(re: RegExp | string): void {
    const pass = typeof re === 'string' ? String(this.actual).includes(re) : re.test(String(this.actual));
    this.check(pass, `expected ${format(this.actual)} to${this.negated ? ' not' : ''} match ${format(re)}`);
  }
  toMatchObject(expected: Record<string, any>): void {
    this.check(matchObject(this.actual, expected), `expected ${format(this.actual)} to${this.negated ? ' not' : ''} match object ${format(expected)}`);
  }
  toHaveLength(n: number): void {
    this.check(this.actual != null && this.actual.length === n, `expected ${format(this.actual)} to${this.negated ? ' not' : ''} have length ${n}`);
  }
  toHaveProperty(path: string, value?: any): void {
    const segs = path.split('.');
    let cur = this.actual;
    let has = true;
    for (const s of segs) { if (cur != null && s in Object(cur)) cur = cur[s]; else { has = false; break; } }
    const pass = has && (arguments.length < 2 || equals(cur, value));
    this.check(pass, `expected ${format(this.actual)} to${this.negated ? ' not' : ''} have property ${path}`);
  }
  toBeInstanceOf(ctor: any): void {
    this.check(this.actual instanceof ctor, `expected ${format(this.actual)} to${this.negated ? ' not' : ''} be instance of ${ctor?.name ?? ctor}`);
  }
  toThrow(expected?: string | RegExp | (new (...a: any[]) => any)): void {
    let threw = false;
    let error: any;
    try { if (typeof this.actual === 'function') this.actual(); } catch (e) { threw = true; error = e; }
    let pass = threw;
    if (threw && expected !== undefined) pass = matchError(error, expected);
    this.check(pass, `expected function to${this.negated ? ' not' : ''} throw${expected ? ` ${format(expected)}` : ''}`);
  }
  // Mock matchers
  toHaveBeenCalled(): void {
    this.check(callsOf(this.actual).length > 0, `expected mock to${this.negated ? ' not' : ''} have been called`);
  }
  toHaveBeenCalledTimes(n: number): void {
    this.check(callsOf(this.actual).length === n, `expected mock to${this.negated ? ' not' : ''} have been called ${n} times (was ${callsOf(this.actual).length})`);
  }
  toHaveBeenCalledWith(...args: any[]): void {
    const pass = callsOf(this.actual).some((call) => equals(call, args));
    this.check(pass, `expected mock to${this.negated ? ' not' : ''} have been called with ${format(args)}`);
  }
  toHaveBeenLastCalledWith(...args: any[]): void {
    const calls = callsOf(this.actual);
    const pass = calls.length > 0 && equals(calls[calls.length - 1], args);
    this.check(pass, `expected mock to${this.negated ? ' not' : ''} have been last called with ${format(args)}`);
  }
}

class AsyncExpectation {
  constructor(private actual: Promise<any>, private negated: boolean, private mode: 'resolves' | 'rejects') {}
  private wrap(value: any): Expectation { return new Expectation(value, this.negated); }
  private async settle(): Promise<{ resolved: boolean; value: any }> {
    try { return { resolved: true, value: await this.actual }; }
    catch (e) { return { resolved: false, value: e }; }
  }
  // Proxy the sync matchers by resolving/rejecting first.
  private proxy(matcher: keyof Expectation) {
    return async (...args: any[]) => {
      const { resolved, value } = await this.settle();
      if (this.mode === 'resolves' && !resolved) fail(`expected promise to resolve but it rejected with ${format(value)}`);
      if (this.mode === 'rejects' && resolved) fail(`expected promise to reject but it resolved with ${format(value)}`);
      return (this.wrap(value)[matcher] as any)(...args);
    };
  }
  toBe = this.proxy('toBe');
  toEqual = this.proxy('toEqual');
  toStrictEqual = this.proxy('toStrictEqual');
  toThrow = this.proxy('toThrow');
  toContain = this.proxy('toContain');
  toContainEqual = this.proxy('toContainEqual');
  toMatch = this.proxy('toMatch');
  toMatchObject = this.proxy('toMatchObject');
  toBeDefined = this.proxy('toBeDefined');
  toBeUndefined = this.proxy('toBeUndefined');
  toBeNull = this.proxy('toBeNull');
  toBeTruthy = this.proxy('toBeTruthy');
  toBeFalsy = this.proxy('toBeFalsy');
  toBeGreaterThan = this.proxy('toBeGreaterThan');
  toBeGreaterThanOrEqual = this.proxy('toBeGreaterThanOrEqual');
  toBeLessThan = this.proxy('toBeLessThan');
  toBeLessThanOrEqual = this.proxy('toBeLessThanOrEqual');
  toHaveLength = this.proxy('toHaveLength');
  toHaveProperty = this.proxy('toHaveProperty');
  toBeInstanceOf = this.proxy('toBeInstanceOf');
  toStartWith = this.proxy('toStartWith');
  toEndWith = this.proxy('toEndWith');
}

// Jest-style asymmetric matchers (expect.any / objectContaining / …). Attached
// to `expect` below and understood by `equals()` so they work inside toEqual /
// toHaveBeenCalledWith / toContainEqual.
const ASYM = Symbol('asymmetricMatcher');
interface Asym { [ASYM]: true; desc: string; match(actual: any): boolean; }
function isAsym(x: any): x is Asym { return !!x && typeof x === 'object' && (x as any)[ASYM] === true; }
function asym(desc: string, match: (actual: any) => boolean): Asym { return { [ASYM]: true, desc, match }; }

interface ExpectFn {
  (actual: any): Expectation;
  any(ctor: any): Asym;
  anything(): Asym;
  objectContaining(obj: Record<string, any>): Asym;
  stringContaining(s: string): Asym;
  stringMatching(re: RegExp | string): Asym;
  arrayContaining(arr: any[]): Asym;
}

export const expect: ExpectFn = Object.assign(
  (actual: any): Expectation => new Expectation(actual),
  {
    any: (ctor: any): Asym => asym(`any(${ctor?.name ?? ctor})`, (a) => {
      if (a == null) return false;
      if (ctor === String) return typeof a === 'string' || a instanceof String;
      if (ctor === Number) return typeof a === 'number' || a instanceof Number;
      if (ctor === Boolean) return typeof a === 'boolean';
      if (ctor === BigInt) return typeof a === 'bigint';
      if (ctor === Object) return typeof a === 'object';
      if (ctor === Function) return typeof a === 'function';
      if (ctor === Symbol) return typeof a === 'symbol';
      return a instanceof ctor;
    }),
    anything: (): Asym => asym('anything', (a) => a != null),
    objectContaining: (obj: Record<string, any>): Asym => asym('objectContaining', (a) => matchObject(a, obj)),
    stringContaining: (s: string): Asym => asym('stringContaining', (a) => typeof a === 'string' && a.includes(s)),
    stringMatching: (re: RegExp | string): Asym => asym('stringMatching', (a) => typeof a === 'string' && (typeof re === 'string' ? a.includes(re) : re.test(a))),
    arrayContaining: (arr: any[]): Asym => asym('arrayContaining', (a) => Array.isArray(a) && arr.every((e) => a.some((x) => equals(x, e)))),
  },
);

// ── helpers ───────────────────────────────────────────────────────────────
function callsOf(m: any): any[][] {
  if (m && m.mock && Array.isArray(m.mock.calls)) return m.mock.calls;
  return [];
}
function deepEqual(a: any, b: any): boolean {
  try { assert.deepStrictEqual(a, b); return true; } catch { return false; }
}
/** Structural equality that understands nested asymmetric matchers. */
function equals(a: any, e: any): boolean {
  if (isAsym(e)) return e.match(a);
  if (e !== null && typeof e === 'object' && a !== null && typeof a === 'object') {
    const eArr = Array.isArray(e), aArr = Array.isArray(a);
    if (eArr !== aArr) return false;
    if (eArr) {
      if (e.length !== a.length) return false;
      return e.every((v: any, i: number) => equals(a[i], v));
    }
    const ek = Object.keys(e), ak = Object.keys(a);
    if (ek.length !== ak.length) return false;
    return ek.every((k) => Object.prototype.hasOwnProperty.call(a, k) && equals(a[k], e[k]));
  }
  return deepEqual(a, e);
}
function matchObject(actual: any, expected: Record<string, any>): boolean {
  if (actual == null || typeof actual !== 'object') return false;
  for (const k of Object.keys(expected)) {
    const ev = expected[k];
    const av = actual[k];
    if (isAsym(ev)) { if (!ev.match(av)) return false; }
    else if (ev && typeof ev === 'object' && !Array.isArray(ev)) { if (!matchObject(av, ev)) return false; }
    else if (!equals(av, ev)) return false;
  }
  return true;
}
function matchError(error: any, expected: string | RegExp | (new (...a: any[]) => any)): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  if (typeof expected === 'string') return msg.includes(expected);
  if (expected instanceof RegExp) return expected.test(msg);
  if (typeof expected === 'function') return error instanceof expected;
  return false;
}
function format(v: any): string {
  try {
    if (typeof v === 'string') return JSON.stringify(v);
    if (v instanceof RegExp) return String(v);
    if (typeof v === 'function') return v.name ? `[Function ${v.name}]` : '[Function]';
    return JSON.stringify(v) ?? String(v);
  } catch { return String(v); }
}
