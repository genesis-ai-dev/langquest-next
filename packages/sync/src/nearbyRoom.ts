import { base64urlDecode, base64urlEncode, discoveryKeyAt, type DiscoveryKey } from '@langquest-next/core/nearby';
import type { NearbyPeerRecord } from './nearbyKeep';
import { emptyRoomTally, nearbyCodeOf, roomDiagOf, sessionDiagOf, type NearbyDiagInput, type NearbyRoomTally } from './nearbyDiag';
import type { FindTunables, NearbyCapabilities, NearbyCrypto, NearbyLink, NearbyRadio, SeenPhone } from './nearbyLink';
import { channelKeysOf, findEchoOf, findPayload, findTagOf } from './nearbyOpening';
import { choosePartner, type PartnerInRange } from './nearbyPartners';
import type { NearbyRole, NearbySessionReport, Radios } from './nearbySession';

/**
 * The room's loop over a `NearbyRadio` (docs/nearby-sync-plan.md 5.8, 5.11, 5.12): Find,
 * the echo, choosing a partner, one session at a time, and stopping by itself. It reads no
 * clock: its caller ticks it with the time, and the fleet ticks it on simulated time, so
 * phones run this code and the fleet supplies only time and the link. `radiosMayRun` is the
 * app's: the caller starts and stops the room. It holds nothing a screen must know besides
 * what it reports.
 */

/** This phone's key for the open language: its newest generation and how far down it scans. */
export interface NearbyRoomKeys extends DiscoveryKey {
  floor: number;
}

/** What the room asks the phone about itself and its teammates. */
export interface NearbyRoomFacts {
  /** This phone's summary now, after `signUnsigned`. */
  summary(): Promise<string>;
  peers(): Promise<readonly NearbyPeerRecord[]>;
  /** Install keys this phone knows from its vector, holdings and chains, to put a name to a tag. */
  knownKeys(): Promise<readonly string[]>;
  /** From holdings. An unknown key counts as true both ways. */
  swap(key: string | null): { hasWhatIWant: boolean; wantsWhatIHave: boolean };
  /** On the revocation list. */
  listed(key: string | null): boolean;
}

/** What the room needs to build a session; the caller adds the store, the files and the crypto. */
export interface NearbyRoomSessionArgs {
  role: NearbyRole;
  link: NearbyLink;
  salt: Uint8Array;
  kSess: Uint8Array;
  kFind: Uint8Array;
  gen: number;
  older: boolean;
  heardTag?: string;
  seen?: Set<string>;
  radios: Radios;
  onOpened?: () => boolean;
  otherWaiting: () => boolean;
}

export interface NearbyRoomSession {
  run(): Promise<NearbySessionReport>;
  stop(): void;
}

export interface NearbyRoomTunables {
  /** Generations scanned for, newest first. */
  scanKeysMax: number;
  /** Salts no key matched that may fill the echo slot, strongest first. */
  formSaltsMax: number;
  /** A phone not heard for this long has left. */
  heardForMs: number;
  /** After this with no echo, the screen offers a tap. */
  tapAfterMs: number;
  /** The higher tag waits this long for the lower to connect, then may connect itself. */
  waitToConnectMs: number;
  /** A failed connect backs off from this, doubling, so a replay cannot hold off "Up to date". */
  retryMs: number;
  retryMaxMs: number;
  /** Two phones with nothing to swap connect anyway, once, after this long without an exchange. */
  dueAfterMs: number;
  /** A phone that cannot advertise has no salt to echo, so it connects as phones do today. False makes it a tap. */
  scanOnlyConnects: boolean;
}

export const NEARBY_ROOM_DEFAULTS: NearbyRoomTunables = {
  scanKeysMax: 16, formSaltsMax: 8, heardForMs: 30_000, tapAfterMs: 60_000, waitToConnectMs: 20_000, retryMs: 15_000, retryMaxMs: 300_000, dueAfterMs: 30 * 60_000, scanOnlyConnects: true
};

export type NearbyRoomStop = 'asked' | 'idle' | 'wait' | 'run' | 'level' | 'no-key';

