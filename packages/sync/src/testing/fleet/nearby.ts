import { defaultOfflineScope, filePlanOf, privilegesOfFixedRole, type AnyEvent, type LanguageState, type Role } from '@langquest-next/core';
import {
  base64urlEncode, copiesOf, NEARBY_BUDGET, summaryOf, summaryText, utf8Encode, wantedFilesOf, type ChainLink, type Holdings, type NearbyPeople, type WantedFile
} from '@langquest-next/core/nearby';
import type { NearbyPage, NearbySigner } from '../../nearbyIntake';
import { nearbyKeepOf, type NearbyKeep } from '../../nearbyKeep';
import type { FindTunables, NearbyCrypto, NearbyLink, NearbyRadio } from '../../nearbyLink';
import { NearbyRoom, type NearbyRoomEvent, type NearbyRoomFacts, type NearbyRoomKeys } from '../../nearbyRoom';
import { NearbySession, type NearbyFileMoves, type NearbyGenerations, type NearbySessionPort, type NearbySessionReport } from '../../nearbySession';
import { fakeSha256, fakeSigner, fakeWorker, memoryNearbyAir, type FakeWorker, type MemoryFiles, type MemoryNearbyAir, type MemoryNearbyRadio } from '../memoryNearbyLink';
import { LinkPipe, type NetworkShape } from '../shapedTransport';
import type { VirtualTime } from '../virtualTime';
import type { SimDevice } from './device';

/**
 * Nearby sharing on fleet time (docs/nearby-sync-plan.md 5.11, section 8's Fleet row): what
 * a `SimDevice` needs to run the app's own `NearbyRoom` and `NearbySession`. The fleet
 * supplies only time and the link, as it does for the server: radios are the memory air,
 * each link carries its bytes through a pipe at a speed for its kind (Bluetooth, then Wi-Fi
 * Direct once both sides arrange it), so a session's length is relative but real in the
 * model. Each phone has a fake-worker certificate, and the door's privileges come from
 * `privilegesOfFixedRole`, because the fleet has no organization stream.
 *
 * A fleet audio file has no bytes, only a hash and a size, so on the memory air a file is
 * the text `<hash>:<size>`: the sending side's pipe carries `size` bytes, and the receiving
 * side reports that hash and size as native would after hashing what it wrote.
 */

/** Reported speeds (plan section 4): Bluetooth 20 to 70 KB/s; Wi-Fi Direct on 2.4 GHz well under the 53 MB/s seen on 5 GHz. */
export const NEARBY_NETWORKS = {
  bluetooth: { latencyMs: 60, bytesPerSecond: 40_000, dropRate: 0 },
  wifi: { latencyMs: 10, bytesPerSecond: 5_000_000, dropRate: 0 }
} satisfies Record<string, NetworkShape>;

export interface FleetNearbyOptions {
  /** How often each open room is ticked and the air scanned (the app refreshes its scan response about every 2 s). */
  tickMs?: number;
  /** How long Wi-Fi Direct takes to come up once both sides agree to it. */
  wifiUpMs?: number;
  /** False keeps every session on Bluetooth, which moves no files. */
  wifi?: boolean;
  bluetooth?: NetworkShape;
  wifiShape?: NetworkShape;
  /** Per signer (core `NEARBY_BUDGET`, Carl's answer 21). */
  budget?: { maxRows: number; maxBytes: number; maxManifestBytes: number };
  /** The room's idle limit: "Up to date" this long with nobody new stops it. */
  idleLimitMs?: number;
}

/** What the fleet tells nearby about its phones. */
export interface FleetNearbyContext {
  time: VirtualTime;
  orgId: string;
  streamId: string;
  roleOf(actorId: string): Role;
}

/** Counts across every session in a run. */
export interface NearbyStats {
  /** Sessions a phone opened, so each pairing counts once. */
  pairings: number;
  /** Sessions, either side, by how they ended. */
  ended: Record<string, number>;
  eventsSent: number;
  eventsTaken: number;
  refused: number;
  overBudget: number;
  filesGot: number;
  /** Bytes each kind of link carried, both ways. */
  bytes: Record<string, number>;
  /** Files by the group they were asked in, in the order they landed, per phone, with the phone's session they came in. */
  landed: Map<string, { group: WantedFile['group']; session: number }[]>;
  farAhead: number;
  clockOff: number;
}

