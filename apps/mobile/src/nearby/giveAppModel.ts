// Give the app (docs/nearby-sync-plan.md 14.5), as pure rules: what the two QR codes hold, the page
// the new phone opens, which permission the Wi-Fi Direct group needs, and the stage the screen
// shows from what the page's server has done. Nothing here calls anything: test/giveAppModel.test.ts.
import type { KeptFile } from './carriedApkModel';
import type { LetInWhyNot } from './letInModel';
import type { NearbyPermission } from './nearbyPermissionsModel';

/** Give the app stops by itself after this long with nothing asked of its page. */
export const GIVE_IDLE_MS = 15 * 60 * 1000;

/** The group's name and passphrase, and the page's address on it, as native gives them. */
export interface Giving {
  ssid: string;
  passphrase: string;
  address: string;
  port: number;
}

/** What the page's server has done, as native counts it. */
export interface GiveStatus {
  serving: boolean;
  sent: number;
  total: number;
  downloads: number;
  asked: number;
  lastAskedMs: number;
  /** Phones in the group now, as Android lists them; 0 before any and where native cannot tell. */
  joined: number;
}

/**
 * Native's status as the screen takes it: a build from before `joined` says nothing of it, and a
 * count that is not a whole number above 0 is none, so code 2 then waits for Next as it always did.
 */
export function giveStatusOf(s: Omit<GiveStatus, 'joined'> & { joined?: number }): GiveStatus {
  const joined = typeof s.joined === 'number' && s.joined > 0 ? Math.floor(s.joined) : 0;
  return { ...s, joined };
}

/** The person's own step before the file moves: code 1 (join), then code 2 (download). */
export type GiveStep = 'join' | 'download';

/**
 * The step once native has counted the phones in the group: while code 1 shows, a phone joining
 * moves on to code 2 by itself, as Next does, so the carrier need not tell when it has joined.
 * `seen` is the count at the last look: a rise moves on, not a count above 0, so Back to the first
 * code holds while that phone stays joined, and the next phone to join moves on again. Next stays,
 * since some phones may not list a client (`joined` is then 0).
 */
export function stepAfterJoined(o: { step: GiveStep; seen: number; joined: number }): GiveStep {
  return o.step === 'join' && o.joined > o.seen ? 'download' : o.step;
}

/**
 * Where Give the app is:
 * - `reading`: the kept file is being looked for.
 * - `none`: no kept install file yet.
 * - `ready`: a kept file, before Start.
 * - `starting`: forming the group.
 * - `join`: code 1, the Wi-Fi login.
 * - `download`: code 2, the page's address.
 * - `sending`: the file is going.
 * - `sent`: one download reached the file's end.
 * - `ended`: stopped, by the person, the phone or the idle limit.
 * - `failed`: it would not start.
 */
export type GiveStage =
  | { t: 'reading' }
  | { t: 'none' }
  | { t: 'ready' }
  | { t: 'starting' }
  | { t: 'join' }
  | { t: 'download' }
  | { t: 'sending'; sent: number; total: number }
  | { t: 'sent' }
  | { t: 'ended'; why: GiveEnd }
  | { t: 'failed'; why: GiveFail };

export type GiveEnd = 'stopped' | 'idle' | 'phone';
/**
 * Why it would not start: Wi-Fi off; the permission
 * refused, or refused for good (`blocked`, only settings can allow it), or not yet allowed on a
 * phone wearing a cover, which asks nothing from this screen (Carl's answer 15: Share nearby asks,
 * after its line); Share nearby holding Wi-Fi Direct; no kept file; anything else.
 */
export type GiveFail = 'wifi-off' | 'permission' | 'blocked' | 'permission-covered' | 'busy' | 'no-file' | 'failed';

