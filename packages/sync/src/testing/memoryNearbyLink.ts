import { createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, sign as edSign, verify as edVerify } from 'node:crypto';
import { type AnyEvent, type Privilege } from '@langquest-next/core';
import {
  attestationText, base64urlEncode, bytesToHex, eventDigest, linkText, nearbyBytes, signJoinPass, utf8Encode, type Attestation, type ChainLink, type ChainOrg, type JoinPass, type WorkerLink
} from '@langquest-next/core/nearby';
import type { FindTunables, HostDetails, HostOptions, NearbyCapabilities, NearbyCrypto, NearbyLink, NearbyRadio, SeenPhone } from '../nearbyLink';
import { NEARBY_MESSAGE_MAX } from '../nearbyLink';
import type { Message } from '../nearbyWire';
import { OfflineError } from '../types';

/**
 * Doubles for nearby sync (docs/nearby-sync-plan.md 5.12): real Ed25519 under
 * `node:crypto`, keyed from a name so that a run is deterministic, and a Worker that
 * issues certificates and attestations. Node only: nothing here reaches a phone.
 */

const seedOf = (label: string) => createHash('sha256').update(label).digest();
const ED25519_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
const X25519_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const privateKey = (prefix: Buffer, seed: Uint8Array) => createPrivateKey({ key: Buffer.concat([prefix, seed]), format: 'der', type: 'pkcs8' });
const bytesOf = (b: Buffer | ArrayBuffer) => new Uint8Array(b as ArrayBuffer);

export const fakeSha256 = (bytes: Uint8Array): Uint8Array => bytesOf(createHash('sha256').update(bytes).digest());

/** Checks a real signature. A key or signature it cannot read is a failed check, as a phone's would be. */
export function fakeVerify(publicKey: string, message: Uint8Array, signature: string): boolean {
  try {
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' });
    return edVerify(null, message, key, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}

/** `NearbyCrypto` for one install. The same name gives the same key, on any run. */
export function fakeSigner(installId: string): NearbyCrypto {
  const secret = privateKey(ED25519_PKCS8, seedOf(`install:${installId}`));
  let drawn = 0;
  const randomBytes = (size: number) => {
    const out = new Uint8Array(size);
    for (let at = 0; at < size; at += 32) out.set(seedOf(`random:${installId}:${drawn++}`).subarray(0, Math.min(32, size - at)), at);
    return out;
  };
  return {
    publicKey: createPublicKey(secret).export({ format: 'jwk' }).x!,
    sign: async (message) => base64urlEncode(bytesOf(edSign(null, message, secret))),
    verify: fakeVerify,
    sha256: fakeSha256,
    hmacSha256: (key, message) => bytesOf(createHmac('sha256', key).update(message).digest()),
    hkdfSha256: (ikm, salt, info, length) => bytesOf(hkdfSync('sha256', ikm, salt, info, length)),
    x25519Pair: () => {
      const seed = randomBytes(32);
      const pub = createPublicKey(privateKey(X25519_PKCS8, seed)).export({ format: 'jwk' }).x!;
      return { secret: seed, public: bytesOf(Buffer.from(pub, 'base64url')) };
    },
    x25519: (mine, theirs) => bytesOf(diffieHellman({
      privateKey: privateKey(X25519_PKCS8, mine),
      publicKey: createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: base64urlEncode(theirs) }, format: 'jwk' })
    })),
    randomBytes
  };
}

