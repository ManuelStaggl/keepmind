# keepmind — Optimierungs-Analyse & Arbeitsplan (25.07.2026)

> Ersetzt `KEEPMIND-OPTIMIERUNG-HANDOFF.md`. Der Handoff war auf Stand 1.3.3 geschrieben, aber vier
> von fünf Prioritäten beruhten auf Fehlmessungen oder waren bereits umgesetzt (P1–P5 im Handoff
> wurden gegen Code und Live-Daten geprüft). Diese Datei ist der maßgebliche Stand.

## 1. Handoff-Prüfung — was belegt ist, was nicht

| Handoff-Punkt | Befund | Beleg |
|---|---|---|
| P4: Projekt-Scoping kaputt (531k Obs) | **Widerlegt.** `chroma-sync-state.json` speichert Watermarks (höchste verarbeitete Zeilen-ID), keine Zählungen. | `ChromaSyncState.bump(project, kind, id)`; lokal „Home Assistant: 8777" bei 439 echten Obs, max rowid der Tabelle = 10529 |
| P2: Startblock ≈ 4.000 Tokens | **Fehlmessung, Faktor ~4.** Realer Block: 2.314–3.366 Zeichen ≈ 600–900 Tokens. Die „3.997t read" ist keepminds Kennzahl *Umfang der gelesenen Datensätze*, nicht die Injektionsgröße. Format ist bereits die geforderte datierte Kopfzeilenliste. | `GET /api/context/inject` für 3 Projekte; `TokenCalculator.calculateObservationTokens` |
| P1: weniger aufzeichnen | **Richtig, falsch begründet.** `relevance_count` wird nirgends erhöht (tote Spalte), `last_used_at` nur bei aktivem Expiry → beide Nullwerte sind kein Beweis. „Read/Grep skippen" bringt nur ~16 % der Ereignisse. | Grep über `src/`; Log 21.07.: Read+Grep+ToolSearch = 539 von 3.377 |
| P3: Expiry einschalten | **Richtig, aber gefährlich in dieser Form.** Alle Bestandsdaten haben `last_used_at = NULL` → Fallback Erstelldatum; mit Default (28 d / Grenze 7) wären lokal 9.682 von 10.472 Datensätzen Kandidaten. Zusätzlich löscht R2 auch bei *Soft*-Expiry die Vektoren. | `expiry.ts` Select-Klausel; `MaintenanceLoop.ts:107` |
| P5: Aufräumen | **Richtig, mit konkretem Bug** (siehe 3.4). Log-Retention ist bereits 14 Tage; Problem ist die Menge, nicht das Alter. | `logger.ts:10`; 36 % der Zeilen = „Broadcasting processing status" |

## 2. Der eigentliche Kostentreiber

**≥65 % aller LLM-Turns liefern nichts.** 21.07.: 3.128 Leer-/Prosa-Antworten gegen max. 1.690 erzeugte
Observations. 19.07.: 2.273 gegen 1.190. 18.07.: 2.020 gegen 735 (73 %). Jeder dieser Turns zahlt den
vollen, mitwachsenden Konversations-Prefix.

Ursache: **das gebaute L1-Batching ist faktisch inaktiv.** `claimAdditionalObservations` sammelt nur
ein, was zufällig *schon* wartet; ohne Sammelfenster ist der Puffer fast immer leer → Batch = 1.

## 3. Beschlossene Maßnahmen

### 3.1 Messbar machen (Voraussetzung für alles Weitere)
- `relevance_count` beim Ausliefern erhöhen, `last_used_at` **unabhängig** vom Expiry-Flag schreiben.
- Skip-Antworten von WARN auf DEBUG (3.128 Fehlwarnungen/Tag verdecken echte).
- Ehrliche Statistikzeile: nicht „3.997t read" für einen 900-Token-Block.
- Turn-/Skip-Zähler pro Sitzung, damit die Wirkung von 3.2 messbar ist.

### 3.2 Turn-Verschwendung beenden (größter Budget-Hebel)
- Sammelfenster vor dem Kompressions-Turn, Batch-Obergrenze 3 → 8.
- Erwartung: 3–5× weniger Turns bei gleicher Observation-Qualität.

### 3.3 Injektion dichter statt kleiner
- `budget.ts` rechnet mit dem *gesamten* Datensatz, injiziert aber nur eine Kopfzeile → bei
  geschwätzigen Datensätzen passen nur 11 von 439 Einträgen. Auf gerenderte Größe kalibrieren:
  40–50 Einträge fürs gleiche Token-Geld.
