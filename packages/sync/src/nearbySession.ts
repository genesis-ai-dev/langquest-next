import { CLOCK_AHEAD_TOLERANCE_MS, LINES_VERSION, NEARBY_PROTOCOL, pickProtocol, REDUCER_VERSION } from '@langquest-next/core';
import {
  base64urlEncode, checkChain, handedKeyHolds, issueInviteLink, joinPictures, newcomerProfileId, type JoinPass, type WorkerLink, holdingsFilesHash, holdingsText, isBase64url, mergeHoldings, NEARBY_BUDGET, NEARBY_HOLDINGS_MAX_FILES, NEARBY_OPENING_BYTES, nearbyBytes, parseRevocationList, proofText, signedBy, summaryOf, summaryText, withMyHolding, type ChainLink, type ChainVerdict, type DiscoveryKey, type HoldingEntry, type Holdings, type RevocationList, type WantedFile
} from '@langquest-next/core/nearby';
import { chainAsSigned, type NearbyGate, type NearbyIntake, type NearbyPage, type NearbyReceipt, type NearbySigned, type NearbySigner } from './nearbyIntake';
import { nearbyCodeOf, type NearbyDiagCode } from './nearbyDiag';
import type { NearbyKeep } from './nearbyKeep';
import { CopyRefused, StartingCopySender, takeStartingCopy, type CopyAsker, type CopyNoReason, type NearbyCopySource, type StartingCopyTaken, type StartingCopyTarget } from './nearbyCopy';
import type { HostDetails, HostOptions, NearbyCrypto, NearbyLink, NearbyRadio } from './nearbyLink';
import { attemptKeysOf, checkOpeningI, checkOpeningR, findTagOf, makeOpeningI, makeOpeningR, openingKeyOf, openingPinOf, sameBytes, sessionKeysOf, type NearbySessionKeys } from './nearbyOpening';
import { encodeMessage, NEARBY_HOLDINGS_MESSAGE_FILES, parseMessage, type Message } from './nearbyWire';
import { OfflineError } from './types';

/**
 * One talk between two phones, over any `NearbyLink` (docs/nearby-sync-plan.md 5.3, 5.12).
 *
 * A nearby phone is not a server, so nothing here confirms anything or moves a cursor, and
 * everything off the link is hostile. Each direction streams at once and nothing waits for
 * an acknowledgement: what a side sends and what it reads are never one task, so two phones
 * that both fill their queues still drain each other. A page commits whole, one at a time,
 * through the port, and the link is never awaited inside the stream's turn because this file
 * cannot reach it. A dropped link anywhere is a clean end, and the next session resumes from
 * the vector. `run` never rejects: everything a screen needs comes back as plain data.
 */

export type NearbyRole = 'i' | 'r';
export type Radios = Extract<Message, { t: 'arrange' }>['radios'];
export type ByeReason = Extract<Message, { t: 'bye' }>['reason'];
type HelloMessage = Extract<Message, { t: 'hello' }>;
type HaveMessage = Extract<Message, { t: 'have' }>;
type HoldingsMessage = Extract<Message, { t: 'holdings' }>;
type HostKind = Extract<Message, { t: 'host' }>['kind'];

/** Exactly what a session uses of `SyncClient`. It holds no store handle. */
export interface NearbySessionPort {
  signUnsigned(signer: NearbySigner): Promise<NearbySigned>;
  nearbyHave(): Promise<{ cursor: number; claimedSeq: number; vector: HaveMessage['vector'] }>;
  nearbyUncounted(them: HaveMessage['vector']): Promise<{ key: string; n: number }[]>;
  nearbyBatchPage(key: string, n: number): Promise<Extract<NearbyPage, { t: 'batch' }> | null>;
  nearbyNextClaims(them: { cursor: number; claimedSeq: number }): Promise<{ page: Extract<NearbyPage, { t: 'claims' }>; throughSeq: number } | null>;
  nearbyHoldsLess(them: { cursor: number; claimedSeq: number }): Promise<boolean>;
  receiveNearby(page: NearbyPage, intake: NearbyIntake): Promise<NearbyReceipt>;
  startNearbyBudget(): Promise<void>;
  nearbyDoorAgain(gate: NearbyGate): Promise<number>;
  nearbyApplyRevoked(list: RevocationList): Promise<number>;
  readonly nearbyWallNow: number;
  readonly nearbyHelloNow: number;
  readonly nearbyFarAhead: readonly { actorId: string; hlc: string }[];
}

/** The app's file store and ledger, which this package cannot reach (decision 104). */
export interface NearbyFileMoves {
  /** What this phone would take now, in the order of section 5.6 (`wantedFilesOf`), leaving out what it holds. Asked after the events, so it sees the new fold. */
  wanted(holdings: Holdings): Promise<readonly WantedFile[]>;
  /** A teammate's ask: only a file referenced in this language and not redacted. */
  serveFile(file: { hash: string; format: string }): Promise<{ uri: string; size: number } | { no: 'not-here' | 'not-referenced' | 'redacted' }>;
  /** Where a file lands and the room it may take, after level 1 gave way. Null when taking it would leave too little free: this phone stops asking, and the screen says so. */
  fetchFile(file: WantedFile): Promise<{ stagingUri: string; maxBytes: number; minFreeBytes: number } | null>;
  /** Its hash matched: rename it and mark it. */
  landed(file: WantedFile, stagingUri: string, size: number): Promise<void>;
  discard(stagingUri: string): Promise<void>;
  /** Unconfirmed files this phone holds, for its own holdings entry. */
  held(): Promise<readonly string[]>;
  /** With "Hold teammates' recordings" off, what no longer needs keeping (`nearbyShedOf`), before this phone's own entry goes. */
  shed?(holdings: Holdings): Promise<void>;
  /** Whether this phone's "Hold teammates' recordings" row is on, signed into its own entry. Absent means off, which lets no teammate shed a file for its sake. */
  holds?(): boolean;
  /** Moves the files through the language session's nearby worker (`nearbyFiles`); absent, the session fetches them one by one itself. */
  take?(job: NearbyFetchJob): Promise<{ noRoom: boolean }>;
}

/** The files a session would take from its partner now, in order, and how to move one over its link. */
export interface NearbyFetchJob {
  list: readonly WantedFile[];
  /** One file over this session's link: rejects only when the link or the session ended. */
  fetch(file: WantedFile, stage: { stagingUri: string; maxBytes: number; minFreeBytes: number }): Promise<void>;
  linkUp(): boolean;
  /** Asked before each file: true stops the job (backups cut for a teammate waiting, section 5.11). */
  stop(file: WantedFile): boolean;
}

export interface NearbyGenerations {
  /** The generation of the key this session opened with. */
  sessionGen: number;
  /** This phone's entry for the language. */
  mine(): DiscoveryKey & { direct: boolean; certOrgSeq: number };
  orgSeqHere(): number;
  /** A hand-on that held: written at once. The session stays on the keys it opened with. */
  keep(handed: DiscoveryKey): Promise<void>;
}

export interface NearbyArrangeOptions {
  radio: Pick<NearbyRadio, 'host' | 'join'>;
  radios: Radios;
  /** Tried in this order, then the pipe. */
  order?: readonly Exclude<HostKind, 'bluetooth'>[];
}

export interface NearbySessionTunables {
  /** A stranger gets silence, then a close at a random moment in this range. */
  openCloseMinMs: number;
  openCloseMaxMs: number;
  /** For the initiator: no reply by now counts as `busy` in `NearbyRoom`. */
  replyMs: number;
  /** No message moved either way for this long ends the session. */
  stallMs: number;
  /** The same while a file is moving, for which a link says nothing until it ends. */
  fileStallMs: number;
  /** Dropped pages in one session before `bye` with `busy`. */
  busyAfterDrops: number;
  /** Backups stop after this when another teammate was waiting. */
  backupLimitMs: number;
  /** How long each kind of Wi-Fi gets. */
  attemptMs: number;
  /** How long a last `bye` may hold the link open. */
  byeMs: number;
  /** A hand-on's jump, at most. */
  handOnMaxSteps: number;
  /** On a QR link, from Hello to the grant: the ask and the inviter's tap. */
  joinTapMs: number;
}

export const NEARBY_SESSION_DEFAULTS: NearbySessionTunables = {
  openCloseMinMs: 2_000, openCloseMaxMs: 6_000, replyMs: 8_000, stallMs: 60_000, fileStallMs: 600_000, busyAfterDrops: 36, backupLimitMs: 120_000, attemptMs: 30_000, byeMs: 2_000, handOnMaxSteps: 1_000, joinTapMs: 180_000
};

