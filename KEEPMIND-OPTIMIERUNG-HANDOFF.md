<!-- cwd: C:\Users\Administrator\Desktop\Projekte\keepmind -->
# Handoff für die keepmind-Optimierung (erstellt auf dem Firmen-PC, 25.07.2026)

> **Für Claude Code auf dem Heim-Rechner.** Diese Datei ist der Auftrag + alle Messwerte aus der
> Produktivumgebung. **Zuerst zusätzlich `HANDOFF.md` im Repo lesen** — das ist der maßgebliche
> Entwicklungsstand; diese Datei ergänzt ihn nur um Auftrag, Messwerte und Reihenfolge.

**Repo:** `github.com/ManuelStaggl/keepmind` (privat) · lokal `C:\Users\Administrator\Desktop\Projekte\keepmind` · Branch `main`
**Upstream für Cherry-Picks:** `thedotmack/claude-mem` (Apache-2.0)
**Installierte Fassung auf dem Firmen-PC:** keepmind **1.3.3**, letzter Commit dort `ec2a9cb` (19.07.2026)

---

## 1. Warum das jetzt wichtig ist (Entscheidung vom 25.07.2026)

Auf dem Firmen-PC wurde das komplette Claude-Setup geprüft. Ergebnis der Gedächtnis-Frage:

- **Anthropics eingebautes Gedächtnis bleibt dauerhaft ABGESCHALTET** (`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`).
  Begründung aus Erfahrungsberichten: veraltete Notizen werden ungefragt als Wahrheit eingespeist, harte
  Zeilen-Obergrenze mit stillem Vergessen, Widersprüche stapeln sich, nur wörtliche Suche.
  **Diese Einstellung ist jetzt gewollt — nicht als Nebenwirkung der Installation, sondern als Entscheidung.
  Nicht wieder aktivieren.**