- Relative Altersangabe („vor 3 Tagen") + Warnung bei veralteten Beständen.

### 3.4 Platten-Bugs
- `vectors.db-wal` = 136 MB bei 135 MB DB: `maintain()` checkpointet **vor** dem VACUUM; ein VACUUM im
  WAL-Modus schreibt die ganze DB ins WAL, die dann in Vollgröße liegen bleibt. Zusätzlich fehlt
  `journal_size_limit` für die Vektor-DB (Haupt-DB: 4 MB, deren WAL nur 239 KB) und der
  TRUNCATE-Checkpoint wird nicht auf Erfolg geprüft (scheitert lautlos bei offenen Lesern).
- Log-Lautstärke: „Broadcasting processing status" (11.627/Tag) und „Worker already running and
  healthy" (3.993/Tag) auf DEBUG.

### 3.5 Standard-Einstellungen
- `CLAUDE_MEM_TIER_ROUTING_ENABLED` → `false`: Default-Modell ist Haiku, die einzige Override-Stufe
  (`TIER_SIMPLE_MODEL`) ist *auch* Haiku, `TIER_SUMMARY_MODEL` ist leer. Die Routing-Logik kann also
  nichts sparen, nur den Modell-String und damit den Prompt-Cache wechseln.
- `CLAUDE_MEM_SKIP_TOOLS` erweitern um Ereignisse ohne Erinnerungswert.
- Tote Schlüssel entfernen (`CLAUDE_MEM_PYTHON_VERSION` im node-only Fork, `TIER_SMART/FAST_MODEL`).

### 3.6 Modellwahl — geprüft, bleibt
Haiku 4.5 ($1/$5 pro 1M Tokens) ist die günstigste aktuelle Stufe; Sonnet 5 kostet $3/$15. Die
Vorbelegung `claude-haiku-4-5-20251001` ist korrekt.

## 4. Upstream-Übernahmen (thedotmack/claude-mem 13.9.1 → 13.12.4, 300 Commits)

Upstream hat das Token-Problem (#618) **nicht** gelöst — dort sind ~20 der Commits Cloud-Sync-Arbeit,
die dieser Fork bewusst nicht hat. Übernommen wird, was hier wirkt:

| Upstream | Wirkung hier |
|---|---|
| `09391a74` Observer-Thinking abschalten | Spart Denk-Tokens bei **jedem** Kompressions-Turn |
| `7435435b` Datei-Kontext für Subagenten überspringen | Spart Tokens pro Subagent-Read |
| `b1984920` SessionStart gibt zwei JSON-Objekte aus | Bug ist hier reproduzierbar (Hook-Ausgabe) |
| `309125bd` / `ecf9a61a` Suche: Datumsfilter + `type`-Alias | Wiederfindbarkeit — `date_from` kommt in unserem `SearchManager` gar nicht vor |
| `0409d9e4` Ausgeschlossene Projekte bei der Injektion beachten | Scoping-Korrektheit |
| `48319a43` Auf Lesesperren warten statt zu scheitern | Weniger stille Kontext-Ausfälle |
| `c7d72411` MCP-Tool `__IMPORTANT` umbenennen | Strikte Clients laden den Server sonst nicht |
| `641ff245` Observer-Transkripte nicht persistieren | Plattenplatz |

Bewusst **nicht** übernommen: alles zu `sync-hub`/`cloud-sync` (in P3 entfernt), Windows-`windowsHide`
(hier eigenständig gelöst), Chroma-spezifische Fixes (kein Chroma mehr).

## 5. Abnahme

**Gemessen gegen eine Kopie der Live-DB (isolierter Test-Worker, Live-Worker unberührt):**

| Prüfung | Vorher | Nachher |
|---|---|---|
| Startblock, gelistete Einträge (3 größte Projekte) | 11 | 38–40 |
| Startblock, echte Größe | ~900 Tokens | ~1.300–1.580 Tokens |
| Datierte Suche (`date_from`/`date_to`) | Filter ignoriert, Treffer aus Mai–Juli | korrekt auf 18.–19.07. begrenzt |
| `relevance_count` / `last_used_at` | 0 / NULL für **alle** Zeilen | wird bei Injektion und `get_observations` geschrieben (verifiziert) |
| Relative Altersangabe | fehlte | `### Jul 19, 2026 (6 days ago)` |
| Startblock-JSON-Fehler beim Sitzungsstart | zwei JSON-Objekte | genau eines |

Ergebnis Startblock: **3,5× mehr Zeitachse für ~45 % mehr Tokens.** Wer es kleiner will, dreht
`memoryQuality.injection.tokenBudget` in `~/.keepmind/settings.json` herunter.

**Noch offen (nur im Live-Betrieb messbar, braucht Deploy):**
1. Turns pro Sitzung und Skip-Quote — die neuen Zähler loggen das bei Generator-Ende als
   „Compression economics" (`compressionTurns` / `skippedBatches` / `skipRatio`). Vorher: ≥65 %.
2. `vectors.db` + WAL in MB nach 24 h — erwartet: WAL fällt von ~136 MB auf ≤4 MB.
3. Gegentest Wiederfindbarkeit über den echten MCP-Pfad.
