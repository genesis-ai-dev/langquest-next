import { requireOptionalNativeModule, type NativeModule } from 'expo';
import { NEARBY_NATIVE_CODES, type NearbyNativeCode } from './codes';

/**
 * The nearby link's native module as JavaScript sees it (docs/nearby-sync-plan.md 5.9, 5.12,
 * and section 7's phase 5 for iPhones): mechanism only, in Kotlin on Android and Swift on an
 * iPhone. `nearbyLinkNative()` is null wherever the module is not in the build (the web, an
 * older binary under a newer update, a development client made before it), so a caller says "not
 * available" and nothing crashes. The adapter onto sync's `NearbyRadio` and `NearbyLink` is the
 * app's (`src/nearby/nearbyLink.native.ts`); this file only names what native offers. Byte
 * strings in events are base64url with no padding, tags and summaries hex (5.12).
 * apps/mobile/test/nearbyNative.test.ts holds the functions, the events and the codes here equal
 * to the Kotlin's and the Swift's.
 */

export { NEARBY_DROP_CODES, NEARBY_NATIVE_CODES, type NearbyNativeCode } from './codes';

/** `NearbyCapabilities` in packages/sync/src/nearbyLink.ts, with two facts the screen needs for its disabled row. */
export interface NativeCapabilities {
  sdk: number;
  bluetoothLe: boolean;
  advertise: boolean;
  directByName: boolean;
  band5: boolean;
  hotspot: boolean;
  joinHotspot: boolean;
  bluetoothOn: boolean;
  wifiOn: boolean;
  locationOn: boolean;
  /** Every runtime permission this phone needs is granted. */
  granted: boolean;
  /** False on an iPhone, whose advert goes out alone; Android leaves it out. */
  scanResponse?: boolean;
  /** Apple's own direct Wi-Fi between two iPhones; Android leaves it out. */
  awdl?: boolean;
  /** Joins an Android's Wi-Fi Direct group as a plain client (an iPhone); Android leaves it out. */
  joinDirect?: boolean;
}

/** `FindTunables` in packages/sync/src/nearbyLink.ts, as the module reads it. */
export interface NativeFindTunables {
  rotateMinMs: number;
  rotateMaxMs: number;
  scanStartGapMs: number;
  scanRestartMs: number;
  connectRetries: number;
  connectable: 'always' | { mode: 'after-hearing'; listenMs: number; connectableMs: number };
  emptyScanFilter?: boolean;
  advertiseInterval?: 'low' | 'medium' | 'high';
  scanMode?: 'low-latency' | 'balanced' | 'low-power';
  formSaltRepeatMs?: number;
  connectTimeoutMs?: number;
}

/** A link's sizes and waits; each falls back to the module's own when left out. */
export interface NativeLinkTunables {
  queueMessages?: number;
  fileChunk?: number;
  fileWaitMs?: number;
  pipeBytes?: number;
  byeWaitMs?: number;
  /** How long a close reads on after its goodbye until the other side closes too, so the close is not a reset. */
  byeDrainMs?: number;
}

export interface NativeHosted {
  hostId: string;
  /** `awdl` only on an iPhone, whose `ssid` is then the Bonjour service's one-time name. */
  kind: 'wifi-direct' | 'hotspot' | 'awdl';
  ssid?: string;
  passphrase?: string;
  port: number;
  band?: string;
  security?: string;
}

/** The install file Give the app hands over (docs/nearby-sync-plan.md 14.5), kept in the app's own folder. */
export interface NativeKeptFile {
  /** The carried build's name, as core's `carriedApkName` writes it. */
  name: string;
  size: number;
}
/** A Give the app session: the Wi-Fi Direct group the new phone joins, and the page's address on it. */
export interface NativeGiving {
  ssid: string;
  passphrase: string;
  /** The group's own address, such as 192.168.49.1. */
  address: string;
  port: number;
}
/** What the page's server has done so far. */
export interface NativeGiveStatus {
  serving: boolean;
  /** Bytes of the install file sent, over every request. */
  sent: number;
  /** The install file's size. */
  total: number;
  /** Requests that got the whole file to its end. */
  downloads: number;
  /** Requests answered, the page's and the file's. */
  asked: number;
  /** When the last request came, in epoch milliseconds; 0 before any. */
  lastAskedMs: number;
}
/** `SeenPhone` in packages/sync/src/nearbyLink.ts, field for field. */
export interface NativeSeenPhone {
  peer: string;
  salt: string;
  r: string;
  tag: string;
  summary: string;
  echo: string;
  connectable: boolean;
  rssi?: number;
  scan: number;
}

