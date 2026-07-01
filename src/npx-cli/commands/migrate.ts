// SPDX-License-Identifier: Apache-2.0
//
// `keepmind migrate` — lossless, non-destructive import of an existing
// claude-mem database into keepmind (~/.keepmind).
//
// Two modes, auto-detected from the target state:
//
//   Adopt  — target DB absent or empty: take a clean `VACUUM INTO` snapshot of
//            the source, then open it once through SessionStore so keepmind's
//            idempotent migrations upgrade the schema (v32 → current). Bit-for-bit
//            lossless, including rows the source left without a matching session
//            (foreign keys are only added additively, never enforced on copy).
//
//   Merge  — target already has sessions: ATTACH the source read-only and
//            INSERT OR IGNORE each table with an explicit column projection.
//            Dedup rides the existing unique indexes (observations' content_hash,
//            sessions' platform+content), user_prompts resolve their session_db_id
//            from content_session_id, and the FTS indexes are rebuilt afterwards.
//
// Vectors are intentionally NOT embedded here. The worker runs
// VectorSync.backfillAllProjects() (watermark-incremental) on its next start,
// which embeds every imported row. The source database is only ever read, so the
// original stays fully intact for rollback.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import pc from 'picocolors';
import { DATA_DIR, DB_PATH, ensureDir, paths } from '../../shared/paths.js';
import { Database } from '../../storage/db.js';

interface Counts {
  sessions: number;
  observations: number;
  summaries: number;
  prompts: number;
}

/** SQLite single-quoted string literal (for VACUUM INTO / ATTACH paths). */
function sqlStr(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function readFlagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) return undefined;
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('-')) {
    console.error(pc.red(`Flag ${name} requires a value.`));
    process.exit(1);
  }
  return next;
}

/** Resolve the source claude-mem.db from a --from dir/file or the default. */
function resolveSource(fromArg: string | undefined): string {
  if (fromArg) {
    // Accept either a directory containing claude-mem.db or a direct .db path.
    if (fs.existsSync(fromArg) && fs.statSync(fromArg).isDirectory()) {
      return path.join(fromArg, 'claude-mem.db');
    }
    return fromArg;
  }
  return path.join(os.homedir(), '.claude-mem', 'claude-mem.db');
}

function safeCount(db: Database, table: string): number {
  try {
    const row = db.prepare<{ n: number }>(`SELECT COUNT(*) AS n FROM "${table}"`).get();
    return row?.n ?? 0;
  } catch {
    return 0; // table does not exist in this DB
  }
}

function readCounts(dbPath: string): Counts {
  const db = new Database(dbPath, { readonly: true });
  try {
    return {
      sessions: safeCount(db, 'sdk_sessions'),
      observations: safeCount(db, 'observations'),
      summaries: safeCount(db, 'session_summaries'),
      prompts: safeCount(db, 'user_prompts'),
    };
  } finally {
    db.close();
  }
}

function printCounts(label: string, c: Counts): void {
  console.log(
    `  ${label.padEnd(8)} ` +
      `${pc.bold(String(c.sessions))} sessions · ` +
      `${pc.bold(String(c.observations))} observations · ` +
      `${pc.bold(String(c.summaries))} summaries · ` +
      `${pc.bold(String(c.prompts))} prompts`,
  );
}

/** Adopt: snapshot the source into a fresh target, then run migrations. */
async function runAdopt(source: string): Promise<void> {
  ensureDir(DATA_DIR);

  // Only reached when the target is absent or empty — clear any empty stub
  // (plus WAL/SHM sidecars) so VACUUM INTO writes to a clean path.
  for (const suffix of ['', '-wal', '-shm']) {
    const p = DB_PATH + suffix;
    if (fs.existsSync(p)) fs.rmSync(p);
  }

  console.log(pc.dim('  Snapshotting source (VACUUM INTO)…'));
  const src = new Database(source, { readonly: true });
  try {
    src.exec(`VACUUM INTO ${sqlStr(DB_PATH)}`);
  } finally {
    src.close();
  }

  console.log(pc.dim('  Upgrading schema via keepmind migrations…'));
  const { SessionStore } = await import('../../services/sqlite/SessionStore.js');
  const store = new SessionStore(DB_PATH);
  store.close();
}

