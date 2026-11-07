import { clockCloseEnough, decodeHlc, entityKeyOf, validateEvent, type AnyEvent, type LanguageState } from '@langquest-next/core';
import {
  applyFloor, checkChain, countBatch, doorFactsOf, doorKeptReads, isCounted, NEARBY_VECTOR_MAX_RANGES, nearbyCopy, nearbyDoor, nearbyLookUpRefusal, parseAttestation, parseBatchManifest,
  parseVector, revokedLater, type DoorFacts, type NearbyPeople, type NearbyVector, type NearbyVia, type PageFacts, type RevocationList
} from '@langquest-next/core/nearby';
import type { Diagnostics } from './diagnostics';
import {
  batchIsWhole, chainAsSigned, checkBatchPage, checkClaimsPage, nearbyDropped,
  type NearbyBatchPage, type NearbyClaimsPage, type NearbyGate, type NearbyIntake, type NearbyPage, type NearbyReceipt, type NearbyRefusal, type NearbySigned, type NearbySigner
} from './nearbyIntake';
import { batchPageOf, nextClaimsOf, signBatch } from './nearbySender';
import { applyRevocationList, attestNearby, isServerVerdict, replaceBareManifest, settleBatches, sweepNearby, type NearbyHost, type NearbyPlatform } from './nearbyUpkeep';
import { nearbyBudgetOf, type EventStore, type KeptRecord, type LocalEvent, type NearbyUse, type Transport, type WriteBatch } from './types';

/**
 * Nearby sharing's half of a `SyncClient` (docs/nearby-sync-plan.md 5.4, 5.7, 5.12): signing,
 * taking a teammate's pages, the sender's reads, the door run again, and the steps at the end of
 * a sync. It is behind `@langquest-next/sync/nearby`, so the web app, which shares nothing nearby,
 * does not carry it. A client made with `nearby: nearbyClient(platform)` hands this its port.
 *
 * A nearby phone is not a server (5.1). Nothing here moves the cursor or confirms anything, and
 * the link is never awaited under the stream's turn: the session reads what to send outside it,
 * and hands each page in here whole.
 */

const LOG_PAGE = 500;

/** Exactly what nearby sharing reaches of its `SyncClient`'s private state. */
export interface NearbyPort {
  readonly store: EventStore;
  readonly transport: Transport;
  readonly orgId: string;
  readonly streamId: string;
  readonly actorId: string;
  readonly deviceId: string;
  readonly diag: Diagnostics | undefined;
  /** The reducer's version: a door run over the rows is stamped with it. */
  readonly version: number;
  /** A language kept on disk: the door's facts read the rows there as well as the fold. */
  readonly keptOnDisk: boolean;
  /** Has the fold been read yet? Nothing is taken before. */
  loaded(): boolean;
  /** The stream's turn, which syncs, pushes, pulls and refolds of this stream take one at a time. */
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  /** One transaction, through the client's single writer. */
  commit(batch: WriteBatch): Promise<void>;
  /** Fold the log again, under the turn already held: `other` unless said. */
  refold(reason?: 'other' | 'requeue'): Promise<unknown>;
  lang(): LanguageState;
  /** Fold one event into the live state. */
  apply(e: AnyEvent): void;
  /** These events were folded: their lines catch up now, before the page is shown, and the revision moves. */
  foldedNow(events: readonly AnyEvent[]): Promise<void>;
  /** These events' passages' lines are owed, worked out from the fold as it stands. */
  touched(events: readonly AnyEvent[]): void;
  /** The clock's last stamp, which never goes back. */
  lastStamp(): string | null;
  receiveClock(hlc: string): void;
  /** This phone's wall time, with any offset the server gave it. */
  wall(): number;
  /** The clock's last stamp as the commit carrying what it stamped writes it. */
  clockMeta(): Record<string, string>;
  /** A nearby row was written: from now on a pull compares what it brings with what is here. */
  compareFromNow(): void;
  /** A device meta key for this stream, and for one signer when given. */
  key(what: string, signer?: string): string;
  checkpointSeq(): Promise<number | null>;
}

