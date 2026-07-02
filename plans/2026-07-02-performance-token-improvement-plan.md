# Performance & Token-Verbrauch — Verbesserungsplan

**Datum:** 2026-07-02
**Methode:** 4 parallele Analyse-Agenten (LLM-Token-Kosten, Context-Injection, Laufzeit-Performance, Ressourcen), jeweils mit echten Messungen am laufenden System (Worker PID 25640, Port 37777, DB `~/.keepmind`).
**Deliverable:** Priorisierter Maßnahmenplan (Impact × Aufwand).

---

## TL;DR — die drei größten Hebel

1. **Hook-Latenz: ~970 ms → ~300 ms pro Hook (−65 %)** durch schlanken Hook-Client-Entry-Point + Wegfall der bash-Login-Shell + doppeltem Node-Spawn. **Behebt gleichzeitig das „Fenster-Aufflashen" auf Windows.** (Perf P1+P2)
2. **Token/Session: −2.000 bis −12.000 Token** durch Verschlankung der **PostToolUse-Datei-Kontext-Injection** (feuert bei *jedem* `Read`, nicht nur bei Session-Start). (Token T1)
3. **LLM-Kosten: −30 bis −60 % Turns** durch Batching der Observations statt 1 Turn pro Tool-Use. (LLM L1)

Nebenbefund (Korrektheits-Bug, kein Perf): Projekte mit Leerzeichen im Namen (`Windrose Server Manager v2`, `Home Assistant`) bekommen **0 Kontext injiziert** — Projekt-Key-Mismatch.

---

## Gemessener Ist-Zustand (Baseline)

| Dimension | Messung | Wert |
|---|---|---|
| **Hook-Latenz** | voller Produktions-Hook (bash + 2×node + Bundle) | **~970 ms** |
| | davon bash-Login-Shell + Dir-Discovery | ~320 ms (33 %) |
| | davon `worker-service.cjs` 2,3-MB-Bundle-Parse | ~380 ms (39 %) |
| | davon doppelter Node-Start | ~110 ms (11 %) |
| | eigentliche Arbeit (HTTP+DB+Emit) | ~160 ms (16 %) |
| **DB-Queries** | alle Hot-Queries (indiziert) | < 1,5 ms — **kein Hotspot** |
| **Context/Session** | SessionStart-Hint (typisch) | ~800–1.250 Token |
| | Datei-Kontext-Injection (kumulativ/Session) | **~3.000–12.000 Token** |
| **LLM** | Default-Modell | Haiku 4.5 — **bereits gut** |
| | Turns pro Session | 1 pro Tool-Use, **kein Batching** |
| **RAM** | Worker (Ruhe, Modell entladen) | 188 MB |
| **Disk** | `~/.keepmind` gesamt | 215 MB |
| | `vector-db/vectors.db` | **100 MB** (wächst unbegrenzt) |
| | `keepmind.db` | 30 MB (5.055 obs / 1.579 summaries / 1.693 prompts) |

Architektur-Korrektur: **kein Chroma / kein Python-Daemon.** Vector-Search läuft in-process über **sqlite-vec** + **transformers.js** (MiniLM int8, 384-dim) im Worker.

---

## Maßnahmen nach Priorität

### 🥇 Tier 1 — höchster ROI (zuerst umsetzen)

#### P1+P2 — Schlanker Hook-Client + Wegfall bash-Login-Shell & Doppel-Spawn
**Problem:** Jeder Hook-Event startet (a) eine bash-Login-Shell `$SHELL -lc 'echo $PATH'` + `ls -dt`-Discovery (~320 ms), (b) `bun-runner.js`, das nur Node startet um sofort einen **zweiten** Node zu spawnen (~110 ms), (c) der zweite Node parst das **komplette 2,3-MB-Daemon-Bundle** (`Database`, MCP-SDK, `EmbedderService` → `@huggingface/transformers`, alle Routes) obwohl der Hook nur einen HTTP-POST an den Daemon macht (~380 ms).
**Fix:**
- Dediziertes `hook-client.cjs` (Vorbild `worker-cli.js`, 14 KB): liest stdin, prüft `/api/health`+`/api/readiness`, postet Payload, emittiert stdout. **Keine** Daemon-Imports. → ~380 ms → ~30 ms.
- `hooks.json` ruft den Client direkt statt via `bun-runner.js` → Doppel-Spawn entfällt (~60 ms). Plugin-disabled-Check + #2188-stdin-Diagnostik müssen in den neuen Entry migrieren.
- bash-Login-Shell-PATH-Auflösung nur als Fallback, wenn `node` nicht im Standard-PATH — nicht bei jedem Hook. (Vorsicht: historisch fragil wegen nvm/macOS.)
**Impact:** **~970 ms → ~300 ms pro Hook (−65 %)**, bei *jedem* Hook-Event. **Behebt das Fenster-Aufflashen** (weniger/keine sichtbaren Subprozess-Konsolen auf Windows).
**Aufwand:** M (Bundle-Target + hooks.json). PATH-Teil: M–H (Robustheit).
**Risiko:** Mittel (Tree-Shaking muss Daemon-Code sicher ausschließen; Worker-tot-Fallback erhalten).
**Dateien:** neuer `src/cli/hook-client.ts` + Build-Target, `plugin/scripts/bun-runner.js:139`, `plugin/hooks/hooks.json`, `src/services/worker-service.ts:1373`.

