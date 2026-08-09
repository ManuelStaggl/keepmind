import { describe, it, expect } from 'bun:test';
import { redactSecrets, redactSecretsDeep } from '../../src/services/redaction/redact-secrets.js';

// Real-shaped FAKE secrets (never valid, generated for the test only).
const SAMPLES: Array<{ name: string; raw: string; mask: string; rawNeedle: string }> = [
  { name: 'AWS_KEY', raw: 'key AKIAIOSFODNN7EXAMPLE here', mask: '«redacted:AWS_KEY»', rawNeedle: 'AKIAIOSFODNN7EXAMPLE' },
  { name: 'GITHUB_PAT', raw: 'token ghp_1234567890abcdefghijklmnopqrstuvwxyz end', mask: '«redacted:GITHUB_PAT»', rawNeedle: 'ghp_1234567890abcdefghijklmnopqrstuvwxyz' },
  { name: 'GITLAB_PAT', raw: 'glpat-ABCDEFGHIJ1234567890', mask: '«redacted:GITLAB_PAT»', rawNeedle: 'glpat-ABCDEFGHIJ1234567890' },
  { name: 'SLACK_TOKEN', raw: 'xoxb-123456789012-abcdefghijklmnop', mask: '«redacted:SLACK_TOKEN»', rawNeedle: 'xoxb-123456789012' },
  { name: 'GOOGLE_API_KEY', raw: 'AIzaSyA1234567890abcdefghijklmnopqrstuv', mask: '«redacted:GOOGLE_API_KEY»', rawNeedle: 'AIzaSyA1234567890abcdefghijklmnopqrstuv' },
  { name: 'STRIPE_KEY', raw: 'sk_live_abcdefghij1234567890ABCD', mask: '«redacted:STRIPE_KEY»', rawNeedle: 'sk_live_abcdefghij1234567890ABCD' },
  { name: 'BCRYPT', raw: 'hash $2b$12$abcdefghijklmnopqrstuvABCDEFGHIJKLMNOPQRSTUVWXYZ012345 ok', mask: '«redacted:BCRYPT»', rawNeedle: '$2b$12$abcdefghijklmnopqrstuv' },
  { name: 'JWT', raw: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N', mask: '«redacted:JWT»', rawNeedle: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' },
  { name: 'BEARER', raw: 'Authorization: Bearer abcdef1234567890XYZ', mask: '«redacted:BEARER»', rawNeedle: 'Bearer abcdef1234567890XYZ' },
  { name: 'CONNECTION_STRING', raw: 'db postgres://user:s3cr3tp4ss@db.example.com:5432/app', mask: '«redacted:CONNECTION_STRING»', rawNeedle: 's3cr3tp4ss' },
  // `password = <value>` is now claimed by the CREDENTIAL_ASSIGNMENT rule, which
  // runs ahead of GENERIC_SECRET. It has to: GENERIC_SECRET's value class is
  // [\w./+=-], so it stops at the first symbol and would leave the tail of a
  // password like `Sup3rS3cret!Passw0rd` in cleartext. Same protection, applied
  // to more values (symbols allowed, no 10-char floor) — only the label moved.
  { name: 'CREDENTIAL_ASSIGNMENT', raw: 'password = hunter2hunter2hunter', mask: '«redacted:CREDENTIAL_ASSIGNMENT»', rawNeedle: 'hunter2hunter2hunter' },
  // GENERIC_SECRET still owns the non-assignment shapes it was written for.
  { name: 'GENERIC_SECRET', raw: 'client_secret: abcdefghij1234567890', mask: '«redacted:GENERIC_SECRET»', rawNeedle: 'abcdefghij1234567890' },
];

describe('redactSecrets', () => {
  for (const s of SAMPLES) {
    it(`redacts ${s.name}`, () => {
      const out = redactSecrets(s.raw);
      expect(out).toContain(s.mask);
      expect(out).not.toContain(s.rawNeedle);
    });
  }

  it('is idempotent', () => {
    for (const s of SAMPLES) {
      const once = redactSecrets(s.raw);
      expect(redactSecrets(once)).toBe(once);
    }
  });

  it('redacts an opaque high-entropy token via the entropy backstop', () => {
    const out = redactSecrets('the value is Zx9Qw2Lm7Pv3Rk8Tn1Yb4Hc6Jd0Fg5 done');
    expect(out).toContain('«redacted:HIGH_ENTROPY»');
    expect(out).not.toContain('Zx9Qw2Lm7Pv3Rk8Tn1Yb4Hc6Jd0Fg5');
  });

  it('does NOT redact normal prose', () => {
    const prose = 'We refactored the SessionStore to add a redaction chokepoint before hashing.';
    expect(redactSecrets(prose)).toBe(prose);
  });

  it('does NOT redact a normal filepath', () => {
    const p = 'src/services/redaction/redact-secrets.ts and C:\\Users\\foo\\bar.txt';
    expect(redactSecrets(p)).toBe(p);
  });

  it('does NOT redact a short git sha', () => {
    const sha = 'commit a5a7ff4 and 7976fe0bca12';
    expect(redactSecrets(sha)).toBe(sha);
  });

  it('passes through null/undefined/empty', () => {
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(undefined)).toBeUndefined();
    expect(redactSecrets('')).toBe('');
  });

  it('deep-redacts arrays (facts[])', () => {
    const facts = ['the api key is ghp_1234567890abcdefghijklmnopqrstuvwxyz', 'normal fact'];
    const out = redactSecretsDeep(facts);
    expect(out[0]).toContain('«redacted:GITHUB_PAT»');
    expect(out[1]).toBe('normal fact');
  });
});
