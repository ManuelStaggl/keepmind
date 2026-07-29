/**
 * Diagnostic printing for the source-scanning audit tests.
 *
 * Those tests used to `console.log` a summary — and in one case a line PER
 * offending file. Node's test runner runs each test file in a child process and
 * forwards its stdout over a V8-serialized IPC channel; writes from the test
 * body interleave with that framing and intermittently corrupt it, failing the
 * ENTIRE file with:
 *
 *   Error: Unable to deserialize cloned data due to invalid or unsupported version.
 *       at #processRawBuffer (node:internal/test_runner/runner)
 *
 * The failure is not an assertion — the assertions all passed — so it read as a
 * random red build. It hit `log-level-audit.test.ts` and
 * `logger-usage-standards.test.ts`, the only two audit tests that printed, on
 * roughly half of CI runs while the Windows runner stayed green.
 *
 * The reports are useful when you are actually working on logging coverage, so
 * they are kept behind a flag rather than deleted:
 *
 *   KEEPMIND_AUDIT_VERBOSE=1 npm test
 *
 * Lines are joined into ONE write, so even in verbose mode the channel sees a
 * single frame instead of hundreds.
 */
const AUDIT_VERBOSE = process.env.KEEPMIND_AUDIT_VERBOSE === '1';

/**
 * Print an audit report only when KEEPMIND_AUDIT_VERBOSE=1.
 *
 * Takes a THUNK so the report is not even assembled on the default path — these
 * tests scan the whole source tree and some reports map over every offending
 * file.
 */
export function reportAudit(lines: () => string[]): void {
  if (!AUDIT_VERBOSE) return;
  process.stdout.write(`${lines().join('\n')}\n`);
}