export type NearbyRoomEvent =
  /** Teammates who have echoed this phone's salt. Nobody shows before that. */
  | { t: 'teammates'; seen: readonly { tag: string; key: string | null; older: boolean }[] }
  /** No echo came: "A teammate may be nearby", and connecting takes a tap (`NearbyRoom.tap`). */
  | { t: 'maybe'; tag: string }
  | { t: 'session'; tag: string | null; role: NearbyRole }
  | { t: 'ended'; tag: string | null; report: NearbySessionReport }
  /** "Up to date". */
  | { t: 'level' }
  | { t: 'stopped'; why: NearbyRoomStop };

export interface NearbyRoomOptions {
  radio: NearbyRadio;
  crypto: Pick<NearbyCrypto, 'publicKey' | 'sha256' | 'hmacSha256' | 'hkdfSha256' | 'randomBytes'>;
  keys(): NearbyRoomKeys | null;
  facts: NearbyRoomFacts;
  openSession(args: NearbyRoomSessionArgs): NearbyRoomSession;
  idleLimitMs: number;
  waitLimitMs: number;
  runLimitMs?: number;
  stopWhenLevel: boolean;
  radios(caps: NearbyCapabilities): Radios;
  find: FindTunables;
  tunables?: Partial<NearbyRoomTunables>;
  report(event: NearbyRoomEvent): void;
  /** Field diagnostics: a record when the room stops and when one of this phone's sessions ends (nearbyDiag.ts). */
  diag?: (input: NearbyDiagInput) => void;
}

interface Generation {
  gen: number;
  kFind: Uint8Array;
  kSess: Uint8Array;
}

interface Heard {
  seen: SeenPhone;
  firstAt: number;
  lastAt: number;
  echoed: boolean;
  tapped: boolean;
  offered: boolean;
  /** Summaries heard from it before its last session ended. A summary only moves on, so one of these is a response made before that session's work. */
  heardBefore: string[];
  stale: ReadonlySet<string>;
}

const NONE = new Uint8Array(0);

/** The same link, with `close` also running `closed` first. */
function closingWith(link: NearbyLink, closed: () => void): NearbyLink {
  return {
    get kind() { return link.kind; },
    get canMoveFiles() { return link.canMoveFiles; },
    send: (m) => link.send(m),
    receive: () => link.receive(),
    sendOpening: (b) => link.sendOpening(b),
    receiveOpening: (size, deadlineMs) => link.receiveOpening(size, deadlineMs),
    secure: (keys) => link.secure(keys),
    sendFile: (f) => link.sendFile(f),
    receiveFile: (f) => link.receiveFile(f),
    cancelFile: (id) => link.cancelFile(id),
    close: async () => {
      closed();
      await link.close();
    }
  };
}

export class NearbyRoom {
  private readonly opt: NearbyRoomOptions;
  private readonly tune: NearbyRoomTunables;
  private running = false;
  private now = 0;
  private startedAt = 0;
  private caps: NearbyCapabilities | null = null;
  private gens: Generation[] = [];
  private myTag = '';
  private salts: { current: string | null; previous: string | null } = { current: null, previous: null };
  private readonly usedR = new Set<string>();
  private readonly nonces = new Map<string, Set<string>>();
  private readonly heard = new Map<string, Heard>();
  private formSalts: { salt: string; rssi: number; at: number }[] = [];
  private session: NearbyRoomSession | null = null;
  private connecting = false;
  private readonly strangers = new Set<NearbyRoomSession>();
  private readonly backoff = new Map<string, { fails: number; until: number }>();
  /** A refused pair, in memory only, under the advert's tag: Hello's chain never passed, so nothing goes in `nearbyPeers`. */
  private readonly refused = new Map<string, { mine: string; theirs: string }>();
  private readonly waitingOn = new Map<string, number>();
  private readonly lastExchange = new Map<string, number>();
  private readonly dueSpent = new Set<string>();
  private idleMs = 0;
  private waitMs = 0;
  private lastTick: number | null = null;
  /**
   * Someone met this run, as the screen counts it: a phone that echoed this phone's salt, one the
   * person tapped, or a session that began. Not a phone merely heard: a played-back advert is
   * heard, and a disguised phone must not stop at level having found nobody (5.8, `stopWhenLevel`).
   */
  private everMet = false;
  private level = false;
  private chosen: string | null = null;
  private echoTurn = 0;
  private summary = '';
  private peers: readonly NearbyPeerRecord[] = [];
  private keyOfTag = new Map<string, string>();
  private shown = '[]';
  private ticking = false;
  private unsubscribe: (() => void)[] = [];
  /** Releases the salt a responder's open pipe holds. */
  private saltRelease: (() => void) | null = null;
  private scanHeld = false;
  /** What diagnostics count over one run: numbers, and the tags only to count them once. */
  private tally: NearbyRoomTally = emptyRoomTally();
  private readonly heardTags = new Set<string>();
  private readonly echoedTags = new Set<string>();
  private readonly began = new Map<NearbyRoomSession, number>();
  private startWait: 'summary' | 'peers' | 'find' | null = null;
  /** Moves at every start and every stop, so a start whose stop came before it set `running` turns nothing on. */
  private starts = 0;

