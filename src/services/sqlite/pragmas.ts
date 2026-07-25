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
