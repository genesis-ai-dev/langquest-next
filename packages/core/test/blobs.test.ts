import { audioFormatsFor, defaultOfflineScope, deriveDownloadWork, deriveMissingBlobs, deriveUploadWork, evictableBlobs, isStored, offlineByUnit, offlineSummary, referencedBlobs, unitOffline } from '../src/blobs';
import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { foldLanguage } from '../src/reducer';
import { emptyLanguageState } from '../src/state';
import { buildFixture } from './fixtures';

/**
 * The language fixture plus what these tests lean on: a review asked of r1
 * on luke1 (after r1's own review, so it stays open), and reference audio
 * on luke1 that nobody has uploaded yet.
 */
function events(): AnyEvent[] {
  let n = 0;
  const ev = <T extends EventType>(type: T, payload: EventPayloads[T]): AnyEvent => {
    n += 1;
    return { id: `b${n}`, type, orgId: 'org1', streamId: 'L1', actorId: 'lead', deviceId: 'dA', hlc: `00170000010000${n}:000000:dA`, payload } as AnyEvent;
  };
  return [
    ...buildFixture(),
    ev('v1.RequestMade', { requestId: 'ask-r1', unitId: 'luke1', what: 'review', kindId: 'final', profileId: 'r1' }),
    ev('v1.MaterialDefined', { materialId: 'overview', kind: 'overview', title: 'Overview', scope: { unitId: 'luke1' } }),
    ev('v1.MaterialFieldSet', { materialId: 'overview', fieldId: 'audio', blobHash: 'sha256:ov1' })
  ];
}
const fold = (list: AnyEvent[]) => foldLanguage(list, emptyLanguageState());

describe('blob work lists are derived, never queued (PLAN.md section 14)', () => {
  const state = fold(events());

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
  const state = fold(events());

  it('downloads only blobs of units in scope, reference audio included', () => {
    // Why: opening a language on a metered link must not fetch every card of
    // every take in it. Scope is the passages the user keeps offline.
    const inScope = deriveDownloadWork(state, new Set(), new Set(['luke1']));
    expect(inScope.map((r) => r.hash).sort()).toEqual(['c1']);
    expect(deriveDownloadWork(state, new Set(), new Set(['elsewhere']))).toEqual([]);
    expect(referencedBlobs(state).get('sha256:ov1')?.unitId).toBe('luke1');
  });

  it('the default scope is the units the actor is asked about or has worked on', () => {
    expect([...defaultOfflineScope(state, 'r1')]).toEqual(['luke1']); // asked to review
    expect([...defaultOfflineScope(state, 't1')]).toEqual(['luke1']); // recorded there
    expect([...defaultOfflineScope(state, 'nobody')]).toEqual([]);
  });
});

describe('blob integrity (server-confirmed size, server-side invalidation)', () => {
  it('a confirmation with the wrong size means the upload did not land intact: upload again', () => {
    // Why: the client hashes before upload, but nothing checks the bytes
    // that arrived. The confirmation carries the stored size; a mismatch
    // is the cheapest possible corruption signal and must reopen the work.
    const state = fold(events());
    const sizes = new Map([['c1', 12345], ['c2', 10]]);
    expect(deriveUploadWork(state, new Set(['c1', 'c2']), sizes).map((r) => r.hash)).toEqual(['c2']);
    sizes.set('c1', 99);
    expect(deriveUploadWork(state, new Set(['c1', 'c2']), sizes).map((r) => r.hash).sort()).toEqual(['c1', 'c2']);
  });

  it('BlobInvalidated after BlobStored reopens upload and stops download, in any order', () => {
    const all = events();
    const stored = all.find((e) => e.type === 'v1.BlobStored')!;
    const invalid = { ...stored, id: 'inv1', type: 'v1.BlobInvalidated', hlc: stored.hlc + '1', payload: { hash: 'c1', reason: 'hash mismatch' } } as never;
    const a = fold([...all, invalid]);
    const b = fold([invalid, ...all]);
    expect(isStored(a, 'c1')).toBe(false);
    expect(isStored(b, 'c1')).toBe(false);
    expect(deriveDownloadWork(a, new Set(), null).map((r) => r.hash)).toEqual([]);
    expect(deriveUploadWork(a, new Set(['c1'])).map((r) => r.hash)).toEqual(['c1']);
    // A later re-upload confirmation wins again.
    const again = { ...stored, id: 'st2', hlc: stored.hlc + '2', payload: { hash: 'c1', size: 12345 } } as never;
    expect(isStored(fold([invalid, again, ...all]), 'c1')).toBe(true);
  });
});

describe('eviction candidates (cache quota)', () => {
  const state = fold(events());

  it('offers only confirmed, out-of-scope, referenced files; unsynced and kept-offline files are protected', () => {
    // Why: reclaiming space must never delete the only copy of a recording
    // (c2 is unconfirmed) or something the user chose to keep (luke1 scope).
    const present = new Set(['c1', 'c2', 'unrelated-language-file']);
    expect(evictableBlobs(state, present, new Set(['elsewhere'])).map((r) => r.hash)).toEqual(['c1']);
    expect(evictableBlobs(state, present, new Set(['luke1']))).toEqual([]);
    expect(evictableBlobs(state, present, null)).toEqual([]);
  });
});

