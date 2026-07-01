// SPDX-License-Identifier: Apache-2.0
//
// node:sqlite compatibility shim.
//
// This module exposes a `Database` class and `SQLQueryBindings` type that are
// API-compatible with the subset of `bun:sqlite` used across this codebase, but
// are backed by node's built-in `node:sqlite` (`DatabaseSync`). It exists so the
// worker, hooks, and MCP server can all run under a plain Node runtime with no
// Bun dependency.
//
// Supported surface (mirrors bun:sqlite as used in src/):
//   new Database(path?, opts?)            — opts: { readonly, create, readwrite, safeIntegers }
//   db.query(sql)                         — prepared Statement, cached by sql
//   db.prepare(sql)                       — prepared Statement
//   db.run(sql, ...params)                — execute (multi-statement when paramless)
//   db.exec(sql)                          — execute one or more statements
//   db.transaction(fn)                    — BEGIN/COMMIT wrapper, SAVEPOINT nesting
//   db.loadExtension(path, entrypoint?)   — sqlite extension loading (e.g. sqlite-vec)
//   db.close()
//   Statement: .all(...p) .get(...p) .run(...p) .values(...p) .finalize()
//
// node:sqlite has no `.values()`; we derive it from `.all()` row objects (key
// order is the SELECT column order, so `Object.values(row)` preserves it).

import { DatabaseSync, type StatementSync } from 'node:sqlite';

/** Scalar value bindable to a single SQL placeholder. */
export type BindValue = string | number | bigint | boolean | null | undefined | Uint8Array;

/** Values accepted as positional/named SQL bind parameters (bun:sqlite-compatible). */
export type SQLQueryBindings = BindValue | Record<string, BindValue>;

/**
 * A single argument to a bind-accepting method. bun:sqlite accepts both the
 * spread form `.run(a, b)` and the array form `.run([a, b])`, so each argument
 * may itself be an array of bindings.
 */
export type BindParam = SQLQueryBindings | SQLQueryBindings[];

export interface DatabaseOptions {
  readonly?: boolean;
  readwrite?: boolean;
  create?: boolean;
  /** When true, integer columns are read as BigInt (bun: `safeIntegers`). */
  safeIntegers?: boolean;
}

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

function toNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function isNamedParamsObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Uint8Array) &&
    !(typeof Buffer !== 'undefined' && Buffer.isBuffer(value))
  );
}

function normalizeValue(value: unknown): unknown {
  // node:sqlite rejects `boolean` and `undefined`; bun:sqlite coerces them.
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

function normalizeParams(rawParams: unknown[]): unknown[] {
  // bun:sqlite accepts a single bindings array (`.run([a, b])`) as an
  // alternative to the spread form (`.run(a, b)`). Flatten it to positional.
  let params = rawParams;
  if (params.length === 1 && Array.isArray(params[0])) {
    params = params[0] as unknown[];
  }

  if (params.length === 1 && isNamedParamsObject(params[0])) {
    const source = params[0] as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      normalized[key] = normalizeValue(source[key]);
    }
    return [normalized];
  }
  return params.map(normalizeValue);
}

export class Statement<Row = unknown> {
  constructor(private readonly stmt: StatementSync) {}

  all(...params: BindParam[]): Row[] {
    return this.stmt.all(...(normalizeParams(params) as never[])) as Row[];
  }

  get(...params: BindParam[]): Row | null {
    // bun:sqlite's `.get()` returns `null` (not `undefined`) when there are no
    // rows; node:sqlite returns `undefined`. Normalize to null so call sites and
    // tests written against bun's contract (e.g. `expect(row).toBeNull()`) hold.
    const row = this.stmt.get(...(normalizeParams(params) as never[]));
    return (row ?? null) as Row | null;
  }

  run(...params: BindParam[]): RunResult {
    const result = this.stmt.run(...(normalizeParams(params) as never[]));
    return {
      changes: toNumber(result.changes),
      lastInsertRowid: toNumber(result.lastInsertRowid),
    };
  }