/** A Wi-Fi QR code's field, with `\ ; , : "` escaped as the format asks. */
export function wifiEscape(value: string): string {
  return value.replace(/[\\;,:"]/g, (c) => `\\${c}`);
}

/** Code 1: the Wi-Fi login a phone's camera offers to join (WPA2, the passphrase native chose). */
export function wifiCode(g: Pick<Giving, 'ssid' | 'passphrase'>): string {
  return `WIFI:T:WPA;S:${wifiEscape(g.ssid)};P:${wifiEscape(g.passphrase)};;`;
}

/** Code 2: the page's address on the group, which the new phone's browser opens. */
export function pageAddress(g: Pick<Giving, 'address' | 'port'>): string {
  const host = g.address.includes(':') ? `[${g.address}]` : g.address;
  return g.port === 80 ? `http://${host}/` : `http://${host}:${g.port}/`;
}

/**
 * The permissions to ask for Wi-Fi Direct at this Android level: nearby Wi-Fi devices from 13,
 * location before. Android 12 shows fine and coarse location as one prompt that must ask for both.
 */
export function givePermissions(sdk: number): readonly NearbyPermission[] {
  if (sdk < 29) return [];
  return sdk >= 33 ? ['NEARBY_WIFI_DEVICES'] : ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'];
}

/**
 * The one that must be granted: forming a group needs fine location before Android 13, so a
 * person who allows only approximate location is told it is needed (native checks the same,
 * `Radios.wifiDirectNeeded`).
 */
export function giveMustHave(sdk: number): NearbyPermission | null {
  if (sdk < 29) return null;
  return sdk >= 33 ? 'NEARBY_WIFI_DEVICES' : 'ACCESS_FINE_LOCATION';
}

/** A size in megabytes, whole, for the screen and the page ("212 MB"). */
export function megabytes(bytes: number): number {
  return Math.max(0, Math.round(bytes / (1024 * 1024)));
}

/**
 * The stage from what native says. Before the first byte of the file goes, the person's own step
 * (join, then download) holds; once it goes, the count; once one download reached the end, sent.
 */
export function giveStage(o: {
  kept: KeptFile | null | undefined; started: boolean; step: GiveStep; status: GiveStatus | null; ended: GiveEnd | null; failed: GiveFail | null;
}): GiveStage {
  if (o.failed) return { t: 'failed', why: o.failed };
  if (o.ended) return { t: 'ended', why: o.ended };
  if (o.kept === undefined) return { t: 'reading' };
  if (!o.kept) return { t: 'none' };
  if (!o.started) return { t: 'ready' };
  if (!o.status) return { t: 'starting' };
  if (o.status.downloads > 0) return { t: 'sent' };
  if (o.status.sent > 0) return { t: 'sending', sent: o.status.sent, total: o.status.total };
  return { t: o.step };
}

/**
 * The two ways to send the file, which the screen offers as one choice before a group runs (Carl,
 * 2026-11-20): this phone's own Wi-Fi, where the new phone scans two codes and needs nothing else,
 * or Quick Share, where both phones need Google Play services. Wi-Fi is chosen first, since it
 * works on any phone.
 */
export type GiveWay = 'wifi' | 'quick-share';

/** Who does a group of Quick Share's steps, in the order the screen names them. */
export type QuickShareOn = 'newFirst' | 'this' | 'newThen' | 'thisThen';
export type QuickShareStep = 'open' | 'visible' | 'send' | 'accept' | 'install' | 'letIn';

/**
 * Quick Share's steps in the order they are done, across the two phones, numbered right through
 * (Carl, 2026-11-20): the new phone first opens Quick Share and lets everyone find it, then this
 * phone sends, then the new phone accepts and installs, and last, where this phone can let people
 * in (`letIn`), it does. Before, one line under the button said what the new phone does, in no order.
 */
export function quickShareSteps(letIn: boolean): { on: QuickShareOn; steps: { n: number; key: QuickShareStep }[] }[] {
  const plan: [QuickShareOn, QuickShareStep[]][] = [['newFirst', ['open', 'visible']], ['this', ['send']], ['newThen', ['accept', 'install']]];
  if (letIn) plan.push(['thisThen', ['letIn']]);
  let n = 0;
  return plan.map(([on, keys]) => ({ on, steps: keys.map((key) => ({ n: ++n, key })) }));
}

/**
 * Whether Send with Quick Share is offered: with a kept file and no group running, so before the
 * first code, after a stop and after a failure that left the file. Never mid-run: Android's share
 * sheet takes the app to the background, and that stops a running Give the app. `shareable`: this
 * build's module can share the kept file (`shareInstallFile`).
 */
export function shareOffered(o: { stage: GiveStage; shareable: boolean }): boolean {
  if (!o.shareable) return false;
  const { stage } = o;
  return stage.t === 'ready' || stage.t === 'ended' || (stage.t === 'failed' && stage.why !== 'no-file');
}

/**
 * Whether Let them in hands the running group to Let someone in instead of stopping it, so the new
 * phone's LangQuest finds this phone with no third code (docs/nearby-sync-plan.md 14.5): while the
 * group serves, on a build whose module can host Let someone in on it and answer `/join`
 * (`hostable`: `hostOnGiveGroup`, `setGiveJoin`), and where this phone can let people in
 * (`letIn`, `letInWhyNot`, null). Otherwise Let them in stops it, as before.
 */
export function handsOver(o: { serving: boolean; hostable: boolean; letIn: LetInWhyNot | null }): boolean {
  return o.serving && o.hostable && o.letIn === null;
}

/**
 * What one look at native's status does to a running Give the app: `keep` it, stop it for want of
 * use (`idle`), or show it `ended` because native stopped it. Once handed to Let someone in, which
 * owns it then, it is never stopped from here: it only follows the status, and lets go (`let-go`,
 * shown as stopped, with nothing asked of native) once Let someone in has stopped it.
 */
export type GiveTick = 'keep' | 'idle' | 'ended' | 'let-go';

export function giveTick(o: { serving: boolean; handed: boolean; idle: boolean }): GiveTick {
  if (!o.serving) return o.handed ? 'let-go' : 'ended';
  return !o.handed && o.idle ? 'idle' : 'keep';
}

/**
 * Whether to stop for want of use: for GIVE_IDLE_MS nothing asked of the page and no byte of the
 * file sent, counted from the start. A slow download is use: 212 MB on a crowded channel can take
 * longer than the limit, so the time the count last moved counts as much as the last request.
 */
export function giveIdle(o: { startedMs: number; lastAskedMs: number; lastMovedMs: number; nowMs: number }): boolean {
  return o.nowMs - Math.max(o.startedMs, o.lastAskedMs, o.lastMovedMs) >= GIVE_IDLE_MS;
}

/** What the screen says is sent, never past the file's size (a resumed or second download counts again). */
export function sentShown(sent: number, total: number): number {
  return total > 0 ? Math.min(sent, total) : sent;
}

/** The words the page shows, in the carrier's app language. */
export interface PageWords {
  lang: string;
  dir: 'ltr' | 'rtl';
  title: string;
  size: string;
  download: string;
  stepOpen: string;
  /** Under the first step: where the file is once the browser's Open, which goes after a while, has gone. */
  stepFind: string;
  stepAllow: string;
  stepInstall: string;
  /** The last step: open LangQuest, which finds this phone by itself, or come back and tap Join. */
  stepJoin: string;
  /** The Join link's word, for when LangQuest does not find this phone by itself. */
  join: string;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Four plain pictures of what follows on the new phone: the file, the switch that allows it, the install, and joining. */
const PICTURES = [
  // i18n-ignore: drawings, no words
  '<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><rect x="10" y="4" width="28" height="40" rx="5" fill="#fff" stroke="#5B3FD9" stroke-width="3"/><path d="M24 14v14m-6-6 6 6 6-6" stroke="#5B3FD9" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="16" y="33" width="16" height="4" rx="2" fill="#5B3FD9"/></svg>',
  // i18n-ignore: a drawing, no words
  '<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><rect x="6" y="16" width="36" height="16" rx="8" fill="#16A34A"/><circle cx="34" cy="24" r="6" fill="#fff"/><path d="M11 24l3 3 5-6" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // i18n-ignore: a drawing, no words
  '<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><rect x="6" y="14" width="36" height="20" rx="10" fill="#5B3FD9"/><path d="M17 24l5 5 9-10" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // i18n-ignore: a drawing, no words (two phones, the new one reaching this one)
  '<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><rect x="3" y="10" width="16" height="28" rx="4" fill="#fff" stroke="#5B3FD9" stroke-width="3"/><rect x="29" y="10" width="16" height="28" rx="4" fill="#fff" stroke="#16A34A" stroke-width="3"/><path d="M21 24h6m-3-3 3 3-3 3" stroke="#16A34A" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
];

/**
 * The page the new phone opens (code 2): what this is, the size, one Download button for the kept
 * file, and four pictures of what follows, the last with a Join link to the server's own `/join`
 * for when LangQuest does not find this phone by itself; native answers it with the app's join
 * link once the carrier taps Let them in, and 404 before. No script, no outside resource: it is
 * opened with no internet, on whatever browser the phone has. It names nothing of the team. A
 * refresh in its head starts the download by itself a second after it opens (not script, so the
 * server's strict Content-Security-Policy allows it), and the button stays for a browser that does
 * not follow it. The refresh asks with `?auto=1`, which native answers with 204 for a phone that
 * already asked for the file, so a tap on Download within that second, or a reload later, starts
 * no second download; the button asks for the file itself. The file's path is percent-encoded, so
 * its name cannot end either attribute or name another address.
 */
export function pageHtml(words: PageWords, fileName: string): string {
  const w = Object.fromEntries(Object.entries(words).map(([k, v]) => [k, escapeHtml(v)])) as unknown as PageWords;
  const href = `/${encodeURIComponent(fileName)}`;
  // i18n-ignore: markup around the catalog's words
  const join = `<a class="join" href="/join">${w.join}</a>`;
  const steps = [w.stepOpen, w.stepAllow, w.stepInstall, w.stepJoin]
    .map((text, i) => `<li>${PICTURES[i]}<span>${text}${i === 0 ? `<small>${w.stepFind}</small>` : ''}${i === 3 ? join : ''}</span></li>`).join('');
  // i18n-ignore: the page's markup; its words come from `words`, out of the catalog
  return `<!doctype html><html lang="${w.lang}" dir="${w.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    // i18n-ignore: the refresh that starts the download; the title comes from the catalog
    + `<meta http-equiv="refresh" content="1;url=${href}?auto=1"><title>${w.title}</title>`
    + '<style>body{font-family:sans-serif;margin:0;padding:24px;background:#F5F3FF;color:#1E1B3A}h1{font-size:24px;margin:0 0 8px}p{margin:0 0 20px;color:#5B5675}'
    + 'a.go{display:block;text-align:center;background:#5B3FD9;color:#fff;font-size:20px;font-weight:700;padding:18px;border-radius:14px;text-decoration:none}'
    + 'ol{list-style:none;padding:0;margin:28px 0 0}li{display:flex;align-items:center;gap:14px;margin:0 0 16px;font-size:17px}small{display:block;margin-top:6px;font-size:15px;color:#5B5675}svg{flex:none}'
    // i18n-ignore: the Join link's style, a second button smaller than Download
    + 'a.join{display:block;width:max-content;margin-top:10px;padding:14px 28px;border:2px solid #5B3FD9;border-radius:12px;color:#5B3FD9;font-weight:700;text-decoration:none}</style></head>'
    // i18n-ignore: markup around the catalog's words
    + `<body><h1>${w.title}</h1><p>${w.size}</p><a class="go" href="${href}" download="${escapeHtml(fileName)}">${w.download}</a><ol>${steps}</ol></body></html>`;
}
