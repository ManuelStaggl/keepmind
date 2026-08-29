// S21 — every queue position leaves exactly one closing line.
//
// The acceptance from the finding: "Jede Position hinterlässt genau eine
// Abschlusszeile — erzeugt, verworfen (mit Grund) oder gescheitert. Ein
// Ausbleiben von Observations ist dann am Protokoll ablesbar, ohne die
// Datenbank zu zählen."
//
// Both halves are asserted here, because each was violated in the field:
//   - the CEILING (never two lines) — a batch that is resolved and then
//     confirmed must not report twice;
//   - the FLOOR (never zero) — a position whose session goes away must still
//     say what happened to it, and a GATED position must leave the buffer.
//     Measured 29.08.2026: a gated batch was only `continue`d, so one session's
//     queue depth climbed monotonically to 67 and never fell, and each later
//     generator pass re-gated the whole backlog (~130 tool uses → 1002 gate
//     decisions in a day).

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from '../bun-test-shim.js';
import { SessionMessageBuffer } from '../../src/services/worker/SessionMessageBuffer.js';
import { logger } from '../../src/utils/logger.js';
import type { PendingMessage } from '../../src/services/worker-types.js';

function observation(tool: string, toolUseId?: string): PendingMessage {
  return {
    type: 'observation',
    tool_name: tool,
    tool_input: '{}',
    tool_response: '{}',
    ...(toolUseId ? { toolUseId } : {}),
  } as PendingMessage;
}

describe('S21 — queue outcome ledger', () => {
  let infoSpy: ReturnType<typeof spyOn>;

  const resolvedLines = (): string[] =>
    (infoSpy.mock.calls as unknown as unknown[][])
      .map(args => String(args[1] ?? ''))
      .filter(line => line.startsWith('RESOLVED |'));

  beforeEach(() => {
    infoSpy = spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    mock.restore();
  });

  it('writes one line per position, naming the outcome and the reason', () => {
    const buffer = new SessionMessageBuffer();
    const a = buffer.enqueue(1, observation('Read'));
    const b = buffer.enqueue(1, observation('Edit'));

    buffer.resolveMany([a, b], 'gated', 'not_portfolio_relevant');

    const lines = resolvedLines();
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain(`messageId=${a}`);
    expect(lines[0]).toContain('outcome=gated');
    expect(lines[0]).toContain('reason=not_portfolio_relevant');
    expect(lines[1]).toContain(`messageId=${b}`);
  });

  it('removes a gated position from the buffer — the depth must fall again', () => {
    const buffer = new SessionMessageBuffer();
    const a = buffer.enqueue(1, observation('Read'));
    buffer.enqueue(1, observation('Edit'));
    expect(buffer.getPendingCount(1)).toBe(2);

    buffer.resolve(a, 'gated', 'no_signal');

    expect(buffer.getPendingCount(1)).toBe(1);
  });

  it('never writes a second line for the same position', () => {
    const buffer = new SessionMessageBuffer();
    const a = buffer.enqueue(1, observation('Write'));

    expect(buffer.resolve(a, 'stored', 'obs=1')).toBe(true);
    // A later confirm() of the same id — the ordinary sequence in
    // ResponseProcessor — must stay silent.
    expect(buffer.confirm(a)).toBe(0);
    expect(buffer.resolve(a, 'dropped')).toBe(false);

    expect(resolvedLines().length).toBe(1);
  });

  it('accounts for everything still open when a session is disposed', () => {
    const buffer = new SessionMessageBuffer();
    buffer.enqueue(7, observation('Read'));
    buffer.enqueue(7, observation('Bash'));

    buffer.dispose(7);

    const lines = resolvedLines();
    expect(lines.length).toBe(2);
    expect(lines.every(l => l.includes('outcome=dropped'))).toBe(true);
    expect(lines.every(l => l.includes('reason=session_disposed'))).toBe(true);
  });

  it('does not account for a position that was never created (dedup)', () => {
    const buffer = new SessionMessageBuffer();
    const first = buffer.enqueue(2, observation('Read', 'tool-use-1'));
    const duplicate = buffer.enqueue(2, observation('Read', 'tool-use-1'));

    expect(first).toBeGreaterThan(0);
    expect(duplicate).toBe(0);

    buffer.dispose(2);
    // One position existed, so exactly one line — a suppressed duplicate never
    // became a queue position and must not look like one that was dropped.
    expect(resolvedLines().length).toBe(1);
  });

  it('reports open ids in buffer order so a caller can retire a batch', () => {
    const buffer = new SessionMessageBuffer();
    const a = buffer.enqueue(3, observation('Read'));
    const b = buffer.enqueue(3, observation('Edit'));
    buffer.enqueue(4, observation('Bash'));

    expect(buffer.openIds(3)).toEqual([a, b]);
  });
});