  constructor(options: NearbyRoomOptions) {
    this.opt = options;
    this.tune = { ...NEARBY_ROOM_DEFAULTS, ...options.tunables };
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** What a start waits on, while it does: this phone's summary (the language's turn), its peers, or the radios. */
  get startingAt(): 'summary' | 'peers' | 'find' | null {
    return this.startWait;
  }

  async start(now: number): Promise<void> {
    if (this.running) return;
    const mine = ++this.starts;
    this.now = now;
    this.startedAt = now;
    this.lastTick = null;
    this.idleMs = 0;
    this.waitMs = 0;
    this.level = false;
    this.tally = emptyRoomTally();
    this.heardTags.clear();
    this.echoedTags.clear();
    this.caps = await this.opt.radio.capabilities();
    // Stopped while it waited, before `running`: `halt` found nothing to stop, so nothing starts (security review, 2026-11-10).
    if (mine !== this.starts) return;
    const keyed = await this.gensFromKeys();
    if (mine !== this.starts) return;
    if (!keyed) {
      this.note(roomDiagOf(this.tally, 'no-key', 0, this.caps));
      this.opt.report({ t: 'stopped', why: 'no-key' });
      return;
    }
    const { radio } = this.opt;
    this.unsubscribe = [
      radio.onSalt((salt) => this.heardSalt(salt)),
      radio.onFound((seen) => this.found(seen)),
      radio.onFormSalt((salt, rssi) => this.formSalt(salt, rssi)),
      radio.onPipe((pipe, salt) => this.piped(pipe, salt))
    ];
    this.running = true;
    await this.startFind();
  }

  /** Look again, after a stop: only this, reopening the screen, or on a disguised phone a press, starts the radios again. */
  async lookAgain(now: number): Promise<void> {
    this.heard.clear();
    this.formSalts = [];
    this.backoff.clear();
    this.everMet = false;
    await this.start(now);
  }

  stop(): Promise<void> {
    this.starts += 1;
    return this.halt('asked');
  }

  /** The screen answered "A teammate may be nearby". */
  tap(tag: string): void {
    const h = this.heard.get(tag);
    if (h) {
      h.tapped = true;
      this.everMet = true;
    }
    this.tally.taps += 1;
  }

  /** One turn of the loop, with the time. Refreshes the scan response whether or not anyone was heard, so no mask is reused. */
  async tick(now: number): Promise<void> {
    if (!this.running || this.ticking) return;
    this.ticking = true;
    try {
      const passed = this.lastTick === null ? 0 : Math.max(0, now - this.lastTick);
      this.lastTick = now;
      this.now = now;
      if (this.opt.runLimitMs !== undefined && now - this.startedAt >= this.opt.runLimitMs) return await this.halt('run');
      await this.refreshFind();
      if (!this.running) return;
      this.forget();
      // A running session is exempt from both clocks, and has its own stall deadline.
      if (this.session || this.connecting) return;
      const choice = await this.choose();
      if (!this.running) return;
      if (choice === null) {
        if (!this.level) this.opt.report({ t: 'level' });
        this.tally.levelMs ??= now - this.startedAt;
        this.level = true;
        if (this.opt.stopWhenLevel && this.everMet) return await this.halt('level');
        this.idleMs += passed;
        if (this.idleMs >= this.opt.idleLimitMs) return await this.halt('idle');
        return;
      }
      this.level = false;
      if (choice.connect) {
        await this.connect(choice.partner);
        return;
      }
      this.waitMs += passed;
      if (this.waitMs >= this.opt.waitLimitMs) await this.halt('wait');
    } finally {
      this.ticking = false;
    }
  }