- Die 62 alten Notizdateien des eingebauten Gedächtnisses (18.06.–01.07., 11 Projekte) wurden auf
  Anweisung des Users **gelöscht** („bisher haben wir sie auch nicht vermisst").
- **Folge: keepmind ist ab jetzt das EINZIGE Langzeitgedächtnis.** Damit steigt der Anspruch:
  es muss (a) sparsam sein, (b) nie veraltete Aussagen als aktuell darstellen, (c) verlässlich wiederfinden.

**Leitprinzip für alle Änderungen** (aus der Recherche, gilt als Designregel):
> Erinnerungen ungefragt als Wahrheit einspeisen = Fehlerquelle.
> Datiert ablegen + bei Bedarf suchen = sicherer Weg.
keepmind ist konzeptionell auf der richtigen Seite — der Ausbau soll das schärfen, nicht verwässern.

## 2. Gemessener Ist-Zustand auf dem Firmen-PC (25.07.2026, ~17:45)

**Datenumfang `~/.keepmind` — 718 MB gesamt:**

| Ort | Dateien | MB |
|---|---|---|
| `vector-db` (inkl. Modell) | 3 (+4 Modell) | 458,5 (+22,6) |
| Hauptordner (`keepmind.db` 114 MB, `-wal` 2,5 MB, Alt-Backup 32,7 MB) | 14 | 149,5 |
| `logs` | 15 | 55,8 |
| `backups` | 1 | 31,2 |

**Registrierte Hook-Punkte (aus `plugin/hooks/hooks.json`):** `Setup`, `SessionStart` (3 Hooks: Worker-Start,
Context-Injection, session-acquire), `UserPromptSubmit` (session-init), **`PostToolUse` mit Matcher `*`
(observation)**, `PreToolUse: Read` (file-context), `Stop` (summarize), `PreCompact`.

**Messwert Sitzungsstart:** Der eingespielte Kontextblock lag in einer echten Sitzung bei **~4.000 Tokens**
(eigene Zählung von keepmind: „10 obs (3.997t read) | 20.360t work | 80% savings").

**Bekanntes Upstream-Problem, das hier zuschlägt:** claude-mem Issue **#618 „Uses too much tokens"** —
Ursache laut Analyse: `PostToolUse` feuert bei **jedem** Tool-Aufruf eine Zusammenfassung über das Agent-SDK,
plus fester Kontext-Block beim Start. Genau diese beiden Stellen sind unsere Hauptbaustellen.

**Beobachtungs-Modell:** Zusammenfassungen werden mit `claude-haiku-4-5` erzeugt (aus den Datensätzen).

## 3. WICHTIG: Zwei Bausteine existieren schon — sie sind nur AUS

Aus `HANDOFF.md`, Phase **P4 Memory-Qualität** (Commit `f5cc233`, Schema v34–v36):

- Secret-Scrubbing: **AN**
- Projekt-Scoping: **AN**
- Importance + Budget: **AN**
- **Reconcile / Supersession / Expiry: AUS (Default)** ← genau das, was wir brauchen
- In-Session-Optimizer + PreCompact: vorhanden

Die Datensätze führen bereits `valid_from`, `valid_to`, `subject_key`, `importance`, `last_used_at`
(auf dem Firmen-PC verifiziert: `valid_to: null`, `subject_key` gesetzt).
**Das heißt: „Widerspruch ersetzt Alteintrag" und „Verfall" sind implementiert und müssen primär
freigeschaltet, validiert und getunt werden — nicht neu gebaut.**

## 4. Auftrag, in dieser Reihenfolge

### P1 — Aufzeichnung verschlanken (höchste Priorität, spart sofort Budget)
Ziel: nicht mehr bei **jedem** Tool-Aufruf zusammenfassen, sondern bei bedeutsamen Ereignissen
(Datei-Änderung, Entscheidung, Fehler/Fehlschlag, Sitzungsende).
- Erst **messen**: wie viele Observations entstehen pro Sitzung, wie viele davon werden später je gelesen?
  (`relevance_count` / `last_used_at` sind vorhanden — auf dem Firmen-PC standen beide auf 0/null,
  d. h. der Großteil wird offenbar nie wieder abgerufen. Das ist die Rechtfertigung für P1.)
- Dann Filter im `PostToolUse`-Pfad: Read/Glob/Grep/Bash-Leseoperationen erzeugen keine eigene Observation
  mehr, sondern höchstens einen leichten Zähler.
- Erfolgskriterium: Observations pro Sitzung deutlich reduziert, ohne dass die Wiederfindbarkeit leidet
  (Gegentest siehe Abnahme).

### P2 — Sitzungsstart bedarfsgerecht statt fester Block
Statt ~4.000 Tokens Fließtext: **kurze datierte Überschriftenliste** (max. ~600–800 Tokens) plus die klare
Anweisung, bei Bedarf zu suchen (`memory_search`/`observation_search`). Das ist auch das Muster, auf das
andere Lösungen konvergiert sind.
- Alter jedes Eintrags **sichtbar** („vor 3 Tagen"), nicht nur Datum im Feld.
- Erfolgskriterium: Startblock messbar kleiner, Trefferquote beim gezielten Suchen unverändert.

### P3 — Reconcile / Supersession / Expiry einschalten und validieren
- Gegen eine **Kopie** der Live-DB testen (etablierte Praxis im Repo), nicht gegen die echte.
- Neue Aussage zum selben `subject_key` setzt `valid_to` der alten → Suche liefert nur noch Gültiges,
  Historie bleibt aber nachvollziehbar.
- Verfall: Was älter als X Wochen ist, wird nur mit Alters-Warnung ausgeliefert (nicht gelöscht).

### P4 — Verdacht prüfen: stimmt das Projekt-Scoping?
`~/.keepmind/chroma-sync-state.json` weist pro Projekt Zahlen aus, die **nicht plausibel** sind:
`yubikey-manager` (1 Quelldatei) = 28.790 Observations, `spar-samstag` (1 Datei) = 23.758,
`nicht-gesperrt` = 26.257 — während `adcommander` (größtes Repo) nur 11.683 hat.
Summe über alle Projekte ≈ **531.000 Observations / 55.000 Summaries / 65.000 Prompts**.
→ Entweder ist das ein **globaler Watermark je Projekt** (dann ist die Datei nur missverständlich benannt)
oder das **Projekt-Scoping/der Backfill schreibt projektfremde Daten** (dann erklärt das 458 MB Vektor-Daten
und verschlechtert die Trefferqualität). **Das zuerst klären — es kann P1/P5 komplett umkehren.**

### P5 — Aufräumen/Verdichten
- `logs` 56 MB → Rotation/Deckel.
- Alt-Backup `keepmind.db.bak-cwd-remap-*` (32,7 MB, 01.07.) → weg, wenn nicht mehr gebraucht.
- Verdichtung: alte Observations zu Monats-/Themen-Digests zusammenfassen statt einzeln vorzuhalten.

## 5. Abnahme (so wird gemessen, ob es besser wurde)

1. **Budget:** Startblock in Tokens (Ziel: mind. 70 % kleiner) und Observations pro Sitzung (vorher/nachher).
2. **Wiederfindbarkeit — harter Gegentest:** Eine Suche muss weiterhin funktionieren, die auf dem Firmen-PC
   heute funktioniert hat: „JetBrains-Recherche vom 24.07." wurde über `get_observations` gefunden und hat
   echte Arbeit gespart. **Genau dieser Nutzen darf nicht verloren gehen** — er ist die Rechtfertigung dafür,
   keepmind überhaupt zu behalten.
3. **Keine veralteten Aussagen als aktuell:** Nach P3 darf keine Aussage ohne Altersangabe eingespielt werden.
4. **Datenwachstum:** MB pro Woche, nach den Änderungen erneut messen.

## 6. Randbedingungen

- **Windows-only Fork, node-only** — kein bun, kein Docker, keine Cloud. So bleiben.
- **Nie gegen die Live-DB entwickeln**, immer Kopie; Migrationen idempotent (bestehende Praxis im Repo).
- **Pushen nur auf Freigabe** des Users (bestehende Regel).
- **Upstream mitlesen**: Wenn `thedotmack/claude-mem` das Token-Problem (#618) löst, Fix übernehmen statt
  selbst bauen.
- **Kein neues Werkzeug einführen.** Beschlossene Regel vom 25.07.: Neues nur, wenn es etwas Bestehendes
  ersetzt oder ein belegtes Problem löst.
- **Der User programmiert nicht** und kann keinen Code lesen: in Alltagssprache berichten (WAS es bewirkt),
  keine technischen Rückfragen, duzen. Technische Arbeit vollständig tun, nur nicht technisch berichten.
- **Vollständiger Alt-Plan** (falls noch relevant): `~/.claude/plans/sharded-twirling-crab.md`.

## 7. Nicht zu tun

- Eingebautes Anthropic-Gedächtnis **nicht** wieder aktivieren (bewusste Entscheidung, siehe Abschnitt 1).
- Keine Cloud-/Postgres-Anbindung zurückholen (in P3 des Forks bewusst entfernt).
- Keine Umstellung auf mem0/Hindsight o. ä. — geprüft und verworfen (Cloud bzw. zu viel Umbau).