/** What a `SyncClient` asks of its nearby half. */
export interface NearbyPart {
  signUnsigned(signer: NearbySigner): Promise<NearbySigned>;
  nearbyHave(): Promise<{ cursor: number; claimedSeq: number; vector: NearbyVector }>;
  nearbyUncounted(them: NearbyVector): Promise<{ key: string; n: number }[]>;
  nearbyBatchPage(key: string, n: number): Promise<NearbyBatchPage | null>;
  nearbyNextClaims(them: { cursor: number; claimedSeq: number }): Promise<{ page: NearbyClaimsPage; throughSeq: number } | null>;
  nearbyHoldsLess(them: { cursor: number; claimedSeq: number }): Promise<boolean>;
  readonly nearbyFarAhead: readonly { actorId: string; hlc: string }[];
  startNearbyBudget(): Promise<void>;
  receiveNearby(page: NearbyPage, intake: NearbyIntake): Promise<NearbyReceipt>;
  retryNearby(gate: NearbyGate): Promise<number>;
  nearbyDoorAgain(gate: NearbyGate): Promise<number>;
  nearbyApplyRevoked(list: RevocationList): Promise<number>;
  nearbyMeta(key: string): Promise<string | null>;
  writeNearbyMeta(rows: Record<string, string>): Promise<void>;
  readonly nearbyWallNow: number;
  readonly nearbyHelloNow: number;
  /** The end of a sync, under the turn: attest, then once nothing more is to pull, the sweep and what it settles. */
  afterSync(morePull: boolean): Promise<void>;
  /** Has this phone ever held a teammate's row, in any language? Until it has, a pull compares nothing for nearby's sake. */
  holdsAny(): Promise<boolean>;
  /**
   * A pulled page before it is written, with the rows already here under its ids: what nearby adds to
   * that page's commit. A row the server sends here from another language's row leaves that language a note.
   */
  pulled(page: readonly AnyEvent[], here: ReadonlyMap<string, LocalEvent>): Promise<{ events: LocalEvent[]; meta: Record<string, string> }>;
  /** Rows a fill is about to keep: the nearby undos their reviews, notes and departures refuse, for the same commit. */
  filled(rows: readonly KeptRecord[]): Promise<LocalEvent[]>;
}

/** How a client gets its nearby half: `nearby: nearbyClient(platform)`. Only the Android app passes one. */
export type NearbyMaker = (port: NearbyPort) => NearbyPart;

/**
 * Nearby sharing for a client. `platform` is the phone's half (hashing, and whether it holds a
 * certificate); without it a sync still sweeps, but asks for no attestation and closes no batch number.
 */
export function nearbyClient(platform?: NearbyPlatform): NearbyMaker {
  const phone: PhoneShare = { held: null };
  return (port) => new NearbyClient(port, platform, phone);
}

/**
 * What the clients one maker made share: has this phone ever held a teammate's row? Pass one
 * maker to every client on a phone, so a row taken in one language is known to the others'
 * pulls at once. The device meta row says so across launches.
 */
interface PhoneShare {
  held: boolean | null;
}

const HELD_KEY = 'nearbyHeld';

/** The note a pull leaves a language whose rows the server sent to another: those rows as they were there. */
const movedKey = (orgId: string, streamId: string) => `nearbyMoved:${orgId}/${streamId}`;

const hasOwn = (map: object, key: string) => Object.prototype.hasOwnProperty.call(map, key);

/** Who may do what when no gate has been seen yet: nobody may do anything, so only a refusal for good is taken from it. */
const NOBODY: NearbyPeople = { privilegesIn: () => new Set(), languageListed: () => false };

/** The undo types by the target each names, as the door's step 10 reads them. */
type UndoTargets = Map<'v1.ReviewWithdrawn' | 'v1.NoteWithdrawn' | 'v1.DepartureUndone', Set<string>>;

function undoTargetOf(e: AnyEvent): string | null {
  if (e.type === 'v1.ReviewWithdrawn') return e.payload.reviewId;
  if (e.type === 'v1.NoteWithdrawn') return e.payload.noteId;
  if (e.type === 'v1.DepartureUndone') return e.payload.departureId;
  return null;
}

/** Targets among these events whose undo slot the fold already holds: an undo that landed first holds it. */
function heldSlotsOf(events: readonly AnyEvent[], lang: LanguageState): UndoTargets {
  const out: UndoTargets = new Map();
  const add = (type: 'v1.ReviewWithdrawn' | 'v1.NoteWithdrawn' | 'v1.DepartureUndone', id: string) => out.set(type, (out.get(type) ?? new Set()).add(id));
  for (const e of events) {
    if (e.type === 'v1.ReviewRecorded' && hasOwn(lang.withdrawnReviews, e.payload.reviewId)) add('v1.ReviewWithdrawn', e.payload.reviewId);
    if (e.type === 'v1.NoteAdded' && hasOwn(lang.withdrawnNotes, e.payload.noteId)) add('v1.NoteWithdrawn', e.payload.noteId);
    if (e.type === 'v1.DepartureRecorded' && hasOwn(lang.undoneDepartures, e.payload.departureId)) add('v1.DepartureUndone', e.payload.departureId);
  }
  return out;
}

function movedOf(raw: string | undefined): AnyEvent[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AnyEvent[]) : [];
  } catch {
    return [];
  }
}

/** What the door made of one page's new events, before anything is folded or written. */
interface NearbyDoorPass {
  rows: LocalEvent[];
  refused: NearbyRefusal[];
  /** Let in, or refused for good. A refusal that can change is neither, so its number stays open. */
  settled: Set<string>;
  facts: PageFacts;
}

/** What a page's commit writes once its rows are folded. */
interface NearbyFolded {
  rows: LocalEvent[];
  rejected: LocalEvent[];
  refold: boolean;
  farAhead?: { actorId: string; hlc: string };
}