  // ---- keys and Find ------------------------------------------------------------

  private async gensFromKeys(): Promise<boolean> {
    const keys = this.opt.keys();
    if (!keys) return false;
    const { crypto } = this.opt;
    const out: Generation[] = [];
    // Newest first, down to `floor` and no further than the cap; older keys are worked out here and never stored.
    for (let gen = keys.gen; gen >= Math.max(1, keys.floor) && out.length < this.tune.scanKeysMax; gen--) {
      const key = await discoveryKeyAt(keys, gen, crypto.sha256);
      if (!key) break;
      out.push({ gen, ...channelKeysOf(crypto, key) });
    }
    if (out.length === 0) return false;
    this.gens = out;
    this.myTag = findTagOf(crypto, out[0]!.kFind, crypto.publicKey);
    return true;
  }

  /**
   * Each wait can outlast a stop (the summary waits on the language's turn), so after each the
   * room goes on only if still running, and radios a stop could not yet stop are stopped here.
   */
  private async startFind(): Promise<void> {
    try {
      this.startWait = 'summary';
      this.summary = await this.opt.facts.summary();
      if (!this.running) return;
      this.startWait = 'peers';
      this.peers = await this.opt.facts.peers();
      if (!this.running) return;
      this.startWait = 'find';
      const r = this.freshR();
      await this.opt.radio.startFind({
        kFind: this.gens[0]!.kFind, scanKeys: this.gens.map((g) => g.kFind), payload: findPayload(this.myTag, this.summary, this.echoFor(r)), r: base64urlDecode(r)!, tunables: this.opt.find
      });
      if (!this.running) await this.opt.radio.stopAll();
    } finally {
      this.startWait = null;
    }
  }

  private async refreshFind(): Promise<void> {
    this.summary = await this.opt.facts.summary();
    const r = this.freshR();
    await this.opt.radio.updateFind({ payload: findPayload(this.myTag, this.summary, this.echoFor(r)), r: base64urlDecode(r)! });
  }

  /** Never repeated under one salt, or the XOR of two responses would show the layout. */
  private freshR(): string {
    for (;;) {
      const r = base64urlEncode(this.opt.crypto.randomBytes(2));
      if (this.usedR.has(r)) continue;
      this.usedR.add(r);
      return r;
    }
  }

  /** The next heard salt in turn, the chosen partner's first, then salts no key matched, or random bytes when nobody was heard. */
  private echoFor(r: string): string {
    const order: string[] = [];
    const chosen = this.chosen ? this.heard.get(this.chosen) : undefined;
    if (chosen) order.push(chosen.seen.salt);
    for (const h of [...this.heard.values()].sort((a, b) => (a.seen.tag < b.seen.tag ? -1 : 1))) if (!order.includes(h.seen.salt)) order.push(h.seen.salt);
    for (const f of [...this.formSalts].sort((a, b) => b.rssi - a.rssi).slice(0, this.tune.formSaltsMax)) if (!order.includes(f.salt)) order.push(f.salt);
    if (order.length === 0) return base64urlEncode(this.opt.crypto.randomBytes(4));
    const salt = order[this.echoTurn % order.length]!;
    this.echoTurn += 1;
    return findEchoOf(this.opt.crypto, this.gens[0]!.kFind, salt, r);
  }

  private heardSalt(salt: string): void {
    this.salts = { current: salt, previous: this.salts.current };
    // An echo stands only while it names one of these two, so a recording made while a teammate was live stops drawing a connection.
    // A live teammate's next advert echoes again, since it still names the previous salt until it hears the new one.
    for (const h of this.heard.values()) h.echoed = false;
    this.usedR.clear();
    for (const s of [...this.nonces.keys()]) if (s !== this.salts.current && s !== this.salts.previous) this.nonces.delete(s);
  }

