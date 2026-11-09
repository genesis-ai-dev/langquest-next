import { carriedApkName, CARRIED_APK_PATH } from '@langquest-next/core';
import { apkCheck, apkGet, apkStale, joinRows, letInVersionsWords } from '../src/nearby/carriedApkModel';
import { carriedApkAddress } from '../src/server/carriedApkModel';

/**
 * The install file on a carrier's phone (docs/nearby-sync-plan.md 14.4). Why these tests: a
 * carrier who leaves town with a file for older versions can let nobody in, so the screen must say
 * so while they can still fix it; the address must be the Worker's own route for exactly this
 * name; the check must take only the exact name as right; and the inviter must be told which file
 * the newcomer needs.
 */

const base = { reducer: 21, lines: 1, protocol: { min: 1, max: 1 }, fingerprint: '4989edff0a1b2c3d' };
const NOW = carriedApkName(base)!;
const OLDER = carriedApkName({ ...base, reducer: 20 })!;

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

  it('offers the browser download while not known to be offline, disables it offline, and hides it with no name or address', () => {
    const url = `https://next.example/apk/${NOW}`;
    expect(apkGet({ needed: NOW, url, online: true })).toBe('ready');
    expect(apkGet({ needed: NOW, url, online: null })).toBe('ready');
    expect(apkGet({ needed: NOW, url, online: false })).toBe('offline');
    expect(apkGet({ needed: null, url, online: true })).toBeNull();
    expect(apkGet({ needed: NOW, url: null, online: true })).toBeNull();
  });
});

describe('a file got for an older version', () => {
  it('is too old only when a name was remembered and it is not the one needed now', () => {
    expect(apkStale(NOW, OLDER)).toBe(true);
    expect(apkStale(NOW, NOW)).toBe(false);
    expect(apkStale(NOW, null)).toBe(false);
    expect(apkStale(null, OLDER)).toBe(false);
  });
});

describe('checking a file by its name', () => {
  it('takes the exact name, or the same name a browser numbered for a second download, as right, and any other version as not', () => {
    expect(apkCheck(NOW, NOW)).toBe('right');
    expect(apkCheck(OLDER, NOW)).toBe('other');
    // Chrome saves a second download of the same file as "name (1).apk": same versions, same file.
    expect(apkCheck(NOW.replace('.apk', ' (1).apk'), NOW)).toBe('right');
    expect(apkCheck(NOW.replace('.apk', '(12).apk'), NOW)).toBe('right');
    expect(apkCheck(OLDER.replace('.apk', ' (1).apk'), NOW)).toBe('other');
    expect(apkCheck(NOW.toUpperCase(), NOW)).toBe('other');
    expect(apkCheck('LangQuest.apk', NOW)).toBe('other');
  });
});

describe('the inviter told of a version refusal', () => {
  it('names the file this phone needs, or the version without a name where there is none', () => {
    expect(letInVersionsWords(NOW)).toEqual({ key: 'nearby.letIn.end.versions', file: NOW });
    expect(letInVersionsWords(null)).toEqual({ key: 'nearby.letIn.end.versionsUnnamed' });
  });
});