const byId = (rows: readonly LocalEvent[]) => new Map(rows.map((l) => [l.event.id, l]));

class NearbyClient implements NearbyPart {
  private useNow: Map<string, NearbyUse> | null = null;
  /** The door ran over the rows under this reducer, in this client's life. */
  private doorChecked = false;
  private readonly farAhead = new Map<string, string>();
  private readonly host: NearbyHost;
  /** The gate a page, Try again or a door run last came with: what a target arriving by pull or fill asks of people. */
  private gate: NearbyGate | null = null;

  constructor(private readonly port: NearbyPort, platform: NearbyPlatform | undefined, private readonly phone: PhoneShare) {
    this.host = { ...port, platform, vector: () => this.vector(), vectorMeta: (vector) => this.vectorMeta(vector), number: (key) => this.number(key) };
  }

  /** A row that cannot be read reads as nothing: an entry too low is always safe, because it costs only re-sends. */
  private async vector(): Promise<NearbyVector> {
    const raw = await this.port.store.meta(this.port.key('nearbyVector'));
    if (!raw) return new Map();
    try {
      return parseVector(JSON.parse(raw), { maxRanges: Infinity }) ?? new Map();
    } catch {
      return new Map();
    }
  }

  private vectorMeta(vector: NearbyVector): Record<string, string> {
    return { [this.port.key('nearbyVector')]: JSON.stringify(Object.fromEntries(vector)) };
  }

  private async number(key: string): Promise<number> {
    return Number((await this.port.store.meta(key)) ?? 0) || 0;
  }

  private stream(): { orgId: string; streamId: string } {
    return { orgId: this.port.orgId, streamId: this.port.streamId };
  }

  /**
   * Sign what is unsigned, one batch at a time, before a summary goes out. Each batch
   * takes the stream's turn on its own. `chainFor` and `sign` come in as arguments,
   * because this package imports no platform (decision 104).
   */
  async signUnsigned(signer: NearbySigner): Promise<NearbySigned> {
    const out: NearbySigned = { batches: 0, events: 0, unbound: 0, noCertificate: 0, unsafeNumber: false };
    // What is left out never needs reading twice, so a row with no certificate costs one read.
    const walked = { after: null as string | null };
    while (await this.port.exclusive(() => signBatch(this.host, signer, out, walked)));
    return out;
  }

  /** What Have says of this phone: where the server has it and what it counts as received. Moves nothing on the other side but what it sends. */
  async nearbyHave(): Promise<{ cursor: number; claimedSeq: number; vector: NearbyVector }> {
    const { store, orgId, streamId } = this.port;
    const [cursor, claimedSeq, vector] = await Promise.all([store.cursor(orgId, streamId), this.number(this.port.key('nearbyClaimed')), this.vector()]);
    return { cursor, claimedSeq, vector };
  }

  /** The batches this phone holds that the other has not counted, lowest number first per signer. A signer's newest goes even with no rows, so its floor travels on. */
  async nearbyUncounted(them: NearbyVector): Promise<{ key: string; n: number }[]> {
    const keys = await this.port.store.batchKeys(this.port.orgId, this.port.streamId);
    return keys.filter(({ key, n }) => !isCounted(them, key, n)).map(({ key, n }) => ({ key, n }));
  }

  /** One batch as a page: the manifest whole, with the rows still here that it may carry. A confirmed row goes by claim instead. */
  nearbyBatchPage(key: string, n: number): Promise<NearbyBatchPage | null> {
    return batchPageOf(this.host, key, n);
  }

  private isRedactedHere(id: string): boolean {
    return this.port.lang().redactions[id] === true;
  }

  /**
   * The next page of what this phone pulled and the Worker has vouched for, past what the
   * other has been told of, in `serverSeq` order: 200 to a page or 512 KiB. `throughSeq` is
   * where it reached, for the caller to pass as `claimedSeq` next time. Null when no more.
   */
  nearbyNextClaims(them: { cursor: number; claimedSeq: number }): Promise<{ page: NearbyClaimsPage; throughSeq: number } | null> {
    return nextClaimsOf(this.host, them);
  }

  /** This phone's log starts past what the other has been told of, so it cannot send all it knows of, and the screen says so. */
  async nearbyHoldsLess(them: { cursor: number; claimedSeq: number }): Promise<boolean> {
    return ((await this.port.checkpointSeq()) ?? 0) > Math.max(them.cursor, them.claimedSeq);
  }

  /** Authors whose newest stamp on a page was far ahead of this phone's time, for one line on screen, kept as long as this client. */
  get nearbyFarAhead(): readonly { actorId: string; hlc: string }[] {
    return [...this.farAhead].map(([actorId, hlc]) => ({ actorId, hlc }));
  }

  /** A session starts here: the budget is counted once, and added to in memory. */
  async startNearbyBudget(): Promise<void> {
    const use = await this.port.store.nearbyUse(this.port.orgId, this.port.streamId);
    this.useNow = new Map(use.map((u) => [u.who, u]));
  }