export interface NearbySessionOptions {
  role: NearbyRole;
  link: NearbyLink;
  crypto: NearbyCrypto;
  orgId: string;
  languageId: string;
  deviceId: string;
  /** This phone's certificate for this organization and no other. */
  chain: ChainLink[];
  signer: NearbySigner;
  rootKeys: ReadonlyMap<string, string>;
  /** The door's lookup. Hello's read gate and every page ask it. */
  gate: Pick<NearbyGate, 'people'>;
  port: NearbySessionPort;
  keep: NearbyKeep;
  files?: NearbyFileMoves;
  opening: {
    kSess: Uint8Array;
    /** The responder's advert salt. */
    salt: Uint8Array;
    kFind: Uint8Array;
    /** The responder's nonces under this salt, shared across connections. A repeat is a stranger. */
    seen?: Set<string>;
    /** A QR link's inviter: the ephemeral key and nonce its code's pin was worked out from (`drawOpening`). */
    drawn?: { nonce: Uint8Array; eph: { secret: Uint8Array; public: Uint8Array } };
    /** A QR link's newcomer: the code's pin (`openingPinOf`). An opening that does not match it gets silence. */
    pin?: Uint8Array;
  };
  generations?: NearbyGenerations;
  /** The initiator connected under a generation below its newest: it holds back its `hello`. */
  older?: boolean;
  /** The tag heard in the advert: a phone whose chain works out to another is not who it seemed. */
  heardTag?: string;
  arrange?: NearbyArrangeOptions;
  time: { now(): number; sleep(ms: number): Promise<void> };
  tunables?: Partial<NearbySessionTunables>;
  budget?: NearbyIntake['budget'];
  maxRanges?: number;
  /** True when a teammate was seen waiting before this session began, so backups may be cut. */
  otherWaiting?: () => boolean;
  /** The opening passed. False: this phone is busy, so it says so, sealed, and ends. Nothing before this point holds the phone. */
  onOpened?: () => boolean;
  /** Anything moved, for a progress line. */
  onProgress?: (report: Readonly<NearbySessionReport>) => void;
  /**
   * Phase 6, Let someone in (docs/nearby-sync-plan.md 14.1, 3): this phone's side of a link a QR
   * code started, where Hello carries no chain, proof or device id from either side.
   */
  join?: NearbyJoinInviter | NearbyJoinNewcomer;
  /** Phase 6: this phone sends a starting copy from these (`starting-copy` in Hello's `can`), to whoever passed its read gate. */
  copy?: NearbyCopySource;
  /** Phase 6: this phone holds a starting copy not yet whole, and asks a teammate on the same versions for the rest after Hello. */
  takeCopy?: Omit<StartingCopyTarget, 'sha256'>;
}

/** The inviter's side of a QR link (`let-in`). Its `chain` is its certificate for the session's organization. */
export interface NearbyJoinInviter {
  as: 'inviter';
  /** This phone's pass for the session's language. */
  pass: JoinPass;
  /** The newest discovery key of the language, its generation and `floor`, which the grant hands on. */
  discovery: { key: string; gen: number; floor: number };
  /** The one tap, "Let Nyibol in?", beside the two pictures: the chosen role, or null for No. */
  tap(who: { name: string; profileId: string; pictures: [number, number] }): Promise<string | null>;
  /** Why the pass no longer lets anyone in under this role by this phone's fold (`joinPassStop`), or null. */
  stop?(roleId: string): string | null;
}

/**
 * The newcomer's side of a QR link. Its `crypto` is the install key just made, and its `chain` is
 * empty. A QR code names no organization, so a newcomer may pass `orgId` and `languageId` as '',
 * and the grant's pass then says which; the chain is checked against those as against any other.
 */
export interface NearbyJoinNewcomer {
  as: 'newcomer';
  idSalt: string;
  /** `newcomerProfileId(installKey, idSalt)`, kept with the join's progress. */
  profileId: string;
  name: string;
  /** The two pictures, to show beside the inviter's. */
  pictures?(pictures: [number, number]): void;
  /**
   * The grant checked: the chain, the discovery key, its generation and `floor`, and the
   * organization and language it is for. Only now may the key be stored. It may answer where the
   * starting copy goes, for a phone that could not know before the grant.
   */
  granted(grant: {
    chain: ChainLink[]; verdict: Extract<ChainVerdict, { ok: true }>; discovery: { key: string; gen: number; floor: number }; orgId: string; languageId: string;
  }): Promise<Omit<StartingCopyTarget, 'sha256'> | void>;
  /** Where the starting copy goes, over this link once granted, unless `granted` answers one. */
  target?: Omit<StartingCopyTarget, 'sha256'>;
}

/**
 * The port and keep a newcomer's QR session runs on before it has any stream: a join reads only
 * the clock from its port and the revocation list (none) from its keep, and never reaches the
 * rest, which refuse. The starting copy goes through the target `granted` answers.
 */
export function joinOnlyPort(now: () => number): NearbySessionPort {
  const no = (): Promise<never> => Promise.reject(new Error('a join reads no stream'));
  return {
    signUnsigned: no, nearbyHave: no, nearbyUncounted: no, nearbyBatchPage: no, nearbyNextClaims: no, nearbyHoldsLess: no, receiveNearby: no,
    startNearbyBudget: no, nearbyDoorAgain: no, nearbyApplyRevoked: no,
    get nearbyWallNow() { return now(); },
    get nearbyHelloNow() { return now(); },
    nearbyFarAhead: []
  };
}

export function joinOnlyKeep(): NearbyKeep {
  const no = (): Promise<never> => Promise.reject(new Error('a join keeps nothing'));
  return { holdings: no, saveHoldings: no, revoked: async () => null, saveRevoked: no, noteName: async () => undefined, peers: async () => [], recordPeer: no };
}

export type NearbySessionEnd =
  | { how: 'done' }
  /** Before any message: an opening that did not check, on either side. Nothing was said. */
  | { how: 'silent' }
  /** The initiator's opening drew no reply by the deadline. */
  | { how: 'no-answer' }
  | { how: 'said'; reason: ByeReason; detail?: string }
  | { how: 'heard'; reason: ByeReason }
  | { how: 'dropped' }
  | { how: 'stalled' }
  /** The port failed, not the teammate: only the store can throw here. */
  | { how: 'failed'; error: string };

/** Plain data for the screen. */
export interface NearbySessionReport {
  role: NearbyRole;
  ended: NearbySessionEnd;
  /** Who was met; `name` only from a two-link chain, which names someone let in offline before the server knows them (14.1, 5, "Teammates"). */
  peer: { installKey: string; profileId: string; deviceId: string; tag: string; name?: string } | null;
  /** The tag worked out from a chain that checked, when the read gate or the tag heard then refused it: the room does not pick that phone again. */
  refusedTag: string | null;
  /** Their hello said a range this build shares nothing with: get a newer app from a teammate or the store. */
  newerAppNeeded: boolean;
  /** Their clock and this phone's differ by over five minutes. */
  clockOff: boolean;
  /** The link that moved the work. */
  linkKind: NearbyLink['kind'] | null;
  /** Attempts in the plan moved past before the link that held, or before it ended (`arrangePlan`). */
  fallbacks: number;
  /** The nearby module's code on the error it ended on, for diagnostics; null for any other end. */
  code: NearbyDiagCode | null;
  signed: NearbySigned | null;
  got: { pages: number; events: number; refused: number; droppedPages: number; overBudget: number; counted: number };
  sent: { batches: number; claims: number; events: number; skipped: number };
  files: { got: number; served: number; answeredNo: number; toldNo: number; failed: number; noRoom: boolean; cutBackups: boolean };
  holdings: { taken: number; dropped: number; sent: number };
  /** A sender said it could not send all it knows of: older work will come from the server. */
  older: boolean;
  farAhead: readonly { actorId: string; hlc: string }[];
  /** A newer generation came and held. The room restarts Find when this ends. */
  handedKey: DiscoveryKey | null;
  handedKeyRefused: number;
  revokedTaken: number | null;
  revokedDropped: number;
  /** Both final summaries, when it ended with `done`. */
  finals: { mine: string; theirs: string } | null;
  /** A verified session committed events or files: the room's idle clock restarts on this and nothing else. */
  changed: boolean;
  /** On a QR link: the two pictures, whether the grant went or came, and why not. */
  join: { pictures: [number, number] | null; granted: boolean; refused: string | null } | null;
  /** The two phones run another reducer or lines version: no starting copy moves, and the screen names the file needed. */
  versionsDiffer: boolean;
  /** What this phone took of a starting copy, and why a teammate gave no more. */
  copy: StartingCopyTaken | null;
  copyRefused: string | null;
  /** Parts of a starting copy this phone sent, asks it answered with `copy-no`, and why it gave no organization or language, which leaves the copy short. */
  copyServed: { parts: number; no: number; stateRefused: CopyNoReason | null };
}

const emptyReport = (role: NearbyRole): NearbySessionReport => ({
  role, ended: { how: 'dropped' }, peer: null, refusedTag: null, newerAppNeeded: false, clockOff: false, linkKind: null, fallbacks: 0, code: null, signed: null,
  got: { pages: 0, events: 0, refused: 0, droppedPages: 0, overBudget: 0, counted: 0 },
  sent: { batches: 0, claims: 0, events: 0, skipped: 0 },
  files: { got: 0, served: 0, answeredNo: 0, toldNo: 0, failed: 0, noRoom: false, cutBackups: false },
  holdings: { taken: 0, dropped: 0, sent: 0 },
  older: false, farAhead: [], handedKey: null, handedKeyRefused: 0, revokedTaken: null, revokedDropped: 0, finals: null, changed: false,
  join: null, versionsDiffer: false, copy: null, copyRefused: null, copyServed: { parts: 0, no: 0, stateRefused: null }
});

/** Who hosts what, in the order tried, ending with the pipe (5.12, The short Bluetooth exchange). Both sides work this out from `arrange`, so they agree. */
export interface NearbyAttempt {
  kind: HostKind;
  host: NearbyRole;
  band5: boolean;
}

export function arrangePlan(i: Radios, r: Radios, order: readonly Exclude<HostKind, 'bluetooth'>[] = ['wifi-direct', 'hotspot']): NearbyAttempt[] {
  const plan: NearbyAttempt[] = [];
  for (const kind of order) {
    if (kind === 'wifi-direct') {
      if (!i.directByName || !r.directByName) continue;
      // 5 GHz only when both report it, then any band.
      if (i.band5 && r.band5) plan.push({ kind, host: 'r', band5: true });
      plan.push({ kind, host: 'r', band5: false });
    } else if (r.hotspot && i.joinHotspot) plan.push({ kind, host: 'r', band5: false });
    else if (i.hotspot && r.joinHotspot) plan.push({ kind, host: 'i', band5: false });
  }
  // The GATT server speaks last, so a pipe always carries on on both sides.
  plan.push({ kind: 'bluetooth', host: 'r', band5: false });
  return plan;
}