const DISCOVERY = base64urlEncode(fakeSha256(utf8Encode('fleet discovery key')));

const FIND: FindTunables = { rotateMinMs: 240_000, rotateMaxMs: 360_000, scanStartGapMs: 6_000, scanRestartMs: 1_500_000, connectRetries: 2, connectable: 'always' };

/** A native frame's sealed header and tag, beside its body. */
const FRAME_OVERHEAD = 37;

interface NearbyPhone {
  device: SimDevice;
  crypto: NearbyCrypto;
  chain: ChainLink[];
  signer: NearbySigner;
  keep: NearbyKeep;
  files: NearbyFileMoves;
  radio: MemoryNearbyRadio;
  pipe: LinkPipe;
  keys: NearbyRoomKeys & { direct: boolean; certOrgSeq: number };
  room: NearbyRoom | null;
  events: NearbyRoomEvent[];
  /** Sessions this phone has begun, as its room reported them. */
  sessions: number;
}

export class FleetNearby {
  readonly worker: FakeWorker = fakeWorker('fleet');
  readonly shelf: MemoryFiles = new Map();
  readonly air: MemoryNearbyAir;
  readonly stats: NearbyStats = { pairings: 0, ended: {}, eventsSent: 0, eventsTaken: 0, refused: 0, overBudget: 0, filesGot: 0, bytes: {}, landed: new Map(), farAhead: 0, clockOff: 0 };
  private readonly phones = new Map<SimDevice, NearbyPhone>();
  private readonly open = new Set<NearbyPhone>();
  private ticker: unknown = null;
  private readonly o: Required<FleetNearbyOptions>;

  constructor(private readonly ctx: FleetNearbyContext, options: FleetNearbyOptions = {}) {
    this.o = {
      tickMs: 2_000, wifiUpMs: 5_000, wifi: true, bluetooth: NEARBY_NETWORKS.bluetooth, wifiShape: NEARBY_NETWORKS.wifi,
      budget: { ...NEARBY_BUDGET }, idleLimitMs: 300_000, ...options
    };
    this.air = memoryNearbyAir({ time: ctx.time, files: this.shelf });
  }

  /** The door's lookup: each person's fixed role, and every language listed. */
  readonly people: NearbyPeople = {
    privilegesIn: (profileId) => privilegesOfFixedRole(this.ctx.roleOf(profileId)),
    languageListed: () => true
  };

  /** Gives the phone an install key and a certificate, as the Worker would on its first sync. */
  async enrol(device: SimDevice): Promise<void> {
    if (this.phones.has(device)) return;
    const crypto = fakeSigner(`fleet:${device.id}`);
    const chain = await this.worker.certify(
      { installKey: crypto.publicKey, profileId: device.actorId, deviceId: device.deviceId },
      { orgId: this.ctx.orgId, privileges: [...privilegesOfFixedRole(this.ctx.roleOf(device.actorId))] }
    );
    const phone: NearbyPhone = {
      device, crypto, chain,
      signer: { publicKey: crypto.publicKey, sign: crypto.sign, sha256: crypto.sha256, chainFor: (actorId) => (actorId === device.actorId ? chain : null) },
      // Through the device, so a restarted app's client is the one asked.
      keep: nearbyKeepOf({ nearbyMeta: (k) => device.client.nearbyMeta(k), writeNearbyMeta: (r) => device.client.writeNearbyMeta(r) }, { orgId: this.ctx.orgId, streamId: this.ctx.streamId }),
      files: null as unknown as NearbyFileMoves,
      radio: this.air.radio(device.id),
      pipe: new LinkPipe(),
      keys: { gen: 1, key: DISCOVERY, floor: 1, direct: true, certOrgSeq: 0 },
      room: null,
      events: [],
      sessions: 0
    };
    phone.files = this.fileMoves(phone);
    this.phones.set(device, phone);
  }

  /** These people open Share nearby in one place. Each keeps it open until `leave`. */
  async gather(devices: readonly SimDevice[]): Promise<void> {
    for (const d of devices) {
      await this.enrol(d);
      const phone = this.phones.get(d)!;
      if (phone.room?.isRunning) continue;
      phone.room = this.roomFor(phone);
      this.open.add(phone);
      await phone.room.start(this.ctx.time.now());
    }
    this.tick();
  }

