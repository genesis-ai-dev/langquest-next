import { describe, expect, it } from 'vitest';
import type { DraftView } from '@langquest-next/core';
import { draftToTie } from '../src/study/keyTermDraft';

const draft = (takeId: string, by: string, hlc: string): DraftView => ({ takeId, rootTakeId: takeId, by, cardHashes: [], startedHlc: hlc, hlc });

describe('the draft a key term is tied to (STUDY-025)', () => {
  // TREV started drafting first; TRANS keeps two drafts and changed the second last.
  const passage = { drafts: [draft('trev-1', 'trev', '1'), draft('trans-1', 'trans', '2'), draft('trans-2', 'trans', '3')] };

  it('is never a teammate\'s draft, even when theirs is the passage\'s first', () => {
    expect(draftToTie(passage, 'trans')).toBe('trans-2');
    expect(draftToTie(passage, 'trev')).toBe('trev-1');
  });

  it('is the draft the workspace names, when it is the person\'s own', () => {
    expect(draftToTie(passage, 'trans', 'trans-1')).toBe('trans-1');
    expect(draftToTie(passage, 'trans', 'trev-1')).toBe('trans-2');
  });

  it('is nothing for someone with no draft of the passage', () => {
    expect(draftToTie(passage, 'rev')).toBeUndefined();
    expect(draftToTie(null, 'trans')).toBeUndefined();
  });
});
