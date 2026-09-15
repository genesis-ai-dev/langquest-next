import { defaultOfflineScope, deriveDownloadWork, deriveMissingBlobs, deriveUploadWork, isStored, referencedBlobs } from '../src/blobs';
import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import { buildFixture } from './fixtures';

describe('blob work lists are derived, never queued (PLAN.md section 14)', () => {
  const state = fold(buildFixture(), emptyState());

  it('references every card in every recording', () => {
    expect([...referencedBlobs(state).keys()].sort()).toEqual(['c1', 'c2', 'sha256:ov1']);
  });

  it('uploads what is referenced, unconfirmed, and on this device', () => {
    // Why: c1 is confirmed by the server; c2 is not. Only c2, and only if
    // we actually have the file, is upload work. A card we do not have is
    // simply missing, never an error.
    expect(deriveUploadWork(state, new Set(['c1', 'c2'])).map((r) => r.hash)).toEqual(['c2']);
    expect(deriveUploadWork(state, new Set(['c1']))).toEqual([]);
    expect(deriveMissingBlobs(state, new Set(['c1', 'sha256:ov1'])).map((r) => r.hash)).toEqual(['c2']);
  });

  it('downloads what is confirmed and not on this device', () => {
    expect(deriveDownloadWork(state, new Set()).map((r) => r.hash)).toEqual(['c1']);
    expect(deriveDownloadWork(state, new Set(['c1']))).toEqual([]);
  });

  it('confirmation is set once and survives any order', () => {
    expect(state.blobs['c1']?.size).toBe(12345);
  });
});

describe('download scope (PLAN.md section 14 rule 10)', () => {
  const state = fold(buildFixture(), emptyState());

  it('downloads only blobs of units in scope, reference audio included', () => {
    // Why: joining a project on a metered link must not fetch every card of
    // every take in every lane. Scope is the passages the user keeps offline.
    const inScope = deriveDownloadWork(state, new Set(), new Set(['luke1']));
    expect(inScope.map((r) => r.hash).sort()).toEqual(['c1']);
    expect(deriveDownloadWork(state, new Set(), new Set(['elsewhere']))).toEqual([]);
    expect(referencedBlobs(state).get('sha256:ov1')?.unitId).toBe('luke1');
  });

  it('the default scope is the units the actor is assigned to or has worked on', () => {
    expect([...defaultOfflineScope(state, 'r1')]).toEqual(['luke1']); // assigned reviewer
    expect([...defaultOfflineScope(state, 't1')]).toEqual(['luke1']); // recorded there
    expect([...defaultOfflineScope(state, 'nobody')]).toEqual([]);
  });
});

describe('blob integrity (server-confirmed size, server-side invalidation)', () => {
  it('a confirmation with the wrong size means the upload did not land intact: upload again', () => {
    // Why: the client hashes before upload, but nothing checks the bytes
    // that arrived. The confirmation carries the stored size; a mismatch
    // is the cheapest possible corruption signal and must reopen the work.
    const state = fold(buildFixture(), emptyState());
    const sizes = new Map([['c1', 12345], ['c2', 10]]);
    expect(deriveUploadWork(state, new Set(['c1', 'c2']), sizes).map((r) => r.hash)).toEqual(['c2']);
    sizes.set('c1', 99);
    expect(deriveUploadWork(state, new Set(['c1', 'c2']), sizes).map((r) => r.hash).sort()).toEqual(['c1', 'c2']);
  });

  it('BlobInvalidated after BlobStored reopens upload and stops download, in any order', () => {
    const events = buildFixture();
    const stored = events.find((e) => e.type === 'v1.BlobStored')!;
    const invalid = { ...stored, id: 'inv1', type: 'v1.BlobInvalidated', hlc: stored.hlc + '1', payload: { hash: 'c1', reason: 'hash mismatch' } } as never;
    const a = fold([...events, invalid], emptyState());
    const b = fold([invalid, ...events], emptyState());
    expect(isStored(a, 'c1')).toBe(false);
    expect(isStored(b, 'c1')).toBe(false);
    expect(deriveDownloadWork(a, new Set(), null).map((r) => r.hash)).toEqual([]);
    expect(deriveUploadWork(a, new Set(['c1'])).map((r) => r.hash)).toEqual(['c1']);
    // A later re-upload confirmation wins again.
    const again = { ...stored, id: 'st2', hlc: stored.hlc + '2', payload: { hash: 'c1', size: 12345 } } as never;
    expect(isStored(fold([invalid, again, ...events], emptyState()), 'c1')).toBe(true);
  });
});