  /** Each row as an array of column values, in SELECT column order. */
  values(...params: BindParam[]): unknown[][] {
    const rows = this.stmt.all(...(normalizeParams(params) as never[])) as Array<Record<string, unknown>>;
    return rows.map((row) => Object.values(row));
  }

  finalize(): void {
    // node:sqlite statements are garbage-collected; there is no explicit
    // finalize. Kept as a no-op for bun:sqlite API parity.
  }
}

export class Database {
  private readonly db: DatabaseSync;
  private readonly queryCache = new Map<string, Statement>();
  private readonly safeIntegers: boolean;
  private txDepth = 0;

  /** Path the connection opened (bun:sqlite parity; ':memory:' for in-memory). */
  readonly filename: string;

  constructor(filename?: string | null, options: DatabaseOptions = {}) {
    const readOnly = options.readonly === true;
    this.safeIntegers = options.safeIntegers === true;
    const location = filename && filename.length > 0 ? filename : ':memory:';
    this.filename = location;

    this.db = new DatabaseSync(location, {
      readOnly,
      // Required so db.loadExtension() works (e.g. future sqlite-vec usage).
      allowExtension: true,
    });

    // bun:sqlite leaves journal mode to the caller, but the main DB is always
    // opened WAL by its callers. Setting it here for read-write file DBs is
    // harmless and idempotent; skip it for read-only (would fail) and memory.
    if (!readOnly && location !== ':memory:') {
      try {
        this.db.exec('PRAGMA journal_mode=WAL');
      } catch {
        // Best effort — never fail open() over a journal-mode pragma.
      }
    }
  }

  private wrap(stmt: StatementSync): Statement {
    if (this.safeIntegers) {
      stmt.setReadBigInts(true);
    }
    return new Statement(stmt);
  }

  prepare<Row = unknown>(sql: string): Statement<Row> {
    return this.wrap(this.db.prepare(sql)) as Statement<Row>;
  }

  query<Row = unknown>(sql: string): Statement<Row> {
    const cached = this.queryCache.get(sql);
    if (cached) return cached as Statement<Row>;
    const statement = this.prepare<Row>(sql);
    this.queryCache.set(sql, statement as Statement);
    return statement;
  }

  run(sql: string, ...params: BindParam[]): RunResult {
    // Paramless run() may carry a multi-statement script (schema DDL). node's
    // prepare() compiles only the first statement, so route those through exec.
    if (params.length === 0) {
      this.db.exec(sql);
      return { changes: 0, lastInsertRowid: 0 };
    }
    return this.prepare(sql).run(...params);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  loadExtension(path: string, entrypoint?: string): void {
    // node:sqlite's loadExtension takes only the path; entrypoint is accepted
    // for bun:sqlite parity but ignored (sqlite-vec uses the default entry).
    void entrypoint;
    this.db.loadExtension(path);
  }

  transaction<Args extends unknown[], Result>(
    fn: (...args: Args) => Result
  ): (...args: Args) => Result {
    return (...args: Args): Result => {
      const isOuter = this.txDepth === 0;
      const savepoint = `__cm_sp_${this.txDepth}`;

      if (isOuter) {
        this.db.exec('BEGIN');
      } else {
        this.db.exec(`SAVEPOINT ${savepoint}`);
      }
      this.txDepth++;

      try {
        const result = fn(...args);
        this.txDepth--;
        if (isOuter) {
          this.db.exec('COMMIT');
        } else {
          this.db.exec(`RELEASE ${savepoint}`);
        }
        return result;
      } catch (error) {
        this.txDepth--;
        if (isOuter) {
          this.db.exec('ROLLBACK');
        } else {
          this.db.exec(`ROLLBACK TO ${savepoint}`);
          this.db.exec(`RELEASE ${savepoint}`);
        }
        throw error;
      }
    };
  }

  close(): void {
    this.db.close();
  }
}
