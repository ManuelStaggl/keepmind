// SPDX-License-Identifier: Apache-2.0
//
// Guards project-scoped session-summary search against the `type` column that
// only observations have.
//
// buildFilterClause emitted `<alias>.type = 'global'` for every project filter,
// so a project-scoped session search produced invalid SQL and the request died
// with "no such column: s.type" — HTTP 500 on every filter-only unified search
// that named a project. It stayed hidden because the two callers passing the
// session alias stripped the caller-supplied `type` FILTER, which is a
// different clause, and because every other route to session summaries hydrates
// by id and never builds this clause.

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../../src/services/sqlite/SessionStore.js';
import { SessionSearch } from '../../../src/services/sqlite/SessionSearch.js';

describe('session search: project filter', () => {
  let store: SessionStore;
  let search: SessionSearch;

  function seedSummary(memorySessionId: string, project: string, request: string): number {
    const sdkId = store.createSDKSession(`content-${memorySessionId}`, project, 'prompt', undefined, 'claude');
    store.ensureMemorySessionIdRegistered(sdkId, memorySessionId);
    return store.importSessionSummary({
      memory_session_id: memorySessionId,
      project,
      request,
      investigated: null,
      learned: null,
      completed: null,
      next_steps: null,
      files_read: null,
      files_edited: null,
      notes: null,
      prompt_number: 1,
      discovery_tokens: 0,
      created_at: new Date(1_700_000_000_000).toISOString(),
      created_at_epoch: 1_700_000_000_000,
    }).id;
  }

  beforeEach(() => {
    store = new SessionStore(':memory:');
    search = new SessionSearch(store.db);
    seedSummary('mem-a', 'alpha-project', 'investigate the alpha deployment');
    seedSummary('mem-b', 'beta-project', 'investigate the beta deployment');
  });

  afterEach(() => {
    store.close();
  });

  it('filters sessions by project without a query', () => {
    // The exact shape that returned 500: filter-only, project set, no text.
    const results = search.searchSessions(undefined, { project: 'alpha-project' });

    expect(results.map((r) => r.memory_session_id)).toEqual(['mem-a']);
  });

  it('filters sessions by project alongside a query', () => {
    const results = search.searchSessions('deployment', { project: 'beta-project' });

    expect(results.map((r) => r.memory_session_id)).toEqual(['mem-b']);
  });

  it('ignores a type filter for sessions instead of failing', () => {
    // Session summaries have no type; a caller passing one must get a scoped
    // result, not invalid SQL.
    const results = search.searchSessions(undefined, {
      project: 'alpha-project',
      type: 'discovery',
    });

    expect(results.map((r) => r.memory_session_id)).toEqual(['mem-a']);
  });

  it('honours includeGlobal=false for sessions', () => {
    const results = search.searchSessions(undefined, {
      project: 'alpha-project',
      includeGlobal: false,
    });

    expect(results.map((r) => r.memory_session_id)).toEqual(['mem-a']);
  });

  it('still keeps global observations eligible under a project filter', () => {
    // The behaviour the `type = 'global'` clause exists for must survive on the
    // table that actually has the column.
    const sdkId = store.createSDKSession('content-global', 'alpha-project', 'prompt', undefined, 'claude');
    store.ensureMemorySessionIdRegistered(sdkId, 'mem-global');
    store.storeObservation('mem-global', 'other-project', {
      type: 'global',
      title: 'Pinned across projects',
      subtitle: null,
      facts: [],
      narrative: 'global marker row',
      concepts: [],
      files_read: [],
      files_modified: [],
    }, 1);

    const results = search.searchObservations(undefined, { project: 'alpha-project' });

    expect(results.some((r) => r.type === 'global')).toBe(true);
  });
});
