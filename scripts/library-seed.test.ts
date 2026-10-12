import { createHash } from 'node:crypto';
import {
  canonicalJson, FIA_PERICOPES, foldOrg, libraryItemView, referencedDocs, templateUnits, validateEvent,
  type CollectionDoc, type FlowDoc, type MaterialDoc, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import { buildLibrary, seedEvents, SEED_ORG } from './library-seed';

const build = buildLibrary();
const doc = (hash: string) => build.documents.find((d) => d.hash === hash)!.body;
const item = (itemId: string) => build.items.find((i) => i.itemId === itemId)!;

describe('LangQuest library seed', () => {
  it('names every document by the SHA-256 of its canonical text, and every one validates', () => {
    for (const d of build.documents) {
      expect(createHash('sha256').update(canonicalJson(d.body)).digest('hex')).toBe(d.hash);
    }
    // buildLibrary validates as it goes; a failure would have thrown above.
    expect(build.documents.length).toBeGreaterThan(30);
  });

  it('lists exactly the documents each one refers to, each before the documents that need it', () => {
    const seen = new Set<string>();
    for (const d of build.documents) {
      if (d.body.format !== 'versification@1') expect([...d.body.deps].sort()).toEqual(referencedDocs(d.body));
      for (const dep of 'deps' in d.body ? d.body.deps : []) expect(seen.has(dep)).toBe(true);
      seen.add(d.hash);
    }
    expect(build.items.every((i) => seen.has(i.docHash))).toBe(true);
  });

  it('builds the same hashes twice', () => {
    const again = buildLibrary();
    expect(again.documents.map((d) => d.hash)).toEqual(build.documents.map((d) => d.hash));
    expect(again.items).toEqual(build.items);
  });

  it('has the starters, under ids units and steps can be built from', () => {
    expect(build.items.map((i) => i.itemId)).toEqual(expect.arrayContaining([
      'langquest.versification.eng', 'langquest.versification.org', 'langquest.versification.lxx',
      'langquest.versification.vul', 'langquest.versification.rso', 'langquest.versification.rsc',
      'langquest.template.bible-chapters-eng', 'langquest.template.bible-chapters-rsc', 'langquest.template.bible-books-eng',
      'langquest.template.nt-chapters-eng', 'langquest.template.fia-passages-eng',
      'langquest.flow.standard_bible', 'langquest.flow.spoken_oral', 'langquest.flow.collect_only',
      'langquest.questions.community_check', 'langquest.questions.consultant_check', 'langquest.fia.eng', 'langquest.fia.fra'
    ]));
    expect(new Set(build.items.map((i) => i.itemId)).size).toBe(build.items.length);
    expect(build.items.every((i) => /^langquest\.[a-z0-9._-]+$/.test(i.itemId))).toBe(true);
  });

  it('converts versification counts to numbers', () => {
    const eng = doc(item('langquest.versification.eng').docHash) as VersificationDoc;
    expect(eng.maxVerses['GEN']!.slice(0, 3)).toEqual([31, 25, 24]);
    expect(eng.name).toBe('English');
  });

  it('turns the FIA passages template into FIA\'s passages, in its order', () => {
    const t = doc(item('langquest.template.fia-passages-eng').docHash) as TemplateDoc;
    const eng = doc(t.bible!.versification) as VersificationDoc;
    expect(eng.code).toBe('eng');
    const units = templateUnits(t, 'langquest.template.fia-passages-eng', eng);
    const p = (node: string) => `langquest.template.fia-passages-eng/${node}`;
    expect(units.slice(0, 4)).toEqual([
      { unitId: p('GEN'), parentUnitId: null, kind: 'book', label: 'Genesis', order: 'b0000' },
      { unitId: p('GEN.1.1-2.3'), parentUnitId: p('GEN'), kind: 'passage', label: 'Genesis 1:1–2:3', order: 'b0000p00000' },
      { unitId: p('GEN.2.4-25'), parentUnitId: p('GEN'), kind: 'passage', label: 'Genesis 2:4–25', order: 'b0000p00001' },
      { unitId: p('GEN.3.1-24'), parentUnitId: p('GEN'), kind: 'passage', label: 'Genesis 3:1–24', order: 'b0000p00002' }
    ]);
    const passages = units.filter((u) => u.kind === 'passage');
    expect(passages).toHaveLength(FIA_PERICOPES.length);
    expect(new Set(units.map((u) => u.unitId)).size).toBe(units.length);
  });

  it('divides the Bible into chapters by each versification', () => {
    const t = doc(item('langquest.template.bible-chapters-eng').docHash) as TemplateDoc;
    const units = templateUnits(t, 'x', doc(t.bible!.versification) as VersificationDoc);
    expect(units.filter((u) => u.parentUnitId === 'x/GEN')).toHaveLength(50);
    expect(units.find((u) => u.unitId === 'x/TOB')?.label).toBe('Tobit');
    expect(new Set(units.map((u) => u.order)).size).toBe(units.length);
    const nt = doc(item('langquest.template.nt-chapters-eng').docHash) as TemplateDoc;
    expect(nt.bible!.books.map((b) => b.book)).toHaveLength(27);
    const books = doc(item('langquest.template.bible-books-eng').docHash) as TemplateDoc;
    expect(books.bible!.divide).toBe('books');
    expect(books.bible!.books).toHaveLength(66);
  });

  it('carries each flow\'s kinds, and question sets for their review kinds', () => {
    const f = doc(item('langquest.flow.standard_bible').docHash) as FlowDoc;
    expect(f.kinds.map((k) => k.id)).toEqual(['peer', 'bt', 'community', 'consultant', 'final']);
    expect(f.steps[2]).toEqual({ stepId: 's3', kindIds: ['consultant'], checkpoint: true });
    const q = doc(item('langquest.questions.consultant_check').docHash) as MaterialDoc;
    expect(q).toMatchObject({ kind: 'questions', reviewKindId: 'consultant', language: 'eng' });
    expect(q.questions!.every((x) => x.required === false)).toBe(true);
  });

  it('collects the FIA guides per language, and keeps the demo\'s own guides apart from FIA\'s', () => {
    const eng = doc(item('langquest.fia.eng').docHash) as CollectionDoc;
    expect(item('langquest.fia.eng').name).toBe('FIA study guides (English)');
    expect(eng.entries.map((e) => e.ref)).toEqual(['GEN 2:4-25']);
    const examples = doc(item('langquest.examples.eng').docHash) as CollectionDoc;
    expect(examples.entries.map((e) => e.ref)).toEqual(['LUK 15:11-32', 'JHN 3:1-21']);
    // A hosted seed leaves them out unless asked for.
    expect(buildLibrary({ examples: false }).items.some((i) => i.itemId === 'langquest.examples.eng')).toBe(false);
    expect(eng.entries.every((e) => doc(e.doc).format === 'study@1')).toBe(true);
    const fra = doc(item('langquest.fia.fra').docHash) as CollectionDoc;
    expect(fra.entries.map((e) => e.ref)).toEqual(['GEN 2:4-25']);
  });

  it('publishes through valid events whose ids do not depend on when it runs', () => {
    const a = seedEvents(build, 1_700_000_000_000);
    const b = seedEvents(buildLibrary(), 1_800_000_000_000);
    expect(b.map((e) => e.id)).toEqual(a.map((e) => e.id));
    expect(new Set(a.map((e) => e.id)).size).toBe(a.length);
    expect(a.map((e) => validateEvent(e)).filter(Boolean)).toEqual([]);
    expect(a.every((e) => e.orgId === SEED_ORG.id && e.streamId === '_org')).toBe(true);
    expect(a.map((e) => e.hlc)).toEqual([...a.map((e) => e.hlc)].sort());

    const org = foldOrg(a);
    expect(org.org?.value).toEqual({ name: 'LangQuest' });
    for (const it of build.items) {
      expect(libraryItemView(org.library, it.itemId)).toMatchObject({
        kind: it.kind, name: it.name, source: 'own', shared: true, subscribable: true, current: it.docHash
      });
    }
  });
});
