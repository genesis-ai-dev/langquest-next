import fc from 'fast-check';
import fs from 'node:fs';
import path from 'node:path';
import type { AnyEvent } from '../src/events';
import { libraryFlowId, materialApplies, selectFlowSpecs, studyEntriesFor, unitPrefixFor } from '../src/libraryApply';
import type { CollectionDoc, FlowDoc, MaterialDoc, StudyDoc } from '../src/libraryDocs';
import { deriveFlow } from '../src/passage';
import { foldLanguage } from '../src/reducer';
import { emptyLanguageState } from '../src/state';
import { parseRef, sharedVerses, type VersificationDoc } from '../src/versification';

function load(code: string): VersificationDoc {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../library/versifications', `${code}.json`), 'utf8'));
  return {
    format: 'versification@1', code, name: code,
    maxVerses: Object.fromEntries(Object.entries(raw.maxVerses as Record<string, string[]>).map(([b, vs]) => [b, vs.map(Number)])),
    mappedVerses: raw.mappedVerses ?? {}, excludedVerses: raw.excludedVerses ?? [], partialVerses: raw.partialVerses ?? {},
  };
}
const eng = load('eng');
const H = (c: string) => c.repeat(64);
const stamp = (specs: { id: string; type: string; payload: unknown }[]) =>
  specs.map((s, i) => ({ ...s, orgId: 'o', streamId: 'L', actorId: 'a', deviceId: 'd', hlc: `${String(i + 1).padStart(15, '0')}:000000:d` }) as unknown as AnyEvent);

