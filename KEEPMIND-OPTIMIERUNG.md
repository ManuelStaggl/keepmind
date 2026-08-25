# keepmind — Optimierung: Auftrag, Messwerte, Stand

> **Eine Datei statt zwei.** Bis 25.08.2026 lagen `KEEPMIND-OPTIMIERUNG-HANDOFF.md` (Auftrag +
> Messwerte vom Firmen-PC, 25.07.2026) und `KEEPMIND-OPTIMIERUNG-ANALYSE.md` (Prüfung dieses
> Auftrags gegen Code und Live-Daten) nebeneinander. Sie überschnitten sich in vier von fünf
> Punkten und widersprachen sich in dreien — wer nur eine der beiden las, arbeitete an
> widerlegten Annahmen. Diese Datei ist der maßgebliche Stand; beide Vorgänger sind entfernt.
>
> Was aus dem Handoff **erhalten** bleibt: die stehenden Entscheidungen (Abschnitt 1), die
> gemessene Ausgangslage (Abschnitt 2) und die Randbedingungen (Abschnitt 6). Was **entfällt**:
> die vier Prioritäten, die die Prüfung widerlegt hat — sie stehen in Abschnitt 3 mit dem Beleg,
> warum, damit sie nicht ein drittes Mal aufgegriffen werden.

---

## 1. Stehende Entscheidungen

