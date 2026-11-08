import { OfflineError } from '@langquest-next/sync';
import type { FindTunables, HostDetails, HostOptions, NearbyCapabilities, NearbyLink, NearbyRadio, SeenPhone } from '@langquest-next/sync/nearby';
import {
  NEARBY_DROP_CODES, nearbyCodeOf, nearbyLinkNative, type NativeCapabilities, type NativeHosted, type NativeSeenPhone, type NearbyLinkEvents, type NearbyLinkNative,
  type NearbyNativeCode
} from '../../modules/nearby-link';

/**
 * The nearby module on an Android phone as sync's `NearbyRadio` and `NearbyLink`
 * (docs/nearby-sync-plan.md 5.9, 5.12). Mechanism only: what to trust and when to connect is
 * the room's and the session's. Every call that fails with a code saying the link went
 * (`NEARBY_DROP_CODES`) rejects with sync's `OfflineError`, as the contract says; any other
 * code rejects with a `NearbyNativeError` naming it, so diagnostics and the screen can tell a
 * refused group from a full disk. Events come up field for field. Links are kept by id with
 * what `onLinkDown` said of them, so a call on a link that went rejects at once and never
 * reaches native. Nothing here logs a key, salt or address.
 */

/** A native rejection that is not a drop, by its code (`modules/nearby-link/src/codes.ts`). */
export class NearbyNativeError extends Error {
  override name = 'NearbyNativeError';
  constructor(readonly code: NearbyNativeCode) {
    super(code);
  }
}

/** How long `host` and `join` may take natively; arguments from JavaScript, because a Kotlin edit needs a store review. */
export interface NearbyRadioOptions {
  hostDeadlineMs: number;
  joinDeadlineMs: number;
}

export const NEARBY_RADIO_DEFAULTS: NearbyRadioOptions = { hostDeadlineMs: 20_000, joinDeadlineMs: 25_000 };

/** What the app reads beside sync's radio: the module's own facts and Find's errors. */
export interface PhoneRadio extends NearbyRadio {
  /** Everything `capabilities()` says, with the two facts the screen's disabled row needs (`bluetoothLe`, `granted`). */
  facts(): Promise<NativeCapabilities>;
  /** Find failed natively (Bluetooth off, advertising refused): the code, never a key or address. */
  onFindError(hear: (code: NearbyNativeCode) => void): () => void;
  /** A hotspot join is under way: its system dialog takes the app to the background, which is not leaving (5.8). */
  joiningHotspot(): boolean;
}

/**
 * The binding with its listeners. Expo's `NativeModule` type names the class's constructor, so an
 * interface extending it carries none of `EventEmitter`'s methods; the module object has them.
 */
export type NearbyBinding = NearbyLinkNative & {
  addListener<K extends keyof NearbyLinkEvents>(name: K, listener: NearbyLinkEvents[K]): { remove(): void };
};

const DROPS: ReadonlySet<string> = new Set(NEARBY_DROP_CODES);
const KEY_BYTES = 32;

/** A rejection as the contract says it: `OfflineError` on a drop, the code otherwise. */
function failure(error: unknown): Error {
  const code = nearbyCodeOf(error) ?? 'INTERNAL';
  return DROPS.has(code) ? new OfflineError(code) : new NearbyNativeError(code);
}

async function call<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw failure(error);
  }
}

/** Bytes as the binding takes them: one whole buffer, so no view's offset is lost on the way down. */
function bytes(view: Uint8Array): Uint8Array {
  return view.byteOffset === 0 && view.byteLength === view.buffer.byteLength ? view : view.slice();
}

/** Bytes as they come up: a `ByteArray` arrives as a `Uint8Array`, and anything else is read as one. */
function received(value: unknown): Uint8Array | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return Uint8Array.from(value as number[]);
  throw new NearbyNativeError('INTERNAL');
}

function seenOf(e: NativeSeenPhone): SeenPhone {
  const seen: SeenPhone = { peer: e.peer, salt: e.salt, r: e.r, tag: e.tag, summary: e.summary, echo: e.echo, connectable: e.connectable, scan: e.scan };
  if (typeof e.rssi === 'number') seen.rssi = e.rssi;
  return seen;
}

