// SPDX-License-Identifier: Apache-2.0
//
// One-time cwd-based project remap migration. Extracted from ProcessManager so
// that the DAEMON-only `Database` (node:sqlite) import lives here and NOT in
// ProcessManager: ProcessManager is on the hook CLIENT's import path (pid/spawn
// helpers, runtime resolver), and pulling storage/db.ts into the slim
// hook-client bundle defeated its whole purpose (perf plan P1). Only
// worker-service.ts (the daemon) imports this module.

import path from 'path';
import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { Database } from '../../storage/db.js';
import { logger } from '../../utils/logger.js';
import { paths, dbFileForDataDir } from '../../shared/paths.js';

const DATA_DIR = paths.dataDir();
const CWD_REMAP_MARKER_FILENAME = '.cwd-remap-applied-v1';

type CwdClassification =
  | { kind: 'main'; project: string }
  | { kind: 'worktree'; project: string }
  | { kind: 'skip' };

function gitQuery(cwd: string, args: string[]): string | null {
  const r = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true, // never flash a console window on Windows
  });
  if (r.status !== 0) return null;
  return (r.stdout ?? '').trim();
}

function classifyCwdForRemap(cwd: string): CwdClassification {
  if (!existsSync(cwd)) return { kind: 'skip' };

  const gitDir = gitQuery(cwd, ['rev-parse', '--absolute-git-dir']);
  if (!gitDir) return { kind: 'skip' };

  const commonDir = gitQuery(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  if (!commonDir) return { kind: 'skip' };

  const toplevel = gitQuery(cwd, ['rev-parse', '--show-toplevel']);
  if (!toplevel) return { kind: 'skip' };
  const leaf = path.basename(toplevel);

  if (gitDir === commonDir) {
    return { kind: 'main', project: leaf };
  }

  const parentRepoDir = commonDir.endsWith('/.git')
    ? path.dirname(commonDir)
    : commonDir.replace(/\.git$/, '');
  const parent = path.basename(parentRepoDir);
  return { kind: 'worktree', project: `${parent}/${leaf}` };
}

export function runOneTimeCwdRemap(dataDirectory?: string): void {
  const effectiveDataDir = dataDirectory ?? DATA_DIR;
  const markerPath = path.join(effectiveDataDir, CWD_REMAP_MARKER_FILENAME);
  const dbPath = dbFileForDataDir(effectiveDataDir);

  if (existsSync(markerPath)) {
    logger.debug('SYSTEM', 'cwd-remap marker exists, skipping');
    return;
  }

  if (!existsSync(dbPath)) {
    mkdirSync(effectiveDataDir, { recursive: true });
    writeFileSync(markerPath, new Date().toISOString());
    logger.debug('SYSTEM', 'No DB present, cwd-remap marker written without work', { dbPath });
    return;
  }

  logger.warn('SYSTEM', 'Running one-time cwd-based project remap', { dbPath });

  try {
    executeCwdRemap(dbPath, effectiveDataDir, markerPath);
  } catch (err: unknown) {
    if (err instanceof Error) {
      logger.error('SYSTEM', 'cwd-remap failed, marker not written (will retry on next startup)', {}, err);
    } else {
      logger.error('SYSTEM', 'cwd-remap failed, marker not written (will retry on next startup)', {}, new Error(String(err)));
    }
  }
}

function executeCwdRemap(dbPath: string, effectiveDataDir: string, markerPath: string): void {
  const probe = new Database(dbPath, { readonly: true });
  const hasPending = probe.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'"
  ).get() as { name: string } | undefined;
  probe.close();

  if (!hasPending) {
    mkdirSync(effectiveDataDir, { recursive: true });
    writeFileSync(markerPath, new Date().toISOString());
    logger.info('SYSTEM', 'pending_messages table not present, cwd-remap skipped');
    return;
  }

  const backup = `${dbPath}.bak-cwd-remap-${Date.now()}`;
  copyFileSync(dbPath, backup);
  logger.info('SYSTEM', 'DB backed up before cwd-remap', { backup });

  const db = new Database(dbPath);
  try {
    const cwdRows = db.prepare(`
      SELECT cwd FROM pending_messages
      WHERE cwd IS NOT NULL AND cwd != ''
      GROUP BY cwd
    `).all() as Array<{ cwd: string }>;

    const byCwd = new Map<string, CwdClassification>();
    for (const { cwd } of cwdRows) byCwd.set(cwd, classifyCwdForRemap(cwd));

    const sessionRows = db.prepare(`
      SELECT s.id AS session_id, s.memory_session_id, s.project AS old_project, p.cwd
      FROM sdk_sessions s
      JOIN pending_messages p ON p.session_db_id = s.id
      WHERE p.cwd IS NOT NULL AND p.cwd != ''
        AND p.id = (
          SELECT MIN(p2.id) FROM pending_messages p2
          WHERE p2.session_db_id = s.id
            AND p2.cwd IS NOT NULL AND p2.cwd != ''
        )
    `).all() as Array<{ session_id: number; memory_session_id: string | null; old_project: string; cwd: string }>;

    type Target = { sessionId: number; memorySessionId: string | null; newProject: string };
    const targets: Target[] = [];
    for (const r of sessionRows) {
      const c = byCwd.get(r.cwd);
      if (!c || c.kind === 'skip') continue;
      if (r.old_project === c.project) continue;
      targets.push({ sessionId: r.session_id, memorySessionId: r.memory_session_id, newProject: c.project });
    }

    if (targets.length === 0) {
      logger.info('SYSTEM', 'cwd-remap: no sessions need updating');
    } else {
      const updSession = db.prepare('UPDATE sdk_sessions      SET project = ? WHERE id = ?');
      const updObs     = db.prepare('UPDATE observations      SET project = ? WHERE memory_session_id = ?');
      const updSum     = db.prepare('UPDATE session_summaries SET project = ? WHERE memory_session_id = ?');

      let sessionN = 0, obsN = 0, sumN = 0;
      const tx = db.transaction(() => {
        for (const t of targets) {
          sessionN += updSession.run(t.newProject, t.sessionId).changes;
          if (t.memorySessionId) {
            obsN += updObs.run(t.newProject, t.memorySessionId).changes;
            sumN += updSum.run(t.newProject, t.memorySessionId).changes;
          }
        }
      });
      tx();

      logger.info('SYSTEM', 'cwd-remap applied', { sessions: sessionN, observations: obsN, summaries: sumN, backup });
    }

    mkdirSync(effectiveDataDir, { recursive: true });
    writeFileSync(markerPath, new Date().toISOString());
    logger.info('SYSTEM', 'cwd-remap marker written', { markerPath });
  } finally {
    db.close();
  }
}
