import { envValue } from '../../shared/legacy-env.js';
// SPDX-License-Identifier: Apache-2.0
//
// Secret-scrubbing on write (Phase 4, Step 1). Pure, dependency-free, never
// throws. Applied to all user-content strings BEFORE persistence (observations,
// summaries, user_prompts) so raw secrets never land on disk. Conservative:
// false-positives are acceptable, false-negatives are not.
//
// Rule set is derived from gitleaks `config/gitleaks.toml` (github.com/gitleaks/
// gitleaks, verified 2026-06-30), widened in a few places and with entropy gates
// dropped on structural tokens to bias toward over-redaction. A Shannon-entropy
// backstop catches opaque/unknown high-entropy tokens that no rule names.
//
// All regexes use bounded quantifiers (max lengths) to avoid catastrophic
// backtracking — matching the repo's regex-timeout discipline.

export type RedactionType =
  | 'AWS_KEY' | 'GITHUB_PAT' | 'GITHUB_FINE_PAT' | 'GITLAB_PAT'
  | 'SLACK_TOKEN' | 'GOOGLE_API_KEY' | 'STRIPE_KEY' | 'PRIVATE_KEY'
  | 'JWT' | 'BEARER' | 'BCRYPT' | 'CONNECTION_STRING'
  | 'GENERIC_SECRET' | 'HIGH_ENTROPY'
  | 'CREDENTIAL_ASSIGNMENT' | 'EMAIL' | 'IP_ADDRESS';

/**
 * Secrets are credentials — masking them can only ever cost readability, never
 * correctness, so they are always on. PII (email, IP) is a different trade: an
 * address in a stack trace or a LAN address in a networking error is often the
 * whole point of the message, and masking it can make a legitimate technical
 * finding useless. Keeping the categories separate lets PII be switched off
 * without weakening credential redaction, which must never be optional.
 */
type RedactionCategory = 'secret' | 'pii';

interface Rule {
  type: RedactionType;
  re: RegExp;
  /** When set, only this capture group is masked (the rest of the match is preserved). */
  group?: number;
  /** Defaults to 'secret'. */
  category?: RedactionCategory;
  /** Optional veto: return true to keep the match unmasked. */
  keep?: (match: string) => boolean;
}

const MASK = (t: RedactionType): string => `«redacted:${t}»`;