/** Merge: ATTACH source read-only and INSERT OR IGNORE with dedup. */
async function runMerge(source: string): Promise<void> {
  // Ensure the target schema is fully migrated before bulk import.
  const { SessionStore } = await import('../../services/sqlite/SessionStore.js');
  new SessionStore(DB_PATH).close();

  const db = new Database(DB_PATH);
  try {
    db.exec('PRAGMA foreign_keys=OFF');
    db.exec(`ATTACH DATABASE ${sqlStr(source)} AS src`);
    db.exec('BEGIN');
    try {
      db.exec(`
        INSERT OR IGNORE INTO sdk_sessions
          (content_session_id, memory_session_id, project, platform_source,
           user_prompt, started_at, started_at_epoch, completed_at, completed_at_epoch, status)
        SELECT content_session_id, memory_session_id, project, COALESCE(platform_source, 'claude'),
               user_prompt, started_at, started_at_epoch, completed_at, completed_at_epoch, status
        FROM src.sdk_sessions
      `);

      db.exec(`
        INSERT OR IGNORE INTO observations
          (memory_session_id, project, text, type, title, subtitle, facts, narrative, concepts,
           files_read, files_modified, prompt_number, discovery_tokens, created_at, created_at_epoch,
           content_hash, generated_by_model, relevance_count, merged_into_project, agent_type, agent_id, metadata)
        SELECT memory_session_id, project, COALESCE(text, ''), type, title, subtitle, facts, narrative, concepts,
               files_read, files_modified, prompt_number, discovery_tokens, created_at, created_at_epoch,
               content_hash, generated_by_model, relevance_count, merged_into_project, agent_type, agent_id, metadata
        FROM src.observations
      `);
      db.exec('UPDATE observations SET valid_from = created_at_epoch WHERE valid_from IS NULL');

      // session_summaries carry no content_hash and (depending on the target's
      // origin) may lack a UNIQUE index, so dedup on (memory_session_id,
      // created_at_epoch) to keep re-runs idempotent.
      db.exec(`
        INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed, next_steps,
           files_read, files_edited, notes, prompt_number, discovery_tokens, created_at, created_at_epoch, merged_into_project)
        SELECT ss.memory_session_id, ss.project, ss.request, ss.investigated, ss.learned, ss.completed, ss.next_steps,
               ss.files_read, ss.files_edited, ss.notes, ss.prompt_number, ss.discovery_tokens, ss.created_at, ss.created_at_epoch, ss.merged_into_project
        FROM src.session_summaries ss
        WHERE NOT EXISTS (
          SELECT 1 FROM session_summaries d
          WHERE d.memory_session_id = ss.memory_session_id AND d.created_at_epoch = ss.created_at_epoch
        )
      `);

      // user_prompts: resolve session_db_id from content_session_id; skip rows
      // already present (content_session_id, prompt_number) so re-runs are idempotent.
      db.exec(`
        INSERT INTO user_prompts (session_db_id, content_session_id, prompt_number, prompt_text, created_at, created_at_epoch)
        SELECT (SELECT t.id FROM sdk_sessions t WHERE t.content_session_id = sp.content_session_id ORDER BY t.id LIMIT 1),
               sp.content_session_id, sp.prompt_number, sp.prompt_text, sp.created_at, sp.created_at_epoch
        FROM src.user_prompts sp
        WHERE NOT EXISTS (
          SELECT 1 FROM user_prompts up
          WHERE up.content_session_id = sp.content_session_id AND up.prompt_number = sp.prompt_number
        )
      `);

      // Rebuild the external-content FTS indexes so they reflect the merged rows.
      db.exec("INSERT INTO observations_fts(observations_fts) VALUES('rebuild')");
      db.exec("INSERT INTO session_summaries_fts(session_summaries_fts) VALUES('rebuild')");
      db.exec("INSERT INTO user_prompts_fts(user_prompts_fts) VALUES('rebuild')");

      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw error;
    } finally {
      try { db.exec('DETACH DATABASE src'); } catch { /* ignore */ }
      db.exec('PRAGMA foreign_keys=ON');
    }
  } finally {
    db.close();
  }
}

export async function runMigrateCommand(argv: string[] = []): Promise<void> {
  const dryRun = argv.includes('--dry-run');
  const fromArg = readFlagValue(argv, '--from');
  const source = resolveSource(fromArg);

  console.log(`\n${pc.bold('keepmind migrate')}\n`);

  if (!fs.existsSync(source)) {
    console.error(pc.red(`Source database not found: ${source}`));
    console.error(pc.dim('  Pass --from <dir-or-file> to point at an existing claude-mem.db.'));
    process.exit(1);
  }

  const srcCounts = readCounts(source);
  const targetExists = fs.existsSync(DB_PATH);
  const targetSessions = targetExists ? readCounts(DB_PATH).sessions : 0;
  const mode: 'adopt' | 'merge' = !targetExists || targetSessions === 0 ? 'adopt' : 'merge';

  console.log(pc.dim(`  Source: ${source}`));
  printCounts('source', srcCounts);
  console.log(pc.dim(`  Target: ${DB_PATH}`));
  printCounts('target', targetExists ? readCounts(DB_PATH) : { sessions: 0, observations: 0, summaries: 0, prompts: 0 });
  console.log(`  Mode:   ${pc.bold(mode === 'adopt' ? 'ADOPT (fresh snapshot)' : 'MERGE (dedup import)')}`);

  if (mode === 'merge' && fs.existsSync(paths.workerPid())) {
    console.log(pc.yellow('  Note: a keepmind worker appears to be running. Stop it first for a clean merge:'));
    console.log(pc.dim('        npx keepmind stop'));
  }

  if (dryRun) {
    console.log(`\n${pc.cyan('Dry run')} — no changes written.\n`);
    return;
  }

  console.log('');
  if (mode === 'adopt') {
    await runAdopt(source);
  } else {
    await runMerge(source);
  }

  const after = readCounts(DB_PATH);
  console.log(`\n${pc.green('✓ Migration complete.')}`);
  printCounts('result', after);
  console.log(pc.dim('  Vectors backfill automatically on the next worker start (semantic search).'));
  console.log(pc.dim('  The original database was not modified.\n'));
}
