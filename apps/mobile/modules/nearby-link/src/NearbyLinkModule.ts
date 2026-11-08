import { requireOptionalNativeModule, type NativeModule } from 'expo';
import { NEARBY_NATIVE_CODES, type NearbyNativeCode } from './codes';

/**
 * The nearby link's native module as JavaScript sees it (docs/nearby-sync-plan.md 5.9, 5.12):
 * Android only and mechanism only. `nearbyLinkNative()` is null wherever the module is not in
 * the build (the web, an iPhone, an older Android binary under a newer update, a development
 * client made before it), so a caller says "not available" and nothing crashes. The adapter onto
 * sync's `NearbyRadio` and `NearbyLink` is the app's (`src/nearby/nearbyLink.android.ts`); this
 * file only names what the Kotlin offers. Byte strings in events are base64url with no padding,
 * tags and summaries hex (5.12). apps/mobile/test/nearbyNative.test.ts holds the functions, the
 * events and the codes here equal to the Kotlin's.
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
  /** Every runtime permission this Android needs is granted. */
  granted: boolean;
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
  kind: 'wifi-direct' | 'hotspot';
  ssid?: string;
  passphrase?: string;
  port: number;
  band?: string;
  security?: string;
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

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type NearbyLinkEvents = {
  onFound: (seen: NativeSeenPhone) => void;
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
  host(kind: 'wifi-direct' | 'hotspot', options: { ssid?: string; passphrase?: string; band5: boolean }, deadlineMs: number): Promise<NativeHosted>;
  /** The next link to reach a hosted group, a link id: its only one on Wi-Fi Direct, each connection in turn on a hotspot until one proves the keys; HOST_TAKEN_DOWN once there will be no more. */
  hostLink(hostId: string): Promise<string>;
  /** Takes down a group hosted for an abandoned attempt. */
  takeDown(hostId: string): Promise<void>;
  join(kind: 'wifi-direct' | 'hotspot', details: { ssid?: string; passphrase?: string; port?: number; band?: string; security?: string }, deadlineMs: number): Promise<string>;
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