  /** They close the screen, or walk away. */
  async leave(devices: readonly SimDevice[]): Promise<void> {
    for (const d of devices) {
      const phone = this.phones.get(d);
      if (!phone) continue;
      this.open.delete(phone);
      await phone.room?.stop();
    }
    if (this.open.size === 0) {
      this.ctx.time.clearTimeout(this.ticker);
      this.ticker = null;
    }
  }

  /** Every open room has stopped by itself ("Up to date", then the idle limit), or never started. */
  allStopped(devices: readonly SimDevice[]): boolean {
    return devices.every((d) => !this.phones.get(d)?.room?.isRunning);
  }

  /** What one phone's room reported, in order. */
  eventsOf(device: SimDevice): readonly NearbyRoomEvent[] {
    return this.phones.get(device)?.events ?? [];
  }

  private tick(): void {
    if (this.ticker !== null || this.open.size === 0) return;
    const { time } = this.ctx;
    const turn = () => {
      this.ticker = null;
      if (this.open.size === 0) return;
      this.ticker = time.setTimeout(turn, this.o.tickMs);
      void (async () => {
        this.air.scan();
        for (const phone of [...this.open]) {
          if (phone.room?.isRunning) await phone.room.tick(time.now());
        }
      })().catch((err: unknown) => { time.errors.push(err); });
    };
    this.ticker = time.setTimeout(turn, 0);
  }

  private roomFor(phone: NearbyPhone): NearbyRoom {
    const { time } = this.ctx;
    const radio = this.shaped(phone);
    const directByName = this.o.wifi;
    return new NearbyRoom({
      radio, crypto: phone.crypto, keys: () => phone.keys, facts: this.facts(phone),
      idleLimitMs: this.o.idleLimitMs, waitLimitMs: 1_800_000, stopWhenLevel: false,
      radios: () => ({ directByName, band5: false, hotspot: false, joinHotspot: false }), find: FIND,
      report: (e) => this.reported(phone, e),
      openSession: (args) => {
        const generations: NearbyGenerations = {
          sessionGen: args.gen, mine: () => phone.keys, orgSeqHere: () => 0,
          keep: async (handed) => { phone.keys = { ...phone.keys, ...handed, direct: false }; }
        };
        return new NearbySession({
          role: args.role, link: args.link, crypto: phone.crypto, orgId: this.ctx.orgId, languageId: this.ctx.streamId,
          deviceId: phone.device.deviceId, chain: phone.chain, signer: phone.signer, rootKeys: this.worker.rootKeys,
          gate: { people: () => this.people }, port: this.port(phone.device), keep: phone.keep, files: phone.files,
          opening: { kSess: args.kSess, salt: args.salt, kFind: args.kFind, ...(args.seen ? { seen: args.seen } : {}) },
          generations, older: args.older, ...(args.heardTag !== undefined ? { heardTag: args.heardTag } : {}),
          ...(args.onOpened ? { onOpened: args.onOpened } : {}), otherWaiting: args.otherWaiting,
          arrange: { radio, radios: args.radios }, time, budget: this.o.budget
        });
      }
    });
  }

  private reported(phone: NearbyPhone, e: NearbyRoomEvent): void {
    phone.events.push(e);
    if (e.t === 'session') phone.sessions += 1;
    if (e.t === 'session' && e.role === 'i') this.stats.pairings += 1;
    if (e.t !== 'ended') return;
    const r: NearbySessionReport = e.report;
    const how = r.ended.how === 'said' ? `said:${r.ended.reason}${r.ended.detail ? ` (${r.ended.detail})` : ''}` : r.ended.how === 'heard' ? `heard:${r.ended.reason}` : r.ended.how;
    this.stats.ended[how] = (this.stats.ended[how] ?? 0) + 1;
    this.stats.eventsSent += r.sent.events;
    this.stats.eventsTaken += r.got.events;
    this.stats.refused += r.got.refused;
    this.stats.overBudget += r.got.overBudget;
    this.stats.filesGot += r.files.got;
    this.stats.farAhead += r.farAhead.length;
    if (r.clockOff) this.stats.clockOff += 1;
  }

