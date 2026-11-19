import { t } from '../src/i18n';
import { syncSummary } from '../src/account/model';
import { offlineCount } from '../src/account/meModel';
import { downloadsLine, foldsOpenAtFirst, installBlock, joined, meSyncLine, readyLine, refusedLine, stripLink, uploadsLine } from '../src/sync/syncScreenModel';

/**
 * Sync and offline (docs/decisions/2026-11-18-sync-and-offline-one-screen.md). Why these tests: the
 * screen starts with its lists folded, so each fold's one line is all a person reads; it must say
 * what needs doing (amber, red) and never claim more than the device knows offline. The strip
 * draws the same standing the status word says, and Me's row says first what needs noticing.
 */

describe('the strip', () => {
  it('draws the standing: solid while live, dashed while polling or too old, broken while nothing reaches the server, an alert where it refuses', () => {
    expect(stripLink('live')).toBe('live');
    expect(stripLink('checking')).toBe('checking');
    expect(stripLink('tooOld')).toBe('checking');
    expect(stripLink('offline')).toBe('offline');
    // A sign-in waiting to be renewed sends nothing either: the line is broken, as offline.
    expect(stripLink('signIn')).toBe('offline');
    expect(stripLink('refused')).toBe('refused');
  });
});

describe('each fold\'s line', () => {
  it('says what waits to upload, amber only while it cannot go', () => {
    const waiting = { waiting: true, title: '3 recordings waiting to upload', sub: 'Saved on this device' };
    expect(uploadsLine(waiting, false)).toEqual({ line: joined(waiting.title, waiting.sub), tone: null });
    expect(uploadsLine(waiting, true).tone).toBe('amber');
    expect(uploadsLine({ waiting: false, title: t('uploads.allUploaded'), sub: null }, true)).toEqual({ line: t('uploads.allUploaded'), tone: null });
  });

  it('never says Up to date offline, only what this device already knows it must fetch (decision 166)', () => {
    expect(downloadsLine({ online: true, pendingDown: 0, rate: null })).toBe(t('account.more.syncUpToDate'));
    expect(downloadsLine({ online: null, pendingDown: 0, rate: null })).toBe(t('account.more.syncUpToDate'));
    expect(downloadsLine({ online: false, pendingDown: 0, rate: null })).toBe(t('account.sync.down.offline'));
    expect(downloadsLine({ online: false, pendingDown: 4, rate: '2 KB/s' })).toBe(t('account.sync.down.count', { count: 4 }));
    expect(downloadsLine({ online: true, pendingDown: 12, rate: '120 KB/s' })).toBe(joined(t('account.sync.down.count', { count: 12 }), '120 KB/s'));
    expect(downloadsLine({ online: true, pendingDown: 12, rate: '120 KB/s' })).toBe('12 recordings to receive · 120 KB/s');
  });

  it('packs for a trip: passages and, for someone who can let a new person in, the install file; amber while either still needs doing', () => {
    const all = { kept: 14, ready: 14 };
    const some = { kept: 14, ready: 12 };
    expect(readyLine(all, null)).toEqual({ line: offlineCount(all), tone: null });
    expect(readyLine(some, null)).toEqual({ line: offlineCount(some), tone: 'amber' });
    expect(readyLine(all, 'ready')).toEqual({ line: joined(offlineCount(all), t('nearby.installFile.readyShort')), tone: null });
    expect(readyLine(all, 'not-got')).toEqual({ line: joined(offlineCount(all), t('nearby.installFile.notGot')), tone: 'amber' });
    expect(readyLine(some, 'older').tone).toBe('amber');
    // Downloaded is not in hand: the file is still to choose, so the line stays amber.
    expect(readyLine(all, 'downloaded')).toEqual({ line: joined(offlineCount(all), t('nearby.installFile.notChosen')), tone: 'amber' });
    // Nothing kept is nothing to finish, and an unread count is not a problem yet.
    expect(readyLine({ kept: 0, ready: 0 }, null).tone).toBeNull();
    expect(readyLine(null, null).tone).toBeNull();
  });

  it('says of the install file only what is so, and offers the step that is next', () => {
    // Why: the item said "Got" for a press that only opened the browser, and told a carrier with a
    // kept copy to delete "this file" without saying which (Carl, 2026-11-19).
    expect(installBlock('not-got', true, false)).toEqual({ good: false, body: t('nearby.installFile.lineHelp'), way: 'get' });
    expect(installBlock('older', true, false)).toEqual({ good: false, body: t('nearby.installFile.old'), way: 'get' });
    // Getting it needs the internet; choosing a file already downloaded does not.
    expect(installBlock('not-got', true, true).way).toBe('offline');
    expect(installBlock('older', true, true).way).toBe('offline');
    expect(installBlock('downloaded', true, false)).toEqual({ good: false, body: t('nearby.installFile.downloaded'), way: 'choose' });
    expect(installBlock('downloaded', true, true).way).toBe('choose');
    expect(installBlock('ready', true, false)).toEqual({ good: true, body: t('nearby.installFile.ready'), way: null });
    // A phone that keeps no copy has one file, in Downloads: only there is it told when to delete it.
    expect(installBlock('ready', false, false).body).toContain(t('nearby.letIn.fileHelp'));
    expect(installBlock('ready', true, false).body).not.toContain(t('nearby.letIn.fileHelp'));
  });

  it('counts what the server refused', () => {
    expect(refusedLine(1)).toBe('1 change');
    expect(refusedLine(2)).toBe('2 changes');
  });
});

describe('which folds open by themselves', () => {
  it('opens Refused, the one thing to act on, and the fold a link asked for; nothing else', () => {
    expect([...foldsOpenAtFirst(undefined)]).toEqual(['refused']);
    expect([...foldsOpenAtFirst('uploads')].sort()).toEqual(['refused', 'uploads']);
    expect([...foldsOpenAtFirst('ready')].sort()).toEqual(['ready', 'refused']);
    expect([...foldsOpenAtFirst('offline')]).toEqual(['refused']);
    expect([...foldsOpenAtFirst(3)]).toEqual(['refused']);
  });
});

describe('Me\'s row for Sync and offline', () => {
  const quiet = { refused: null, refusedEvents: 0, pending: 0, recordings: 0, live: true, online: true, lastSync: 'up to date', offline: { kept: 14, ready: 12 } };
  it('says first what needs noticing, then how ready this device is for offline', () => {
    expect(meSyncLine({ ...quiet, refused: 'NOT_MEMBER', pending: 2 })).toBe(t('account.more.syncRefused'));
    expect(meSyncLine({ ...quiet, refusedEvents: 2, pending: 3 })).toBe(t('account.sync.refusedCount', { n: 2 }));
    expect(meSyncLine({ ...quiet, recordings: 2 })).toBe(syncSummary({ ...quiet, recordings: 2 }));
    expect(meSyncLine({ ...quiet, pending: 5 })).toBe(syncSummary({ ...quiet, pending: 5 }));
    // Live or offline with nothing waiting: the screen says so; Me says what comes along.
    expect(meSyncLine(quiet)).toBe(offlineCount(quiet.offline));
    expect(meSyncLine({ ...quiet, online: false, live: false })).toBe(offlineCount(quiet.offline));
  });
});