/** The hand-on's three conditions: from a key the server gave, above the session's, and from a phone that has seen what made it. */
export function mayHandOn(mine: { gen: number; direct: boolean; certOrgSeq: number }, sessionGen: number, orgSeqHere: number): boolean {
  return mine.direct && mine.gen > sessionGen && orgSeqHere >= mine.certOrgSeq;
}

/** Android's usual form, fresh for each group, so that a group's name does not stand out. */
export function wifiDirectOptions(crypto: Pick<NearbyCrypto, 'randomBytes'>, band5: boolean): HostOptions {
  const word = (size: number, letters: string) => [...crypto.randomBytes(size)].map((b) => letters[b % letters.length]!).join('');
  const alnum = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return { ssid: `DIRECT-${word(2, alnum)}-Android_${word(4, 'abcdef0123456789')}`, passphrase: base64urlEncode(crypto.randomBytes(16)), band5 };
}

/** What a `host` message carries: the radio's answer without its link, or the message without its `t`. */
function hostDetailsOf(h: HostDetails): HostDetails {
  const out: HostDetails = { kind: h.kind };
  if (h.ssid !== undefined) out.ssid = h.ssid;
  if (h.passphrase !== undefined) out.passphrase = h.passphrase;
  if (h.port !== undefined) out.port = h.port;
  if (h.band !== undefined) out.band = h.band;
  if (h.security !== undefined) out.security = h.security;
  return out;
}

/** The other phone said goodbye. */
class HeardBye extends Error {
  constructor(readonly reason: ByeReason) {
    super(reason);
  }
}

/** This phone ends it, with this reason. */
class SayBye extends Error {
  constructor(readonly reason: ByeReason, readonly detail?: string) {
    super(reason);
  }
}

/** Phase 6's messages, each read only by a phone in the part that uses it, and otherwise as a message it does not know. */
const JOIN_MESSAGES: ReadonlySet<Message['t']> = new Set<Message['t']>(['join-ask', 'join-grant']);
const COPY_ANSWERS: ReadonlySet<Message['t']> = new Set<Message['t']>(['copy-part', 'copy-no']);

const isDrop = (err: unknown) => err instanceof OfflineError;

/** The organization and language a grant's invite link names through its pass, before the chain is checked; null when it has none. */
function grantPassOf(chain: readonly ChainLink[]): { orgId: string; languageId: string } | null {
  const body = (chain[1] as { kind?: unknown; body?: { pass?: { body?: { orgId?: unknown; languageId?: unknown } } } } | undefined);
  const pass = body?.kind === 'invite@1' ? body.body?.pass?.body : undefined;
  return pass && typeof pass.orgId === 'string' && typeof pass.languageId === 'string' ? { orgId: pass.orgId, languageId: pass.languageId } : null;
}
const nameOf = (err: unknown) => (err instanceof Error ? err.name : 'non-error');

export class NearbySession {
  private readonly opt: NearbySessionOptions;
  private readonly tune: NearbySessionTunables;
  private readonly crypto: NearbyCrypto;
  private readonly report: NearbySessionReport;
  private link: NearbyLink;
  private keys: NearbySessionKeys | null = null;
  private secured = false;
  private over = false;
  private stopped = false;
  private stalled = false;
  private haveDone = false;
  private arranged = false;
  private reading: Promise<Message> | null = null;
  private lastMoved = 0;
  /** Local work and files say nothing while they run, so the stall clock waits. */
  private localWork = 0;
  private moving = 0;
  private verdict: Extract<ChainVerdict, { ok: true }> | null = null;
  private revoked: { signed: { text: string; kid: string; sig: string }; list: RevocationList } | null = null;
  private holdings: Holdings = new Map();
  private readonly fileNos = new Map<string, (reason: string) => void>();
  /** A message read while waiting on a copy's answer, kept for the step it belongs to. */
  private readonly stash: Message[] = [];
  private sender: StartingCopySender | null = null;

  constructor(options: NearbySessionOptions) {
    this.opt = options;
    this.tune = { ...NEARBY_SESSION_DEFAULTS, ...options.tunables };
    this.crypto = options.crypto;
    this.link = options.link;
    this.report = emptyReport(options.role);
  }

  /** Ends with `bye` `stopped` where anything can be said, and the next session resumes from the vector. */
  stop(): void {
    if (this.over || this.stopped) return;
    this.stopped = true;
    void this.lastWords('stopped');
  }

  async run(): Promise<NearbySessionReport> {
    try {
      if (await this.open()) {
        void this.watch();
        await this.steps();
        this.report.ended = { how: 'done' };
      }
    } catch (err) {
      await this.settle(err);
    } finally {
      this.over = true;
      this.report.farAhead = [...this.opt.port.nearbyFarAhead];
      await this.closeQuietly(this.link);
    }
    return this.report;
  }

  private async steps(): Promise<void> {
    if (this.opt.join) return this.joinSteps(this.opt.join);
    await this.hello();
    await this.prepare();
    await this.arrange();
    // Phase 6: a copy asked of a teammate after an ordinary Hello comes between steps 2 and 4.
    this.report.linkKind = this.link.kind;
    await this.askCopy();
    const moveFiles = this.movesFiles();
    const them = await this.have();
    if (moveFiles) await this.holdingsStep(them);
    await this.eventsStep(them);
    if (moveFiles) await this.filesStep();
    await this.doneStep(moveFiles);
  }

  /** Both sides work this out alike: the link, and what both said in `can`. */
  private movesFiles(): boolean {
    return this.link.canMoveFiles && !!this.opt.files && !!this.theirHello?.can.includes('files');
  }

  private async settle(err: unknown): Promise<void> {
    this.report.code = nearbyCodeOf(err) ?? null;
    if (err instanceof HeardBye) {
      // On a QR link the newcomer ends the copy with `bye` `done`: the inviter's side is done too.
      this.report.ended = err.reason === 'done' && this.report.join?.granted ? { how: 'done' } : { how: 'heard', reason: err.reason };
    } else if (err instanceof SayBye) {
      this.report.ended = { how: 'said', reason: err.reason, ...(err.detail ? { detail: err.detail } : {}) };
      await this.lastWords(err.reason);
    } else if (this.stalled) {
      this.report.ended = { how: 'stalled' };
    } else if (this.stopped) {
      this.report.ended = { how: 'said', reason: 'stopped' };
    } else if (isDrop(err)) {
      this.report.ended = (await this.lateBye()) ?? { how: 'dropped' };
    } else {
      this.report.ended = { how: 'failed', error: nameOf(err) };
      await this.lastWords('stopped');
    }
  }

  /** A link that went while this side was sending may still hold the other's last word, such as `busy`. */
  private async lateBye(): Promise<NearbySessionEnd | null> {
    if (!this.secured) return null;
    const heard = (async (): Promise<NearbySessionEnd | null> => {
      try {
        for (;;) await this.take();
      } catch (err) {
        return err instanceof HeardBye ? { how: 'heard', reason: err.reason } : null;
      }
    })();
    return Promise.race([heard, this.opt.time.sleep(this.tune.byeMs).then(() => null)]);
  }

  private async lastWords(reason: ByeReason): Promise<void> {
    if (this.secured) {
      // A full queue must not hold the link open: the teammate's own stall deadline covers one who stops reading.
      await Promise.race([this.link.send(encodeMessage({ t: 'bye', reason })).catch(() => undefined), this.opt.time.sleep(this.tune.byeMs)]);
    }
    await this.closeQuietly(this.link);
  }

  private async closeQuietly(link: NearbyLink): Promise<void> {
    await link.close().catch(() => undefined);
  }

  private moved(): void {
    this.lastMoved = this.opt.time.now();
    this.opt.onProgress?.(this.report);
  }

  /** No timer of its own: only what `time` gives, so the fleet runs it on simulated time. */
  private async watch(): Promise<void> {
    this.lastMoved = this.opt.time.now();
    while (!this.over) {
      await this.opt.time.sleep(this.tune.stallMs);
      if (this.over) return;
      if (this.localWork > 0) continue;
      if (this.opt.time.now() - this.lastMoved >= (this.moving > 0 ? this.tune.fileStallMs : this.tune.stallMs)) {
        this.stalled = true;
        await this.closeQuietly(this.link);
        return;
      }
    }
  }

  private async local<T>(work: () => Promise<T>): Promise<T> {
    this.localWork += 1;
    try {
      return await work();
    } finally {
      this.localWork -= 1;
      this.moved();
    }
  }

  // ---- step 1: the opening -----------------------------------------------------

  /** True once both sides have proved they hold `kSess`. A phone that has not says nothing at all. */
  private async open(): Promise<boolean> {
    const opened = this.opt.role === 'i' ? await this.openAsInitiator() : await this.openAsResponder();
    if (!opened) return false;
    const { first } = opened;
    await this.link.secure(this.opt.role === 'i' ? { send: first.iToR, receive: first.rToI } : { send: first.rToI, receive: first.iToR });
    this.secured = true;
    this.keys = opened;
    if (this.opt.onOpened && !this.opt.onOpened()) throw new SayBye('busy');
    return true;
  }

