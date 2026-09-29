import { catalogKey, emptyOrgState, emptyState, buildIndexes, contentTemplate, contentTemplates, type ProjectState } from '@langquest-next/core';
import {
  bibleBook, bookRows, bookSegments, chapterBlocks, chipLabel, continuesInto, fiaStarts, parseRange, partName, pluralOf,
  rangeOfLabel, recordedCount, setAsideCount, suggestionsFor, templateLevels, templateOutline, templateSelectionSpecs,
  toSegments, verseKey, versesText
} from '../src/contentTemplates';

const luke = bibleBook('luk')!;
const reg = <T,>(value: T) => ({ value, hlc: '1', eventId: 'e' });

function withTemplate(templateId: string, laneId = 'L'): ProjectState {
  const s = emptyState();
  s.lanes[laneId] = { languoidId: 'din' };
  for (const spec of templateSelectionSpecs(s, laneId, templateId, 'cmd')) {
    if (spec.type === 'v1.LaneTemplateSelected') s.laneTemplates[laneId] = reg(spec.payload as { templateId: string; catalogVersion: number });
    else if (spec.type === 'v1.UnitAdded') {
      const p = spec.payload as { unitId: string; parentUnitId: string | null; kind: string; label: string; order: string };
      s.units[p.unitId] = { parentUnitId: p.parentUnitId, kind: p.kind, label: p.label, order: p.order } as ProjectState['units'][string];
    }
  }
  return s;
}

describe('verse ranges', () => {
  it('reads chapters, passages and partial verses', () => {
    expect(parseRange('15', luke)).toEqual({ from: { c: 15, v: 1 }, to: { c: 15, v: 32 } });
    expect(parseRange('15:11-32', luke)).toEqual({ from: { c: 15, v: 11 }, to: { c: 15, v: 32 } });
    expect(parseRange('15:30–16:8', luke)).toEqual({ from: { c: 15, v: 30 }, to: { c: 16, v: 8 } });
    expect(parseRange('12:9b-20', luke)).toEqual({ from: { c: 12, v: 9 }, to: { c: 12, v: 20 } });
    expect(parseRange('99', luke)).toBeNull();
    expect(parseRange('Luke', luke)).toBeNull();
  });

  it('reads a unit label against its book', () => {
    expect(rangeOfLabel('Luke', luke)).toEqual({ from: { c: 1, v: 1 }, to: { c: 24, v: 53 } });
    expect(rangeOfLabel('Luke 15', luke)?.to).toEqual({ c: 15, v: 32 });
    expect(rangeOfLabel('John 3', luke)).toBeNull();
  });

  it('writes ranges as the demo does', () => {
    expect(versesText({ from: { c: 15, v: 11 }, to: { c: 15, v: 32 } })).toBe('15:11–32');
    expect(chipLabel(luke, { from: { c: 15, v: 1 }, to: { c: 15, v: 32 } })).toBe('Ch 15');
    expect(chipLabel(luke, { from: { c: 15, v: 11 }, to: { c: 15, v: 32 } })).toBe('15:11–32');
  });

  it('pluralises level names', () => {
    expect(pluralOf('Story')).toBe('Stories');
    expect(pluralOf('Passage')).toBe('Passages');
    expect(pluralOf('Chapter')).toBe('Chapters');
  });
});

describe('segments and blocks', () => {
  it('never lets two parts claim a verse', () => {
    const segs = toSegments(luke, [
      { unitId: 'b', label: 'Luke 12:9b-20' },
      { unitId: 'a', label: 'Luke 12:1-9a' },
      { unitId: 'x', label: 'not a reference' }
    ]);
    expect(segs.map((s) => [s.unitId, versesText(s)])).toEqual([['a', '12:1–9'], ['b', '12:10–20']]);
  });

  it('lays out a chapter: cards where parts start, FIA suggestions, gaps and verse runs', () => {
    const segs = toSegments(luke, [{ unitId: 'p1', label: 'Luke 15:1-10' }]);
    const blocks = chapterBlocks(luke, 15, segs, new Set([verseKey({ c: 15, v: 11 })]), (_c, v) => (v === 1 ? 'Now the tax collectors…' : undefined));
    expect(blocks[0]).toMatchObject({ kind: 'card', n: 1 });
    expect(blocks[1]).toMatchObject({ kind: 'para', n: 1 });
    expect((blocks[1] as { verses: unknown[] }).verses).toHaveLength(10);
    expect((blocks[1] as { verses: { text?: string }[] }).verses[0]!.text).toBe('Now the tax collectors…');
    expect(blocks.slice(2).map((b) => b.kind)).toEqual(['fia', 'gap', 'para']);
    expect(blocks[3]).toEqual({ kind: 'gap', from: 11 });
  });

  it('says which part a chapter continues', () => {
    const segs = toSegments(luke, [{ unitId: 'p', label: 'Luke 15:30-16:8' }]);
    expect(continuesInto(segs, 16)?.unitId).toBe('p');
    expect(continuesInto(segs, 15)).toBeNull();
  });

  it('knows where FIA starts passages', () => {
    const starts = fiaStarts(luke);
    expect(starts.size).toBeGreaterThan(10);
    expect(fiaStarts(bibleBook('lev')!).size).toBe(0);
  });
});

