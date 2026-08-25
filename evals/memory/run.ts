// SPDX-License-Identifier: Apache-2.0
//
// Memory-quality evaluation — does search return the record that answers the
// question?
//
// `evals/` held nothing but SWE-bench, which measures whether a coding agent
// can patch a repository. Nothing measured the thing this project actually
// sells: that the right record comes back. Every change to search, ranking or
// injection was therefore argued rather than shown.
//
// WHAT THIS MEASURES, AND WHAT IT DOES NOT. It runs the real search code
// against the real database — not a fixture, not a reimplementation. That is
// the point, and it is also the limitation: the numbers describe the corpus
// currently in the database, so a run is only comparable to another run over
// the same corpus. The header prints the corpus size for exactly that reason.
//
// The question set is paraphrase-only, on purpose. A question quoting a
// record's own title measures string equality and reports it as retrieval
// quality — it cannot fail, so it cannot inform. Every question here restates
// the content in different words, which is how the questions actually arrive.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildVerbatimCases, rankOf, summariseVerbatim, type VerbatimCase, type VerbatimSummary } from './verbatim.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Top-k depth every metric is computed at. */
const K = 10;

interface Question {
  id: string;
  /** A = work-item id to the decision that closes it, K = the bare id alone. */
  set: 'A' | 'K' | 'B' | 'C' | 'D';
  frage: string;
  /** Second spelling of the same question — set D only. */
  variante?: string;
  /** Record numbers that answer it. Absent for set D. */
  gold?: string[];
  herkunft: string;
}

interface ChannelResult {
  /** Record numbers in rank order, best first. */
  records: string[];
  /** Raw row count the channel returned, including non-record rows. */
  returned: number;
}

interface QuestionOutcome {
  id: string;
  set: string;
  hit1: boolean;
  hit10: boolean;
  /** Reciprocal rank of the first gold record, 0 when absent. */
  rr: number;
  /** Set D only: agreement between the two spellings. */
  agreement?: number;
  counts?: [number, number];
}

interface ChannelReport {
  available: boolean;
  reason?: string;
  outcomes: QuestionOutcome[];
}

/**
 * Pull the record number out of a stored title (`0047 — Ein Zurück-Weg …`).
 *
 * Rows that carry no number are not records — observed work from the ordinary
 * capture path shares the database. They are counted in `returned` but never
 * score, which is deliberate: that noise is present when a real question is
 * asked, so hiding it here would flatter every number.
 */
function recordNumber(title: unknown): string | null {
  if (typeof title !== 'string') return null;
  const m = title.match(/^\s*(\d{3,4})\s*[—–-]/);
  return m ? m[1] : null;
}

function loadQuestions(): Question[] {
  const raw = readFileSync(join(HERE, 'questions.jsonl'), 'utf8');
  const out: Question[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed);
    if (parsed._comment) continue;
    out.push(parsed as Question);
  }
  return out;
}

function score(question: Question, result: ChannelResult): QuestionOutcome {
  const gold = new Set(question.gold ?? []);
  const ranked = result.records.slice(0, K);

  let rr = 0;
  for (let i = 0; i < ranked.length; i++) {
    if (gold.has(ranked[i])) { rr = 1 / (i + 1); break; }
  }

  return {
    id: question.id,
    set: question.set,
    hit1: ranked.length > 0 && gold.has(ranked[0]),
    hit10: rr > 0,
    rr,
  };
}

/**
 * Set D scores agreement, not relevance: the same question in two German
 * spellings must return the same list. Jaccard over the top-k record sets, so
 * a channel that finds nothing for BOTH spellings scores 0 rather than a
 * vacuous 1 — "equally blind" is not "equally good".
 */
function scoreSpelling(question: Question, a: ChannelResult, b: ChannelResult): QuestionOutcome {
  const setA = new Set(a.records.slice(0, K));
  const setB = new Set(b.records.slice(0, K));
  let intersection = 0;
  for (const x of setA) if (setB.has(x)) intersection++;
  const union = setA.size + setB.size - intersection;
  return {
    id: question.id,
    set: 'D',
    hit1: false,
    hit10: false,
    rr: 0,
    agreement: union === 0 ? 0 : intersection / union,
    counts: [a.records.length, b.records.length],
  };
}

