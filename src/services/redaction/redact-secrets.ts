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
  | 'GENERIC_SECRET' | 'HIGH_ENTROPY';

interface Rule {
  type: RedactionType;
  re: RegExp;
  /** When set, only this capture group is masked (the rest of the match is preserved). */
  group?: number;
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
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp|https?):\/\/[^\s/@]+:[^\s/@]+@[^\s]{1,200}/gi,
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
];

function applyRule(text: string, rule: Rule): string {
  // Reset lastIndex defensively (rules are module-level + global).
  rule.re.lastIndex = 0;
  if (rule.group === undefined) {
    return text.replace(rule.re, MASK(rule.type));
  }
  const g = rule.group;
  return text.replace(rule.re, (match, ...groups) => {
    const captured = groups[g - 1];
    if (typeof captured !== 'string' || captured.length === 0) return match;
    return match.replace(captured, MASK(rule.type));
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
    for (const rule of RULES) {
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
