// SPDX-License-Identifier: Apache-2.0
//
// Importer for curated work items ("Vorgänge").
//
// Same guarantee as the record importer, for the same reason: this calls
// SessionStore.storeObservation directly and never enqueues anything, so a
// curated item cannot reach a provider. See akten-importer.ts.
//
// WHAT IS DIFFERENT HERE: the state of a work item is not in the file. The
// corpus has no `status` field and its guard rejects one — state is computed
// from the append-only event log, and the log lives beside the items rather
// than inside them. So this importer reads two things and joins them, and it
// stores the computed state as a DERIVED value, stamped with the log line it
// came from. Nothing writes state back: the file stays the truth, the log
// stays the arbiter, and this is a read.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { parseVorgang, type ParsedVorgang } from './vorgang-parser.js';
import { parseEreignisLog, deriveStates, type DerivedState } from './ereignis-log.js';
import { logger } from '../../utils/logger.js';
import type { CuratedStore, ImportOptions } from './akten-importer.js';

/** The event log's filename, as the corpus writes it. */
export const EVENT_LOG_FILE = 'EREIGNISSE.log';

export interface ImportedVorgang {
  id: number;
  vorgangId: string;
  titel: string;
  sourcePath: string;
  sourceLine: number;
  /** Derived from the event log, never read from the file. */
  state: string;
  edges: number;
}

export interface VorgangImportReport {
  imported: ImportedVorgang[];
  skipped: Array<{ file: string; reason: string }>;
  failed: Array<{ file: string; error: string }>;
  /** Log lines that are not well-formed events. Never silently dropped. */
  malformed: Array<{ line: number; text: string; reason: string }>;
  /** Event kinds the reader does not know — reported so they can be decided on. */
  unknownKinds: Array<{ line: number; art: string; vorgang: string }>;
  /**
   * Relation fields pointing at the item that declares them. One exists in the
   * delivered corpus (V-0178 `schliesst: V-0178`). Almost certainly a typo,
   * and either way an edge from a node to itself says nothing — so it is
   * reported rather than written.
   */
  selfEdges: Array<{ vorgang: string; field: string; sourcePath: string; sourceLine: number }>;
  /** True when the directory carried no event log; every state is then unknown. */
  eventLogMissing: boolean;
}

/** `V-0001` and nothing else. Both namespaces are read, never conflated. */
const VORGANG_ID_RE = /^V-\d{3,}$/;

function isMarkdown(file: string): boolean {
  return extname(file).toLowerCase() === '.md';
}

/**
 * The subtitle carries the derived state, and says it is derived.
 *
 * "Zustand: offen" alone would read as something the file asserts. It is not —
 * it is the outcome of a computation over a log, and a reader who cannot tell
 * the difference will eventually edit the wrong thing.
 */
export function subtitleForVorgang(parsed: ParsedVorgang, derived: DerivedState | undefined): string {
  const parts: string[] = [];
  parts.push(`Zustand (abgeleitet): ${derived?.state ?? 'unbekannt'}`);
  if (derived?.since) parts.push(`seit ${derived.since}`);
  if (parsed.entscheidet) parts.push(parsed.entscheidet);
  return parts.join(' · ');
}

/** Header block plus body, verbatim — nothing is rewritten or condensed. */
export function renderVorgang(parsed: ParsedVorgang): string {
  const header = parsed.fields.map(f => `${f.name}: ${f.value}`).join('\n');
  return [header, parsed.body.trim()].filter(p => p.length > 0).join('\n\n');
}