// Rules run in declared order. PRIVATE_KEY / CONNECTION_STRING first so their
// whole-block matches win before narrower rules can fire inside them.
const RULES: Rule[] = [
  {
    type: 'PRIVATE_KEY',
    re: /-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----[\s\S]{0,4000}?-----END[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    type: 'CONNECTION_STRING',
    re: /\b(?:jdbc:[a-z0-9]{1,20}:)?(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|sqlserver|oracle|https?):\/\/[^\s/@]+:[^\s/@]+@[^\s]{1,200}/gi,
  },
  {
    // ADO.NET / JDBC / ODBC keyword-value connection strings:
    //   Server=tcp:db,1433;Initial Catalog=app;User ID=sa;Password=P@ss!w0rd;
    //   jdbc:sqlserver://db:1433;databaseName=app;user=sa;password=P@ss!w0rd
    // GENERIC_SECRET below cannot cover these: its value class is
    // [\w./+=-], so any password containing @ ! # $ % & * ( ) — i.e. most
    // real ones — terminates the match early and leaks the remainder. It also
    // requires >= 10 chars, and a short service-account password is still a
    // password. Here the value runs to the delimiter (; or quote or EOL) and
    // has no length floor, so the whole credential goes.
    //
    // Only the value is masked: Server=, Initial Catalog= and User ID= stay
    // readable, which is what makes a connection error still diagnosable.
    //
    // MUST run before GENERIC_SECRET. If GENERIC_SECRET went first it would
    // match the leading word-characters only and stop at the first symbol —
    // `Password=Sup3rS3cret!Passw0rd` would come out as
    // `Password=«redacted»!Passw0rd`, publishing the tail of the credential.
    type: 'CREDENTIAL_ASSIGNMENT',
    re: /\b(?:password|pwd|passwd)\s{0,3}=\s{0,3}(?:"([^"\r\n]{1,200})"|'([^'\r\n]{1,200})'|([^;"'\r\n]{1,200}))/gi,
    group: 1,
  },
  { type: 'AWS_KEY', re: /\b((?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16})\b/g },
  { type: 'GITHUB_FINE_PAT', re: /\bgithub_pat_\w{82}\b/g },
  { type: 'GITHUB_PAT', re: /\bghp_[0-9A-Za-z]{36}\b/g },
  { type: 'GITLAB_PAT', re: /\bglpat-[\w-]{20}\b/g },
  { type: 'SLACK_TOKEN', re: /\bxox[baprs]-[0-9A-Za-z-]{10,200}\b/g },
  { type: 'GOOGLE_API_KEY', re: /\bAIza[\w-]{35}\b/g },
  { type: 'STRIPE_KEY', re: /\b(?:sk|rk|pk)_(?:test|live|prod)_[A-Za-z0-9]{10,99}\b/g },
  {
    type: 'JWT',
    re: /\bey[A-Za-z0-9_-]{17,500}\.ey[A-Za-z0-9_/\\-]{17,500}\.[A-Za-z0-9_/\\-]{10,500}={0,2}/g,
  },
  { type: 'BEARER', re: /\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{12,500}/g },
  { type: 'BCRYPT', re: /\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}/g },
  {
    // gitleaks generic-api-key shape: a labelled secret (password=…, token: …).
    // Mask group 1 only so the label stays readable.
    type: 'GENERIC_SECRET',
    re: /(?:pass(?:word)?|secret|token|api[_-]?key|client[_-]?secret|auth)\b['"\s]{0,3}[:=>]{1,2}['"\s]{0,3}([\w./+=-]{10,150})/gi,
    group: 1,
  },
  {
    // PII, not a credential. Requires a dotted TLD, which keeps npm scopes
    // (@types/node), SSH user@host and decorators out of the match.
    type: 'EMAIL',
    category: 'pii',
    re: /\b[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,4}\b/g,
  },
  {
    // IPv4 with real octet bounds. Loopback, unspecified and broadcast carry no
    // information about a network, so masking them would only cost readability.
    // A four-part version number is indistinguishable from an address by shape
    // alone and will be masked — accepted, because a version rarely appears in
    // dotted-quad form while an address always does.
    type: 'IP_ADDRESS',
    category: 'pii',
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g,
    keep: (m) => m === '0.0.0.0' || m === '255.255.255.255' || m.startsWith('127.'),
  },
];

/** True once a run has already been masked — the guard that keeps redaction idempotent. */
function alreadyMasked(s: string): boolean {
  return s.includes('redacted:');
}

function applyRule(text: string, rule: Rule): string {
  // Reset lastIndex defensively (rules are module-level + global).
  rule.re.lastIndex = 0;
  if (rule.group === undefined) {
    return text.replace(rule.re, (match) => {
      if (alreadyMasked(match)) return match;
      if (rule.keep?.(match)) return match;
      return MASK(rule.type);
    });
  }
  const g = rule.group;
  return text.replace(rule.re, (match, ...groups) => {
    if (rule.keep?.(match)) return match;
    // A rule may offer the value through several alternative capture groups
    // (quoted / single-quoted / bare); exactly one of them matches. Mask every
    // defined group from `group` onward so the alternatives behave as one.
    let out = match;
    let masked = false;
    for (let i = g - 1; i < groups.length; i++) {
      const captured = groups[i];
      if (typeof captured !== 'string' || captured.length === 0) continue;
      if (alreadyMasked(captured)) continue;
      out = out.replace(captured, MASK(rule.type));
      masked = true;
    }
    return masked ? out : match;
  });
}

