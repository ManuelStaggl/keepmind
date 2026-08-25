# plans/ — Archiv, kein aktueller Plan

**Nichts in diesem Ordner ist ein laufendes Vorhaben.** Die 42 Dokumente hier stammen aus der Zeit
vor und um den Fork (letzte inhaltliche Änderung: 02.07.2026) und beschreiben zu großen Teilen
Themen, die dieser Fork **bewusst nicht hat**: `sync-hub` und Cloud-Sync, Postgres, BullMQ/Redis,
Chroma, Team-Auth, das Server-Beta. Sie sind als *Herkunft* wertvoll — sie erklären, warum
bestimmte Schnittstellen aussehen, wie sie aussehen — und als *Auftrag* irreführend.

Wer hier eine Datei findet und sie für den nächsten Arbeitsschritt hält, arbeitet an einem
Vorhaben, das entweder erledigt oder abgewählt ist. Das ist der Grund, warum diese Notiz existiert
und der Ordner nicht einfach gelöscht wurde: gelöscht wäre die Begründung mit weg.

## Wo der aktuelle Stand steht

| Frage | Datei |
|---|---|
| Was gilt beim Entwickeln, welche Invarianten sind teuer erkauft | [`../CLAUDE.md`](../CLAUDE.md) |
| Was ist fertig, was ist verifiziert (Fork-Phasen P0–P5) | [`../HANDOFF.md`](../HANDOFF.md) |
| Auftrag, Messwerte, Kostenanalyse, Abnahme, Weg B | [`../KEEPMIND-OPTIMIERUNG.md`](../KEEPMIND-OPTIMIERUNG.md) |
| Offene Arbeit | Issue-Tracker des Repos |
| Entscheidungen mit Begründung, laufender Übergabestand | keepmind selbst (`curated:show`, `/checkpoint`) |

## Was hier bewusst abgewählt ist

Aus `CLAUDE.md` und der Fork-Historie, damit es nicht aus einem alten Plan zurückkommt:

- **Chroma** — durch in-process `sqlite-vec` ersetzt. Nicht wieder einführen.
- **Cloud-Sync / `sync-hub` / Postgres / BullMQ / Redis** — in Fork-Phase P3 entfernt.
  Der *lokale* HTTP-Worker samt SQLite-API-Key-Auth bleibt; nur die Cloud-Anbindung ist weg.
- **uv / Python** — mit Chroma verschwunden, der Installer sucht sie nicht mehr.
- **mem0 / Hindsight als Ersatz** — geprüft und verworfen.

Einzelne Dateien hier beschreiben trotzdem Dinge, die es noch gibt (Hook-IO-Disziplin,
Worker-Lebenszyklus, Grammar-Parser). Deren *Ergebnis* steht in `CLAUDE.md`; der Plan dazu ist
abgearbeitet.
