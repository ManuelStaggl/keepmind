import { describe, it, expect } from 'bun:test';
import { parseAkte, stripMarkdownLinks, stripSoftHyphens } from '../../src/services/curated/akten-parser.js';

// Every fixture below is a real header shape from the 130-record corpus this
// reader was measured against, reduced to the part under test. They are not
// invented: a parser tested only on invented input reports its own assumptions
// back at you, which is exactly how the first attempt reached "61% recovered"
// and believed it was done.

describe('parseAkte — heading', () => {
  it('splits the record number from the title on an em dash', () => {
    const a = parseAkte('# 0068 — Beurteilt wird in echten Anwendungen\n');
    expect(a.id).toBe('0068');
    expect(a.title).toBe('Beurteilt wird in echten Anwendungen');
    expect(a.headingLine).toBe(1);
  });

  it('accepts en dash and hyphen as the separator', () => {
    expect(parseAkte('# 0042 – Titel\n').id).toBe('0042');
    expect(parseAkte('# 0042 - Titel\n').id).toBe('0042');
  });

  it('leaves id null for files that are not records', () => {
    // LIESMICH.md / VORLAGE.md carry no number. The importer skips them by
    // this signal rather than by filename, which would be a second rule to
    // keep in sync.
    const a = parseAkte('# Verzeichnis der Akten\n\nirgendwas\n');
    expect(a.id).toBeNull();
    expect(a.title).toBe('Verzeichnis der Akten');
  });
});

describe('parseAkte — field harvesting', () => {
  it('reads the ordinary `**Label:** value · **Label:** value` header', () => {
    const a = parseAkte(
      '# 0001 — Titel\n\n**Datum:** 05.08.2026, abends · **Entschieden von:** Manuel · **Stand:** gilt\n\n## Ausgangslage\n\nText\n'
    );
    expect(a.date).toBe('05.08.2026, abends');
    expect(a.decidedBy).toBe('Manuel');
    expect(a.status).toBe('gilt');
    expect(a.body).toContain('## Ausgangslage');
  });

  it('keeps a wrapped field value whole across a line break', () => {
    // 0068: `**Schränkt ein:** 0042, 0043,\n0044, 0045`. Reading line by line
    // silently truncates this to two of the four targets.
    const a = parseAkte(
      '# 0068 — Titel\n\n**Datum:** 09.08.2026 · **Schränkt ein:** 0042, 0043,\n0044, 0045\n\n## X\n'
    );
    const f = a.fields.find(x => x.name === 'Schränkt ein');
    expect(f?.value).toBe('0042, 0043, 0044, 0045');
  });

  it('treats the verb as a field NAME when the corpus writes it that way', () => {
    const a = parseAkte('# 0068 — Titel\n\n**Schränkt ein:** 0042\n\n## X\n');
    expect(a.fields.map(f => f.name)).toContain('Schränkt ein');
  });

  it('keeps a `·` that belongs to the value rather than starting a field', () => {
    // `**Vermerk:** **begrenzt 0089** · wendet 0092 an` is ONE field. A split
    // on every `·` loses the second relation entirely.
    const a = parseAkte('# 0090 — Titel\n\n**Vermerk:** **begrenzt 0089** · wendet 0092 an\n\n## X\n');
    const f = a.fields.find(x => x.name === 'Vermerk');
    expect(f?.value).toBe('**begrenzt 0089** · wendet 0092 an');
    expect(a.fields.filter(x => x.name === 'Vermerk')).toHaveLength(1);
  });

  it('reads a header that is entirely inside one bold span', () => {
    // 0119 uses this shape. Without it the record loses its status outright.
    const a = parseAkte(
      '# 0119 — Titel\n\n**Stand: gilt · 12.08.2026 · von Manuel entschieden · Schliesst: —**\n\n## X\n'
    );
    expect(a.status).toBe('gilt');
    expect(a.fields.map(f => f.name)).toContain('Schliesst');
    // In THIS shape `·` separates fields, so the date and the author are not
    // swallowed into the status — but they carry no label either, so they are
    // reported as unlabelled rather than guessed into date/decidedBy.
    expect(a.unlabelled).toContain('12.08.2026');
    expect(a.unlabelled).toContain('von Manuel entschieden');
    expect(a.date).toBeNull();
  });

  it('does not mistake a bold marker without a colon for a field', () => {
    // 0115 carries `**Leitentscheidung**` as a marker, not a label.
    const a = parseAkte(
      '# 0115 — Titel\n\n**Datum:** 11.08.2026 · **Entschieden von:** Manuel · **Leitentscheidung** ·\n**Schliesst:** V-0027\n\n## X\n'
    );
    expect(a.fields.map(f => f.name)).not.toContain('Leitentscheidung');
    expect(a.fields.map(f => f.name)).toContain('Schliesst');
    expect(a.decidedBy).toContain('Manuel');
  });

  it('records the 1-based line of each field for citation', () => {
    const a = parseAkte('# 0001 — Titel\n\n**Datum:** 05.08.2026\n**Vermerk:** löst 0093 ab\n\n## X\n');
    // Header lines are joined for value continuity, but each label keeps the
    // line it was written on — that is what A4 cites.
    expect(a.fields.find(f => f.name === 'Datum')?.line).toBe(3);
    expect(a.fields.find(f => f.name === 'Vermerk')?.line).toBe(4);
  });

  it('reports a record that carries no status rather than inventing one', () => {
    // 0113/0114/0115 genuinely have no `Stand:`. Defaulting it to "gilt" would
    // make three records claim a validity nobody wrote down.
    const a = parseAkte('# 0113 — Titel\n\n**Datum:** 11.08.2026 · **Schliesst:** V-0008\n\n## X\n');
    expect(a.status).toBeNull();
  });
});