#### T1 — PostToolUse-Datei-Kontext-Injection verschlanken
**Problem:** Bei *jedem* `Read` einer getrackten Datei (>1.500 B mit Observations) wird injiziert: 4-Zeilen-Fixheader (~102 Token, **wortgleich bei jedem Read**) + bis zu `DISPLAY_LIMIT=15` Observation-Zeilen. Über 30 Reads/Session = **3.000–12.000 Token** — das 3–15-fache des einmaligen SessionStart-Hints.
**Fix:** (a) Fixheader auf eine kompakte Zeile eindampfen (die 3 Meta-Zeilen `get_observations…`/`smart_outline…`/„supplementary context…"). (b) `DISPLAY_LIMIT` 15 → 3–5.
**Impact:** **~2.000–4.000 Token/Session** (Header) + bis ~250 Token pro betroffenem Read (Limit).
**Aufwand:** S. **Risiko:** Niedrig.
**Dateien:** `src/cli/handlers/file-context.ts:118-123` (Header), `:18` (`DISPLAY_LIMIT`).

---

### 🥈 Tier 2 — hoher Wert, geringer Aufwand (Quick Wins)

#### T2 — `sessionCount` Default 10 → 3–5
Summaries sind 54 % des SessionStart-Hints, oft Quasi-Duplikate. **−220–300 Token/Session.** Aufwand S, Risiko niedrig. `src/shared/SettingsDefaultsManager.ts:123`.

#### T4 — Summary-Felder truncaten (Investigated/Learned/Completed/Next auf ~200 Zeichen/Feld)
**−300–400 Token** in Sessions mit sichtbarem Summary-Block. Aufwand S. `src/services/context/formatters/AgentFormatter.ts:131-134`.

#### L2 — Observer-Idle-Timeout 3 min → ~4,5 min (an Cache-TTL angleichen)
3-min-Idle-Kill liegt unter dem 5-min-Prompt-Cache-TTL → Folge-Turn zahlt Cache-**Write** (1,25×) des ganzen Verlaufs statt Read (0,1×). **−10–30 % effektive Input-Kosten bei stoßweiser Nutzung.** Aufwand S. `src/services/worker/SessionMessageBuffer.ts:5`.

#### R3 — `vectors.db` in Maintenance-Loop aufnehmen
Die Wartungs-Loop pflegt nur `keepmind.db`; `vectors.db` bekommt **kein** `wal_checkpoint`/`VACUUM` → dauerhaft 5,77 MB WAL + kein Reclaim. **~6 MB sofort** + Basis für R2. Aufwand S. `src/services/.../MaintenanceLoop.ts:135-154`, `SqliteVecManager.ts:81-93`.

#### R6 — Backup-Pruning + Einmal-Snapshot entfernen
`backups/claude-mem-pre-12.4.3-*.db` (22 MB) liegt nach abgeschlossener Migration ungenutzt. **~22 MB sofort**, ohne Code (manuell) bzw. Prune-Logik. Aufwand S. `src/services/.../CleanupV12_4_3.ts:167`, `paths.ts:51`.

#### R5 — Log-Retention (Tages-Logs älter als N Tage löschen)
Aktuell unbegrenzt (~6 MB/Tag). Aufwand S. `src/utils/logger.ts:96-97`.

#### L5 — Modell über eine Session stabil halten
Tier-Routing wechselt pro Generator-Neustart das Modell → invalidiert den (modell-scoped) Cache. Innerhalb einer Konversation beim gewählten Modell bleiben. **−10–20 % situativ.** Aufwand S. `src/services/worker/http/routes/SessionRoutes.ts:590-630`.

---

### 🥉 Tier 3 — größere strukturelle Wetten (höherer Impact, mehr Aufwand/Risiko)

#### L1 — Observations batchen statt 1 Turn pro Tool-Use *(größter LLM-Hebel)*
Mehrere gepufferte Observations zu **einem** Prompt koaleszieren (drain-all statt claim-next). Der `SessionMessageBuffer` hält bereits alle Pending im RAM. **−30–60 % Turn-Anzahl** → proportional weniger Output-Token + amortisierter Cache-Prefix.
Aufwand M–L. Risiko M (1:1-Turn-Dedup-Semantik ist bewusst; A/B-Qualität testen). `SessionMessageBuffer.ts:152-194`, `ClaudeProvider.ts:455-515`, `prompts.ts:117-151`.
> Reale Messung möglich via `session.lastUsage`/`total_cost_usd` (bereits erfasst, `ClaudeProvider.ts:322-349`) — vor/nach A/B statt schätzen.

#### R1 — Feldweises Vector-Chunking reduzieren (5,4 → ~2 Vektoren/Item)
Aktuell je Observation ein Vektor für `narrative`, `text` **und jeden einzelnen `fact`**; je Summary 6. Facts bündeln, narrative+text zusammenfassen. **~60 MB Disk (100 → ~40 MB)** + weniger Embed-CPU. Aufwand M. Risiko M (Recall). `src/services/sync/VectorSync.ts:190-224`.

#### R2 — Orphan-Vektoren beim Expiry löschen
Vektoren werden bei Observation-Expiry **nie** mitgelöscht (einzige DELETE ist Upsert-by-`chunk_key`). Bei Expiry `DELETE FROM vec_documents WHERE chunk_key LIKE 'obs_<id>_%'`. Verhindert unbegrenztes Wachstum. Aufwand M. `expiry.ts:60-72`, `SqliteVecManager.ts:129`.

#### L3 — Wachsenden Konversationskontext cappen (Claude-Pfad)
Claude-Pfad hat **keinen** Kontext-Cap (Gemini/OpenRouter: 20). Fenster/Trim oder periodischer `forceInit` nach N Observations verhindert quadratisches Wachstum + „prompt is too long"-Aborts. Aufwand M. Risiko M (Dedup-Kontext). `ClaudeProvider.ts:191-253`.

#### L4 — Identity als System-Prompt statt User-Turn + Continuation-Redundanz streichen
~1,1k-Token-Identity/Format-Block reist im User-Turn mit und wird bei jedem Generator-Neustart **re-injiziert** (obwohl via `resume` schon im Verlauf). Über `customSystemPrompt` liefern → stabiler Cache-Prefix. **−~1k Token/Neustart.** Aufwand S–M. `hardened-options.ts:115-136`, `prompts.ts:24,187-245`.

#### L6 / T5 — Truncation- & Budget-Kalibrierung
- L6: `OBS_PROMPT_FIELD_MAX_CHARS` 16.000 → 8.000 (bis −50 % frischer Input auf großen Read/Bash-Outputs). Risiko M. `prompts.ts:99`.
- T5: Context-Budget auf **gerenderte** Größe umstellen (misst aktuell Volltext, rendert nur Titel → nur 12 statt 50 Zeilen). + harter Deckel auf `full=true` (aktuell 999999 → 20.500-Token-Worst-Case). `src/services/context/budget.ts:20`, `ContextBuilder.ts:189-192`.

---

## Separater Korrektheits-Bug (nicht Perf, aber wichtig)

**Projekt-Key-Mismatch bei Leerzeichen im Namen:** `Windrose Server Manager v2` (1.302 obs) und `Home Assistant` (285 obs) liefern **0 Zeichen Kontext** — die `getProjectContext`-Key-Ableitung matcht nicht. Diese Projekte bekommen gar kein Memory injiziert. Sollte unabhängig vom Perf-Plan gefixt werden.

---

## Was NICHT anfassen

- **DB-Queries / Indizes:** alle Hot-Queries < 1,5 ms, 35+ Indizes, keine N+1. Der zusammengesetzte Index `(project, created_at)` bringt < 1 ms — nicht priorisieren.
- **Modell-Default:** bereits Haiku 4.5, simple Tools bleiben auf Haiku. Nur sicherstellen, dass `summary`-Tier nicht versehentlich auf Sonnet/Opus zeigt.

---

## Vorgeschlagene Umsetzungsreihenfolge

1. **Sprint 1 (Quick Wins, S):** T1, T2, T4, R3, R6, R5, L2, L5 — viel Token-/Disk-Ersparnis, geringes Risiko, keine Architektur-Änderung.
2. **Sprint 2 (Headline-Fix, M):** P1+P2 — schlanker Hook-Client. Größter Latenz-Gewinn + behebt Fenster-Flashing. Sorgfältig testen (Tree-Shaking, PATH-Fallback, Windows).
3. **Sprint 3 (strukturell, M–L):** L1 (Batching) mit A/B-Messung, R1+R2 (Vector-Chunking + Orphan-Cleanup), danach L3/L4/L6/T5 nach Bedarf.

Messung vor/nach jeweils über die bereits vorhandenen Instrumente (`total_cost_usd`, `time`-Hook-Messung, Disk-`Measure-Object`).