function capabilitiesOf(c: NativeCapabilities): NearbyCapabilities {
  return {
    sdk: c.sdk, advertise: c.advertise, directByName: c.directByName, band5: c.band5, hotspot: c.hotspot, joinHotspot: c.joinHotspot,
    bluetoothOn: c.bluetoothOn, wifiOn: c.wifiOn, locationOn: c.locationOn
  };
}

function hostDetailsOf(h: NativeHosted): HostDetails {
  const out: HostDetails = { kind: h.kind, port: h.port };
  if (h.ssid !== undefined) out.ssid = h.ssid;
  if (h.passphrase !== undefined) out.passphrase = h.passphrase;
  if (h.band !== undefined) out.band = h.band;
  if (h.security !== undefined) out.security = h.security;
  return out;
}

function joinDetailsOf(d: HostDetails): { ssid?: string; passphrase?: string; port?: number; band?: string; security?: string } {
  const out: { ssid?: string; passphrase?: string; port?: number; band?: string; security?: string } = {};
  if (d.ssid !== undefined) out.ssid = d.ssid;
  if (d.passphrase !== undefined) out.passphrase = d.passphrase;
  if (d.port !== undefined) out.port = d.port;
  if (d.band !== undefined) out.band = d.band;
  if (d.security !== undefined) out.security = d.security;
  return out;
}

function hostOptionsOf(o: HostOptions): { ssid?: string; passphrase?: string; band5: boolean } {
  const out: { ssid?: string; passphrase?: string; band5: boolean } = { band5: o.band5 };
  if (o.ssid !== undefined) out.ssid = o.ssid;
  if (o.passphrase !== undefined) out.passphrase = o.passphrase;
  return out;
}

/** Every key's 32 bytes end to end, newest first, as `startFind` takes them. */
function joinedKeys(keys: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(keys.length * KEY_BYTES);
  keys.forEach((key, i) => {
    if (key.length !== KEY_BYTES) throw new NearbyNativeError('BAD_ARGUMENT');
    out.set(key, i * KEY_BYTES);
  });
  return out;
}