  private async openAsInitiator(): Promise<NearbySessionKeys | null> {
    const { kSess, salt } = this.opt.opening;
    const kOpen = openingKeyOf(this.crypto, kSess);
    const mine = makeOpeningI(this.crypto, kOpen, salt);
    await this.link.sendOpening(mine.bytes);
    const reply = await this.link.receiveOpening(NEARBY_OPENING_BYTES, this.tune.replyMs);
    if (reply === null) {
      this.report.ended = { how: 'no-answer' };
      return null;
    }
    const checked = checkOpeningR(this.crypto, kOpen, salt, mine.bytes, reply);
    const { pin } = this.opt.opening;
    // On a QR link, only the opening the code pinned: a rogue group that learned the secret from a photo of the code gets silence.
    const theirs = checked && (!pin || sameBytes(openingPinOf(this.crypto, checked.eph, checked.nonce), pin)) ? checked : null;
    const keys = theirs && sessionKeysOf(this.crypto, kSess, mine, theirs, { ephI: mine.eph, ephR: theirs.eph, nonceI: mine.nonce, nonceR: theirs.nonce });
    if (!keys) this.report.ended = { how: 'silent' };
    return keys;
  }

  private async openAsResponder(): Promise<NearbySessionKeys | null> {
    const { kSess, salt, seen } = this.opt.opening;
    const { openCloseMinMs: low, openCloseMaxMs: high } = this.tune;
    const started = this.opt.time.now();
    const [a, b] = this.crypto.randomBytes(2);
    const deadline = low + ((a! * 256 + b!) % (Math.max(high, low) - low + 1));
    const bytes = await this.link.receiveOpening(NEARBY_OPENING_BYTES, deadline);
    const kOpen = openingKeyOf(this.crypto, kSess);
    const theirs = bytes && checkOpeningI(this.crypto, kOpen, salt, bytes);
    const nonce = theirs ? base64urlEncode(theirs.nonce) : '';
    if (!bytes || !theirs || seen?.has(nonce)) return this.silence(started, deadline, bytes !== null);
    seen?.add(nonce);
    const mine = makeOpeningR(this.crypto, kOpen, salt, bytes, this.opt.opening.drawn);
    const keys = sessionKeysOf(this.crypto, kSess, mine, theirs, { ephI: theirs.eph, ephR: mine.eph, nonceI: theirs.nonce, nonceR: mine.nonce });
    if (!keys) return this.silence(started, deadline, true);
    await this.link.sendOpening(mine.bytes);
    return keys;
  }

  /** The same close whatever was wrong: wrong bytes wait out the deadline a silent connection gets, and whatever else comes is read and dropped. */
  private async silence(started: number, deadline: number, heardBytes: boolean): Promise<null> {
    this.report.ended = { how: 'silent' };
    for (let more = heardBytes; more;) {
      const left = deadline - (this.opt.time.now() - started);
      if (left <= 0) break;
      more = (await this.link.receiveOpening(NEARBY_OPENING_BYTES, left)) !== null;
    }
    return null;
  }

  // ---- messages ----------------------------------------------------------------

  private async send(m: Message): Promise<void> {
    await this.link.send(encodeMessage(m));
    this.moved();
  }

  /** One message off a link. Nothing a teammate sends gets past here as anything but a `Message`, a `bye` from them, or this phone's own `bye`. */
  private async readOne(link: NearbyLink): Promise<Message> {
    for (;;) {
      const bytes = await link.receive();
      if (bytes === null) throw new OfflineError('the other side closed');
      this.moved();
      const parsed = parseMessage(bytes);
      if (parsed.kind === 'unknown') continue;
      if (parsed.kind === 'malformed') throw new SayBye('protocol', parsed.reason);
      const m = parsed.message;
      if (m.t === 'bye') throw new HeardBye(m.reason);
      if (JOIN_MESSAGES.has(m.t) && !this.opt.join) continue;
      if (m.t === 'copy-ask' && !this.opt.copy && !this.opt.join) continue;
      if (COPY_ANSWERS.has(m.t) && !this.opt.takeCopy && this.opt.join?.as !== 'newcomer') continue;
      // Step 4 says when, and it comes before whatever that side sends next, whichever step this side is on.
      if (m.t === 'revoked' && this.haveDone) {
        await this.takeRevoked(m);
        continue;
      }
      // The initiator sends it straight after the responder's `arrange`, before whatever comes next on that side.
      if (m.t === 'discovery-key' && this.arranged && !this.haveDone) {
        await this.takeHanded(m);
        continue;
      }
      return m;
    }
  }

  /**
   * The next message, which stays here until it is taken: a read stays open across steps,
   * because a link's `receive` cannot be taken back, and a race lost to something else must
   * not lose what it read.
   */
  private next(): Promise<Message> {
    if (!this.reading) {
      this.reading = this.readOne(this.link);
      this.reading.catch(() => undefined);
    }
    return this.reading;
  }

  private async take(): Promise<Message> {
    const held = this.stash.shift();
    if (held) return held;
    return this.takeLink();
  }

  private async takeLink(): Promise<Message> {
    const m = await this.next();
    this.reading = null;
    return m;
  }

  private async expect<T extends Message['t']>(t: T): Promise<Extract<Message, { t: T }>> {
    const m = await this.take();
    if (m.t !== t) throw new SayBye('protocol', `${m.t} in place of ${t}`);
    return m as Extract<Message, { t: T }>;
  }

  /** Read and handle each message until `end`. Anything the handler does not expect ends the session. */
  private async readUntil<T extends Message['t']>(end: T, on: (m: Message) => Promise<void>): Promise<Extract<Message, { t: T }>> {
    for (;;) {
      const m = await this.take();
      if (m.t === end) return m as Extract<Message, { t: T }>;
      await on(m);
    }
  }

  // ---- step 2: hello -----------------------------------------------------------

  private theirHello: HelloMessage | null = null;

  private async myHello(): Promise<HelloMessage> {
    const { crypto, opt } = this;
    const can = [...(opt.files && !opt.join ? ['files'] : []), ...(opt.join?.as === 'inviter' ? ['let-in'] : []), ...(opt.copy ? ['starting-copy'] : [])];
    const base = { t: 'hello' as const, protocol: { ...NEARBY_PROTOCOL }, can, reducerVersion: REDUCER_VERSION, linesVersion: LINES_VERSION, wallMs: opt.port.nearbyWallNow };
    // On a QR link a QR holder learns nothing of the inviter until the tap: no chain, proof or device id from either side.
    if (opt.join) return { ...base, deviceId: '', chain: [], proof: '' };
    const proof = await crypto.sign(nearbyBytes('proof', proofText(opt.role, this.keys!.th)));
    return { ...base, deviceId: opt.deviceId, chain: opt.chain, proof };
  }

  /** Who speaks first follows from the generation, so a refused phone gets no chain from the side that checks first. */
  private async hello(): Promise<void> {
    this.revoked = await this.opt.keep.revoked();
    if (this.opt.role === 'i') {
      if (this.opt.older) {
        await this.send({ t: 'you-first' });
        await this.checkHello(await this.expect('hello'));
        await this.send(await this.myHello());
      } else {
        await this.send(await this.myHello());
        await this.checkHello(await this.expect('hello'));
      }
      return;
    }
    const first = await this.take();
    if (first.t === 'you-first') {
      await this.send(await this.myHello());
      await this.checkHello(await this.expect('hello'));
    } else if (first.t === 'hello') {
      await this.checkHello(first);
      await this.send(await this.myHello());
    } else throw new SayBye('protocol', `${first.t} in place of hello`);
  }

  private async checkHello(hello: HelloMessage): Promise<void> {
    const { opt, crypto } = this;
    if (pickProtocol(NEARBY_PROTOCOL, hello.protocol) === null) {
      this.report.newerAppNeeded = true;
      throw new SayBye('protocol', 'no common version');
    }
    if (opt.join) return this.checkJoinHello(hello);
    const verdict = await checkChain(hello.chain, {
      rootKeys: opt.rootKeys, orgId: opt.orgId, languageId: opt.languageId, now: opt.port.nearbyHelloNow, verify: crypto.verify, sha256: crypto.sha256,
      ...(this.revoked ? { revoked: this.revoked.list } : {})
    });
    if (!verdict.ok) throw new SayBye('identity', verdict.reason);
    const { holder } = verdict;
    if (holder.deviceId !== hello.deviceId) throw new SayBye('identity', 'another device');
    if (holder.installKey === crypto.publicKey) throw new SayBye('identity', 'this phone');
    const theirRole = opt.role === 'i' ? 'r' : 'i';
    if (!await signedBy(crypto.verify, holder.installKey, nearbyBytes('proof', proofText(theirRole, this.keys!.th)), hello.proof)) throw new SayBye('identity', 'bad proof');
    const tag = findTagOf(crypto, opt.opening.kFind, holder.installKey);
    this.report.refusedTag = tag;
    if (opt.heardTag !== undefined && opt.heardTag !== tag) throw new SayBye('identity', 'not the tag heard');
    // The read gate: Global Viewers hold no privileges in a language, so they are out.
    if (opt.gate.people(verdict).privilegesIn(holder.profileId, opt.languageId).size === 0) throw new SayBye('not-member');
    this.report.refusedTag = null;
    this.verdict = verdict;
    this.theirHello = hello;
    this.report.peer = { installKey: holder.installKey, profileId: holder.profileId, deviceId: holder.deviceId, tag, ...(holder.name ? { name: holder.name } : {}) };
    this.report.clockOff = Math.abs(hello.wallMs - opt.port.nearbyWallNow) > CLOCK_AHEAD_TOLERANCE_MS;
    await opt.keep.noteName(holder.installKey, holder.profileId);
  }

  // ---- phase 6: letting someone in, and the starting copy (section 14.1) ---------

  /** Both phones run this reducer and lines version, so a starting copy can move between them. */
  private sameVersions(): boolean {
    const h = this.theirHello;
    return !!h && h.reducerVersion === REDUCER_VERSION && h.linesVersion === LINES_VERSION;
  }

