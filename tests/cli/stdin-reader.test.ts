
import { describe, it, expect, afterEach } from 'bun:test';
import { Readable } from 'stream';

import { readJsonFromStdin } from '../../src/cli/stdin-reader.js';

const realStdin = process.stdin;
const realStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');

function installFakeStdin(payload: string): void {
  const fake = Readable.from([payload], { objectMode: false }) as unknown as NodeJS.ReadStream;
  Object.defineProperty(fake, 'isTTY', { value: false, configurable: true });
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    enumerable: realStdinDescriptor?.enumerable ?? true,
    writable: true,
    value: fake,
  });
}

afterEach(() => {
  if (realStdinDescriptor) {
    Object.defineProperty(process, 'stdin', realStdinDescriptor);
  } else {
    Object.defineProperty(process, 'stdin', { value: realStdin, configurable: true, writable: true });
  }
});

describe('readJsonFromStdin — onEnd contract (#2089)', () => {
  it('resolves with parsed JSON when stdin yields a complete object', async () => {
    installFakeStdin('{"hello":"world"}');
    const result = await readJsonFromStdin();
    expect(result).toEqual({ hello: 'world' });
  });

  it('resolves with undefined when stdin closes empty', async () => {
    installFakeStdin('');
    const result = await readJsonFromStdin();
    expect(result).toBeUndefined();
  });

  it('rejects when stdin closes with non-empty but unparseable bytes', async () => {
    installFakeStdin('{"truncated":');
    await expect(readJsonFromStdin()).rejects.toThrow(/Malformed JSON at stdin EOF/);
  });

  it('rejects when stdin closes with junk that is clearly not JSON', async () => {
    installFakeStdin('not json at all');
    await expect(readJsonFromStdin()).rejects.toThrow(/Malformed JSON at stdin EOF/);
  });
});

// Perf plan P1: bun-runner.js loads the hook client in-process and hands over the
// payload it already drained from stdin. Key must match PRE_READ_STDIN_KEY.
describe('readJsonFromStdin — pre-read payload handover (perf plan P1)', () => {
  const KEY = '__KEEPMIND_HOOK_STDIN';
  const holder = globalThis as unknown as Record<string, unknown>;

  afterEach(() => {
    delete holder[KEY];
  });

  it('parses a Buffer payload without touching stdin', async () => {
    // stdin is left as a TTY-ish real stream on purpose: if the handover did not
    // short-circuit, this would hang or resolve undefined instead of parsing.
    holder[KEY] = Buffer.from('{"hook":"payload"}', 'utf-8');
    const result = await readJsonFromStdin();
    expect(result).toEqual({ hook: 'payload' });
  });

  it('parses a string payload', async () => {
    holder[KEY] = '{"tool_name":"Edit"}';
    const result = await readJsonFromStdin();
    expect(result).toEqual({ tool_name: 'Edit' });
  });

  it('consumes the payload one-shot so it cannot be replayed', async () => {
    holder[KEY] = '{"first":true}';
    await readJsonFromStdin();
    expect(holder[KEY]).toBeUndefined();

    // Second call must fall through to the normal stdin path.
    installFakeStdin('{"second":true}');
    expect(await readJsonFromStdin()).toEqual({ second: true });
  });

  it('resolves undefined for a blank payload, mirroring the stream EOF path', async () => {
    holder[KEY] = '   \n';
    expect(await readJsonFromStdin()).toBeUndefined();
  });

  it('throws on a malformed payload so hookCommand can surface it', async () => {
    holder[KEY] = '{"truncated":';
    await expect(readJsonFromStdin()).rejects.toThrow(/Malformed JSON in pre-read hook payload/);
  });

  it('ignores an unexpected payload type and falls back to stdin', async () => {
    holder[KEY] = 12345;
    installFakeStdin('{"fallback":true}');
    expect(await readJsonFromStdin()).toEqual({ fallback: true });
  });
});
