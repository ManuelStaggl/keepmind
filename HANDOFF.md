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

## ✅ Maximal-Rebrand + Cleanup + Viewer-Refresh — DURCHGEFÜHRT (2026-07-01)
Commits `423ae01`, `db7fc8f`, `7063c76`, `f9cb905`, `33a9422` (lokal auf `main`, **noch nicht gepusht**). tsc `--noEmit`=0 (root+viewer), `npm run build` grün.
- **Cleanup (`423ae01`):** tote bun-Wartungsscripts + verwaiste `scripts/*.ts` + `translate-readme/` + `wipe-chroma.cjs` entfernt; tote Logger-Components `CHROMA_MCP`/`CHROMA_SYNC` raus (`CHROMA` bleibt live). 8 tsc-Fehler in `worker-service.ts` gefixt (RestartVerifyResult-Narrowing + `logger.flush`-Entfernung → in `db7fc8f`).
- **Runtime-Rebrand backward-compatible (`db7fc8f`):** **DB `claude-mem.db`→`keepmind.db`** via `ensureDbFilename()`/`resolveOpenDbPath()` in `paths.ts` — one-time, non-destruktiver Rename (inkl. `-wal`/`-shm`) VOR jedem Open, mit Legacy-Fallback (nie Datenverlust). Angewandt an ALLEN Öffnern (SessionStore/SessionSearch/DatabaseManager/worker-service + Infra via `dbFileForDataDir`). **Config `.keepmind.json`** first, `.claude-mem.json` Fallback. **ENV `KEEPMIND_*`** canonical, `CLAUDE_MEM_*` Fallback (zentral in `SettingsDefaultsManager.get/applyEnvOverrides` + Ad-hoc DATA_DIR/FORCE_START in paths/worker/plugin-scripts). Data-Dir-Default-Bug (`~/.claude-mem`→`~/.keepmind`) + 8 tote CHROMA_*-Keys entfernt (CHROMA_ENABLED bleibt).
- **UI (`7063c76`):** Viewer Titel/Favicon/Wordmark = keepmind (inline-SVG, kein Raster mehr); Upstream-Ballast raus (GitHub-Stars/Discord/X/Star-History); Clean/Minimal-Tokens (neutrale Grautöne + 1 Indigo-Akzent, light+dark, als Override ans `<style>`-Ende); localStorage-Keys/OpenRouter-App-Name/Installer-Strings/codex-hooks rebranded; claude-mem-Raster-Assets gelöscht.
- **Docs (`f9cb905`):** README neu (prägnant, keepmind, Attribution erhalten); Datenpfade in 32 docs-mdx korrigiert.
- **Verifikation (isoliert gegen Kopie der 26MB-Live-DB):** Rename ok (keepmind.db aus claude-mem.db), Health `status:ok/mcpReady`, Counts **identisch 4082/1409/1495**, FTS-Suche liefert Treffer, sqlite-vec round-trip ok, Worker bootet auch mit **nur `KEEPMIND_*`**-Env. Test-Worker gestoppt, tmp bereinigt, Live-Worker (37782) unberührt.
- **☐ Offen:** (1) `npm run build-and-sync` → Marktplatz-Sync + **Live-Worker-Restart** (benennt echte `~/.keepmind/claude-mem.db`→`keepmind.db` beim Start um). (2) `git push` (5 Commits ahead). Beides User-Freigabe.

## ✅ Finale Integration — DURCHGEFÜHRT (2026-07-01)
- **Plugin installiert** via `npx keepmind install --provider claude --no-auto-start`: `known_marketplaces.json` (keepmind→github ManuelStaggl/keepmind), `installed_plugins.json` (keepmind@keepmind @ cache/1.0.0), `settings.json enabledPlugins` `keepmind@keepmind:true` / `claude-mem@thedotmack:false`. Plugin-Layout + hooks.json + .mcp.json + Native-Deps (vec0.dll) im Marktplatz. Settings-Backup unter `~/.claude/settings.json.bak-*`.
- **Migration ausgeführt** (Adopt): `~/.keepmind/claude-mem.db` = 157 Sess / 4029 Obs / 1407 Summ / 1494 Prompts (verlustfrei, Quelle unangetastet).
- **Runtime verifiziert**: Marktplatz-Worker `status:ok, version:1.0.0, mcpReady:true`, Vektor sqlite-vec v0.1.9 round-trip ok. FTS/BM25-Suche über migrierte Inhalte liefert Treffer (projekt-gescopt). Vektor-Backfill embedded real (0 → 21k+ Chunks).
- **2 Integrations-Bugs gefunden & gefixt:** (1) `fix(install)` `fbd33ee` — Marktplatz-Deps via bun statt npm (npm-ERESOLVE ließ Worker an `zod/v3` crashen); (2) `fix(vector)` `28d6bdd` — VectorSync lud SessionStore per Runtime-`createRequire` → im Bundle `Cannot find module` → **jeder** Backfill scheiterte (Vektorstore blieb leer). Beide committet + verifiziert.
- **Vektor-Backfill real ausgeführt:** `~/.keepmind/vector-db/vectors.db` = **26.073 Chunks** (20.366 Obs / 5.260 Summ / 447 Prompts) über alle migrierten Projekte; KNN-Semantiksuche verifiziert. War beim Stopp noch nicht 100% durch (keine „all projects complete"-Logzeile) → **Rest resumt watermark-basiert beim ersten echten Worker-Start.**

## ⚠️ Git-Stand (WICHTIG bei Resume)
- **Working-Tree sauber**, ABER `main` ist **`ahead 3`** von `origin/main` — **noch NICHT gepusht:** `28d6bdd` (fix vector), `fbd33ee` (fix install), `8cc3a82` (docs). Gepusht ist bis `843abc0`. → Bei Bedarf `git push` (User fragen).

## ☐ Dein letzter Schritt (User-Aktion, nicht automatisierbar)
- **Claude Code komplett neu starten.** Dann: SessionStart-Hook startet echten Worker (ephemeral Port) → MCP-Tools `mcp__keepmind__*` aktiv → Rest-Backfill läuft im Hintergrund fertig. Einmaliger Warmup sättigt kurz den Embedder (Suchen können ~Minuten hängen), danach responsiv.
- **Vor dem Neustart:** sicherstellen, dass keine Test-Worker-Daemons laufen (aktuell 0 — sauber).

## ☐ Offen (in Reihenfolge)
1. **Cleanup** — (a) 8 vorbestehende tsc-Typfehler in `worker-service.ts` (`RestartVerifyResult`-Props + `Logger.flush`); (b) ~~Schema-Versionskollision v34/v35~~ ✅ (`8394f94`); (c) bun-Reste (`"test":"bun test"`, Wartungs-`.ts`, `gen-plugin-lockfile` build-time bun); (d) tote uvx-Helper + Chroma-Settings-Keys; (e) Installer-Schlusszeile sagt noch „claude-mem installed successfully!" (kosmetisch).
2. **Optional:** Erster post-restart Warmup-Backfill (~10 min CPU, ~25k Chunks) sättigt den Single-Thread-Embedder → HTTP-Suche kann währenddessen kurz hängen. Fire-and-forget, einmalig, resumierbar — ggf. Backfill drosseln/yielden für bessere Responsiveness.

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