  /** Hello on a QR link: empty from both sides, clocks within five minutes, and the same versions, or no join. */
  private checkJoinHello(hello: HelloMessage): void {
    const { opt } = this;
    if (hello.chain.length !== 0 || hello.proof !== '' || hello.deviceId !== '') throw new SayBye('protocol', 'not a join');
    this.theirHello = hello;
    this.report.join = { pictures: null, granted: false, refused: null };
    this.report.clockOff = Math.abs(hello.wallMs - opt.port.nearbyWallNow) > CLOCK_AHEAD_TOLERANCE_MS;
    // A new phone's date is often wrong; a pass's expiry and every later check need it right.
    if (this.report.clockOff) throw new SayBye('protocol', 'clock');
    if (!this.sameVersions()) {
      this.report.versionsDiffer = true;
      throw new SayBye('protocol', 'versions');
    }
    if (opt.join?.as === 'newcomer' && !hello.can.includes('let-in')) throw new SayBye('nothing', 'cannot let in');
  }

  private async joinSteps(join: NearbyJoinInviter | NearbyJoinNewcomer): Promise<void> {
    this.report.linkKind = this.link.kind;
    await this.hello();
    if (join.as === 'inviter') await this.letIn(join);
    else await this.askToJoin(join);
  }

  /** Until the grant neither side acts on anything but `join-ask`, `join-grant` or `bye`, and `copy-ask` gets `not-allowed`. */
  private async beforeGrant<T extends 'join-ask' | 'join-grant'>(t: T): Promise<Extract<Message, { t: T }>> {
    const waiting = (async () => {
      for (;;) {
        const m = await this.take();
        if (m.t === t) return m as Extract<Message, { t: T }>;
        if (m.t === 'copy-ask') await this.send({ t: 'copy-no', reason: 'not-allowed' });
      }
    })();
    const late = this.opt.time.sleep(this.tune.joinTapMs).then((): null => null);
    this.localWork += 1;
    try {
      const got = await Promise.race([waiting, late]);
      if (!got) throw new SayBye('stopped', 'no tap in time');
      return got;
    } finally {
      this.localWork -= 1;
      this.moved();
    }
  }

  /** The inviter: check the ask, show the pictures, take the one tap, sign the second link and send the grant, then serve the copy. */
  private async letIn(join: NearbyJoinInviter): Promise<void> {
    const { opt, crypto, report } = this;
    const theirRole = opt.role === 'i' ? 'r' : 'i';
    const first = opt.chain[0] as WorkerLink | undefined;
    // Its certificate for this organization and no other: a teammate learns of no other organization of the inviter's.
    if (!first || first.kind !== 'worker@1' || first.body.org.orgId !== opt.orgId || opt.chain.length !== 1) throw new SayBye('identity', 'no certificate for this organization');
    const ask = await this.beforeGrant('join-ask');
    const refused = (reason: string) => {
      report.join!.refused = reason;
      return new SayBye('identity', reason);
    };
    if (ask.installKey === crypto.publicKey) throw refused('this phone');
    if (ask.profileId !== await newcomerProfileId(ask.installKey, ask.idSalt, crypto.sha256)) throw refused('id does not follow from the key');
    if (!await signedBy(crypto.verify, ask.installKey, nearbyBytes('proof', proofText(theirRole, this.keys!.th)), ask.proof)) throw refused('bad proof');
    report.peer = { installKey: ask.installKey, profileId: ask.profileId, deviceId: ask.deviceId, tag: '' };
    const pictures = await joinPictures(this.keys!.th, crypto.sha256);
    report.join!.pictures = pictures;
    const roleId = await this.local(() => join.tap({ name: ask.name, profileId: ask.profileId, pictures }));
    if (roleId === null) {
      report.join!.refused = 'not let in';
      throw new SayBye('stopped', 'not let in');
    }
    const stopped = join.stop?.(roleId) ?? null;
    if (stopped !== null) throw refused(stopped);
    const issued = await issueInviteLink({
      inviterLink: first, pass: join.pass, ask, roleId, now: opt.port.nearbyHelloNow, sha256: crypto.sha256, sign: (m) => crypto.sign(m),
      ...(this.revoked ? { revoked: this.revoked.list } : {})
    });
    if (!issued.ok) throw refused(issued.reason);
    const proof = await crypto.sign(nearbyBytes('proof', proofText(opt.role, this.keys!.th)));
    await this.send({ t: 'join-grant', chain: [first, issued.link], proof, discoveryKey: join.discovery.key, gen: join.discovery.gen, floor: join.discovery.floor });
    report.join!.granted = true;
    // The link stays up for the starting copy, which the newcomer ends with `bye`.
    for (;;) {
      const m = await this.take();
      if (m.t === 'copy-ask') await this.serveCopy(m);
    }
  }

  /** The newcomer: ask with the new key, wait for the tap, check the grant, keep it, then take the copy over this link. */
  private async askToJoin(join: NearbyJoinNewcomer): Promise<void> {
    const { opt, crypto, report } = this;
    const theirRole = opt.role === 'i' ? 'r' : 'i';
    const proof = await crypto.sign(nearbyBytes('proof', proofText(opt.role, this.keys!.th)));
    await this.send({ t: 'join-ask', installKey: crypto.publicKey, idSalt: join.idSalt, profileId: join.profileId, deviceId: opt.deviceId, name: join.name, proof });
    const pictures = await joinPictures(this.keys!.th, crypto.sha256);
    report.join!.pictures = pictures;
    join.pictures?.(pictures);
    const grant = await this.beforeGrant('join-grant');
    const refused = (reason: string) => {
      report.join!.refused = reason;
      return new SayBye('identity', reason);
    };
    // A QR code names no organization: a newcomer that passed none takes the grant's pass's, and checks the chain against it as against any other.
    const pass = grantPassOf(grant.chain);
    const orgId = opt.orgId || pass?.orgId || '';
    const languageId = opt.languageId || pass?.languageId || '';
    if (!orgId || !languageId) throw refused('no pass in the grant');
    const verdict = await checkChain(grant.chain, {
      rootKeys: opt.rootKeys, orgId, languageId, now: opt.port.nearbyHelloNow, verify: crypto.verify, sha256: crypto.sha256
    });
    if (!verdict.ok) throw refused(verdict.reason);
    const { holder } = verdict;
    // The link names the key, id, device and name this phone asked with, and nothing else.
    if (verdict.links !== 2 || holder.installKey !== crypto.publicKey || holder.profileId !== join.profileId || holder.deviceId !== opt.deviceId || holder.name !== join.name) {
      throw refused('the grant names someone else');
    }
    if (!verdict.inviterKey || !await signedBy(crypto.verify, verdict.inviterKey, nearbyBytes('proof', proofText(theirRole, this.keys!.th)), grant.proof)) throw refused('bad proof');
    report.peer = { installKey: verdict.inviterKey, profileId: verdict.inviter ?? '', deviceId: '', tag: '' };
    const answered = await this.local(() => join.granted({ chain: grant.chain, verdict, discovery: { key: grant.discoveryKey, gen: grant.gen, floor: grant.floor }, orgId, languageId }));
    report.join!.granted = true;
    const target = answered ?? join.target;
    if (target) await this.takeCopyFrom(target);
    await this.send({ t: 'bye', reason: 'done' }).catch((err: unknown) => { if (!isDrop(err)) throw err; });
  }

  /** A teammate's answer to one ask: as a sender, only after its read gate passed this chain, and only on the same versions. */
  private async serveCopy(ask: Extract<Message, { t: 'copy-ask' }>): Promise<void> {
    const { opt, report } = this;
    const granted = !opt.join || report.join?.granted === true;
    let answer: Awaited<ReturnType<StartingCopySender['answer']>>;
    if (!opt.copy || !granted) answer = 'not-allowed';
    else if (!this.sameVersions()) answer = 'versions';
    else {
      this.sender ??= new StartingCopySender(opt.copy, opt.languageId);
      answer = await this.local(() => this.sender!.answer(ask)).catch((): 'not-here' => 'not-here');
    }
    if (typeof answer === 'string') {
      report.copyServed.no += 1;
      if (ask.part === 'state') report.copyServed.stateRefused ??= answer;
      await this.send({ t: 'copy-no', reason: answer });
      return;
    }
    report.copyServed.parts += 1;
    await this.send({ t: 'copy-part', ...answer });
  }

  /** One ask and its answer. A `have` that came first is kept for step 4. */
  private copyAsker(): CopyAsker {
    return async (ask) => {
      await this.send({ t: 'copy-ask', ...ask });
      for (;;) {
        const m = await this.takeLink();
        if (m.t === 'copy-part' || m.t === 'copy-no') return m;
        if (m.t === 'have' && !this.opt.join) this.stash.push(m);
        else if (m.t === 'copy-ask') await this.send({ t: 'copy-no', reason: 'not-allowed' });
        else throw new SayBye('protocol', `${m.t} during a copy`);
      }
    };
  }

  private async takeCopyFrom(target: Omit<StartingCopyTarget, 'sha256'>): Promise<void> {
    try {
      this.report.copy = await takeStartingCopy(this.copyAsker(), { ...target, sha256: this.crypto.sha256 });
      if (this.report.copy.filled > 0) this.report.changed = true;
    } catch (err) {
      if (!(err instanceof CopyRefused)) throw err;
      this.report.copyRefused = err.reason;
    }
  }

  /** After an ordinary Hello: a newcomer whose copy is not whole yet asks a teammate that offers one, on the same versions. */
  private async askCopy(): Promise<void> {
    const target = this.opt.takeCopy;
    if (!target || !this.theirHello?.can.includes('starting-copy')) return;
    // A teammate on another version can never finish it: say so, so the newcomer is told why and looks for another.
    if (!this.sameVersions()) {
      this.report.versionsDiffer = true;
      this.report.copyRefused = 'versions';
      return;
    }
    await this.takeCopyFrom(target);
  }