- **Anthropics eingebautes Gedächtnis bleibt abgeschaltet** (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`).
  Begründung: veraltete Notizen werden ungefragt als Wahrheit eingespeist, harte Zeilen-Obergrenze
  mit stillem Vergessen, Widersprüche stapeln sich, nur wörtliche Suche. Die 62 alten Notizdateien
  wurden gelöscht. **Nicht wieder aktivieren.**
- **Folge: keepmind ist das einzige Langzeitgedächtnis.** Daraus der Anspruch: (a) sparsam,
  (b) nie Veraltetes als aktuell, (c) verlässlich wiederfindbar.
- **Leitprinzip:** Erinnerungen ungefragt als Wahrheit einspeisen ist eine Fehlerquelle; datiert
  ablegen und bei Bedarf suchen ist der sichere Weg.
- **Kein neues Werkzeug ohne Anlass.** Neues nur, wenn es etwas Bestehendes ersetzt oder ein
  belegtes Problem löst.
- **Weg B (25.08.2026):** Das Bleibende — Entscheidungen, Regeln, Erkenntnisse, der laufende
  Übergabestand — lebt direkt in keepmind und wird dort an Ort und Stelle geändert. Offene Arbeit
  lebt im Issue-Tracker des jeweiligen Code-Repos. Datei-Ablagen entfallen. Siehe Abschnitt 5.

## 2. Gemessene Ausgangslage (Firmen-PC, 25.07.2026)

`~/.keepmind` = 718 MB: `vector-db` 458,5 MB (+22,6 MB Modell), Hauptordner 149,5 MB
(`keepmind.db` 114 MB), `logs` 55,8 MB, `backups` 31,2 MB.

Hook-Punkte: `Setup`, `SessionStart` (Worker-Start, Context-Injection, session-acquire),
`UserPromptSubmit`, **`PostToolUse` mit Matcher `*`**, `PreToolUse: Read`, `Stop`, `PreCompact`.

Beobachtungs-Modell: `claude-haiku-4-5`.

Bereits vorhanden und teils nur abgeschaltet (P4, Commit `f5cc233`, Schema v34–v36):
Secret-Scrubbing **an**, Projekt-Scoping **an**, Importance + Budget **an**,
Reconcile/Supersession/Expiry **aus** (Default), In-Session-Optimizer + PreCompact vorhanden.
Die Datensätze führen `valid_from`, `valid_to`, `subject_key`, `importance`, `last_used_at`.

## 3. Handoff-Prüfung — was belegt ist, was nicht

| Handoff-Punkt | Befund | Beleg |
|---|---|---|
| P4: Projekt-Scoping kaputt (531k Obs) | **Widerlegt.** `chroma-sync-state.json` speichert Watermarks (höchste verarbeitete Zeilen-ID), keine Zählungen. | `ChromaSyncState.bump(project, kind, id)`; lokal „Home Assistant: 8777" bei 439 echten Obs, max rowid = 10529 |
| P2: Startblock ≈ 4.000 Tokens | **Fehlmessung, Faktor ~4.** Realer Block: 2.314–3.366 Zeichen ≈ 600–900 Tokens. Die „3.997t read" ist keepminds Kennzahl *Umfang der gelesenen Datensätze*, nicht die Injektionsgröße. Format ist bereits die geforderte datierte Kopfzeilenliste. | `GET /api/context/inject` für 3 Projekte; `TokenCalculator.calculateObservationTokens` |
| P1: weniger aufzeichnen | **Richtig, falsch begründet.** `relevance_count` wurde nirgends erhöht (tote Spalte), `last_used_at` nur bei aktivem Expiry → beide Nullwerte waren kein Beweis. „Read/Grep skippen" bringt nur ~16 % der Ereignisse. | Grep über `src/`; Log 21.07.: Read+Grep+ToolSearch = 539 von 3.377 |
| P3: Expiry einschalten | **Richtig, aber gefährlich in dieser Form.** Alle Bestandsdaten hatten `last_used_at = NULL` → Fallback Erstelldatum; mit Default (28 d / Grenze 7) wären lokal 9.682 von 10.472 Datensätzen Kandidaten gewesen. Zusätzlich löschte R2 auch bei *Soft*-Expiry die Vektoren. | `expiry.ts` Select-Klausel; `MaintenanceLoop.ts:107` |
| P5: Aufräumen | **Richtig, mit konkretem Bug** (siehe 4.4). Log-Retention war bereits 14 Tage; Problem war die Menge, nicht das Alter. | `logger.ts:10`; 36 % der Zeilen = „Broadcasting processing status" |

## 4. Der eigentliche Kostentreiber und die Maßnahmen

**≥65 % aller LLM-Turns lieferten nichts.** 21.07.: 3.128 Leer-/Prosa-Antworten gegen max. 1.690
erzeugte Observations. 19.07.: 2.273 gegen 1.190. 18.07.: 2.020 gegen 735 (73 %). Jeder dieser Turns
zahlte den vollen, mitwachsenden Konversations-Prefix.

Ursache: das gebaute L1-Batching war faktisch inaktiv — `claimAdditionalObservations` sammelt nur ein,
was zufällig *schon* wartet; ohne Sammelfenster ist der Puffer fast immer leer → Batch = 1.

### 4.1 Messbar machen
`relevance_count` beim Ausliefern erhöhen, `last_used_at` unabhängig vom Expiry-Flag schreiben,
Skip-Antworten von WARN auf DEBUG, ehrliche Statistikzeile, Turn-/Skip-Zähler pro Sitzung.

### 4.2 Turn-Verschwendung beenden
Sammelfenster vor dem Kompressions-Turn, Batch-Obergrenze 3 → 8.

### 4.3 Injektion dichter statt kleiner
`budget.ts` rechnete mit dem *gesamten* Datensatz, injiziert aber nur eine Kopfzeile → bei
geschwätzigen Datensätzen passten 11 von 439 Einträgen. Auf gerenderte Größe kalibriert.
Relative Altersangabe („vor 3 Tagen") ergänzt.

### 4.4 Platten-Bugs — **erledigt und am 25.08.2026 nachgemessen**
Der beschriebene Zustand war `vectors.db-wal` = 136 MB neben 135 MB DB. Drei Ursachen, alle behoben:

| Ursache | Fix | Beleg |
|---|---|---|
| Checkpoint lief **vor** dem VACUUM; ein VACUUM im WAL-Modus schreibt die ganze DB ins WAL, das dann in Vollgröße liegen bleibt | Reihenfolge umgedreht: erst `VACUUM`, dann `wal_checkpoint(TRUNCATE)` | `src/services/vector/SqliteVecManager.ts:173-190` |
| `journal_size_limit` fehlte für die Vektor-DB (Haupt-DB: 4 MB) | beim Öffnen gesetzt | `src/services/vector/SqliteVecManager.ts:138` |
| TRUNCATE-Checkpoint wurde nicht auf Erfolg geprüft — scheitert lautlos bei offenen Lesern (`busy=1` statt Fehler) | Rückgabewert geprüft, `busy=1` auf INFO geloggt | `src/services/vector/SqliteVecManager.ts:192-210` |

**Nachmessung 25.08.2026 auf dieser Maschine:** `vectors.db` 62.582.784 B, `vectors.db-wal`
2.117.712 B (≈ 3,4 %, unter dem 4-MB-Deckel). `keepmind.db` 62.341.120 B, `keepmind.db-wal`
4.029.392 B (am Deckel). Der beschriebene Fehler tritt nicht mehr auf.

### 4.5 Standard-Einstellungen
`KEEPMIND_TIER_ROUTING_ENABLED` → `false` (Default-Modell ist Haiku, die einzige Override-Stufe ist
*auch* Haiku, `TIER_SUMMARY_MODEL` leer — die Routing-Logik konnte nichts sparen, nur den
Modell-String und damit den Prompt-Cache wechseln). `KEEPMIND_SKIP_TOOLS` erweitert. Tote Schlüssel
entfernt.

### 4.6 Modellwahl — geprüft, bleibt
Haiku 4.5 ($1/$5 pro 1M Tokens) ist die günstigste aktuelle Stufe; Sonnet 5 kostet $3/$15.
Die Vorbelegung `claude-haiku-4-5-20251001` ist korrekt.

## 5. Weg B — keepmind ohne Datei-Ablage (25.08.2026)

Drei Bausteine, alle gebaut:

1. **Direktes Anlegen und Ändern.** `keepmind curated:add|edit|supersede|close|show` und die
   MCP-Werkzeuge `curated_add|curated_edit|curated_supersede|curated_close|curated_get` schreiben
   einen bleibenden Eintrag ohne Quelldatei. Kennung ist die Aktennummer; ein Edit ändert **denselben**
   Eintrag, die Vorfassung behält ihren Text und bekommt ihr Gültigkeitsfenster geschlossen.
   `src/services/curated/authoring.ts`.
   **Der Trick, der die Determinismus-Garantie hält:** die Felder werden in die kanonische Aktenform
   *gerendert* und dann durch `parseAkte` + `extractEdges` — die Leser des Datei-Imports — wieder
   eingelesen und **geprüft**. Weichen erklärte und rückgelesene Beziehungen ab, wird nichts
   gespeichert. Es gibt also keinen zweiten Regelsatz, der mit dem ersten übereinstimmen *soll*.
2. **Export/Import.** `keepmind export <dir>` / `keepmind import <dir>` — JSONL je Tabelle plus
   Manifest mit Zeilenzahl und SHA-256 je Datei. Vektoren reisen **nicht** mit (abgeleitet, an den
   Embedder gebunden) und werden beim Import neu gebaut. `src/services/portability/`.
3. **Migrations-Abnahme.** `keepmind curated:verify` vergleicht den Datei-Altbestand mit dem, was in
   keepmind liegt: Aktenzahl, erklärte Beziehungen und Gültigkeitsfenster.
   `src/services/curated/migration-verify.ts`.

**Grenze:** Der datei-basierte Einleser (`akten-parser`, `vorgang-parser`, `ereignis-log`) bleibt
lauffähig — er wird für die einmalige Übernahme des Altbestands gebraucht. Die Dateien werden erst
entfernt, wenn `curated:verify` „vollständig" meldet.

## 6. Randbedingungen

- **Windows-only Fork, node-only** — kein Docker, keine Cloud. Bun nur zum Installieren und Bauen.
- **Nie gegen die Live-DB entwickeln**, immer Kopie; Migrationen idempotent.
- **Pushen nur auf Freigabe** des Users.
- **Upstream mitlesen**: löst `thedotmack/claude-mem` das Token-Problem (#618), Fix übernehmen statt
  selbst bauen.
- ~~Der User programmiert nicht und kann keinen Code lesen; in Alltagssprache berichten.~~
  **Überholt (25.08.2026):** der Auftrag verlangt ausdrücklich „Berichte technisch mit Belegen
  (Pfade)". Hier bewusst durchgestrichen statt gelöscht, damit die alte Fassung nicht aus einer
  Kopie zurückkommt.

## 7. Nicht zu tun

- Eingebautes Anthropic-Gedächtnis **nicht** wieder aktivieren.
- Keine Cloud-/Postgres-Anbindung zurückholen.
- Keine Umstellung auf mem0/Hindsight o. ä. — geprüft und verworfen.
- Chroma nicht wieder einführen.

## 8. Abnahme

**Gemessen gegen eine Kopie der Live-DB (isolierter Test-Worker, Live-Worker unberührt):**

| Prüfung | Vorher | Nachher |
|---|---|---|
| Startblock, gelistete Einträge (3 größte Projekte) | 11 | 38–40 |
| Startblock, echte Größe | ~900 Tokens | ~1.300–1.580 Tokens |
| Datierte Suche (`date_from`/`date_to`) | Filter ignoriert, Treffer aus Mai–Juli | korrekt begrenzt |
| `relevance_count` / `last_used_at` | 0 / NULL für **alle** Zeilen | wird bei Injektion und `get_observations` geschrieben |
| Relative Altersangabe | fehlte | `### Jul 19, 2026 (6 days ago)` |
| Startblock-JSON beim Sitzungsstart | zwei JSON-Objekte | genau eines |
| `vectors.db-wal` neben 135 MB DB | 136 MB | 2,1 MB neben 62,6 MB (25.08.2026) |

Ergebnis Startblock: **3,5× mehr Zeitachse für ~45 % mehr Tokens.** Wer es kleiner will, dreht
`memoryQuality.injection.tokenBudget` in `~/.keepmind/settings.json` herunter.

**Weg B (25.08.2026):**

| Prüfung | Ergebnis |
|---|---|
| Direkt-Authoring erreicht nur einfache Speicher-Aufrufe (Proxy-Test) | `tests/curated/authoring.test.ts` |
| Edit erzeugt kein Duplikat, Historie bleibt | ebenda |
| Export → frische DB → Import: gleicher Stand, gleiche IDs, gleiche Treffer | `tests/portability/roundtrip.test.ts` |
| Migrations-Rundlauf: Akten, Beziehungen, Gültigkeitsfenster | `tests/curated/migration-verify.test.ts` |

**Noch offen (nur im Live-Betrieb messbar):**
1. Turns pro Sitzung und Skip-Quote — die Zähler loggen das bei Generator-Ende als
   „Compression economics" (`compressionTurns` / `skippedBatches` / `skipRatio`). Vorher: ≥65 %.
2. Gegentest Wiederfindbarkeit über den echten MCP-Pfad.
3. `curated:verify` gegen den echten Altbestand unter `C:\Projekte` — auf dieser Maschine nicht
   vorhanden, muss dort laufen, wo die Dateien liegen.

## 9. Upstream-Übernahmen (thedotmack/claude-mem 13.9.1 → 13.12.4)

Upstream hat das Token-Problem (#618) **nicht** gelöst; ~20 der Commits sind Cloud-Sync-Arbeit, die
dieser Fork bewusst nicht hat. Übernommen wurde, was hier wirkt:

| Upstream | Wirkung hier |
|---|---|
| `09391a74` Observer-Thinking abschalten | Spart Denk-Tokens bei **jedem** Kompressions-Turn |
| `7435435b` Datei-Kontext für Subagenten überspringen | Spart Tokens pro Subagent-Read |
| `b1984920` SessionStart gibt zwei JSON-Objekte aus | Bug war hier reproduzierbar |
| `309125bd` / `ecf9a61a` Suche: Datumsfilter + `type`-Alias | `date_from` kam im `SearchManager` gar nicht vor |
| `0409d9e4` Ausgeschlossene Projekte bei der Injektion beachten | Scoping-Korrektheit |
| `48319a43` Auf Lesesperren warten statt zu scheitern | Weniger stille Kontext-Ausfälle |
| `c7d72411` MCP-Tool `__IMPORTANT` umbenennen | Strikte Clients laden den Server sonst nicht |
| `641ff245` Observer-Transkripte nicht persistieren | Plattenplatz |

Bewusst **nicht** übernommen: alles zu `sync-hub`/`cloud-sync`, Windows-`windowsHide` (hier
eigenständig gelöst), Chroma-spezifische Fixes.
