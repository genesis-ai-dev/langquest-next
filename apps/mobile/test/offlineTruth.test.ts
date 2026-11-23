import { saysOffline } from '../src/sync/networkWake';
import { fillBanner, fits, groupLook, groupOffline, groupSpoken, letGoWords, noRoomWords, offlineLook, referenceUnits, workKept } from '../src/sync/offlineModel';
import type { KeptOffline } from '../src/sync/offlineText';
import { waitingCounts } from '../src/sync/uploadsModel';

// Indicators say only what this device knows (decisions.md 166): no download offered
// offline, "On this device" only once counted, "Downloading" only while a file moves.
const kept = (o: Partial<KeptOffline>): KeptOffline => ({
  reason: 'chosen', audio: 3, here: 1, toFetch: 2, bytesToFetch: 0, notSent: 0, ready: false, studyHere: 0, studyTotal: 0,
  studyUnknown: false, refHere: 0, refTotal: 0, refUnknown: false, ...o
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

  it('is still checking while a kept passage\'s study guide has not been looked up: its files cannot be called here', () => {
    // Its recordings are all here; the guide may bring files this device lacks.
    expect(offlineLook(kept({ here: 3, toFetch: 0, studyUnknown: true }), idle)).toEqual({ kind: 'checking', label: 'Checking this device…' });
    // Offline it cannot be looked up, so the passage is not all here: it does not check for ever.
    expect(offlineLook(kept({ here: 3, toFetch: 0, studyUnknown: true }), { offline: true, downloading: false })).toEqual({ kind: 'partial', label: 'Not on this device yet' });
    // Recordings still to come say so, guide looked up or not.
    expect(offlineLook(kept({ studyUnknown: true }), idle)).toMatchObject({ kind: 'partial', label: 'Only 1 of 3 files on this device' });
  });

  // Reference audio is counted with the rest of a passage's reference material (decision amended 2026-11-23).
  it("counts a kept passage's reference audio, and is still checking until the device has worked out what it wants", () => {
    expect(offlineLook(kept({ here: 3, toFetch: 0, refHere: 1, refTotal: 2 }), idle)).toMatchObject({ kind: 'partial', label: 'Only 4 of 5 files on this device' });
    expect(offlineLook(kept({ here: 3, toFetch: 0, refHere: 1, refTotal: 2 }), { offline: false, downloading: true })).toMatchObject({ kind: 'downloading', label: 'Downloading for offline · 4 of 5' });
    expect(offlineLook(kept({ here: 3, toFetch: 0, refUnknown: true }), idle)).toEqual({ kind: 'checking', label: 'Checking this device…' });
    expect(offlineLook(kept({ here: 3, toFetch: 0, refUnknown: true }), { offline: true, downloading: false })).toEqual({ kind: 'partial', label: 'Not on this device yet' });
  });

  // One kind of kept passage: a book's passages take their reference material along as one kept by its own button does (decision amended 2026-11-23).
  it("reference material comes with every kept passage: the person's own, and those chosen one by one or a book at a time", () => {
    expect([...referenceUnits({ scope: new Set(['mine']), keptUnits: new Set(['mine', 'one', 'book1']) })].sort()).toEqual(['book1', 'mine', 'one']);
    expect([...referenceUnits({ scope: new Set(), keptUnits: new Set() })]).toEqual([]);
  });
});

