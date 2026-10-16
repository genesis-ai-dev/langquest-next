import { describe, expect, it } from 'vitest';
import { draftKey, hasContent, isNoteDraft, parseDraft, serializeDraft } from '../src/drafts/draftModel';
import { accountKeys } from '../src/account/accountDeletion';

describe('drafts kept on the phone (decision 112)', () => {
  it('keys each draft by its maker, so a shared phone never shows one person another’s, and account deletion finds it', () => {
    const a = draftKey('note', 'person-a', 'lang', 'unit', null);
    expect(a).toBe('draft:v1:note:person-a:lang:unit:-');
    expect(draftKey('note', 'person-b', 'lang', 'unit', null)).not.toBe(a);
    expect(accountKeys([a, 'other'], 'person-a')).toEqual([a]);
  });

  it('reads back what it wrote, and nothing it cannot read', () => {
    const raw = serializeDraft({ text: 'Verse 3 is fast', hash: null }, 1000);
    expect(parseDraft(raw, isNoteDraft)).toEqual({ value: { text: 'Verse 3 is fast', hash: null }, savedAt: 1000 });
    expect(parseDraft(null, isNoteDraft)).toBeNull();
    expect(parseDraft('{not json', isNoteDraft)).toBeNull();
    expect(parseDraft(serializeDraft({ text: 3 }, 1), isNoteDraft)).toBeNull();
  });

  it('counts a draft as empty when nothing in it was said, typed or chosen', () => {
    expect(hasContent({ text: '  ', hash: null })).toBe(false);
    expect(hasContent({ text: '', hash: 'abc' })).toBe(true);
    expect(hasContent({ answers: {}, moments: [], people: 0 })).toBe(false);
    expect(hasContent({ answers: { q1: 'Yes' } })).toBe(true);
  });
});