export interface FakeWorker {
  kid: string;
  rootKeys: ReadonlyMap<string, string>;
  /** A one-link chain, as the certificate call answers. */
  certify(holder: { installKey: string; profileId: string; deviceId: string }, org: Pick<ChainOrg, 'orgId'> & Partial<Omit<ChainOrg, 'orgId'>> & { privileges?: Privilege[] }): Promise<ChainLink[]>;
  /** A `claims` page over these rows' events, as the attest call answers, with `events` the rows it carries. */
  attest(att: Omit<Attestation, 'v' | 'kid'>): Promise<Omit<Extract<Message, { t: 'claims' }>, 'events' | 't'>>;
  /** What the attest call does with rows it read itself: their digests, signed. `FakeServer.attester` takes it. */
  attestRows(orgId: string, streamId: string, rows: readonly AnyEvent[]): Promise<{ text: string; kid: string; sig: string }>;
  /** A join pass, as the certificate answer holds it (phase 6). */
  signPass(body: JoinPass['body']): Promise<JoinPass>;
}

export function fakeWorker(kid = 'k1'): FakeWorker {
  const root = fakeSigner(`worker:${kid}`);
  const attest: FakeWorker['attest'] = async (att) => {
    const text = attestationText({ v: 1, kid, ...att });
    return { text, kid, sig: await root.sign(nearbyBytes('attest', text)) };
  };
  return {
    kid,
    rootKeys: new Map([[kid, root.publicKey]]),
    async certify(holder, { orgId, orgSeq = 1, scopes, privileges = [] }) {
      const body: WorkerLink['body'] = {
        ...holder, expiresAt: Number.MAX_SAFE_INTEGER,
        org: { orgId, orgSeq, scopes: scopes ?? [{ level: 'org', privileges }] }
      };
      return [{ kind: 'worker@1', kid, body, sig: await root.sign(nearbyBytes('link', linkText({ kind: 'worker@1', kid, body }, ''))) }];
    },
    attest,
    signPass: (body) => signJoinPass(body, kid, (m) => root.sign(m)),
    attestRows: async (orgId, streamId, rows) => attest({
      orgId, streamId, rows: await Promise.all(rows.map(async (e) => [e.id, await eventDigest(e, fakeSha256), e.serverSeq!] as [string, string, number]))
    })
  };
}

// ---- links ------------------------------------------------------------------------

/** The time a memory link reads its deadlines on: `VirtualTime` in tests and the fleet. */
export interface MemoryLinkClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Files by uri, shared by every phone in a test, as the fleet's audio is: bytes and a hash. */
export type MemoryFiles = Map<string, Uint8Array>;

export interface MemoryNearbyPairOptions {
  kind?: NearbyLink['kind'];
  canMoveFiles?: boolean;
  /** Whole messages a direction holds before `send` waits for the other side to read. */
  capacity?: number;
  time: MemoryLinkClock;
  files?: MemoryFiles;
  /** Changes a file's bytes on the way, as a lying sender would. */
  alterFile?: (bytes: Uint8Array) => Uint8Array;
}

export interface MemoryNearbyPair {
  a: NearbyLink;
  b: NearbyLink;
  /** Both ends at once: every pending and later call rejects with `OfflineError`. */
  drop(): void;
  /** Drop as the `count`th message from either side is sent, before it arrives. */
  dropAt(count: number): void;
  /** Everything each side sent, the opening's bytes and each frame as plain bytes. */
  sent: { a: { opening: number; frames: Uint8Array[] }; b: { opening: number; frames: Uint8Array[] } };
  /** Whole messages sent so far, both sides. */
  messages(): number;
  closedBy: { a: boolean; b: boolean };
}

type Frame = { bytes: Uint8Array; key: string };

/** One direction. */
class Direction {
  frames: Frame[] = [];
  taker: ((f: Frame) => void) | null = null;
  blocked: { frame: Frame; resolve: () => void; reject: (e: Error) => void }[] = [];
  opening: number[] = [];
  openingWaiter: (() => void) | null = null;
}

/**
 * Two connected ends of a `NearbyLink` with no radio: whole messages in order, a queue that
 * makes a sender wait, and a drop a test can trigger. Real sealing is not needed, but the
 * same rules hold as on a phone: no frame before `secure`, no opening after it, `secure`
 * once, and a frame sealed with a key the other side did not derive closes the link, as a
 * failed tag does. So a session that would fail on a phone fails here.
 */