describe('a language on a catalog template', () => {
  it('selects the template and adds its units once', () => {
    const s = withTemplate('bible');
    const again = templateSelectionSpecs(s, 'L', 'bible', 'cmd2');
    expect(again.map((e) => e.type)).toEqual(['v1.LaneTemplateSelected']);
    expect(new Set(again.map((e) => e.id)).size).toBe(again.length);
  });

  it('reads its books and a book as segments', () => {
    const s = withTemplate('bible');
    const idx = buildIndexes(s);
    const rows = bookRows(s, idx, 'L');
    expect(rows).toHaveLength(66);
    expect(rows.find((r) => r.book.itemId === 'luk')?.parts).toBe(24);
    const segs = bookSegments(s, idx, 'L', luke);
    expect(segs).toHaveLength(24);
    expect(segs[14]).toMatchObject({ from: { c: 15, v: 1 }, to: { c: 15, v: 32 } });
    expect(partName(s, 'L')).toBe('Chapter');
  });

  it('reads FIA passages, spelling Mark and John the canon way', () => {
    const s = withTemplate('fia');
    const idx = buildIndexes(s);
    const mark = bookSegments(s, idx, 'L', bibleBook('mar')!);
    expect(mark.length).toBeGreaterThan(5);
    expect(mark[0]!.from).toEqual({ c: 1, v: 1 });
    expect(partName(s, 'L')).toBe('Passage');
  });

  it('counts recorded parts set aside by a change of template', () => {
    const s = withTemplate('bible');
    s.takes['t1'] = { unitId: 'fia@1/luk-p1', laneId: 'L', cardHashes: ['h'], parentTakeId: null, actorId: 'a', hlc: '1', archived: false };
    s.takes['t2'] = { unitId: 'bible@1/luk-15', laneId: 'L', cardHashes: ['h'], parentTakeId: null, actorId: 'a', hlc: '1', archived: false };
    s.takes['t3'] = { unitId: 'hand-added', laneId: 'L', cardHashes: ['h'], parentTakeId: null, actorId: 'a', hlc: '1', archived: false };
    expect(setAsideCount(s, 'L')).toBe(1);
    expect(recordedCount(s, 'L')).toBe(3);
  });
});

describe('templates in the library', () => {
  it('names levels and outlines folders in order', () => {
    const fia = contentTemplate('fia')!;
    expect(templateLevels(fia)).toEqual(['Book', 'Passage']);
    const outline = templateOutline(contentTemplate('bible')!);
    expect(outline).toHaveLength(66);
    expect(outline[0]!.folder.label).toBe('Genesis');
    expect(outline[0]!.items).toHaveLength(50);
    expect(templateOutline(contentTemplate('book')!).every((o) => o.items.length === 0)).toBe(true);
  });

  it('suggests what the project says, then what the organization says unless the project turned it off', () => {
    const org = emptyOrgState();
    const library = contentTemplates();
    org.catalog[catalogKey('template', 'fia', 'org')] = reg(true);
    org.catalog[catalogKey('template', 'bible', 'org')] = reg(true);
    org.catalog[catalogKey('template', 'bible', 'project', 'P')] = reg(false);
    org.catalog[catalogKey('template', 'book', 'project', 'P')] = reg(true);
    expect(suggestionsFor(org, 'P', library)).toEqual([
      { templateId: 'fia', by: 'org' },
      { templateId: 'book', by: 'project' }
    ]);
    expect(suggestionsFor(null, 'P', library)).toEqual([]);
  });
});
