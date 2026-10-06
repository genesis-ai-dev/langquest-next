import { emptyState, foldOrg, type AnyEvent } from '@langquest-next/core';
import { copyOps, followOps, lanesBehind, lanesUsing, newItemId, publishOps, sourceLine, subscribeOps, type LibraryOp, type SharedItem } from '../src/library/model';
import { libraryItemView } from '@langquest-next/core';

const H = (c: string) => c.repeat(64);
let seq = 0;
const fold = (ops: LibraryOp[], prior: AnyEvent[] = []) => {
  const events = [...prior, ...ops.map((op) => ({ ...op, id: `e${++seq}`, orgId: 'o', partitionId: '_org', actorId: 'a', deviceId: 'd', hlc: `${String(seq).padStart(15, '0')}:000000:d` }) as AnyEvent)];
  return { events, library: foldOrg(events).library };
};

const shared: SharedItem = {
  org_id: 'langquest', org_name: 'LangQuest', item_id: 'langquest.flow.standard', kind: 'flow', name: 'Standard Bible Flow',
  description: 'Peer and back translation together…', subscribable: true, version_count: 2, latest_hash: H('b'), updated_hlc: ''
};

describe('publishing', () => {
  it('defines a new item with its first version, and only adds a version after that', () => {
    const first = fold(publishOps({}, { itemId: 'health.x1', kind: 'template', name: 'Health', description: '', docHash: H('1') }));
    expect(first.events.map((e) => e.type)).toEqual(['v1.LibraryItemDefined', 'v1.LibraryVersionPublished']);
    const again = publishOps(first.library, { itemId: 'health.x1', kind: 'template', name: 'Health', description: '', docHash: H('2'), note: 'HIV awareness' });
    expect(again.map((o) => o.type)).toEqual(['v1.LibraryVersionPublished']);
    // Publishing the same document twice is not a new version.
    expect(publishOps(first.library, { itemId: 'health.x1', kind: 'template', name: 'Health', description: '', docHash: H('1') })).toEqual([]);
  });

  it('refuses to publish over something this organization only follows', () => {
    const { library } = fold(subscribeOps(shared, true).ops);
    expect(() => publishOps(library, { itemId: subscribeOps(shared, true).itemId, kind: 'flow', name: 'x', description: '', docHash: H('9') })).toThrow(/copy it/);
  });

  it('makes ids people can read, without the characters unit ids are built from', () => {
    expect(newItemId('Health Lessons: HIV / AIDS', 'A1B2-C3D4-E5F6')).toBe('health-lessons-hiv-aids.a1b2c3d4');
    expect(newItemId('   ', 'zz')).toBe('item.zz');
  });
});

describe('another organization\'s item', () => {
  it('copies into an item of our own that says where it came from', () => {
    const { library } = fold(copyOps(shared, 'standard.copy1'));
    const it = libraryItemView(library, 'standard.copy1')!;
    expect([it.source, it.current, it.copiedFrom?.orgName]).toEqual(['copy', H('b'), 'LangQuest']);
    expect(sourceLine(it)).toBe('Version 1 · copied from LangQuest');
  });

  it('follows at the latest version, and can stop or change how it updates', () => {
    const sub = subscribeOps(shared, false);
    const a = fold(sub.ops);
    const it = libraryItemView(a.library, sub.itemId)!;
    expect([it.source, it.current, it.subscription?.autoUpdate]).toEqual(['subscription', H('b'), false]);
    expect(sourceLine(it)).toBe('Following LangQuest · you take updates');
    const b = fold(followOps(a.library, sub.itemId, { active: false }), a.events);
    const stopped = libraryItemView(b.library, sub.itemId)!;
    expect(sourceLine(stopped)).toBe('Stopped following LangQuest');
    // The version in use stays.
    expect(stopped.current).toBe(H('b'));
  });
});

describe('languages behind their items', () => {
  it('lists a language whose template or flow item has moved to another version', () => {
    const { library } = fold([
      ...publishOps({}, { itemId: 'ruth', kind: 'template', name: 'Ruth', description: '', docHash: H('1') }),
      { type: 'v1.LibraryVersionPublished', payload: { itemId: 'ruth', kind: 'template', docHash: H('2') } },
      ...subscribeOps(shared, true).ops
    ]);
    const state = emptyState();
    state.lanes['L1'] = { languoidId: 'din' };
    state.lanes['L2'] = { languoidId: 'nus' };
    state.laneTemplates['L1'] = { value: { templateId: 'ruth', catalogVersion: 0, itemId: 'ruth', docHash: H('1'), books: ['RUT'] }, hlc: 'x', eventId: 'x' };
    state.laneTemplates['L2'] = { value: { templateId: 'ruth', catalogVersion: 0, itemId: 'ruth', docHash: H('2') }, hlc: 'x', eventId: 'x' };
    const subId = subscribeOps(shared, true).itemId;
    state.laneFlows['L2'] = { value: { flowId: 'f', catalogVersion: 2, itemId: subId, docHash: H('a'), name: 'Standard' }, hlc: 'x', eventId: 'x' };
    expect(lanesBehind(state, library)).toEqual([
      { laneId: 'L1', kind: 'template', itemId: 'ruth', docHash: H('2'), books: ['RUT'] },
      { laneId: 'L2', kind: 'flow', itemId: subId, docHash: H('b') }
    ]);
    expect(lanesUsing(state, 'ruth')).toEqual(['L1', 'L2']);
  });
});