export function memoryNearbyPair(o: MemoryNearbyPairOptions): MemoryNearbyPair {
  const kind = o.kind ?? 'memory';
  const canMoveFiles = o.canMoveFiles ?? kind !== 'bluetooth';
  const capacity = o.capacity ?? 4;
  const files = o.files ?? new Map<string, Uint8Array>();
  let dropped = false;
  let dropAtCount = Infinity;
  let count = 0;
  const failures: (() => void)[] = [];
  const sent = { a: { opening: 0, frames: [] as Uint8Array[] }, b: { opening: 0, frames: [] as Uint8Array[] } };
  const closedBy = { a: false, b: false };
  const transfers = new Map<string, { send?: { uri: string; resolve: () => void; reject: (e: Error) => void }; receive?: { stagingUri: string; maxBytes: number; resolve: (r: { size: number; sha256: string }) => void; reject: (e: Error) => void } }>();
  const offline = (why: string) => new OfflineError(why);

  const drop = () => {
    if (dropped) return;
    dropped = true;
    for (const fail of failures.splice(0)) fail();
  };
  /** Waits that a drop must end. */
  const pending = <T>(start: (resolve: (v: T) => void, reject: (e: Error) => void) => void): Promise<T> => new Promise<T>((resolve, reject) => {
    if (dropped) return reject(offline('dropped'));
    let settled = false;
    const fail = () => { if (!settled) { settled = true; reject(offline('dropped')); } };
    failures.push(fail);
    start((v) => { if (!settled) { settled = true; resolve(v); } }, (e) => { if (!settled) { settled = true; reject(e); } });
  });

  const end = (me: 'a' | 'b', out: Direction, inbound: Direction): NearbyLink => {
    const them = me === 'a' ? 'b' : 'a';
    let keys: { send: string; receive: string } | null = null;
    const usable = () => {
      if (dropped) throw offline('dropped');
      if (closedBy[me]) throw offline('closed here');
    };
    const transfer = (id: string, way: 'a' | 'b') => {
      const k = `${way}:${id}`;
      let t = transfers.get(k);
      if (!t) transfers.set(k, (t = {}));
      return { k, t };
    };
    const tryMove = (k: string) => {
      const t = transfers.get(k);
      if (!t?.send || !t.receive) return;
      transfers.delete(k);
      const bytes = files.get(t.send.uri);
      if (!bytes) {
        t.send.reject(new Error('no such file'));
        transfers.set(k, { receive: t.receive });
        return;
      }
      const moved = o.alterFile ? o.alterFile(bytes) : bytes;
      if (moved.length > t.receive.maxBytes) {
        t.receive.reject(new Error('too big'));
        t.send.resolve();
        return;
      }
      files.set(t.receive.stagingUri, new Uint8Array(moved));
      t.receive.resolve({ size: moved.length, sha256: bytesToHex(fakeSha256(moved)) });
      t.send.resolve();
    };
    return {
      kind,
      canMoveFiles,
      async send(message) {
        usable();
        if (closedBy[them]) throw offline('closed there');
        if (!keys) throw new Error('no frame is ever plain: secure first');
        if (message.length > NEARBY_MESSAGE_MAX) throw new RangeError('over the frame ceiling');
        count += 1;
        if (count >= dropAtCount) {
          drop();
          throw offline('dropped');
        }
        const frame = { bytes: new Uint8Array(message), key: keys.send };
        sent[me].frames.push(frame.bytes);
        if (out.taker) {
          const take = out.taker;
          out.taker = null;
          take(frame);
          return;
        }
        if (out.frames.length < capacity) {
          out.frames.push(frame);
          return;
        }
        await pending<void>((resolve, reject) => { out.blocked.push({ frame, resolve, reject }); });
      },
      async receive() {
        usable();
        if (!keys) throw new Error('no frame is ever plain: secure first');
        const open = (f: Frame) => {
          if (f.key !== keys!.receive) {
            drop();
            throw offline('a failed tag closes the link');
          }
          return f.bytes;
        };
        const next = inbound.frames.shift();
        if (next) {
          const unblocked = inbound.blocked.shift();
          if (unblocked) {
            inbound.frames.push(unblocked.frame);
            unblocked.resolve();
          }
          return open(next);
        }
        if (closedBy[them]) return null;
        const f = await pending<Frame | null>((resolve) => {
          inbound.taker = resolve;
          failures.push(() => resolve(null));
        });
        if (f === null) {
          if (dropped || closedBy[me]) throw offline('dropped');
          return null;
        }
        return open(f);
      },
      async sendOpening(bytes) {
        usable();
        if (keys) throw new Error('the opening comes before secure');
        sent[me].opening += bytes.length;
        out.opening.push(...bytes);
        out.openingWaiter?.();
      },
      async receiveOpening(size, deadlineMs) {
        usable();
        if (keys) throw new Error('the opening comes before secure');
        if (inbound.opening.length >= size) return new Uint8Array(inbound.opening.splice(0, size));
        if (closedBy[them]) return null;
        return pending<Uint8Array | null>((resolve) => {
          const timer = o.time.setTimeout(() => { inbound.openingWaiter = null; resolve(null); }, deadlineMs);
          inbound.openingWaiter = () => {
            if (closedBy[them] || closedBy[me]) {
              o.time.clearTimeout(timer);
              inbound.openingWaiter = null;
              resolve(null);
            } else if (inbound.opening.length >= size) {
              o.time.clearTimeout(timer);
              inbound.openingWaiter = null;
              resolve(new Uint8Array(inbound.opening.splice(0, size)));
            }
          };
        });
      },
      async secure(k) {
        usable();
        if (keys) throw new Error('secure is once per link');
        keys = { send: bytesToHex(k.send), receive: bytesToHex(k.receive) };
      },
      async sendFile(file) {
        usable();
        if (!canMoveFiles) throw new Error('this link moves no files');
        const { k, t } = transfer(file.transferId, me);
        await pending<void>((resolve, reject) => { t.send = { uri: file.uri, resolve, reject }; tryMove(k); });
      },
      async receiveFile(file) {
        usable();
        if (!canMoveFiles) throw new Error('this link moves no files');
        const { k, t } = transfer(file.transferId, them);
        return pending<{ size: number; sha256: string }>((resolve, reject) => { t.receive = { stagingUri: file.stagingUri, maxBytes: file.maxBytes, resolve, reject }; tryMove(k); });
      },
      async cancelFile(transferId) {
        for (const way of ['a', 'b'] as const) {
          const k = `${way}:${transferId}`;
          const t = transfers.get(k);
          transfers.delete(k);
          t?.send?.resolve();
          t?.receive?.reject(new Error('cancelled'));
        }
      },
      async close() {
        if (closedBy[me] || dropped) return;
        closedBy[me] = true;
        // This side's own waits end as a drop. The other reads what is queued, then null, and anything it sends from now on is refused.
        const mine = inbound.taker;
        inbound.taker = null;
        mine?.(null as unknown as Frame);
        for (const b of out.blocked.splice(0)) b.reject(offline('closed here'));
        const theirs = out.taker;
        out.taker = null;
        theirs?.(null as unknown as Frame);
        inbound.openingWaiter?.();
        out.openingWaiter?.();
        for (const b of inbound.blocked.splice(0)) b.resolve();
      }
    };
  };
  const ab = new Direction();
  const ba = new Direction();
  const a = end('a', ab, ba);
  const b = end('b', ba, ab);
  return { a, b, drop, dropAt: (n) => { dropAtCount = n; }, sent, messages: () => count, closedBy };
}

