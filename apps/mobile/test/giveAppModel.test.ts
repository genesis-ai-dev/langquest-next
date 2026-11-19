import { GIVE_IDLE_MS, giveIdle, giveMustHave, givePermissions, giveStage, megabytes, pageAddress, pageHtml, sentShown, wifiCode, wifiEscape, type GiveStatus } from '../src/nearby/giveAppModel';
import { chosenName, keepResultOf, keptStale } from '../src/nearby/carriedApkModel';

/**
 * Give the app (docs/nearby-sync-plan.md 14.5). Why these tests: a new phone's camera reads code 1
 * as a Wi-Fi login only if every field is escaped as the format asks; the page opens on whatever
 * browser a phone has, with no internet, so it must hold no script and no outside resource, and
 * name nothing a person typed without escaping it; and the screen must never say "sent" before a
 * download reached the file's end, nor run on with nobody using it.
 */

const STATUS: GiveStatus = { serving: true, sent: 0, total: 222_000_000, downloads: 0, asked: 0, lastAskedMs: 0 };
const KEPT = { name: 'r21-l1-p1-401de22e.apk', size: 222_000_000 };

describe('code 1, the Wi-Fi login', () => {
  it('escapes backslash, semicolon, comma, colon and quote, as the format asks', () => {
    expect(wifiEscape('a\\b;c,d:e"f')).toBe('a\\\\b\\;c\\,d\\:e\\"f');
    expect(wifiCode({ ssid: 'DIRECT-a7-Android_3f2c', passphrase: 'k4mnp7qrs2' })).toBe('WIFI:T:WPA;S:DIRECT-a7-Android_3f2c;P:k4mnp7qrs2;;');
    expect(wifiCode({ ssid: 'x;y', passphrase: 'p:q' })).toBe('WIFI:T:WPA;S:x\\;y;P:p\\:q;;');
  });
});

describe('code 2, the page\'s address', () => {
  it('names the group\'s own address and port, and brackets an IPv6 address', () => {
    expect(pageAddress({ address: '192.168.49.1', port: 8080 })).toBe('http://192.168.49.1:8080/');
    expect(pageAddress({ address: '192.168.49.1', port: 80 })).toBe('http://192.168.49.1/');
    expect(pageAddress({ address: 'fe80::1', port: 8080 })).toBe('http://[fe80::1]:8080/');
  });
});