  private async overBudget(who: string, events: readonly AnyEvent[], budget: NearbyIntake['budget'], manifestChars = 0): Promise<boolean> {
    if (!this.useNow) await this.startNearbyBudget();
    const use = this.useNow!.get(who) ?? { rows: 0, bytes: 0, manifestBytes: 0 };
    let bytes = use.bytes;
    for (const e of events) {
      // An event too deep to write out spends nothing here: it cannot pass its digest, and this runs before anything has judged it.
      try { bytes += JSON.stringify(e).length; } catch { /* the door's first step */ }
    }
    return use.rows + events.length > budget.maxRows || bytes > budget.maxBytes || (manifestChars > 0 && use.manifestBytes + manifestChars > budget.maxManifestBytes);
  }

  private spend(rows: readonly LocalEvent[]): void {
    for (const l of rows) {
      const who = nearbyBudgetOf(l.event.actorId, l.via);
      const use = this.useNow?.get(who) ?? { who, rows: 0, bytes: 0, manifestBytes: 0 };
      this.useNow?.set(who, { ...use, rows: use.rows + 1, bytes: use.bytes + JSON.stringify(l.event).length });
    }
  }

  private spendManifest(who: string, chars: number): void {
    const use = this.useNow?.get(who) ?? { who, rows: 0, bytes: 0, manifestBytes: 0 };
    this.useNow?.set(who, { ...use, manifestBytes: use.manifestBytes + chars });
  }

  /**
   * Take one page from a teammate (docs/nearby-sync-plan.md 5.4 and 5.12). It takes only
   * part of a pull's path: apply, lines, revision and one commit. Parsing, the budget and
   * every signature come first, outside the stream's turn. Nothing thrown here came from
   * what the page holds: a bad page is a receipt, and only the store can fail.
   */
  async receiveNearby(page: NearbyPage, intake: NearbyIntake): Promise<NearbyReceipt> {
    if (!this.port.loaded()) throw new Error('call load() first');
    this.gate = intake;
    return page.t === 'batch' ? this.receiveBatch(page, intake) : this.receiveClaims(page, intake);
  }

  private async receiveBatch(page: NearbyBatchPage, intake: NearbyIntake): Promise<NearbyReceipt> {
    const { store, orgId, streamId } = this.port;
    // 1.
    const manifest = parseBatchManifest(page.manifest, this.stream());
    if (!manifest) return nearbyDropped('bad manifest');
    const { key, n, floor } = manifest;
    if (isCounted(await this.vector(), key, n)) return { ...nearbyDropped('already counted'), outcome: 'ignored', counted: true };
    // A manifest with no ids is exempt from its budget: only a signer's newest bare one stays, so it costs one row however many come, and its floor must travel.
    if (await this.overBudget(`actor:${manifest.actorId}`, page.events, intake.budget, manifest.events.length > 0 ? page.manifest.length : 0)) return nearbyDropped('over budget', { overBudget: true });
    // 2 to 4.
    const checked = await checkBatchPage(manifest, page, intake, streamId);
    if ('reason' in checked) return nearbyDropped(checked.reason);
    return this.port.exclusive(async () => {
      await this.doorAgainOnce(intake);
      const held = await store.batchesAfter(orgId, streamId, key, n - 1, 2);
      const same = held.find((b) => b.n === n);
      // The first signature for a number stays, and rows under another couldn't be passed on from here.
      if (same && same.manifest !== page.manifest) return nearbyDropped('another manifest holds this number');
      // 5.
      const here = byId(await store.getMany(manifest.events.map(([id]) => id)));
      const people = intake.people(checked.verdict);
      const door = await this.throughDoor(checked.events, here, people, { via: () => ({ batch: n, key }) });
      // 6.
      const folded = await this.foldNearby(door, intake);
      const settled = new Set([...checked.settled, ...door.settled]);
      // 7.
      const counted = await batchIsWhole(manifest, here, settled, this.port.lang(), intake.sha256);
      let vector = await this.vector();
      if (counted) vector = countBatch(vector, key, n, { maxRanges: intake.maxRanges ?? NEARBY_VECTOR_MAX_RANGES });
      vector = applyFloor(vector, key, floor);
      const ownCount = key === intake.ownKey ? await this.number(this.port.key('nearbyCount', key)) : null;
      const isNewest = held.every((b) => b.n <= n);
      const firstHlc = door.rows.reduce<string | null>((low, { event: e }) => (low === null || e.hlc < low ? e.hlc : low), null);
      const bare = folded.rows.length === 0 && isNewest ? await replaceBareManifest(this.host, key, n) : {};
      await this.commitNearby({
        receive: folded.rows,
        events: folded.rejected,
        ...(folded.rows.length > 0 || isNewest ? { batches: [{ orgId, streamId, key, n, deviceId: manifest.deviceId, actorId: manifest.actorId, firstHlc, manifest: page.manifest, sig: page.sig, chain: JSON.stringify(chainAsSigned(page.chain)) }] } : {}),
        ...bare,
        meta: { ...this.port.clockMeta(), ...this.vectorMeta(vector), ...(ownCount !== null && ownCount < n ? { [this.port.key('nearbyCount', key)]: String(n) } : {}), ...bare.meta }
      }, folded);
      if (!same && folded.rows.length > 0) this.spendManifest(`actor:${manifest.actorId}`, page.manifest.length);
      return { outcome: 'taken' as const, kept: folded.rows.length, refused: [...checked.refused, ...door.refused], counted, ...(folded.farAhead ? { farAhead: folded.farAhead } : {}) };
    });
  }