  private found(seen: SeenPhone): void {
    if (!this.running || !this.gens[seen.scan] || seen.tag === this.myTag) return;
    const held = this.heard.get(seen.tag);
    const h: Heard = held ?? { seen, firstAt: this.now, lastAt: this.now, echoed: false, tapped: false, offered: false, heardBefore: [], stale: new Set() };
    h.seen = seen;
    if (!h.heardBefore.includes(seen.summary)) h.heardBefore = [...h.heardBefore, seen.summary].slice(-8);
    h.lastAt = this.now;
    // Under the generation it was heard on, against this phone's current or previous salt: a recording cannot answer a salt made after it.
    const kFind = this.gens[seen.scan]!.kFind;
    const echoes = [this.salts.current, this.salts.previous].some((salt) => salt !== null && findEchoOf(this.opt.crypto, kFind, salt, seen.r) === seen.echo);
    if (echoes || this.scanOnly()) h.echoed = true;
    this.heard.set(seen.tag, h);
    this.heardTags.add(seen.tag);
    if (h.echoed) {
      this.echoedTags.add(seen.tag);
      this.everMet = true;
    }
    this.showTeammates();
  }

  private formSalt(salt: string, rssi?: number): void {
    this.formSalts = [...this.formSalts.filter((f) => f.salt !== salt), { salt, rssi: rssi ?? -100, at: this.now }];
    this.tally.maxUnmatched = Math.max(this.tally.maxUnmatched, this.formSalts.length);
  }

  private scanOnly(): boolean {
    return this.caps?.advertise === false && this.tune.scanOnlyConnects;
  }

  private forget(): void {
    for (const [tag, h] of this.heard) if (this.now - h.lastAt >= this.tune.heardForMs) this.heard.delete(tag);
    this.formSalts = this.formSalts.filter((f) => this.now - f.at < this.tune.heardForMs);
    this.showTeammates();
  }

  private showTeammates(): void {
    const seen = [...this.heard.values()].filter((h) => h.echoed || h.tapped).map((h) => ({ tag: h.seen.tag, key: this.keyOfTag.get(`${h.seen.scan}:${h.seen.tag}`) ?? null, older: h.seen.scan > 0 }));
    const text = JSON.stringify(seen);
    if (text === this.shown) return;
    this.shown = text;
    this.opt.report({ t: 'teammates', seen });
  }

  // ---- choosing ---------------------------------------------------------------

  private async learnKeys(): Promise<void> {
    const keys = await this.opt.facts.knownKeys();
    const map = new Map<string, string>();
    this.gens.forEach((g, scan) => { for (const key of keys) map.set(`${scan}:${findTagOf(this.opt.crypto, g.kFind, key)}`, key); });
    this.keyOfTag = map;
  }

  private async choose(): Promise<{ partner: string; connect: boolean } | null> {
    await this.learnKeys();
    const inRange: PartnerInRange[] = [];
    for (const h of this.heard.values()) {
      const { tag, scan, summary } = h.seen;
      const off = this.backoff.get(tag);
      if ((off && off.until > this.now) || h.stale.has(summary)) continue;
      const echoed = h.echoed || h.tapped;
      if (!echoed && this.now - h.firstAt >= this.tune.tapAfterMs) {
        // A recording waits here for a tap and holds off nothing.
        if (!h.offered) {
          this.opt.report({ t: 'maybe', tag });
          this.tally.maybe += 1;
        }
        h.offered = true;
        continue;
      }
      const gen = this.gens[scan]!.gen;
      const key = this.keyOfTag.get(`${scan}:${tag}`) ?? null;
      const position = this.peers.findIndex((p) => p.tag === tag && p.gen === gen);
      const record = position >= 0 ? this.peers[position]! : null;
      const since = this.lastExchange.get(tag) ?? h.firstAt;
      const dueAnyway = !this.dueSpent.has(tag) && this.now - since >= this.tune.dueAfterMs;
      inRange.push({
        tag, key, summary, position: position >= 0 ? position : null,
        finished: this.refused.get(tag) ?? (record ? { mine: record.mine, theirs: record.theirs } : null),
        ...this.opt.facts.swap(key), echoed, older: scan > 0, listed: this.opt.facts.listed(key), dueAnyway
      });
    }
    const me = { tag: this.myTag, summary: this.summary };
    let choice = choosePartner(me, inRange);
    if (choice && !choice.connect) {
      const partner = inRange.find((p) => p.tag === choice!.partner)!;
      if (!partner.echoed) {
        // Someone not yet echoed comes first in order, so a phone that has echoed goes ahead rather than wait on it.
        choice = choosePartner(me, inRange.filter((p) => p.echoed)) ?? choice;
      } else {
        const since = this.waitingOn.get(partner.tag) ?? this.now;
        this.waitingOn.set(partner.tag, since);
        if (this.now - since >= this.tune.waitToConnectMs) choice = choosePartner(me, inRange, { waited: true });
      }
    }
    if (choice?.partner !== this.chosen) this.echoTurn = 0;
    this.chosen = choice?.partner ?? null;
    return choice;
  }

