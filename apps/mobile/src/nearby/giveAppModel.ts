// Give the app (docs/nearby-sync-plan.md 14.5), as pure rules: what the two QR codes hold, the page
// the new phone opens, which permission the Wi-Fi Direct group needs, and the stage the screen
// shows from what the page's server has done. Nothing here calls anything: test/giveAppModel.test.ts.
import type { KeptFile } from './carriedApkModel';
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
  kept: KeptFile | null | undefined; started: boolean; step: 'join' | 'download'; status: GiveStatus | null; ended: GiveEnd | null; failed: GiveFail | null;
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
  stepAllow: string;
  stepInstall: string;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Three plain pictures of what follows on the new phone: the file, the switch that allows it, the install. */
const PICTURES = [
  // i18n-ignore: drawings, no words
  '<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><rect x="10" y="4" width="28" height="40" rx="5" fill="#fff" stroke="#5B3FD9" stroke-width="3"/><path d="M24 14v14m-6-6 6 6 6-6" stroke="#5B3FD9" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><rect x="16" y="33" width="16" height="4" rx="2" fill="#5B3FD9"/></svg>',
  // i18n-ignore: a drawing, no words
  '<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><rect x="6" y="16" width="36" height="16" rx="8" fill="#16A34A"/><circle cx="34" cy="24" r="6" fill="#fff"/><path d="M11 24l3 3 5-6" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // i18n-ignore: a drawing, no words
  '<svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><rect x="6" y="14" width="36" height="20" rx="10" fill="#5B3FD9"/><path d="M17 24l5 5 9-10" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
];

/**
 * The page the new phone opens (code 2): what this is, the size, one Download button for the kept
 * file, and three pictures of what follows. No script, no outside resource: it is opened with no
 * internet, on whatever browser the phone has. It names nothing of the team.
 */
export function pageHtml(words: PageWords, fileName: string): string {
  const w = Object.fromEntries(Object.entries(words).map(([k, v]) => [k, escapeHtml(v)])) as unknown as PageWords;
  const href = `/${encodeURIComponent(fileName)}`;
  const steps = [w.stepOpen, w.stepAllow, w.stepInstall]
    .map((text, i) => `<li>${PICTURES[i]}<span>${text}</span></li>`).join('');
  // i18n-ignore: the page's markup; its words come from `words`, out of the catalog
  return `<!doctype html><html lang="${w.lang}" dir="${w.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${w.title}</title>`
    + '<style>body{font-family:sans-serif;margin:0;padding:24px;background:#F5F3FF;color:#1E1B3A}h1{font-size:24px;margin:0 0 8px}p{margin:0 0 20px;color:#5B5675}'
    + 'a.go{display:block;text-align:center;background:#5B3FD9;color:#fff;font-size:20px;font-weight:700;padding:18px;border-radius:14px;text-decoration:none}'
    + 'ol{list-style:none;padding:0;margin:28px 0 0}li{display:flex;align-items:center;gap:14px;margin:0 0 16px;font-size:17px}svg{flex:none}</style></head>'
    // i18n-ignore: markup around the catalog's words
    + `<body><h1>${w.title}</h1><p>${w.size}</p><a class="go" href="${href}" download="${escapeHtml(fileName)}">${w.download}</a><ol>${steps}</ol></body></html>`;
}