  private async receiveClaims(page: NearbyClaimsPage, intake: NearbyIntake): Promise<NearbyReceipt> {
    const { orgId, streamId } = this.port;
    const attestation = parseAttestation(page.text, { orgId, streamId, kid: page.kid });
    if (!attestation) return nearbyDropped('bad attestation');
    // The claimer's budget, never the author's, so that a flood naming Sam cannot stop Sam's own batches.
    if (await this.overBudget(`claim:${intake.peerKey}`, page.events, intake.budget)) return nearbyDropped('over budget', { overBudget: true });
    const checked = await checkClaimsPage(attestation, page, intake);
    if ('reason' in checked) return nearbyDropped(checked.reason);
    return this.port.exclusive(async () => {
      await this.doorAgainOnce(intake);
      // A row already here stays, whichever way it came: any difference is a clock from before a restamp, and a pull's comparison settles it.
      const here = byId(await this.port.store.getMany(checked.events.map((e) => e.id)));
      const door = await this.throughDoor(checked.events, here, intake.people(), { claim: true, via: (e) => ({ claim: { key: intake.peerKey, seq: checked.seqOf.get(e.id)! } }) });
      const folded = await this.foldNearby(door, intake);
      const claimed = await this.number(this.port.key('nearbyClaimed'));
      await this.commitNearby({
        receive: folded.rows,
        events: folded.rejected,
        meta: { ...this.port.clockMeta(), ...(checked.highest > claimed ? { [this.port.key('nearbyClaimed')]: String(checked.highest) } : {}) }
      }, folded);
      return { outcome: 'taken' as const, kept: folded.rows.length, refused: [...checked.refused, ...door.refused], counted: false, ...(folded.farAhead ? { farAhead: folded.farAhead } : {}) };
    });
  }

  /** Step 5's door, with the facts read per page. A row it refuses is not written, so a flood of refused rows takes no disk. */
  private async throughDoor(candidates: readonly AnyEvent[], here: ReadonlyMap<string, LocalEvent>, people: NearbyPeople, o: { claim?: boolean; via: (e: AnyEvent) => NearbyVia }): Promise<NearbyDoorPass> {
    const { orgId, streamId } = this.port;
    const fresh = candidates.filter((e) => !here.has(e.id));
    const facts = await this.pageFacts(fresh);
    const pass: NearbyDoorPass = { rows: [], refused: [], settled: new Set(), facts };
    for (const e of fresh) {
      // A redaction here holds whichever way the event comes: it is not kept, and it does not hold its batch open.
      if (this.isRedactedHere(e.id)) { pass.settled.add(e.id); continue; }
      const refused = nearbyDoor(e, { orgId, languageId: streamId, people, facts, ...(o.claim ? { claim: true } : {}) });
      if (refused) {
        pass.refused.push({ id: e.id, ...refused });
        if (!refused.retry) pass.settled.add(e.id);
        continue;
      }
      facts.note(e);
      pass.settled.add(e.id);
      // `nearbyCopy` drops `serverSeq` by destructuring: a copy holding one would be skipped by a refold's `after`, even with the field undefined.
      pass.rows.push({ event: nearbyCopy(e), status: 'nearby', via: o.via(e) });
    }
    return pass;
  }

  /** Reads the rows these events' door needs off disk: an event pruned into a checkpoint still answers. */
  private async pageFacts(events: readonly AnyEvent[]): Promise<PageFacts> {
    const rows = new Map<string, unknown>();
    if (this.port.keptOnDisk) {
      const byKind = new Map<string, string[]>();
      for (const e of events) for (const { kind, id } of doorKeptReads(e)) byKind.set(kind, [...(byKind.get(kind) ?? []), id]);
      for (const [kind, ids] of byKind) {
        for (const row of await this.port.store.keptById(this.port.orgId, this.port.streamId, kind, ids)) rows.set(`${kind}\u0000${row.id}`, JSON.parse(row.json));
      }
    }
    return doorFactsOf(this.port.lang(), (kind, id) => rows.get(`${kind}\u0000${id}`));
  }

