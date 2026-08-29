// F4 foundation: classified provider errors with extensible kind field.
export type ProviderErrorClass =
  | 'transient'
  | 'unrecoverable'
  | 'rate_limit'
  | 'quota_exhausted'
  | 'auth_invalid'
  // S12. Distinct from BOTH neighbours on purpose. It is not `setup_required`
  // — that kind's remediation is "install or update the Claude CLI", which is
  // the wrong instruction when the binary is present and only the login is
  // gone. It is not `auth_invalid` either: that means a rejected API key, and
  // the fix there is to correct a configured value, not to log in.
  | 'auth_expired'
  | 'setup_required'
  | (string & {}); // open union: providers may emit custom kinds

export class ClassifiedProviderError extends Error {
  readonly kind: ProviderErrorClass;
  readonly retryAfterMs?: number;
  readonly cause: unknown;

  constructor(message: string, opts: {
    kind: ProviderErrorClass;
    cause: unknown;
    retryAfterMs?: number;
  }) {
    super(message);
    this.name = 'ClassifiedProviderError';
    this.kind = opts.kind;
    this.cause = opts.cause;
    if (opts.retryAfterMs !== undefined) {
      this.retryAfterMs = opts.retryAfterMs;
    }
  }
}

export function isClassified(err: unknown): err is ClassifiedProviderError {
  return err instanceof ClassifiedProviderError;
}
