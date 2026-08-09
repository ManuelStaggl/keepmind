import { describe, it, expect } from 'bun:test';
import {
  buildBatchedObservationPrompt,
  buildObservationPrompt,
  buildStatelessObservationPrompt,
  buildInitPrompt,
} from '../../src/sdk/prompts.js';
import { sensitiveFileReason, sensitivePathInPayload } from '../../src/services/redaction/outbound.js';

// Real-shaped FAKE credentials, generated for this test only.
const SECRETS = {
  password: 'Sup3rS3cret!Passw0rd',
  apiKey: 'ghp_1234567890abcdefghijklmnopqrstuvwxyz',
  accessToken: 'xoxb-123456789012-abcdefghijklmnop',
  privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAx7Vn9kQ2bLm4pRtYuIoP\n-----END RSA PRIVATE KEY-----',
  connectionString: 'Server=tcp:sql01.corp.local,1433;Initial Catalog=Payroll;User ID=svc_app;Password=Sup3rS3cret!Passw0rd;',
  jdbc: 'jdbc:sqlserver://sql01.corp.local:1433;databaseName=Payroll;user=svc_app;password=An0ther!Secret',
};

function observationWith(output: string, input: unknown = { command: 'cat config' }) {
  return {
    id: 0,
    tool_name: 'Bash',
    tool_input: JSON.stringify(input),
    tool_output: JSON.stringify(output),
    created_at_epoch: 1_754_700_000_000,
  };
}

/**
 * ACCEPTANCE TEST 1 — redaction happens BEFORE the prompt leaves the machine.
 *
 * This asserts on the prompt string that is actually handed to the provider, so
 * it fails if the redactOutbound calls are removed from the prompt builders.
 * Asserting on the stored observation instead would prove nothing: that path was
 * always redacted, and it was never the leak.
 */
describe('outbound redaction (acceptance test 1)', () => {
  const payload = [
    `password=${SECRETS.password}`,
    `api_key: ${SECRETS.apiKey}`,
    `token ${SECRETS.accessToken}`,
    SECRETS.privateKey,
    SECRETS.connectionString,
    SECRETS.jdbc,
  ].join('\n');

  it('emits no credential in a single-observation prompt', () => {
    const prompt = buildObservationPrompt(observationWith(payload));
    expect(prompt).not.toContain(SECRETS.password);
    expect(prompt).not.toContain(SECRETS.apiKey);
    expect(prompt).not.toContain(SECRETS.accessToken);
    expect(prompt).not.toContain('MIIEowIBAAKCAQEAx7Vn9kQ2bLm4pRtYuIoP');
    expect(prompt).not.toContain('An0ther!Secret');
  });

  it('emits no credential in a batched prompt', () => {
    const prompt = buildBatchedObservationPrompt([
      observationWith(payload),
      observationWith(`second occurrence: ${SECRETS.apiKey}`),
    ]);
    expect(prompt).not.toContain(SECRETS.password);
    expect(prompt).not.toContain(SECRETS.apiKey);
  });

  it('emits no credential from the tool INPUT either', () => {
    const prompt = buildObservationPrompt(
      observationWith('ok', { command: `curl -H "Authorization: Bearer ${SECRETS.apiKey}" https://api.example.com` })
    );
    expect(prompt).not.toContain(SECRETS.apiKey);
  });

  it('emits no credential from the verbatim user prompt', () => {
    const mode = { prompts: { header_memory_start: 'start' } } as any;
    const prompt = buildInitPrompt('proj', 'sess', `deploy with password=${SECRETS.password}`, mode);
    expect(prompt).not.toContain(SECRETS.password);
  });

  it('masks the connection-string password but keeps the rest diagnosable', () => {
    const prompt = buildObservationPrompt(observationWith(SECRETS.connectionString));
    expect(prompt).not.toContain(SECRETS.password);
    // Server / catalog / user stay readable — that is what makes a connection
    // failure still explainable after redaction.
    expect(prompt).toContain('sql01.corp.local');
    expect(prompt).toContain('Payroll');
  });
});

/**
 * ACCEPTANCE TEST 2 — redaction must not destroy legitimate technical content.
 */
