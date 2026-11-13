import { nearbyGroupOf, wantedFilesOf, type HoldChoice, type WantedFacts } from '../src/nearbyHoldings';
import { audioFormatsFor, defaultOfflineScope, deriveDownloadWork, deriveMissingBlobs, deriveUploadWork, evictableBlobs, filePlanOf, isStored, lostFilesOf, lostFilesView, offlineByUnit, offlineSummary, referencedBlobs, unitOffline } from '../src/blobs';
import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { applyLanguageEvent, foldLanguage } from '../src/reducer';
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

describe('file planning is worked out once per change (performance)', () => {
  // Why: the upload and download workers, the space reclaimer and the
  // offline screens ask after every change and every file that arrives; on
  // a 61,000-file language each walk of the whole language cost 0.1 to
  // 0.25 s on a Mac. The answers are kept per state and revision, so they
  // must follow every event the fold applies to that same object.
  const ev = (id: string, type: EventType, payload: unknown, actorId = 'lead'): AnyEvent =>
    ({ id, type, orgId: 'org1', streamId: 'L1', actorId, deviceId: 'dS', hlc: `001800000000000:00000${id.length}:dS`, payload }) as AnyEvent;

  it('a confirmation folded into the live state shows in the next list', () => {
    const state = fold(events());
    expect(deriveDownloadWork(state, new Set(), new Set(['luke1'])).map((r) => r.hash)).toEqual(['c1']);
    expect(deriveUploadWork(state, new Set(['c2'])).map((r) => r.hash)).toEqual(['c2']);
    applyLanguageEvent(state, ev('st-c2', 'v1.BlobStored', { hash: 'c2', size: 10 }));
    expect(deriveDownloadWork(state, new Set(), new Set(['luke1'])).map((r) => r.hash).sort()).toEqual(['c1', 'c2']);
    expect(deriveUploadWork(state, new Set(['c2']))).toEqual([]);
    expect(evictableBlobs(state, new Set(['c2']), new Set(['elsewhere'])).map((r) => r.hash)).toEqual(['c2']);
  });

  it('a recording folded into the live state is new work and widens its author\'s scope', () => {
    const state = fold(events());
    expect(defaultOfflineScope(state, 'newcomer').size).toBe(0);
    expect(referencedBlobs(state).has('cn')).toBe(false);
    applyLanguageEvent(state, ev('rec-n', 'v1.RecordingAdded', { recordingId: 'rn', unitId: 'luke1', kind: 'target', cards: [{ hash: 'cn', durationMs: 1000 }] }, 'newcomer'));
    expect([...defaultOfflineScope(state, 'newcomer')]).toEqual(['luke1']);
    expect(referencedBlobs(state).has('cn')).toBe(true);
    expect(deriveUploadWork(state, new Set(['cn'])).map((r) => r.hash)).toEqual(['cn']);
  });

  it('lists keep the order the language names its files in, whatever order the phone has them in', () => {
    const state = fold(events());
    const named = [...referencedBlobs(state).keys()];
    expect(deriveUploadWork(state, new Set([...named].reverse())).map((r) => r.hash)).toEqual(named.filter((h) => !isStored(state, h)));
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

describe('a voice note recorded in a browser keeps its format (decisions.md 58, 77)', () => {
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

  it('keeps the first format said for a note, in any order (decisions.md 75)', () => {
    // Why: the recording device says the format in the batch that first
    // names the note; a later event from anyone else must not re-label it
    // and send every device to a file that is not there.
    const later = { ...formatSet('vn-web', 'm4a'), id: 'fmt-late', hlc: '0017000003000000:000000:other', deviceId: 'other' } as AnyEvent;
    for (const order of [[formatSet('vn-web', 'wav'), later], [later, formatSet('vn-web', 'wav')]]) {
      const state = fold([...buildFixture(), ...order, comment('vn-web')]);
      expect(referencedBlobs(state).get('vn-web')?.format).toBe('wav');
    }
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

describe('files a phone lost behind the app\'s back (decisions.md 92)', () => {
  const state = fold(events());

  it('a file the server has is safe; an unsent recording is gone, and its passage is named once', () => {
    // c1 is confirmed, c2 and the overview's audio are not; a hash the language never named counts in neither.
    expect(lostFilesView(state, ['c1', 'c2', 'sha256:ov1', 'someone-elses'])).toEqual({ safe: 1, unsent: 2, unitIds: ['luke1'] });
    expect(lostFilesView(state, ['c1'])).toEqual({ safe: 1, unsent: 0, unitIds: [] });
    expect(lostFilesView(state, [])).toEqual({ safe: 0, unsent: 0, unitIds: [] });
  });

  it('a lost file a teammate\'s phone sent counts in neither total: it is not this person\'s to record again (5.4)', () => {
    const plan = filePlanOf(state);
    expect(lostFilesOf(plan, ['c1', 'c2', 'sha256:ov1'], new Set(['c2']))).toEqual({ safe: 1, unsent: 1, unitIds: ['luke1'] });
    expect(lostFilesOf(plan, ['c1', 'c2'], new Set(['c1', 'c2']))).toEqual({ safe: 0, unsent: 0, unitIds: [] });
    expect(lostFilesOf(plan, ['c2'])).toEqual({ safe: 0, unsent: 1, unitIds: ['luke1'] });
  });
});

describe('what a phone asks a nearby teammate for', () => {
  const HOLD: HoldChoice = { hold: true };
  const ref = (hash: string, confirmed = false, format = 'wav') => ({ hash, format, confirmed });
  const facts = (over: Partial<WantedFacts> = {}): WantedFacts => ({ refs: [], offlineScope: new Set(), reviewOrder: [], copies: new Map(), planOrder: [], ...over });
  const hashes = (f: WantedFacts, choice: HoldChoice) => wantedFilesOf(f, choice).map((w) => w.hash);

  it('asks for needed files, then those open for review, then backups', () => {
    const f = facts({ refs: [ref('backup'), ref('review'), ref('needed')], offlineScope: new Set(['needed']), reviewOrder: [['review']] });
    expect(wantedFilesOf(f, HOLD)).toEqual([
      { hash: 'needed', format: 'wav', group: 'needed' }, { hash: 'review', format: 'wav', group: 'review' }, { hash: 'backup', format: 'wav', group: 'backup' }
    ]);
  });

  it('a file the server has moves only if it is needed or open for review', () => {
    const f = facts({ refs: [ref('a', true), ref('b', true), ref('c', true)], offlineScope: new Set(['a']), reviewOrder: [['b']] });
    expect(hashes(f, HOLD)).toEqual(['a', 'b']);
  });

  it('a file both needed and open for review is needed, and a repeat is asked for once', () => {
    const f = facts({ refs: [ref('a'), ref('a')], offlineScope: new Set(['a']), reviewOrder: [['a']] });
    expect(wantedFilesOf(f, HOLD)).toEqual([{ hash: 'a', format: 'wav', group: 'needed' }]);
  });

  it('asks for nothing no reference names, since it would not know the format', () => {
    expect(hashes(facts({ offlineScope: new Set(['a']), reviewOrder: [['b']] }), HOLD)).toEqual([]);
  });

  it('someone who cannot review has no review group, and those files are backups', () => {
    const f = facts({ refs: [ref('a'), ref('b', true)], reviewOrder: null });
    expect(wantedFilesOf(f, HOLD)).toEqual([{ hash: 'a', format: 'wav', group: 'backup' }]);
  });

  it('needed goes by the plan, review by the order the app offers, backups by fewest copies and then the plan', () => {
    const f = facts({
      refs: [ref('n2'), ref('n1'), ref('r2'), ref('r1'), ref('r3'), ref('b1'), ref('b2'), ref('b3'), ref('b4')],
      offlineScope: new Set(['n1', 'n2']), reviewOrder: [['r1', 'r3'], ['r2']],
      copies: new Map([['b1', 2], ['b2', 1], ['b3', 1]]), planOrder: ['n1', 'n2', 'b3', 'b2', 'b1', 'b4']
    });
    expect(hashes(f, HOLD)).toEqual(['n1', 'n2', 'r1', 'r3', 'r2', 'b4', 'b3', 'b2', 'b1']);
  });

  it('files outside the plan go after those in it, by hash', () => {
    const f = facts({ refs: [ref('z'), ref('y'), ref('m')], planOrder: ['m'] });
    expect(hashes(f, HOLD)).toEqual(['m', 'y', 'z']);
    expect(hashes({ ...f, planOrder: ['m', 'm'] }, HOLD)).toEqual(['m', 'y', 'z']);
  });

  it('with the row off it takes needed files and a window of review, in that order, and no backups', () => {
    const f = facts({ refs: [ref('n'), ref('r1'), ref('r2'), ref('r3'), ref('b')], offlineScope: new Set(['n']), reviewOrder: [['r1'], ['r2'], ['r3']] });
    expect(hashes(f, { hold: false, reviewWindow: 2 })).toEqual(['n', 'r1', 'r2']);
    expect(hashes(f, { hold: false, reviewWindow: 0 })).toEqual(['n']);
    expect(hashes(f, { hold: false, reviewWindow: 99 })).toEqual(['n', 'r1', 'r2', 'r3']);
    expect(hashes(f, { hold: false, reviewWindow: -1 })).toEqual(['n']);
    expect(hashes(f, { hold: false, reviewWindow: NaN })).toEqual(['n']);
  });

  it('with the row off a file past the window is not wanted, even when the server has none of it', () => {
    const f = facts({ refs: [ref('r1', true), ref('r2')], reviewOrder: [['r1'], ['r2']] });
    expect(hashes(f, { hold: false, reviewWindow: 1 })).toEqual(['r1']);
    expect(hashes({ ...f, reviewOrder: null }, { hold: false, reviewWindow: 1 })).toEqual([]);
  });

  it('gives one order whatever order the references come in', () => {
    const refs = ['a', 'b', 'c', 'd', 'e', 'f'].map((h, i) => ref(h, i % 3 === 0));
    const f = facts({ refs, offlineScope: new Set(['a', 'b']), reviewOrder: [['c'], ['d']], copies: new Map([['e', 2], ['f', 2]]), planOrder: ['f', 'e', 'b', 'a'] });
    const first = wantedFilesOf(f, HOLD);
    for (let turn = 1; turn < refs.length; turn++) {
      expect(wantedFilesOf({ ...f, refs: [...refs.slice(turn), ...refs.slice(0, turn)] }, HOLD)).toEqual(first);
    }
  });

  it('an aside file still counts: the walk is over references, not a passage\'s files', () => {
    const state = foldLanguage(events(), emptyLanguageState());
    const refs = [...referencedBlobs(state).values()].map((r) => ({ hash: r.hash, format: r.format, confirmed: isStored(state, r.hash) }));
    const unconfirmed = refs.filter((r) => !r.confirmed).map((r) => r.hash).sort();
    expect(unconfirmed.length).toBeGreaterThan(0);
    expect(hashes(facts({ refs }), HOLD).sort()).toEqual(unconfirmed);
    expect(hashes(facts({ refs }), { hold: false, reviewWindow: 5 })).toEqual([]);
  });
});

describe('why a nearby file is kept', () => {
  const sets = { named: new Set(['needed', 'review', 'both', 'backup']), offlineScope: new Set(['needed', 'both']), review: new Set(['review', 'both']) };

  it('says so from what is true now, and a file no reference names goes first', () => {
    expect(nearbyGroupOf('needed', sets)).toBe('needed');
    expect(nearbyGroupOf('both', sets)).toBe('needed');
    expect(nearbyGroupOf('review', sets)).toBe('review');
    expect(nearbyGroupOf('backup', sets)).toBe('backup');
    expect(nearbyGroupOf('gone', sets)).toBe('unnamed');
    expect(nearbyGroupOf('gone', { ...sets, offlineScope: new Set(['gone']) })).toBe('unnamed');
  });

  it('moves as the work moves: a backup asked of this person becomes needed, and a checked file a backup', () => {
    expect(nearbyGroupOf('backup', { ...sets, offlineScope: new Set(['backup']) })).toBe('needed');
    expect(nearbyGroupOf('review', { ...sets, review: new Set() })).toBe('backup');
  });
});
