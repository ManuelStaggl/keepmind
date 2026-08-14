
import { describe, it, expect, beforeEach, afterEach, afterAll, spyOn, mock } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync, rmSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';

// Capture the REAL modules BEFORE mocking so afterAll can restore them.
// bun's `mock.module` is process-global and sticky; `mock.restore()` does NOT
// undo it, so we must explicitly re-register the real implementations to keep
// the suite order-independent (otherwise these mocks leak into later files).
import * as realSettingsDefaultsManager from '../../src/shared/SettingsDefaultsManager.js';
import * as realWorkerUtils from '../../src/shared/worker-utils.js';
import * as realProjectName from '../../src/utils/project-name.js';
import * as realProjectFilter from '../../src/utils/project-filter.js';

// Snapshot the real exports into plain objects NOW, before mock.module mutates
// the live ESM namespace bindings. These snapshots are re-registered in afterAll.
const realSettingsSnapshot = { ...realSettingsDefaultsManager };
const realWorkerUtilsSnapshot = { ...realWorkerUtils };
const realProjectNameSnapshot = { ...realProjectName };
const realProjectFilterSnapshot = { ...realProjectFilter };

// Mutable so a single test can flip one key without re-registering the module
// (mock.module is process-global and sticky — see the note above).
//
// This alone is NOT enough: CI runs the suite under Node through
// tests/bun-test-shim.ts, where `mock.module` cannot intercept an ESM import,
// so the REAL SettingsDefaultsManager runs. Tests that need a specific value
// therefore set the matching env var as well — loadFromFile applies env
// overrides by default — and setSmartTools() below does both at once.
let settingsOverride: Record<string, unknown> = {};

function setSmartTools(value: string | undefined): void {
  if (value === undefined) {
    settingsOverride = {};
    delete process.env.KEEPMIND_MCP_SMART_TOOLS;
    return;
  }
  settingsOverride = { KEEPMIND_MCP_SMART_TOOLS: value };
  process.env.KEEPMIND_MCP_SMART_TOOLS = value;
}

mock.module('../../src/shared/SettingsDefaultsManager.js', () => ({
  SettingsDefaultsManager: {
    get: (key: string) => {
      if (key === 'KEEPMIND_DATA_DIR') return join(homedir(), '.claude-mem');
      return '';
    },
    getInt: () => 0,
    loadFromFile: () => ({ KEEPMIND_EXCLUDED_PROJECTS: [], ...settingsOverride }),
  },
}));

mock.module('../../src/shared/worker-utils.js', () => ({
  ensureWorkerRunning: () => Promise.resolve(true),
  getWorkerPort: () => 37777,
  workerHttpRequest: (apiPath: string, options?: any) => {
    const url = `http://127.0.0.1:37777${apiPath}`;
    return globalThis.fetch(url, {
      method: options?.method ?? 'GET',
      headers: options?.headers,
      body: options?.body,
    });
  },
}));

mock.module('../../src/utils/project-name.js', () => ({
  getProjectName: () => 'test-project',
  getProjectContext: () => ({ allProjects: ['test-project'] }),
}));

mock.module('../../src/utils/project-filter.js', () => ({
  isProjectExcluded: () => false,
}));

import { fileContextHandler } from '../../src/cli/handlers/file-context.js';
import { logger } from '../../src/utils/logger.js';

const PADDING = 'x'.repeat(2_000); 

let tmpDir: string;
let testFile: string;
let loggerSpies: ReturnType<typeof spyOn>[] = [];
let fetchSpy: ReturnType<typeof spyOn> | null = null;

function makeObservationsResponse(observations: Array<{ id: number; created_at_epoch: number; type?: string; title?: string }>) {
  return new Response(
    JSON.stringify({
      observations: observations.map(o => ({
        id: o.id,
        memory_session_id: `session-${o.id}`,
        title: o.title ?? `Observation ${o.id}`,
        type: o.type ?? 'discovery',
        created_at_epoch: o.created_at_epoch,
        files_read: JSON.stringify([]),
        files_modified: JSON.stringify(['test.md']),
      })),
      count: observations.length,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'file-context-test-'));
  testFile = join(tmpDir, 'test.md');
  writeFileSync(testFile, PADDING);

  loggerSpies = [
    spyOn(logger, 'info').mockImplementation(() => {}),
    spyOn(logger, 'debug').mockImplementation(() => {}),
    spyOn(logger, 'warn').mockImplementation(() => {}),
    spyOn(logger, 'error').mockImplementation(() => {}),
  ];
});