  /** Step 6 up to its commit: a bounded clock, apply, the undos a late target settles, lines and the revision. */
  private async foldNearby(door: NearbyDoorPass, gate: NearbyGate): Promise<NearbyFolded> {
    const last = this.port.lastStamp();
    const baseline = Math.max(this.port.wall(), last ? decodeHlc(last).wallMs : 0);
    let newest: AnyEvent | null = null;
    const events = door.rows.map((r) => r.event);
    for (const e of events) {
      if (clockCloseEnough(e.hlc, this.port.wall())) this.port.receiveClock(e.hlc);
      if (!newest || e.hlc > newest.hlc) newest = e;
      this.port.apply(e);
    }
    // The door does not refuse a stamp far ahead: its only baseline may be the one that is wrong, and refusing would hold back honest work offline.
    const farAhead = newest && !clockCloseEnough(newest.hlc, baseline) ? { actorId: newest.actorId, hlc: newest.hlc } : undefined;
    if (farAhead) this.farAhead.set(farAhead.actorId, farAhead.hlc);
    const rejected = await this.settleLateUndos(door, gate);
    if (events.length > 0) await this.port.foldedNow(events);
    return { rows: door.rows, rejected, refold: rejected.length > 0, ...(farAhead ? { farAhead } : {}) };
  }

  /**
   * An undo that landed before its target. `earliestUndo` keeps a backdated entry and
   * `withdrawnBy` ignores it, so a wrong one would hold the author's real withdrawal out
   * of the slot. When a target lands and its slot is already held, step 10 runs again over
   * the nearby rows naming it. An ordinary page finds no slot held, and reads nothing. A
   * batch has one author, so an undo on the target's own page is that author's.
   */
  private async settleLateUndos(door: NearbyDoorPass, gate: NearbyGate): Promise<LocalEvent[]> {
    const targets = heldSlotsOf(door.rows.map((r) => r.event), this.port.lang());
    return targets.size === 0 ? [] : this.refuseLateUndos(targets, door.facts, gate, new Set());
  }

  /**
   * Step 10 again over the nearby undos naming these targets, read by target so that a page never
   * makes this phone walk every nearby row under the turn. The server already held a claim's event,
   * and an id in `skip` came with the target, so neither is judged. With no gate seen yet, only a
   * refusal for good is taken: a reason that can change waits for a fold that can answer it.
   */
  private async refuseLateUndos(targets: UndoTargets, facts: DoorFacts, gate: NearbyGate | null, skip: ReadonlySet<string>): Promise<LocalEvent[]> {
    const { store, orgId, streamId } = this.port;
    const ids = [...new Set([...targets.values()].flatMap((set) => [...set]))];
    const peopleOf = gate ? this.peopleFor(gate) : async () => NOBODY;
    const rejected: LocalEvent[] = [];
    for (const l of await store.nearbyUndoing(orgId, streamId, ids)) {
      const e = l.event;
      const target = undoTargetOf(e);
      if (skip.has(e.id) || (l.via && 'claim' in l.via) || target === null || !targets.get(e.type as 'v1.ReviewWithdrawn')?.has(target)) continue;
      const refused = nearbyLookUpRefusal(e, { orgId, languageId: streamId, people: await peopleOf(l.via), facts });
      if (refused && (gate || !refused.retry)) rejected.push({ event: e, status: 'rejected', rejectReason: refused.reason, ...(l.via ? { via: l.via } : {}) });
    }
    return rejected;
  }

  /** The page's one commit. It carries no cursor, because only the server moves a cursor. A commit that fails leaves the fold ahead of the log, so it folds again. */
  private async commitNearby(batch: WriteBatch, folded: NearbyFolded): Promise<void> {
    if (folded.rows.length > 0) batch.meta = { ...batch.meta, [HELD_KEY]: '1' };
    try {
      await this.port.commit(batch);
    } catch (err) {
      await this.port.refold('other');
      throw err;
    }
    if (folded.rows.length > 0) this.phone.held = true;
    this.port.compareFromNow();
    this.spend(folded.rows);
    if (folded.refold) await this.port.refold('other');
  }

  /**
   * Try again on the Sync screen: the door again over refused rows from teammates. Those
   * that pass go back to `nearby`, never to `pending`, because naming this person proves
   * nothing and pending would push a forged event as them. Rows dated after their key's
   * revocation stay out, and so do rows the sweep refused on the server's word. Answers how many came back.
   */
  retryNearby(gate: NearbyGate): Promise<number> {
    this.gate = gate;
    return this.port.exclusive(async () => {
      const { store, orgId, streamId } = this.port;
      const refused = (await store.rejected(orgId, streamId)).filter((l) => !!l.via && !isServerVerdict(l.rejectReason));
      if (refused.length === 0) return 0;
      const facts = await this.pageFacts(refused.map((l) => l.event));
      const peopleOf = this.peopleFor(gate);
      const back: LocalEvent[] = [];
      for (const { event: e, via } of refused) {
        const claim = !!via && 'claim' in via;
        if (via && 'batch' in via && revokedLater(gate.revoked, via.key, e.actorId, e.hlc)) continue;
        if (nearbyDoor(e, { orgId, languageId: streamId, people: await peopleOf(via), facts, ...(claim ? { claim } : {}) })) continue;
        facts.note(e);
        back.push({ event: e, status: 'nearby', ...(via ? { via } : {}) });
      }
      if (back.length === 0) return 0;
      await this.port.commit({ events: back });
      this.useNow = null;
      await this.port.refold('requeue');
      return back.length;
    });
  }

