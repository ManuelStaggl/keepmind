// SPDX-License-Identifier: Apache-2.0
//
// Outbound redaction — the guard that runs BEFORE content leaves the machine.
//
// Redaction used to run in exactly two places, `SessionStore` (on write to
// SQLite) and `MaintenanceLoop`. Both are downstream of the model call, so what
// was actually protected was the local database, not the network: raw tool
// inputs and outputs — whole file contents, shell commands and their output,
// verbatim user prompts — went to the provider unredacted, and only the model's
// *reply* was scrubbed on the way to disk. The 4,147 HIGH_ENTROPY masks already
// in the database are the proof: every one of them was masked on write, which
// means the cleartext had already been through a prompt.
//
// This module is the single choke point for the send path. `src/sdk/prompts.ts`
// is the only place any provider builds a prompt (Claude, Gemini and OpenRouter
// all go through it), so redacting there covers every provider at once.
//
// Two layers, because they fail differently:
//
//   1. Pattern redaction (redactOutbound) — masks credentials inside otherwise
//      useful text. Conservative and lossy by design; the surrounding message
//      stays readable.
//   2. The sensitive-file guard (sensitiveFileReason) — some files are secrets
//      in their entirety, and pattern matching over a PEM body or a .env dump is
//      the wrong tool: a single rule miss leaks the rest. For those the payload
//      is dropped wholesale and only the fact of the access is reported.

import path from 'path';
import { redactSecrets, redactSecretsDeep, type RedactOptions } from './redact-secrets.js';
import { loadMemoryQualityConfig } from '../config/memory-quality.js';

/**
 * Files whose *content* is a credential rather than merely containing one.
 * Matched on the basename unless the pattern contains a separator, in which
 * case the whole normalised path is tested.
 */
const SENSITIVE_FILE_PATTERNS: Array<{ re: RegExp; what: string; full?: boolean }> = [
  // `.env.example` / `.sample` / `.template` / `.dist` are checked-in templates
  // of placeholders. They are ordinary source: withholding them would hide a
  // legitimate configuration change for no gain. Should someone put a real value
  // in one anyway, the pattern rules still run over it — only the wholesale drop
  // is skipped, not the redaction.
  { re: /^\.env\.(example|sample|template|dist)$/i, what: '' },
  { re: /^\.env(\..+)?$/i, what: 'environment file' },
  { re: /^\.npmrc$/i, what: 'npm credentials' },
  { re: /^\.pypirc$/i, what: 'PyPI credentials' },
  { re: /^\.netrc$/i, what: 'netrc credentials' },
  { re: /^\.htpasswd$/i, what: 'password file' },
  { re: /^id_(rsa|dsa|ecdsa|ed25519)$/i, what: 'SSH private key' },
  { re: /\.(pem|key|pfx|p12|jks|keystore|ppk|asc|gpg)$/i, what: 'key material' },
  { re: /^credentials$/i, what: 'credentials file' },
  { re: /^(secrets?|credentials)\.(json|ya?ml|toml|ini|xml)$/i, what: 'secrets file' },
  { re: /^service-account.*\.json$/i, what: 'service account key' },
  // Directory patterns test the whole path, not the basename.
  { re: /(^|\/)\.ssh\//i, what: 'SSH directory', full: true },
  { re: /(^|\/)\.aws\//i, what: 'AWS credentials directory', full: true },
  { re: /(^|\/)\.gnupg\//i, what: 'GnuPG directory', full: true },
];

/**
 * Describe why a path is considered secret-bearing, or null if it is ordinary.
 * The description is what gets substituted for the payload, so it must name the
 * kind of file without quoting anything from it.
 */
export function sensitiveFileReason(filePath: unknown): string | null {
  if (typeof filePath !== 'string' || filePath.length === 0) return null;
  const normalised = filePath.replace(/\\/g, '/');
  const base = path.posix.basename(normalised);
  for (const { re, what, full } of SENSITIVE_FILE_PATTERNS) {
    if (re.test(full ? normalised : base)) {
      // An empty reason marks an explicit allow — first match wins, so an allow
      // listed above a broader pattern exempts the path from it.
      return what === '' ? null : what;
    }
  }
  return null;
}

/** Tool-input keys that carry a path worth testing against the guard. */
const PATH_KEYS = ['file_path', 'filePath', 'path', 'notebook_path', 'target_file'];

/**
 * Inspect a parsed tool input for a sensitive path. Returns the reason and the
 * offending path so the caller can report the access without the content.
 */
export function sensitivePathInPayload(toolInput: unknown): { reason: string; filePath: string } | null {
  if (!toolInput || typeof toolInput !== 'object' || Array.isArray(toolInput)) return null;
  const record = toolInput as Record<string, unknown>;
  for (const key of PATH_KEYS) {
    const reason = sensitiveFileReason(record[key]);
    if (reason) return { reason, filePath: String(record[key]) };
  }
  // Multi-file tools (filePaths: [...]) — one sensitive entry taints the batch,
  // because the payload is a single blob and cannot be split per file here.
  const list = record.filePaths;
  if (Array.isArray(list)) {
    for (const entry of list) {
      const reason = sensitiveFileReason(entry);
      if (reason) return { reason, filePath: String(entry) };
    }
  }
  return null;
}

/** Read the redaction settings that apply to the outbound path. */
export function outboundRedactionOptions(): { enabled: boolean; options: RedactOptions } {
  try {
    const cfg = loadMemoryQualityConfig();
    return {
      enabled: cfg.redactSecrets.enabled,
      options: {
        entropySweep: cfg.redactSecrets.entropySweep,
        entropyThreshold: cfg.redactSecrets.entropyThreshold,
        pii: cfg.redactSecrets.pii,
      },
    };
  } catch {
    // Fail CLOSED: a config read failure must not turn redaction off. Defaults
    // are the strict ones.
    return { enabled: true, options: {} };
  }
}

/**
 * Redact a string that is about to be embedded in a provider prompt.
 *
 * Every prompt-building function in src/sdk/prompts.ts routes its variable
 * content through here. Test `tests/redaction/outbound.test.ts` asserts that
 * the built prompt contains no injected credential — remove this call from the
 * prompt builders and that test fails, which is the point.
 */
export function redactOutbound(text: string | null | undefined): string {
  if (typeof text !== 'string' || text.length === 0) return text ?? '';
  const { enabled, options } = outboundRedactionOptions();
  if (!enabled) return text;
  return redactSecrets(text, options);
}

/** Recursive variant for parsed tool inputs/outputs before they are stringified. */
export function redactOutboundDeep<T>(value: T): T {
  const { enabled, options } = outboundRedactionOptions();
  if (!enabled) return value;
  return redactSecretsDeep(value, options);
}
