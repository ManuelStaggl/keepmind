// SPDX-License-Identifier: Apache-2.0
//
// The export/import bundle — keepmind's whole source of truth, in files a
// person can read.
//
// WHY A BUNDLE AND NOT A DATABASE COPY. Copying `keepmind.db` is easy and
// wrong for the job it has to do here: it is opaque (nobody can review what
// they are about to restore), it is not diffable (a change of one decision is
// a change of one binary blob), it carries the derived data with it, and it
// pins the restore to whatever schema the source machine happened to be on. A
// bundle is the same information as text, sorted, with a manifest that says
// what is in it and a hash per file that says the bytes are intact.
//
// WHAT IS AND IS NOT SOURCE OF TRUTH.
//   Exported  observations (curated records, checkpoints, observed rows),
//             decision_edges, session_summaries, sdk_sessions, user_prompts,
//             observation_feedback, and the settings that change how any of it
//             is read back.
//   NOT       vectors. They are DERIVED — a function of the text and of the
//             embedder that produced them. Shipping them would ship the one
//             thing that cannot survive a model change: `vec_meta
//             .embedder_identity` exists precisely because two embedders'
//             vectors are incomparable and the failure is silent ("search
//             stopped finding things", nothing in the log). So the import
//             rebuilds them, stamped with the embedder the NEW machine has.
//   NOT       pending_messages. A work queue is not memory; restoring one
//             would replay half-finished work from another machine, and every
//             row in it is by definition not yet an observation.
//
// The manifest is versioned. An importer that meets a bundle it does not
// understand must say so and stop, rather than restore the tables it happens
// to recognise — a partial restore that reports success is how a machine
// change quietly loses a year of decisions.

/**
 * Bump when the MEANING of a field changes or a table joins/leaves the set.
 *
 * Additive changes that older importers can ignore do not need a bump; a
 * change that would make an older importer restore something WRONG does.
 */
export const BUNDLE_SCHEMA_VERSION = 1;

/** Tables written to the bundle, in the order they must be restored. */
export const BUNDLE_TABLES = [
  // sdk_sessions first: observations and summaries carry a foreign key into it
  // (ON DELETE CASCADE), so restoring them in any other order fails or, with
  // foreign keys off, silently orphans every row.
  'sdk_sessions',
  'observations',
  'session_summaries',
  'user_prompts',
  'observation_feedback',
  'decision_edges',
] as const;

export type BundleTable = (typeof BUNDLE_TABLES)[number];

/**
 * Tables deliberately left out, with the reason, so the list is auditable
 * rather than implied by absence.
 */
export const EXCLUDED_TABLES: Record<string, string> = {
  pending_messages: 'a work queue, not memory — restoring it would replay another machine\'s half-finished work',
  schema_versions: 'the target database builds its own schema and records its own migrations',
  vec_documents: 'derived from the text by an embedder; rebuilt on import and stamped with the embedder present there',
};

export interface BundleFileEntry {
  /** File name inside the bundle. */
  file: string;
  /** Rows in the file. Checked on import; a mismatch is a hard failure. */
  rows: number;
  /** SHA-256 of the file bytes, lower-case hex. */
  sha256: string;
}

export interface BundleManifest {
  /** Always `keepmind-export`. Guards against pointing the importer at a directory. */
  kind: 'keepmind-export';
  schemaVersion: number;
  /** keepmind version that wrote the bundle. Informational. */
  keepmindVersion: string;
  createdAt: string;
  /** Projects included, or null for "everything in the database". */
  projects: string[] | null;
  tables: Record<string, BundleFileEntry>;
  /**
   * The embedder the SOURCE machine used. Informational only — the import
   * rebuilds vectors with whatever embedder the TARGET has, and records that
   * one. Carried so a puzzled operator can see the two differ.
   */
  sourceEmbedderIdentity: string | null;
  /** Settings file name inside the bundle, when settings were exported. */
  settingsFile: string | null;
  /** Excluded tables and why, copied in so the bundle explains itself. */
  excluded: Record<string, string>;
}

/** File name for a table's rows. */
export function tableFile(table: string): string {
  return `${table}.jsonl`;
}

export const MANIFEST_FILE = 'manifest.json';
export const SETTINGS_FILE = 'settings.json';

/**
 * Serialise one row as a single JSONL line with keys in a stable order.
 *
 * Stable order is what makes the bundle diffable: without it, two exports of
 * an unchanged database differ on every line as soon as SQLite returns columns
 * in a different order, and a diff that is always noisy is a diff nobody
 * reads.
 */
export function serializeRow(row: Record<string, unknown>): string {
  const keys = Object.keys(row).sort();
  const ordered: Record<string, unknown> = {};
  for (const key of keys) {
    const value = row[key];
    // node:sqlite hands back BigInt for integer columns when safeIntegers is
    // on somewhere up the chain. JSON.stringify throws on BigInt rather than
    // guessing, which would abort an export halfway through.
    ordered[key] = typeof value === 'bigint' ? Number(value) : value;
  }
  return JSON.stringify(ordered);
}