  /** The room's facts, as the app works them out from its store: the summary after signing, and holdings for what each side lacks. */
  private facts(phone: NearbyPhone): NearbyRoomFacts {
    let holdings: Holdings = new Map();
    const client = () => phone.device.client;
    return {
      async summary() {
        await client().signUnsigned(phone.signer);
        holdings = await phone.keep.holdings();
        const { cursor, claimedSeq, vector } = await client().nearbyHave();
        return summaryOf(summaryText(Math.max(cursor, claimedSeq), vector, holdings, (await phone.keep.revoked())?.list.seq ?? 0), fakeSha256);
      },
      peers: () => phone.keep.peers(),
      async knownKeys() {
        const { vector } = await client().nearbyHave();
        return [...new Set([...vector.keys(), ...holdings.keys()])];
      },
      swap(key) {
        const theirs = key === null ? undefined : holdings.get(key);
        if (!theirs) return { hasWhatIWant: true, wantsWhatIHave: true };
        const mine = holdings.get(phone.crypto.publicKey)?.files ?? [];
        const held = new Set(mine);
        return { hasWhatIWant: theirs.files.some((f) => !held.has(f)), wantsWhatIHave: mine.some((f) => !theirs.files.includes(f)) };
      },
      listed: () => false
    };
  }

  /** `SyncClient` as a session uses it, through the device so a restart is followed, and telling the person what arrived. */
  private port(device: SimDevice): NearbySessionPort {
    const c = () => device.client;
    return {
      signUnsigned: (s) => c().signUnsigned(s),
      nearbyHave: () => c().nearbyHave(),
      nearbyUncounted: (v) => c().nearbyUncounted(v),
      nearbyBatchPage: (k, n) => c().nearbyBatchPage(k, n),
      nearbyNextClaims: (t) => c().nearbyNextClaims(t),
      nearbyHoldsLess: (t) => c().nearbyHoldsLess(t),
      receiveNearby: async (page: NearbyPage, intake) => {
        const receipt = await c().receiveNearby(page, intake);
        if (receipt.outcome === 'taken') {
          const refused = new Set(receipt.refused.map((r) => r.id));
          device.heard(page.events.filter((e: AnyEvent) => !refused.has(e.id)));
        }
        return receipt;
      },
      startNearbyBudget: () => c().startNearbyBudget(),
      nearbyDoorAgain: (g) => c().nearbyDoorAgain(g),
      nearbyApplyRevoked: (l) => c().nearbyApplyRevoked(l),
      get nearbyWallNow() { return c().nearbyWallNow; },
      get nearbyHelloNow() { return c().nearbyHelloNow; },
      get nearbyFarAhead() { return c().nearbyFarAhead; }
    };
  }

  /**
   * The app's half of files, over the device's audio: what it wants in the order of section
   * 5.6 with "Hold teammates' recordings" on, worked out from the whole language as this
   * phone holds it (a kept phone's too). A model of the store query the app will make: open
   * for review is a submitted version nobody has reviewed yet, for a person whose role reviews.
   */
  private fileMoves(phone: NearbyPhone): NearbyFileMoves {
    const { device } = phone;
    const uriOf = (hash: string) => `${device.id}/${hash}`;
    const files: NearbyFileMoves = {
      wanted: async (holdings) => {
        const s = await device.wholeState();
        const plan = filePlanOf(s);
        // The app's default scope (asked of them, or worked in). What a reviewer waits on comes in as open for review, not as a choice to keep it.
        const scopeUnits = defaultOfflineScope(s, device.actorId);
        const offlineScope = new Set<string>();
        const refs: { hash: string; format: string; confirmed: boolean }[] = [];
        for (const [hash, ref] of plan.refs) {
          refs.push({ hash, format: ref.format, confirmed: s.blobs[hash]?.stored === true });
          if (scopeUnits.has(ref.unitId)) offlineScope.add(hash);
        }
        const wanted = wantedFilesOf({
          refs, offlineScope, reviewOrder: device.persona.role === 'reviewer' ? reviewOrderOf(s) : null,
          copies: copiesOf(holdings), planOrder: [...plan.order.keys()]
        }, { hold: true });
        return wanted.filter((w) => !device.audioHere.has(w.hash));
      },
      serveFile: async ({ hash }) => {
        // Every fleet phone is honest and its files are referenced, so holding one is enough to serve it.
        if (!device.audioHere.has(hash)) return { no: 'not-here' };
        const size = device.audioSizes.get(hash) ?? 0;
        this.shelf.set(uriOf(hash), utf8Encode(`${hash}:${size}`));
        return { uri: uriOf(hash), size };
      },
      fetchFile: async (file) => ({ stagingUri: `${uriOf(file.hash)}.${file.format}.nearby.part`, maxBytes: 50 * 1024 * 1024, minFreeBytes: 0 }),
      landed: async (file, stagingUri, size) => {
        this.shelf.delete(stagingUri);
        device.audioHere.add(file.hash);
        device.audioSizes.set(file.hash, size);
        const order = this.stats.landed.get(device.id) ?? [];
        order.push({ group: file.group, session: phone.sessions });
        this.stats.landed.set(device.id, order);
        device.filesChanged();
      },
      discard: async (stagingUri) => { this.shelf.delete(stagingUri); },
      held: async () => {
        const s = await device.wholeState();
        return [...device.audioHere].filter((h) => s.blobs[h]?.stored !== true).sort();
      },
      // Fleet phones run with "Hold teammates' recordings" on (section 8).
      holds: () => true
    };
    return files;
  }

