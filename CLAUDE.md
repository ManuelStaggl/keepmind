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
that looks exactly like an import that never ran. The CLI resolves the project
in the same order (`--project`, then the setting, then the directory) so the
same corpus cannot land under two names depending on who started the import.

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
