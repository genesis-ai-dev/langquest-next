import { deriveDownloadWork, deriveMissingBlobs, deriveUploadWork, referencedBlobs } from '../src/blobs';
import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import { buildFixture } from './fixtures';

describe('blob work lists are derived, never queued (PLAN.md section 14)', () => {
  const state = fold(buildFixture(), emptyState());

  it('references every card in every recording', () => {
    expect([...referencedBlobs(state).keys()].sort()).toEqual(['c1', 'c2']);
  });

  it('uploads what is referenced, unconfirmed, and on this device', () => {
    // Why: c1 is confirmed by the server; c2 is not. Only c2, and only if
    // we actually have the file, is upload work. A card we do not have is
    // simply missing, never an error.
    expect(deriveUploadWork(state, new Set(['c1', 'c2'])).map((r) => r.hash)).toEqual(['c2']);
    expect(deriveUploadWork(state, new Set(['c1']))).toEqual([]);
    expect(deriveMissingBlobs(state, new Set(['c1'])).map((r) => r.hash)).toEqual(['c2']);
  });

  it('downloads what is confirmed and not on this device', () => {
    expect(deriveDownloadWork(state, new Set()).map((r) => r.hash)).toEqual(['c1']);
    expect(deriveDownloadWork(state, new Set(['c1']))).toEqual([]);
  });

  it('confirmation is set once and survives any order', () => {
    expect(state.blobs['c1']?.size).toBe(12345);
  });
});
