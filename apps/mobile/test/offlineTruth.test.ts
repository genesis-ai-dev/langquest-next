import { saysOffline } from '../src/sync/networkWake';
import { offlineLook } from '../src/sync/offlineModel';
import type { KeptOffline } from '../src/sync/offlineText';
import { waitingCounts } from '../src/sync/uploadsModel';

// Indicators say only what this device knows (decisions.md 166): no download offered
// offline, "On this device" only once counted, "Downloading" only while a file moves.
const kept = (o: Partial<KeptOffline>): KeptOffline => ({
  reason: 'chosen', audio: 3, here: 1, toFetch: 2, bytesToFetch: 0, notSent: 0, ready: false, studyHere: 0, studyTotal: 0, ...o
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
