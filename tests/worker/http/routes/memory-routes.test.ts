
import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import type { Request, Response } from 'express';
import { logger } from '../../../../src/utils/logger.js';

mock.module('../../../../src/shared/paths.js', () => ({
  getPackageRoot: () => '/tmp/test',
}));
mock.module('../../../../src/shared/worker-utils.js', () => ({
  getWorkerPort: () => 37777,
}));

import { MemoryRoutes } from '../../../../src/services/worker/http/routes/MemoryRoutes.js';

let loggerSpies: ReturnType<typeof spyOn>[] = [];

function createMockReqRes(body: any): { req: Partial<Request>; res: Partial<Response>; jsonSpy: ReturnType<typeof mock>; statusSpy: ReturnType<typeof mock> } {
  const jsonSpy = mock(() => {});
  const statusSpy = mock(() => ({ json: jsonSpy }));
  return {
    req: { body, path: '/api/memory/save', query: {} } as Partial<Request>,
    res: { json: jsonSpy, status: statusSpy } as unknown as Partial<Response>,
    jsonSpy,
    statusSpy,
  };
}

function captureChain(mockApp: any, targetPath: string): (req: Request, res: Response) => void {
  let middleware: ((req: Request, res: Response, next: () => void) => void) | undefined;
  let handler: ((req: Request, res: Response) => void) | undefined;
  mockApp.post = mock((path: string, ...rest: any[]) => {
    if (path !== targetPath) return;
    if (rest.length === 1) {
      handler = rest[0];
    } else {
      middleware = rest[0];
      handler = rest[1];
    }
  });
  return (req: Request, res: Response): void => {
    if (!middleware) {
      handler!(req, res);
      return;
    }
    let nextCalled = false;
    middleware(req, res, () => {
      nextCalled = true;
    });
    if (nextCalled) handler!(req, res);
  };
}

describe('MemoryRoutes — POST /api/memory/save (#2116)', () => {
  let routes: MemoryRoutes;
  let mockStoreObservation: ReturnType<typeof mock>;
  let mockGetOrCreateManualSession: ReturnType<typeof mock>;
  let storeObservationCalls: any[][] = [];

  beforeEach(() => {
    loggerSpies = [
      spyOn(logger, 'info').mockImplementation(() => {}),
      spyOn(logger, 'debug').mockImplementation(() => {}),
      spyOn(logger, 'warn').mockImplementation(() => {}),
      spyOn(logger, 'error').mockImplementation(() => {}),
      spyOn(logger, 'failure').mockImplementation(() => {}),
    ];

    storeObservationCalls = [];
    mockStoreObservation = mock((...args: any[]) => {
      storeObservationCalls.push(args);
      return { id: 42, createdAtEpoch: 1234567890 };
    });
    mockGetOrCreateManualSession = mock((project: string) => `manual-${project}`);

    const mockDbManager = {
      getSessionStore: () => ({
        storeObservation: mockStoreObservation,
        getOrCreateManualSession: mockGetOrCreateManualSession,
      }),
      getChromaSync: () => null,
    };

    routes = new MemoryRoutes(mockDbManager as any, 'claude-mem');
  });

  afterEach(() => {
    loggerSpies.forEach(spy => spy.mockRestore());
    mock.restore();
  });

  function buildHandler(): (req: Request, res: Response) => void {
    const mockApp: any = {
      get: mock(() => {}),
      delete: mock(() => {}),
      use: mock(() => {}),
    };
    const handler = captureChain(mockApp, '/api/memory/save');
    routes.setupRoutes(mockApp as any);
    return handler;
  }

  it('persists arbitrary metadata as JSON-encoded string', () => {
    const handler = buildHandler();
    const metadata = {
      obsidian_note: 'Atom — Test',
      keepmind_version: '12.4.4',
      custom_key: 'value',
    };
    const { req, res } = createMockReqRes({ text: 'hello', metadata });
    handler(req as Request, res as Response);

    expect(mockStoreObservation).toHaveBeenCalledTimes(1);
    const observationArg = storeObservationCalls[0][2];
    expect(observationArg.metadata).toBe(JSON.stringify(metadata));
  });

  it('passes metadata: null when none provided', () => {
    const handler = buildHandler();
    const { req, res } = createMockReqRes({ text: 'hello' });
    handler(req as Request, res as Response);

    const observationArg = storeObservationCalls[0][2];
    expect(observationArg.metadata).toBeNull();
  });

  it('uses top-level project when present', () => {
    const handler = buildHandler();
    const { req, res } = createMockReqRes({
      text: 'hello',
      project: 'top-level-project',
      metadata: { project: 'metadata-project' },
    });
    handler(req as Request, res as Response);

    expect(mockGetOrCreateManualSession).toHaveBeenCalledWith('top-level-project');
    expect(storeObservationCalls[0][1]).toBe('top-level-project');
  });

  it('falls back to metadata.project when top-level project is omitted (#2116)', () => {
    const handler = buildHandler();
    const { req, res } = createMockReqRes({
      text: 'hello',
      metadata: { project: 'my-custom-project' },
    });
    handler(req as Request, res as Response);

    expect(mockGetOrCreateManualSession).toHaveBeenCalledWith('my-custom-project');
    expect(storeObservationCalls[0][1]).toBe('my-custom-project');
  });

  it('falls back to defaultProject when no project supplied anywhere', () => {
    const handler = buildHandler();
    const { req, res } = createMockReqRes({ text: 'hello' });
    handler(req as Request, res as Response);

    expect(mockGetOrCreateManualSession).toHaveBeenCalledWith('claude-mem');
    expect(storeObservationCalls[0][1]).toBe('claude-mem');
  });

  it('rejects unknown top-level fields with HTTP 400 (no silent drop)', () => {
    const handler = buildHandler();
    const { req, res, statusSpy } = createMockReqRes({ text: 'hello', foo: 'bar' });
    handler(req as Request, res as Response);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(mockStoreObservation).not.toHaveBeenCalled();
  });

  it('rejects empty/missing text with HTTP 400', () => {
    const handler = buildHandler();
    const { req, res, statusSpy } = createMockReqRes({});
    handler(req as Request, res as Response);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(mockStoreObservation).not.toHaveBeenCalled();
  });
});

