import { describe, it, expect } from 'bun:test';
import { describeExecError } from '../src/npx-cli/install/setup-runtime.js';
import { findCertErrorCode, certErrorCodeOf, CERT_ERROR_CODES } from '../src/shared/tls-errors.js';

/**
 * Reported from a company machine: `npx keepmind@latest install` succeeded —
 * plugin registered, runtime ready, worker healthy — and printed a 30-line Node
 * crash trace TWICE while doing it, because the tree-sitter download was
 * rejected by a TLS-intercepting proxy. Nothing on screen named the cause, and
 * a working install read as a crash.
 *
 * Two separate faults: the doubling, and the missing diagnosis.
 */

/** The child's own dying words, verbatim from the reported install. */
const CHILD_OUTPUT = [
  'node:events:487',
  "      throw er; // Unhandled 'error' event",
  '      ^',
  '',
  'Error: self-signed certificate in certificate chain',
  '    at TLSSocket.onConnectSecure (node:internal/tls/wrap:1768:34)',
  '    at TLSSocket.emit (node:events:509:28)',
  '    at TLSSocket._finishInit (node:internal/tls/wrap:1203:8)',
  '    at ssl.onhandshakedone (node:internal/tls/wrap:984:12)',
  "Emitted 'error' event on ClientRequest instance at:",
  '    at emitErrorEvent (node:_http_client:112:11)',
  "  code: 'SELF_SIGNED_CERT_IN_CHAIN'",
  '}',
  '',
  'Node.js v24.19.0',
].join('\n');

/** How node's `exec` hands that back: the message ALREADY carries stderr. */
function execFailure(output: string): Error {
  return Object.assign(
    new Error(`Command failed: "node.exe" "install.js"\n${output}`),
    { stdout: '', stderr: output },
  );
}

describe('installer TLS diagnosis', () => {
  it('names the cause instead of printing the crash', () => {
    const text = describeExecError(execFailure(CHILD_OUTPUT), 'npx keepmind repair');

    expect(text).toContain('SELF_SIGNED_CERT_IN_CHAIN');
    expect(text).toContain('corporate TLS interception');
    expect(text).toContain('NODE_EXTRA_CA_CERTS');
    expect(text).toContain('npx keepmind repair');
    // The trace is not the explanation.
    expect(text).not.toContain('at TLSSocket.onConnectSecure');
    expect(text).not.toContain("throw er; // Unhandled 'error' event");
  });

  it('keeps the one line that carries the code, so the diagnosis is checkable', () => {
    const text = describeExecError(execFailure(CHILD_OUTPUT));
    expect(text).toContain('Reported as:');
  });

  it('does not repeat output the exec message already carries', () => {
    // A plain failure with no cert code: the raw path.
    const output = 'bun: command not found';
    const text = describeExecError(execFailure(output));
    expect(text.split('bun: command not found')).toHaveLength(2); // exactly one occurrence
    expect(text).not.toContain('stderr: bun: command not found');
  });

  it('still shows stderr when the message does NOT carry it (execSync, plain Error)', () => {
    const error = Object.assign(new Error('Command failed'), { stderr: 'the real reason', stdout: '' });
    expect(describeExecError(error)).toContain('stderr: the real reason');
  });

  it('clips a long unexplained failure instead of paging the terminal', () => {
    const long = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const text = describeExecError(execFailure(long));
    expect(text).toContain('more line(s)');
    expect(text.split('\n').length).toBeLessThan(15);
  });

  it('recognises the code from an error object as well as from text', () => {
    expect(certErrorCodeOf({ code: 'CERT_HAS_EXPIRED' })).toBe('CERT_HAS_EXPIRED');
    expect(certErrorCodeOf({ cause: { code: 'CERT_UNTRUSTED' } })).toBe('CERT_UNTRUSTED');
    expect(certErrorCodeOf({ code: 'ENOTFOUND' })).toBeNull();
    for (const code of CERT_ERROR_CODES) {
      expect(findCertErrorCode(`something something ${code} something`)).toBe(code);
    }
    expect(findCertErrorCode('plain old network error')).toBeNull();
  });
});