afterEach(() => {
  setSmartTools(undefined);
  loggerSpies.forEach(s => s.mockRestore());
  if (fetchSpy) {
    fetchSpy.mockRestore();
    fetchSpy = null;
  }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

afterAll(() => {
  mock.module('../../src/shared/SettingsDefaultsManager.js', () => realSettingsSnapshot);
  mock.module('../../src/shared/worker-utils.js', () => realWorkerUtilsSnapshot);
  mock.module('../../src/utils/project-name.js', () => realProjectNameSnapshot);
  mock.module('../../src/utils/project-filter.js', () => realProjectFilterSnapshot);
});

describe('fileContextHandler — #2094 (no Read mutation)', () => {
  it('injects timeline context but never sets updatedInput on an unconstrained Read', async () => {
    const future = Date.now() + 60_000;
    // Return a FRESH Response per call: this is the first handler invocation in
    // the process, so executeWithWorkerFallback runs the one-time worker warmup
    // (ensureWorkerAliveOnce → isWorkerPortAlive/checkVersionMatch), which fetches
    // and consumes a body before the data fetch. A single shared Response
    // (mockResolvedValue) would throw "Body already read" on the second read.
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(makeObservationsResponse([{ id: 1, created_at_epoch: future }]))
    );

    const result = await fileContextHandler.execute({
      sessionId: 'sess',
      cwd: tmpDir,
      toolName: 'Read',
      toolInput: { file_path: testFile },
    });

    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput!.additionalContext).toContain('Prior observations for this file');
    expect((result.hookSpecificOutput as any).updatedInput).toBeUndefined();
  });

  it('does not set updatedInput on a targeted Read either', async () => {
    const future = Date.now() + 60_000;
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      makeObservationsResponse([{ id: 1, created_at_epoch: future }])
    );

    const result = await fileContextHandler.execute({
      sessionId: 'sess',
      cwd: tmpDir,
      toolName: 'Read',
      toolInput: { file_path: testFile, offset: 289, limit: 140 },
    });

    expect(result.hookSpecificOutput).toBeDefined();
    expect((result.hookSpecificOutput as any).updatedInput).toBeUndefined();
  });

  it('skips entirely when file mtime is newer than newest observation (#1719 still honored)', async () => {
    const stale = Date.now() - 3_600_000;
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      makeObservationsResponse([
        { id: 1, created_at_epoch: stale },
        { id: 2, created_at_epoch: stale - 1000 },
      ])
    );

    const result = await fileContextHandler.execute({
      sessionId: 'sess',
      cwd: tmpDir,
      toolName: 'Read',
      toolInput: { file_path: testFile },
    });

    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it('still injects context when file mtime is older than newest observation', async () => {
    const past = (Date.now() - 3_600_000) / 1000;
    utimesSync(testFile, past, past);

    const now = Date.now();
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      makeObservationsResponse([{ id: 1, created_at_epoch: now }])
    );

    const result = await fileContextHandler.execute({
      sessionId: 'sess',
      cwd: tmpDir,
      toolName: 'Read',
      toolInput: { file_path: testFile },
    });

    expect(result.hookSpecificOutput).toBeDefined();
    expect(result.hookSpecificOutput!.additionalContext).toContain('Prior observations for this file');
    expect((result.hookSpecificOutput as any).updatedInput).toBeUndefined();
  });

  // This block is injected on nearly every tracked Read, which makes it the
  // most frequent instruction keepmind emits. KEEPMIND_MCP_SMART_TOOLS defaults
  // to 'false', so naming smart_outline unconditionally pointed the model at a
  // tool that is not in its listing — and the failure would land one call later,
  // where the cause is no longer visible.
  it('omits the smart_outline hint when the smart tools are not listed', async () => {
    setSmartTools('false');
    const future = Date.now() + 60_000;
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(makeObservationsResponse([{ id: 1, created_at_epoch: future }]))
    );

    const result = await fileContextHandler.execute({
      sessionId: 'sess',
      cwd: tmpDir,
      toolName: 'Read',
      toolInput: { file_path: testFile },
    });

    const context = result.hookSpecificOutput!.additionalContext as string;
    expect(context).toContain('get_observations([IDs])');
    expect(context).not.toContain('smart_outline');
  });

  it('names smart_outline once KEEPMIND_MCP_SMART_TOOLS is the literal "true"', async () => {
    setSmartTools('true');
    const future = Date.now() + 60_000;
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(makeObservationsResponse([{ id: 1, created_at_epoch: future }]))
    );

    const result = await fileContextHandler.execute({
      sessionId: 'sess',
      cwd: tmpDir,
      toolName: 'Read',
      toolInput: { file_path: testFile },
    });

    expect(result.hookSpecificOutput!.additionalContext).toContain('smart_outline(');
  });

  it('treats "1" as off, matching enabledGroups() in the MCP server', async () => {
    setSmartTools('1');
    const future = Date.now() + 60_000;
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(makeObservationsResponse([{ id: 1, created_at_epoch: future }]))
    );

    const result = await fileContextHandler.execute({
      sessionId: 'sess',
      cwd: tmpDir,
      toolName: 'Read',
      toolInput: { file_path: testFile },
    });

    expect(result.hookSpecificOutput!.additionalContext).not.toContain('smart_outline');
  });

  it('header text no longer claims the file was truncated', async () => {
    const future = Date.now() + 60_000;
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      makeObservationsResponse([{ id: 1, created_at_epoch: future }])
    );

    const result = await fileContextHandler.execute({
      sessionId: 'sess',
      cwd: tmpDir,
      toolName: 'Read',
      toolInput: { file_path: testFile },
    });

    const ctx = result.hookSpecificOutput!.additionalContext as string;
    expect(ctx).not.toContain('Only line 1 was read');
    // T1 compressed the 4-line header to one line; it states completeness as
    // "the Read result below is complete" (see src/cli/handlers/file-context.ts).
    expect(ctx).toContain('the Read result below is complete');
  });

  it('accepts a Codex filePaths array and joins per-file context blocks', async () => {
    const otherFile = join(tmpDir, 'other.md');
    writeFileSync(otherFile, PADDING);

    const future = Date.now() + 60_000;
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request) => {
      const text = String(url);
      if (text.includes('other.md')) {
        return Promise.resolve(makeObservationsResponse([{ id: 2, created_at_epoch: future, title: 'Other file context' }]));
      }
      return Promise.resolve(makeObservationsResponse([{ id: 1, created_at_epoch: future, title: 'Main file context' }]));
    });

    const result = await fileContextHandler.execute({
      sessionId: 'sess',
      cwd: tmpDir,
      toolName: 'Bash',
      toolInput: { filePaths: [testFile, otherFile] },
    });

    const ctx = result.hookSpecificOutput!.additionalContext as string;
    expect(ctx).toContain('Main file context');
    expect(ctx).toContain('Other file context');
    expect(ctx).toContain('\n\n---\n\n');
  });

  it('keeps successful timelines when one file lookup fails', async () => {
    const otherFile = join(tmpDir, 'other.md');
    writeFileSync(otherFile, PADDING);

    const future = Date.now() + 60_000;
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request) => {
      const text = String(url);
      if (text.includes('other.md')) {
        return Promise.reject(new Error('worker unavailable'));
      }
      return Promise.resolve(makeObservationsResponse([{ id: 1, created_at_epoch: future, title: 'Main file context' }]));
    });

    const result = await fileContextHandler.execute({
      sessionId: 'sess',
      cwd: tmpDir,
      toolName: 'Bash',
      toolInput: { filePaths: [testFile, otherFile] },
    });

    const ctx = result.hookSpecificOutput!.additionalContext as string;
    expect(ctx).toContain('Main file context');
    expect(ctx).not.toContain('worker unavailable');
  });

  it('queries with BOTH absolute and cwd-relative path candidates (#2691)', async () => {
    const future = Date.now() + 60_000;
    let capturedUrl = '';
    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((url: string | URL | Request) => {
      capturedUrl = String(url);
      return Promise.resolve(makeObservationsResponse([{ id: 1, created_at_epoch: future }]));
    });

    await fileContextHandler.execute({
      sessionId: 'sess',
      cwd: tmpDir,
      toolName: 'Read',
      toolInput: { file_path: testFile },
    });

    const parsed = new URL(capturedUrl);
    const pathParams = parsed.searchParams.getAll('path');
    // Both candidate forms are sent so the worker can match however the path was
    // stored at PostToolUse time (absolute vs cwd-relative).
    const absoluteForm = testFile.split(/[\\/]/).join('/');
    expect(pathParams).toContain(absoluteForm);
    expect(pathParams).toContain('test.md'); // cwd-relative form
    expect(pathParams.length).toBeGreaterThanOrEqual(2);
  });

  it('skips directories before querying file history', async () => {
    const directoryPath = join(tmpDir, 'large-dir');
    mkdirSync(directoryPath);
    fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
      makeObservationsResponse([{ id: 1, created_at_epoch: Date.now() + 60_000 }])
    );

    const result = await fileContextHandler.execute({
      sessionId: 'sess',
      cwd: tmpDir,
      toolName: 'Bash',
      toolInput: { filePaths: [directoryPath] },
    });

    expect(result.continue).toBe(true);
    expect(result.hookSpecificOutput).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