/** `HeardAdvert` in packages/sync/src/nearbyLink.ts: a teammate's advert with no scan response (an iPhone's). */
export interface NativeHeardAdvert {
  peer: string;
  salt: string;
  connectable: boolean;
  rssi?: number;
  scan: number;
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type NearbyLinkEvents = {
  onFound: (seen: NativeSeenPhone) => void;
  onAdvert: (heard: NativeHeardAdvert) => void;
  onFormSalt: (e: { salt: string; rssi?: number }) => void;
  onSalt: (e: { salt: string }) => void;
  /** Someone connected to this phone's pipe under `salt`; untrusted until its opening checks. */
  onPipe: (e: { linkId: string; salt: string }) => void;
  /** A second phone tried a group whose link was already taken. */
  onRefused: (e: { hostId: string }) => void;
  onLinkDown: (e: { linkId: string; code: NearbyNativeCode }) => void;
  onFindError: (e: { code: NearbyNativeCode }) => void;
};

export interface NearbyLinkNative extends NativeModule<NearbyLinkEvents> {
  capabilities(): Promise<NativeCapabilities>;
  /**
   * Whether every permission nearby needs is granted, asking where native asks: an iPhone shows its
   * Bluetooth prompt here, once, and only after the screen's line saying why. Android asks from
   * JavaScript, so there it only answers.
   */
  askPermission(): Promise<boolean>;
  configureLinks(tunables: NativeLinkTunables): Promise<void>;
  /** `scanKeys` is every key's 32 bytes end to end, newest first. `payload` is tag, summary and echo, 14 bytes; `r` 2. */
  startFind(kFind: Uint8Array, scanKeys: Uint8Array, payload: Uint8Array, r: Uint8Array, tunables: NativeFindTunables): Promise<void>;
  updateFind(payload: Uint8Array, r: Uint8Array): Promise<void>;
  stopFind(): Promise<void>;
  /** Stops scanning while advertising carries on, during a session; false scans again. */
  holdScan(held: boolean): Promise<void>;
  /** An opening passed on a pipe to this phone: rotation waits until it is released. */
  holdSalt(held: boolean): Promise<void>;
  /** A link id. */
  openPipe(peer: string, salt: string, scan: number): Promise<string>;
  host(kind: 'wifi-direct' | 'hotspot' | 'awdl', options: { ssid?: string; passphrase?: string; band5: boolean }, deadlineMs: number): Promise<NativeHosted>;
  /** The next link to reach a hosted group, a link id: its only one on Wi-Fi Direct, each connection in turn on a hotspot or awdl until one proves the keys; HOST_TAKEN_DOWN once there will be no more. */
  hostLink(hostId: string): Promise<string>;
  /** Takes down a group hosted for an abandoned attempt. */
  takeDown(hostId: string): Promise<void>;
  join(kind: 'wifi-direct' | 'hotspot' | 'awdl', details: { ssid?: string; passphrase?: string; port?: number; band?: string; security?: string }, deadlineMs: number): Promise<string>;
  sendOpening(linkId: string, bytes: Uint8Array): Promise<void>;
  receiveOpening(linkId: string, size: number, deadlineMs: number): Promise<Uint8Array | null>;
  secure(linkId: string, sendKey: Uint8Array, receiveKey: Uint8Array): Promise<void>;
  send(linkId: string, bytes: Uint8Array): Promise<void>;
  receive(linkId: string): Promise<Uint8Array | null>;
  sendFile(linkId: string, transferId: string, uri: string, size: number): Promise<void>;
  receiveFile(linkId: string, transferId: string, stagingUri: string, maxBytes: number, minFreeBytes: number): Promise<{ size: number; sha256: string }>;
  cancelFile(linkId: string, transferId: string): Promise<void>;
  closeLink(linkId: string): Promise<void>;
  stopAll(): Promise<void>;
  /**
   * Give the app (docs/nearby-sync-plan.md 14.5). Copies the install file a person chose in Check my
   * file (`uri`, a content or file URI) into the app's own folder under `name`, and keeps it only
   * if it is this app's own: the same package and signing certificates as the running app.
   * FILE_REFUSED for any other file, FILE_NO_SPACE without room for it and `minFreeBytes` more,
   * FILE_UNREADABLE when it cannot be read. Any file kept before goes. Android only.
   */
  keepInstallFile(uri: string, name: string, minFreeBytes: number): Promise<NativeKeptFile>;
  /** The install file kept, or null. */
  keptInstallFile(): Promise<NativeKeptFile | null>;
  /** Deletes the kept install file. */
  dropInstallFile(): Promise<void>;
  /**
   * Forms a Wi-Fi Direct group with a name and passphrase of native's choosing and serves `page`
   * (HTML) at `/` and the kept file at `/<name>` on the group's own address, until
   * `stopGiveApp`, `stopAll` or the app goes to the background. FILE_UNREADABLE with no kept
   * file; GROUP_BUSY while a nearby session hosts a group. Android 10 and later.
   */
  startGiveApp(page: string, deadlineMs: number): Promise<NativeGiving>;
  giveAppStatus(): Promise<NativeGiveStatus>;
  stopGiveApp(): Promise<void>;
}

const native = requireOptionalNativeModule<NearbyLinkNative>('NearbyLink');

/** The module, or null where the build has none. */
export function nearbyLinkNative(): NearbyLinkNative | null {
  return native;
}

/** The code a native rejection carries, or null for anything else. */
export function nearbyCodeOf(error: unknown): NearbyNativeCode | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (NEARBY_NATIVE_CODES as readonly string[]).includes(code) ? (code as NearbyNativeCode) : null;
}
