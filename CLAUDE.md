# keepmind: AI Development Instructions

keepmind is a Claude Code plugin providing persistent memory across sessions. It captures tool usage, compresses observations using the Claude Agent SDK, and injects relevant context into future sessions.

## Observer cost and safety invariants

Five properties were each paid for with a measured regression. Changing any of
them changes the cost or the safety of the system, not just its structure.

- **Redaction happens on the OUTBOUND path.** `src/sdk/prompts.ts` is the only
  place any provider builds a prompt, and every variable part of it goes through
  `src/services/redaction/outbound.ts` first. Before 3.4.0 redaction ran only on
  write to SQLite, so raw tool content — file contents, shell output, verbatim
  user prompts — reached the provider unredacted. Do not add a prompt-building
  path that bypasses `prompts.ts`, and do not move redaction back downstream.
  `tests/redaction/outbound.test.ts` fails if you do.
- **Compression is stateless.** Each compression is its own `query()` with no
  `resume`. The resumed conversation re-read its own history every turn: 91.7%
  of all tokens billed, growing 14k → 50k cache-read within one session. The
  fixed-size `buildStatelessContextBlock` replaces that history — keep it capped
  by BOTH count and characters.
- **The "is this worth recording?" decision is made before the model call.**
  `src/services/worker/observation-gate.ts` decides from the hook payload. It
  used to be the model's job, which meant paying a full turn to be told
  "nothing worth recording" — at least 65% of turns. Its governance heuristics
  are calibrated on software development, so the default profile is derived from
  `KEEPMIND_MODE`; a mode observing another domain falls back to `balanced`.
  Its text matcher is bilingual (DE/EN) for the same reason the embedder is.
- **Deterministic fields never come from the model.** `files_read`,
  `files_modified`, tool name and timestamp are derived in
  `src/sdk/deterministic-fields.ts` from the hook payload and overwrite whatever
  the model returned. The model only ever saw a truncated copy of the tool input.
- **The cost balance is written in one place and read in one place.** Written by
  `handleGeneratorExit` — the only point that runs on every non-quota session
  end, however it ended — into `metrics-<date>.jsonl`, never gated by a log
  level. Read by `npx keepmind metrics`, which divides sums by sums. Three
  variants of "measure it yourself" have each gone quiet or lied so far: an INFO
  line dropped at `WARN`; a record written at the end of a loop that aborts; and
  a documented `Measure-Object -Average` that counts `null` as zero and averages
  averages. A measurement that is assembled by hand gets assembled differently
  each time, and one that goes quiet when a setting is inconvenient gets
  believed. Bump `METRICS_SCHEMA_VERSION` when a field changes meaning —
  aggregation drops older records rather than mixing them.

### Curated entries: two ways in, one set of rules

Lasting entries — decisions, rules, findings — reach the store on two paths, and
both take the SAME write path: `SessionStore` directly, nothing enqueued. The
observation queue is the only thing in keepmind that calls a model, so "a
curated entry never reaches a provider" is a property of the code path, not a
promise. Two Proxy tests fail the moment either path reaches for anything else
(`tests/curated/akten-importer.test.ts`, `tests/curated/authoring.test.ts`).