  /** The device's radio, with each link it brings up carrying its bytes at its kind's speed. */
  private shaped(phone: NearbyPhone): NearbyRadio {
    const { time } = this.ctx;
    const radio = phone.radio;
    const wrap = (link: NearbyLink) => this.shapedLink(link, phone.pipe);
    return {
      capabilities: () => radio.capabilities(),
      startFind: (a) => radio.startFind(a),
      updateFind: (a) => radio.updateFind(a),
      stopFind: () => radio.stopFind(),
      holdScan: (held) => radio.holdScan(held),
      holdSalt: (held) => radio.holdSalt(held),
      onFound: (h) => radio.onFound(h),
      onFormSalt: (h) => radio.onFormSalt(h),
      onSalt: (h) => radio.onSalt(h),
      onPipe: (h) => radio.onPipe((pipe, salt) => h(wrap(pipe), salt)),
      openPipe: async (peer, salt, scan) => wrap(await radio.openPipe(peer, salt, scan)),
      host: async (kind, opts) => {
        const hosted = await radio.host(kind, opts);
        return { ...hosted, link: hosted.link.then(wrap) };
      },
      join: async (kind, details) => {
        await time.sleep(this.o.wifiUpMs);
        return wrap(await radio.join(kind, details));
      },
      stopAll: () => radio.stopAll()
    };
  }

  private shapedLink(inner: NearbyLink, pipe: LinkPipe): NearbyLink {
    const { time } = this.ctx;
    const shape = inner.kind === 'bluetooth' ? this.o.bluetooth : this.o.wifiShape;
    const kind = inner.kind === 'bluetooth' ? 'bluetooth' : 'wifi';
    const carry = async (bytes: number) => {
      this.stats.bytes[kind] = (this.stats.bytes[kind] ?? 0) + bytes;
      await pipe.carry(bytes, shape, time.now, time.sleep);
    };
    return {
      kind: inner.kind,
      canMoveFiles: inner.canMoveFiles,
      async send(message) {
        await carry(message.length + FRAME_OVERHEAD);
        return inner.send(message);
      },
      receive: () => inner.receive(),
      async sendOpening(bytes) {
        await carry(bytes.length);
        return inner.sendOpening(bytes);
      },
      receiveOpening: (size, deadlineMs) => inner.receiveOpening(size, deadlineMs),
      secure: (keys) => inner.secure(keys),
      async sendFile(file) {
        await carry(file.size);
        return inner.sendFile(file);
      },
      receiveFile: async (file) => {
        const moved = await inner.receiveFile(file);
        const [hash, size] = new TextDecoder().decode(this.shelf.get(file.stagingUri) ?? new Uint8Array()).split(':');
        return hash && size !== undefined ? { size: Number(size), sha256: hash } : moved;
      },
      cancelFile: (transferId) => inner.cancelFile(transferId),
      close: () => inner.close()
    };
  }
}

/** Submitted versions nobody has reviewed, their passages in order, each with its version's files. */
function reviewOrderOf(s: LanguageState): string[][] {
  const reviewed = new Set(Object.values(s.kindReviews).map((r) => r.takeId));
  const open: { unitId: string; files: string[] }[] = [];
  for (const sub of Object.values(s.submissions)) {
    const take = s.takes[sub.takeId];
    if (!take || take.archived || reviewed.has(sub.takeId)) continue;
    open.push({ unitId: take.unitId, files: take.cardHashes });
  }
  open.sort((a, b) => (a.unitId < b.unitId ? -1 : a.unitId > b.unitId ? 1 : 0));
  return open.map((o) => o.files);
}