  /** Step 4's `have`, answering a newcomer's copy asks that come before it. */
  private async expectHave(): Promise<HaveMessage> {
    for (;;) {
      const m = await this.take();
      if (m.t === 'have') return m;
      if (m.t === 'copy-ask') await this.serveCopy(m);
      else throw new SayBye('protocol', `${m.t} in place of have`);
    }
  }

  // ---- after hello: this phone's own house in order ----------------------------

  private async prepare(): Promise<void> {
    const { port, keep } = this.opt;
    await this.local(async () => {
      await port.startNearbyBudget();
      await port.nearbyDoorAgain({
        people: (verdict) => this.opt.gate.people(verdict), rootKeys: this.opt.rootKeys, verify: this.crypto.verify, sha256: this.crypto.sha256,
        ...(this.revoked ? { revoked: this.revoked.list } : {})
      });
      if (this.revoked) await port.nearbyApplyRevoked(this.revoked.list);
      this.holdings = await keep.holdings();
      await this.refreshMyHolding();
    });
  }

  /** Answers the entry when it changed. */
  private async refreshMyHolding(): Promise<HoldingEntry | null> {
    const { files, keep, orgId, languageId, chain } = this.opt;
    if (!files) return null;
    const { publicKey, sign, sha256 } = this.crypto;
    const after = await withMyHolding(this.holdings, await files.held(), { key: publicKey, orgId, streamId: languageId, chain, hold: files.holds?.() ?? false, sign: (m) => sign(m), sha256 });
    if (after === this.holdings) return null;
    this.holdings = after;
    const entry = after.get(publicKey)!;
    await keep.saveHoldings(new Map([[publicKey, entry]]));
    return entry;
  }

  /** `signUnsigned` runs before every summary goes out, so a summary can reach what a teammate holds of this phone. */
  private async summaryNow(): Promise<string> {
    const { port, signer } = this.opt;
    const signed = await this.local(() => port.signUnsigned(signer));
    const was = this.report.signed;
    this.report.signed = was ? { batches: was.batches + signed.batches, events: was.events + signed.events, unbound: signed.unbound, noCertificate: signed.noCertificate, unsafeNumber: signed.unsafeNumber } : signed;
    const { cursor, claimedSeq, vector } = await port.nearbyHave();
    return summaryOf(summaryText(Math.max(cursor, claimedSeq), vector, this.holdings, this.revoked?.list.seq ?? 0), this.crypto.sha256);
  }

  // ---- step 3: arrange, on a pipe only ------------------------------------------

  private async arrange(): Promise<void> {
    if (this.link.kind !== 'bluetooth') return;
    const { opt } = this;
    const none: Radios = { directByName: false, band5: false, hotspot: false, joinHotspot: false };
    const mine = opt.arrange?.radios ?? none;
    const summary = await this.summaryNow();
    const [, theirs] = await Promise.all([this.send({ t: 'arrange', summary, radios: mine }), this.expect('arrange')]);
    this.arranged = true;
    // Their `arrange` says they passed this phone's `hello`.
    const handed = opt.role === 'i' ? this.handOnNow() : null;
    if (handed) await this.send({ t: 'discovery-key', ...handed });
    const plan = opt.role === 'i' ? arrangePlan(mine, theirs.radios, opt.arrange?.order) : arrangePlan(theirs.radios, mine, opt.arrange?.order);
    this.link = await this.bringUp(this.link, plan);
  }

  private handOnNow(): DiscoveryKey | null {
    const gens = this.opt.generations;
    if (!gens) return null;
    const mine = gens.mine();
    return mayHandOn(mine, gens.sessionGen, gens.orgSeqHere()) ? { gen: mine.gen, key: mine.key } : null;
  }

  /** A failure drops the message, ends nothing and counts for diagnostics. */
  private async takeHanded(m: Extract<Message, { t: 'discovery-key' }>): Promise<void> {
    const gens = this.opt.generations;
    const handed = { gen: m.gen, key: m.key };
    if (!gens || this.opt.role !== 'r' || !isBase64url(m.key, 32) || !await handedKeyHolds(gens.mine(), handed, this.crypto.sha256, this.tune.handOnMaxSteps)) {
      this.report.handedKeyRefused += 1;
      return;
    }
    await gens.keep(handed);
    this.report.handedKey = handed;
  }

  /**
   * The next attempt's host moves on when the one before has had its time: with no `ready`
   * by the deadline it sends `host` with the next kind. The plan ends with the pipe, which
   * the GATT server always announces, so the two can only ever agree or drop.
   */
  private async bringUp(pipe: NearbyLink, plan: readonly NearbyAttempt[]): Promise<NearbyLink> {
    const { opt, tune } = this;
    const me = opt.role;
    const wifi = this.keys!.wifi;
    /** Each attempt's own keys, so no two links of a session ever share a key and nonce. */
    const sealedFor = (attempt: number) => {
      const k = attemptKeysOf(this.crypto, wifi, attempt);
      return me === 'i' ? { send: k.iToR, receive: k.rToI } : { send: k.rToI, receive: k.iToR };
    };
    type Turn = { t: 'message'; m: Message } | { t: 'pipe-failed'; err: unknown } | { t: 'up'; at: number; link: NearbyLink } | { t: 'no-link'; at: number } | { t: 'time'; at: number };
    let at = 0;
    let finished = false;
    let pipeRead: Promise<Turn> | null = null;
    let pipeGone = false;
    let up: Promise<Turn> | null = null;
    let timer: Promise<Turn> | null = null;
    /** Groups this phone hosts, by attempt: each one an attempt moved past is taken down, and every one but the link's at the end. */
    const groups = new Map<number, { takeDown(): Promise<void> }>();
    let won = -1;
    const takeDownBefore = async (attempt: number) => {
      for (const [j, g] of [...groups]) {
        if (j >= attempt) continue;
        groups.delete(j);
        await g.takeDown().catch(() => undefined);
      }
    };

    /**
     * The joiner sends `ready` at once; the host, whose group may hand up several connections under
     * one attempt's keys, seals nothing until the joiner's `ready` has opened, so only the link that
     * proved the keys ever carries a frame under them and no nonce repeats on another.
     */
    const seal = async (attempt: number, made: Promise<NearbyLink>): Promise<Turn> => {
      let link: NearbyLink | null = null;
      try {
        link = await made;
        if (finished || attempt !== at) throw new OfflineError('a later attempt took over');
        await link.secure(sealedFor(attempt));
        const ready = encodeMessage({ t: 'ready' });
        const hosting = plan[attempt]!.host === me;
        const heard = hosting ? await this.readOne(link) : (await Promise.all([link.send(ready), this.readOne(link)]))[1];
        if (heard.t !== 'ready') throw new OfflineError('no ready');
        if (hosting && !finished && attempt === at) await link.send(ready);
        if (finished || attempt !== at) throw new OfflineError('a later attempt took over');
        return { t: 'up', at: attempt, link };
      } catch {
        if (link) await this.closeQuietly(link);
        return { t: 'no-link', at: attempt };
      }
    };
    /**
     * A hosted attempt whose group hands up every connection (`nextLink`, a hotspot): each one is
     * tried at once, the first to prove the attempt's keys is the link, and every other is
     * closed, so a stranger who connected first, or stays silent, holds nothing up.
     */
    const sealAny = (attempt: number, group: { link: Promise<NearbyLink>; nextLink(): Promise<NearbyLink> }): Promise<Turn> => new Promise<Turn>((resolve) => {
      const tried = new Set<NearbyLink>();
      let trying = 0;
      let more = true;
      let settled = false;
      const settle = (turn: Turn) => {
        if (settled) return;
        settled = true;
        resolve(turn);
        for (const l of tried) if (turn.t !== 'up' || l !== turn.link) void this.closeQuietly(l);
      };
      const tryOne = (made: Promise<NearbyLink>) => {
        trying += 1;
        void seal(attempt, made.then((l) => {
          if (settled) throw new OfflineError('another candidate is the link');
          tried.add(l);
          return l;
        })).then((turn) => {
          trying -= 1;
          if (turn.t === 'up' && settled) void this.closeQuietly(turn.link);
          else if (turn.t === 'up') settle(turn);
          else if (!more && trying === 0) settle(turn);
        });
      };
      tryOne(group.link);
      void (async () => {
        for (;;) {
          let next: NearbyLink;
          try {
            next = await group.nextLink();
          } catch {
            more = false;
            if (trying === 0) settle({ t: 'no-link', at: attempt });
            return;
          }
          if (settled || finished || attempt !== at) {
            more = false;
            await this.closeQuietly(next);
            return;
          }
          tryOne(Promise.resolve(next));
        }
      })();
    });
    /** This phone's next turn to host: nobody else will move on for it. */
    const myNext = (from: number) => {
      for (let j = from + 1; j < plan.length; j++) if (plan[j]!.host === me) return j;
      return -1;
    };
    const armTimer = () => {
      const turn = myNext(at);
      const armedAt = at;
      timer = turn < 0 ? null : opt.time.sleep(tune.attemptMs * (turn - at)).then((): Turn => ({ t: 'time', at: armedAt }));
    };
    /** Answers the link once the pipe is it. */
    const begin = async (attempt: number): Promise<NearbyLink | null> => {
      at = attempt;
      up = null;
      await takeDownBefore(attempt);
      const { kind, host, band5 } = plan[attempt]!;
      if (kind === 'bluetooth') {
        if (host === me) {
          await pipe.send(encodeMessage({ t: 'host', attempt, kind }));
          return pipe;
        }
        armTimer();
        return null;
      }
      armTimer();
      if (host !== me) return null;
      let hosted: Awaited<ReturnType<NearbyArrangeOptions['radio']['host']>> | null = null;
      try {
        hosted = await opt.arrange!.radio.host(kind, kind === 'wifi-direct' ? wifiDirectOptions(this.crypto, band5) : { band5 });
      } catch {
        // Its radio would not host. When the next turn is its own it moves straight on, and otherwise the other's time runs out.
        const turn = myNext(attempt);
        return turn === attempt + 1 ? begin(turn) : null;
      }
      groups.set(attempt, hosted);
      await pipe.send(encodeMessage({ t: 'host', attempt, ...hostDetailsOf(hosted) }));
      const { nextLink } = hosted;
      up = nextLink ? sealAny(attempt, { link: hosted.link, nextLink: () => nextLink.call(hosted) }) : seal(attempt, hosted.link);
      return null;
    };
    try {
      const first = await begin(0);
      if (first) return first;
      for (;;) {
        pipeRead ??= pipeGone ? null : this.readOne(pipe).then((m): Turn => ({ t: 'message', m }), (err: unknown): Turn => ({ t: 'pipe-failed', err }));
        const waits = [pipeRead, up, timer].filter((w): w is Promise<Turn> => w !== null);
        if (waits.length === 0) throw new OfflineError('the pipe went and no link came');
        const turn: Turn = await Promise.race(waits);
        this.moved();
        if (turn.t === 'message') {
          pipeRead = null;
          const { m } = turn;
          if (m.t === 'host') {
            const other = me === 'i' ? 'r' : 'i';
            // The host names its attempt, since two attempts can be of one kind (Wi-Fi Direct at 5 GHz, then any band),
            // and the attempt picks the link's keys. One the plan does not hold is a broken phone; one behind
            // this phone's own move on crossed it, and is stale.
            const found = m.attempt;
            const planned = found === undefined ? undefined : plan[found];
            if (found === undefined || !planned || planned.host !== other || planned.kind !== m.kind) throw new SayBye('protocol', 'host off the plan');
            if (found < at) continue;
            at = found;
            await takeDownBefore(found);
            if (m.kind === 'bluetooth') return pipe;
            armTimer();
            up = seal(found, opt.arrange ? opt.arrange.radio.join(m.kind, hostDetailsOf(m)) : Promise.reject(new OfflineError('no radio')));
          } else throw new SayBye('protocol', `${m.t} while arranging`);
        } else if (turn.t === 'pipe-failed') {
          pipeRead = null;
          if (!isDrop(turn.err)) throw turn.err;
          // The other may have heard `ready` already and closed it.
          if (!up) throw turn.err;
          pipeGone = true;
        } else if (turn.t === 'up') {
          if (turn.at !== at) continue;
          won = turn.at;
          finished = true;
          await this.closeQuietly(pipe);
          return turn.link;
        } else if (turn.t === 'no-link') {
          if (turn.at === at) up = null;
        } else if (turn.at === at) {
          const next = myNext(at);
          timer = null;
          if (next >= 0) {
            const taken = await begin(next);
            if (taken) return taken;
          }
        }
      }
    } finally {
      finished = true;
      this.report.fallbacks = at;
      // The group whose link won stays until that link ends; every other one goes now.
      for (const [j, g] of groups) if (j !== won) await g.takeDown().catch(() => undefined);
    }
  }

