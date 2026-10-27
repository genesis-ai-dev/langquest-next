import { foldOrg, ORG_STREAM, type AnyEvent } from '@langquest-next/core';
import { publishOps, subscribeOps, type LibraryOp, type SharedItem } from '../src/library/model';
import { moveOfItem, offersFor, placesFor, takeOps, type LibraryMove, type Taken } from '../src/moves/model';

const H = (c: string) => c.repeat(64);
let seq = 0;
const fold = (ops: LibraryOp[], prior: AnyEvent[] = []) => {
  const events = [...prior, ...ops.map((op) => ({ ...op, id: `m${++seq}`, orgId: 'wc', streamId: ORG_STREAM, actorId: 'a', deviceId: 'd', hlc: `${String(seq).padStart(15, '0')}:000000:d` }) as AnyEvent)];
  return { events, library: foldOrg(events).library };
};

const move = (over: Partial<LibraryMove>): LibraryMove => ({
  id: 'm1', state: 'offered', kind: 'material', fromOrg: 'langquest', fromOrgName: 'LangQuest', fromItem: 'fia.eng', name: 'FIA study guides (English)',
  toOrg: 'wc', toOrgName: 'Word Collective', toItem: null, offeredAt: '2026-10-27T00:00:00Z', acceptedAt: null, movedAt: null, followers: null, ...over
});
const lqFia: SharedItem = {
  org_id: 'langquest', org_name: 'LangQuest', item_id: 'fia.eng', kind: 'material', name: 'FIA study guides (English)', description: '',
  subscribable: true, version_count: 1, latest_hash: H('a'), updated_hlc: ''
};

describe('moving library items between organizations (decisions.md 174)', () => {
  it('talks about an item\'s open move, else its last', () => {
    const old = move({ id: 'old', state: 'declined', fromOrg: 'wc', fromItem: 'x' });
    const open = move({ id: 'open', state: 'offered', fromOrg: 'wc', fromItem: 'x' });
    expect(moveOfItem([old, open], 'wc', 'x')?.id).toBe('open');
    expect(moveOfItem([old], 'wc', 'x')?.id).toBe('old');
    expect(moveOfItem([old], 'wc', 'y')).toBeNull();
  });

  it('lists offers to this organization still to take or finish, of the page\'s kinds', () => {
    const moves = [move({ id: 'a' }), move({ id: 'b', state: 'accepted', toItem: 'n' }), move({ id: 'c', state: 'moved' }), move({ id: 'd', kind: 'flow' }), move({ id: 'e', toOrg: 'other' })];
    expect(offersFor(moves, 'wc', ['material']).map((m) => m.id)).toEqual(['a', 'b']);
    expect(offersFor(moves, 'wc', ['flow']).map((m) => m.id)).toEqual(['d']);
  });

  it('offers this organization\'s own items of the kind to take its place, not ones it follows', () => {
    const own = fold(publishOps({}, { itemId: 'fia.eng.wc', kind: 'material', name: 'FIA (English)', description: '', docHash: H('b') }));
    const followed = fold(subscribeOps(lqFia, true).ops, own.events);
    expect(placesFor(followed.library, 'material').map((p) => p.itemId)).toEqual(['fia.eng.wc']);
    expect(placesFor(followed.library, 'flow')).toEqual([]);
  });

  it('as a new item: its name, every version oldest first with its note, shared for following; and stops following the old one', () => {
    const { library } = fold(subscribeOps(lqFia, true).ops);
    const taken: Taken = { move: move({ state: 'accepted', toItem: 'fia.eng.new' }), replace: false, name: 'FIA study guides (English)', description: 'FIA.',
      versions: [{ docHash: H('a'), note: 'first' }, { docHash: H('c'), note: null }] };
    const ops = takeOps(library, taken);
    expect(ops.map((o) => [o.type, o.payload.itemId])).toEqual([
      ['v1.LibraryItemDefined', 'fia.eng.new'], ['v1.LibraryVersionPublished', 'fia.eng.new'], ['v1.LibraryVersionPublished', 'fia.eng.new'],
      ['v1.LibrarySharingSet', 'fia.eng.new'], ['v1.LibrarySubscribed', 'sub.langquest.fia.eng'], ['v1.LibraryItemArchived', 'sub.langquest.fia.eng']
    ]);
    expect(ops[1]!.payload).toMatchObject({ docHash: H('a'), note: 'first' });
    expect(ops[3]!.payload).toMatchObject({ shared: true, subscribable: true });
    expect(ops[4]!.payload).toMatchObject({ active: false, sourceOrgId: 'langquest' });
    expect(ops[5]!.payload).toMatchObject({ archived: true });
    // Taking it again writes only what is missing.
    const after = fold(ops.slice(0, 4)).library;
    expect(takeOps(after, taken)).toEqual([]);
  });

  it('in place of one of its own: nothing new, only sharing it when it is not shared yet', () => {
    const own = fold(publishOps({}, { itemId: 'fia.eng.wc', kind: 'material', name: 'FIA (English)', description: '', docHash: H('b') }));
    const taken: Taken = { move: move({ state: 'accepted', toItem: 'fia.eng.wc' }), replace: true, name: 'x', description: '', versions: [] };
    expect(takeOps(own.library, taken).map((o) => o.type)).toEqual(['v1.LibrarySharingSet']);
    const shared = fold([{ type: 'v1.LibrarySharingSet', payload: { itemId: 'fia.eng.wc', kind: 'material', shared: true, subscribable: true } }], own.events);
    expect(takeOps(shared.library, taken)).toEqual([]);
  });
});
