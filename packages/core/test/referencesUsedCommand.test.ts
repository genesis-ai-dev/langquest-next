import { describe, expect, it } from 'vitest';
import { commands, CommandError, emptyState, MAX_USED_ITEMS, usedOn, validateEvent, applyEvent, type UsedReference } from '../src';

const item = (itemId: string, opened: boolean, extra: Partial<UsedReference> = {}): UsedReference =>
  ({ itemId, name: itemId.toUpperCase(), kind: 'source', opened, ...extra });

describe('commands.referencesUsed', () => {
  it('builds one event per subject, merging repeats so opened wins', () => {
    const c = commands(emptyState());
    const specs = c.referencesUsed({
      commandId: 'cmd', laneId: 'L1', unitId: 'u1', takeId: 'take:cmd',
      items: [item('bsb', false, { detail: '', copyright: 'Public domain' }), item('fia', true, { kind: 'guide' }), item('bsb', true)]
    });
    expect(specs).toHaveLength(1);
    const spec = specs[0]!;
    expect(spec.id).toBe('cmd:refs:take:cmd');
    expect(spec.type).toBe('v1.ReferencesUsed');
    const p = spec.payload as { items: UsedReference[]; takeId?: string; reviewId?: string };
    expect(p.takeId).toBe('take:cmd');
    expect(p.reviewId).toBeUndefined();
    // Opened first; an empty optional field is dropped; the first description stays.
    expect(p.items).toEqual([
      { itemId: 'bsb', name: 'BSB', kind: 'source', opened: true, copyright: 'Public domain' },
      { itemId: 'fia', name: 'FIA', kind: 'guide', opened: true }
    ]);
  });

  it('passes validation and folds into what the version used', () => {
    const state = emptyState();
    const [spec] = commands(state).referencesUsed({ commandId: 'c2', laneId: 'L1', unitId: 'u1', reviewId: 'review:c2:0', items: [item('esv', false)] });
    const envelope = {
      id: spec!.id, orgId: 'o', projectId: 'p', actorId: 'me', deviceId: 'd', hlc: '0000000000001:0000:d', type: spec!.type,
      payload: spec!.payload, schemaVersion: 1
    } as never;
    expect(validateEvent(envelope)).toBeNull();
    applyEvent(state, envelope);
    expect(usedOn(state, { reviewId: 'review:c2:0' }).map((u) => u.itemId)).toEqual(['esv']);
  });

  it('offers nothing, appends nothing; names exactly one subject; caps the list', () => {
    const c = commands(emptyState());
    expect(c.referencesUsed({ commandId: 'x', laneId: 'L1', unitId: 'u1', takeId: 't', items: [] })).toEqual([]);
    expect(() => c.referencesUsed({ commandId: 'x', laneId: 'L1', unitId: 'u1', items: [item('a', true)] })).toThrow(CommandError);
    expect(() => c.referencesUsed({ commandId: 'x', laneId: 'L1', unitId: 'u1', takeId: 't', reviewId: 'r', items: [item('a', true)] })).toThrow(CommandError);
    const many = Array.from({ length: MAX_USED_ITEMS + 5 }, (_, i) => item(`n${i}`, i === MAX_USED_ITEMS + 4));
    const [spec] = c.referencesUsed({ commandId: 'x', laneId: 'L1', unitId: 'u1', takeId: 't', items: many });
    const items = (spec!.payload as { items: UsedReference[] }).items;
    expect(items).toHaveLength(MAX_USED_ITEMS);
    expect(items[0]!.itemId).toBe(`n${MAX_USED_ITEMS + 4}`);
  });
});