async function runFtsChannel(questions: Question[], project: string): Promise<ChannelReport> {
  const { SessionSearch } = await import('../../src/services/sqlite/SessionSearch.js');
  const search = new SessionSearch();

  const query = (text: string): ChannelResult => {
    try {
      const rows = search.searchObservations(text, { project, limit: K }) as Array<{ title?: string }>;
      return {
        records: rows.map(r => recordNumber(r.title)).filter((x): x is string => x !== null),
        returned: rows.length,
      };
    } catch {
      // A malformed FTS expression is a result too — an empty one. Throwing
      // here would hide the very failure mode the German query fix addresses.
      return { records: [], returned: 0 };
    }
  };

  const outcomes: QuestionOutcome[] = [];
  for (const q of questions) {
    outcomes.push(q.set === 'D' && q.variante
      ? scoreSpelling(q, query(q.frage), query(q.variante))
      : score(q, query(q.frage)));
  }
  return { available: true, outcomes };
}

async function runVectorChannel(questions: Question[], project: string): Promise<ChannelReport> {
  let manager: { queryKnn: (q: string, n: number, f: Record<string, string>) => Promise<{ ids: number[] }> };
  let titleOf: (id: number) => string | null;

  try {
    const { SqliteVecManager } = await import('../../src/services/vector/SqliteVecManager.js');
    const { SessionStore } = await import('../../src/services/sqlite/SessionStore.js');
    manager = SqliteVecManager.instance() as never;
    const store = new SessionStore() as unknown as { db: { prepare: (s: string) => { get: (id: number) => { title?: string } | undefined } } };
    const stmt = store.db.prepare('SELECT title FROM observations WHERE id = ?');
    titleOf = (id: number) => stmt.get(id)?.title ?? null;
  } catch (error) {
    // Reported, never silently skipped: a channel that vanishes without saying
    // so turns "the embedder failed to load" into "the vector path scores 0".
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
      outcomes: [],
    };
  }

  const query = async (text: string): Promise<ChannelResult> => {
    const { ids } = await manager.queryKnn(text, K, { project, doc_type: 'observation' });
    return {
      records: ids.map(id => recordNumber(titleOf(id))).filter((x): x is string => x !== null),
      returned: ids.length,
    };
  };

  const outcomes: QuestionOutcome[] = [];
  try {
    for (const q of questions) {
      outcomes.push(q.set === 'D' && q.variante
        ? scoreSpelling(q, await query(q.frage), await query(q.variante))
        : score(q, await query(q.frage)));
    }
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
      outcomes,
    };
  }
  return { available: true, outcomes };
}

/**
 * The channel that measures what a person actually gets.
 *
 * The other two call the search classes directly, which is precise and was not
 * enough: a ranking fault lived between `SessionSearch` and the answer for as
 * long as this file existed without this channel. Hydration by id threw the
 * fused ranking away, so the question "Lizenz nennen ist nicht mitliefern" —
 * nearly the title of record 0081 — returned the five most recently imported
 * records. Both direct channels scored it fine, because neither of them goes
 * through the code that broke it.
 *
 * So this one goes over HTTP to the running worker, the same route the MCP
 * search tools use. It needs a running worker, and says so when there is none
 * rather than scoring zero.
 */
async function runWorkerChannel(questions: Question[], project: string): Promise<ChannelReport> {
  let base: string;
  try {
    const port = readFileSync(join(homedir(), '.keepmind', 'worker.port'), 'utf8').trim();
    base = `http://127.0.0.1:${port}`;
  } catch (error) {
    return { available: false, reason: `no worker.port (${error instanceof Error ? error.message : error})`, outcomes: [] };
  }

  const query = async (text: string): Promise<ChannelResult> => {
    const url = `${base}/api/search?query=${encodeURIComponent(text)}&project=${encodeURIComponent(project)}&limit=${K}&format=json`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const body = await response.json() as { observations?: Array<{ title?: string }> };
    const rows = body.observations ?? [];
    return {
      records: rows.map(r => recordNumber(r.title)).filter((x): x is string => x !== null),
      returned: rows.length,
    };
  };

  const outcomes: QuestionOutcome[] = [];
  try {
    for (const q of questions) {
      outcomes.push(q.set === 'D' && q.variante
        ? scoreSpelling(q, await query(q.frage), await query(q.variante))
        : score(q, await query(q.frage)));
    }
  } catch (error) {
    return {
      available: false,
      reason: `worker unreachable — ${error instanceof Error ? error.message : error}`,
      outcomes,
    };
  }
  return { available: true, outcomes };
}

/**
 * Set E on the worker channel, and ONLY on the worker channel.
 *
 * The exact-wording promotion lives in `SearchManager`, between the fused
 * ranking and the answer — the same place the ranking fault lived that this
 * harness gained a worker channel to catch. Running set E against
 * `SessionSearch` or the vector index directly would measure the absence of a
 * mechanism those paths never had, and report it as a score.
 */