  /** Before this session began, someone else in range had something to swap: backups may be cut. */
  private othersWaiting(partner: string): boolean {
    return [...this.heard.values()].some((h) => h.seen.tag !== partner && (h.echoed || h.tapped) && (h.seen.summary !== this.summary || this.opt.facts.swap(this.keyOfTag.get(`${h.seen.scan}:${h.seen.tag}`) ?? null).hasWhatIWant));
  }

  // ---- sessions -----------------------------------------------------------------

  private async connect(tag: string): Promise<void> {
    const h = this.heard.get(tag);
    if (!h || !this.caps) return;
    const { seen } = h;
    const gen = this.gens[seen.scan]!;
    const waiting = this.othersWaiting(tag);
    const mine = this.summary;
    this.connecting = true;
    this.waitingOn.delete(tag);
    // A session notices nobody who arrives after it began: scanning stops, advertising carries on (5.12, Find).
    await this.holdScan(true);
    let link: NearbyLink;
    try {
      link = await this.opt.radio.openPipe(seen.peer, seen.salt, seen.scan);
    } catch (err) {
      this.tally.pipeFails += 1;
      this.tally.code = nearbyCodeOf(err) ?? this.tally.code;
      this.connecting = false;
      await this.holdScan(false);
      this.backOff(tag);
      return;
    }
    if (!this.running) {
      this.connecting = false;
      await link.close().catch(() => undefined);
      return;
    }
    const session = this.opt.openSession({
      role: 'i', link, salt: base64urlDecode(seen.salt) ?? NONE, kSess: gen.kSess, kFind: gen.kFind, gen: gen.gen, older: seen.scan > 0, heardTag: tag,
      radios: this.opt.radios(this.caps), otherWaiting: () => waiting
    });
    this.session = session;
    this.began.set(session, this.now);
    this.everMet = true;
    this.opt.report({ t: 'session', tag, role: 'i' });
    void this.finish(session, tag, mine, seen.summary);
  }

  /** Someone connected. Nothing is trusted, and nothing is held, until the opening checks. */
  private piped(pipe: NearbyLink, salt: string): void {
    if (!this.running || !this.caps) {
      void pipe.close().catch(() => undefined);
      return;
    }
    const gen = this.gens[0]!;
    let seen = this.nonces.get(salt);
    if (!seen) this.nonces.set(salt, (seen = new Set()));
    const mine = this.summary;
    // The salt stays while a pipe that passed its opening is open, since a rotation swaps the GATT service under it.
    // The pipe closes when the Wi-Fi link takes over, and rotation runs again then (5.12, Rotation).
    let holding = false;
    const release = () => {
      if (!holding) return;
      holding = false;
      this.saltRelease = null;
      void this.opt.radio.holdSalt(false).catch(() => undefined);
    };
    const session: NearbyRoomSession = this.opt.openSession({
      role: 'r', link: closingWith(pipe, release), salt: base64urlDecode(salt) ?? NONE, kSess: gen.kSess, kFind: gen.kFind, gen: gen.gen, older: false, seen, radios: this.opt.radios(this.caps),
      otherWaiting: () => false,
      onOpened: () => {
        this.strangers.delete(session);
        if (!this.running || this.session || this.connecting) return false;
        this.session = session;
        holding = true;
        this.saltRelease = release;
        void this.opt.radio.holdSalt(true).catch(() => undefined);
        void this.holdScan(true);
        this.everMet = true;
        this.opt.report({ t: 'session', tag: null, role: 'r' });
        return true;
      }
    });
    this.strangers.add(session);
    this.began.set(session, this.now);
    void session.run().then((report) => {
      this.strangers.delete(session);
      // A refusal has no session to settle, but a refused teammate is still not picked again.
      if (this.session === session || report.refusedTag) return this.settle(session, report.peer?.tag ?? report.refusedTag, mine, null, report);
      this.began.delete(session);
      // Silent to its peer, but not to diagnostics (5.12): an opening that never checked, or a teammate turned away while busy.
      if (report.ended.how === 'silent') this.tally.strangers += 1;
      else if (report.ended.how === 'said' && report.ended.reason === 'busy') this.tally.busy += 1;
    });
  }

