import { saysOffline } from '../src/sync/networkWake';
import { fillBanner, fits, groupLook, groupOffline, groupSpoken, letGoWords, noRoomWords, offlineLook, referenceUnits } from '../src/sync/offlineModel';
import type { KeptOffline } from '../src/sync/offlineText';
import { waitingCounts } from '../src/sync/uploadsModel';

// Indicators say only what this device knows (decisions.md 166): no download offered
// offline, "On this device" only once counted, "Downloading" only while a file moves.
const kept = (o: Partial<KeptOffline>): KeptOffline => ({
  reason: 'chosen', audio: 3, here: 1, toFetch: 2, bytesToFetch: 0, notSent: 0, ready: false, studyHere: 0, studyTotal: 0,
  recordingsOnly: false, studyUnknown: false, ...o
});
const NOT_KEPT = kept({ reason: null, audio: 0, here: 0, toFetch: 0 });
const idle = { offline: false, downloading: false };

describe('the download line tells the truth', () => {
  it('offers a download only while the device is connected', () => {
    expect(offlineLook(NOT_KEPT, idle)).toMatchObject({ kind: 'none', label: 'Download for offline' });
    expect(offlineLook(NOT_KEPT, { offline: true, downloading: false })).toMatchObject({ kind: 'noConnection', label: 'Download needs a connection' });
  });

  it('says checking until the device has counted the passage', () => {
    expect(offlineLook('checking', idle)).toMatchObject({ kind: 'checking', label: 'Checking this device…' });
  });

  it('says on this device only when every file is here', () => {
    expect(offlineLook(kept({ ready: true, here: 3 }), { offline: true, downloading: false })).toMatchObject({ kind: 'ready', label: 'On this device' });
    expect(offlineLook(kept({}), { offline: true, downloading: false })).toMatchObject({ kind: 'partial', label: 'Only 1 of 3 files on this device' });
    // Kept, but its rows have not reached the device: not "on this device".
    expect(offlineLook(kept({ audio: 0, here: 0 }), idle)).toMatchObject({ kind: 'partial', label: 'Not on this device yet' });
  });

  it('says downloading only while a file of it is coming down', () => {
    expect(offlineLook(kept({}), idle)).toMatchObject({ kind: 'partial', label: 'Only 1 of 3 files on this device' });
    expect(offlineLook(kept({}), { offline: false, downloading: true })).toMatchObject({ kind: 'downloading', label: 'Downloading for offline · 1 of 3' });
    expect(offlineLook(kept({}), { offline: true, downloading: true }).kind).toBe('partial');
  });

  // A book's button keeps recordings only; the two kinds of kept passage look and read apart (decision amended 2026-11-20).
  it('tells a passage kept for its recordings alone from one kept with its reference material', () => {
    expect(offlineLook(kept({ ready: true, here: 3, recordingsOnly: true }), idle)).toEqual({ kind: 'recordings', label: 'Recordings on this device' });
    expect(offlineLook(kept({ ready: true, here: 3 }), idle)).toEqual({ kind: 'ready', label: 'On this device' });
    // Until its recordings are here it says how many are, as any kept passage does.
    expect(offlineLook(kept({ recordingsOnly: true }), idle)).toMatchObject({ kind: 'partial', label: 'Only 1 of 3 files on this device' });
  });

  it('is still checking while a kept passage\'s study guide has not been looked up: its files cannot be called here', () => {
    // Its recordings are all here; the guide may bring files this device lacks.
    expect(offlineLook(kept({ here: 3, toFetch: 0, studyUnknown: true }), idle)).toEqual({ kind: 'checking', label: 'Checking this device…' });
    // Offline it cannot be looked up, so the passage is not all here: it does not check for ever.
    expect(offlineLook(kept({ here: 3, toFetch: 0, studyUnknown: true }), { offline: true, downloading: false })).toEqual({ kind: 'partial', label: 'Not on this device yet' });
    // Recordings still to come say so, guide looked up or not.
    expect(offlineLook(kept({ studyUnknown: true }), idle)).toMatchObject({ kind: 'partial', label: 'Only 1 of 3 files on this device' });
  });

  it('reference material comes with a person\'s own passages and those kept by their own button, not with a book kept for its recordings', () => {
    const blobs = { scope: new Set(['mine']), keptUnits: new Set(['mine', 'one', 'book1', 'book2']), recordingsOnly: new Set(['book1', 'book2', 'mine']) };
    // `mine` is the person's work: it takes its reference material whatever list it is on.
    expect([...referenceUnits(blobs)].sort()).toEqual(['mine', 'one']);
    expect([...referenceUnits({ scope: new Set(), keptUnits: new Set(), recordingsOnly: new Set() })]).toEqual([]);
  });
});

