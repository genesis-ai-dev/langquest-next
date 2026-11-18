import { carriedApkName, CARRIED_APK_PATH } from '@langquest-next/core';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { apkCheck, apkGet, apkReminder, apkShown, apkStale, apkStart, joinRows, letInVersionsWords } from '../src/nearby/carriedApkModel';
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
    // Another build's file for the same versions is not older: it lets a new phone join this one.
    expect(apkStale(NOW, SIBLING)).toBe(false);
    expect(apkStale(NOW, 'not a name')).toBe(true);
    expect(apkStale(NOW, null)).toBe(false);
    expect(apkStale(null, OLDER)).toBe(false);
    // Not read yet: nothing is known to be old.
    expect(apkStale(NOW, undefined)).toBe(false);
  });
});

describe('Sync reminding a carrier to get the file', () => {
  const url = `https://next.example/apk/${NOW}`;
  const at = (over: Partial<Parameters<typeof apkReminder>[0]> = {}) =>
    apkReminder({ letIn: null, needed: NOW, url, opened: null, online: true, ...over });

  it('reminds someone who can let a new person in, while online, when the file was never got or is for an older version', () => {
    expect(at()).toBe('not-got');
    expect(at({ opened: OLDER })).toBe('older');
    // A run-out pass still shows A new person on Share nearby; getting the file online renews it.
    expect(at({ letIn: 'expired' })).toBe('not-got');
  });

  it('is gone once the right file is got, and before the remembered name is read', () => {
    expect(at({ opened: NOW })).toBeNull();
    expect(at({ opened: undefined })).toBeNull();
  });

  it('shows only while online, never offline or before the server was tried', () => {
    expect(at({ online: false })).toBeNull();
    expect(at({ online: null })).toBeNull();
  });

  it('shows only on the terms that show A new person, and only with a file to get', () => {
    for (const why of ['loading', 'not-in-build', 'no-pass', 'no-role', 'read-only', 'permissions', 'wifi-off'] as const) {
      expect(at({ letIn: why }), why).toBeNull();
    }
    expect(at({ needed: null })).toBeNull();
    expect(at({ url: null })).toBeNull();
  });

  it('has its one line in English, as Carl gave it, and no second line on Ready for offline', () => {
    const en = JSON.parse(readFileSync(join(import.meta.dirname, '../src/nearby/i18n/en.json'), 'utf8')) as { nearby: { installFile: Record<string, string> } };
    expect(en.nearby.installFile['remind']).toBe('Get the install file before you go offline');
    // Ready for offline's line said the same on the same screen at the same moments (Carl, 2026-11-18).
    expect(Object.keys(en.nearby.installFile)).not.toEqual(expect.arrayContaining(['notGot']));
    expect(Object.keys(en.nearby.installFile).filter((k) => ['notGot', 'older', 'getIt', 'lineHelp'].includes(k))).toEqual([]);
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
    expect(apkStart(NOW)).toBe('r21-l1-p1-');
    expect(SIBLING.startsWith(apkStart(NOW))).toBe(true);
    expect(OLDER.startsWith(apkStart(NOW))).toBe(false);
    expect([apkShown('odd.apk'), apkStart('odd.apk')]).toEqual(['odd.apk', 'odd.apk']);
  });

  it('says so in every language, with the start in each', () => {
    const dir = join(import.meta.dirname, '../src/nearby/i18n');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const letIn = JSON.parse(readFileSync(join(dir, file), 'utf8')).nearby.letIn;
      expect(letIn.fileStart, file).toContain('{{start}}');
      expect(letIn.fileExact, file).toBeUndefined();
    }
  });
});

describe('the inviter told of a version refusal', () => {
  it('names the file this phone needs, or the version without a name where there is none', () => {
    expect(letInVersionsWords(NOW)).toEqual({ key: 'nearby.letIn.end.versions', file: 'r21-l1-p1-….apk' });
    expect(letInVersionsWords(null)).toEqual({ key: 'nearby.letIn.end.versionsUnnamed' });
  });
});
