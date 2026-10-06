import { defaultOfflineScope, deriveDownloadWork, deriveMissingBlobs, deriveUploadWork, evictableBlobs, isStored, offlineByUnit, offlineSummary, referencedBlobs, unitOffline } from '../src/blobs';
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
    // Why: joining a partition on a metered link must not fetch every card of
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

describe('eviction candidates (cache quota)', () => {
  const state = fold(buildFixture(), emptyState());

  it('offers only confirmed, out-of-scope, referenced files; unsynced and kept-offline files are protected', () => {
    // Why: reclaiming space must never delete the only copy of a recording
    // (c2 is unconfirmed) or something the user chose to keep (luke1 scope).
    const present = new Set(['c1', 'c2', 'unrelated-partition-file']);
    expect(evictableBlobs(state, present, new Set(['elsewhere'])).map((r) => r.hash)).toEqual(['c1']);
    expect(evictableBlobs(state, present, new Set(['luke1']))).toEqual([]);
    expect(evictableBlobs(state, present, null)).toEqual([]);
  });
});

describe('what is on this phone for offline use (shown per passage and in Settings)', () => {
  const state = fold(buildFixture(), emptyState());
  const none = new Set<string>();

  it('a passage someone only browses is not kept, even with its text here', () => {
    // Why: a person reading passages online must not assume their audio comes along to the field.
    const u = unitOffline(state, 'luke1', new Set(), 'nobody', none);
    expect(u.reason).toBeNull();
    expect(u.ready).toBe(false);
    expect(u.toFetch).toBe(1); // c1 is on the server
    expect(u.notSent).toBe(2); // c2 and the reference audio are not
  });

  it('assignment, own work and an explicit choice keep a passage, in that order of reason', () => {
    expect(unitOffline(state, 'luke1', none, 'r1', none).reason).toBe('assigned');
    expect(unitOffline(state, 'luke1', none, 't1', none).reason).toBe('worked');
    expect(unitOffline(state, 'luke1', none, 'nobody', new Set(['luke1'])).reason).toBe('chosen');
  });

  it('ready means kept and every file the server has is here; unsent files cannot block it', () => {
    expect(unitOffline(state, 'luke1', none, 'r1', none).ready).toBe(false);
    const u = unitOffline(state, 'luke1', new Set(['c1']), 'r1', none);
    expect(u).toMatchObject({ here: 1, toFetch: 0, bytesToFetch: 0, ready: true });
  });

  it('the summary counts kept passages, ready ones, and bytes still to fetch', () => {
    expect(offlineSummary(state, none, 'nobody', none)).toEqual({ kept: 0, ready: 0, chosen: 0, filesToFetch: 0, bytesToFetch: 0, notSent: 0 });
    expect(offlineSummary(state, none, 'nobody', new Set(['luke1']))).toMatchObject({ kept: 1, ready: 0, chosen: 1, filesToFetch: 1, bytesToFetch: 12345 });
    expect(offlineSummary(state, new Set(['c1']), 'r1', none)).toMatchObject({ kept: 1, ready: 1, chosen: 0, filesToFetch: 0 });
  });

  it('agrees with the downloader: what a kept passage still fetches is download work', () => {
    const scope = new Set(['luke1']);
    const fetch = deriveDownloadWork(state, none, scope).length;
    expect(offlineByUnit(state, scope, none, 'nobody', scope).get('luke1')!.toFetch).toBe(fetch);
  });
});
