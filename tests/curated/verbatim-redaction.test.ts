import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { importVorgaengeDirectory, EVENT_LOG_FILE } from '../../src/services/curated/vorgang-importer.js';
import { verifyMigration } from '../../src/services/curated/migration-verify.js';
import { redactSecrets } from '../../src/services/redaction/redact-secrets.js';

// The failure this file pins down: the on-write secret redaction ran over
// curated content, and the entropy backstop — deliberately over-eager, "false
// positives are acceptable" where readability is the only price — masked
// structured metadata tokens like `aus=DURCHGANG-BEFUNDE.md#s1-5` as
// «redacted:HIGH_ENTROPY». That token is SHORTER than the original, so the
// stored event log stopped matching the file byte for byte, and
// `curated:verify` reported the corpus INCOMPLETE forever (re-importing
// re-masked the same tokens). Curated content never reaches a provider, so the
// write-path guard bought nothing here and cost the verbatim guarantee the
// whole curated design rests on. It is now skipped for `source_kind='curated'`.
//
// The existing durability test could not catch this: its fixtures carry no
// entropy-triggering token, so raw == redacted and the bug is invisible in it.

const PROJECT = 'steuerstand';
const LF = String.fromCharCode(10);

// A filename with a kebab-case stem and a section anchor. This is ordinary
// corpus metadata, not a secret — but it clears the entropy backstop.
const METADATA_TOKEN = 'aus=DURCHGANG-BEFUNDE.md#s1-5';

let dir: string;
let store: SessionStore;

function writeItem(id: string): void {
  writeFileSync(join(dir, `${id.toLowerCase()}.md`), [
    '---',
    `id: ${id}`,
    `titel: "Ablage ordnen"`,
    'entscheidet: "offen"',
    'erstellt: "2026-08-01"',
    'herkunft: "Prüfstand"',
    '---',
    '',
    'Belege nach Kalenderjahr ablegen.',
    '',
  ].join(LF), 'utf8');
}

function writeLog(lines: string[]): void {
  writeFileSync(join(dir, EVENT_LOG_FILE), lines.join(LF) + LF, 'utf8');
}

// Line 2 carries the metadata token that the entropy backstop used to mask.
const LOG_LINES = [
  '# Ereignisse der Vorgänge, append-only',
  `2026-08-11 | eroeffnet | V-0001 | entscheidet=x | ${METADATA_TOKEN}`,
  '2026-08-12 | wartet | V-0001 | grund=Antwort steht aus',
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'keepmind-verbatim-'));
  store = new SessionStore(':memory:');
  writeItem('V-0001');
  writeLog(LOG_LINES);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function logRow(): { narrative: string | null } | undefined {
  return store.db.prepare(`
    SELECT narrative FROM observations
     WHERE project = ? AND source_kind = 'curated'
       AND json_extract(metadata, '$.kind') = 'ereignis-log'
       AND valid_to IS NULL
  `).get(PROJECT) as never;
}

describe('the metadata token really does trip the entropy backstop', () => {
  // Guards the premise: if this ever stops firing, the regression tests below
  // would pass for the wrong reason (nothing to redact) and quietly stop
  // testing anything.
  it('would be masked by the raw detector', () => {
    const masked = redactSecrets(METADATA_TOKEN, { entropySweep: true, entropyThreshold: 4.0 });
    expect(masked).toContain('«redacted:HIGH_ENTROPY»');
    expect(masked).not.toContain('DURCHGANG-BEFUNDE');
  });
});

