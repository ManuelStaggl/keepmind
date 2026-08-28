// SPDX-License-Identifier: Apache-2.0
//
// Shared SQLite tuning constants. Kept in its own module (rather than on
// SessionStore) so the vector store can reuse them without pulling the whole
// store — and its schema/migration surface — into that import graph.

/**
 * How long SQLite waits for a lock before returning SQLITE_BUSY.
 *
 * Without a timeout, a locked read fails immediately: the context-injection hook
 * reads the DB while the worker writes observations, and a collision silently
 * produced an empty context block. 5s is well above the longest observed write
 * transaction, and a hook that waits briefly is strictly better than one that
 * returns nothing.
 */
export const SQLITE_BUSY_TIMEOUT_MS = 5000;

/** Cap the WAL so a checkpoint-blocked period cannot grow it without bound. */
export const SQLITE_JOURNAL_SIZE_LIMIT_BYTES = 4 * 1024 * 1024;

/**
 * The canonical tuning pragmas every read-write file connection must apply.
 *
 * There is ONE list because there was one that drifted: the worker opens a
 * single shared connection (DatabaseManager) and hands it to SessionStore and
 * SessionSearch as an already-open Database — so their own path-open pragma
 * blocks never ran, and the base Database constructor set only
 * `journal_mode=WAL`. The worker's main connection therefore ran with
 * busy_timeout=0, which fails a locked read/write IMMEDIATELY instead of
 * waiting. That is how background init hit "database is locked" when two
 * launchers raced the open, after which the worker sat wedged for 28 hours.
 * busy_timeout is the load-bearing member; the rest bring the shared connection
 * to parity with the path-open path.
 */
export const SQLITE_CONNECTION_PRAGMAS: readonly string[] = [
  'PRAGMA journal_mode = WAL',
  'PRAGMA synchronous = NORMAL',
  'PRAGMA foreign_keys = ON',
  `PRAGMA journal_size_limit = ${SQLITE_JOURNAL_SIZE_LIMIT_BYTES}`,
  `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`,
];

/**
 * Apply {@link SQLITE_CONNECTION_PRAGMAS} through the caller's statement runner.
 *
 * A failed pragma is logged, never swallowed: the previous journal-mode-only
 * path wrapped its single `exec` in `try{}catch{}` with an empty body, so a
 * connection that silently failed to set busy_timeout was indistinguishable
 * from one that succeeded. `onError` lets callers that must not import the
 * logger (kept out of this module's import graph on purpose) receive the
 * failure; the default logs at WARN.
 */
export function applyConnectionPragmas(
  run: (sql: string) => void,
  onError?: (pragma: string, error: unknown) => void,
): void {
  for (const pragma of SQLITE_CONNECTION_PRAGMAS) {
    try {
      run(pragma);
    } catch (error) {
      if (onError) {
        onError(pragma, error);
      } else {
        // Lazy require so pragmas.ts stays free of a static logger import — the
        // vector store reuses these constants without pulling the store graph.
        void import('../../utils/logger.js')
          .then(({ logger }) => {
            logger.warn(
              'DB',
              'Failed to apply SQLite connection pragma',
              { pragma },
              error instanceof Error ? error : new Error(String(error)),
            );
          })
          .catch(() => { /* logging must never throw out of a pragma apply */ });
      }
    }
  }
}