// ---- the radio --------------------------------------------------------------------

type HostKind = 'wifi-direct' | 'hotspot';

export interface MemoryRadioKnobs {
  /** `host` rejects for these kinds. */
  hostFails?: HostKind[];
  /** `join` never brings the link up for these kinds, so only the deadline moves on. */
  neverUp?: HostKind[];
  /** A stranger on another network connects first to a group of these kinds this phone hosts, and says nothing. */
  strangerFirst?: HostKind[];
}

/** One scan response as the air carried it, for a replay. */
export interface MemoryAdvert {
  peer: string;
  kFind: Uint8Array;
  salt: string;
  r: Uint8Array;
  payload: Uint8Array;
}

export interface MemoryNearbyRadio extends NearbyRadio {
  readonly name: string;
  /** Find as native holds it, or null when stopped. */
  readonly find: { kFind: Uint8Array; scanKeys: Uint8Array[]; payload: Uint8Array; r: Uint8Array; tunables: FindTunables } | null;
  readonly salt: string | null;
  readonly calls: { startFind: number; updateFind: number; stopFind: number; stopAll: number; openPipe: number; takeDown: number };
  /** Scanning is held off for a session; advertising carries on. */
  readonly scanHeld: boolean;
  /** An opening passed on a pipe to this phone: a rotation waits. */
  readonly saltHeld: boolean;
}

