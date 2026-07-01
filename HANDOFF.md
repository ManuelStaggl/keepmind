# keepmind — HANDOFF / Arbeitsstand

> Windows-only, RAM-schlanker, node-only Hard-Fork von `thedotmack/claude-mem` (Apache-2.0).
> Ein automatisches Gedächtnis-Plugin für Claude Code. Bei Session-Resume **zuerst diese Datei lesen.**

**Repo:** `github.com/ManuelStaggl/keepmind` (privat) · lokal `C:\Users\Administrator\Desktop\Projekte\keepmind` · Branch `main`
**Upstream-Remote:** `thedotmack/claude-mem` (für Cherry-Picks) · **Vollständiger Plan:** `~/.claude/plans/sharded-twirling-crab.md`

---

## ✅ Fertig — committet, gepusht, unabhängig verifiziert

| Phase | Commit | Ergebnis |
|---|---|---|
| P0 Baseline-Fork | `ff76c2b` | unveränderte v13.9.1 als Basis |
| **P0b De-bun → node-only** | `a7c0ef7` | `bun:sqlite`→`node:sqlite`-Shim (`src/storage/db.ts`); 0 bun:sqlite-Imports; Worker läuft unter node |
| **P1 Windows-Lifecycle** | `b368f3f` | ephemeral Port (Deadlock-Klasse eliminiert), session-gebundener Refcount, atomare BOM-freie Settings, exit-codes. ✅ Deadlock-Test bestätigt |
| **P3 Cloud-Layer raus** | `9290d5a` | `src/server/**`+Postgres weg, `pg`/`bullmq`/`ioredis`/`better-auth` gedroppt; 23 MCP-Tools + Observation-Generierung intakt |
| **P2 In-process Vektorsuche** | `a5a7ff4` | `@huggingface/transformers` int8-MiniLM (384-dim) + `sqlite-vec` (`vec0.dll` Prebuilt) — **auf dieser Windows-Maschine bewiesen**. RAM ~204MB mit Modell / ~176MB idle. Hybrid-RRF (Vektor+BM25) |
| **P4 Memory-Qualität** | `f5cc233` | Secret-Scrubbing (ON, ✅ maskiert `ghp_`/`AKIA`), Projekt-Scoping (ON), Importance+Budget (ON), Reconcile/Supersession/Expiry (OFF default), In-Session-Optimizer + PreCompact. Schema v34–v36 |
| **Rebrand → keepmind** | `6cad914` | keepmind@1.0.0, Data-Dir `~/.keepmind`, Plugin/MCP-id `keepmind@keepmind`. ✅ Worker bootet v1.0.0 |
| **Schema-Kollision-Fix** | `8394f94` | P4-Migrationen (importance/bitemporal/last_used) kollidierten auf v34/v35 mit Upstream — auf **36/37/38** umnummeriert, je Version genau eine Migration. Idempotent. |
| **P5 Migration** | `bcc88ee` | `keepmind migrate` (Adopt/Merge, Auto-Detect). ✅ Gegen echte 22-MB-v32-DB verifiziert: verlustfrei (157/4029/1407/1494), idempotent (Adopt + Doppel-Merge stabil), Delete-then-Merge füllt auf, Quell-SHA unverändert, 1830 Waisen-Obs erhalten, `session_db_id` 1494/1494 aufgelöst, `valid_from` gebackfillt, FTS rebuilt. Build `e2f962b`. |

**Kern steht:** Windows-stabil, RAM-arm, node-only, offline-Semantiksuche, Secret-sicher, cloud-frei, **verlustfreie Migration**.

## ☐ Offen (in Reihenfolge)
1. **Cleanup** — (a) 8 vorbestehende tsc-Typfehler in `worker-service.ts` (`RestartVerifyResult`-Props + `Logger.flush`); (b) ~~Schema-Versionskollision v34/v35~~ ✅ **erledigt** (`8394f94`); (c) bun-Reste (`"test":"bun test"`, Wartungs-`.ts`, `gen-plugin-lockfile` build-time bun); (d) tote uvx-Helper + Chroma-Settings-Keys.
2. **Finale Integration** — Build → keepmind-Plugin in `~/.claude/settings.json` `enabledPlugins` als `keepmind@keepmind: true` (Original `claude-mem@thedotmack` bleibt `false`) → **`keepmind migrate`** (Adopt, da `~/.keepmind` noch leer) → Claude-Code-Neustart → End-to-End-Test (Worker auto-startet via SessionStart, MCP-Tools `mcp__keepmind__*`, Suche inkl. migrierter Inhalte, Vektor-Backfill beim ersten Start, Secret-Scrub live). **Erst danach hat der User wieder ein aktives (stabiles) Memory-Plugin.**

**Migrations-Wissen (P5):** `keepmind migrate [--from <dir>] [--dry-run]` in `src/npx-cli/commands/migrate.ts`, Dispatch in `index.ts`. Läuft in-process unter node (nur `node:sqlite` + `SessionStore`, kein Embedder). Adopt = `VACUUM INTO` (read-only Quelle) + `new SessionStore(ziel)` fährt Migrationen hoch. Merge = ATTACH read-only + `INSERT OR IGNORE`/NOT-EXISTS-Guards. Vektoren macht der Worker beim Start (`VectorSync.backfillAllProjects`, `worker-service.ts:761`, watermark-inkrementell).

## 🔑 Gotchas / Wissen für Resume
- **Worker-Test IMMER isoliert:** `CLAUDE_MEM_DATA_DIR=<tmp> CLAUDE_MEM_WORKER_PORT=<frei> CLAUDE_MEM_FORCE_START=1 node plugin/scripts/worker-service.cjs start` → 7-10s warten → `curl http://127.0.0.1:<port>/api/health` (erwartet `status:ok, version:1.0.0, mcpReady:true`). Vektor-Check: `/api/chroma/status?deep=1`.
- **Disabled-Guard hat ZWEI Gates:** `src/shared/plugin-state.ts:7` UND `plugin/scripts/bun-runner.js:67` (letzteres = eigentlicher stiller Killer). Beide keyen auf `keepmind@keepmind`. Ohne `CLAUDE_MEM_FORCE_START=1` startet der Worker nur, wenn keepmind in claude-settings enabled/absent ist.
- **ENV-Var-Namen bleiben bewusst `CLAUDE_MEM_*`** (nicht umbenannt — high-churn, low-value).
- **Native Binaries** (`sqlite-vec`, transformers) sind aus dem Bundle **externalisiert** → müssen beim Plugin-Install in `node_modules` (via `plugin/package.json`).
- **`npm run build` (esbuild) grün ≠ typfrei** — 8 vorbestehende tsc-Fehler sind nicht runtime-kritisch (Cleanup).
- **`plugin/.mcp.json` ist gitignored** → regeneriert via `REGEN_HOOKS=1` (Rebrand-Änderung dort ist local-only).
- **DB-Dateiname bleibt `claude-mem.db`**, Projekt-Config `.claude-mem.json` — bewusst nicht umbenannt (Migrations-/Kompat-Risiko).

## Design-Docs (Scratchpad, evtl. session-flüchtig)
`P2-vector-design.md`, `P3-cloud-removal-map.md`, `P4-memory-quality-design.md`, `P5-migration-design.md`