  // ---- step 4: have ------------------------------------------------------------

  private async have(): Promise<HaveMessage> {
    const { opt } = this;
    await this.local(async () => { await this.summaryNow(); });
    const { cursor, claimedSeq, vector } = await opt.port.nearbyHave();
    const revokedSeq = this.revoked?.list.seq ?? 0;
    const counters = new Map([...this.holdings].map(([key, e]) => [key, e.counter]));
    const mine: HaveMessage = { t: 'have', orgId: opt.orgId, languageId: opt.languageId, cursor, claimedSeq, revokedSeq, vector, holdings: counters };
    const [, them] = await Promise.all([this.send(mine), this.expectHave()]);
    if (them.orgId !== opt.orgId || them.languageId !== opt.languageId) throw new SayBye('protocol', 'another language');
    this.haveDone = true;
    if (this.revoked && revokedSeq > them.revokedSeq) await this.send({ t: 'revoked', ...this.revoked.signed });
    return them;
  }

  /** Verified against the Worker's key. The highest `seq` wins. If it names this partner the session ends. */
  private async takeRevoked(m: Extract<Message, { t: 'revoked' }>): Promise<void> {
    const { opt, crypto } = this;
    const root = opt.rootKeys.get(m.kid);
    const list = parseRevocationList(m.text, { orgId: opt.orgId, kid: m.kid });
    if (root === undefined || !list || !await signedBy(crypto.verify, root, nearbyBytes('revoked', m.text), m.sig)) {
      this.report.revokedDropped += 1;
      return;
    }
    if (list.seq <= (this.revoked?.list.seq ?? 0)) return;
    const signed = { text: m.text, kid: m.kid, sig: m.sig };
    await this.local(async () => {
      await opt.keep.saveRevoked(signed);
      await opt.port.nearbyApplyRevoked(list);
    });
    this.revoked = { signed, list };
    this.report.revokedTaken = list.seq;
    const peer = this.report.peer!;
    if (list.keys.some(([key, profile]) => key === peer.installKey && profile === peer.profileId)) throw new SayBye('identity', 'listed');
  }

  // ---- step 5: holdings --------------------------------------------------------

  private async sendHolding(key: string, entry: HoldingEntry): Promise<void> {
    const { files, counter, hold, sig, chain } = entry;
    for (let at = 0; ;) {
      const part = files.slice(at, at + NEARBY_HOLDINGS_MESSAGE_FILES);
      at += part.length;
      const more = at < files.length;
      const m: HoldingsMessage = more ? { t: 'holdings', key, counter, files: [...part], more } : { t: 'holdings', key, counter, files: [...part], more, hold, sig, chain };
      await this.send(m);
      if (!more) break;
    }
    this.report.holdings.sent += 1;
  }

  /** Parts of one entry as they come. A part that does not go on from the last starts over, and what it dropped counts. */
  private holdingsReader(heard: Map<string, HoldingEntry>): (m: Message) => Promise<void> {
    let open: { key: string; counter: number; files: string[]; bad: boolean } | null = null;
    return async (m) => {
      if (m.t !== 'holdings') throw new SayBye('protocol', `${m.t} in holdings`);
      if (!open || open.key !== m.key || open.counter !== m.counter) {
        if (open) this.report.holdings.dropped += 1;
        open = { key: m.key, counter: m.counter, files: [], bad: false };
      }
      const entry = open;
      for (const hash of m.files) {
        const last = entry.files[entry.files.length - 1];
        if (entry.bad || (last !== undefined && last >= hash) || entry.files.length >= NEARBY_HOLDINGS_MAX_FILES) { entry.bad = true; break; }
        entry.files.push(hash);
      }
      if (m.more) return;
      open = null;
      const held = heard.get(m.key);
      if (held && held.counter >= m.counter) return;
      const good = !entry.bad && m.hold !== undefined && m.sig !== undefined && m.chain !== undefined && m.key !== this.crypto.publicKey
        ? await this.holdingHolds(m.key, m.counter, entry.files, m.hold, m.sig, m.chain)
        : false;
      if (!good) {
        this.report.holdings.dropped += 1;
        return;
      }
      heard.set(m.key, { counter: m.counter, files: entry.files, hold: m.hold!, sig: m.sig!, chain: chainAsSigned(m.chain!) });
    };
  }

  /** Outside any lock, before `mergeHoldings`, one entry at a time, and a failure never ends the session. */
  private async holdingHolds(key: string, counter: number, files: readonly string[], hold: boolean, sig: string, chain: ChainLink[]): Promise<boolean> {
    const { opt, crypto } = this;
    const verdict = await checkChain(chain, {
      rootKeys: opt.rootKeys, orgId: opt.orgId, languageId: opt.languageId, now: null, verify: crypto.verify, sha256: crypto.sha256, ...(this.revoked ? { revoked: this.revoked.list } : {})
    });
    if (!verdict.ok || verdict.holder.installKey !== key) return false;
    // A person removed, or let in by an inviter since revoked or removed, holds nothing that counts as a copy: Hello's own read gate.
    if (opt.gate.people(verdict).privilegesIn(verdict.holder.profileId, opt.languageId).size === 0) return false;
    const filesHash = await holdingsFilesHash(files, crypto.sha256);
    return signedBy(crypto.verify, key, nearbyBytes('holdings', holdingsText({ orgId: opt.orgId, streamId: opt.languageId, key, counter, filesHash, hold })), sig);
  }

  /** Written once for the step, and only what moved. */
  private async mergeHeard(heard: Map<string, HoldingEntry>): Promise<void> {
    if (heard.size === 0) return;
    const before = this.holdings;
    const merged = mergeHoldings(before, heard, this.crypto.publicKey);
    const changed = new Map([...merged].filter(([key, entry]) => before.get(key) !== entry));
    this.holdings = merged;
    this.report.holdings.taken += changed.size;
    await this.opt.keep.saveHoldings(changed);
  }

  private async holdingsStep(them: HaveMessage): Promise<void> {
    const heard = new Map<string, HoldingEntry>();
    const sending = async () => {
      for (const [key, entry] of this.holdings) {
        if (entry.counter > (them.holdings.get(key) ?? -1)) await this.sendHolding(key, entry);
      }
      await this.send({ t: 'holdings-end' });
    };
    await Promise.all([sending(), this.readUntil('holdings-end', this.holdingsReader(heard))]);
    await this.mergeHeard(heard);
  }

  // ---- step 6: events ----------------------------------------------------------