export interface MemoryNearbyAir {
  radio(name: string, caps?: Partial<NearbyCapabilities>, knobs?: MemoryRadioKnobs): MemoryNearbyRadio;
  /** Every listening phone hears every advertising one once, as one scan burst. */
  scan(): void;
  /** A new salt for this phone, as native's rotation timer does; deferred while the salt is held. */
  rotate(name: string): void;
  /** What a scanner far away recorded, played to every phone now. */
  replay(advert: MemoryAdvert): void;
  /** Every scan response that went out. */
  readonly adverts: MemoryAdvert[];
  /** A response repeated under one salt, which would show the layout to a scanner with no key. Any entry fails a test. */
  readonly maskRepeats: string[];
  /** Pipes brought up, by who connected to whom. */
  readonly pipes: { from: string; to: string; pair: MemoryNearbyPair }[];
  /** Wi-Fi links brought up. */
  readonly links: { kind: string; pair: MemoryNearbyPair }[];
}

const NO_CAPS: NearbyCapabilities = { sdk: 34, advertise: true, directByName: true, band5: true, hotspot: true, joinHotspot: true, bluetoothOn: true, wifiOn: true, locationOn: true };

const sameKey = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * A room of phones with no radio: adverts matched by `kFind` as native matches them,
 * pipes and Wi-Fi links as memory pairs, and a check that no mask repeats under a salt.
 * Nothing moves until the test says so (`scan`, `rotate`), so a test needs no clock to
 * see who heard whom.
 */