describe('curated content is stored verbatim, not redacted', () => {
  it('stores the event log byte for byte even with a metadata token in it', () => {
    const report = importVorgaengeDirectory(store as never, dir, { project: PROJECT });

    expect(report.eventLogStored).toBe(true);
    const narrative = logRow()!.narrative!;
    expect(narrative).toBe(LOG_LINES.join(LF));
    expect(narrative).toContain(METADATA_TOKEN);
    expect(narrative).not.toContain('redacted:');
  });

  it('keeps each item\'s raw event line verbatim in its metadata', () => {
    importVorgaengeDirectory(store as never, dir, { project: PROJECT });

    // refreshCuratedDerived rewrites this metadata after the insert; it must
    // not re-mask what the insert left verbatim.
    const meta = JSON.parse(store.getCuratedRecord(PROJECT, 'V-0001')!.metadata!);
    const raws = meta.events.map((e: { raw: string }) => e.raw);
    expect(raws[0]).toBe(`2026-08-11 | eroeffnet | V-0001 | entscheidet=x | ${METADATA_TOKEN}`);
    expect(JSON.stringify(meta)).not.toContain('redacted:');
  });

  it('lets curated:verify report the event log complete', () => {
    importVorgaengeDirectory(store as never, dir, { project: PROJECT });
    const report = verifyMigration(store.db as never, PROJECT, [{ path: dir, kind: 'vorgaenge' }]);

    expect(report.eventLogs).toHaveLength(1);
    expect(report.eventLogs[0].stored).toBe(true);
    expect(report.eventLogs[0].mismatch).toBeUndefined();
    expect(report.complete).toBe(true);
  });

  it('is fixed by a re-import — a run over an already-imported corpus stays complete', () => {
    importVorgaengeDirectory(store as never, dir, { project: PROJECT });
    importVorgaengeDirectory(store as never, dir, { project: PROJECT });

    const report = verifyMigration(store.db as never, PROJECT, [{ path: dir, kind: 'vorgaenge' }]);
    expect(report.eventLogs[0].stored).toBe(true);
    expect(report.complete).toBe(true);
    // Exactly one active log row; nothing stacked.
    const active = store.db.prepare(`
      SELECT COUNT(*) AS n FROM observations
       WHERE project = ? AND json_extract(metadata, '$.kind') = 'ereignis-log' AND valid_to IS NULL
    `).get(PROJECT) as { n: number };
    expect(active.n).toBe(1);
  });
});

describe('the regression guard: real secrets in OBSERVED content are still redacted', () => {
  // The bypass is keyed on source_kind, so ordinary observations — which DO
  // reach a provider — must still be scrubbed on write. AKIAIOSFODNN7EXAMPLE is
  // AWS's own documented example key.
  it('masks an AWS key and a high-entropy token in a non-curated observation', () => {
    const session = store.getOrCreateManualSession(PROJECT);
    const secret = 'AKIAIOSFODNN7EXAMPLE';
    const opaque = 'Zx9Qw2Lp7Rk4Tn8Vb3Yc6Mf1'; // long, mixed-class, high entropy
    const stored = store.storeObservation(session, PROJECT, {
      type: 'change',
      title: 'deploy notes',
      subtitle: null,
      facts: [],
      narrative: `key ${secret} token ${opaque}`,
      concepts: [],
      files_read: [],
      files_modified: [],
      // no source_kind: an ordinary observed row
    });

    const row = store.db.prepare('SELECT narrative FROM observations WHERE id = ?')
      .get(stored.id) as { narrative: string };
    expect(row.narrative).not.toContain(secret);
    expect(row.narrative).not.toContain(opaque);
    expect(row.narrative).toContain('«redacted:AWS_KEY»');
  });

  // Same secret, but on a curated row: verbatim wins deliberately. The row is
  // the user's own hand-written archive, on the user's own disk, and it never
  // reaches a provider; if it is ever sent as prompt context, the OUTBOUND
  // redaction in src/sdk/prompts.ts guards that copy instead.
  it('leaves a secret in curated content intact — verbatim is the point', () => {
    const session = store.getOrCreateManualSession(PROJECT);
    const secret = 'AKIAIOSFODNN7EXAMPLE';
    const stored = store.storeObservation(session, PROJECT, {
      type: 'change',
      title: 'V-0009 — Beispielkonfiguration',
      subtitle: null,
      facts: [],
      narrative: `Beispielwert: ${secret}`,
      concepts: [],
      files_read: [],
      files_modified: [],
      source_kind: 'curated',
    });

    const row = store.db.prepare('SELECT narrative FROM observations WHERE id = ?')
      .get(stored.id) as { narrative: string };
    expect(row.narrative).toBe(`Beispielwert: ${secret}`);
    expect(row.narrative).not.toContain('redacted:');
  });
});