// LAN-316: a book's or a section's passages as one download, by the same rules as one passage's.
describe("a book's download button tells the truth", () => {
  const MB = 1024 * 1024;
  const ids = ['GEN.1', 'GEN.2', 'GEN.3'];
  const counted = (o: Record<string, KeptOffline>) => new Map(Object.entries(o));
  const online = { offline: false, downloading: false, cost: null, room: null };
  const none = groupOffline(ids, counted({}), new Set());
  const some = groupOffline(ids, counted({ 'GEN.1': kept({ reason: 'worked', ready: true }) }), new Set());
  const all = (o: Partial<KeptOffline>[]) => groupOffline(ids, counted(Object.fromEntries(ids.map((id, i) => [id, kept(o[i] ?? {})]))), new Set(ids));

  it('counts the passages from their own counts: what a tap would keep, and what the person chose', () => {
    expect(none).toEqual({ count: 3, ready: 0, toKeep: ids, chosen: [], checking: false });
    expect(some).toEqual({ count: 3, ready: 1, toKeep: ['GEN.2', 'GEN.3'], chosen: [], checking: false });
    expect(all([{ ready: true }, { reason: 'asked' }, {}])).toEqual({ count: 3, ready: 1, toKeep: [], chosen: ['GEN.1', 'GEN.3'], checking: false });
  });

  it('says checking until the device has counted, and while a passage just chosen is not counted yet', () => {
    expect(groupOffline(ids, null, new Set()).checking).toBe(true);
    const justKept = groupOffline(ids, counted({}), new Set(['GEN.2']));
    expect(justKept).toMatchObject({ checking: true, toKeep: ['GEN.1', 'GEN.3'] });
    expect(groupLook(justKept, online)).toMatchObject({ kind: 'checking', label: 'Checking this device…', tap: null });
  });

  it('offers the whole book, and says how much audio would come once the device has worked it out', () => {
    // It says recordings, since that is all it keeps; a section's button, which says no size, has nothing under it.
    expect(groupLook(none, online)).toMatchObject({ kind: 'none', label: 'Download recordings of all 3 passages for offline', notes: [], tap: 'keep' });
    expect(groupLook(none, { ...online, cost: { bytes: 240 * MB } }).notes).toEqual(['240 MB of audio to download']);
    // Nothing of theirs is on the server to fetch: it says so, rather than look like a download that never starts.
    expect(groupLook(none, { ...online, cost: { bytes: 0, files: 0 } }).notes).toEqual(['No recordings to download yet. New ones come as they are made.']);
    // Files whose size the device does not know are not "no recordings": nothing is said of them.
    expect(groupLook(none, { ...online, cost: { bytes: 0, files: 4 } }).notes).toEqual([]);
    expect(groupLook(none, { ...online, cost: { bytes: 0 } }).notes).toEqual([]);
    expect(groupLook(groupOffline(['GEN.1'], counted({}), new Set()), online).label).toBe('Download recordings of 1 passage for offline');
  });

  it('is still checking while the size is worked out, so the offer never changes after it shows', () => {
    expect(groupLook(none, { ...online, sizing: true })).toMatchObject({ kind: 'checking', label: 'Checking this device…', tap: null });
    // Offline nothing is offered, so there is no size to wait for; and what is kept already needs none.
    expect(groupLook(none, { ...online, offline: true, sizing: true }).kind).toBe('noConnection');
    expect(groupLook(all([{ ready: true }, { ready: true }, { ready: true }]), { ...online, sizing: true }).kind).toBe('recordings');
  });

  it('offers the rest when some are kept already, and says how far those are', () => {
    expect(groupLook(some, { ...online, cost: { bytes: 3 * MB } })).toMatchObject({
      kind: 'none', label: 'Download recordings of the other 2 passages', notes: ['1 of 3 passages ready on this device', '3 MB of audio to download'], tap: 'keep'
    });
  });

  it('offers no download while the device is offline', () => {
    expect(groupLook(none, { ...online, offline: true })).toMatchObject({ kind: 'noConnection', label: 'Download needs a connection', notes: [], tap: null });
    expect(groupLook(some, { ...online, offline: true })).toMatchObject({ kind: 'noConnection', notes: ['1 of 3 passages ready on this device'], tap: null });
  });

  it('offers no group while a first download still fills the language in: the device cannot tell whether it would fit', () => {
    expect(groupLook(none, { ...online, filling: true, cost: { bytes: 3 * MB } })).toMatchObject({ kind: 'checking', label: 'Downloading this language', notes: [], tap: null });
    expect(groupLook(some, { ...online, filling: true })).toMatchObject({ kind: 'checking', label: 'Downloading this language', notes: ['1 of 3 passages ready on this device'], tap: null });
    // What is kept already still says where it stands, and can be let go.
    expect(groupLook(all([{ ready: true }, {}, {}]), { ...online, filling: true })).toMatchObject({ kind: 'partial', tap: 'letGo' });
  });

  it('offers no download that would leave no room for recording, and a tap asks again', () => {
    // Not offered: the line says why. The tap asks afresh, since room changes, and keeps them only if they fit by then.
    expect(groupLook(none, { ...online, cost: { bytes: 900 * MB }, room: 300 * MB })).toMatchObject({
      kind: 'noRoom', label: 'Not enough room on this device', notes: ['Its audio is 900 MB. This device has room for 300 MB.'], tap: 'keep',
      help: 'Free up room on this device, or download fewer passages at a time.'
    });
    // It fits exactly, and a device that cannot say how much room it has (a browser) is not held back.
    expect(groupLook(none, { ...online, cost: { bytes: 300 * MB }, room: 300 * MB }).tap).toBe('keep');
    expect(groupLook(none, { ...online, cost: { bytes: 900 * MB }, room: null }).tap).toBe('keep');
    expect(fits(1, 0)).toBe(false);
    expect(fits(0, 0)).toBe(true);
    expect(noRoomWords(900 * MB, 300 * MB)).toBe('Not enough room on this device. Its audio is 900 MB. This device has room for 300 MB.');
  });

  it('says on this device only when every passage is, and downloading only while a file is coming down', () => {
    const ready = all([{ ready: true }, { ready: true }, { ready: true }]);
    // Its mark is the recordings mark, since recordings are what a book's button keeps: not "On this device"'s solid green.
    expect(groupLook(ready, online)).toMatchObject({ kind: 'recordings', label: 'Recordings of all 3 passages are on this device', notes: [] });
    const part = all([{ ready: true }, {}, {}]);
    expect(groupLook(part, online)).toMatchObject({ kind: 'partial', label: '1 of 3 passages ready on this device', notes: [] });
    expect(groupLook(part, { ...online, downloading: true })).toMatchObject({ kind: 'downloading', label: 'Downloading for offline · 1 of 3', notes: ['Stay connected until this finishes.'] });
    expect(groupLook(part, { ...online, offline: true, downloading: true })).toMatchObject({ kind: 'partial', notes: ['Connect to finish before you travel.'] });
  });

  it('once every passage is kept, a tap lets go what the person chose, or says why none of it was a choice', () => {
    const chosen = all([{ ready: true }, {}, {}]);
    expect(groupLook(chosen, online)).toMatchObject({ tap: 'letGo', help: 'Lets this device remove their audio again when it needs room. Passages that are your work stay.' });
    expect(letGoWords(chosen)).toBe('No longer kept. Their audio may be removed to make room.');
    const mixed = all([{ reason: 'asked' }, { reason: 'worked' }, {}]);
    expect(groupLook(mixed, online).tap).toBe('letGo');
    expect(letGoWords(mixed)).toBe('No longer kept, except 2 passages that are your work.');
    expect(letGoWords(all([{ reason: 'asked' }, {}, {}]))).toBe('No longer kept, except 1 passage that is your work.');
    const work = all([{ reason: 'asked' }, { reason: 'worked' }, { reason: 'worked' }]);
    expect(groupLook(work, online)).toMatchObject({ tap: 'why', help: 'Kept because you were asked to work on these passages, or have worked on them.' });
  });

  it('is spoken as its line and what is under it', () => {
    expect(groupSpoken(groupLook(some, { ...online, cost: { bytes: 3 * MB } }))).toBe('Download recordings of the other 2 passages. 1 of 3 passages ready on this device. 3 MB of audio to download');
    expect(groupSpoken(groupLook(none, online))).toBe('Download recordings of all 3 passages for offline');
  });
});

