import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  checkNodeVersion,
  checkProviderReadiness,
  checkLastInteraction,
  summarizeReport,
  type CheckGroup,
} from '../src/npx-cli/commands/doctor.js';

const __dirname = import.meta.dirname;

describe('doctor: checkNodeVersion', () => {
  it('passes on >= 22.5', () => {
    expect(checkNodeVersion('v22.5.0').status).toBe('ok');
    expect(checkNodeVersion('v22.11.0').status).toBe('ok');
    expect(checkNodeVersion('v24.0.0').status).toBe('ok');
    expect(checkNodeVersion('v26.1.0').status).toBe('ok');
  });

  it('fails below 22.5', () => {
    expect(checkNodeVersion('v22.4.0').status).toBe('fail');
    expect(checkNodeVersion('v20.11.0').status).toBe('fail');
    expect(checkNodeVersion('v18.0.0').status).toBe('fail');
  });

  it('is a required check', () => {
    expect(checkNodeVersion('v22.5.0').required).toBe(true);
  });
});

describe('doctor: checkProviderReadiness', () => {
  const base = {
    provider: 'claude',
    claudeAuthMethod: 'subscription',
    geminiKey: '',
    openrouterKey: '',
    envKeys: new Set<string>(),
    staleMarker: undefined as string | undefined,
  };

  it('rejects an invalid provider', () => {
    const r = checkProviderReadiness({ ...base, provider: 'gpt4' });
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('invalid');
  });

  it('claude subscription is ok without a stale marker', () => {
    expect(checkProviderReadiness({ ...base }).status).toBe('ok');
  });

  it('claude subscription warns when the OAuth token is stale', () => {
    const r = checkProviderReadiness({ ...base, staleMarker: 'expired 2026-07-01' });
    expect(r.status).toBe('warn');
    expect(r.detail).toContain('STALE');
  });

  it('claude api-key fails without ANTHROPIC_API_KEY', () => {
    const r = checkProviderReadiness({ ...base, claudeAuthMethod: 'api-key' });
    expect(r.status).toBe('fail');
  });

  it('claude api-key passes when ANTHROPIC_API_KEY is present', () => {
    const r = checkProviderReadiness({
      ...base,
      claudeAuthMethod: 'api-key',
      envKeys: new Set(['ANTHROPIC_API_KEY']),
    });
    expect(r.status).toBe('ok');
  });

  it('claude gateway needs ANTHROPIC_BASE_URL', () => {
    expect(checkProviderReadiness({ ...base, claudeAuthMethod: 'gateway' }).status).toBe('fail');
    expect(
      checkProviderReadiness({
        ...base,
        claudeAuthMethod: 'gateway',
        envKeys: new Set(['ANTHROPIC_BASE_URL']),
      }).status,
    ).toBe('ok');
  });

  it('rejects an invalid claude auth method', () => {
    expect(checkProviderReadiness({ ...base, claudeAuthMethod: 'magic' }).status).toBe('fail');
  });

  it('gemini fails without a key, passes with settings key or env key', () => {
    expect(checkProviderReadiness({ ...base, provider: 'gemini' }).status).toBe('fail');
    expect(checkProviderReadiness({ ...base, provider: 'gemini', geminiKey: 'g-123' }).status).toBe('ok');
    expect(
      checkProviderReadiness({ ...base, provider: 'gemini', envKeys: new Set(['GEMINI_API_KEY']) }).status,
    ).toBe('ok');
  });

  it('openrouter fails without a key, passes with settings key or env key', () => {
    expect(checkProviderReadiness({ ...base, provider: 'openrouter' }).status).toBe('fail');
    expect(
      checkProviderReadiness({ ...base, provider: 'openrouter', openrouterKey: 'or-123' }).status,
    ).toBe('ok');
    expect(
      checkProviderReadiness({
        ...base,
        provider: 'openrouter',
        envKeys: new Set(['OPENROUTER_API_KEY']),
      }).status,
    ).toBe('ok');
  });
});

describe('doctor: checkLastInteraction', () => {
  it('skips when no interaction has happened', () => {
    expect(checkLastInteraction(undefined).status).toBe('skip');
    expect(checkLastInteraction({ provider: 'claude' }).status).toBe('skip');
  });

  it('is ok on a successful last interaction', () => {
    expect(checkLastInteraction({ lastInteraction: { success: true } }).status).toBe('ok');
  });

  it('warns (not fails) on a failed last interaction and surfaces the error', () => {
    const r = checkLastInteraction({ lastInteraction: { success: false, error: 'cert rejected' } });
    expect(r.status).toBe('warn');
    expect(r.required).toBe(false);
    expect(r.detail).toContain('cert rejected');
  });
});

describe('doctor: summarizeReport', () => {
  const groups: CheckGroup[] = [
    {
      title: 'A',
      checks: [
        { name: 'req-ok', status: 'ok', detail: '', required: true },
        { name: 'opt-fail', status: 'fail', detail: '', required: false },
      ],
    },
    {
      title: 'B',
      checks: [{ name: 'warn', status: 'warn', detail: '', required: true }],
    },
  ];

  it('passes when no REQUIRED check fails (optional fails ignored)', () => {
    const r = summarizeReport(groups);
    expect(r.ok).toBe(true);
    expect(r.hardFailures).toBe(0);
  });

  it('fails when a required check fails', () => {
    const withReqFail: CheckGroup[] = [
      { title: 'A', checks: [{ name: 'req', status: 'fail', detail: '', required: true }] },
    ];
    const r = summarizeReport(withReqFail);
    expect(r.ok).toBe(false);
    expect(r.hardFailures).toBe(1);
  });
});

describe('doctor: CLI wiring', () => {
  it('passes argv through so --json is honored', () => {
    const indexSource = readFileSync(join(__dirname, '..', 'src', 'npx-cli', 'index.ts'), 'utf-8');
    expect(indexSource).toContain("case 'doctor'");
    expect(indexSource).toContain('await runDoctorCommand(args.slice(1))');
  });
});
