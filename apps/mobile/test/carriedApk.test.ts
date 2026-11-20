import { carriedApkName, carriedFileName, CARRIED_APK_PATH } from '@langquest-next/core';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apkCheck, apkGet, apkShown, apkStale, apkStep, cannotGive, installFileItem, joinRows, KEPT_BEHIND_MS, keptBehind, letInVersionsWords } from '../src/nearby/carriedApkModel';
import { carriedApkAddress } from '../src/server/carriedApkModel';

/**
 * The install file on a carrier's phone (docs/nearby-sync-plan.md 14.4). Why these tests: a
 * carrier who leaves town with a file for older versions can let nobody in, so the screen must say
 * so while they can still fix it; the address must be the Worker's own route for exactly this
 * name; the check must take a file for this phone's versions as right, whatever build's
 * fingerprint ends its name, and nothing else; and the inviter must be told which file the
 * newcomer needs.
 */

const base = { reducer: 21, lines: 1, protocol: { min: 1, max: 1 }, fingerprint: '4989edff0a1b2c3d' };
const NOW = carriedApkName(base)!;
const OLDER = carriedApkName({ ...base, reducer: 20 })!;
/** The same versions from another build: what the Worker sends a phone to when its own build has no file. */
const SIBLING = carriedApkName({ ...base, fingerprint: '401de22e' })!;

describe('Share nearby\'s rows', () => {
  it('offers Get the install file beside Let someone in, on the same terms, and only with a file to name', () => {
    expect(joinRows(null, NOW)).toEqual({ letIn: 'ready', installFile: true });
    // A run-out pass keeps both rows: Let someone in disabled, the file still got online, which renews the pass.
    expect(joinRows('expired', NOW)).toEqual({ letIn: 'expired', installFile: true });
    expect(joinRows(null, null)).toEqual({ letIn: 'ready', installFile: false });
    for (const why of ['loading', 'not-in-build', 'no-pass', 'no-role', 'read-only', 'permissions', 'wifi-off'] as const) {
      expect(joinRows(why, NOW)).toEqual({ letIn: null, installFile: false });
    }
  });
});

describe('getting the file', () => {
  it('builds the Worker address for a carried build name, and nothing for any other name or no Worker', () => {
    expect(carriedApkAddress('https://next.example', NOW)).toBe(`https://next.example${CARRIED_APK_PATH}${NOW}`);
    expect(carriedApkAddress('https://next.example/', NOW)).toBe(`https://next.example/apk/${NOW}`);
    expect(carriedApkAddress(null, NOW)).toBeNull();
    expect(carriedApkAddress('', NOW)).toBeNull();
    expect(carriedApkAddress('https://next.example', '../current.json')).toBeNull();
    expect(carriedApkAddress('https://next.example', `${NOW}?x=1`)).toBeNull();
  });

  it('builds the address of the same file for the app to take, as .carried, and of nothing else ending so', () => {
    expect(carriedApkAddress('https://next.example', carriedFileName(NOW)!)).toBe(`https://next.example/apk/${carriedFileName(NOW)}`);
    expect(carriedApkAddress('https://next.example', 'current.carried')).toBeNull();
    expect(carriedApkAddress('https://next.example', `${NOW}.carried`)).toBeNull();
  });

  it('offers the browser download while not known to be offline, disables it offline, and hides it with no name or address', () => {
    const url = `https://next.example/apk/${NOW}`;
    expect(apkGet({ needed: NOW, url, online: true })).toBe('ready');
    expect(apkGet({ needed: NOW, url, online: null })).toBe('ready');
    expect(apkGet({ needed: NOW, url, online: false })).toBe('offline');
    expect(apkGet({ needed: null, url, online: true })).toBeNull();
    expect(apkGet({ needed: NOW, url: null, online: true })).toBeNull();
  });
});