describe('no unnecessary cleartext loss (acceptance test 2)', () => {
  const errorText = [
    'TypeError: Cannot read properties of undefined (reading \'sessionStore\')',
    '    at SearchManager.search (src/services/worker/SearchManager.ts:512:31)',
    '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
    'Caused by: schema mismatch in observations.fts_hit_count',
  ].join('\n');

  it('keeps paths, line numbers and identifiers intact', () => {
    const prompt = buildObservationPrompt(observationWith(errorText));
    expect(prompt).toContain('src/services/worker/SearchManager.ts');
    expect(prompt).toContain('512');
    expect(prompt).toContain('SearchManager.search');
    expect(prompt).toContain('fts_hit_count');
    expect(prompt).toContain('TypeError');
  });

  it('keeps ordinary prose and short git shas', () => {
    const prompt = buildObservationPrompt(
      observationWith('commit a5a7ff4 refactored the SessionStore redaction chokepoint')
    );
    expect(prompt).toContain('a5a7ff4');
    expect(prompt).toContain('SessionStore');
  });
});

/**
 * The sensitive-file guard: pattern matching over a key file is the wrong tool,
 * so the payload is dropped and only the access is reported.
 */
describe('sensitive file guard', () => {
  it('recognises credential-bearing files', () => {
    expect(sensitiveFileReason('/home/me/project/.env')).toBe('environment file');
    expect(sensitiveFileReason('C:\\Users\\me\\.ssh\\id_rsa')).toBe('SSH private key');
    expect(sensitiveFileReason('certs/server.pem')).toBe('key material');
    expect(sensitiveFileReason('/home/me/.aws/credentials')).toBeTruthy();
  });

  it('leaves ordinary source files alone', () => {
    expect(sensitiveFileReason('src/index.ts')).toBeNull();
    expect(sensitiveFileReason('README.md')).toBeNull();
    expect(sensitiveFileReason('.env.example')).toBeNull();
  });

  it('finds the offending path inside a tool input', () => {
    expect(sensitivePathInPayload({ file_path: '/app/.env' })?.reason).toBe('environment file');
    expect(sensitivePathInPayload({ file_path: '/app/main.ts' })).toBeNull();
  });

  it('withholds the content of a .env read but still reports the access', () => {
    const prompt = buildObservationPrompt({
      id: 0,
      tool_name: 'Read',
      tool_input: JSON.stringify({ file_path: '/app/.env' }),
      tool_output: JSON.stringify(`DB_PASSWORD=${SECRETS.password}\nAPI_KEY=${SECRETS.apiKey}`),
      created_at_epoch: 1_754_700_000_000,
    });
    expect(prompt).not.toContain(SECRETS.password);
    expect(prompt).not.toContain(SECRETS.apiKey);
    expect(prompt).toContain('withheld');
    expect(prompt).toContain('/app/.env');
  });
});

/**
 * ACCEPTANCE TEST 3 — the prompt must not grow with session length.
 *
 * The conversational path re-sent its whole history every turn; measured, that
 * re-read was 91.7% of all tokens billed. The stateless prompt carries a
 * fixed-size context block instead, so N compressions of the same batch must
 * produce the same prompt size regardless of how much has been recorded before.
 */
describe('no accumulating conversation (acceptance test 3)', () => {
  it('keeps prompt size flat as recorded history grows', () => {
    const batch = [observationWith('a routine tool result of stable size')];
    const sizes: number[] = [];

    for (let turn = 1; turn <= 25; turn++) {
      // History grows every turn — this is what used to inflate the prompt.
      const recentTitles = Array.from({ length: turn * 4 }, (_, i) => `Recorded observation number ${i} with a reasonably long title`);
      sizes.push(
        buildStatelessObservationPrompt(batch, { userPrompt: 'do the work', recentTitles }).length
      );
    }

    // The block fills up over the first turn or two, then stops: it is capped by
    // count AND by characters. What matters is that it PLATEAUS — under the old
    // resumed-conversation path this series grew without bound (14k → 50k
    // cache-read tokens by turn 12 of a single session).
    const plateau = sizes.slice(2);
    expect(new Set(plateau).size).toBe(1);
    expect(sizes[sizes.length - 1]).toBe(plateau[0]);

    // And the plateau is reached quickly and stays small in absolute terms.
    expect(Math.max(...sizes)).toBeLessThan(3_000);
  });

  it('bounds the context block even with absurd history', () => {
    const huge = Array.from({ length: 5_000 }, (_, i) => `title ${i} ${'x'.repeat(500)}`);
    const prompt = buildStatelessObservationPrompt(
      [observationWith('short')],
      { userPrompt: 'work', recentTitles: huge }
    );
    expect(prompt.length).toBeLessThan(8_000);
  });
});
