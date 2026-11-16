import type { Verify } from '@langquest-next/core/nearby';

/**
 * The seams between nearby sync and a platform (docs/nearby-sync-plan.md 5.12). A
 * radio and a platform's crypto get in as constructor arguments (decision 104),
 * and the fleet supplies a memory link in the same shape. Every call on a link
 * rejects with `OfflineError` on a drop.
 */

/** The native frame ceiling, on every kind of link. */
export const NEARBY_MESSAGE_MAX = 1024 * 1024;

export interface NearbyLink {
  readonly kind: 'wifi-direct' | 'hotspot' | 'bluetooth' | 'memory';
  /** False on 'bluetooth'. */
  readonly canMoveFiles: boolean;
  /** One whole message, resolved when taken, so a full queue slows the sender. */
  send(message: Uint8Array): Promise<void>;
  /** The next whole message, in order. Null once the other side closed cleanly. */
  receive(): Promise<Uint8Array | null>;
  /** The opening: an exact number of raw bytes with no frame, before `secure`. */
  sendOpening(bytes: Uint8Array): Promise<void>;
  /** Null at the deadline, or once the other side has closed. */
  receiveOpening(size: number, deadlineMs: number): Promise<Uint8Array | null>;
  /** Encrypt everything from now on, both ways. Once per link, after the opening and before any message. */
  secure(keys: { send: Uint8Array; receive: Uint8Array }): Promise<void>;
  sendFile(file: { transferId: string; uri: string; size: number }): Promise<void>;
  receiveFile(file: { transferId: string; stagingUri: string; maxBytes: number; minFreeBytes: number }): Promise<{ size: number; sha256: string }>;
  cancelFile(transferId: string): Promise<void>;
  close(): Promise<void>;
}

export interface SeenPhone {
  peer: string;
  salt: string;
  r: string;
  tag: string;
  summary: string;
  echo: string;
  connectable: boolean;
  rssi?: number;
  /** The place in `scanKeys` of the key it matched. */
  scan: number;
}

export interface NearbyCapabilities {
  sdk: number;
  advertise: boolean;
  directByName: boolean;
  band5: boolean;
  hotspot: boolean;
  joinHotspot: boolean;
  bluetoothOn: boolean;
  wifiOn: boolean;
  locationOn: boolean;
}

/** Find's times and retries, all set from JavaScript so that the real-phone test can move them. */
export interface FindTunables {
  /** The jittered period of a rotation, below the stack's shortest own timer. */
  rotateMinMs: number;
  rotateMaxMs: number;
  /** Android reportedly allows 5 scan starts per 30 seconds and fails silently past it. */
  scanStartGapMs: number;
  /** A scan left running over 30 minutes is downgraded. */
  scanRestartMs: number;
  connectRetries: number;
  connectable: 'always' | { mode: 'after-hearing'; listenMs: number; connectableMs: number };
  /** One empty `ScanFilter`, the usual way round makers that hold back unfiltered scan results (section 11). */
  emptyScanFilter?: boolean;
  /** Android's advertising interval; `low` (100 ms) when left out. */
  advertiseInterval?: 'low' | 'medium' | 'high';
  /** Android's scan mode; `low-latency` when left out. */
  scanMode?: 'low-latency' | 'balanced' | 'low-power';
  /** A salt no key matched is handed up again only after this long. */
  formSaltRepeatMs?: number;
  /** How long one Bluetooth connection may take before `connectRetries` tries again. */
  connectTimeoutMs?: number;
}

/** No name or passphrase for a hotspot, because the system chooses them. */
export interface HostOptions {
  ssid?: string;
  passphrase?: string;
  band5: boolean;
}

/** The `host` message without its `t`. */
export interface HostDetails {
  kind: 'wifi-direct' | 'hotspot' | 'bluetooth';
  ssid?: string;
  passphrase?: string;
  port?: number;
  band?: string;
  security?: string;
}

/** How phones find each other and bring up a link. A QR start uses only host and join. */
export interface NearbyRadio {
  capabilities(): Promise<NearbyCapabilities>;
  /** Advertises under `kFind`, its newest generation's, and scans for every key in `scanKeys`, newest first. `payload` is tag, summary and echo, 14 bytes. */
  startFind(args: { kFind: Uint8Array; scanKeys: Uint8Array[]; payload: Uint8Array; r: Uint8Array; tunables: FindTunables }): Promise<void>;
  /** A new scan response under a new mask, never a new salt. */
  updateFind(args: { payload: Uint8Array; r: Uint8Array }): Promise<void>;
  stopFind(): Promise<void>;
  /** True stops scanning while advertising carries on, for a session; false scans again (5.12, Find). */
  holdScan(held: boolean): Promise<void>;
  /** True once an opening passed on a pipe to this phone: rotation waits, and runs as soon as it is released (5.12, Rotation). */
  holdSalt(held: boolean): Promise<void>;
  onFound(hear: (seen: SeenPhone) => void): () => void;
  /** The salt of an advert of this form that no key in `scanKeys` matches. */
  onFormSalt(hear: (salt: string, rssi?: number) => void): () => void;
  /** This phone's salt, at each start and rotation. */
  onSalt(hear: (salt: string) => void): () => void;
  /** Someone connected; nothing is trusted until the opening checks. */
  onPipe(hear: (pipe: NearbyLink, salt: string) => void): () => void;
  /** Kind 'bluetooth'. */
  openPipe(peer: string, salt: string, scan: number): Promise<NearbyLink>;
  /**
   * The first connection takes the link, where the host's server is bound to the group's own
   * network (Wi-Fi Direct). Where it cannot be (a hotspot, whose address cannot be found
   * reliably), anyone on another network of this phone's could connect first, so `nextLink`
   * gives each later connection in turn, and the session tries every one: the link is the one
   * that proves the attempt's keys, and the rest are closed. It rejects once there will be no
   * more. A phone that connects after the link is settled is refused, and reported so the inviter
   * can be told. `takeDown` ends a group hosted for an attempt that was abandoned; a link it
   * already gave keeps running.
   */
  host(kind: 'wifi-direct' | 'hotspot', opts: HostOptions): Promise<HostDetails & HostedGroup>;
  join(kind: 'wifi-direct' | 'hotspot', details: HostDetails): Promise<NearbyLink>;
  stopAll(): Promise<void>;
}

/** A group this phone hosts, as `host` answers. */
export interface HostedGroup {
  link: Promise<NearbyLink>;
  nextLink?(): Promise<NearbyLink>;
  onRefused(hear: () => void): () => void;
  takeDown(): Promise<void>;
}

/** What sync may not import: a platform's crypto, an argument to `NearbySession` and `SyncClient` (decision 104). */
export interface NearbyCrypto {
  /** This install's key. */
  publicKey: string;
  sign(message: Uint8Array): Promise<string>;
  verify: Verify;
  sha256(bytes: Uint8Array): Uint8Array;
  hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array;
  hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: string, length: number): Uint8Array;
  x25519Pair(): { secret: Uint8Array; public: Uint8Array };
  x25519(secret: Uint8Array, theirPublic: Uint8Array): Uint8Array;
  randomBytes(size: number): Uint8Array;
}