describe('parseAkte — body and header separation', () => {
  it('stops the header at the first blank line, not at the first section', () => {
    // Record 0001 puts a block quote between the header and `## Ausgangslage`.
    // Running the header to the section heading appended that prose to the
    // last field: the status became "gilt > Nachträglich abgelegt am …".
    // Nothing failed — the value was merely wrong, and no query would match it.
    const a = parseAkte(
      '# 0001 — T\n\n**Datum:** 05.08.2026 · **Stand:** gilt\n\n' +
      '> Nachträglich abgelegt am 06.08.2026, sie ist der Anlass für\n> [0002](./0002-x.md).\n\n' +
      '## Ausgangslage\n\nText\n'
    );
    expect(a.status).toBe('gilt');
    expect(a.headerText).not.toContain('Nachträglich');
    // The quote is prose, so it belongs to the body and must not be lost.
    expect(a.body).toContain('Nachträglich abgelegt am 06.08.2026');
    expect(a.body).toContain('## Ausgangslage');
  });

  it('body starts at the first section heading and is kept verbatim', () => {
    const a = parseAkte('# 0001 — T\n\n**Stand:** gilt\n\n## Ausgangslage\n\nZeile eins\n\n## Entscheidung\n\nZeile zwei\n');
    expect(a.body.startsWith('## Ausgangslage')).toBe(true);
    expect(a.body).toContain('## Entscheidung');
    expect(a.body).toContain('Zeile zwei');
    expect(a.headerText).not.toContain('Ausgangslage');
  });

  it('keeps the raw header text so the edge reader can rescan it', () => {
    const a = parseAkte('# 0083 — T\n\n**Stand:** gilt · löst eine Kollision zwischen 0068 und 0070\n\n## X\n');
    // The relation here has no label of its own; it hides in a Stand value.
    // A2 needs the untouched header, not just the harvested pairs.
    expect(a.headerText).toContain('löst eine Kollision zwischen 0068 und 0070');
  });
});

describe('text reduction helpers', () => {
  it('reduces a markdown link to its text, discarding the href', () => {
    // The href is a slug built from the target title, so it routinely contains
    // words like "nicht" that flip a later negation check.
    expect(stripMarkdownLinks('[0024](./0024-verbrauch-wird-nicht-geschaetzt.md)')).toBe('0024');
    expect(stripMarkdownLinks('siehe [0002](./0002-x.md) und [0003](./0003-y.md)'))
      .toBe('siehe 0002 und 0003');
  });

  it('removes soft hyphens, which are invisible and split words silently', () => {
    expect(stripSoftHyphens('Sitzungs­aufzeichnungen')).toBe('Sitzungsaufzeichnungen');
  });

  it('strips soft hyphens before parsing, not after', () => {
    const a = parseAkte('# 0024 — T\n\n**Entschieden von:** Steuerstand, auf eine Messung aller Sitzungs­aufzeichnungen\n\n## X\n');
    expect(a.decidedBy).toContain('Sitzungsaufzeichnungen');
  });
});