/** Shannon entropy in bits/char. */
function shannon(s: string): number {
  if (s.length === 0) return 0;
  const f = new Map<string, number>();
  for (const c of s) f.set(c, (f.get(c) ?? 0) + 1);
  let h = 0;
  for (const n of f.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const HEX_SHA = /^[0-9a-f]+$/i;

/**
 * Decide whether a token looks like an unknown opaque secret. Conservative:
 * only fires on long, mixed-class, high-entropy, non-path, non-sha tokens.
 */
function isHighEntropySecret(token: string, threshold: number): boolean {
  if (token.length < 20 || token.length > 200) return false;
  if (/[\s]/.test(token)) return false;
  // must contain at least one digit AND one letter
  if (!/\d/.test(token) || !/[A-Za-z]/.test(token)) return false;
  // skip path-like tokens (filepaths, URLs)
  if (token.includes('/') || token.includes('\\')) return false;
  // skip pure hex git shas (7/8/40/64 are common, allow all-hex up to 64)
  if (token.length <= 64 && HEX_SHA.test(token)) return false;
  // skip our own mask token (defensive — masks contain no entropy-shaped run anyway)
  if (token.includes('redacted:')) return false;
  return shannon(token) >= threshold;
}

const TOKEN_SPLIT = /([\s"'`,;(){}\[\]<>]+)/;

function entropySweep(text: string, threshold: number): string {
  // Split keeping delimiters so we can rejoin losslessly.
  const parts = text.split(TOKEN_SPLIT);
  for (let i = 0; i < parts.length; i++) {
    const tok = parts[i];
    if (tok && isHighEntropySecret(tok, threshold)) {
      parts[i] = MASK('HIGH_ENTROPY');
    }
  }
  return parts.join('');
}

export interface RedactOptions {
  /** Run the Shannon-entropy backstop after rule passes. Default true. */
  entropySweep?: boolean;
  /** Entropy threshold in bits/char for the backstop. Default 4.0. */
  entropyThreshold?: number;
  /**
   * Mask email addresses and IPv4 addresses. Default true. Turning this off
   * leaves every credential rule active — it only trades PII masking for
   * readability, which matters on machines where LAN addresses are the subject
   * of the work rather than something to hide.
   */
  pii?: boolean;
}

/**
 * Redact secrets from a single string. Idempotent: the mask token contains no
 * secret-shaped substring, so re-running is a no-op. Never throws; on any
 * internal error the original text is returned unchanged (fail-open on the
 * function, fail-closed is the caller's job via the env kill-switch).
 */
export function redactSecrets(text: string, options?: RedactOptions): string;
export function redactSecrets(text: null, options?: RedactOptions): null;
export function redactSecrets(text: undefined, options?: RedactOptions): undefined;
export function redactSecrets(text: string | null | undefined, options?: RedactOptions): string | null | undefined;
export function redactSecrets(
  text: string | null | undefined,
  options: RedactOptions = {}
): string | null | undefined {
  if (typeof text !== 'string' || text.length === 0) return text;
  try {
    let out = text;
    const piiEnabled = options.pii !== false;
    for (const rule of RULES) {
      if (rule.category === 'pii' && !piiEnabled) continue;
      out = applyRule(out, rule);
    }
    if (options.entropySweep !== false) {
      out = entropySweep(out, options.entropyThreshold ?? 4.0);
    }
    return out;
  } catch {
    return text;
  }
}

/**
 * Recursively redact every string inside arrays/objects (for facts[],
 * concepts[], and nested metadata). Non-strings pass through unchanged.
 */
export function redactSecretsDeep<T>(value: T, options: RedactOptions = {}): T {
  if (typeof value === 'string') {
    return redactSecrets(value, options) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactSecretsDeep(v, options)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactSecretsDeep(v, options);
    }
    return out as T;
  }
  return value;
}

/**
 * Emergency kill-switch read from the environment. Redaction is ON by default;
 * set KEEPMIND_REDACT_SECRETS=0 (or false) to disable.
 */
export function redactionEnabled(): boolean {
  const v = envValue('KEEPMIND_REDACT_SECRETS');
  return v !== '0' && v !== 'false';
}