  /**
   * The door again over every nearby row after a new reducer: a type the door passed as
   * unknown (step 8) has rules now. A session calls this once the organization is known,
   * since `people` comes from there. The budget is not asked, so a counted row is not
   * refused for being counted. Answers how many were refused.
   */
  nearbyDoorAgain(gate: NearbyGate): Promise<number> {
    this.gate = gate;
    this.doorChecked = false;
    return this.port.exclusive(() => this.doorAgainOnce(gate));
  }

  private async doorAgainOnce(gate: NearbyGate): Promise<number> {
    if (this.doorChecked) return 0;
    this.doorChecked = true;
    const { store, orgId, streamId } = this.port;
    const stamp = { [this.port.key('nearbyDoorVersion')]: String(this.port.version) };
    if ((await store.meta(this.port.key('nearbyDoorVersion'))) === String(this.port.version)) return 0;
    let refused = 0;
    if ((await store.nearbyCount(orgId, streamId)) > 0) {
      // Each row is in the fold, so the fold cannot say whether another event took its slot. The log can: what the server or this phone wrote holds it, then the earliest stamp.
      const holders = new Map<string, LocalEvent>();
      for (let after: string | null = null; ;) {
        const page: LocalEvent[] = await store.page(orgId, streamId, after, LOG_PAGE);
        for (const l of page) {
          const entity = validateEvent(l.event) === null ? entityKeyOf(l.event) : null;
          if (entity === null) continue;
          const held = holders.get(entity);
          const ahead = held && (held.status !== 'nearby') !== (l.status !== 'nearby') ? l.status !== 'nearby' : !held || l.event.hlc < held.event.hlc;
          if (ahead) holders.set(entity, l);
        }
        if (page.length < LOG_PAGE) break;
        after = page[page.length - 1]!.event.id;
      }
      const peopleOf = this.peopleFor(gate);
      for (let after: string | null = null; ;) {
        const page: LocalEvent[] = await store.nearbyPage(orgId, streamId, after, LOG_PAGE);
        const base = await this.pageFacts(page.map((l) => l.event));
        const rejected: LocalEvent[] = [];
        for (const { event: e, via } of page) {
          const facts = { ...base, entityTaken: (entity: string) => (holders.get(entity)?.event.id ?? e.id) !== e.id };
          const refusal = nearbyDoor(e, { orgId, languageId: streamId, people: await peopleOf(via), facts, ...(via && 'claim' in via ? { claim: true } : {}) });
          if (refusal) rejected.push({ event: e, status: 'rejected', rejectReason: refusal.reason, ...(via ? { via } : {}) });
        }
        refused += rejected.length;
        await this.port.commit({ events: rejected });
        if (page.length < LOG_PAGE) break;
        after = page[page.length - 1]!.event.id;
      }
    }
    await this.port.commit({ meta: stamp });
    if (refused > 0) {
      this.useNow = null;
      await this.port.refold('other');
    }
    return refused;
  }

  /**
   * Who may do what, for a row already here, as when its batch arrived: the chain kept with that batch,
   * checked again the same way (no expiry, and naming the batch's signer), decides with the fold, so a
   * row a certificate newer than the fold let in is not refused for it later. A claim, a row whose batch
   * is gone, or a gate with nothing to check a chain with goes by the fold. One check per batch.
   */
  private peopleFor(gate: NearbyGate): (via: NearbyVia | undefined) => Promise<NearbyPeople> {
    let plain: NearbyPeople | null = null;
    const byFold = () => (plain ??= gate.people());
    const byBatch = new Map<string, Promise<NearbyPeople>>();
    const { rootKeys, verify, sha256 } = gate;
    return async (via) => {
      if (!via || !('batch' in via) || !rootKeys || !verify || !sha256) return byFold();
      const at = `${via.key} ${via.batch}`;
      let people = byBatch.get(at);
      if (!people) {
        people = (async () => {
          const { store, orgId, streamId } = this.port;
          const [row] = await store.batchesAfter(orgId, streamId, via.key, via.batch - 1, 1);
          if (row?.n !== via.batch) return byFold();
          try {
            const verdict = await checkChain(JSON.parse(row.chain), { rootKeys, orgId, languageId: streamId, now: null, verify, sha256 });
            const named = verdict.ok && verdict.holder.installKey === row.key && verdict.holder.deviceId === row.deviceId && verdict.holder.profileId === row.actorId;
            return named ? gate.people(verdict) : byFold();
          } catch {
            return byFold();
          }
        })();
        byBatch.set(at, people);
      }
      return people;
    };
  }