  private async finish(session: NearbyRoomSession, tag: string, mine: string, theirs: string): Promise<void> {
    const report = await session.run();
    await this.settle(session, tag, mine, theirs, report);
  }

  private async settle(session: NearbyRoomSession, tag: string | null, mine: string, theirs: string | null, report: NearbySessionReport): Promise<void> {
    const mineToSettle = this.session === session || this.connecting;
    if (this.session === session) this.session = null;
    if (mineToSettle) {
      this.connecting = false;
      this.saltRelease?.();
      if (this.running) await this.holdScan(false);
    }
    const { ended } = report;
    this.tally.sessions += 1;
    if (ended.how === 'done') this.tally.done += 1;
    if (ended.how === 'no-answer') this.tally.noAnswer += 1;
    this.note(sessionDiagOf(report, Math.max(0, this.now - (this.began.get(session) ?? this.now))));
    this.began.delete(session);
    // Only a verified session that committed something restarts the clocks, never a connection.
    if (report.changed) {
      this.idleMs = 0;
      this.waitMs = 0;
    }
    if (tag !== null) {
      if (ended.how === 'done') {
        this.backoff.delete(tag);
        this.lastExchange.set(tag, this.now);
        this.dueSpent.add(tag);
        this.refused.delete(tag);
      } else if ((ended.how === 'said' || ended.how === 'heard') && (ended.reason === 'not-member' || ended.reason === 'identity')) {
        // So a refused newcomer does not keep picking the same teammate.
        this.refused.set(tag, { mine, theirs: theirs ?? this.heard.get(tag)?.seen.summary ?? '' });
      } else {
        // `busy`, no answer to an opening, a drop: tried again later.
        this.backOff(tag);
      }
    }
    const heard = tag === null ? undefined : this.heard.get(tag);
    if (heard) heard.stale = new Set(heard.heardBefore);
    this.opt.report({ t: 'ended', tag, report });
    if (!this.running) return;
    this.peers = await this.opt.facts.peers();
    const keys = this.opt.keys();
    if (report.handedKey || (keys && keys.gen !== this.gens[0]?.gen)) await this.restartFind();
  }

  private async holdScan(held: boolean): Promise<void> {
    if (this.scanHeld === held) return;
    this.scanHeld = held;
    await this.opt.radio.holdScan(held).catch(() => undefined);
  }

  private backOff(tag: string): void {
    const held = this.backoff.get(tag);
    const fails = (held?.fails ?? 0) + 1;
    this.backoff.set(tag, { fails, until: this.now + Math.min(this.tune.retryMaxMs, this.tune.retryMs * 2 ** (fails - 1)) });
  }

  /** A newer generation: Find again under it, as when a certificate answer moves the key. */
  private async restartFind(): Promise<void> {
    await this.opt.radio.stopFind();
    this.scanHeld = false;
    if (!this.running) return;
    if (!await this.gensFromKeys()) return this.halt('no-key');
    if (!this.running) return;
    this.heard.clear();
    await this.startFind();
  }

  private async halt(why: NearbyRoomStop): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.session?.stop();
    for (const s of this.strangers) s.stop();
    for (const off of this.unsubscribe.splice(0)) off();
    this.saltRelease = null;
    this.scanHeld = false;
    await this.opt.radio.stopAll();
    this.note(roomDiagOf({ ...this.tally, heard: this.heardTags.size, echoed: this.echoedTags.size }, why, Math.max(0, this.now - this.startedAt), this.caps));
    this.opt.report({ t: 'stopped', why });
  }

  /** Diagnostics never stop the room. */
  private note(input: NearbyDiagInput): void {
    try {
      this.opt.diag?.(input);
    } catch {
      // Recording is best effort.
    }
  }
}