describe('the step after the browser', () => {
  // Why: Carl's offline install test took too many steps, and after the browser's download a
  // carrier came back to a screen whose main button still said to get the file, with the step
  // that keeps it (Check my file) a small button below (Carl's choice, 2026-11-18). Once they
  // have gone to get the file this phone needs, choosing it is the main button until it is in hand.
  const kept = { name: NOW, size: 212 * 1024 * 1024 };
  const at = (over: Partial<Parameters<typeof apkStep>[0]> = {}) => apkStep({ needed: NOW, opened: null, kept: null, canGive: true, right: null, ...over });

  it('asks to get the file until the person has gone to get the one for these versions', () => {
    expect(at()).toBe('get');
    expect(at({ opened: OLDER })).toBe('get');
    expect(at({ opened: 'not a name' })).toBe('get');
  });

  it('then asks to choose the downloaded file, whichever build of these versions the browser got', () => {
    expect(at({ opened: NOW })).toBe('choose');
    expect(at({ opened: SIBLING })).toBe('choose');
    // A right name whose copy could not be kept (not this app's own, no room) is chosen again.
    expect(at({ opened: NOW, right: NOW })).toBe('choose');
  });

  it('is done once a copy for these versions is kept, or, where none can be kept, once the file chosen is right', () => {
    expect(at({ opened: NOW, kept })).toBe('done');
    expect(at({ opened: NOW, kept: { ...kept, name: SIBLING } })).toBe('done');
    // A file from a card or Quick Share, chosen without the browser, counts the same.
    expect(at({ opened: null, kept })).toBe('done');
    // A kept copy for older versions is about to go, so it is not in hand.
    expect(at({ opened: NOW, kept: { ...kept, name: OLDER } })).toBe('choose');
    // Where none can be kept, a file found right is remembered by name, so it holds on a later
    // visit and on Sync's list, and stops holding once this phone needs other versions.
    expect(at({ opened: NOW, canGive: false, right: NOW })).toBe('done');
    expect(at({ opened: NOW, canGive: false, right: SIBLING })).toBe('done');
    expect(at({ opened: NOW, canGive: false, right: OLDER })).toBe('choose');
    expect(at({ opened: NOW, canGive: false })).toBe('choose');
  });

  it('shows no step until what was got and kept is read, so the main button never changes under a finger', () => {
    expect(at({ opened: undefined })).toBeNull();
    expect(at({ opened: NOW, kept: undefined })).toBeNull();
    // Where nothing can be kept, the copy is not waited for, but the name found right is.
    expect(at({ opened: NOW, kept: undefined, canGive: false })).toBe('choose');
    expect(at({ opened: NOW, canGive: false, right: undefined })).toBeNull();
    expect(at({ needed: null })).toBeNull();
  });
});

describe('a kept copy older than this phone\'s own app', () => {
  // Why: a carried file kept its first JavaScript until the versions changed, and a carrier's kept
  // copy keeps whatever they last downloaded, so a newcomer got an ever older app. The file is now
  // rebuilt daily, and the carrier is told once their copy falls behind their own app by more than
  // the refresh can lag, so a newer file is surely there to download
  // (docs/decisions/2026-11-19-carried-build-refreshed-daily.md, Carl 2026-11-19).
  const DAY = 24 * 60 * 60 * 1000;
  const app = Date.UTC(2026, 10, 19, 9);
  const kept = (builtMs: number | null | undefined) => ({ name: NOW, size: 212 * 1024 * 1024, ...(builtMs === undefined ? {} : { builtMs }) });

  it('is behind once its JavaScript is more than two days older than the app this phone runs', () => {
    expect(KEPT_BEHIND_MS).toBe(2 * DAY);
    expect(keptBehind(kept(app - 3 * DAY), app)).toBe(true);
    expect(keptBehind(kept(app - 2 * DAY - 1), app)).toBe(true);
    // Within the refresh's lag the server may hold nothing newer yet: a download would bring the same file.
    expect(keptBehind(kept(app - 2 * DAY), app)).toBe(false);
    expect(keptBehind(kept(app - DAY), app)).toBe(false);
    // Newer than the app: the carrier downloaded after their phone last updated.
    expect(keptBehind(kept(app + DAY), app)).toBe(false);
  });

  it('says nothing when either time is unknown or there is no copy', () => {
    expect(keptBehind(kept(null), app)).toBe(false);
    // A build before 2026-11-19 sends no time.
    expect(keptBehind(kept(undefined), app)).toBe(false);
    // A development build runs no update.
    expect(keptBehind(kept(app - 10 * DAY), null)).toBe(false);
    expect(keptBehind(null, app)).toBe(false);
    expect(keptBehind(undefined, app)).toBe(false);
  });
});

describe('a phone that cannot give the app', () => {
  // Why: one line used to cover both causes, so a phone on Android 9 was told to update the app,
  // which cannot help, and a phone one update away was told it never could (Carl, 2026-11-19).
  it('says which: Android before 10, which no update mends, or an older build of the app', () => {
    expect(cannotGive({ sdk: 28, native: true })).toBe('android');
    expect(cannotGive({ sdk: 28, native: false })).toBe('android');
    expect(cannotGive({ sdk: 29, native: false })).toBe('update');
    expect(cannotGive({ sdk: 29, native: true })).toBeNull();
    expect(cannotGive({ sdk: 35, native: true })).toBeNull();
  });
});

describe('a file got for an older version', () => {
  it('is too old only when a name was remembered and it is not the one needed now', () => {
    expect(apkStale(NOW, OLDER)).toBe(true);
    expect(apkStale(NOW, NOW)).toBe(false);
    // Another build's file for the same versions is not older: it lets a new phone join this one.
    expect(apkStale(NOW, SIBLING)).toBe(false);
    expect(apkStale(NOW, 'not a name')).toBe(true);
    expect(apkStale(NOW, null)).toBe(false);
    expect(apkStale(null, OLDER)).toBe(false);
    // Not read yet: nothing is known to be old.
    expect(apkStale(NOW, undefined)).toBe(false);
  });
});

