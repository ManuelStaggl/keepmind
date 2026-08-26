<h1 align="center">keepmind</h1>

<h4 align="center">Persistent memory for <a href="https://claude.com/claude-code" target="_blank">Claude Code</a> — Windows-first, node-only, cloud-free.</h4>

<p align="center"><sub><strong>keepmind</strong> is a node-only, RAM-lean fork of <a href="https://github.com/thedotmack/claude-mem">thedotmack/claude-mem</a> (Apache-2.0). See <a href="NOTICE">NOTICE</a> for attribution.</sub></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
  <a href="https://www.npmjs.com/package/keepmind"><img src="https://img.shields.io/npm/v/keepmind.svg?color=green" alt="Version"></a>
  <a href="package.json"><img src="https://img.shields.io/badge/node-%3E%3D22.5-brightgreen.svg" alt="Node"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#two-kinds-of-memory">Two Kinds of Memory</a> •
  <a href="#lasting-entries">Lasting Entries</a> •
  <a href="#search">Search</a> •
  <a href="#operating-it">Operating It</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#license">License</a>
</p>

<p align="center">
  keepmind keeps two things across sessions: what <em>happened</em>, captured automatically and summarised; and what was <em>decided</em>, written by a person and stored word for word. Both are searched together, and a result says which kind it is and whether it still applies.
</p>

---

## What's different from claude-mem

This fork strips the cloud/SaaS layer and the Bun/Chroma runtime dependencies so it runs as a self-contained node process on Windows:

- **node-only** — the `bun:sqlite` dependency is shimmed to `node:sqlite`; the worker runs under Node ≥ 22.5. No Python, no uv, no Chroma service.
- **In-process vector search** — `@huggingface/transformers` (int8 multilingual-e5-small, 384-dim) + `sqlite-vec`. Hybrid RRF (vector + BM25), fully offline, and multilingual by design: memories written in English stay findable in the language you actually ask in.
- **Cloud layer removed** — Postgres, BullMQ, Redis and better-auth are gone. Observation generation and the MCP tool surface stay intact.
- **Windows-hardened lifecycle** — ephemeral worker port (eliminates the fixed-port orphaned-socket deadlock), session-bound refcount, atomic BOM-free settings.
- **Secret-safe** — prompts and tool content are redacted on the way OUT to the model, not merely on the way in to storage; project-scoped by default.
- **A curated corpus** — decisions and open items a person wrote, stored verbatim and never shown to a model. This is the part claude-mem has no counterpart for; see [Lasting entries](#lasting-entries).

Data lives under `~/.keepmind/` (`keepmind.db` + `vector-db/vectors.db`).

---

## Quick Start

**Run the interactive installer — this is the one required step:**

```bash
npx keepmind@latest install
```

The installer registers the plugin with Claude Code, installs the runtime (worker, Bun, native deps), lets you pick your AI provider/model, and starts the worker. If an existing **claude-mem** install is found, it offers to migrate your memories and remove it.

> ⚠️ **The `/plugin install` marketplace flow alone is NOT enough.** It only copies the plugin files — it does **not** install the runtime or configure a provider, so no memory is ever captured. Whether or not you added the marketplace, you must run `npx keepmind@latest install` to complete setup.

Then **restart Claude Code**. Memory injection begins on your **second** session in a project — the first seeds the store, subsequent sessions receive auto-injected context.

Check status any time with `npx keepmind status`, or diagnose setup with `npx keepmind doctor`.

**Requirements:** Node ≥ 22.5. Bun is required to *install* and to *build*, never to *run*; the installer fetches it if missing.

---

## Two kinds of memory

Memory holds two kinds of text, and keepmind never presents them alike.

|  | **Observations** | **Lasting entries** |
|---|---|---|
| Written by | the model, from your session | a person |
| Content | a summary of what happened | the exact wording, stored verbatim |
| Read as | an account, possibly imprecise | current, until something supersedes it |
| Ever sent to a provider | yes, to be compressed | **never** — the write path reaches no model |

That last row is a property of the code path rather than a promise: curated entries go straight to SQLite and enqueue nothing, and two tests fail the moment either write path reaches for anything else.

---

## Lasting entries

A lasting entry is a decision (`0138`) or an open work item (`V-0001`). They can be **imported from a file archive** or **written directly**, and both routes take the same write path.

```bash
npx keepmind curated:add --title "Reviews run before the merge, not after"
npx keepmind curated:edit 0138 --status "abgelöst"
npx keepmind curated:supersede 0138 0064     # declare and apply a supersession
npx keepmind curated:show 0064 --all         # every revision, oldest first
npx keepmind curated:import                  # the configured source directories
npx keepmind curated:verify                  # did the file corpus arrive complete?
```

What holds them together:

- **Nothing is deleted.** An edit writes a new revision and closes the previous one's window. Exactly one revision is current at a time — a floor as well as a ceiling.
- **A retired entry is not a missing one.** Look one up after it was superseded and you get it back, marked `retired`, with the record that replaced it. A supersession chain you cannot follow to its far end is half built.
- **Relations read from both ends.** An edge is declared once, by one record — but the direction a reader cannot know to ask for is the *incoming* one, so `0064` says "superseded by 0137" even though only `0137` wrote anything down.
- **The corpus keeps itself current.** The worker imports at startup and on a debounced watch of the source directories. An import that did not make its rows *searchable* has failed and exits non-zero — "imported" has to mean "findable".
- **Machines without the corpus stay quiet.** Records held with unreachable sources warn once and never fail; a machine with neither says nothing at all.

Two reports ask "how much has happened since this was written", and assert nothing beyond arithmetic:

```bash
npx keepmind curated:alter               # decisions, most-overtaken first
npx keepmind curated:alter --vorgaenge   # open items — each claims something is still unresolved
```

Before a question is put to a person, keepmind offers decisions that may already answer it, rendering each record's own statement rather than its header line.

---

## Search

One query, both kinds of text, and the result tells you what you are looking at.

- **Hybrid** — offline semantic (sqlite-vec) fused with keyword (SQLite FTS5/BM25) via RRF.
- **Origin is labelled** — a lasting entry is never spelled like a session summary, and `sourceKind: 'curated'` searches only the verbatim side.
- **Validity is marked** — a hit that has been superseded says so, and an earlier *wording* of a current entry says that instead. Marked, never filtered.
- **Exact wording wins** — a record containing your sentence in that order goes to the top. It is a promotion, not a third opinion in the ranking.
- **German spellings are reconciled** — the query is embedded the way the corpus actually spells the word, evidenced by the index's own vocabulary. A spelling that does not occur is never invented.

MCP tools (`search`, `timeline`, `get_observations`, `curated_*`, `save_checkpoint`, …) and the `/mem-search` skill query all of this in natural language — "did we already solve this?", "how did we do X last time?".

---

## Operating it

```bash
npx keepmind doctor      # runtime, provider, worker, memory, curated corpus — add --json
npx keepmind metrics     # observer cost per day: billed tokens, tokens/turn, gated share
npx keepmind maintain    # reclaim what the vector store does not need — and show the answers did not move
npx keepmind export <dir>   # the whole memory as readable JSONL + a hashed manifest
npx keepmind import <dir>   # restore on another machine and rebuild the semantic index
```

Two of these are deliberately hard to fool. `maintain` makes **two** claims — it got smaller *and* it still answers the same — and exits non-zero if a probe's results move. `export`/`import` verify the manifest, row counts and hashes *before* the transaction opens, preserve primary keys, and report what dangles rather than dropping it; vectors are never in the bundle, because they belong to the embedder that produced them.

A **web viewer** runs at `http://localhost:<worker-port>` (the port is shown at session start; ephemeral by design), with a live memory stream and the context-injection settings.

---

## Configuration

Settings live in `~/.keepmind/settings.json` (auto-created with defaults on first run): AI model, worker port/host, data directory, log level, curated sources, and context-injection behaviour.

Environment variables use the canonical `KEEPMIND_*` prefix; the pre-2.0 `CLAUDE_MEM_*` names are still honored as a fallback. Examples:

```bash
KEEPMIND_DATA_DIR         # override the data directory (default ~/.keepmind)
KEEPMIND_WORKER_PORT      # pin the worker port (default: ephemeral)
KEEPMIND_LOG_LEVEL        # INFO | WARN | ERROR | DEBUG
KEEPMIND_CHROMA_ENABLED   # 'false' → SQLite/BM25-only search (disables the vector store)
KEEPMIND_CURATED_PROJECT  # where an unattended curated import files its records
```

`curatedSources` names the directories the curated import reads, each with a `kind` (`akten` / `vorgaenge`) and optionally its own `project`.

---

## Migrating from claude-mem

If you have an existing claude-mem install, adopt its database losslessly:

```bash
npx keepmind migrate            # auto-detects ~/.claude-mem/claude-mem.db
npx keepmind migrate --from <dir-or-file>   # explicit source
npx keepmind migrate --dry-run  # preview counts only
```

Adopt copies the source read-only (`VACUUM INTO`) and brings the schema up to date; Merge (`--from` into an existing store) inserts only missing rows. The source is never modified. An existing `~/.keepmind/claude-mem.db` is renamed to `keepmind.db` automatically on first worker start.

---

## Development

```bash
npm run build            # sync manifests, build hooks + viewer, gen plugin lockfile
npm run build-and-sync   # build, sync to the installed marketplace, restart the worker
npm run typecheck        # tsc --noEmit, both projects
npm test                 # the full suite
```

Source in `src/`, built plugin in `plugin/`, installed copy under `~/.claude/plugins/marketplaces/keepmind/`. `CLAUDE.md` carries the invariants — each one paid for by a measured regression — and is the file to read before changing the observer, the curated path or search.

---

## License

Apache-2.0. keepmind is a derivative work of [thedotmack/claude-mem](https://github.com/thedotmack/claude-mem) (Copyright Alex Newman), used under the Apache License 2.0. Fork copyright © 2026 Manuel Staggl. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

- **Issues**: [github.com/ManuelStaggl/keepmind/issues](https://github.com/ManuelStaggl/keepmind/issues)
- **Repository**: [github.com/ManuelStaggl/keepmind](https://github.com/ManuelStaggl/keepmind)