describe('what the device knows of its network', () => {
  it('is offline only when the operating system says so', () => {
    expect(saysOffline({ isConnected: false })).toBe(true);
    expect(saysOffline({ isConnected: true, isInternetReachable: false })).toBe(true);
    expect(saysOffline({ isConnected: true, isInternetReachable: true })).toBe(false);
    // Not known yet is not offline.
    expect(saysOffline({})).toBe(false);
  });
});

describe('all uploaded means everywhere', () => {
  it("counts what waits in the organization's other languages too", () => {
    const none = { uploads: new Map(), pending: 0, orgPending: 0 };
    expect(waitingCounts(none)).toEqual({ recordings: 0, changes: 0 });
    expect(waitingCounts(none, [{ files: 2, changes: 5 }])).toEqual({ recordings: 2, changes: 5 });
  });
});

describe('fillBanner (LAN-253)', () => {
  it('shows the fill while it runs', () => {
    expect(fillBanner({ filled: 3, total: 12 }, null, 'L1')).toEqual({ filled: 3, total: 12, done: false });
  });
  it('keeps the finished fill in place once this screen has shown it, so the list under it does not move', () => {
    expect(fillBanner(null, { languageId: 'L1', total: 12 }, 'L1')).toEqual({ filled: 12, total: 12, done: true });
  });
  it('shows nothing for a fill this screen never showed, or one of another language', () => {
    expect(fillBanner(null, null, 'L1')).toBeNull();
    expect(fillBanner(null, { languageId: 'L1', total: 12 }, 'L2')).toBeNull();
    expect(fillBanner({ filled: 0, total: 0 }, null, 'L1')).toBeNull();
  });
});
