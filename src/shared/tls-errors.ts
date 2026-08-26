// SPDX-License-Identifier: Apache-2.0
//
// One place that recognises a rejected TLS chain, and says what to do about it.
//
// WHY THIS EXISTS. On a corporate network a proxy terminates TLS and re-signs
// every certificate with a root the machine trusts but Node does not. Every
// download keepmind performs then fails with the same handful of OpenSSL codes.
//
// `doctor` already knew this and said it well. The INSTALLER did not: it caught
// the failure correctly, treated it as non-fatal correctly — and then printed
// the child process's entire Node crash trace, twice, with nothing anywhere
// naming the cause. Measured on a company machine: a successful install of
// 4.4.2 that reads, on screen, as a crash.
//
// So the knowledge moved here, and both read it. A second copy of this list is
// how one of them starts recognising a code the other does not.

/** OpenSSL verdicts that mean "the chain was rejected", not "the host is down". */
export const CERT_ERROR_CODES = [
  'CERT_HAS_EXPIRED',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_UNTRUSTED',
] as const;

export type CertErrorCode = typeof CERT_ERROR_CODES[number];

/** The code an error object carries, if it is one of ours. */
export function certErrorCodeOf(error: unknown): CertErrorCode | null {
  const code =
    (error as { cause?: { code?: string } })?.cause?.code ??
    (error as NodeJS.ErrnoException)?.code ??
    '';
  return (CERT_ERROR_CODES as readonly string[]).includes(code) ? code as CertErrorCode : null;
}

/**
 * The code named anywhere in a blob of child-process output.
 *
 * A failed download reaches us as TEXT, not as an error object: the child died
 * on its own, and all the parent has is what it wrote to stderr. Scanning for
 * the code is the only way to tell "the proxy rejected us" from "the mirror was
 * down", and those two need opposite responses from the operator.
 */
export function findCertErrorCode(haystack: string): CertErrorCode | null {
  for (const code of CERT_ERROR_CODES) {
    if (haystack.includes(code)) return code;
  }
  return null;
}

/**
 * What the operator should do, in the words `doctor` has always used.
 *
 * `retryWith` names the command that re-attempts the thing that just failed —
 * the installer knows it, the health check does not, and telling someone to
 * fix a certificate without saying what to run next leaves them to guess.
 */
export function describeCertInterception(code: CertErrorCode, retryWith?: string): string {
  const lines = [
    `The connection was refused by certificate validation (${code}) — the hallmark of`,
    `corporate TLS interception, where a proxy re-signs traffic with a root Node does`,
    `not trust. Nothing is wrong with keepmind or with the download server.`,
    ``,
    `Export your corporate root CA to a .pem file and point NODE_EXTRA_CA_CERTS at it`,
    `(a new shell is needed for the variable to take effect).`,
  ];
  if (retryWith) lines.push(`Then re-run \`${retryWith}\`; \`npx keepmind doctor\` re-checks the chain.`);
  return lines.join('\n');
}