/** The radio over one binding. Tests pass a fake one; the app passes the module (`nearbyRadio`). */
export function nearbyRadioOver(native: NearbyBinding, options: Partial<NearbyRadioOptions> = {}): PhoneRadio {
  const o = { ...NEARBY_RADIO_DEFAULTS, ...options };
  /** Each link this phone holds, and the code it went down with, if it did. */
  const links = new Map<string, { down: NearbyNativeCode | null }>();
  let joining = 0;

  native.addListener('onLinkDown', (e) => {
    const held = links.get(e.linkId);
    if (held) held.down = e.code;
  });

  function linkOf(linkId: string, kind: NearbyLink['kind']): NearbyLink {
    const held = { down: null as NearbyNativeCode | null };
    links.set(linkId, held);
    /** A link that went, or that this phone closed, takes no more calls: they reject at once as a drop. */
    const on = <T>(work: () => Promise<T>): Promise<T> => {
      if (held.down !== null || links.get(linkId) !== held) return Promise.reject(new OfflineError(held.down ?? 'LINK_CLOSED'));
      return call(work);
    };
    return {
      kind,
      canMoveFiles: kind !== 'bluetooth',
      send: (message) => on(() => native.send(linkId, bytes(message))),
      receive: () => on(async () => received(await native.receive(linkId))),
      sendOpening: (b) => on(() => native.sendOpening(linkId, bytes(b))),
      receiveOpening: (size, deadlineMs) => on(async () => received(await native.receiveOpening(linkId, size, deadlineMs))),
      // Copies, because native zeroes what it is given once the keys are in.
      secure: (keys) => on(() => native.secure(linkId, keys.send.slice(), keys.receive.slice())),
      sendFile: (f) => on(() => native.sendFile(linkId, f.transferId, f.uri, f.size)),
      receiveFile: (f) => on(async () => {
        const r = await native.receiveFile(linkId, f.transferId, f.stagingUri, f.maxBytes, f.minFreeBytes);
        return { size: r.size, sha256: r.sha256 };
      }),
      cancelFile: (transferId) => on(() => native.cancelFile(linkId, transferId)),
      close: async () => {
        if (links.get(linkId) !== held) return;
        links.delete(linkId);
        await native.closeLink(linkId).catch(() => undefined);
      }
    };
  }

  const listen = <A extends unknown[]>(subscribe: (hear: (...a: A) => void) => { remove(): void }, hear: (...a: A) => void): (() => void) => {
    const sub = subscribe(hear);
    return () => sub.remove();
  };

  return {
    capabilities: () => call(async () => capabilitiesOf(await native.capabilities())),
    facts: () => call(() => native.capabilities()),
    startFind: (args: { kFind: Uint8Array; scanKeys: Uint8Array[]; payload: Uint8Array; r: Uint8Array; tunables: FindTunables }) =>
      call(() => native.startFind(bytes(args.kFind), joinedKeys(args.scanKeys), bytes(args.payload), bytes(args.r), { ...args.tunables })),
    updateFind: (args) => call(() => native.updateFind(bytes(args.payload), bytes(args.r))),
    stopFind: () => call(() => native.stopFind()),
    holdScan: (held) => call(() => native.holdScan(held)),
    holdSalt: (held) => call(() => native.holdSalt(held)),
    onFound: (hear) => listen((h) => native.addListener('onFound', (e) => h(seenOf(e))), hear),
    onFormSalt: (hear) => listen((h) => native.addListener('onFormSalt', (e) => (typeof e.rssi === 'number' ? h(e.salt, e.rssi) : h(e.salt))), hear),
    onSalt: (hear) => listen((h) => native.addListener('onSalt', (e) => h(e.salt)), hear),
    onPipe: (hear) => listen((h) => native.addListener('onPipe', (e) => h(linkOf(e.linkId, 'bluetooth'), e.salt)), hear),
    onFindError: (hear) => listen((h) => native.addListener('onFindError', (e) => h(e.code)), hear),
    openPipe: (peer, salt, scan) => call(async () => linkOf(await native.openPipe(peer, salt, scan), 'bluetooth')),
    host: async (kind, opts) => {
      const hosted = await call(() => native.host(kind, hostOptionsOf(opts), o.hostDeadlineMs));
      const nextLink = () => call(async () => linkOf(await native.hostLink(hosted.hostId), kind));
      const link = nextLink();
      // Nobody may ever come: an abandoned attempt's link is not an unhandled rejection.
      link.catch(() => undefined);
      return {
        ...hostDetailsOf(hosted),
        link,
        // A hotspot's server is not bound to its own network, so native hands up every connection in turn (Hosted.kt).
        ...(kind === 'hotspot' ? { nextLink } : {}),
        onRefused: (hear) => listen((h) => native.addListener('onRefused', (e) => { if (e.hostId === hosted.hostId) h(); }), hear),
        takeDown: () => call(() => native.takeDown(hosted.hostId))
      };
    },
    join: async (kind, details) => {
      if (kind === 'hotspot') joining += 1;
      try {
        return linkOf(await call(() => native.join(kind, joinDetailsOf(details), o.joinDeadlineMs)), kind);
      } finally {
        if (kind === 'hotspot') joining -= 1;
      }
    },
    joiningHotspot: () => joining > 0,
    stopAll: async () => {
      // Native closes every link; none of them takes another call.
      for (const held of links.values()) held.down ??= 'STOPPED';
      links.clear();
      await call(() => native.stopAll());
    }
  };
}

let radio: PhoneRadio | null | undefined;

/** The phone's radio, or null where the build has no module (an older binary under a newer update, a development client made before it). */
export function nearbyRadio(): PhoneRadio | null {
  if (radio === undefined) {
    const native = nearbyLinkNative();
    radio = native ? nearbyRadioOver(native as NearbyBinding) : null;
  }
  return radio;
}