describe('MemoryRoutes — POST /api/checkpoint/*', () => {
  let routes: MemoryRoutes;
  let storeCheckpointCalls: any[][];
  let clearCheckpointCalls: any[][];

  beforeEach(() => {
    loggerSpies = [
      spyOn(logger, 'info').mockImplementation(() => {}),
      spyOn(logger, 'debug').mockImplementation(() => {}),
      spyOn(logger, 'warn').mockImplementation(() => {}),
      spyOn(logger, 'error').mockImplementation(() => {}),
      spyOn(logger, 'failure').mockImplementation(() => {}),
    ];

    storeCheckpointCalls = [];
    clearCheckpointCalls = [];
    const mockDbManager = {
      getSessionStore: () => ({
        storeCheckpoint: (...args: any[]) => {
          storeCheckpointCalls.push(args);
          return { id: 7, createdAtEpoch: 111 };
        },
        clearCheckpoint: (...args: any[]) => {
          clearCheckpointCalls.push(args);
          return { cleared: 1 };
        },
      }),
      getChromaSync: () => null,
    };
    routes = new MemoryRoutes(mockDbManager as any, 'default-proj');
  });

  afterEach(() => {
    loggerSpies.forEach(spy => spy.mockRestore());
    mock.restore();
  });

  function buildHandlerFor(targetPath: string): (req: Request, res: Response) => void {
    const mockApp: any = { get: mock(() => {}), delete: mock(() => {}), use: mock(() => {}) };
    const handler = captureChain(mockApp, targetPath);
    routes.setupRoutes(mockApp as any);
    return handler;
  }

  it('save passes the explicit project through to storeCheckpoint', () => {
    const handler = buildHandlerFor('/api/checkpoint/save');
    const { req, res, jsonSpy } = createMockReqRes({ text: 'baton', focus: 'x', project: 'keepmind' });
    handler(req as Request, res as Response);

    expect(storeCheckpointCalls).toHaveLength(1);
    expect(storeCheckpointCalls[0][0]).toBe('keepmind');
    expect(storeCheckpointCalls[0][1]).toBe('baton');
    expect(storeCheckpointCalls[0][2]).toMatchObject({ focus: 'x' });
    expect(jsonSpy).toHaveBeenCalled();
  });

  it('save falls back to the worker default project when none supplied', () => {
    const handler = buildHandlerFor('/api/checkpoint/save');
    const { req, res } = createMockReqRes({ text: 'baton' });
    handler(req as Request, res as Response);

    expect(storeCheckpointCalls[0][0]).toBe('default-proj');
  });

  it('save rejects empty text and unknown fields with HTTP 400', () => {
    const handlerEmpty = buildHandlerFor('/api/checkpoint/save');
    const empty = createMockReqRes({ text: '   ' });
    handlerEmpty(empty.req as Request, empty.res as Response);
    expect(empty.statusSpy).toHaveBeenCalledWith(400);

    const handlerUnknown = buildHandlerFor('/api/checkpoint/save');
    const unknown = createMockReqRes({ text: 'ok', bogus: 1 });
    handlerUnknown(unknown.req as Request, unknown.res as Response);
    expect(unknown.statusSpy).toHaveBeenCalledWith(400);

    expect(storeCheckpointCalls).toHaveLength(0);
  });

  it('clear calls clearCheckpoint for the resolved project', () => {
    const handler = buildHandlerFor('/api/checkpoint/clear');
    const { req, res, jsonSpy } = createMockReqRes({ project: 'keepmind' });
    handler(req as Request, res as Response);

    expect(clearCheckpointCalls).toHaveLength(1);
    expect(clearCheckpointCalls[0][0]).toBe('keepmind');
    expect(jsonSpy).toHaveBeenCalled();
  });
});