describe('selectFlowSpecs', () => {
  const kindIds = ['k0', 'k1', 'k2', 'k3', 'k4'];
  const flowArb = fc.record({
    kinds: fc.subarray(kindIds, { minLength: 1 }),
    steps: fc.array(fc.record({ kindIds: fc.subarray(kindIds, { minLength: 1 }), checkpoint: fc.option(fc.boolean(), { nil: undefined }) }), { minLength: 1, maxLength: 12 }),
    known: fc.subarray(kindIds),
  });
  const docOf = (f: { kinds: string[]; steps: { kindIds: string[]; checkpoint?: boolean | undefined }[] }): FlowDoc => ({
    format: 'flow@1', name: 'F', description: '', deps: [],
    kinds: f.kinds.map((id) => ({ id, name: `Kind ${id}`, description: 'd', usualReviewer: 'u' })),
    steps: f.steps.map((s, i) => ({ stepId: `s${i}`, kindIds: s.kindIds, ...(s.checkpoint !== undefined ? { checkpoint: s.checkpoint } : {}) })),
  });

  it('defines only the kinds the language lacks, one step per step in the doc, and selects the version last', () => {
    fc.assert(
      fc.property(flowArb, fc.constantFrom('a'.repeat(64), 'b'.repeat(64)), (f, docHash) => {
        const state = emptyLanguageState();
        for (const id of f.known) state.reviewKinds[id] = { value: { id, name: 'Mine', description: '', usualReviewer: '' }, hlc: '1', eventId: 'x' };
        const doc = docOf(f);
        const specs = selectFlowSpecs(state, { commandId: 'cmd', itemId: 'elders', docHash, doc });
        const defined = specs.filter((s) => s.type === 'v1.ReviewKindDefined').map((s) => (s.payload as { kindId: string }).kindId);
        expect(defined).toEqual(f.kinds.filter((k) => !f.known.includes(k)));
        const steps = specs.filter((s) => s.type === 'v1.FlowStepSet').map((s) => s.payload as { stepId: string; order: string; checkpoint: boolean });
        expect(steps).toHaveLength(f.steps.length);
        // Orders sort the way the doc lists them, and a step with no checkpoint flag is not a checkpoint.
        expect(steps.map((s) => s.order)).toEqual([...steps.map((s) => s.order)].sort());
        expect(steps.map((s) => s.checkpoint)).toEqual(f.steps.map((s) => !!s.checkpoint));
        expect(specs[specs.length - 1]!.type).toBe('v1.FlowSelected');
        expect(new Set(specs.map((s) => s.id)).size).toBe(specs.length);
        expect(specs.every((s) => s.id.startsWith('cmd:'))).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it('the language reads back the doc: same steps in order, under the version\'s own flow id; applying twice is once', () => {
    fc.assert(
      fc.property(flowArb, (f) => {
        const doc = docOf(f);
        const args = { commandId: 'cmd', itemId: 'elders', docHash: H('9'), doc };
        const once = foldLanguage(stamp(selectFlowSpecs(emptyLanguageState(), args)));
        const flow = deriveFlow(once);
        expect(flow.flowId).toBe(libraryFlowId('elders', H('9')));
        expect(flow.steps.map((s) => s.kindIds)).toEqual(f.steps.map((s) => s.kindIds));
        // Ids come from the command and the doc, so a second admin applying it offline writes the same events.
        const again = stamp(selectFlowSpecs(emptyLanguageState(), args));
        expect(foldLanguage([...stamp(selectFlowSpecs(emptyLanguageState(), args)), ...again])).toEqual(once);
      }),
      { numRuns: 60 },
    );
  });

  it('a new version of the flow gets steps under its own prefix and never removes the old ones', () => {
    const doc: FlowDoc = { format: 'flow@1', name: 'F', description: '', deps: [], kinds: [], steps: [{ stepId: 's1', kindIds: ['a'] }] };
    const v1 = selectFlowSpecs(emptyLanguageState(), { commandId: 'one', itemId: 'f', docHash: H('1'), doc });
    const v2 = selectFlowSpecs(emptyLanguageState(), { commandId: 'two', itemId: 'f', docHash: H('2'), doc });
    expect(v1.some((s) => s.type === 'v1.FlowStepRemoved') || v2.some((s) => s.type === 'v1.FlowStepRemoved')).toBe(false);
    const ids = [...v1, ...v2].filter((s) => s.type === 'v1.FlowStepSet').map((s) => (s.payload as { stepId: string }).stepId);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('studyEntriesFor', () => {
  const collection = (refs: string[]): CollectionDoc => ({
    format: 'collection@1', title: 'C', description: '', versification: H('e'), deps: [],
    entries: refs.map((ref, i) => ({ ref, title: `T${i}`, doc: H(String(i)) })),
  });
  const passage = (ref: string) => ({ range: parseRef(ref)!, versification: eng });

  it('skips entries it cannot read and entries of another book, and ranks by verses shared (ties by reference)', () => {
    const got = studyEntriesFor(passage('JOL 2:1-11'), {
      doc: collection(['JOL 2:5-6', 'JOL 2:1-11', 'nonsense', 'AMO 1:1-5', 'JOL 2:10-20', 'JOL 1:1-5']),
      versification: eng,
    });
    expect(got.map((g) => [g.entry.ref, g.shared])).toEqual([['JOL 2:1-11', 11], ['JOL 2:10-20', 2], ['JOL 2:5-6', 2]]);
  });

  it('every entry it returns shares verses, best first, and equals sharedVerses', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 15 }), fc.integer({ min: 0, max: 8 })), { minLength: 1, maxLength: 8 }),
        fc.tuple(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 15 }), fc.integer({ min: 0, max: 8 })),
        (entries, [pc, pv, plen]) => {
          const ref = ([c, v, len]: number[]) => `JOL ${c}:${v}-${v! + len!}`;
          const p = passage(ref([pc!, pv!, plen!]));
          const got = studyEntriesFor(p, { doc: collection(entries.map(ref)), versification: eng });
          for (const g of got) {
            expect(g.shared).toBeGreaterThan(0);
            expect(g.shared).toBe(sharedVerses({ doc: eng, range: p.range }, { doc: eng, range: parseRef(g.entry.ref)! }));
          }
          expect(got.map((g) => g.shared)).toEqual([...got.map((g) => g.shared)].sort((a, b) => b - a));
          // An entry that is left out really shares nothing.
          const left = entries.map(ref).filter((r) => !got.some((g) => g.entry.ref === r));
          for (const r of left) {
            const range = parseRef(r);
            expect(!range || sharedVerses({ doc: eng, range: p.range }, { doc: eng, range }) === 0).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  // The entries' references are read once per collection and kept by book: the answers must not change.
  it('answers every passage of a whole Bible collection as reading each entry every time did', () => {
    // FIA's passages (library/fia/pericopes.tsv), as a collection holds them.
    const rows = fs.readFileSync(path.resolve(__dirname, '../../../library/fia/pericopes.tsv'), 'utf8').split('\n').slice(1).map((l) => l.split('\t')).filter((r) => r[1]);
    const refOf = (r: string[]) => {
      const [sc, sv] = r[5]!.split(':');
      const [ec, ev] = r[6]!.split(':');
      return sc === ec ? `${r[1]!.toUpperCase()} ${sc}:${sv}-${ev}` : `${r[1]!.toUpperCase()} ${sc}:${sv}-${ec}:${ev}`;
    };
    const refs = rows.map(refOf);
    expect(refs.length).toBeGreaterThan(2000);
    const doc = collection([...refs, 'nonsense']);
    const slow = (p: ReturnType<typeof passage>) => doc.entries
      .map((entry) => ({ entry, range: parseRef(entry.ref) }))
      .filter((e) => e.range && e.range.book === p.range.book)
      .map((e) => ({ entry: e.entry, shared: sharedVerses({ doc: eng, range: p.range }, { doc: eng, range: e.range! }) }))
      .filter((e) => e.shared > 0)
      .sort((a, b) => b.shared - a.shared || (a.entry.ref < b.entry.ref ? -1 : 1));
    // Every 17th passage, and some that run across FIA's own divisions.
    const asked = [...refs.filter((_, i) => i % 17 === 0), 'LUK 1:1-80', 'GEN 1:20-3:5', 'PSA 23:1-6', 'REV 22:1-21'].filter((r) => parseRef(r));
    expect(asked.length).toBeGreaterThan(100);
    for (const ref of asked) {
      const p = passage(ref);
      expect(studyEntriesFor(p, { doc, versification: eng }), ref).toEqual(slow(p));
    }
  });

  it('reads a collection again for another versification, and finds verses a numbering moves into a neighbouring book', () => {
    const doc = collection(['DAG 3:24-30', 'DAN 3:1-23', 'EST 1:1-5']);
    // Daniel's additions sit in DAG in one numbering and in DAN in another: the passage's book and its neighbours are both looked in.
    const got = studyEntriesFor(passage('DAN 3:1-30'), { doc, versification: eng });
    expect(got.map((g) => g.entry.ref)).toContain('DAN 3:1-23');
    expect(got.every((g) => g.shared > 0)).toBe(true);
    // The same document read in a numbering with other chapter lengths is read afresh, not answered from the first reading.
    const short: VersificationDoc = { ...eng, maxVerses: { ...eng.maxVerses, JOL: ['5', '5', '5'].map(Number) } };
    const joel = collection(['JOL 2']);
    const whole = studyEntriesFor(passage('JOL 2:1-32'), { doc: joel, versification: eng })[0]!.shared;
    const cut = studyEntriesFor({ range: parseRef('JOL 2:1-32')!, versification: short }, { doc: joel, versification: short })[0]!.shared;
    expect(whole).toBeGreaterThan(cut);
    expect(studyEntriesFor(passage('JOL 2:1-32'), { doc: joel, versification: eng })[0]!.shared).toBe(whole);
  });
});

describe('materialApplies', () => {
  const study = (ref: string): StudyDoc => ({
    format: 'study@1', title: 'S', pattern: 'FIA', about: '', source: '', language: 'eng', ref, versification: 'x', steps: [], resources: [], terms: [], deps: [],
  });
  const material = (links?: MaterialDoc['links']): MaterialDoc => ({ format: 'material@1', kind: 'document', title: 'M', ...(links ? { links } : {}), deps: [] });
  const at = (ref: string | null, unitId = 'tpl/JOL.2.1-11') => ({ unitId, range: ref ? parseRef(ref)! : null, versification: ref ? eng : null });

  it('a study guide applies when its passage shares a verse with the passage, and never without a range or versification', () => {
    expect(materialApplies(at('JOL 2:1-11'), { doc: study('JOL 2:8-14'), versification: eng })).toBe(true);
    expect(materialApplies(at('JOL 2:1-11'), { doc: study('JOL 2:12-14'), versification: eng })).toBe(false);
    expect(materialApplies(at('JOL 2:1-11'), { doc: study('nonsense'), versification: eng })).toBe(false);
    expect(materialApplies(at(null), { doc: study('JOL 2:8-14'), versification: eng })).toBe(false);
    expect(materialApplies(at('JOL 2:1-11'), { doc: study('JOL 2:8-14'), versification: null })).toBe(false);
  });

  it('a material with no links applies to nothing', () => {
    expect(materialApplies(at('JOL 2:1-11'), { doc: material(), versification: null })).toBe(false);
    expect(materialApplies(at('JOL 2:1-11'), { doc: material([]), versification: null })).toBe(false);
  });

  it('a template link applies to its node and the nodes below it, not to a lookalike', () => {
    const link = (node: string) => material([{ template: 'tpl', node }]);
    expect(unitPrefixFor('tpl')).toBe('tpl');
    expect(materialApplies(at(null, 'tpl/JOL.2.1-11'), { doc: link('JOL.2.1-11'), versification: null })).toBe(true);
    expect(materialApplies(at(null, 'tpl/JOL.2.1-11'), { doc: link('JOL'), versification: null })).toBe(true);
    expect(materialApplies(at(null, 'tpl/JOL.2'), { doc: link('JOL.2'), versification: null })).toBe(true);
    expect(materialApplies(at(null, 'tpl/JOL.2.1-11'), { doc: link('JOL.2'), versification: null })).toBe(true);
    expect(materialApplies(at(null, 'tpl/JOL'), { doc: link('JOL.2'), versification: null })).toBe(false);
    expect(materialApplies(at(null, 'tpl/JOL.2.1'), { doc: link('JOL.2'), versification: null })).toBe(true);
    expect(materialApplies(at(null, 'tpl/JOL.20'), { doc: link('JOL.2'), versification: null })).toBe(false);
    expect(materialApplies(at(null, 'other/JOL.2'), { doc: link('JOL.2'), versification: null })).toBe(false);
  });

  it('a verse link applies by shared verses, read in the material\'s versification or else the passage\'s', () => {
    expect(materialApplies(at('JOL 2:1-11'), { doc: material([{ ref: 'JOL 2:10-12' }]), versification: eng })).toBe(true);
    expect(materialApplies(at('JOL 2:1-11'), { doc: material([{ ref: 'JOL 2:12-14' }]), versification: eng })).toBe(false);
    expect(materialApplies(at('JOL 2:1-11'), { doc: material([{ ref: 'JOL 2:10-12' }]), versification: null })).toBe(true);
    expect(materialApplies(at('JOL 2:1-11'), { doc: material([{ ref: 'nonsense' }]), versification: null })).toBe(false);
    expect(materialApplies(at(null), { doc: material([{ ref: 'JOL 2:10-12' }]), versification: null })).toBe(false);
    // Any one link is enough.
    expect(materialApplies(at('JOL 2:1-11'), { doc: material([{ ref: 'AMO 1:1' }, { template: 'tpl', node: 'JOL.2.1-11' }]), versification: null })).toBe(true);
  });
});