describe('what is on this phone for offline use (shown per passage and in Settings)', () => {
  const state = fold(events());
  const none = new Set<string>();

  it('a passage someone only browses is not kept, even with its text here', () => {
    // Why: a person reading passages online must not assume their audio comes along to the field.
    const u = unitOffline(state, 'luke1', new Set(), 'nobody', none);
    expect(u.reason).toBeNull();
    expect(u.ready).toBe(false);
    expect(u.toFetch).toBe(1); // c1 is on the server
    expect(u.notSent).toBe(2); // c2 and the reference audio are not
  });

  it('a request, own work and an explicit choice keep a passage, in that order of reason', () => {
    expect(unitOffline(state, 'luke1', none, 'r1', none).reason).toBe('asked');
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

describe('a voice note recorded in a browser keeps its format (decisions.md 58, 71)', () => {
  // A browser without MP4 recording stores the note as WAV, at <hash>.wav.
  // The event that names the note has no format field, so unless the log
  // says so every device looks for <hash>.m4a: the recording browser cannot
  // read its own file to upload it, and nobody else can fetch it.
  const comment = (commentBlobHash: string): AnyEvent => ({
    id: 'rv-web', type: 'v1.ReviewRecorded', orgId: 'org1', streamId: 'L1', actorId: 'r1', deviceId: 'web', hlc: '0017000002000000:000000:web',
    payload: { reviewId: 'rv-web', takeId: 'take1', kindId: 'peer', outcome: 'needs_changes', via: 'app', commentBlobHash }
  }) as AnyEvent;
  const formatSet = (hash: string, format: 'wav' | 'm4a'): AnyEvent => ({
    id: `fmt-${hash}`, type: 'v1.AudioFormatSet', orgId: 'org1', streamId: 'L1', actorId: 'r1', deviceId: 'web', hlc: '0017000001900000:000000:web',
    payload: { hash, format }
  }) as AnyEvent;

  it('names a voice note m4a when nothing says otherwise, as phones record it', () => {
    const state = fold([...buildFixture(), comment('vn-phone')]);
    expect(referencedBlobs(state).get('vn-phone')?.format).toBe('m4a');
  });

  it('uploads and downloads a WAV voice note under its real name', () => {
    const state = fold([...buildFixture(), formatSet('vn-web', 'wav'), comment('vn-web')]);
    expect(deriveUploadWork(state, new Set(['vn-web'])).find((r) => r.hash === 'vn-web')?.format).toBe('wav');
    const stored = fold([...buildFixture(), formatSet('vn-web', 'wav'), comment('vn-web'),
      { ...formatSet('vn-web', 'wav'), id: 'st', type: 'v1.BlobStored', actorId: 'service', payload: { hash: 'vn-web', size: 10 } } as AnyEvent]);
    expect(deriveDownloadWork(stored, new Set()).find((r) => r.hash === 'vn-web')?.format).toBe('wav');
  });

  it('asks for a format event only for a WAV voice note the log does not describe yet', () => {
    // Why: the device that has the file is the only one that knows its
    // format, and it must say so with the event that names it. An m4a note
    // needs nothing (the default); one already described needs nothing more.
    const local = new Map([['vn-web', 'wav'], ['vn-phone', 'm4a']]);
    const items = [comment('vn-web'), comment('vn-phone'), { type: 'v1.TakeArchived' as const, payload: { takeId: 'take1' } }];
    expect(audioFormatsFor(fold(buildFixture()), items, (h) => local.get(h)))
      .toEqual([{ type: 'v1.AudioFormatSet', payload: { hash: 'vn-web', format: 'wav' } }]);
    expect(audioFormatsFor(fold([...buildFixture(), formatSet('vn-web', 'wav')]), items, (h) => local.get(h))).toEqual([]);
  });

  it('covers every voice-note field referencedBlobs reads as m4a', () => {
    // Why: a field missing here would send its WAV notes back to <hash>.m4a.
    const wav = () => 'wav';
    const named = (type: EventType, payload: Record<string, unknown>) => audioFormatsFor(null, [{ type, payload }], wav).map((e) => e.payload.hash);
    expect(named('v1.ReviewRecorded', { commentBlobHash: 'a' })).toEqual(['a']);
    expect(named('v1.RequestMade', { noteBlobHash: 'b' })).toEqual(['b']);
    expect(named('v1.DepartureRecorded', { reasonBlobHash: 'c' })).toEqual(['c']);
    for (const type of ['v1.NoteAdded', 'v1.ResponseRecorded', 'v1.KeyTermAdjusted', 'v1.MaterialFieldSet'] as const) {
      expect(named(type, { blobHash: 'd' })).toEqual(['d']);
    }
  });
});