  private intake(): NearbyIntake {
    const { opt, crypto } = this;
    return {
      people: (verdict) => opt.gate.people(verdict),
      rootKeys: opt.rootKeys, verify: crypto.verify, sha256: crypto.sha256, budget: opt.budget ?? { ...NEARBY_BUDGET }, peerKey: this.report.peer!.installKey, ownKey: crypto.publicKey,
      ...(this.revoked ? { revoked: this.revoked.list } : {}),
      ...(opt.maxRanges !== undefined ? { maxRanges: opt.maxRanges } : {})
    };
  }

  /** A page the wire will not carry is one a teammate signed too big, and costs that page only. */
  private async sendPage(page: NearbyPage): Promise<boolean> {
    let bytes: Uint8Array;
    try {
      bytes = encodeMessage(page);
    } catch {
      this.report.sent.skipped += 1;
      return false;
    }
    await this.link.send(bytes);
    this.moved();
    return true;
  }

  private async sendEvents(them: HaveMessage): Promise<void> {
    const { port } = this.opt;
    const { sent } = this.report;
    for (const { key, n } of await port.nearbyUncounted(them.vector)) {
      const page = await port.nearbyBatchPage(key, n);
      if (!page || !await this.sendPage(page)) continue;
      sent.batches += 1;
      sent.events += page.events.length;
    }
    let claimedSeq = them.claimedSeq;
    for (;;) {
      const next = await port.nearbyNextClaims({ cursor: them.cursor, claimedSeq });
      if (!next) break;
      claimedSeq = next.throughSeq;
      if (!await this.sendPage(next.page)) continue;
      sent.claims += 1;
      sent.events += next.page.events.length;
    }
    await this.send({ t: 'events-done', older: await port.nearbyHoldsLess({ cursor: them.cursor, claimedSeq: them.claimedSeq }) });
  }

  private async takePage(m: Message): Promise<void> {
    if (m.t !== 'batch' && m.t !== 'claims') throw new SayBye('protocol', `${m.t} in events`);
    const { got } = this.report;
    const receipt = await this.local(() => this.opt.port.receiveNearby(m, this.intake()));
    got.pages += 1;
    got.events += receipt.kept;
    got.refused += receipt.refused.length;
    if (receipt.counted) got.counted += 1;
    if (receipt.kept > 0) this.report.changed = true;
    if (receipt.overBudget) got.overBudget += 1;
    if (receipt.outcome !== 'dropped') return;
    got.droppedPages += 1;
    if (got.droppedPages >= this.tune.busyAfterDrops) throw new SayBye('busy', 'too many dropped pages');
  }

  private async eventsStep(them: HaveMessage): Promise<void> {
    const [, done] = await Promise.all([this.sendEvents(them), this.readUntil('events-done', (m) => this.takePage(m))]);
    if (done.older) this.report.older = true;
  }

  // ---- step 7: files -----------------------------------------------------------

  /**
   * Asks go one at a time. Both sides ask and serve at once, and `files-done` says only
   * that a side wants no more, so each keeps reading and serving until both have said it.
   */
  private async filesStep(): Promise<void> {
    const queue: { transferId: string; hash: string; format: string }[] = [];
    const waiting: { wake: (() => void) | null } = { wake: null };
    let theirsDone = false;
    const QUEUE_MAX = 32;
    const serving: Promise<void> = (async () => {
      for (;;) {
        const ask = queue.shift();
        if (ask) await this.serve(ask);
        else if (theirsDone) return;
        else await new Promise<void>((resolve) => { waiting.wake = resolve; });
      }
    })();
    serving.catch(() => undefined);
    let asksDone = false;
    const asking = this.askFiles().then(() => { asksDone = true; });
    const asksOver = asking.then((): null => null);
    while (!(theirsDone && asksDone)) {
      const m = asksDone ? await this.take() : await Promise.race([this.next(), asksOver]);
      if (m === null) continue;
      this.reading = null;
      if (m.t === 'file-ask') {
        if (theirsDone || queue.length >= QUEUE_MAX) throw new SayBye('protocol', 'too many asks');
        queue.push(m);
        waiting.wake?.();
      } else if (m.t === 'file-no') {
        this.fileNos.get(m.transferId)?.(m.reason);
      } else if (m.t === 'files-done') {
        theirsDone = true;
        waiting.wake?.();
      } else throw new SayBye('protocol', `${m.t} in files`);
    }
    await serving;
  }

  private async serve(ask: { transferId: string; hash: string; format: string }): Promise<void> {
    const { files } = this.report;
    let answer: Awaited<ReturnType<NearbyFileMoves['serveFile']>>;
    try {
      answer = await this.opt.files!.serveFile({ hash: ask.hash, format: ask.format });
    } catch {
      answer = { no: 'not-here' };
    }
    if ('no' in answer) {
      files.answeredNo += 1;
      await this.send({ t: 'file-no', transferId: ask.transferId, reason: answer.no });
      return;
    }
    this.moving += 1;
    try {
      await this.link.sendFile({ transferId: ask.transferId, uri: answer.uri, size: answer.size });
      files.served += 1;
    } catch (err) {
      if (isDrop(err)) throw err;
      files.answeredNo += 1;
      await this.send({ t: 'file-no', transferId: ask.transferId, reason: 'not-here' });
    } finally {
      this.moving -= 1;
      this.moved();
    }
  }

  private async askFiles(): Promise<void> {
    const { opt, tune, report } = this;
    const wanted = await opt.files!.wanted(this.holdings);
    const theirs = new Set(this.holdings.get(report.peer!.installKey)?.files ?? []);
    let backupsFrom: number | null = null;
    if (opt.files!.take) {
      const { noRoom } = await opt.files!.take({
        // Holdings say whether this partner has a backup, so a wanted list of thousands does not cost thousands of `no`s.
        list: wanted.filter((file) => file.group !== 'backup' || theirs.has(file.hash)),
        fetch: (file, stage) => this.fetchOne(file, stage),
        linkUp: () => !this.over && !this.stopped && !this.stalled,
        stop: (file) => {
          if (file.group !== 'backup') return false;
          backupsFrom ??= opt.time.now();
          if (!opt.otherWaiting?.() || opt.time.now() - backupsFrom < tune.backupLimitMs) return false;
          report.files.cutBackups = true;
          return true;
        }
      });
      if (noRoom) report.files.noRoom = true;
      await this.send({ t: 'files-done' });
      return;
    }
    for (const file of wanted) {
      if (file.group === 'backup') {
        // Holdings say whether this partner has one, so a wanted list of thousands does not cost thousands of `no`s.
        if (!theirs.has(file.hash)) continue;
        backupsFrom ??= opt.time.now();
        if (opt.otherWaiting?.() && opt.time.now() - backupsFrom >= tune.backupLimitMs) {
          report.files.cutBackups = true;
          break;
        }
      }
      const stage = await opt.files!.fetchFile(file);
      if (!stage) {
        report.files.noRoom = true;
        break;
      }
      await this.fetchOne(file, stage);
    }
    await this.send({ t: 'files-done' });
  }

  private async fetchOne(file: WantedFile, stage: { stagingUri: string; maxBytes: number; minFreeBytes: number }): Promise<void> {
    const { opt, report } = this;
    const transferId = base64urlEncode(this.crypto.randomBytes(12));
    const toldNo = new Promise<'no'>((resolve) => { this.fileNos.set(transferId, () => resolve('no')); });
    this.moving += 1;
    try {
      const landing = this.link.receiveFile({ transferId, ...stage });
      landing.catch(() => undefined);
      const [, outcome] = await Promise.all([this.send({ t: 'file-ask', transferId, hash: file.hash, format: file.format }), Promise.race([landing, toldNo])]);
      if (outcome === 'no') {
        report.files.toldNo += 1;
        await this.link.cancelFile(transferId).catch(() => undefined);
        return;
      }
      // Native wrote and hashed it. A teammate's wrong bytes never get this file's name.
      if (outcome.sha256 !== file.hash) {
        report.files.failed += 1;
        await opt.files!.discard(stage.stagingUri);
        return;
      }
      await opt.files!.landed(file, stage.stagingUri, outcome.size);
      report.files.got += 1;
      report.changed = true;
    } catch (err) {
      if (isDrop(err) || err instanceof SayBye || err instanceof HeardBye) throw err;
      report.files.failed += 1;
      await opt.files!.discard(stage.stagingUri).catch(() => undefined);
    } finally {
      this.moving -= 1;
      this.fileNos.delete(transferId);
      this.moved();
    }
  }

  // ---- step 8: done ------------------------------------------------------------

  private async doneStep(moveFiles: boolean): Promise<void> {
    const { opt, crypto, report } = this;
    const heard = new Map<string, HoldingEntry>();
    const reader = moveFiles ? this.holdingsReader(heard) : (m: Message) => Promise.reject(new SayBye('protocol', `${m.t} before done`));
    const sending = async () => {
      if (moveFiles) {
        await opt.files!.shed?.(this.holdings);
        const entry = await this.refreshMyHolding();
        if (entry) await this.sendHolding(crypto.publicKey, entry);
      }
      await this.send({ t: 'done' });
    };
    await Promise.all([sending(), this.readUntil('done', reader)]);
    await this.mergeHeard(heard);
    const mine = await this.summaryNow();
    const [, final] = await Promise.all([this.send({ t: 'final', summary: mine }), this.expect('final')]);
    report.finals = { mine, theirs: final.summary };
    // A session that cut backups records none, so the pair can go on later.
    if (!report.files.cutBackups) await opt.keep.recordPeer({ tag: report.peer!.tag, gen: opt.generations?.sessionGen ?? 0, mine, theirs: final.summary });
    await this.send({ t: 'bye', reason: 'done' }).catch((err: unknown) => { if (!isDrop(err)) throw err; });
    // Both finals are here, so whatever comes now, or no bye at all, changes nothing.
    await this.take().catch(() => undefined);
  }
}