// LAN-316: a book's or a section's passages as one download, by the same rules as one passage's.
describe("a book's download line tells the truth", () => {
  const MB = 1024 * 1024;
  const ids = ['GEN.1', 'GEN.2', 'GEN.3'];
  const counted = (o: Record<string, KeptOffline>) => new Map(Object.entries(o));
  const online = { offline: false, downloading: false, cost: null, room: null };
  const none = groupOffline(ids, counted({}), new Set());
  const some = groupOffline(ids, counted({ 'GEN.1': kept({ reason: 'worked', ready: true }) }), new Set());
  const all = (o: Partial<KeptOffline>[]) => groupOffline(ids, counted(Object.fromEntries(ids.map((id, i) => [id, kept(o[i] ?? {})]))), new Set(ids));

  it('counts the passages from their own counts: what a tap would keep, and what the person chose', () => {
    expect(none).toEqual({ count: 3, ready: 0, toKeep: ids, chosen: [], checking: false, referenceMissing: 0, unsent: 0 });
    expect(some).toEqual({ count: 3, ready: 1, toKeep: ['GEN.2', 'GEN.3'], chosen: [], checking: false, referenceMissing: 0, unsent: 0 });
    expect(all([{ ready: true }, { reason: 'asked' }, {}])).toEqual({ count: 3, ready: 1, toKeep: [], chosen: ['GEN.1', 'GEN.3'], checking: false, referenceMissing: 0, unsent: 0 });
  });

  it('says checking until the device has counted anything', () => {
    expect(groupOffline(ids, null, new Set()).checking).toBe(true);
    expect(groupLook(groupOffline(ids, null, new Set()), online)).toMatchObject({ kind: 'checking', title: 'Checking this device…', sub: '3 passages', tap: null });
  });

  // Carl, 2026-11-23: keeping one chapter made the line shrink to "Checking this device…" and grow back, and the chapters under it moved.
  it('counts a passage chosen a moment ago as kept and not here yet, rather than checking the whole book', () => {
    const justKept = groupOffline(ids, counted({}), new Set(['GEN.2']));
    expect(justKept).toEqual({ count: 3, ready: 0, toKeep: ['GEN.1', 'GEN.3'], chosen: ['GEN.2'], checking: false, referenceMissing: 0, unsent: 0 });
    expect(groupLook(justKept, { ...online, cost: { bytes: 2 * MB } })).toMatchObject({ kind: 'none', title: '0 of 3 passages ready on this device', tap: 'keep', button: 'rest' });
    // The last one chosen: every passage is kept, none here yet, and the book can be removed again.
    expect(groupLook(groupOffline(ids, counted({}), new Set(ids)), online)).toMatchObject({ kind: 'partial', tap: 'letGo' });
  });

  it('has a second line in every state, so the line never changes height as the passages change', () => {
    const looks = [
      groupLook(groupOffline(ids, null, new Set()), online),
      groupLook(none, online), groupLook(none, { ...online, sizing: true }), groupLook(none, { ...online, offline: true }),
      groupLook(none, { ...online, filling: true }), groupLook(none, { ...online, cost: { bytes: 9 * MB }, room: MB }),
      groupLook(some, { ...online, cost: { bytes: 0, files: 0 } }),
      groupLook(all([{ ready: true }, {}, {}]), online), groupLook(all([{ ready: true }, {}, {}]), { ...online, downloading: true }),
      groupLook(all([{ ready: true }, { ready: true }, { ready: true }]), online),
      groupLook(all([{ reason: 'asked', ready: true }, { reason: 'worked', ready: true }, { reason: 'worked', ready: true }]), online)
    ];
    for (const look of looks) {
      expect(look.title).not.toBe('');
      expect(look.sub).not.toBe('');
    }
  });

  it('offers the whole book with its reference material, and says how much its recordings are once worked out', () => {
    expect(groupLook(none, online)).toMatchObject({ kind: 'none', title: '0 of 3 passages ready on this device', sub: 'Recordings and reference material', tap: 'keep', button: 'all' });
    // The size counts recordings only: reference material's size is not known before it comes, and the line says it comes too.
    expect(groupLook(none, { ...online, cost: { bytes: 240 * MB } }).sub).toBe('240 MB of recordings, plus reference material');
    // Nothing of theirs is on the server to fetch: it says so, rather than look like a download that never starts.
    expect(groupLook(none, { ...online, cost: { bytes: 0, files: 0 } }).sub).toBe('No recordings to download yet. New ones come as they are made.');
    // Files whose size the device does not know are not "no recordings".
    expect(groupLook(none, { ...online, cost: { bytes: 0, files: 4 } }).sub).toBe('Recordings and reference material');
    expect(groupLook(none, online).help).toBe("Keeps every passage's recordings and reference material on this device, so they work without a connection.");
  });

  it('offers the download while the size is worked out, and says so: a tap asks again', () => {
    expect(groupLook(none, { ...online, sizing: true })).toMatchObject({ kind: 'none', sub: 'Working out the size…', tap: 'keep' });
    // Offline nothing is offered, so there is no size to wait for; and what is kept already needs none.
    expect(groupLook(none, { ...online, offline: true, sizing: true }).kind).toBe('noConnection');
    expect(groupLook(all([{ ready: true }, { ready: true }, { ready: true }]), { ...online, sizing: true }).kind).toBe('ready');
  });

  it('offers the rest when some are kept already, and says how far those are', () => {
    expect(groupLook(some, { ...online, cost: { bytes: 3 * MB } })).toMatchObject({
      kind: 'none', title: '1 of 3 passages ready on this device', sub: '3 MB of recordings, plus reference material', tap: 'keep', button: 'rest'
    });
  });

  it('offers no download while the device is offline', () => {
    expect(groupLook(none, { ...online, offline: true })).toMatchObject({ kind: 'noConnection', title: '0 of 3 passages ready on this device', sub: 'Download needs a connection', tap: null });
    expect(groupLook(some, { ...online, offline: true })).toMatchObject({ kind: 'noConnection', title: '1 of 3 passages ready on this device', tap: null });
  });

  it('offers no group while a first download still fills the language in: the device cannot tell whether it would fit', () => {
    expect(groupLook(none, { ...online, filling: true, cost: { bytes: 3 * MB } })).toMatchObject({ kind: 'checking', title: 'Downloading this language', sub: 'Stay connected until this finishes.', tap: null });
    // What is kept already still says where it stands, and can be let go.
    expect(groupLook(all([{ ready: true }, {}, {}]), { ...online, filling: true })).toMatchObject({ kind: 'partial', tap: 'letGo' });
  });

  it('offers no download that would leave no room for recording, and a tap asks again', () => {
    // Not offered: the line says why. The tap asks afresh, since room changes, and keeps them only if they fit by then.
    expect(groupLook(none, { ...online, cost: { bytes: 900 * MB }, room: 300 * MB })).toMatchObject({
      kind: 'noRoom', title: 'Not enough room on this device', sub: 'Its audio is 900 MB. This device has room for 300 MB.', tap: 'keep',
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
    expect(groupLook(ready, online)).toMatchObject({ kind: 'ready', title: 'All 3 kept passages are on this device', sub: 'Their recordings and reference material work without a connection.' });
    // Reference audio that cannot come keeps no passage from being ready, and the line says so.
    const short = all([{ ready: true, refUnavailable: 2 }, { ready: true, refFull: 1 }, { ready: true }]);
    expect(short.referenceMissing).toBe(2);
    expect(groupLook(short, online)).toMatchObject({ kind: 'ready', sub: "Some reference audio can't be downloaded now. It plays with a connection." });
    // A recording its device has not sent keeps nothing from being ready, since no device can download it, and is said
    // first: nothing plays it anywhere until it is sent (decision 61, amended 2026-11-23).
    const unsent = all([{ ready: true, notSent: 1 }, { ready: true, refUnavailable: 1 }, { ready: true }]);
    expect(unsent).toMatchObject({ ready: 3, unsent: 1, referenceMissing: 1 });
    expect(groupLook(unsent, online)).toMatchObject({ kind: 'ready', sub: "Some recordings haven't been sent from the device that made them yet." });
    const part = all([{ ready: true }, {}, {}]);
    expect(groupLook(part, online)).toMatchObject({ kind: 'partial', title: '1 of 3 passages ready on this device', sub: 'Some files are still to come.' });
    expect(groupLook(part, { ...online, downloading: true })).toMatchObject({ kind: 'downloading', title: 'Downloading for offline · 1 of 3', sub: 'Stay connected until this finishes.' });
    expect(groupLook(part, { ...online, offline: true, downloading: true })).toMatchObject({ kind: 'partial', sub: 'Connect to finish before you travel.' });
  });

  it('once every passage is kept, a tap lets go what the person chose, or says why none of it was a choice', () => {
    const chosen = all([{ ready: true }, {}, {}]);
    expect(groupLook(chosen, online)).toMatchObject({ tap: 'letGo', help: 'Lets this device remove their audio again when it needs room. Passages that are your work stay.' });
    expect(letGoWords(chosen)).toBe('No longer kept. Their audio may be removed to make room.');
    const mixed = all([{ reason: 'asked' }, { reason: 'worked' }, {}]);
    expect(groupLook(mixed, online).tap).toBe('letGo');
    expect(letGoWords(mixed)).toBe('No longer kept, except 2 passages that are your work.');
    expect(letGoWords(all([{ reason: 'asked' }, {}, {}]))).toBe('No longer kept, except 1 passage that is your work.');
    // A book only partly downloaded: those never kept are not "your work that stays" (Carl, 2026-11-23).
    const partly = groupOffline(ids, counted({ 'GEN.1': kept({ reason: 'worked', ready: true }), 'GEN.2': kept({}) }), new Set(['GEN.2']));
    expect(partly).toMatchObject({ toKeep: ['GEN.3'], chosen: ['GEN.2'] });
    expect(workKept(partly)).toBe(1);
    expect(letGoWords(partly)).toBe('No longer kept, except 1 passage that is your work.');
    expect(workKept(groupOffline(ids, counted({ 'GEN.2': kept({}) }), new Set(['GEN.2'])))).toBe(0);
    const work = all([{ reason: 'asked', ready: true }, { reason: 'worked', ready: true }, { reason: 'worked', ready: true }]);
    // Nothing to remove: its second line says why they are kept.
    expect(groupLook(work, online)).toMatchObject({ tap: 'why', sub: 'Kept because you were asked to work on these passages, or have worked on them.' });
  });

  it('is spoken as its two lines', () => {
    expect(groupSpoken(groupLook(some, { ...online, cost: { bytes: 3 * MB } }))).toBe('1 of 3 passages ready on this device. 3 MB of recordings, plus reference material');
    // A first line that ends a sentence takes no second stop.
    expect(groupSpoken(groupLook(groupOffline(ids, null, new Set()), online))).toBe('Checking this device… 3 passages');
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
