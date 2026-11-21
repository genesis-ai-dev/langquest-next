import { GIVE_IDLE_MS, giveIdle, giveMustHave, givePermissions, giveStage, giveStatusOf, giveTick, handsOver, megabytes, pageAddress, pageHtml, sentShown, shareOffered, stepAfterJoined, wifiCode, wifiEscape, type GiveStage, type GiveStatus } from '../src/nearby/giveAppModel';
import { apkCheck, chosenName, keepResultOf, keptStale } from '../src/nearby/carriedApkModel';

/**
 * Give the app (docs/nearby-sync-plan.md 14.5). Why these tests: a new phone's camera reads code 1
 * as a Wi-Fi login only if every field is escaped as the format asks; the page opens on whatever
 * browser a phone has, with no internet, so it must hold no script and no outside resource, and
 * name nothing a person typed without escaping it; and the screen must never say "sent" before a
 * download reached the file's end, nor run on with nobody using it. Code 2 follows code 1 by itself
 * once a phone joins, and the download starts by itself, for people who are not technical; Quick
 * Share is offered only where it cannot stop a running group, since its sheet takes the app away.
 * Let them in hands a serving group to Let someone in, which then owns it, so the new phone's
 * LangQuest finds the carrier's phone with no third code; the page offers Join for when it does not.
 */

const STATUS: GiveStatus = { serving: true, sent: 0, total: 222_000_000, downloads: 0, asked: 0, lastAskedMs: 0, joined: 0 };
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
  const words = {
    lang: 'es', dir: 'ltr' as const, title: 'Instalar <LangQuest>', size: '212 MB', download: 'Descargar', stepOpen: 'Abre & ve', stepFind: 'Si ya no está, busca <r21>',
    stepAllow: '"Permite"', stepInstall: 'Instala', stepJoin: 'Abre LangQuest <aquí>', join: 'Unirse & ya'
  };
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
    // Four steps, each with its picture: the file, the switch, the install, and joining.
    expect(html.match(/<li><svg/g)).toHaveLength(4);
  });
  it('starts the download by itself about a second after the page opens, with no script, and keeps the Download button', () => {
    const head = html.slice(0, html.indexOf('</head>'));
    // ?auto=1: native answers it with 204 for a phone that already asked for the file, so a tap on
    // Download within the first second, or a reload later, starts no second download.
    expect(head).toContain(`<meta http-equiv="refresh" content="1;url=/${KEPT.name}?auto=1">`);
    expect(html.match(/http-equiv="refresh"/g)).toHaveLength(1);
    // The button asks for the file itself, always.
    expect(html).toContain(`<a class="go" href="/${KEPT.name}" download="${KEPT.name}">Descargar</a>`);
    expect(html.match(/\?auto=1/g)).toHaveLength(1);
  });
  it('keeps a file name that tries to break out of the refresh, the link or the download attribute inside them', () => {
    const name = 'a"><script>x()</script>;url=http://evil/\'b.apk';
    const page = pageHtml(words, name);
    const path = `/${encodeURIComponent(name)}`;
    // Encoded, the name cannot end the attribute, add a second url= or name another host.
    expect(path).not.toMatch(/["<>&;=:]/);
    const refresh = page.match(/<meta http-equiv="refresh" content="([^"]*)">/g);
    expect(refresh).toEqual([`<meta http-equiv="refresh" content="1;url=${path}?auto=1">`]);
    expect(page).toContain(`href="${path}" download="a&quot;&gt;&lt;script&gt;x()&lt;/script&gt;;url=http://evil/&#39;b.apk"`);
    expect(page).not.toMatch(/<script/i);
  });
  it('ends with joining: LangQuest finds this phone by itself, and Join opens the join link at the server\'s own /join', () => {
    const items = html.slice(html.indexOf('<ol>'), html.indexOf('</ol>')).split('</li>').filter(Boolean);
    expect(items).toHaveLength(4);
    expect(items[3]).toContain('<span>Abre LangQuest &lt;aquí&gt;<a class="join" href="/join">Unirse &amp; ya</a></span>');
    // One Join, on the page's own server: native answers /join with the app's link once the carrier taps Let them in.
    expect(html.match(/href="\/join"/g)).toHaveLength(1);
    expect(html).toContain('a.join{');
  });
  it('says under the first step where the file is once the browser\'s Open has gone, which it does after a while', () => {
    const first = html.slice(html.indexOf('<li>'), html.indexOf('</li>'));
    expect(first).toContain('Abre &amp; ve');
    expect(first).toContain('<small>Si ya no está, busca &lt;r21&gt;</small>');
  });
});