**Curated content is stored VERBATIM — the on-write redaction is skipped for it.**
`storeObservation` masks secrets on write to keep an accidental credential out of
the LOCAL database, but that guard is skipped when `source_kind === 'curated'`,
and it must stay skipped. The reasoning is the paragraph above: a curated row
never reaches a provider, so the network is already protected without touching
the stored row (and if one is ever sent as prompt context, the OUTBOUND redaction
in `src/sdk/prompts.ts` still guards that copy). What the write-path guard would
cost here is exact: the entropy backstop over-redacts by design ("false-positives
are acceptable" where readability is the only price), so it masked structured
metadata like `aus=DURCHGANG-BEFUNDE.md#s1-5` as `«redacted:HIGH_ENTROPY»` — a
SHORTER string — and the stored event log stopped matching the file byte for
byte. `curated:verify` compares the stored log against the file AS TEXT, so a
single mask made it report the corpus INCOMPLETE forever (re-importing re-masked
the same tokens). The bypass covers the imported/authored corpus: file import,
`curated:add`, `curated:edit`, AND `refreshCuratedDerived` (which rewrites a work
item's metadata, where each event's raw log line lives under
`metadata.events[].raw`). Do NOT restore redaction on those paths —
`tests/curated/verbatim-redaction.test.ts` fails if you do.

The one curated write that STAYS redacted is a session **checkpoint**
(`storeCheckpoint`, `type='session-checkpoint'`). It is stored
`source_kind='curated'` for the reconciler skip and the verbatim injection, but
it has no verbatim CONTRACT — no source file, nothing byte-compares it — and it
is a summary OF a session, the one curated shape where a secret the session
touched could ride along. The gate is therefore `storeVerbatim = isCurated &&
type !== CHECKPOINT_TYPE`, kept separate from `isCurated` because the reconciler
skip still applies to EVERY curated row, checkpoints included
(`tests/sqlite/session-store-checkpoint.test.ts` asserts a checkpoint is
scrubbed).

- **From files** — `keepmind curated:import` / `akten:import`. Still the only
  way to take over an existing archive, and it must stay working: the one-time
  hand-over of `C:\Projekte\entscheidungen` + `…\vorgaenge` runs through it, and
  the files are only removed once `keepmind curated:verify` reports the corpus
  arrived complete (`src/services/curated/migration-verify.ts` compares records,
  declared relations and validity windows against the files).
- **Authored here** — `keepmind curated:add|edit|…` and the `curated_*` MCP
  tools, with no source file at any point.

`src/services/curated/authoring.ts` does NOT parse structured input into edges.
It RENDERS the caller's fields into the canonical record shape, reads that text
back with `parseAkte` + `extractEdges` — the file importer's own readers — and
refuses to store anything whose declared relations do not read back as declared.
There is therefore no second rule set that is merely *supposed* to agree with
the first. Do not add one: the relation lexicon, the negation guard, the
date/record disambiguation and the span rule were each paid for with a measured
failure.

**Edit-in-place means the RECORD is stable, not the row.** The record number is
the identity; a change writes a new revision and closes the previous one's
window. Exactly one revision per record has `valid_to IS NULL`, so every
existing read path sees one entry without knowing about revisions — and nothing
is deleted, which is the invariant the whole curated path rests on. Anything
that reads curated rows must collapse to the current revision the way
`aging.ts` and `supersession.ts` do, or it counts one record several times.

### Two namespaces, one lookup

The corpus holds decision records (`0138`, under `$.record_id`) and work items
(`V-0001`, under `$.vorgang_id`). The two keys are deliberate: a work item is
where a decision is carried out, and merging the namespaces makes "what did we
decide" answer with open tasks.

But every read path was written against `$.record_id` alone, so half the corpus
was addressable and half was not — `curated_get "V-0001"` answered "No record"
about 200 items the importer had just reported as imported.
`src/services/curated/record-key.ts` is now the ONE place that says how a
curated entry is addressed (`CURATED_ID_SQL`), and everything that filters
curated rows by number goes through it: `getCuratedRecord`,
`getCuratedRevisions`, `nextCuratedRecordId`, the revision-closing UPDATE,
`closeCuratedRecord`, `reopenCuratedRecord`, `supersession.ts`, `aging.ts`.
`migration-verify.ts` had already grown its own copy of the same COALESCE — that
is how one rule becomes two that are merely supposed to agree.

**The id is shared; the kind is not.** Every read returns `kind` (`akte` /
`vorgang`), derived from `metadata.kind` and falling back to the id's shape.
Reports that are ABOUT decisions filter on that — `aging.ts` keeps decisions
only, and by id shape rather than by which key the number sits under, because an
entry authored here carries its number under the decision key whatever it is.

**Exactly one revision may be active, and the file importers have to say so
themselves.** Direct authoring goes through `storeCuratedRecord`, which closes
the previous revision as part of the write; the file importers call
`storeObservation`, which does not. Measured: editing a record's file and
re-importing left TWO rows with `valid_to IS NULL`. Reads happened to survive it
(`getCuratedRecord` takes the newest), the vector index did not — both rows are
embedded, so the record answered twice and the older wording won as often as the
ranker preferred it. Both importers now call `settleCuratedRevisions` (by
entry number) or `closeOtherCuratedRowsForSource` (for the event log, which
carries no number). Nothing is deleted: the previous revision keeps its text and
gets its window closed.

**"Exactly one" is a floor as well as a ceiling, and closing alone gives only
the ceiling.** De-duplication lands an unchanged file back on its own row —
INCLUDING a row an earlier edit already closed. Closing "every other revision"
then leaves NONE active. Measured on `import a file → edit the record here →
import again`: `getCuratedRecord` answered null about a record whose two
revisions both sat in the table, readable, nothing deleted and nothing logged.
The same sequence without any authoring does it too (a file's wording changing
A → B → A), which is why the fix is not about authoring: `settleCuratedRevisions`
RE-OPENS the row it was told to keep before it closes the rest, in that order —
the other order leaves a window with no active revision, and a failure inside it
leaves the entry unreachable. `storeCuratedRecord` documents this trap and has
always handled it; the file path simply never had the second half. On the live
corpus the bug was latent, not realised: no entry there has more than one
revision yet, so no de-duplication onto a closed row had happened.

**An authored revision is not a stale one.** Re-opening alone would have turned
the vanishing into a silent revert — the file's older wording back in force over
what a person wrote HERE. So when the active revision carries an authored source
path (`keepmind://curated/…`), the import stores its own row, closes it, leaves
the authored one current, and REPORTS the collision (`authoredConflicts`, per
file and record number, printed by `curated:import`). Two independent claims on
one number is not something an importer can settle, and the corpus is
mid-hand-over exactly when it happens — a run that reads as clean while two
sources disagree about what a record says is the failure, not the collision.

`AUTHORED_SOURCE_SCHEME` therefore lives in `record-key.ts`, next to
`CURATED_ID_SQL`: one says how an entry is addressed, the other where it came
from, and both are now read by the store as well as the curated services.
Note that the importers declare these store methods as OPTIONAL (so the Proxy
tests can omit them) — renaming one without updating the call sites disables the
settling SILENTLY rather than failing to compile.

**Derived fields are refreshed even when the row is reused.**
`storeObservation` de-duplicates on the WORDING (session, title, narrative),
which is right for a file that has not changed — but a work item's state comes
from `EREIGNISSE.log`, and the log moves without the item's own file changing.
Measured: a log entry moving an item to `wartet` produced an import that
reported `wartet` while the stored row kept saying `unbekannt`, and every later
read believed the row. `refreshCuratedDerived` writes state and subtitle back
after the insert; the title and narrative are never touched there.

**The event log survives its file.** `EREIGNISSE.log` is a SOURCE, and the rule
for sources is that their wording outlives them. It is stored twice over, for
two different questions: verbatim as ONE row per log file (`kind:
'ereignis-log'`, carrying no entry number, so it can never answer as an item),
and per item as `metadata.events` — each event with its raw line, next to the
state derived from it. Neutral events are kept too: the history is not filtered
down to what moved the state. `verifyMigration` compares the stored log against
the file AS TEXT — not as a count of parsed events, because the whole point is
that a line the reader misunderstands is still readable afterwards — and a log
that is on disk but not in the store makes the result INCOMPLETE. Before this,
only the derived state was kept, so a corpus could pass verify while the history
of how every work item got there lived in one file nobody had been told to keep.

Events naming an item the directory holds no file for are reported, never
dropped; their wording is in the stored log regardless.

**Work items cannot be authored yet, and the refusal is explicit.**
`authorCuratedRecord` rejects a `V-` id up front. The canonical heading the
renderer produces (`# V-0001 — …`) does not read back as an id — the
decision-record reader recognises digits only — so the round-trip guard would
otherwise fail three layers down with `reads back as id "null"`. Widening that
reader is NOT a small change: which headings carry a number decides which files
count as control files, and "a file without a row of its own cannot retire a
record" rests on exactly that. A `V-` number remains valid as the TARGET of a
relation from a decision record.

### A relation can be read from both ends

An edge is declared once, by one record, and stored once in that direction —
correctly, because only one end wrote anything down and inventing the other end
is what the edge reader exists to refuse. But nothing could ask the far end.
`0090` was superseded by `0138`, `decision_edges` had carried an `idx_edges_to`
index for it since the table was created, and every read path answered `0090`
without mentioning it. That is the failure the supersession machinery exists to
prevent, one layer up: a retired record that does not say it was retired reads
as current.

`curatedRelationsOf` (`curated/relations.ts`) is the one place that answers it,
and `curated_get` returns it unconditionally — the direction a reader cannot
know to ask for is the INCOMING one, so a flag would put the burden of suspicion
back on them.

- **The voice is part of the relation, not of a view.** `RELATION_PHRASES` in
  the lexicon says how each relation reads from either end (`supersedes` /
  `superseded by`). Reaching an incoming edge and printing the stored relation
  name points half the corpus backwards, and a backwards supersession makes a
  retired record look current — the same wrong answer, arrived at from the other
  side.
- **A relation is a fact; a declaration is evidence for it.** They are not the
  same count: on the live corpus 228 stored edges are 126 relations, because a
  record saying "abgelöst durch 0137" and an index saying "löst 0064 ab" are two
  declarations of one supersession. They collapse into one relation carrying
  `declaredIn`, at the STRONGEST certainty — which is what the store already
  does, since `applySupersessions` retires the target as soon as ONE edge row is
  `sicher`. Reporting the weakest would call a retirement that demonstrably
  happened merely supposed.
- **The counterpart is resolved through `getCuratedRecord`.** `supersedes 0138`
  is not usable on its own; the title, the kind and whether the counterpart is
  itself still current all decide what the relation is worth. The lookup goes
  through that method rather than a SQL join because that is where "collapse a
  record's revisions to the current one" lives, and a second copy is how a record
  starts being counted twice.
- **A retired entry is not a missing one.** `curated_get` filtered to the active
  revision and answered "No record 0064" about a record that exists, still reads,
  and was retired for a recorded reason — and the caller's next move on that
  answer is to write a new entry under a number already taken. It now returns the
  entry with `status: 'retired'`. This matters most here because `supersedes`
  edges point at retired entries BY CONSTRUCTION: a relation graph you cannot
  follow to the far end is half built.
- **A file with no record number of its own still may not retire a record.**
  Control-file supersessions stay withheld (`allowSupersessions: false`).
  A `vermutet` supersession from such a file in the live store predates that
  rule and is not evidence against it.

### keepmind runs on machines that do not have the curated corpus

The corpus is developed on one machine and used on another, and it does not
necessarily follow: the source directories may live on a drive that is not
mounted, may not exist yet, or may belong to a different computer entirely.
Three relationships, and the code could only tell two of them apart — a
development machine holding 333 fully indexed records whose source directory had
been deleted reported two REQUIRED doctor failures and put
"NOT in the semantic index — semantic search cannot see these records" at the
top of every session, about records semantic search could see in full.

`CuratedPresence` (`health.ts`) is the one place that decides which machine this
is, and everything downstream hangs on it rather than on the import state — an
import state only ever describes the last RUN.

- **`present`** — every configured source is readable. Strict, unchanged: a
  stopped worker fails, an import that stopped running fails. A PARTLY reachable
  set counts as present too, deliberately: the import refuses to run on a
  partial set, so the records the missing directory holds would go stale with
  nobody told. That is the outage, not the portability question.
- **`detached`** — records held, sources unreachable. Warn, never fail. Nothing
  refreshes them and nothing needs to; they stay searchable and stay true as of
  the last import. The session start says so in ONE line and not under the
  out-of-step banner, because that banner ends in "fix it with `curated:import`"
  and there is nothing here to import.
- **`absent`** — no sources, no records. Silence: the doctor group skips and the
  session start says nothing. A settings file that travels ahead of the corpus
  must not turn every other machine red.
- **`unknown`** — sources missing and the store could not be counted. Strict,
  because the outage cannot be ruled out. "Cannot tell" must never resolve to
  "nothing here".

Two supporting rules:

- **A run that did not start learned nothing about the index.** The
  missing-sources skip stamps `indexed: 'unchanged'`, not `false`. Asserting
  false wiped a previous successful run's verified flag, which is how the false
  sentence above came to be printed at all.
- **What the stamp knows is what the last run DID.** `state.indexed` was
  rendered as a claim about the store's contents; those are different claims and
  only the first is knowable from a state file. A genuinely incomplete index
  still reports itself through `failure`, in the words
  `ensureObservationsIndexed` used ("N of M curated row(s) have no vector").
- **A corpus that arrives later is picked up.** The startup check has already
  run by then, so `CuratedAutoImport` watches the nearest existing ancestor of
  each missing source — non-recursive, and firing only for the NAME it is
  waiting for. Without that name filter every unrelated file dropped beside it
  would run a freshness check and rewrite the state file, three seconds at a
  time, forever; the ancestor of a real source was `~/Desktop`.

### A search can ask for the wording, and says which hits are the wording

Memory holds two kinds of text and answers from both. An observation is a
model's summary of a session; a lasting entry is what a person wrote, stored
verbatim, and is answered from as if it were current. Presenting them alike
hands the reader the second claim about the first kind of text — measured: a
search for "Wortlaut" returned record `V-0110` under the heading `General`,
spelled exactly like the summaries around it, and no parameter could have
excluded them.

- **The origin clause has ONE spelling** — `src/services/sqlite/source-kind.ts`.
  `ObservationCompiler`, `SessionSearch.buildFilterClause` and
  `SessionStore.getObservationsByIds` all go through it. The load-bearing part
  is the NULL folding: rows written before the curated path existed carry
  `source_kind IS NULL`, so a plain `= 'observed'` drops the entire pre-3.x
  corpus and the answer still reads as an ordinary, slightly short result.
  `normalizeSourceKind` widens an unrecognised value to `all` for the same
  reason — an over-narrow result is indistinguishable from "nothing was found".
- **`sourceKind: 'curated'` excludes session summaries and user prompts
  entirely.** Neither has an origin — a summary is a model's account and a
  prompt is a transcript line — so the filter is not a WHERE clause for them but
  a decision not to search those tables at all.
- **The semantic leg is filtered BEFORE fusion, not only at hydration.**
  `vec_items` has no `source_kind` column, so its candidates arrive unfiltered.
  Hydration filters them, which makes the result correct — but `rrfFuse` caps
  its output at 100 and weights the semantic leg at 0.75, so filtering only
  afterwards spends the cap on rows about to be discarded. Measured against the
  live corpus: `sourceKind=curated` with no project filter returned 1 of 20
  matching entries, and looked like a corpus holding one match.
  `filterObservationIdsBySourceKind` cuts the candidate list down by id, and the
  KNN is widened while a source filter is active so the channel still
  contributes. The default path (`all`) skips both and reaches the store exactly
  as it always did.
- **A curated row is not automatically a decision record.**
  `curatedKindOfRow` falls back to `akte`, which is right for something being
  looked up BY NUMBER — both namespaces are entries. But `source_kind` marks
  more than numbered entries: session checkpoints and the verbatim event log are
  curated and carry no number. `search-label.ts` therefore has its own wider
  display kind (`akte` / `vorgang` / `checkpoint` / `verbatim`); labelling a
  hand-off as a decision is a wrong answer, not a rounding.
- **Search and timeline mark a hit the same way.** The label is the group
  heading rather than a per-row column — a fixed cost per group instead of one
  per hit, in output a model pays for by the row — and both views take it from
  `observationGroupLabel`, so a hit marked in step 1 of the three-layer sequence
  cannot arrive unmarked in step 2.

### An open item goes stale by the world moving, not by anyone touching it

`aging.ts` answers "how much has happened since this was written" and reports
DECISIONS only, deliberately: it orders by RECORD NUMBER, because decision
numbers are zero-padded and monotonically assigned while every curated row
shares one import timestamp. That trick does not carry over to `V-0187`, which
lives in a different namespace and cannot be compared with `0138`.

But the entries that most need the question asked of them are exactly the ones
it left out. An open work item is a standing claim that something is
unresolved, read as current for as long as it stands, and NOTHING WRITES TO IT
when the thing it waits for is settled elsewhere. On the live corpus 118 items
say `offen` and 17 say `wartet`, and nothing said which of them had been
overtaken. `openItemsReport` is the same three numbers for those, and
`keepmind curated:alter --vorgaenge` prints them.

- **A second function, not a flag.** The two orderings are computed
  differently — decisions by record number, open items by DATE, which is weaker
  because a record whose date will not parse drops out of the count. Printing
  them together invites reading one number as the other.
- **"Unchanged" means the STATE has not moved.** The age comes from
  `state_since`, not from the item's file: a work item's state is derived from
  `EREIGNISSE.log`, which moves without the file changing. The creation date is
  the fallback, and which one was used is PRINTED — "unchanged since it was
  created" does not mean anyone has looked at it.
- **A missing date yields no count, not a zero.** Zero would sort a date-less
  item to the bottom as though nothing had happened since it, which is a claim
  the data does not support.
- **It still asserts nothing.** "12 days in this state, 8 decisions since, 2 of
  them name it" is arithmetic over dates and declared edges — it cannot be
  wrong, only uninteresting. That is the same property that makes `ageReport`
  worth its weight, and the reason neither of them may grow a similarity
  measure: the moment a threshold decides what "same topic" means, the number
  stops being arithmetic and starts being a guess.

No second data type was introduced for this. Work items already carry a state
derived from the event log and a validity window, and nothing is deleted —
which is what "claims with state and durability" asks for. A parallel claims
table would be a second state machine that is merely supposed to agree with
the first.

### Before a question reaches a person, the reader is the filter

`decision-check` offers candidate decisions when a question is about to be put
to a human, because deciding the same thing twice costs a person's judgement
and the second answer need not match the first. It showed its top three for
EVERY question ever asked, listing each record's title and SUBTITLE — and a
record's subtitle is its header line, `Stand: gilt · 11.08.2026 · Manuel`.
Metadata about the decision, not the decision. Measured live on a question
about whether to push two git commits, it offered `0110 — Die Grenze ist das
Firmennetz`, `0115 — Ohne offizielle Regeln und Ansprechpartner ruhen die
externen Punkte` and `0029 — Die Form wird am Entwurf geprüft`, with nothing on
screen to tell them from real hits.

**There is no relevance threshold, and that is a measured result rather than an
omission.** `decision-candidates.ts` carries the three measurements; read them
before adding one.

1. **There is no score to threshold.** `rrfFuse` ranks by RECIPROCAL RANK —
   rank 1 scores the same whether the match is perfect or absurd.
2. **The raw distance does not separate.** multilingual-e5-small packs the
   neighbourhood into a ~0.03 band, already measured independently in
   `SqliteVecManager`. Measured again on the live corpus: a question the corpus
   cannot answer sat at distance 0.1467, BETWEEN two it answers well (0.1345
   and 0.1642).
3. **Neither does the gap to the next neighbour — and this one nearly
   shipped.** A first run showed real questions gapping ≥ 0.0128 against noise
   ≤ 0.0086, and a cut at 0.009 was drafted on it. The "real" questions were
   work-item TITLES, i.e. text already in the corpus: each retrieved ITSELF at
   distance ≈ 0 and the gap was an artefact. Re-measured with independently
   phrased questions against decision rows only, real n=12 spans 0.0017-0.0328
   and noise n=15 spans 0-0.0094 — heavy overlap. A cut at 0.003 still admits a
   third of the noise while already swallowing a real candidate.

Swallowing a real candidate is the expensive error, so nothing is suppressed.
What changed instead is what a candidate SHOWS: `findingOf` renders the
record's own statement — the author's `summary`, else the prose under
`## Entscheidung`, else the first paragraph — with markdown marks removed,
clipped at a word boundary. Two rules were each paid for by a wrong reading of
the live corpus: the colon that marks a lead-in is tested on the text with
emphasis STRIPPED (the corpus writes lead-ins bold, so the raw line ends
`Entscheidung:**` and a raw test misses every one of them), and a lead-in is
followed only when what follows is prose — record 0002 introduces a five-row
table, and half a table row spliced onto a sentence reads worse than the
lead-in alone.

Making this check selective needs a different retrieval stage — a re-ranker, or
an embedder whose distances spread. Not a constant.

### A vector has no OR, so the query is spelled the way the corpus spells it

The keyword channel answers both German spellings of a word by expanding them
and OR-ing the result — a spelling that does not occur matches nothing, costs
nothing, and cannot displace a real hit. The semantic channel cannot do that:
one query text becomes one vector, and multilingual-e5 tokenises "Prüfung" and
"Pruefung" into different subword sequences. Measured on the live corpus
(`evals/memory`, set D): keyword agreement 89%, semantic 13%, and the fused path
27% because it fuses the two.

`src/services/sqlite/corpus-spelling.ts` asks the corpus which spelling it uses
and rewrites the query into that one, in `SqliteVecManager.queryKnn` — the ONE
place that turns query text into a vector, and therefore the one place that may
decide how that text is spelled. Result: semantic and fused agreement both 100%,
with A/K/B/C unchanged to the point.

- **The evidence is `observations_fts`'s own vocabulary**, read through an
  `fts5vocab` view. Both spellings genuinely occur (`prufung` 65 · `pruefung`
  20; `maßstab` 19 · `massstab` 9) and the umlaut form dominates every measured
  pair, so both queries resolve to it and become the SAME query. Agreement by
  construction, not by coincidence.
- **The lookup must fold terms the INDEX's way, not `fold()`'s.** `unicode61`
  removes diacritics (`ü → u`) and leaves `ß` alone; `fold()` in the reconciler
  transliterates (`ü → ue`, `ß → ss`) because it compares wording rather than
  addressing an index. The terms are `prufung` and `maßstab`; a lookup folded
  the reconciler's way finds neither and every spelling reads as unattested.
- **An unattested spelling is NEVER chosen, and that is what keeps the
  ambiguous direction safe.** `ue → ü` turns "Steuerung" into the non-word
  "Steürung". In the keyword channel that costs nothing. In the semantic channel
  a nonsense vector still has a hundred nearest neighbours, all noise. Because
  the rewrite fires only on evidence, an ordinary question reaches the embedder
  byte-identical — which is why nothing but set D moved.
- **A rewrite is narrower than an OR, and the cost is recorded.** `Masse` and
  `Maße` are different words; this corpus writes `maße` 36 times and `masse` 11,
  so a question about `Masse` is embedded as `Maße`. Nothing becomes unfindable —
  the keyword leg still carries the spelling as typed. Embedding both spellings
  and merging was rejected because it is not symmetric: the canonical spelling
  would produce one vector and the other two, so the two spellings would still
  return different lists, which is the whole thing being fixed.
- **The failure is sticky and silent.** An unreadable vocabulary degrades to the
  raw query and logs once, for the same reason `SqliteVecManager.loadFailure`
  exists: a per-query failed open logged thousands of lines from one broken
  install.

### A record that contains your wording is not ranked by how much it resembles it

FTS5's bm25 does not reward adjacency, so the keyword leg cannot tell a record
that contains your sentence from one that uses the same words apart — and that
undifferentiated score carries 0.25 of the fused weight against a similarity
score carrying 0.75. Measured against the running worker over 25 sentences
lifted verbatim out of records' BODIES: rank 1 in 56% of cases, not in the top
ten at all in 12%. Now 100% at rank 1 (`evals/memory` set E).

- **A title quote proves nothing.** `title` is bm25 weight 10, and all five
  title quotes tried already ranked first before anything changed. The obvious
  test could not fail, which is why the failure went unseen.
- **It is a promotion, not a third channel in the fusion.** "This record
  contains these words in this order" is a fact, not a score. RRF ranks by
  reciprocal rank, so fusing it would re-enter it as "rank 1 of a third list"
  and let two resemblance channels outvote it. Same reasoning as the
  supersession marker: a deterministic answer is not improved by being averaged
  with a guess.
- **Stopwords are KEPT in a phrase**, unlike in `queryTerms`. A phrase is a
  claim about adjacency, and dropping "ist" out of "Widerspruch ist Pflicht"
  asks about a sentence nobody wrote. The spelling variants are produced over
  the whole sentence rather than per word, for the same reason: three words with
  three variants each are not 27 phrases, they are one sentence spelled three
  ways.
- **Four tokens is the floor, and it is not a relevance threshold.** It decides
  whether the question is the kind that can be answered verbatim at all; two or
  three adjacent words are a turn of phrase, and promoting everything that
  contains one replaces the ranking with an accident of German.
- **Nothing is dropped and nothing is demoted.** The fused ranking follows in
  full, minus the ids that moved up. A query that quotes nothing — the ordinary
  case — returns it untouched, which is what the unchanged A/K/B/C measure.
- **The probe runs through the same `buildFilterClause` as the keyword leg**, so
  a promoted row cannot be one the caller filtered out, and hydration applies
  project, origin and platform filters once more by id.

### A search says whether the entry it returns still applies

`supersession.ts` decides which of two records about one subject holds, from a
declared relation and a date rather than from a distance measure — retrieval
alone carries a stale-fact error of 15-40% precisely when both records are
about the same subject, which is why the newer one exists. That decision was
made and then not used where a model reads. Measured against the running
worker on the live corpus: a search returned `0137 — Ein Gedächtnis, und die
Rollenteilung war eine Fehlannahme` and, one row below it, `0064 — Zwei
Gedächtnisse mit geteilten Rollen`, the record 0137 had explicitly superseded.
Same list, same spelling, nothing saying 0064 no longer applies. Acting on
0064 means acting on a withdrawn rule with the record that withdrew it sitting
directly above.

- **Marked, never filtered.** `curated_get` answering "No record 0064" about a
  record that exists was its own measured failure: a retired entry is not a
  missing one, and a supersession chain you cannot follow to its far end is
  half built. The mark rides on the group heading, like the origin label and
  for the same reason — a fixed string per group instead of one per row, in
  output a model pays for by the row.
- **Retired and revised are different statements.** `retired` means another
  RECORD superseded this one: read the successor. `revised` means an earlier
  WORDING of an entry that is still in force: the entry applies, this text is
  not what it says now. Both rows are embedded, so both surface. Collapsing
  them would make one of the two labels a lie, and the reader's next move
  differs — one goes looking for a successor, the other for a current wording.
- **The reason comes from the marker, not from `valid_to`.** `valid_to` says
  only "not current". `SUPERSESSION_MARKER` (written by `supersession.ts`) and
  `REVISION_MARKER` (written by `settleCuratedRevisions`) say which. A row
  closed with NEITHER marker reads as `retired` — the conservative side,
  because the next move on a `revised` label is to look for a current wording
  that may not exist.
- **A row with no `valid_to` field at all is current, not closed.** Callers
  predating the column pass rows without it, and resolving that to "closed"
  marks the entire corpus retired — the same shape of failure as the
  `source_kind IS NULL` folding in `source-kind.ts`.
- **Ranking is NOT this.** Making an exact-wording hit rank above a loosely
  similar one is its own piece of work; this one only makes the deterministic
  decision visible. Demoting a retired row in the fusion was considered and not
  done: `rrfFuse` caps at 100, and a record searched for BY NAME must not fall
  off the end of its own result.

`REVISION_MARKER` therefore lives in `record-key.ts` rather than private to the
store: it is read outside it now. `SUPERSESSION_MARKER` stays in
`supersession.ts`, which writes it.

### A maintenance run has two claims, and the second is the one usually missing

`keepmind maintain` reclaims what the vector store holds and does not need, and
then SHOWS that the answers did not move. Reporting only the first is how a run
that shrank a store by losing part of it reads as a success.

- **The waste was a second copy of what the columns already hold.**
  `vec_documents` carried `+metadata_json`, the full bag a document arrived
  with — title, subtitle, concepts, the file lists, the session id. The read
  path never used any of it: every field a caller has ever touched
  (`sqlite_id`, `doc_type`, `created_at_epoch`) is a vec0 metadata COLUMN, and
  all of it is in `keepmind.db` besides. Measured on the live store: 14.94 MB
  of 61.52 MB, in a shadow table that also had to be read and parsed on every
  KNN. `queryKnnWithVector` now builds the bag from the columns, and
  `addChunks` no longer writes it.
- **The column stays; only its contents go.** Removing it from a vec0 virtual
  table means recreating the table and re-inserting every row. Emptying it in
  place is one UPDATE, reversible by a backfill, and it cannot lose a vector.
- **VACUUM alone reclaims nothing here.** Measured before any of this:
  `freelist_count` 0, no orphaned vec rows, no duplicate chunk keys — the
  periodic `MaintenanceLoop` had already kept the file compact in the page
  sense. "Compact the database" without first finding what is actually
  redundant is a run that reports success and changes nothing.
- **The run happens in the WORKER.** It is the process that has `vectors.db`
  open, and VACUUM rewrites the whole file; a second connection doing it from
  the CLI is a lock fight with the process that is actively embedding. The CLI
  asks over `/api/chroma/compact`, the same shape `curated:import` uses to have
  the worker verify an index.
- **The probes come from the corpus, not from this file.** Ten record titles
  spread across the store, searched over the same route a person uses, before
  and after, compared id by id. A fixed list of German phrases would measure
  nothing on a machine whose memory is in English.
- **Row count before and after is the claim that nothing was lost**, and the
  command exits non-zero when it moves or when a probe's answers differ.
  Measured on the live store: 61.55 MB → 47.38 MB, 27,660 rows both times, all
  ten probe result lists identical.

### "Imported" has to mean "findable", and nothing may fail quietly

The curated corpus is the part of memory a person wrote by hand, and it is
answered from as if it were current. Three rules keep that claim honest. Each
one was paid for by the same four-day outage: an import stopped running, the
only evidence was an absence, and every answer in between was confidently out
of date.

- **An import that did not index has failed.** `ensureCuratedIndexed`
  (`src/npx-cli/commands/curated.ts`) STARTS the worker rather than noticing it
  is absent, then asks `/api/curated/ensure-indexed` to verify — not to try.
  `VectorSync.ensureObservationsIndexed` checks the rows against the vec store
  itself, because a backfill reports what its own run did, which is a different
  claim. When rows are missing it rewinds the watermark (`rewindWatermarkTo`)
  and retries once: the backfill only looks at `id > watermark`, so a row that
  was written and never embedded sits below the mark forever, and the hole is
  indistinguishable from an empty result. Every curated write path — file
  import, `curated:add`, `curated:edit` — exits non-zero when the corpus is not
  searchable.
- **Nothing outside keepmind has to remember to import.** `CuratedAutoImport`
  runs in the worker: once at startup, and on a debounced watch of the source
  directories. `runCuratedImport` (`src/services/curated/import-run.ts`) is the
  ONE run both it and the CLI use — two implementations of "read the corpus"
  would drift the way the four scripts that once defined the source set drifted.
  Watch paths go through `realpathSync.native`: a recursive Windows watch on a
  short (8.3) or differently-cased path trips an assertion inside libuv that
  ABORTS the process — not an exception, not catchable.
- **The state of the corpus is visible without being asked for.**
  `import-state.ts` stamps every run (attempt and success separately, so a
  repeatedly failing import cannot look like one nobody triggered), and only a
  clean run may move the source fingerprint. `health.ts` computes the verdict
  once; the session-start block and `keepmind doctor` both read it. The doctor
  group is REQUIRED — including a stopped worker — on a machine that has a
  curated corpus, and skipped entirely on one that does not: the strictness
  comes from the corpus being present, not from a blanket rule.

Where an unattended import files records is DECLARED, never guessed:
`KEEPMIND_CURATED_PROJECT`, or a `project` on the source entry. Failing both, it
uses the one project that already holds curated rows — an observed fact — and
otherwise refuses to run and says so. Same rule as the source `kind`: a corpus
filed under the wrong project is invisible to every project-filtered read, and
that looks exactly like an import that never ran.

**A fallback is only owed to an entry that needs one.** `runIfStale` demanded
one unconditionally, so a configuration in which EVERY entry named its own
project still refused to run — on a fresh machine, where no project holds
curated rows yet, which is the case the unattended import exists for. The only
evidence was a WARN line saying `project=(unknown)`, the exact failure shape P1
was built against. A MIXED set with no fallback still aborts whole: a half run
leaves part of the corpus fresh and part stale and stamps a success over it.

**Both entry points group by project, or they disagree about the corpus.**
`curated:import` and `curated:verify` resolved ONE project per run and ignored
`project` on the entry — measured: two sources that each named their own were
both filed under the working directory's name, while the worker filed them
correctly. Both now run `sourcesByProject` and loop, one run per project;
`--project` is the FALLBACK, never an override (filing a declared corpus
elsewhere is not undone by re-running), and when it is given while entries
declare their own, the run says which entries kept theirs. `sourcesByProject`
takes `fallback: string | null` and throws rather than filing under an empty
name — the one place both callers' rule is enforced.

### Portability is a precondition, not a feature

`keepmind export` / `keepmind import` (`src/services/portability/`) carry the
whole source of truth as JSONL per table plus a manifest with a row count and a
SHA-256 per file. Five properties are load-bearing:

- **Primary keys are preserved.** Feedback rows point at observation ids, and
  the metadata of a superseded or revised row names its replacement BY ID.
  Re-numbering on import would silently re-point every one of them.
- **Vectors are not in the bundle.** They are derived from the text and bound to
  the embedder that produced them — `vec_meta.embedder_identity` exists because
  two embedders' vectors are incomparable and the failure is silent. The import
  clears the backfill watermarks and rebuilds them with the embedder the target
  machine has.
- **Verify everything, then write once.** Manifest, row counts and hashes are
  checked before the transaction opens. A half-restored memory looks complete,
  and the missing part is invisible.
- **A row whose parent is gone is still memory.** The restore runs with foreign
  key enforcement OFF and REPORTS what dangles (`ImportReport.dangling`),
  because the source machine does not satisfy the constraint either. Measured
  on the live store: 1830 observations and 408 session summaries name a session
  row that no longer exists — pre-3.x rows from one bounded window across nine
  projects, readable and findable to this day, because SQLite never re-checks a
  foreign key after the fact. Enforcing it on the way in rejected the WHOLE
  19,032-row bundle with a bare `FOREIGN KEY constraint failed`, so the real
  corpus could not be restored at all. Dropping the rows instead would be the
  half-restored memory the rule above exists to prevent, and it would break the
  one rule the store rests on: nothing is deleted to resolve a conflict.
  Turning enforcement off is safe BY CONSTRUCTION — the restore only INSERTs,
  and `replace` deletes children before parents explicitly rather than trusting
  a cascade. The pragma is set OUTSIDE the transaction (inside one it is a
  silent no-op) and put back in a `finally`.
- **Everything the bundle carries is accounted for on the way in.** The export
  writes `settings.json` and says "settings.json included"; the import read it
  nowhere at all, so an operator's reasonable belief that their settings had
  crossed over was wrong with nothing to indicate it. `restoreBundledSettings`
  now applies them on `--settings` and otherwise says out loud that the bundle
  carries settings which were NOT applied. It stays opt-in because settings
  describe a MACHINE, not a memory — `curatedSources` names directories the
  target may not have, `KEEPMIND_DATA_DIR` may point elsewhere, and the
  target's own working configuration is not the restore's to discard. When
  applied, the previous file is kept beside it (`.bak-before-import`).

Both were found the same way, and it is the only way they could have been:
by running the round trip against the REAL corpus. Twelve tests over synthetic
fixtures were green throughout — the fixtures have no pre-3.x rows and no
settings file, so neither failure could occur in them.

### Provider scope

`claude` is the only provider this project is developed and measured against.
The Gemini/OpenRouter path (`OpenAICompatibleProvider` and its two subclasses)
is kept working but is deliberately **not** kept at parity — the three cost
invariants above were not ported there, and porting them is optional, not owed.
Do not treat the gap as a bug to fix by default, and do not spend a change
budget on it without being asked.

The one thing that is NOT optional there: redaction. It lives in
`src/sdk/prompts.ts`, which every provider goes through, so any new
prompt-building code — for any provider — must go through those builders.

Removing those providers is a breaking change, not a cleanup: keepmind is
published to npm (`private: false`, CI publishes on every `v*` tag). Note also
that `GeminiCliHooksInstaller` and `cli/adapters/gemini-cli.ts` are **Gemini CLI
as a host environment**, unrelated to the Gemini provider — a grep for "gemini"
hits both, and deleting the wrong one breaks client support.

keepmind is a **local-only hard fork** of thedotmack/claude-mem (independent git history). Compared to upstream it removed Chroma and the cloud-sync layer — all vector search runs in-process. Do NOT reintroduce Chroma or assume a shared history with upstream.

"node-only" describes the **runtime**: the worker, hooks and MCP server run under Node, with no Bun or Python process in the loop. It does not describe the toolchain — see Requirements.

## Naming

The canonical configuration prefix is `KEEPMIND_*`, for environment variables and for the keys inside `~/.keepmind/settings.json`. The pre-2.0 `CLAUDE_MEM_*` spelling is still accepted on read (`src/shared/legacy-env.ts`) and settings files are migrated once on load — do not remove that fallback, and do not add new `CLAUDE_MEM_*` keys.

Markers written into files keepmind does not own (`CLAUDE.md`, `AGENTS.md`, IDE rules files) go through `src/shared/context-markers.ts`. Anything that writes such a file must also delete its pre-rename predecessor: rules files are `alwaysApply` and MCP servers are keyed by name, so a leftover keeps injecting stale context.

References to `claude-mem` are only correct where they name the **upstream** project: migration, purge, legacy cleanup, and attribution.

## Build

```bash
npm run build-and-sync        # Build, sync to marketplace, restart worker
```

Compilation is Node + esbuild (`build:cli-binary` bundles `--platform=node --external:node:sqlite`). The build additionally shells out to `bun install` in `scripts/gen-plugin-lockfile.cjs` and `scripts/sync-marketplace.cjs`, so **bun must be on PATH to build**.

`npm run build` verifies that the committed hook JSON still matches the canonical generator and fails on drift. After changing `src/build/hook-shell-template.ts` or anything that feeds it, regenerate with `REGEN_HOOKS=1 npm run build`.

## File Locations

- **Source**: `<project-root>/src/`
- **Built Plugin**: `<project-root>/plugin/`
- **Installed Plugin**: `~/.claude/plugins/marketplaces/keepmind/` — code only, **no `node_modules`**
- **Plugin dependencies**: `~/.claude/plugins/data/keepmind-keepmind/` (`${CLAUDE_PLUGIN_DATA}`)
- **Database**: `~/.keepmind/keepmind.db`
- **Vector search**: in-process `sqlite-vec` inside the SQLite DB (no separate Chroma service); embeddings via `@huggingface/transformers` (local multilingual-e5-small, int8, 384-dim)

The embedder is **multilingual by design**, not by accident: observations are
written in English while questions are often asked in another language, and an
English-only model cannot bridge that — German queries silently degraded to
keyword-only hits. e5 is asymmetric, so stored text must be embedded as
`passage` and searches as `query`; mixing the two is silent, it only retrieves
worse. `vec_meta.embedder_identity` stamps the store with the model that filled
it, and a mismatch triggers a full rebuild at worker start — without that stamp
a model change mixes two incomparable vector spaces and presents as "search
stopped finding things".

There is exactly ONE dependency tree, and it lives in the plugin data directory.
Never install into the marketplace or cache directories: `${CLAUDE_PLUGIN_ROOT}`
is documented as ephemeral, and the host restores it from git on update — which
deletes `node_modules` (observed twice on 2026-07-29, once with `autoUpdate:false`
already set). `${CLAUDE_PLUGIN_DATA}` survives updates.

The bundles resolve their native deps (sqlite-vec, onnxruntime-node via
`@huggingface/transformers`, the tree-sitter grammars) through
`src/shared/plugin-node-modules.ts` — a single ordered candidate chain, not a
bundle-relative `createRequire`. When adding a runtime dependency that cannot be
inlined, resolve it with `pluginRequire`/`pluginResolve`; a bare `createRequire`
anchored at the bundle re-pins the tree to the directory the host deletes.
Legacy locations stay in the chain so installs that predate the move keep
working until their next `npx keepmind install`.

## Requirements

- **Node.js >= 22.5.0** — the runtime floor, set by the built-in `node:sqlite` module.
- **Bun** — required to *install* and to *build*, never to run. `npx keepmind install` treats it as mandatory (`ensureBun` in `src/npx-cli/install/setup-runtime.ts`, installed automatically if missing) and uses `bun install --frozen-lockfile` for a deterministic plugin dependency closure.
- No uv, no Chroma, no Python — the uvx/Python toolchain went away with Chroma, and the installer no longer probes or installs uv. Do not reintroduce it.

## Documentation

**Source**: `docs/` — MDX/Markdown files in the repo

## Releases

```bash
# write the notes first — they are the release
$EDITOR RELEASE_NOTES.md
npm run release:patch -- --title="keepmind 3.3.2 — ..."   # or :minor / :major
```

`scripts/release.mjs` is the only supported path. It runs a preflight, bumps the
version, builds, tests, tags, pushes, **creates the GitHub Release** and
regenerates the changelog. `--dry-run` stops after the preflight.

npm publishing happens in CI: pushing a `v*` tag triggers
`.github/workflows/npm-publish.yml`, which authenticates over OIDC trusted
publishing. Nothing publishes from a developer machine — there is no token here.

Three rules the script enforces because each was violated in production:

- **A release without notes is not a release.** `CHANGELOG.md` is generated from
  GitHub Releases, so a tag without one is a permanent hole in the file (v3.3.0
  shipped to npm that way). The preflight refuses to run on an empty
  `RELEASE_NOTES.md`.
- **Never `git push --tags`.** The 322 pre-fork claude-mem tags live under
  `refs/tags/upstream/*` and must stay local. Push the one tag by name.
- **Tags outside `upstream/` that are unreachable from `main` are a bug.** They
  silently occupy future versions — the inherited set held `v3.3.8`, `v3.5.x` and
  43 others hostage. The preflight fails if any reappear.

## Important

No need to edit the changelog ever, it's generated automatically —
`npm run changelog:generate` merges GitHub Releases into `CHANGELOG.md` sorted by
version. Everything below the `<!-- inherited-history -->` marker is the pre-fork
claude-mem changelog (numbered up to 13.x, older than every keepmind release
despite the higher numbers) and is never rewritten.

## Daily Maintenance

Run a daily version check across all package manifests and upgrade every dependency to its latest version — including major version bumps. Staying on the latest is the goal; do not skip majors.

- Check `package.json` (root) and the nested manifests — `plugin/package.json` (generated by `scripts/build-hooks.js`, so change its source there) and `examples/sdk-node/package.json` — for outdated dependencies via `npm outdated`.
- Upgrade every package to `latest` (use `npm install <pkg>@latest` for each, or `npx npm-check-updates -u && npm install`). Bump majors too.
- Run `npm audit fix` to resolve advisories.
- After upgrades, run `npm run build-and-sync` and verify the worker starts and tests pass. Fix any breakage caused by major bumps in the same change.
- Commit the updated `package.json` files and the regenerated `plugin/bun.lock`. `package-lock.json` is gitignored — do not try to commit it.
