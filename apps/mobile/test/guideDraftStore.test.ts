import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuideDraft } from '../src/guides/draft';

// Guide drafts on the device (guides/draftStore.ts, decision 125): each is its
// writer's, so another person on the same phone or browser never opens it and
// deleting the account removes it; a draft kept before keys named the writer
// is not lost.
const store = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => { store.set(k, v); },
    removeItem: async (k: string) => { store.delete(k); }
  }
}));

const draft = { v: 1, title: 'The lost son', steps: [] } as unknown as GuideDraft;

describe('guide drafts on the device', () => {
  beforeEach(() => { store.clear(); });

  it('keys a draft by its writer, so each person on a phone has their own', async () => {
    const { draftKey, loadDraft, saveDraft } = await import('../src/guides/draftStore');
    const mine = draftKey('org1', 'ann', { itemId: 'g1' });
    expect(mine).toContain('ann');
    expect(draftKey('org1', 'bob', { itemId: 'g1' })).not.toBe(mine);
    expect(draftKey('org1', 'ann', { from: 'h1' })).not.toBe(mine);
    expect(draftKey('org1', 'ann', {})).not.toBe(mine);
    await saveDraft(mine, draft, 5);
    expect(await loadDraft(mine)).toEqual({ draft, savedAt: 5 });
    expect(await loadDraft(draftKey('org1', 'bob', { itemId: 'g1' }))).toBeNull();
  });

  it('a draft kept before keys named the writer becomes the next writer\'s, once', async () => {
    const { draftKey, loadDraft, unownedDraftKey } = await import('../src/guides/draftStore');
    const old = unownedDraftKey('org1', { itemId: 'g1' });
    store.set(old, JSON.stringify({ draft, savedAt: 3 }));
    const mine = draftKey('org1', 'ann', { itemId: 'g1' });
    expect(await loadDraft(mine, old)).toEqual({ draft, savedAt: 3 });
    expect(store.has(old)).toBe(false);
    expect(await loadDraft(mine)).toEqual({ draft, savedAt: 3 });
    expect(await loadDraft(draftKey('org1', 'bob', { itemId: 'g1' }), old)).toBeNull();
  });

  it('forgets a published draft, and ignores one this version cannot read', async () => {
    const { draftKey, dropDraft, loadDraft, saveDraft } = await import('../src/guides/draftStore');
    const mine = draftKey('org1', 'ann', {});
    await saveDraft(mine, draft, 1);
    await dropDraft(mine);
    expect(await loadDraft(mine)).toBeNull();
    store.set(mine, '{"draft":{"v":2},"savedAt":1}');
    expect(await loadDraft(mine)).toBeNull();
  });
});