async function runVerbatimSet(cases: VerbatimCase[], project: string): Promise<{ available: boolean; reason?: string; summary: VerbatimSummary | null; ranks: number[] }> {
  if (cases.length === 0) {
    return { available: false, reason: 'no record in this project has quotable prose', summary: null, ranks: [] };
  }

  let base: string;
  try {
    const port = readFileSync(join(homedir(), '.keepmind', 'worker.port'), 'utf8').trim();
    base = `http://127.0.0.1:${port}`;
  } catch (error) {
    return { available: false, reason: `no worker.port (${error instanceof Error ? error.message : error})`, summary: null, ranks: [] };
  }

  const ranks: number[] = [];
  try {
    for (const item of cases) {
      const url = `${base}/api/search?query=${encodeURIComponent(item.sentence)}&project=${encodeURIComponent(project)}&limit=${K}&format=json`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const body = await response.json() as { observations?: Array<{ id?: number }> };
      const ids = (body.observations ?? []).map(row => Number(row.id)).filter(Number.isFinite);
      ranks.push(rankOf(item.id, ids));
    }
  } catch (error) {
    return { available: false, reason: `worker unreachable — ${error instanceof Error ? error.message : error}`, summary: null, ranks };
  }
  return { available: true, summary: summariseVerbatim(ranks), ranks };
}