export function memoryNearbyAir(o: { time: MemoryLinkClock; files?: MemoryFiles; capacity?: number; alterFile?: (bytes: Uint8Array) => Uint8Array }): MemoryNearbyAir {
  const radios = new Map<string, MemoryRadioState>();
  const adverts: MemoryAdvert[] = [];
  const maskRepeats: string[] = [];
  const pipes: MemoryNearbyAir['pipes'] = [];
  const links: MemoryNearbyAir['links'] = [];
  const groups = new Map<string, { kind: HostKind; offer: (link: NearbyLink) => void; settle: () => void }>();
  const files = o.files ?? new Map<string, Uint8Array>();
  let salts = 0;
  let groupsMade = 0;
  const pairOptions = { time: o.time, files, ...(o.capacity !== undefined ? { capacity: o.capacity } : {}), ...(o.alterFile ? { alterFile: o.alterFile } : {}) };

  interface MemoryRadioState {
    radio: MemoryNearbyRadio;
    caps: NearbyCapabilities;
    knobs: MemoryRadioKnobs;
    find: MemoryNearbyRadio['find'];
    salt: string | null;
    usedR: Set<string>;
    found: Set<(seen: SeenPhone) => void>;
    formSalt: Set<(salt: string, rssi?: number) => void>;
    onSalt: Set<(salt: string) => void>;
    onPipe: Set<(pipe: NearbyLink, salt: string) => void>;
    scanHeld: boolean;
    saltHeld: boolean;
    rotationDue: boolean;
  }

  const newSalt = (state: MemoryRadioState) => {
    salts += 1;
    state.salt = base64urlEncode(fakeSha256(utf8Encode(`salt:${state.radio.name}:${salts}`)).slice(0, 6));
    state.usedR = new Set();
    for (const hear of state.onSalt) hear(state.salt);
  };
  const listen = <T>(set: Set<T>, hear: T) => {
    set.add(hear);
    return () => { set.delete(hear); };
  };
  const seenOf = (advert: MemoryAdvert, scan: number): SeenPhone => ({
    peer: advert.peer, salt: advert.salt, r: base64urlEncode(advert.r), tag: bytesToHex(advert.payload.slice(0, 6)), summary: bytesToHex(advert.payload.slice(6, 10)),
    echo: base64urlEncode(advert.payload.slice(10, 14)), connectable: true, scan
  });
  const hear = (listener: MemoryRadioState, advert: MemoryAdvert) => {
    if (!listener.find || listener.scanHeld || listener.radio.name === advert.peer) return;
    const scan = listener.find.scanKeys.findIndex((k) => sameKey(k, advert.kFind));
    if (scan >= 0) for (const h of listener.found) h(seenOf(advert, scan));
    else for (const h of listener.formSalt) h(advert.salt, -50);
  };
  const advertOf = (state: MemoryRadioState): MemoryAdvert | null =>
    state.find && state.salt && state.caps.advertise ? { peer: state.radio.name, kFind: state.find.kFind, salt: state.salt, r: state.find.r, payload: state.find.payload } : null;
  const answer = (state: MemoryRadioState, r: Uint8Array) => {
    const mask = `${state.salt}:${bytesToHex(r)}`;
    if (state.usedR.has(mask)) maskRepeats.push(`${state.radio.name} ${mask}`);
    state.usedR.add(mask);
  };

  const air: MemoryNearbyAir = {
    adverts, maskRepeats, pipes, links,
    radio(name, caps = {}, knobs = {}) {
      const calls = { startFind: 0, updateFind: 0, stopFind: 0, stopAll: 0, openPipe: 0, takeDown: 0 };
      const state = {
        caps: { ...NO_CAPS, ...caps }, knobs, find: null, salt: null, usedR: new Set(), found: new Set(), formSalt: new Set(), onSalt: new Set(), onPipe: new Set(),
        scanHeld: false, saltHeld: false, rotationDue: false
      } as unknown as MemoryRadioState;
      const radio: MemoryNearbyRadio = {
        name,
        get find() { return state.find; },
        get salt() { return state.salt; },
        get scanHeld() { return state.scanHeld; },
        get saltHeld() { return state.saltHeld; },
        calls,
        capabilities: async () => state.caps,
        async startFind(args) {
          calls.startFind += 1;
          if (args.payload.length !== 14) throw new Error('a payload is 14 bytes');
          state.find = { ...args };
          if (state.caps.advertise) newSalt(state);
          answer(state, args.r);
        },
        async updateFind(args) {
          calls.updateFind += 1;
          if (!state.find) throw new Error('Find is not running');
          if (args.payload.length !== 14) throw new Error('a payload is 14 bytes');
          state.find = { ...state.find, payload: args.payload, r: args.r };
          answer(state, args.r);
          const advert = advertOf(state);
          if (advert) adverts.push(advert);
        },
        async stopFind() {
          calls.stopFind += 1;
          state.find = null;
          state.scanHeld = false;
          state.saltHeld = false;
          state.rotationDue = false;
        },
        async holdScan(held) {
          state.scanHeld = held;
        },
        async holdSalt(held) {
          state.saltHeld = held;
          if (!held && state.rotationDue) {
            state.rotationDue = false;
            if (state.find && state.caps.advertise) newSalt(state);
          }
        },
        onFound: (h) => listen(state.found, h),
        onFormSalt: (h) => listen(state.formSalt, h),
        onSalt: (h) => listen(state.onSalt, h),
        onPipe: (h) => listen(state.onPipe, h),
        async openPipe(peer, salt) {
          calls.openPipe += 1;
          const target = radios.get(peer);
          if (!target?.find || target.salt !== salt) throw new OfflineError('nobody there');
          const pair = memoryNearbyPair({ ...pairOptions, kind: 'bluetooth' });
          pipes.push({ from: name, to: peer, pair });
          for (const h of target.onPipe) h(pair.b, salt);
          return pair.a;
        },
        async host(kind, opts: HostOptions) {
          if (state.knobs.hostFails?.includes(kind)) throw new Error(`${kind} would not start`);
          groupsMade += 1;
          const ssid = opts.ssid ?? `hotspot-${groupsMade}`;
          // As native's Hosted: links in the order they connected; once settled or taken down, no more.
          const ready: NearbyLink[] = [];
          const waiting: { resolve: (link: NearbyLink) => void; reject: (e: Error) => void }[] = [];
          let over = false;
          const offer = (l: NearbyLink) => {
            const w = waiting.shift();
            if (w) w.resolve(l);
            else ready.push(l);
          };
          const settle = () => {
            over = true;
            for (const w of waiting.splice(0)) w.reject(new OfflineError('HOST_TAKEN_DOWN'));
          };
          const next = (): Promise<NearbyLink> => {
            const l = ready.shift();
            if (l) return Promise.resolve(l);
            if (over) return Promise.reject(new OfflineError('HOST_TAKEN_DOWN'));
            return new Promise<NearbyLink>((resolve, reject) => { waiting.push({ resolve, reject }); });
          };
          groups.set(ssid, { kind, offer, settle });
          if (state.knobs.strangerFirst?.includes(kind)) offer(memoryNearbyPair({ ...pairOptions, kind, canMoveFiles: true }).a);
          const link = next();
          link.catch(() => undefined);
          const takeDown = async () => {
            calls.takeDown += 1;
            groups.delete(ssid);
            settle();
          };
          // Only a hotspot hands up every connection: its server is not bound to its own network.
          return { kind, ssid, passphrase: opts.passphrase ?? 'system-chosen', link, ...(kind === 'hotspot' ? { nextLink: next } : {}), onRefused: () => () => undefined, takeDown };
        },
        async join(kind, details: HostDetails) {
          const group = details.ssid === undefined ? undefined : groups.get(details.ssid);
          if (!group || group.kind !== kind) throw new OfflineError('no such group');
          if (state.knobs.neverUp?.includes(kind)) return new Promise<NearbyLink>(() => undefined);
          groups.delete(details.ssid!);
          const pair = memoryNearbyPair({ ...pairOptions, kind, canMoveFiles: true });
          links.push({ kind, pair });
          group.offer(pair.a);
          group.settle();
          return pair.b;
        },
        async stopAll() {
          calls.stopAll += 1;
          state.find = null;
          state.scanHeld = false;
          state.saltHeld = false;
          state.rotationDue = false;
        }
      };
      state.radio = radio;
      radios.set(name, state);
      return radio;
    },
    scan() {
      const now = [...radios.values()].map(advertOf).filter((a): a is MemoryAdvert => a !== null);
      for (const listener of radios.values()) for (const advert of now) hear(listener, advert);
    },
    rotate(name) {
      const state = radios.get(name);
      if (!state?.find || !state.caps.advertise) return;
      // As native's timer: a pipe that passed its opening holds the salt, and the rotation runs once it is released.
      if (state.saltHeld) state.rotationDue = true;
      else newSalt(state);
    },
    replay(advert) {
      for (const listener of radios.values()) hear(listener, advert);
    }
  };
  return air;
}