describe('code 2 by itself', () => {
  it('moves on from code 1 once a phone joins the group, as Next does', () => {
    expect(stepAfterJoined({ step: 'join', seen: 0, joined: 1 })).toBe('download');
    expect(stepAfterJoined({ step: 'join', seen: 0, joined: 0 })).toBe('join');
    expect(stepAfterJoined({ step: 'download', seen: 0, joined: 1 })).toBe('download');
  });
  it('holds Back to the first code while that phone stays joined, and moves on when another joins', () => {
    expect(stepAfterJoined({ step: 'join', seen: 1, joined: 1 })).toBe('join');
    expect(stepAfterJoined({ step: 'join', seen: 1, joined: 0 })).toBe('join');
    expect(stepAfterJoined({ step: 'join', seen: 1, joined: 2 })).toBe('download');
  });
  it('counts no phone where native cannot tell or an older build says nothing, so Next stays the way on', () => {
    const { joined: _, ...older } = STATUS;
    expect(giveStatusOf(older).joined).toBe(0);
    expect(giveStatusOf({ ...STATUS, joined: Number.NaN }).joined).toBe(0);
    expect(giveStatusOf({ ...STATUS, joined: -1 }).joined).toBe(0);
    expect(giveStatusOf({ ...STATUS, joined: 2 })).toEqual({ ...STATUS, joined: 2 });
  });
});

describe('Send with Quick Share', () => {
  const at = (stage: GiveStage, shareable = true) => shareOffered({ stage, shareable });
  it('is offered with a kept file and no group running, before Start, after a stop or a failure', () => {
    expect(at({ t: 'ready' })).toBe(true);
    expect(at({ t: 'ended', why: 'idle' })).toBe(true);
    expect(at({ t: 'failed', why: 'permission' })).toBe(true);
    expect(at({ t: 'failed', why: 'busy' })).toBe(true);
  });
  it('is not offered mid-run, since the share sheet takes the app to the background and that stops the group', () => {
    for (const stage of [{ t: 'starting' }, { t: 'join' }, { t: 'download' }, { t: 'sending', sent: 1, total: 2 }, { t: 'sent' }] as const) expect(at(stage)).toBe(false);
  });
  it('is not offered with no kept file, or on a build whose module cannot share it', () => {
    expect(at({ t: 'reading' })).toBe(false);
    expect(at({ t: 'none' })).toBe(false);
    expect(at({ t: 'failed', why: 'no-file' })).toBe(false);
    expect(at({ t: 'ready' }, false)).toBe(false);
  });
});

describe('Let them in, with no third code', () => {
  it('hands a serving group to Let someone in where this build can host on it and this phone can let people in', () => {
    expect(handsOver({ serving: true, hostable: true, letIn: null })).toBe(true);
  });
  it('stops as before otherwise: no group serving, an older build, or a phone that cannot let anyone in', () => {
    expect(handsOver({ serving: false, hostable: true, letIn: null })).toBe(false);
    expect(handsOver({ serving: true, hostable: false, letIn: null })).toBe(false);
    for (const why of ['loading', 'no-pass', 'expired', 'no-role', 'read-only', 'not-in-build'] as const) expect(handsOver({ serving: true, hostable: true, letIn: why })).toBe(false);
  });
  it('while its own, stops for want of use or when native stopped it', () => {
    expect(giveTick({ serving: true, handed: false, idle: false })).toBe('keep');
    expect(giveTick({ serving: true, handed: false, idle: true })).toBe('idle');
    expect(giveTick({ serving: false, handed: false, idle: false })).toBe('ended');
  });
  it('once handed over, never stops it, and lets go when Let someone in has stopped it', () => {
    expect(giveTick({ serving: true, handed: true, idle: true })).toBe('keep');
    expect(giveTick({ serving: false, handed: true, idle: false })).toBe('let-go');
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
  it('names the copy as the install file it is when the browser downloaded it for the app, as .carried', () => {
    // Chrome's Open handed over "r21-l1-p1-401de22e (1).carried" on a second download (emulator, 2026-11-20).
    expect(chosenName('r21-l1-p1-401de22e (1).carried')).toBe('r21-l1-p1-401de22e.apk');
    expect(chosenName('r21-l1-p1-401de22e.carried')).toBe('r21-l1-p1-401de22e.apk');
    expect(apkCheck('r21-l1-p1-401de22e (2).carried', 'r21-l1-p1-52e6dfee.apk')).toBe('right');
    expect(apkCheck('r22-l1-p1-401de22e.carried', 'r21-l1-p1-52e6dfee.apk')).toBe('other');
    // Anything else keeps its own name, which no check takes for the right file.
    expect(chosenName('notes (1).carried')).toBe('notes.carried');
    expect(apkCheck('notes.carried', 'r21-l1-p1-52e6dfee.apk')).toBe('other');
  });
});
