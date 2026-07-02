# Remaining-Work Execution Plan (autonomous)

**Created:** 2026-07-02, before a context clear.
**Mandate:** implement EVERY item below fully; if further problems surface, fix them autonomously. Test + verify each item before moving on. Release at the end.

This document is self-contained — it assumes zero prior conversation context.

---

## 0. Operating context (read first)

- **Repo:** `C:\Users\Administrator\Desktop\Projekte\keepmind` · git remote `ManuelStaggl/keepmind` · branch `main`. Work on `main` (that's how this repo operates). Language for user-facing replies: **German**.
- **What keepmind is:** a Claude Code plugin for persistent cross-session memory. A long-running **worker daemon** (Node, `node:sqlite`) captures tool-use, compresses it into "observations" via the Claude Agent SDK, and injects context on SessionStart. Hooks talk to the daemon over HTTP (`http://127.0.0.1:37777`).
- **Build:** `npm run build-and-sync` (esbuild bundles → `plugin/scripts/*.cjs`, syncs the local marketplace copy, restarts the worker). `npm run build` = bundles only. `npm run typecheck:root` = `tsc --noEmit`.
- **Tests:** `node --import tsx --import ./tests/preload.ts --experimental-test-module-mocks --test "tests/**/*.test.ts"` (subsets: `tests/services/**`, `tests/infrastructure/**`, `tests/sdk/**`, `tests/cli/**`). Test files import `bun:test` but run under Node via the preload shim.
- **Build guards (do not trip):** `scripts/build-hooks.js` fails the build if (a) `zod` is externalized in any hook bundle, or (b) a daemon-only module (Database/sqlite-vec/transformers/MCP-SDK) leaks into `hook-client.cjs` (metafile leak guard). Keep the hook path slim.
- **DBs:** main = `~/.keepmind/keepmind.db`; vectors = `~/.keepmind/vector-db/vectors.db` (sqlite-vec vec0). Read-only probe pattern: `new (require('node:sqlite').DatabaseSync)(path,{readOnly:true})`.
- **Clean-room test pattern** (verify boot without plugin node_modules): `tar --exclude=node_modules -cf -` the `plugin/` tree into a scratch dir, then run `KEEPMIND_DATA_DIR=<scratch>/data CLAUDE_MEM_WORKER_PORT=<free-port> CLAUDE_MEM_FORCE_START=1 node <scratch>/scripts/worker-service.cjs --daemon` in the background, probe `/api/health`, then kill (PowerShell `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where CommandLine -like '*scratch*'`).

### Version / release state
- **Released on npm:** `keepmind@1.2.2`.
- **On `main`, UNRELEASED:** L1 observation batching (opt-in, `CLAUDE_MEM_OBSERVATION_BATCH_MAX`, default `1`). Working tree should be clean.
- **Release procedure** (do once at the very end, likely `1.3.0`):
  1. Bump version in ALL 7 manifests: `.claude-plugin/marketplace.json` (`plugins[0].version`), `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `package.json`, `plugin/.claude-plugin/plugin.json`, `plugin/.codex-plugin/plugin.json`, `plugin/package.json`. Verify: `git grep -n '"version": "<OLD>"'` returns 0.
  2. `npm run build-and-sync` (worker restart must verify the new version).
  3. `git commit -m "chore: bump version to X.Y.Z"`, `git tag -a vX.Y.Z -m "Version X.Y.Z"`, `git push origin main && git push origin vX.Y.Z`.
  4. CI (`.github/workflows/npm-publish.yml`, OIDC trusted publishing) auto-publishes. Verify: poll `npm view keepmind version` until it flips.
  5. `gh release create vX.Y.Z --title "vX.Y.Z" --notes "..."`.
  6. `npm run changelog:generate` → commit `CHANGELOG.md` → push. (Do NOT hand-edit the changelog.)
- **Do NOT** run `npm publish` manually (CI OIDC handles it).

### What's already DONE this session (do not redo)
1.1.2 SessionEnd libuv `UV_HANDLE_CLOSING` hardened exit (`src/shared/hook-io.ts`). · 1.1.3 worker start self-heal on reused/stale PID (`src/services/worker-spawner.ts`) + honest doctor. · 1.1.4 worker boots without node_modules (zod bundled in `scripts/build-hooks.js`; sqlite-vec + transformers lazy in `SqliteVecManager.ts`/`EmbedderService.ts`). · 1.1.5 doctor: Bun optional. · 1.2.0 P1 slim `hook-client.cjs` + P3 skip Windows CIM on healthy fast path + Tier-1 (T1 file-context header/limit, T2 sessionCount 10→5, T4 summary truncation, L2 idle 3→4.5min, R3 vectors.db maintenance, R5 log retention, R6 backup prune). · 1.2.1 doctor "Updates" check. · 1.2.2 worker self-repairs missing native deps on boot (`src/services/vector/vector-deps-repair.ts`). · (unreleased) L1 observation batching.

Full analysis: `plans/2026-07-02-performance-token-improvement-plan.md`.

---

## Work items — implement each fully, in this order

### 1. R1 — Reduce vector chunking (5.4 → ~2 vectors/item)  [Ressourcen; ~−60 MB]
- **Where:** `src/services/sync/VectorSync.ts` → `formatObservationDocs` (lines ~190-198) and `formatSummaryDocs` (~203-227).
- **Current:** per observation it emits one vec doc for `narrative`, one for `text`, and **one per fact** (`obs_<id>_fact_<i>`). Summaries emit 6 docs (request/investigated/learned/completed/next_steps/notes). → ~5.4 vectors/item.
- **Do:** collapse to ~2 vectors/item. Suggested: one "primary" doc = `title + subtitle + narrative (+ text)` combined, and one "facts" doc = all facts joined (e.g. `facts.join('\n')`). Keep `field_type` metadata meaningful (e.g. `'primary'`, `'facts'`). For summaries, combine into ~2 docs too (e.g. `request+investigated+learned` and `completed+next_steps+notes`), or a single doc — pick what preserves search recall best.
- **Chunk key stability:** new ids like `obs_<id>_primary`, `obs_<id>_facts`. This changes the upsert keys → old per-field vectors for already-synced items become orphans (handled by R2 + a note below).
- **Check downstream:** grep for `field_type` and `fact_index` usage in the search/query layer (`src/services/worker/search/`, `SqliteVecManager.ts`, `ObservationCompiler`) — make sure nothing hard-depends on `field_type='fact'`/per-fact rows.
- **Migration note:** existing `vectors.db` keeps the old chunking until re-synced. Either (a) accept gradual convergence as items re-sync, or (b) add a one-time re-backfill. Document whichever you choose in the release notes.
- **Verify:** rebuild; run a backfill (or a fresh clean-room DB); confirm vectors/item dropped (query `vec_documents` count vs. source items); semantic search still returns sensible results (`POST /api/context/semantic` or the search route). Run `tests/worker/search/**`.
- **Risk:** M (recall). If recall clearly degrades, keep facts as their own single doc but still drop narrative/text duplication.

### 2. R2 — Delete orphan vectors on expiry/delete  [Ressourcen; stops unbounded growth]
- **Where:** `src/services/expiry/expiry.ts` (`expireStaleObservations`, hard + soft branches, lines ~60-73) and `src/services/vector/SqliteVecManager.ts` (add a delete method).
- **Current:** the only `DELETE FROM vec_documents` is the upsert-by-`chunk_key`. Expiring/deleting an observation never removes its vectors → they accumulate forever.
- **Do:**
  1. Add `SqliteVecManager.deleteBySqliteId(docType: string, sqliteId: number): number` (or `deleteByChunkKeyPrefix(prefix)`) — `DELETE FROM vec_documents WHERE ...` matching that observation's rows. Prefer matching the stored `sqlite_id` + `doc_type` metadata column if present (robust to chunk-key format), else `chunk_key LIKE 'obs_<id>_%'`. No-op if the vec store isn't loaded.
  2. In `expireStaleObservations`, after the DB delete/soft-expire, remove the vectors for the affected ids. For **soft** expiry (default), also drop vectors so expired obs stop surfacing in semantic search (they're excluded from keyword search via `valid_to`). Guard so a vec failure never aborts the DB expiry.
- **Verify:** unit-test the new SqliteVecManager method (see `tests/` for a sqlite-vec test pattern; if none, add one against a temp vec db); expire an observation and assert its `vec_documents` rows are gone. Run `tests/services/**`, `tests/infrastructure/**`.
- **Risk:** M (vector↔DB consistency). Keep it best-effort + logged.

### 3. L4 — Identity as system prompt; drop continuation re-injection  [Token; −~1k/restart]
- **Where:** `src/sdk/hardened-options.ts` (`buildHardenedSdkOptions`, ~115-136) and `src/sdk/prompts.ts` (`buildContinuationPrompt`, ~187-246; `buildInitPrompt`).
- **Current:** the ~1k-token identity/format block travels in the first USER turn and is re-injected in every continuation prompt, even though `resume` already carries it.
- **Do:** pass the stable identity/format instructions via the SDK's `customSystemPrompt`/`systemPrompt` option instead of the user turn; stop re-injecting the identity block in `buildContinuationPrompt` (keep only what genuinely changes per continuation). Verify the SDK actually honors the system prompt option (check `@anthropic-ai/claude-agent-sdk` types).
- **Verify:** observations still well-formed after the change (run a real compression turn if SDK auth is available; otherwise assert prompt shapes in `tests/sdk/prompts.test.ts`). Keep the hardening semantics intact (don't weaken any safety instructions).
- **Risk:** S–M.

### 4. L5 — Pin the model per session (cache stability)  [Token; −10-20% situativ]
- **Where:** `src/services/worker/http/routes/SessionRoutes.ts` → `applyTierRouting` (~590-630) + `src/services/worker/ClaudeProvider.ts`.
- **Current:** tier routing can switch the model on a generator restart mid-session, invalidating the (model-scoped) prompt cache.
- **Do:** within one running conversation, keep the model chosen at session start; only apply `summary`-tier routing for genuinely separate summary sessions. Simplest: cache the resolved model on the session and reuse it for ingest turns.
- **Verify:** routing tests (grep `tests/` for SessionRoutes/tier); confirm a session's ingest turns report one stable model.
- **Risk:** S.

### 5. L3 — Cap the Claude-path conversation context  [Token; long sessions]
- **Where:** `src/services/worker/ClaudeProvider.ts` (`session.conversationHistory`), reference the Gemini/OpenRouter `MAX_CONTEXT_MESSAGES=20` cap.
- **Current:** the Claude path has NO context cap; `conversationHistory` grows unbounded → quadratic cost and eventual "prompt is too long" aborts.
- **Do:** add `CLAUDE_MEM_MAX_CONTEXT_MESSAGES` (SettingsDefaultsManager, sensible default e.g. `40`, `0`=unbounded). Trim `conversationHistory` to the last N, OR force a periodic `forceInit`/new session after N observations. Preserve enough recent context for dedup/coherence.
- **Verify:** simulate a long run (many observations) and confirm history stays bounded and compression still works. Watch for regressions in dedup.
- **Risk:** M (loses dedup context beyond the window — that's the deliberate tradeoff). Make it configurable + default conservative.

### 6. repair/cache-vs-marketplace dependency consistency  [Bug]
- **Where:** `src/npx-cli/commands/install.ts` → `runRepairCommand` (~1626) installs deps into the **cache** dir only, but the worker resolves deps from the **marketplace** `plugin/` dir (`resolveWorkerScriptPath` prefers `MARKETPLACE_ROOT/plugin/scripts`). So `repair` may not fix a marketplace-run worker.
- **Do:** make `runRepairCommand` install deps into BOTH the cache dir AND `join(marketplaceDirectory(), 'plugin')` (mirror what `runInstallCommand` does at install.ts:~1386). Keep it non-interactive.
- **Verify:** simulate: remove `~/.claude/plugins/marketplaces/keepmind/plugin/node_modules` (or a clean-room copy), run repair, confirm the marketplace plugin dir has deps and the worker's vector search recovers.
- **Risk:** S.

### 7. CI green (Node 20 → ≥22)  [Infra]
- **Where:** `.github/workflows/ci.yml`, `.github/workflows/windows.yml`, and the "clean-room dependency closure smoke" step. Recent runs failed with `No such built-in module: node:sqlite` on **Node 20** (node:sqlite needs Node ≥22.5).
- **Do:** bump the CI Node version / matrix to ≥22 (match `engines.node >=22.5.0`); ensure the clean-room smoke runs under a compatible Node. Fix any other red steps you find.
- **Verify:** push a branch or use `gh run watch`; the `CI` and `Windows` workflows go green.
- **Risk:** S (config).

### 8. P2 — Remove the bash login-shell from the hook invocation  [Latency ~280ms; HIGH RISK — do LAST, carefully]
- **Where:** `src/build/hook-shell-template.ts` (`buildShellCommand`), the generated `plugin/hooks/hooks.json` + `plugin/hooks/codex-hooks.json`, and the drift assertion in `scripts/build-hooks.js` (`shellTemplateManifest`).
- **Current:** every hook runs `$SHELL -lc 'echo $PATH'` (a login shell, ~280ms) just to find `node`, plus a plugin-root discovery loop.
- **Do:** avoid the login-shell PATH probe when `node` is already resolvable; keep a robust fallback (nvm/macOS GUI PATH is the historical reason it exists — many prior issues). Regenerate the hook config files and keep the build-time drift assertion in sync.
- **Verify:** hooks still resolve `node` and run on Windows/macOS/Linux. Measure hook latency drop. **If you cannot confidently verify cross-platform, DO NOT ship it** — document the finding and skip (the daemon-latency win from P1/P3 already landed). This is the one item where "skip with a written rationale" is an acceptable completion.
- **Risk:** HIGH (PATH resolution is fragile).

### 9. Project-rename context fallback  [edge case; optional, lowest priority]
- If a repo/folder is renamed after observations were stored, the current basename-derived project key stops matching the old stored key → context lost. (NOT a spaces bug — space-named folders work; verified.) Optional: add a fallback that also matches a normalized/previous key, OR a `keepmind adopt`-style remap. Only do if time remains; otherwise note it as known/optional in the release notes.

---

## Execution rules
- After each item: `npm run typecheck:root` + the relevant test subset + `npm run build-and-sync` (worker must restart cleanly). Fix anything that breaks before moving on.
- Commit each item as its own atomic conventional commit (`feat:`/`fix:`/`perf:`/`refactor:`/`ci:`), with the co-author footer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- If a new problem surfaces, fix it autonomously (that's the mandate) and note it in the commit.
- **Final step:** one release (likely `1.3.0`) per the procedure in §0, bundling everything including the already-committed L1. Then `git status` must be clean and `npm view keepmind version` must show the new version.
- Keep the user posted in German with a concise per-item summary at the end.