export function importVorgaengeDirectory(
  store: CuratedStore,
  directory: string,
  options: ImportOptions,
): VorgangImportReport {
  const root = resolve(directory);
  const report: VorgangImportReport = {
    imported: [], skipped: [], failed: [], malformed: [], unknownKinds: [],
    selfEdges: [], eventLogMissing: false,
  };

  let entries: string[];
  try {
    entries = readdirSync(root).sort();
  } catch (error) {
    report.failed.push({ file: root, error: error instanceof Error ? error.message : String(error) });
    return report;
  }

  // The log first: every item's state depends on it, so a missing log is a
  // fact about the whole import and is reported as one rather than as 196
  // separate unknowns.
  let states = new Map<string, DerivedState>();
  const logPath = join(root, EVENT_LOG_FILE);
  if (existsSync(logPath)) {
    const log = parseEreignisLog(readFileSync(logPath, 'utf8'));
    states = deriveStates(log.events);
    report.malformed = log.malformed;
    report.unknownKinds = log.unknownKinds;
  } else {
    report.eventLogMissing = true;
  }

  const memorySessionId = options.dryRun
    ? 'dry-run'
    : store.getOrCreateManualSession(options.project);

  for (const entry of entries) {
    const absolutePath = join(root, entry);
    try {
      if (statSync(absolutePath).isDirectory()) continue;
      if (!isMarkdown(entry)) {
        report.skipped.push({ file: entry, reason: 'not markdown' });
        continue;
      }

      const parsed = parseVorgang(readFileSync(absolutePath, 'utf8'));

      // No id: an overview, a readme, a correction note. Recognised by the
      // missing id rather than by filename, so renaming one does not turn it
      // into a work item.
      if (!parsed.id || !VORGANG_ID_RE.test(parsed.id)) {
        report.skipped.push({ file: entry, reason: 'no work-item id in frontmatter' });
        continue;
      }

      const derived = states.get(parsed.id);

      if (options.dryRun) {
        report.imported.push({
          id: -1, vorgangId: parsed.id, titel: parsed.titel,
          sourcePath: absolutePath, sourceLine: parsed.bodyLine,
          state: derived?.state ?? 'unbekannt', edges: 0,
        });
        continue;
      }

      const result = store.storeObservation(
        memorySessionId,
        options.project,
        {
          // Not 'decision': a work item is the thing a decision is carried out
          // in, and conflating the two would make "what did we decide" return
          // open tasks. 'change' is the closest of the fixed set; the item is
          // told apart from a record by its `subject` and its metadata kind,
          // not by this field.
          type: 'change',
          title: `${parsed.id} — ${parsed.titel}`,
          subtitle: subtitleForVorgang(parsed, derived),
          facts: [],
          narrative: renderVorgang(parsed),
          concepts: [],
          files_read: [],
          files_modified: [],
          source_kind: 'curated',
          source_path: absolutePath,
          source_line: parsed.bodyLine,
          subject: parsed.id,
          last_verified_at: options.nowEpoch ?? null,
          metadata: JSON.stringify({
            kind: 'vorgang',
            vorgang_id: parsed.id,
            entscheidet: parsed.entscheidet,
            erstellt: parsed.erstellt,
            herkunft: parsed.herkunft,
            // Stamped with its origin so the value can be re-checked against
            // the log rather than believed.
            state: derived?.state ?? 'unbekannt',
            state_since: derived?.since ?? null,
            state_from_log_line: derived?.line ?? null,
            event_count: derived?.eventCount ?? 0,
            fields: parsed.fields.map(f => ({ name: f.name, value: f.value, line: f.line })),
          }),
        },
        0,
        0,
        options.nowEpoch,
      );

      // Declared relations. These are FIELDS, not prose — no lexicon, no
      // guessing, certainty 'sicher' because the corpus wrote them as data.
      const edges: Array<{ from: string; to: string; relation: string; certainty: string; sourceLine: number; rawText?: string | null }> = [];
      const declare = (target: string | null, relation: string, fieldName: string) => {
        if (!target || !VORGANG_ID_RE.test(target)) return;
        if (target === parsed.id) {
          report.selfEdges.push({
            vorgang: parsed.id!, field: fieldName,
            sourcePath: absolutePath,
            sourceLine: parsed.fields.find(f => f.name === fieldName)?.line ?? parsed.frontmatterLine,
          });
          return;
        }
        edges.push({
          from: parsed.id!, to: target, relation, certainty: 'sicher',
          sourceLine: parsed.fields.find(f => f.name === fieldName)?.line ?? parsed.frontmatterLine,
          rawText: `${fieldName}: ${target}`,
        });
      };
      declare(parsed.schliesst, 'closes', 'schliesst');
      declare(parsed.haengtAn, 'depends_on', 'haengt_an');

      let edgeCount = 0;
      if (store.replaceEdgesForSource) {
        store.replaceEdgesForSource(options.project, absolutePath, edges, options.nowEpoch);
        edgeCount = edges.length;
      }

      report.imported.push({
        id: result.id, vorgangId: parsed.id, titel: parsed.titel,
        sourcePath: absolutePath, sourceLine: parsed.bodyLine,
        state: derived?.state ?? 'unbekannt', edges: edgeCount,
      });
    } catch (error) {
      report.failed.push({ file: entry, error: error instanceof Error ? error.message : String(error) });
    }
  }

  logger.info('DB', 'Curated work-item import finished', {
    directory: root,
    project: options.project,
    imported: report.imported.length,
    skipped: report.skipped.length,
    failed: report.failed.length,
    malformedLogLines: report.malformed.length,
    unknownKinds: report.unknownKinds.length,
    selfEdges: report.selfEdges.length,
    eventLogMissing: report.eventLogMissing,
    dryRun: options.dryRun === true,
  });

  return report;
}