function summarise(outcomes: QuestionOutcome[], set: string) {
  const rows = outcomes.filter(o => o.set === set);
  if (rows.length === 0) return null;
  if (set === 'D') {
    const agreement = rows.reduce((s, r) => s + (r.agreement ?? 0), 0) / rows.length;
    const identical = rows.filter(r => (r.agreement ?? 0) === 1).length;
    return { n: rows.length, agreement, identical };
  }
  return {
    n: rows.length,
    hit1: rows.filter(r => r.hit1).length / rows.length,
    hit10: rows.filter(r => r.hit10).length / rows.length,
    mrr: rows.reduce((s, r) => s + r.rr, 0) / rows.length,
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(0)}%`.padStart(4);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    if (i >= 0 && args[i + 1]) return args[i + 1];
    const inline = args.find(a => a.startsWith(`--${name}=`));
    return inline?.slice(name.length + 3);
  };

  const project = flag('project') ?? 'steuerstand';
  const asJson = args.includes('--json');
  const out = flag('out');
  const compare = flag('compare');
  const skipVector = args.includes('--no-vector');
  const skipWorker = args.includes('--no-worker');

  const questions = loadQuestions();

  const { SessionStore } = await import('../../src/services/sqlite/SessionStore.js');
  const store = new SessionStore() as unknown as {
    db: {
      prepare: (s: string) => {
        get: (p: string) => { c: number };
        all: (p: string) => Array<{ id: number; title: string | null; narrative: string | null }>;
      };
    };
  };
  const corpus = store.db
    .prepare("SELECT COUNT(*) c FROM observations WHERE source_kind = 'curated' AND project = ?")
    .get(project).c;

  // Set E quotes the corpus back at itself, so it is read from the corpus —
  // active revisions only, since an earlier wording is a different text and
  // asking for it would measure the revision machinery instead.
  const verbatimCases = buildVerbatimCases(
    store.db
      .prepare("SELECT id, title, narrative FROM observations WHERE source_kind = 'curated' AND project = ? AND valid_to IS NULL AND narrative IS NOT NULL ORDER BY id")
      .all(project),
    25,
  );

  const fts = await runFtsChannel(questions, project);
  const vector = skipVector
    ? { available: false, reason: 'skipped via --no-vector', outcomes: [] }
    : await runVectorChannel(questions, project);
  const worker = skipWorker
    ? { available: false, reason: 'skipped via --no-worker', outcomes: [] }
    : await runWorkerChannel(questions, project);
  const verbatim = skipWorker
    ? { available: false, reason: 'skipped via --no-worker', summary: null, ranks: [] }
    : await runVerbatimSet(verbatimCases, project);

  const report = {
    project,
    corpus,
    questions: questions.length,
    k: K,
    channels: {
      fts: {
        available: fts.available,
        reason: fts.reason,
        A: summarise(fts.outcomes, 'A'),
        K: summarise(fts.outcomes, 'K'),
        B: summarise(fts.outcomes, 'B'),
        C: summarise(fts.outcomes, 'C'),
        D: summarise(fts.outcomes, 'D'),
      },
      vector: {
        available: vector.available,
        reason: vector.reason,
        A: summarise(vector.outcomes, 'A'),
        K: summarise(vector.outcomes, 'K'),
        B: summarise(vector.outcomes, 'B'),
        C: summarise(vector.outcomes, 'C'),
        D: summarise(vector.outcomes, 'D'),
      },
      worker: {
        available: worker.available,
        reason: worker.reason,
        A: summarise(worker.outcomes, 'A'),
        K: summarise(worker.outcomes, 'K'),
        B: summarise(worker.outcomes, 'B'),
        C: summarise(worker.outcomes, 'C'),
        D: summarise(worker.outcomes, 'D'),
        E: verbatim.summary,
      },
    },
    verbatim: {
      available: verbatim.available,
      reason: verbatim.reason,
      cases: verbatimCases.map((item, index) => ({ id: item.id, title: item.title, sentence: item.sentence, rank: verbatim.ranks[index] ?? 0 })),
    },
    perQuestion: { fts: fts.outcomes, vector: vector.outcomes, worker: worker.outcomes },
  };

  if (out) {
    writeFileSync(out, JSON.stringify(report, null, 2));
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(`\nMemory evaluation — project "${project}", ${corpus} curated record(s), ${questions.length} questions, k=${K}\n`);

  if (corpus === 0) {
    console.log('  No curated records in this project. Run `keepmind akten:import` first —');
    console.log('  every number below would otherwise be a measurement of an empty corpus.\n');
  }

  for (const [name, channel] of Object.entries(report.channels)) {
    if (!channel.available) {
      console.log(`  ${name.padEnd(7)} unavailable — ${channel.reason}`);
      continue;
    }
    const a = channel.A as { hit1: number; hit10: number; mrr: number; n: number } | null;
    const k = channel.K as { hit1: number; hit10: number; mrr: number; n: number } | null;
    const b = channel.B as { hit1: number; hit10: number; mrr: number; n: number } | null;
    const c = channel.C as { hit1: number; hit10: number; mrr: number; n: number } | null;
    const d = channel.D as { agreement: number; identical: number; n: number } | null;
    console.log(`  ${name}`);
    if (a) console.log(`    A  work item → decision   @1 ${pct(a.hit1)}   @10 ${pct(a.hit10)}   MRR ${a.mrr.toFixed(3)}   (n=${a.n})`);
    if (k) console.log(`    K  bare id alone          @1 ${pct(k.hit1)}   @10 ${pct(k.hit10)}   MRR ${k.mrr.toFixed(3)}   (n=${k.n})`);
    if (b) console.log(`    B  paraphrase → record     @1 ${pct(b.hit1)}   @10 ${pct(b.hit10)}   MRR ${b.mrr.toFixed(3)}   (n=${b.n})`);
    if (c) console.log(`    C  "what applies to X?"    @1 ${pct(c.hit1)}   @10 ${pct(c.hit10)}   MRR ${c.mrr.toFixed(3)}   (n=${c.n})`);
    if (d) console.log(`    D  spelling agreement      ${pct(d.agreement)}        identical ${d.identical}/${d.n}`);
    const e = (channel as { E?: VerbatimSummary | null }).E;
    if (e) console.log(`    E  verbatim wording        @1 ${pct(e.hit1)}   @10 ${pct(e.hit10)}   MRR ${e.mrr.toFixed(3)}   (n=${e.n})`);
    console.log('');
  }

  if (compare) {
    const before = JSON.parse(readFileSync(compare, 'utf8'));
    console.log(`  Compared to ${compare}:`);
    for (const channel of ['fts', 'vector', 'worker'] as const) {
      for (const set of ['B', 'C'] as const) {
        const now = (report.channels[channel] as never as Record<string, { hit10: number } | null>)[set];
        const then = before.channels?.[channel]?.[set];
        if (!now || !then) continue;
        const delta = now.hit10 - then.hit10;
        const sign = delta > 0 ? '+' : '';
        console.log(`    ${channel}/${set} @10  ${pct(then.hit10)} → ${pct(now.hit10)}  (${sign}${(delta * 100).toFixed(0)}pp)`);
      }
      const nowD = (report.channels[channel] as never as Record<string, { agreement: number } | null>).D;
      const thenD = before.channels?.[channel]?.D;
      if (nowD && thenD) {
        const delta = nowD.agreement - thenD.agreement;
        const sign = delta > 0 ? '+' : '';
        console.log(`    ${channel}/D  agree  ${pct(thenD.agreement)} → ${pct(nowD.agreement)}  (${sign}${(delta * 100).toFixed(0)}pp)`);
      }
    }
    console.log('');
  }

  // No pass/fail verdict. There is no threshold at which retrieval is "good",
  // and inventing one here would be the same mistake B8 forbids for ranking.
  // The number is the output; the judgement is the reader's.
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