  /** A newer revocation list reaches rows already taken: those dated after their key's revocation are refused. Answers how many. */
  nearbyApplyRevoked(list: RevocationList): Promise<number> {
    return this.port.exclusive(async () => {
      const refused = await applyRevocationList(this.host, list);
      if (refused > 0) this.useNow = null;
      return refused;
    });
  }

  /** One of a session's rows in device meta (`nearbyKeep.ts`). */
  async nearbyMeta(key: string): Promise<string | null> {
    return (await this.port.store.meta(key)) ?? null;
  }

  /** Only rows of nearby's own, in one commit under the stream's turn. A teammate's words never reach a cursor. */
  writeNearbyMeta(rows: Record<string, string>): Promise<void> {
    if (!Object.keys(rows).every((key) => key.startsWith('nearby'))) throw new Error('not a nearby row');
    return this.port.exclusive(() => this.port.commit({ meta: rows }));
  }

  /** This phone's time, for Hello's clock warning. */
  get nearbyWallNow(): number {
    return this.port.wall();
  }

  /** What Hello checks a certificate against: `HlcClock.last` never goes back, so setting the date back does not revive one. */
  get nearbyHelloNow(): number {
    const last = this.port.lastStamp();
    return Math.max(this.port.wall(), last ? decodeHlc(last).wallMs : 0);
  }

  /** Push, pull, then attest and sweep (docs/nearby-sync-plan.md section 6); the sweep and what it settles wait until nothing more is to pull. */
  async afterSync(morePull: boolean): Promise<void> {
    await this.settleMoved();
    await attestNearby(this.host);
    if (morePull) return;
    this.useNow = null;
    await sweepNearby(this.host);
    await settleBatches(this.host);
  }

  async holdsAny(): Promise<boolean> {
    this.phone.held ??= !!(await this.port.store.meta(HELD_KEY));
    return this.phone.held;
  }

  async pulled(page: readonly AnyEvent[], here: ReadonlyMap<string, LocalEvent>): Promise<{ events: LocalEvent[]; meta: Record<string, string> }> {
    const meta: Record<string, string> = {};
    // `events.id` is unique across streams: the store moves such a row here whole, and the language it left must fold without it.
    const moved = new Map<string, AnyEvent[]>();
    for (const e of page) {
      const was = here.get(e.id)?.event;
      if (!was || (was.orgId === this.port.orgId && was.streamId === this.port.streamId)) continue;
      const key = movedKey(was.orgId, was.streamId);
      moved.set(key, [...(moved.get(key) ?? []), was]);
    }
    for (const [key, events] of moved) meta[key] = JSON.stringify([...movedOf(await this.port.store.meta(key)), ...events]);
    // A target arriving from the server whose slot a nearby undo holds: step 10 again, as a page from a teammate would run it.
    const targets = heldSlotsOf(page, this.port.lang());
    if (targets.size === 0) return { events: [], meta };
    const facts = doorFactsOf(this.port.lang(), () => undefined);
    for (const e of page) facts.note(e);
    return { events: await this.refuseLateUndos(targets, facts, this.gate, new Set(page.map((e) => e.id))), meta };
  }

  async filled(rows: readonly KeptRecord[]): Promise<LocalEvent[]> {
    const lang = this.port.lang();
    const targets: UndoTargets = new Map();
    const values = new Map<string, unknown>();
    const slot = { review: ['v1.ReviewWithdrawn', lang.withdrawnReviews], note: ['v1.NoteWithdrawn', lang.withdrawnNotes], departure: ['v1.DepartureUndone', lang.undoneDepartures] } as const;
    for (const r of rows) {
      if (!hasOwn(slot, r.kind)) continue;
      const [type, held] = slot[r.kind as keyof typeof slot];
      if (!hasOwn(held, r.id)) continue;
      targets.set(type, (targets.get(type) ?? new Set()).add(r.id));
      values.set(`${r.kind}\u0000${r.id}`, JSON.parse(r.json));
    }
    if (targets.size === 0) return [];
    // The rows being kept stand for the targets: they are what the door's facts would read off disk after this commit.
    return this.refuseLateUndos(targets, doorFactsOf(lang, (kind, id) => values.get(`${kind}\u0000${id}`)), this.gate, new Set());
  }

  /**
   * Rows of this language that a pull in another took, because the server holds their ids there:
   * their lines are owed while the fold can still place them, and the fold then leaves them out.
   */
  private async settleMoved(): Promise<void> {
    if (!(await this.holdsAny())) return;
    const key = movedKey(this.port.orgId, this.port.streamId);
    const events = movedOf(await this.port.store.meta(key));
    if (events.length === 0) return;
    this.port.touched(events);
    await this.port.commit({ meta: { [key]: '' } });
    this.useNow = null;
    await this.port.refold();
  }
}