describe('the page', () => {
  const words = { lang: 'es', dir: 'ltr' as const, title: 'Instalar <LangQuest>', size: '212 MB', download: 'Descargar', stepOpen: 'Abre & ve', stepAllow: '"Permite"', stepInstall: 'Instala' };
  const html = pageHtml(words, KEPT.name);
  it('is one self-contained page: no script, no outside address, in the carrier\'s language', () => {
    expect(html).toMatch(/^<!doctype html><html lang="es" dir="ltr">/);
    expect(pageHtml({ ...words, lang: 'ar', dir: 'rtl' }, KEPT.name)).toMatch(/^<!doctype html><html lang="ar" dir="rtl">/);
    expect(html).not.toMatch(/<script|https?:\/\/|src=|@import|url\(/i);
    expect(html).toContain('<meta charset="utf-8">');
  });
  it('offers the kept file by its name at the server\'s own path, and escapes every word', () => {
    expect(html).toContain(`href="/${KEPT.name}" download="${KEPT.name}"`);
    expect(html).toContain('Instalar &lt;LangQuest&gt;');
    expect(html).toContain('Abre &amp; ve');
    expect(html).toContain('&quot;Permite&quot;');
    expect(html).not.toContain('<LangQuest>');
    // Three steps, each with its picture.
    expect(html.match(/<li><svg/g)).toHaveLength(3);
  });
});

describe('the permission Wi-Fi Direct needs', () => {
  it('is nearby Wi-Fi devices from Android 13, location before, and nothing below Android 10', () => {
    expect(givePermissions(34)).toEqual(['NEARBY_WIFI_DEVICES']);
    expect(givePermissions(33)).toEqual(['NEARBY_WIFI_DEVICES']);
    expect(givePermissions(32)).toEqual(['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION']);
    expect(givePermissions(29)).toEqual(['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION']);
    expect(givePermissions(28)).toEqual([]);
  });
  it('must have fine location below Android 13, which forming a group needs: approximate alone is not enough', () => {
    expect(giveMustHave(33)).toBe('NEARBY_WIFI_DEVICES');
    expect(giveMustHave(32)).toBe('ACCESS_FINE_LOCATION');
    expect(giveMustHave(29)).toBe('ACCESS_FINE_LOCATION');
    expect(giveMustHave(28)).toBeNull();
  });
});

describe('the stage', () => {
  const base = { kept: KEPT, started: true, step: 'join' as const, status: STATUS, ended: null, failed: null };
  it('goes none, ready, starting, then the person\'s own step until the file moves', () => {
    expect(giveStage({ ...base, kept: undefined, started: false, status: null })).toEqual({ t: 'reading' });
    expect(giveStage({ ...base, kept: null, started: false, status: null })).toEqual({ t: 'none' });
    expect(giveStage({ ...base, started: false, status: null })).toEqual({ t: 'ready' });
    expect(giveStage({ ...base, status: null })).toEqual({ t: 'starting' });
    expect(giveStage(base)).toEqual({ t: 'join' });
    expect(giveStage({ ...base, step: 'download', status: { ...STATUS, asked: 1 } })).toEqual({ t: 'download' });
  });
  it('counts what is sent, and says sent only once one download reached the end', () => {
    expect(giveStage({ ...base, status: { ...STATUS, sent: 50_000_000 } })).toEqual({ t: 'sending', sent: 50_000_000, total: 222_000_000 });
    // A cut-off download resumed: more bytes than the file, still not sent until one reached the end.
    expect(giveStage({ ...base, status: { ...STATUS, sent: 300_000_000 } }).t).toBe('sending');
    expect(giveStage({ ...base, status: { ...STATUS, sent: 222_000_000, downloads: 1 } })).toEqual({ t: 'sent' });
  });
  it('says why it ended or would not start, before anything else', () => {
    expect(giveStage({ ...base, ended: 'idle' })).toEqual({ t: 'ended', why: 'idle' });
    expect(giveStage({ ...base, failed: 'wifi-off', ended: 'idle' })).toEqual({ t: 'failed', why: 'wifi-off' });
  });
});

describe('stopping for want of use', () => {
  it('stops after 15 minutes with nothing asked and nothing sent, counted from the start, the last request or the last byte', () => {
    expect(GIVE_IDLE_MS).toBe(15 * 60 * 1000);
    const at = (o: Partial<Parameters<typeof giveIdle>[0]>) => giveIdle({ startedMs: 1_000, lastAskedMs: 0, lastMovedMs: 0, nowMs: 1_000, ...o });
    expect(at({ nowMs: 1_000 + GIVE_IDLE_MS - 1 })).toBe(false);
    expect(at({ nowMs: 1_000 + GIVE_IDLE_MS })).toBe(true);
    expect(at({ lastAskedMs: 500_000, nowMs: 1_000 + GIVE_IDLE_MS })).toBe(false);
    // One slow download: a single request long ago, but bytes still moving.
    expect(at({ lastAskedMs: 2_000, lastMovedMs: 1_000 + GIVE_IDLE_MS - 10, nowMs: 1_000 + GIVE_IDLE_MS + 5 })).toBe(false);
  });
  it('never says more was sent than the file holds, though a resumed or second download counts again', () => {
    expect(sentShown(400_000_000, 222_000_000)).toBe(222_000_000);
    expect(sentShown(50_000_000, 222_000_000)).toBe(50_000_000);
    expect(sentShown(5, 0)).toBe(5);
  });
  it('says sizes in whole megabytes', () => {
    expect(megabytes(222_266_166)).toBe(212);
    expect(megabytes(0)).toBe(0);
  });
});

describe('keeping the chosen file (Check my file)', () => {
  it('reads native\'s refusal as what it means to the person', () => {
    expect(keepResultOf('FILE_REFUSED')).toBe('not-ours');
    expect(keepResultOf('FILE_NO_SPACE')).toBe('no-space');
    expect(keepResultOf('FILE_UNREADABLE')).toBe('unreadable');
    expect(keepResultOf('BAD_ARGUMENT')).toBe('unreadable');
    expect(keepResultOf('FILE_WRITE_FAILED')).toBe('failed');
    expect(keepResultOf(null)).toBe('failed');
  });
  it('keeps the copy until this phone needs other versions, whatever build its fingerprint names', () => {
    expect(keptStale(KEPT, 'r21-l1-p1-52e6dfee.apk')).toBe(false);
    expect(keptStale(KEPT, 'r22-l1-p1-52e6dfee.apk')).toBe(true);
    expect(keptStale(KEPT, null)).toBe(false);
    expect(keptStale(null, 'r22-l1-p1-52e6dfee.apk')).toBe(false);
  });
  it('names the copy without the number a browser adds to a second download', () => {
    expect(chosenName('r21-l1-p1-401de22e (1).apk')).toBe('r21-l1-p1-401de22e.apk');
    expect(chosenName('r21-l1-p1-401de22e(12).apk')).toBe('r21-l1-p1-401de22e.apk');
    expect(chosenName('r21-l1-p1-401de22e.apk')).toBe('r21-l1-p1-401de22e.apk');
  });
});