describe('the install file on Ready for offline\'s list', () => {
  // Why: the list said "Got" as soon as Get was pressed, even when the download failed or the
  // file was never chosen, so a carrier could leave town believing they had it (Carl, 2026-11-19).
  const kept = { name: NOW, size: 212 * 1024 * 1024 };
  const at = (over: Partial<Parameters<typeof installFileItem>[0]> = {}) =>
    installFileItem({ letIn: null, needed: NOW, opened: null, kept: null, canGive: true, right: null, ...over });

  it('says ready only once the file is in hand, and downloaded but not chosen in between', () => {
    expect(at()).toBe('not-got');
    expect(at({ opened: OLDER })).toBe('older');
    // The browser was opened for this version: nothing says the file arrived until it is chosen.
    expect(at({ opened: NOW })).toBe('downloaded');
    expect(at({ opened: SIBLING })).toBe('downloaded');
    expect(at({ opened: NOW, kept })).toBe('ready');
    // A file from a card, chosen without the browser.
    expect(at({ kept })).toBe('ready');
    // A phone that keeps no copy: ready once a file was found right.
    expect(at({ opened: NOW, canGive: false })).toBe('downloaded');
    expect(at({ opened: NOW, canGive: false, right: NOW })).toBe('ready');
    // A run-out pass still shows A new person on Share nearby; getting the file online renews it.
    expect(at({ letIn: 'expired' })).toBe('not-got');
  });

  it('shows nothing before what was got and kept is read, nor where Share nearby offers no new person or this phone names no file', () => {
    expect(at({ opened: undefined })).toBeNull();
    expect(at({ opened: NOW, kept: undefined })).toBeNull();
    for (const why of ['loading', 'not-in-build', 'no-pass', 'no-role', 'read-only', 'permissions', 'wifi-off'] as const) {
      expect(at({ letIn: why }), why).toBeNull();
    }
    expect(at({ needed: null })).toBeNull();
  });

  it('has its words in English, as Carl approved them (2026-11-19)', () => {
    const en = JSON.parse(readFileSync(join(import.meta.dirname, '../src/nearby/i18n/en.json'), 'utf8')) as { nearby: { installFile: Record<string, string> } };
    expect(en.nearby.installFile).toMatchObject({
      title: 'Install file for a new person', readyShort: 'Install file ready',
      notGot: 'No install file for a new person yet', older: 'Install file for a new person: for an older version',
      notChosen: 'Install file for a new person: not chosen yet'
    });
    expect(Object.keys(en.nearby.installFile).filter((k) => ['remind', 'getIt', 'got', 'gotShort'].includes(k))).toEqual([]);
  });
});

describe('checking a file by its name', () => {
  it('takes any file for this phone\'s versions, whatever fingerprint ends its name or number a browser added, as right, and any other version as not', () => {
    expect(apkCheck(NOW, NOW)).toBe('right');
    expect(apkCheck(SIBLING, NOW)).toBe('right');
    expect(apkCheck(SIBLING.replace('.apk', ' (2).apk'), NOW)).toBe('right');
    expect(apkCheck(OLDER, NOW)).toBe('other');
    expect(apkCheck(carriedApkName({ ...base, lines: 2 })!, NOW)).toBe('other');
    expect(apkCheck(carriedApkName({ ...base, protocol: { min: 1, max: 2 } })!, NOW)).toBe('other');
    // Chrome saves a second download of the same file as "name (1).apk": same versions, same file.
    expect(apkCheck(NOW.replace('.apk', ' (1).apk'), NOW)).toBe('right');
    expect(apkCheck(NOW.replace('.apk', '(12).apk'), NOW)).toBe('right');
    expect(apkCheck(OLDER.replace('.apk', ' (1).apk'), NOW)).toBe('other');
    expect(apkCheck(NOW.toUpperCase(), NOW)).toBe('other');
    expect(apkCheck('LangQuest.apk', NOW)).toBe('other');
  });

  it('shows the start a name must have, with the rest left open, since the file got may be another build\'s', () => {
    expect(apkShown(NOW)).toBe('r21-l1-p1-….apk');
    expect(apkShown('odd.apk')).toBe('odd.apk');
  });

  it('names the file only when a wrong one is chosen, in every language: the app checks the file, not the person', () => {
    const dir = join(import.meta.dirname, '../src/nearby/i18n');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const letIn = JSON.parse(readFileSync(join(dir, file), 'utf8')).nearby.letIn;
      expect(letIn.checkOther, file).toContain('{{file}}');
      for (const gone of ['file', 'fileStart', 'fileExact', 'fileOld']) expect(letIn[gone], `${file} ${gone}`).toBeUndefined();
    }
  });
});

describe('the inviter told of a version refusal', () => {
  it('names the file this phone needs, or the version without a name where there is none', () => {
    expect(letInVersionsWords(NOW)).toEqual({ key: 'nearby.letIn.end.versions', file: 'r21-l1-p1-….apk' });
    expect(letInVersionsWords(null)).toEqual({ key: 'nearby.letIn.end.versionsUnnamed' });
  });
});
