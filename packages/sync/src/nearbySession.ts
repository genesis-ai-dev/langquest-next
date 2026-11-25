import { CLOCK_AHEAD_TOLERANCE_MS, LINES_VERSION, NEARBY_PROTOCOL, pickProtocol, REDUCER_VERSION, type LibraryFile } from '@langquest-next/core';
import {
  base64urlEncode, bytesToHex, certificateSignedAt, labelKeysOf, libraryLinkFormat, utf8Encode, checkChain, handedKeyHolds, issueInviteLink, joinPictures, newcomerProfileId, type JoinPass, type WorkerLink, holdingsFilesHash, holdingsText, isBase64url, mergeHoldings, NEARBY_BUDGET, NEARBY_HOLDINGS_MAX_FILES, NEARBY_HOLDINGS_MAX_KEYS, type InviteLink, NEARBY_OPENING_BYTES, nearbyBytes, parseRevocationList, proofText, signedBy, summaryOf, summaryText, withMyHolding, type ChainLink, type ChainVerdict, type DiscoveryKey, type HoldingEntry, type Holdings, type RevocationList, type WantedFile
} from '@langquest-next/core/nearby';
import { chainAsSigned, chainNameOf, type NearbyChainName, type NearbyGate, type NearbyIntake, type NearbyPage, type NearbyReceipt, type NearbySigned, type NearbySigner } from './nearbyIntake';
import { nearbyCodeOf, type NearbyDiagCode } from './nearbyDiag';
import { nearbyDayOf, nearbyFirstDayWithin, type NearbyKeep } from './nearbyKeep';
import { CopyRefused, docsLackingOf, docsListOf, libraryFilesNamed, LibraryDocsSender, StartingCopySender, takeLabels, takeLibraryDocs, takeShared, takeStartingCopy, type CopyAsker, type CopyNoReason, type LibraryDocsAsk, type LibraryDocsTaken, type NearbyCopySource, type NearbyLibrary, type NearbyListedDocs, type StartingCopyTaken, type StartingCopyTarget } from './nearbyCopy';
import type { HostDetails, HostOptions, NearbyCrypto, NearbyLink, NearbyRadio } from './nearbyLink';
import { attemptKeysOf, checkOpeningI, checkOpeningR, findTagOf, makeOpeningI, makeOpeningR, openingKeyOf, openingPinOf, sameBytes, sessionKeysOf, type NearbySessionKeys } from './nearbyOpening';
import { encodeMessage, NEARBY_HOLDINGS_MESSAGE_FILES, parseMessage, type Message } from './nearbyWire';
import { OfflineError, passIdOfChain } from './types';

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
  /** `short`: library files and files named by address that waited for want of room (a library file never makes room). */
  take?(job: NearbyFetchJob): Promise<{ noRoom: boolean; short?: number }>;
  /**
   * Library files its language's documents name (`library-files`, 2026-11-24): a team's guides'
   * pictures and audio and its key words' audio, which land unmarked and never make room by deleting
   * (`WantedFile` group `reference`). Absent, this phone neither serves nor asks for them.
   */
  reference?: {
    /** Of these, the ones here that no recording in any language on this phone names (`keptIdsAnywhere`), so none is passed on as a library file. */
    held(hashes: readonly string[]): Promise<string[]>;
    /** Of these, the ones not here at all. */
    lacking(files: readonly LibraryFile[]): LibraryFile[];
    /** Where to read one to serve it, if `held` still says so. */
    serve(file: LibraryFile): Promise<{ uri: string; size: number } | null>;
    /**
     * Whether this phone lacks any of these that its kept passages need: its guides' files, its source chapters, FIA's
     * files by address (review P3). Over a pipe, only such files bring the link that moves files up. Absent, none do.
     */
    neededLacking?(files: readonly LibraryFile[], urls: readonly string[]): Promise<boolean>;
    /**
     * Files documents name only by web address (FIA's), kept by address in the study folder. Their
     * bytes come on the teammate's word, and are fetched again from the address once online.
     * Absent, none move.
     */
    links?: {
      /** Of these addresses, the ones whose file is here. */
      held(urls: readonly string[]): Promise<string[]>;
      /** Of these addresses, the ones whose file is not here: those a kept passage needs first. */
      lacking(urls: readonly string[]): Promise<string[]>;
      serve(url: string): Promise<{ uri: string; size: number } | null>;
    };
  };
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

/** The parts one holdings entry takes at most, and one more. */
const HOLDINGS_PARTS_MAX = Math.ceil(NEARBY_HOLDINGS_MAX_FILES / NEARBY_HOLDINGS_MESSAGE_FILES) + 1;

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
  /**
   * Any member (14.1, 2026-11-24): this phone serves the library documents its language uses
   * (`copy-library` in Hello's `can`) to whoever passed its read gate, on any versions, and asks a
   * teammate that serves them for those it lacks, after Hello as a copy is. Over the Bluetooth pipe
   * a session takes at most `NEARBY_TOP_UP_PIPE_CHARS` of them, so events are not held up.
   */
  library?: NearbyLibrary;
  /**
   * While LangQuest is open (docs/nearby-sync-plan.md 15.6, 15.8): Hello refuses, as `identity`, a
   * teammate whose certificate was signed longer ago than this by Hello's clock, which setting the
   * date back cannot move. Certificates renew daily online, so a lost or taken phone still signed
   * in collects nothing quietly once this long has passed since it last reached the server, though
   * the revocation list has not reached anyone. A teammate this phone met on Share nearby on a day
   * that began within it passes too (`nearbyMet`), so a team out of reach for longer goes on sharing
   * while each pair meets on Share nearby that often (decision 230 as amended). Left out, as on
   * Share nearby, it refuses nobody for it.
   */
  freshWithinMs?: number;
  /**
   * Share nearby on a phone that may share while LangQuest is open: after Hello, the day this
   * teammate was met (`nearbyMet`), kept this long and no longer. Never while open, where
   * `freshWithinMs` is set: a quiet meeting must not let a taken phone keep itself in.
   */
  notesMetForMs?: number;
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
  /**
   * The organization's nearby features as this phone last heard them from the server, handed to the
   * newcomer in the grant, so a phone that joined offline shares while LangQuest is open as this one
   * does until its first contact says otherwise (14.1, Carl 2026-11-24).
   */
  features?: readonly string[];
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
   * starting copy goes, for a phone that could not know before the grant, and this person's own
   * keep for that organization and language.
   */
  granted(grant: {
    chain: ChainLink[]; verdict: Extract<ChainVerdict, { ok: true }>; discovery: { key: string; gen: number; floor: number }; orgId: string; languageId: string;
    /** The inviter's word for the organization's nearby features; empty from an older inviter. */
    features: readonly string[];
    /**
     * The Worker's revocation list the inviter's phone held, checked against the Worker's keys
     * (2026-11-24), or null. The session keeps it in its keep before the copy is asked for.
     */
    revoked: { text: string; kid: string; sig: string } | null;
  }): Promise<NearbyJoinGranted | void>;
  /** Where the starting copy goes, over this link once granted, unless `granted` answers one. */
  target?: Omit<StartingCopyTarget, 'sha256'>;
  /**
   * The copy is whole, said once, before any step that follows it on this link (2026-11-24): the
   * app marks the person's record, so a phone that dies during those steps sets the person at its
   * next start with no teammate, as the copy alone would have.
   */
  whole?(): Promise<void>;
  /**
   * After a whole starting copy (2026-11-24, review item 2): this person's own pieces for the
   * granted language, on which the ordinary steps (have, holdings, events, files, done) then run
   * over this same link, when the inviter's Hello names `join-exchange`. So the newcomer leaves
   * with what the inviter's phone holds past its checkpoint, its unsent work, the teammates' work it
   * carries, and their files, not only the checkpoint. `library` says, in this phone's Hello, that
   * the pieces carry `library` and `files.reference`, so library files move too. `open` answers
   * `left` when the person left before the pieces opened, and null when they could not open; null,
   * or pieces short of what Hello said, ends the session after the copy, as before, and the report
   * says which (`join.exchangeSkip`).
   */
  exchange?: { library: boolean; open(): Promise<NearbyJoinOwn | 'left' | null> };
}

/**
 * Why the ordinary steps did not follow a granted join's copy on its link (2026-11-24, review item
 * 14): `older`, the other phone's Hello named no `join-exchange`; `no-pieces`, the newcomer's own
 * pieces did not open or came short of what its Hello said; `left`, the newcomer's person left
 * first. Only the newcomer can tell the last two, and it says any of them only after a whole copy.
 * The inviter says `older` only once the newcomer has ended, with `bye` `done`, a copy the inviter
 * gave every state part of: never for a copy that dropped or one it gave short.
 */
export type NearbyJoinExchangeSkip = 'older' | 'no-pieces' | 'left';

/** What a newcomer's `granted` may answer. */
export interface NearbyJoinGranted {
  target?: Omit<StartingCopyTarget, 'sha256'>;
  /**
   * This person's keep for the granted organization and language, which the session uses from now
   * on in place of its own (a newcomer's is `joinOnlyKeep` until then): the grant's revocation list
   * is kept there before the copy, and the inviter's key noted as a teammate's. With none, on
   * `joinOnlyKeep`, the list is held for the session alone, no meeting is noted, and no steps
   * follow the copy unless the pieces bring a keep.
   */
  keep?: NearbyKeep;
  /**
   * As the session option, worked out from the grant's features: where this phone may share while
   * LangQuest is open, the join is noted as a meeting (`nearbyMet`) for this long (2026-11-24).
   */
  notesMetForMs?: number;
}

/** A newcomer's own pieces for its language, once its copy is whole: the ordinary steps after the copy run on them. */
export interface NearbyJoinOwn {
  port: NearbySessionPort;
  /** The keep on that same language, when it is another client's than the one `granted` answered. */
  keep?: NearbyKeep;
  gate: Pick<NearbyGate, 'people'>;
  /** Signs this person's unsent work with the granted chain. */
  signer: NearbySigner;
  files: NearbyFileMoves;
  library?: NearbyLibrary;
}

/**
 * The port and keep a newcomer's QR session runs on before it has any stream: a join reads only
 * the clock from its port and the revocation list (none) from its keep, and never reaches the
 * rest, which refuse. The starting copy goes through the target `granted` answers, and the
 * person's own keep, which `granted` answers too, takes over from this one (2026-11-24).
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

/**
 * The keeps `joinOnlyKeep` made. A newcomer whose `granted` answered no keep of the person's still
 * runs on one (2026-11-24): the grant's revocation list is then held for the session alone and no
 * meeting is noted, rather than written to a keep that refuses, which would end the join.
 */
const JOIN_ONLY_KEEPS = new WeakSet<NearbyKeep>();

export function joinOnlyKeep(): NearbyKeep {
  const no = (): Promise<never> => Promise.reject(new Error('a join keeps nothing'));
  const keep: NearbyKeep = {
    holdings: no, saveHoldings: no, revoked: async () => null, saveRevoked: no, noteName: async () => undefined, peers: async () => [], recordPeer: no, met: async () => [], noteMet: no,
    letIn: async () => [], noteLetIn: no
  };
  JOIN_ONLY_KEEPS.add(keep);
  return keep;
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
  /**
   * The names checked chains gave people let in offline, from Hello, batches and holdings entries
   * (`chainNameOf`, 2026-11-24, review item 12): a teammate's work shows under their name on every
   * phone that carries it, not only on the one they met. At most `NEARBY_NAMES_REPORTED`, one each.
   */
  names: NearbyChainName[];
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
  /** `wanted`: over a pipe with `files-when-wanted`, what each phone said it wanted (review P3); absent otherwise. */
  files: { got: number; served: number; answeredNo: number; toldNo: number; failed: number; noRoom: boolean; cutBackups: boolean; wanted?: { mine: boolean; theirs: boolean } };
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
  /**
   * On a QR link: the two pictures, whether the grant went or came, and why not. `exchange`: the
   * newcomer's copy was whole and the ordinary steps began on the link after it (2026-11-24), so a
   * drop from then on cut only work newer than the copy, which any teammate or the server brings;
   * `exchangeSkip`, why they did not, when it is known. `copyWhole`, the inviter's: the newcomer,
   * on a build that names `join-exchange` and so sets its person once the passages are filled,
   * asked for names or documents, so its copy was whole, and a drop from then on cut only those
   * and what follows them (2026-11-24, review item 3).
   */
  join: { pictures: [number, number] | null; granted: boolean; refused: string | null; exchange: boolean; exchangeSkip: NearbyJoinExchangeSkip | null; copyWhole?: true } | null;
  /** The two phones run another reducer or lines version: no starting copy moves, and the screen names the file needed. */
  versionsDiffer: boolean;
  /** What this phone took of a starting copy, and why a teammate gave no more. */
  copy: StartingCopyTaken | null;
  copyRefused: string | null;
  /** Parts of a starting copy this phone sent, asks it answered with `copy-no`, and why it gave no organization or language, which leaves the copy short. */
  copyServed: { parts: number; no: number; stateRefused: CopyNoReason | null };
  /** What this phone took of the library documents its language uses, as any member (`library`), or null when it asked for none. */
  topUp: LibraryDocsTaken | null;
  /** With `library-files` on both sides: library files this phone said it holds, how many of theirs it could use, and how many it got and served. */
  /** `short`: library files and files named by address the other held that waited for want of room on this phone. */
  libraryFiles: { held: number; theirs: number; got: number; served: number; short: number } | null;
  /**
   * The documents this phone lacks were worked out again once the events were in, and they named one no ask before them
   * covered, or a top-up or copy stopped at a bound (2026-11-24, review item 15): the pair is not recorded as finished,
   * so the room picks it again and the next session asks for the rest, and then for their files.
   */
  docsAgain: boolean;
}

const emptyReport = (role: NearbyRole): NearbySessionReport => ({
  role, ended: { how: 'dropped' }, peer: null, names: [], refusedTag: null, newerAppNeeded: false, clockOff: false, linkKind: null, fallbacks: 0, code: null, signed: null,
  got: { pages: 0, events: 0, refused: 0, droppedPages: 0, overBudget: 0, counted: 0 },
  sent: { batches: 0, claims: 0, events: 0, skipped: 0 },
  files: { got: 0, served: 0, answeredNo: 0, toldNo: 0, failed: 0, noRoom: false, cutBackups: false },
  holdings: { taken: 0, dropped: 0, sent: 0 },
  older: false, farAhead: [], handedKey: null, handedKeyRefused: 0, revokedTaken: null, revokedDropped: 0, finals: null, changed: false,
  join: null, versionsDiffer: false, copy: null, copyRefused: null, copyServed: { parts: 0, no: 0, stateRefused: null }, topUp: null,
  libraryFiles: null, docsAgain: false
});

/** Who hosts what, in the order tried, ending with the pipe (5.12, The short Bluetooth exchange). Both sides work this out from `arrange`, so they agree. */
export interface NearbyAttempt {
  kind: HostKind;
  host: NearbyRole;
  band5: boolean;
}

/**
 * Why an inviter's session refused a newcomer (`join.refused`) when its pass has let in `maxUses`
 * people already (2026-11-24, review item 7): teammates keep at most that many newcomers' keys
 * under one pass, and the server refuses the rest at first contact.
 */
export const NEARBY_PASS_USED_UP = 'pass used up';

/** The names one session reports at most (`names`): far above a team, so a flood of newcomers' chains costs a few bytes. */
export const NEARBY_NAMES_REPORTED = 64;

/** Hello's ability that says this phone's plan lets a phone that cannot host join a Wi-Fi Direct group as a plain client (phase 5). */
export const JOIN_DIRECT_ABILITY = 'join-direct';
/**
 * This phone answers `copy-ask` `held` and serves the library documents its language uses of every
 * format (2026-11-24): with `starting-copy` on the same versions, and with `library` on any.
 */
export const COPY_LIBRARY_ABILITY = 'copy-library';
/**
 * This phone answers `copy-ask` `labels` (2026-11-24, review item 13): the names its language's library items go by
 * in a language, from what it keeps. Asked only of a phone that names it, since an older one ends the session on a
 * part it does not know.
 */
export const COPY_LABELS_ABILITY = 'copy-labels';
/**
 * This phone answers `copy-ask` `shared` (2026-11-24, review item 9): the rows of the Bibles other organizations share
 * that its team reads, and serves their documents as the language's own. Asked only of a phone that names it.
 */
export const COPY_SHARED_ABILITY = 'copy-shared';
/**
 * This phone takes documents after the events over the Bluetooth pipe, and serves a teammate's asks until its `done`
 * (2026-11-24, review P4): on a slow link the events go first, and documents only within their share. When both name
 * it on a pipe, both do; else documents come before Have, as an older phone expects.
 */
export const DOCS_AFTER_EVENTS_ABILITY = 'docs-after-events';
/**
 * Over a Bluetooth pipe this phone brings the link that moves files up only when either phone wants files after the
 * events, or a starting copy now (`arrange`'s `soon`), and leaves holdings for that link (2026-11-24, review P3): before,
 * every session formed a Wi-Fi Direct group first, even one that moved a few KB of events. Both must say it.
 */
export const FILES_WHEN_WANTED_ABILITY = 'files-when-wanted';
/** Each address's SHA-256, the key `lib-held` names it by, kept once worked out (review P7); at most this many. */
const LINK_KEYS = new WeakMap<object, Map<string, string>>();
const LINK_KEYS_KEPT = 50_000;
/** The characters of documents one session takes over the Bluetooth pipe (20 to 70 KB/s), past which the rest waits for the next. */
export const NEARBY_TOP_UP_PIPE_CHARS = 256 * 1024;
/**
 * This phone says in step 7 which library files it holds (`lib-held`), serves them, and asks for
 * those it lacks (2026-11-24). Only when both phones name it, and only on a link that moves files.
 */
export const LIBRARY_FILES_ABILITY = 'library-files';
/**
 * On a QR link (2026-11-24, review item 2): after a whole starting copy the newcomer sends `have`,
 * and the two phones run the ordinary steps on the same link (have, holdings, events, files when
 * both say `files`, done), so the newcomer holds what the inviter's phone holds, not only its last
 * checkpoint. Only when both Hellos name it: an older inviter waits for `bye` after the copy, and an
 * older newcomer sends it. A newcomer names it, and `files` with it, before the grant.
 */
export const JOIN_EXCHANGE_ABILITY = 'join-exchange';

/**
 * `joinDirect` is true only when both Hellos list `JOIN_DIRECT_ABILITY`: a phone on older
 * code works out the plan without it, and both sides must agree attempt by attempt.
 */
export function arrangePlan(
  i: Radios, r: Radios, order: readonly Exclude<HostKind, 'bluetooth'>[] = ['wifi-direct', 'awdl', 'hotspot'], opts: { joinDirect?: boolean } = {}
): NearbyAttempt[] {
  const plan: NearbyAttempt[] = [];
  const plain = opts.joinDirect === true;
  for (const kind of order) {
    if (kind === 'wifi-direct') {
      // Both host and join by name, or one hosts and the other joins as a plain client (an iPhone).
      const host: NearbyRole | null = i.directByName && r.directByName ? 'r' : plain && r.directByName && i.joinDirect ? 'r' : plain && i.directByName && r.joinDirect ? 'i' : null;
      if (!host) continue;
      // 5 GHz only when both report it, then any band.
      if (i.band5 && r.band5) plan.push({ kind, host, band5: true });
      plan.push({ kind, host, band5: false });
    } else if (kind === 'awdl') {
      // Two iPhones, over Apple's own direct Wi-Fi; a phone that does not name it never has it.
      if (i.awdl && r.awdl) plan.push({ kind, host: 'r', band5: false });
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

/** A Bonjour service name used once, so nothing in it marks this phone or this app; the service type is `Info.plist`'s. */
export function awdlOptions(crypto: Pick<NearbyCrypto, 'randomBytes'>): HostOptions {
  const letters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return { ssid: [...crypto.randomBytes(12)].map((b) => letters[b % letters.length]!).join(''), band5: false };
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
  /** Replaced once, on a newcomer, by its own pieces after the grant and after a whole copy (`takeOwn`): never on any other phone. */
  private opt: NearbySessionOptions;
  /** What this phone's Hello said it can: both sides work out from the two Hellos what the session does. */
  private myCan: readonly string[] = [];
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
  /**
   * The inviter of a join both Hellos say goes on after the copy, once the copy's state is all
   * given: the newcomer keeps its documents and opens its own language before its `have`, which the
   * link does not show, so its silence gets a file's time rather than a message's (2026-11-24).
   */
  private newcomerOpening = false;
  private verdict: Extract<ChainVerdict, { ok: true }> | null = null;
  private revoked: { signed: { text: string; kid: string; sig: string }; list: RevocationList } | null = null;
  private holdings: Holdings = new Map();
  private readonly fileNos = new Map<string, (reason: string) => void>();
  /** A message read while waiting on a copy's answer, kept for the step it belongs to. */
  private readonly stash: Message[] = [];
  private sender: StartingCopySender | null = null;
  private librarySender: LibraryDocsSender | null = null;
  /** In step 7 with `library-files`: the library files this phone's language names, and those of them the other holds. */
  private libraryFiles: Map<string, LibraryFile> | null = null;
  /** The addresses its documents name, by the SHA-256 of each (`lib-held` and `file-ask` carry that). */
  private libraryLinks: Map<string, string> | null = null;
  private readonly theirLibrary = new Set<string>();
  /** Every document the walks before the events found on this language's list (`LibraryDocsAsk.seen`, review item 15). */
  private docsSeen: Set<string> | null = null;

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
    // Phase 6: a copy asked of a teammate after an ordinary Hello comes between steps 2 and 4, and so do documents any member lacks.
    this.report.linkKind = this.link.kind;
    await this.askCopy();
    if (!this.report.copy && !this.docsLater()) await this.topUp();
    let moveFiles = this.movesFiles();
    const them = await this.have();
    if (moveFiles) await this.holdingsStep(them);
    await this.eventsStep(them);
    // On the Bluetooth pipe, documents after the events, within their share (review P4).
    if (!this.report.copy && this.docsLater()) await this.topUp();
    await this.docsAfterEvents();
    // The link that moves files, held back until now: up only if either phone wants files (review P3).
    if (this.heldPlan) {
      moveFiles = await this.linkIfWanted();
      if (moveFiles) await this.holdingsStep(them);
    }
    if (moveFiles) await this.filesStep();
    await this.doneStep(moveFiles);
  }

  /** Arranged and not yet brought up (review P3): the plan the two phones agreed on in `arrange`. */
  private heldPlan: readonly NearbyAttempt[] | null = null;

  /**
   * Each phone says whether it wants files; the link that moves them comes up only if either does (review P3). A
   * teammate still asking for documents (`docs-after-events`) is answered meanwhile. Answers whether files move.
   */
  private async linkIfWanted(): Promise<boolean> {
    const plan = this.heldPlan!;
    this.heldPlan = null;
    const mine = await this.local(() => this.wantsFiles()).catch(() => true);
    const late = this.docsLater();
    const [, theirs] = await Promise.all([
      this.send({ t: 'wants', files: mine }),
      this.readUntil('wants', (m) => (late && m.t === 'copy-ask' ? this.serveCopy(m) : Promise.reject(new SayBye('protocol', `${m.t} before wants`))))
    ]);
    this.report.files.wanted = { mine, theirs: theirs.files };
    if (!mine && !theirs.files) return false;
    this.link = await this.bringUp(this.link, plan);
    this.report.linkKind = this.link.kind;
    return this.movesFiles();
  }

  /**
   * Whether files should move between the two now (review P3): this phone lacks a recording it needs or reviews, or a
   * teammate's backup the other is known to hold, or a library file its kept passages need; or it holds a file the
   * server lacks that the other is not known to hold, which is what a teammate keeps a backup of. Library files nobody's
   * kept passages need bring no link up by themselves.
   */
  private async wantsFiles(): Promise<boolean> {
    const files = this.opt.files;
    if (!files) return false;
    const theirs = new Set(this.holdings.get(this.report.peer?.installKey ?? '')?.files ?? []);
    const wanted = await files.wanted(this.holdings);
    if (wanted.some((f) => f.group !== 'backup' || theirs.has(f.hash))) return true;
    if ((await files.held()).some((h) => !theirs.has(h))) return true;
    const reference = files.reference;
    if (!reference?.neededLacking || !this.opt.library) return false;
    const named = await libraryFilesNamed(this.opt.library);
    return reference.neededLacking([...named.files.values()], named.links);
  }

  /**
   * Once the events are in (2026-11-24, review item 15): the documents were asked for from the state as it was before
   * them, and an event in this session can name a template, flow, book names or material no ask covered. They are worked
   * out again, and when the list grew past what was seen, or a top-up or copy stopped at a bound, the pair is not
   * recorded as finished, so the room picks it again. Only with a teammate that serves documents: no other can help.
   */
  private async docsAfterEvents(): Promise<void> {
    const { opt, report } = this;
    if (!opt.library || !this.docsSeen || !this.theirHello?.can.includes(COPY_LIBRARY_ABILITY)) return;
    const seen = this.docsSeen;
    // What the walk before the events found is this language's list too: kept, so it is served once newer data lists other versions (review item 17).
    await this.local(async () => { await this.listedDocs()?.note([...seen]).catch(() => undefined); });
    if (report.topUp?.capped || report.copy?.docs.capped) {
      report.docsAgain = true;
      return;
    }
    const lacking = await this.local(() => docsLackingOf(opt.library!));
    if (lacking.some((h) => !seen.has(h))) report.docsAgain = true;
  }

  /** Both sides work this out alike: documents wait for the events on a link that moves no files, when both said so (review P4). */
  private docsLater(): boolean {
    return !this.link.canMoveFiles && this.myCan.includes(DOCS_AFTER_EVENTS_ABILITY) && !!this.theirHello?.can.includes(DOCS_AFTER_EVENTS_ABILITY);
  }

  /** Both sides work this out alike: the link, and what both said in `can`. */
  private movesFiles(): boolean {
    return this.link.canMoveFiles && !!this.opt.files && this.myCan.includes('files') && !!this.theirHello?.can.includes('files');
  }

  private async settle(err: unknown): Promise<void> {
    this.report.code = nearbyCodeOf(err) ?? null;
    if (err instanceof HeardBye) {
      // On a QR link the newcomer ends the copy with `bye` `done`: the inviter's side is done too.
      const joinDone = err.reason === 'done' && !!this.report.join?.granted;
      this.report.ended = joinDone ? { how: 'done' } : { how: 'heard', reason: err.reason };
      // An older newcomer ended a copy this phone gave whole, and nothing followed it because its app is older (2026-11-24,
      // review item 14). Not before: a copy that dropped, or one this phone gave short, says nothing of the steps after it.
      if (joinDone && this.opt.join?.as === 'inviter' && !this.joinExchange() && !this.report.copyServed.stateRefused) this.report.join!.exchangeSkip = 'older';
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
      if (this.opt.time.now() - this.lastMoved >= (this.moving > 0 || this.newcomerOpening ? this.tune.fileStallMs : this.tune.stallMs)) {
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
  /**
   * The joiner's first message, on a link this phone hosts, or a drop after `replyMs`: the joiner sends `ready` at
   * once, so a connection that says nothing is a stranger's, and is closed (unproven, with no goodbye) to free its
   * place. Four silent connections from another app on this phone once held a hotspot's every place for the whole
   * attempt (security review, 2026-11-10).
   */
  private readyWithin(link: NearbyLink): Promise<Message> {
    const late = this.opt.time.sleep(this.tune.replyMs).then((): never => { throw new OfflineError('no ready in time'); });
    late.catch(() => undefined);
    return Promise.race([this.readOne(link), late]);
  }

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
      if (m.t === 'copy-ask' && !this.opt.copy && !this.opt.library && !this.opt.join) continue;
      if (COPY_ANSWERS.has(m.t) && !this.opt.takeCopy && !this.opt.library && this.opt.join?.as !== 'newcomer') continue;
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

  /**
   * What this phone says it can. On a QR link `files` and `library-files` speak for the ordinary
   * steps after the copy (`join-exchange`): the inviter's by its own options, and a newcomer's by
   * what its `exchange` promises, since its own pieces come only after the grant.
   */
  private abilities(): string[] {
    const { opt } = this;
    const join = opt.join;
    const newcomer = join?.as === 'newcomer' ? join : null;
    const exchange = !join ? false : newcomer ? !!newcomer.exchange : true;
    const files = !join ? !!opt.files : newcomer ? exchange : !!opt.files;
    const libraryFiles = !join ? !!(opt.files?.reference && opt.library) : newcomer ? !!newcomer.exchange?.library : !!(opt.files?.reference && opt.library);
    return [
      ...(files ? ['files'] : []), ...(join?.as === 'inviter' ? ['let-in'] : []), ...(opt.copy ? ['starting-copy'] : []), JOIN_DIRECT_ABILITY,
      ...(opt.copy || (opt.library && !join) ? [COPY_LIBRARY_ABILITY] : []),
      ...(opt.copy?.labels || (opt.library?.labels && !join) ? [COPY_LABELS_ABILITY] : []),
      ...(opt.copy?.shared || (opt.library?.shared && !join) ? [COPY_SHARED_ABILITY] : []),
      ...(opt.library && !join ? [DOCS_AFTER_EVENTS_ABILITY] : []),
      ...(opt.files && opt.arrange && !join ? [FILES_WHEN_WANTED_ABILITY] : []),
      ...(libraryFiles ? [LIBRARY_FILES_ABILITY] : []),
      ...(exchange ? [JOIN_EXCHANGE_ABILITY] : [])
    ];
  }

  private async myHello(): Promise<HelloMessage> {
    const { crypto, opt } = this;
    const can = this.abilities();
    this.myCan = can;
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
    if (opt.freshWithinMs !== undefined && !await this.recent(hello.chain, holder, opt.freshWithinMs)) throw new SayBye('identity', 'certificate not recent');
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
    this.noteName(chainNameOf(verdict));
    this.report.clockOff = Math.abs(hello.wallMs - opt.port.nearbyWallNow) > CLOCK_AHEAD_TOLERANCE_MS;
    await opt.keep.noteName(holder.installKey, holder.profileId);
    if (opt.notesMetForMs !== undefined && opt.freshWithinMs === undefined) {
      const now = opt.port.nearbyHelloNow;
      await opt.keep.noteMet({ key: holder.installKey, profileId: holder.profileId, day: nearbyDayOf(now) }, nearbyFirstDayWithin(now, opt.notesMetForMs));
    }
  }

  /** While open: its certificate was signed within the window, or this phone met it on Share nearby on a day that began within it. */
  private async recent(chain: readonly unknown[], holder: { installKey: string; profileId: string }, withinMs: number): Promise<boolean> {
    const now = this.opt.port.nearbyHelloNow;
    const signed = certificateSignedAt(chain);
    if (signed !== null && now - signed <= withinMs) return true;
    const met = await this.opt.keep.met(nearbyFirstDayWithin(now, withinMs));
    return met.some((m) => m.key === holder.installKey && m.profileId === holder.profileId);
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
    this.report.join = { pictures: null, granted: false, refused: null, exchange: false, exchangeSkip: null };
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
    // Used up is no failed check: the newcomer hears it as not let in, and asks a teammate whose pass has room.
    const usedUp = () => {
      report.join!.refused = NEARBY_PASS_USED_UP;
      return new SayBye('stopped', NEARBY_PASS_USED_UP);
    };
    if (ask.installKey === crypto.publicKey) throw refused('this phone');
    if (ask.profileId !== await newcomerProfileId(ask.installKey, ask.idSalt, crypto.sha256)) throw refused('id does not follow from the key');
    if (!await signedBy(crypto.verify, ask.installKey, nearbyBytes('proof', proofText(theirRole, this.keys!.th)), ask.proof)) throw refused('bad proof');
    report.peer = { installKey: ask.installKey, profileId: ask.profileId, deviceId: ask.deviceId, tag: '' };
    // This phone is its pass's only user, so it counts exactly whom the pass let in (2026-11-24, review item 7): past
    // `maxUses` every teammate and the server would refuse the newcomer, so the person is told before any tap.
    const { passId, maxUses } = join.pass.body;
    const used = await this.local(() => opt.keep.letIn(passId));
    if (!used.includes(ask.profileId) && used.length >= maxUses) throw usedUp();
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
    // Kept before the grant goes: a grant that never arrives costs a use here, never one past the pass's count.
    if (!(await this.local(() => opt.keep.noteLetIn(passId, ask.profileId, maxUses)))) throw usedUp();
    const proof = await crypto.sign(nearbyBytes('proof', proofText(opt.role, this.keys!.th)));
    const grant: Extract<Message, { t: 'join-grant' }> = {
      t: 'join-grant', chain: [first, issued.link], proof, discoveryKey: join.discovery.key, gen: join.discovery.gen, floor: join.discovery.floor,
      ...(join.features?.length ? { features: [...join.features] } : {})
    };
    // With the revocation list this phone holds, so the newcomer refuses a stolen phone from the start (2026-11-24, review
    // item 11); a list too long to ride in one message with the chain goes as before, after Have.
    await this.sendGrant(this.revoked ? { ...grant, revoked: { ...this.revoked.signed } } : grant, grant);
    report.join!.granted = true;
    // A newcomer on a build before 2026-11-24 ends with the copy; the report says so only once it has (`settle`).
    const goesOn = this.joinExchange();
    await this.local(() => this.noteJoined(ask.installKey, ask.profileId));
    // The link stays up for the starting copy, which the newcomer ends with `bye`; or, where both name `join-exchange`, with
    // its `have` once the copy is whole, and the ordinary steps follow on this link (2026-11-24, review item 2).
    for (;;) {
      const m = await this.take();
      this.newcomerOpening = false;
      if (m.t === 'copy-ask') {
        // Names and documents come after every state part and row: what the newcomer does next before its `have` is its own,
        // and its copy is whole, said as the ask comes, since a drop while answering it ends this loop (review item 3).
        const opening = goesOn && (m.part === 'names' || m.part === 'held' || m.part === 'doc');
        if (opening) report.join!.copyWhole = true;
        await this.serveCopy(m);
        this.newcomerOpening = opening;
      } else if (m.t === 'have' && goesOn) {
        this.stash.push(m);
        return this.exchange();
      }
    }
  }

  /** The grant, or, when it would not fit in one message, the same grant without the revocation list. */
  private async sendGrant(grant: Extract<Message, { t: 'join-grant' }>, plain: Extract<Message, { t: 'join-grant' }>): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = encodeMessage(grant);
    } catch (err) {
      if (!(err instanceof RangeError) || grant === plain) throw err;
      bytes = encodeMessage(plain);
    }
    await this.link.send(bytes);
    this.moved();
  }

  /** Both Hellos on a QR link named `join-exchange`: the ordinary steps follow a whole copy. */
  private joinExchange(): boolean {
    return this.myCan.includes(JOIN_EXCHANGE_ABILITY) && !!this.theirHello?.can.includes(JOIN_EXCHANGE_ABILITY);
  }

  /**
   * The other phone of a join is a teammate now, met on a screen with a tap (2026-11-24, review
   * item 8): its key noted as any Hello notes one, and, where this phone may share while LangQuest
   * is open (`notesMetForMs`), the day, so the quiet mode takes the two at once, whatever the age of
   * the inviter's certificate, which the newcomer's chain starts with.
   */
  private async noteJoined(key: string, profileId: string): Promise<void> {
    const { keep, notesMetForMs, freshWithinMs, port } = this.opt;
    // A newcomer whose `granted` answered no keep of the person's notes nothing: a join keeps nothing.
    if (!profileId || JOIN_ONLY_KEEPS.has(keep)) return;
    await keep.noteName(key, profileId);
    if (notesMetForMs === undefined || freshWithinMs !== undefined) return;
    const now = port.nearbyHelloNow;
    await keep.noteMet({ key, profileId, day: nearbyDayOf(now) }, nearbyFirstDayWithin(now, notesMetForMs));
  }

  /**
   * On a QR link after a whole copy (`join-exchange`): the ordinary steps 4 to 8 on the same link,
   * so the newcomer takes what the inviter's phone holds past the checkpoint its copy was, its
   * unsent work, the teammates' work it carries and their files (2026-11-24, review item 2).
   */
  private async exchange(): Promise<void> {
    this.report.join!.exchange = true;
    await this.prepare();
    const moveFiles = this.movesFiles();
    const them = await this.have();
    if (moveFiles) await this.holdingsStep(them);
    await this.eventsStep(them);
    await this.docsAfterEvents();
    if (moveFiles) await this.filesStep();
    await this.doneStep(moveFiles);
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
    // The Worker's list the inviter held (2026-11-24, review item 11): checked against the Worker's keys, and the chain against it.
    const listed = await this.grantRevoked(grant, orgId);
    const verdict = await checkChain(grant.chain, {
      rootKeys: opt.rootKeys, orgId, languageId, now: opt.port.nearbyHelloNow, verify: crypto.verify, sha256: crypto.sha256,
      ...(listed ? { revoked: listed.list } : {})
    });
    if (!verdict.ok) throw refused(verdict.reason);
    const { holder } = verdict;
    // The link names the key, id, device and name this phone asked with, and nothing else.
    if (verdict.links !== 2 || holder.installKey !== crypto.publicKey || holder.profileId !== join.profileId || holder.deviceId !== opt.deviceId || holder.name !== join.name) {
      throw refused('the grant names someone else');
    }
    if (!verdict.inviterKey || !await signedBy(crypto.verify, verdict.inviterKey, nearbyBytes('proof', proofText(theirRole, this.keys!.th)), grant.proof)) throw refused('bad proof');
    report.peer = { installKey: verdict.inviterKey, profileId: verdict.inviter ?? '', deviceId: '', tag: '' };
    const answered: NearbyJoinGranted = (await this.local(() => join.granted({
      chain: grant.chain, verdict, discovery: { key: grant.discoveryKey, gen: grant.gen, floor: grant.floor }, orgId, languageId, features: grant.features ?? [],
      revoked: listed?.signed ?? null
    }))) ?? {};
    report.join!.granted = true;
    // From here this phone is the person the grant names: its organization, language, chain and own keep.
    this.opt = {
      ...this.opt, orgId, languageId, chain: grant.chain,
      ...(answered.keep ? { keep: answered.keep } : {}), ...(answered.notesMetForMs !== undefined ? { notesMetForMs: answered.notesMetForMs } : {})
    };
    await this.local(async () => {
      await this.keepGrantRevoked(listed);
      await this.noteJoined(verdict.inviterKey!, verdict.inviter ?? '');
    });
    const target = answered.target ?? join.target;
    // Said once the passages are filled, before names, documents and the steps after the copy, which setting the person
    // waits on none of (2026-11-24, review items 2 and 3).
    if (target) await this.takeCopyFrom(target, join.whole ? () => join.whole!() : undefined);
    if (this.report.copy?.whole && join.exchange && await this.ownSteps(join.exchange)) return this.exchange();
    await this.send({ t: 'bye', reason: 'done' }).catch((err: unknown) => { if (!isDrop(err)) throw err; });
  }

  /**
   * After a whole copy: true once the newcomer's own pieces are in place for the ordinary steps on
   * this link; otherwise false, with why in the report (2026-11-24, review item 14), so the field
   * can tell an older inviter from pieces that would not open and from a person who left.
   */
  private async ownSteps(exchange: NonNullable<NearbyJoinNewcomer['exchange']>): Promise<boolean> {
    const join = this.report.join!;
    if (!this.joinExchange()) {
      if (this.myCan.includes(JOIN_EXCHANGE_ABILITY)) join.exchangeSkip = 'older';
      return false;
    }
    if (this.stopped) {
      join.exchangeSkip = 'left';
      return false;
    }
    const own = await this.local(() => exchange.open());
    if (own === 'left') {
      join.exchangeSkip = 'left';
      return false;
    }
    if (!own || !this.ownAsSaid(own)) {
      join.exchangeSkip = 'no-pieces';
      return false;
    }
    this.takeOwn(own);
    return true;
  }

  /** The grant's revocation list when it checks against the Worker's keys for this organization; one that does not is dropped and counted, as a `revoked` message's is. */
  private async grantRevoked(grant: Extract<Message, { t: 'join-grant' }>, orgId: string): Promise<{ signed: { text: string; kid: string; sig: string }; list: RevocationList } | null> {
    const m = grant.revoked;
    if (!m) return null;
    const root = this.opt.rootKeys.get(m.kid);
    const list = parseRevocationList(m.text, { orgId, kid: m.kid });
    if (root === undefined || !list || !await signedBy(this.crypto.verify, root, nearbyBytes('revoked', m.text), m.sig)) {
      this.report.revokedDropped += 1;
      return null;
    }
    return { signed: { text: m.text, kid: m.kid, sig: m.sig }, list };
  }

  /** Before the copy is asked for: the grant's list kept in this person's keep, unless the keep holds a newer one, and the session checks by the newer. */
  private async keepGrantRevoked(listed: { signed: { text: string; kid: string; sig: string }; list: RevocationList } | null): Promise<void> {
    const { keep } = this.opt;
    const held = await keep.revoked();
    const best = [held, this.revoked].reduce((a, b) => (b && (!a || b.list.seq > a.list.seq) ? b : a), null as typeof held);
    if (listed && listed.list.seq > (best?.list.seq ?? 0)) {
      // With no keep of the person's answered, the list is the session's alone: it still checks by it.
      if (!JOIN_ONLY_KEEPS.has(keep)) await keep.saveRevoked(listed.signed);
      this.revoked = listed;
      this.report.revokedTaken = listed.list.seq;
      return;
    }
    this.revoked = best;
  }

  /**
   * A newcomer's own pieces carry what its Hello said: `library-files` needs its library documents
   * and the files' library part; and the ordinary steps need a keep of the person's, from the pieces
   * or from `granted`, since a join's own keeps nothing.
   */
  private ownAsSaid(own: NearbyJoinOwn): boolean {
    if (!own.keep && JOIN_ONLY_KEEPS.has(this.opt.keep)) return false;
    return !this.myCan.includes(LIBRARY_FILES_ABILITY) || (!!own.library && !!own.files.reference);
  }

  /** A newcomer's own pieces, from its whole copy on: the ordinary steps run on its language, door, signer and files. */
  private takeOwn(own: NearbyJoinOwn): void {
    this.opt = {
      ...this.opt, port: own.port, gate: own.gate, signer: own.signer, files: own.files, ...(own.keep ? { keep: own.keep } : {}), ...(own.library ? { library: own.library } : {})
    };
  }

  /**
   * A teammate's answer to one ask, only after its read gate passed this chain. A starting copy's
   * parts only on the same versions. Documents, named by their hash, on any versions: from the
   * member's own library on an ordinary link, else as the starting copy has them.
   */
  private async serveCopy(ask: Extract<Message, { t: 'copy-ask' }>): Promise<void> {
    const { opt, report } = this;
    const granted = !opt.join || report.join?.granted === true;
    const docsOnly = ask.part === 'held' || ask.part === 'doc' || ask.part === 'labels' || ask.part === 'shared';
    let answer: Awaited<ReturnType<StartingCopySender['answer']>>;
    if (!granted) answer = 'not-allowed';
    else if (docsOnly && opt.library && !opt.join) {
      this.librarySender ??= LibraryDocsSender.of(opt.library, this.listedDocs());
      answer = await this.local(() => this.librarySender!.answer(ask)).catch((): 'not-here' => 'not-here');
    } else if (!opt.copy) answer = 'not-allowed';
    else if (!this.sameVersions()) answer = 'versions';
    else {
      this.sender ??= new StartingCopySender(opt.copy, opt.languageId, this.listedDocs());
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

  /** What this language's earlier lists named on this phone (`nearbyListed`, review item 17), when its keep holds them. */
  private listedDocs(): NearbyListedDocs | undefined {
    const { keep } = this.opt;
    return keep.listedDocs && keep.noteListedDocs ? { before: () => keep.listedDocs!(), note: (list) => keep.noteListedDocs!(list) } : undefined;
  }

  /** One ask and its answer. A `have` that came first is kept for step 4, and the other side's own asks are answered meanwhile, so two phones asking at once both go on. */
  /**
   * Asks to the other phone, several at once (review P5): each goes out in the order asked, and the other answers them
   * in the order they came, as every build does, so the answers are matched to the asks in turn. One reader takes them,
   * and serves the other's own asks that come between.
   */
  private copyAsker(): CopyAsker {
    return (ask) => {
      const answer = new Promise<Extract<Message, { t: 'copy-part' | 'copy-no' }>>((resolve, reject) => { this.awaiting.push({ resolve, reject }); });
      const sent = (this.askSent = this.askSent.then(() => this.send({ t: 'copy-ask', ...ask })));
      sent.then(() => this.readAnswers(), (err: unknown) => this.failAsks(err));
      return answer;
    };
  }

  /** Asks sent and not yet answered, oldest first. */
  private readonly awaiting: { resolve: (m: Extract<Message, { t: 'copy-part' | 'copy-no' }>) => void; reject: (err: unknown) => void }[] = [];
  private askSent: Promise<void> = Promise.resolve();
  private answering: Promise<void> | null = null;

  private failAsks(err: unknown): void {
    for (const w of this.awaiting.splice(0)) w.reject(err);
  }

  private readAnswers(): void {
    if (this.answering) return;
    this.answering = (async () => {
      try {
        while (this.awaiting.length > 0) {
          const m = await this.takeLink();
          if (m.t === 'copy-part' || m.t === 'copy-no') this.awaiting.shift()!.resolve(m);
          // One Have comes per session: a second while a newcomer waits on a part is a teammate filling its memory (security review, 2026-11-10).
          else if (m.t === 'have' && !this.opt.join && !this.stash.some((x) => x.t === 'have')) this.stash.push(m);
          // Documents after the events: a teammate that lacked none may say it is done while this phone still asks (review P4).
          else if (m.t === 'done' && this.docsLater() && !this.stash.some((x) => x.t === 'done')) this.stash.push(m);
          // So may it say whether it wants files (review P3).
          else if (m.t === 'wants' && this.heldPlan && !this.stash.some((x) => x.t === 'wants')) this.stash.push(m);
          else if (m.t === 'copy-ask') await this.serveCopy(m);
          else throw new SayBye('protocol', `${m.t} during a copy`);
        }
      } catch (err) {
        this.failAsks(err);
      } finally {
        this.answering = null;
        // An ask that came while the last answer was taken is read now.
        if (this.awaiting.length > 0) this.readAnswers();
      }
    })();
  }

  /** How this phone asks the other for documents: only what it holds when it can say, and with `pipeShare` a share of the Bluetooth pipe. */
  private docsAsk(pipeShare: boolean): LibraryDocsAsk {
    this.docsSeen ??= new Set();
    return {
      seen: this.docsSeen,
      held: !!this.theirHello?.can.includes(COPY_LIBRARY_ABILITY),
      ...(pipeShare && !this.link.canMoveFiles ? { budgetChars: NEARBY_TOP_UP_PIPE_CHARS } : {}),
      local: (work) => this.local(work),
      ...(this.theirHello?.can.includes(COPY_LABELS_ABILITY) ? { labels: true } : {}),
      ...(this.theirHello?.can.includes(COPY_SHARED_ABILITY) ? { shared: true } : {})
    };
  }

  /**
   * A copy from this teammate. The report holds it as whole as soon as the passages are filled,
   * before names and documents (2026-11-24, review item 3), and `whole` is heard then, so a link
   * that goes during them still leaves the person set. Such a drop ends the session as dropped,
   * with the copy whole and `docs.cut`, rather than going on to steps no link can carry.
   */
  private async takeCopyFrom(target: Omit<StartingCopyTarget, 'sha256'>, whole?: () => Promise<void>): Promise<void> {
    try {
      // A newcomer's copy takes every document it can over any link: setting the person waits on none of them.
      const taken = await takeStartingCopy(this.copyAsker(), { ...target, sha256: this.crypto.sha256 }, this.docsAsk(false), async (soFar) => {
        this.report.copy = soFar;
        if (soFar.filled > 0) this.report.changed = true;
        this.moved();
        if (whole) await this.local(whole);
      });
      this.report.copy = taken;
      if (taken.filled > 0) this.report.changed = true;
      if (taken.docs.cut) throw new OfflineError('the link went after the copy was whole');
    } catch (err) {
      if (!(err instanceof CopyRefused)) throw err;
      this.report.copyRefused = err.reason;
    }
  }

  /** After an ordinary Hello: a newcomer whose copy is not whole yet asks a teammate that offers one, on the same versions. */
  private async askCopy(): Promise<void> {
    const target = this.opt.takeCopy;
    if (!target || !this.theirHello?.can.includes('starting-copy')) return;
    // A room passes a target while its person's copy may be short or lost; once it is whole, nobody is asked (review item 26).
    if (target.wanted && !(await this.local(() => target.wanted!()))) return;
    // A teammate on another version can never finish it: say so, so the newcomer is told why and looks for another.
    if (!this.sameVersions()) {
      this.report.versionsDiffer = true;
      this.report.copyRefused = 'versions';
      return;
    }
    await this.takeCopyFrom(target);
  }

  /**
   * After an ordinary Hello, any member (14.1, 2026-11-24): the documents its language uses that it
   * lacks, from a teammate that serves them, so a copy that came short, or a guide a teammate
   * fetched online, reaches this phone. Nothing is asked when nothing is lacking.
   */
  private async topUp(): Promise<void> {
    const library = this.opt.library;
    if (!library || !this.theirHello?.can.includes(COPY_LIBRARY_ABILITY)) return;
    const how = this.docsAsk(true);
    // The rows of the Bibles other organizations share that the team reads first, so the list the documents come from names them (review item 9).
    const shared = how.shared && library.shared ? await takeShared(this.copyAsker(), library.shared) : 0;
    const docs = await takeLibraryDocs(this.copyAsker(), library, { sha256: this.crypto.sha256 }, how);
    // The names its library items go by in the app's language, while what it keeps came from no server (review item 13).
    const labels = how.labels && library.labels
      ? await takeLabels(this.copyAsker(), library.labels, async () => labelKeysOf(library.org() ?? { library: {} }, await this.local(() => docsListOf(library))))
      : 0;
    const taken = { ...docs, ...(labels > 0 ? { labels } : {}), ...(shared > 0 ? { shared } : {}) };
    if (taken.kept + taken.refused + taken.missing + labels + shared > 0 || taken.capped) this.report.topUp = taken;
    if (taken.kept > 0 || labels > 0 || shared > 0) this.report.changed = true;
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
    // Both say `files-when-wanted`: the link waits for the events unless a starting copy is to come now (review P3).
    const later = this.myCan.includes(FILES_WHEN_WANTED_ABILITY) && !!this.theirHello?.can.includes(FILES_WHEN_WANTED_ABILITY);
    const soon = later ? await this.copySoon() : false;
    const [, theirs] = await Promise.all([this.send({ t: 'arrange', summary, radios: mine, ...(later ? { soon } : {}) }), this.expect('arrange')]);
    this.arranged = true;
    // Their `arrange` says they passed this phone's `hello`.
    const handed = opt.role === 'i' ? this.handOnNow() : null;
    if (handed) await this.send({ t: 'discovery-key', ...handed });
    // This phone's Hello always lists it, so theirs decides.
    const joinDirect = !!this.theirHello?.can.includes(JOIN_DIRECT_ABILITY);
    const plan = opt.role === 'i' ? arrangePlan(mine, theirs.radios, opt.arrange?.order, { joinDirect }) : arrangePlan(theirs.radios, mine, opt.arrange?.order, { joinDirect });
    if (later && !soon && theirs.soon !== true) {
      this.heldPlan = plan;
      return;
    }
    this.link = await this.bringUp(this.link, plan);
  }

  /** This phone will ask the other for a starting copy in this session (`askCopy`), which wants the link that moves files at once. */
  private async copySoon(): Promise<boolean> {
    const target = this.opt.takeCopy;
    if (!target || !this.theirHello?.can.includes('starting-copy') || !this.sameVersions()) return false;
    return target.wanted ? await this.local(() => target.wanted!()).catch(() => true) : true;
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
        const heard = hosting ? await this.readyWithin(link) : (await Promise.all([link.send(ready), this.readOne(link)]))[1];
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
        hosted = await opt.arrange!.radio.host(kind, kind === 'wifi-direct' ? wifiDirectOptions(this.crypto, band5) : kind === 'awdl' ? awdlOptions(this.crypto) : { band5 });
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

  /**
   * Parts of one entry as they come. A part that does not go on from the last starts over, and what it dropped counts.
   * A key not held yet is kept only under `NEARBY_HOLDINGS_MAX_KEYS` in all, and a newcomer's only while its pass has
   * fewer than `maxUses` keys here, as batches are: one pass can mint any number of newcomers offline, and their
   * entries, kept for good and spread, once grew Have past what a link carries (security review, 2026-11-10).
   */
  private holdingsReader(heard: Map<string, HoldingEntry>): (m: Message) => Promise<void> {
    let open: { key: string; counter: number; files: string[]; bad: boolean; parts: number } | null = null;
    // Bounds on what an honest phone sends, so endless parts or entries cannot hold the session open (security review, 2026-11-10).
    let entries = 0;
    const keys = new Set([...this.holdings.keys(), ...heard.keys()]);
    const underPass = new Map<string, number>();
    for (const e of [...this.holdings.values(), ...heard.values()]) {
      const passId = passIdOfChain(e.chain);
      if (passId) underPass.set(passId, (underPass.get(passId) ?? 0) + 1);
    }
    const room = (key: string, pass: { passId: string; maxUses: number } | null): boolean =>
      keys.has(key) || (keys.size < NEARBY_HOLDINGS_MAX_KEYS && (!pass || (underPass.get(pass.passId) ?? 0) < pass.maxUses));
    return async (m) => {
      if (m.t !== 'holdings') throw new SayBye('protocol', `${m.t} in holdings`);
      if (!open || open.key !== m.key || open.counter !== m.counter) {
        if (open) this.report.holdings.dropped += 1;
        if (++entries > NEARBY_HOLDINGS_MAX_KEYS + 1) throw new SayBye('protocol', 'more holdings entries than a phone keeps');
        open = { key: m.key, counter: m.counter, files: [], bad: false, parts: 0 };
      }
      const entry = open;
      if (++entry.parts > HOLDINGS_PARTS_MAX) throw new SayBye('protocol', 'more parts than one entry takes');
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
      if (!good || !room(m.key, good.pass)) {
        this.report.holdings.dropped += 1;
        return;
      }
      if (!keys.has(m.key)) {
        keys.add(m.key);
        if (good.pass) underPass.set(good.pass.passId, (underPass.get(good.pass.passId) ?? 0) + 1);
      }
      heard.set(m.key, { counter: m.counter, files: entry.files, hold: m.hold!, sig: m.sig!, chain: chainAsSigned(m.chain!) });
      // An entry kept: the name its chain gives someone let in offline goes to the screen (review item 12).
      this.noteName(good.named);
    };
  }

  /** Outside any lock, before `mergeHoldings`, one entry at a time, and a failure never ends the session. Holds: the pass of a newcomer's chain, or null for a member's. */
  private async holdingHolds(key: string, counter: number, files: readonly string[], hold: boolean, sig: string, chain: ChainLink[]): Promise<false | { pass: { passId: string; maxUses: number } | null; named: NearbyChainName | null }> {
    const { opt, crypto } = this;
    const verdict = await checkChain(chain, {
      rootKeys: opt.rootKeys, orgId: opt.orgId, languageId: opt.languageId, now: null, verify: crypto.verify, sha256: crypto.sha256, ...(this.revoked ? { revoked: this.revoked.list } : {})
    });
    if (!verdict.ok || verdict.holder.installKey !== key) return false;
    // A person removed, or let in by an inviter since revoked or removed, holds nothing that counts as a copy: Hello's own read gate.
    if (opt.gate.people(verdict).privilegesIn(verdict.holder.profileId, opt.languageId).size === 0) return false;
    const filesHash = await holdingsFilesHash(files, crypto.sha256);
    if (!await signedBy(crypto.verify, key, nearbyBytes('holdings', holdingsText({ orgId: opt.orgId, streamId: opt.languageId, key, counter, filesHash, hold })), sig)) return false;
    const pass = verdict.links === 2 ? (chain[1] as InviteLink).body.pass.body : null;
    return { pass: pass ? { passId: pass.passId, maxUses: pass.maxUses } : null, named: chainNameOf(verdict) };
  }

  /** A name a checked chain gave, for the screen: one per person, the last heard, and no more than `NEARBY_NAMES_REPORTED`. */
  private noteName(named: NearbyChainName | null): void {
    if (!named) return;
    const names = this.report.names;
    const at = names.findIndex((n) => n.profileId === named.profileId);
    if (at >= 0) names[at] = named;
    else if (names.length < NEARBY_NAMES_REPORTED) names.push(named);
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
    this.noteName(receipt.named ?? null);
    got.pages += 1;
    got.events += receipt.kept;
    got.refused += receipt.refused.length;
    if (receipt.counted) got.counted += 1;
    if (receipt.kept > 0) this.report.changed = true;
    if (receipt.overBudget) got.overBudget += 1;
    // A page already counted is ignored, and counts as a drop: an honest sender sends only what Have says is not, and
    // the same page sent again and again once held this phone's only session open (security review, 2026-11-10).
    if (receipt.outcome === 'taken') return;
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
  /** Both phones said `library-files`, and this one can: they say which library files they hold first. */
  private referenceFiles(): boolean {
    const { opt } = this;
    return !!opt.files?.reference && !!opt.library && this.myCan.includes(LIBRARY_FILES_ABILITY) && !!this.theirHello?.can.includes(LIBRARY_FILES_ABILITY);
  }

  /**
   * Step 7's start with `library-files` (2026-11-24): each phone says which library files it holds
   * that its language's documents name, in parts, so neither asks the other in vain. Of theirs it
   * keeps only those its own documents name: the rest are of no use to it.
   */
  private async libHeldStep(): Promise<void> {
    const { opt } = this;
    const mine = await this.local(async () => {
      const reference = opt.files!.reference!;
      const named = await libraryFilesNamed(opt.library!);
      this.libraryFiles = named.files;
      const links = new Map<string, string>();
      if (reference.links) {
        for (const url of named.links) {
          // Each address's key once a run, not every session (review P7).
          let keys = LINK_KEYS.get(this.crypto.sha256);
          if (!keys) LINK_KEYS.set(this.crypto.sha256, (keys = new Map()));
          let key = keys.get(url);
          if (key === undefined) {
            key = bytesToHex(await this.crypto.sha256(utf8Encode(url)));
            if (keys.size >= LINK_KEYS_KEPT) keys.clear();
            keys.set(url, key);
          }
          links.set(key, url);
        }
      }
      this.libraryLinks = links;
      const linksHere = reference.links ? new Set(await reference.links.held([...links.values()])) : new Set<string>();
      const keysHere = [...links].filter(([, url]) => linksHere.has(url)).map(([key]) => key);
      return [...await reference.held([...named.files.keys()]), ...keysHere].sort();
    });
    const said = { held: mine.length, theirs: 0, got: 0, served: 0, short: 0 };
    this.report.libraryFiles = said;
    const sending = async () => {
      for (let i = 0; i === 0 || i < mine.length; i += NEARBY_HOLDINGS_MESSAGE_FILES) {
        await this.send({ t: 'lib-held', files: mine.slice(i, i + NEARBY_HOLDINGS_MESSAGE_FILES), more: i + NEARBY_HOLDINGS_MESSAGE_FILES < mine.length });
      }
    };
    const reading = async () => {
      let heard = 0;
      for (;;) {
        const m = await this.expect('lib-held');
        heard += m.files.length;
        if (heard > NEARBY_HOLDINGS_MAX_FILES) throw new SayBye('protocol', 'too many library files');
        for (const h of m.files) if (this.libraryFiles?.has(h) || this.libraryLinks?.has(h)) this.theirLibrary.add(h);
        if (!m.more) return;
      }
    };
    await Promise.all([sending(), reading()]);
    said.theirs = this.theirLibrary.size;
  }

  private async filesStep(): Promise<void> {
    if (this.referenceFiles()) await this.libHeldStep();
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
    // Not a recording of this language: a library file its documents name, in the format they say, if this phone said it holds it.
    let reference = false;
    const unnamed = 'no' in answer && answer.no === 'not-referenced';
    const named = unnamed ? this.libraryFiles?.get(ask.hash) : undefined;
    const link = unnamed && !named ? this.libraryLinks?.get(ask.hash) : undefined;
    const got = named ? await this.opt.files!.reference?.serve(named).catch(() => null)
      : link ? await this.opt.files!.reference?.links?.serve(link).catch(() => null) : null;
    if (got) {
      answer = got;
      reference = true;
    }
    if ('no' in answer) {
      files.answeredNo += 1;
      await this.send({ t: 'file-no', transferId: ask.transferId, reason: answer.no });
      return;
    }
    this.moving += 1;
    try {
      await this.link.sendFile({ transferId: ask.transferId, uri: answer.uri, size: answer.size });
      if (reference && this.report.libraryFiles) this.report.libraryFiles.served += 1;
      else files.served += 1;
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
    const recordings = await opt.files!.wanted(this.holdings);
    // Library files after what this person needs and reviews, before backups (Carl, 2026-11-24: small files first), and only those the other said it holds.
    const reference = opt.files!.reference;
    const library = this.libraryFiles && reference
      ? reference.lacking([...this.libraryFiles.values()].filter((f) => this.theirLibrary.has(f.hash))).map((f): WantedFile => ({ hash: f.hash, format: f.format, group: 'reference' }))
      : [];
    // Then what documents name by address (FIA's), on the other's word, what a kept passage needs first.
    const keyOf = new Map([...(this.libraryLinks ?? [])].map(([key, url]) => [url, key]));
    const links = this.libraryLinks && reference?.links
      ? (await reference.links.lacking([...this.libraryLinks].filter(([key]) => this.theirLibrary.has(key)).map(([, url]) => url)))
        .flatMap((url): WantedFile[] => {
          const key = keyOf.get(url);
          const format = libraryLinkFormat(url);
          return key && format ? [{ hash: key, format, group: 'link', url }] : [];
        })
      : [];
    // A source's chapter audio last, after backups (Carl, 2026-11-24): large, and the phone can play it from the web meanwhile.
    const sourceAudio = new Set([...(this.libraryFiles?.values() ?? [])].filter((f) => f.kind === 'source').map((f) => f.hash));
    const wanted = [
      ...recordings.filter((f) => f.group !== 'backup'), ...library.filter((f) => !sourceAudio.has(f.hash)), ...links,
      ...recordings.filter((f) => f.group === 'backup'), ...library.filter((f) => sourceAudio.has(f.hash))
    ];
    const theirs = new Set(this.holdings.get(report.peer!.installKey)?.files ?? []);
    let backupsFrom: number | null = null;
    if (opt.files!.take) {
      const { noRoom, short } = await opt.files!.take({
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
      if (short && report.libraryFiles) report.libraryFiles.short += short;
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
      // A library file never makes room: with too little, this one waits and the rest go on.
      if (!stage && (file.group === 'reference' || file.group === 'link')) {
        if (report.libraryFiles) report.libraryFiles.short += 1;
        continue;
      }
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
      // Native wrote and hashed it. A teammate's wrong bytes never get this file's name. A file named by its
      // address has no hash to hold it to: it comes on the teammate's word, and is fetched again once online.
      if (file.group !== 'link' && outcome.sha256 !== file.hash) {
        report.files.failed += 1;
        await opt.files!.discard(stage.stagingUri);
        return;
      }
      await opt.files!.landed(file, stage.stagingUri, outcome.size);
      if ((file.group === 'reference' || file.group === 'link') && report.libraryFiles) report.libraryFiles.got += 1;
      else report.files.got += 1;
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
    // Documents after the events (review P4): a teammate may still be asking while this phone waits for its done.
    const late = this.docsLater();
    const reader = moveFiles ? this.holdingsReader(heard)
      : (m: Message) => (late && m.t === 'copy-ask' ? this.serveCopy(m) : Promise.reject(new SayBye('protocol', `${m.t} before done`)));
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
    // A session that cut backups records none, so the pair can go on later; nor does a QR link's, which knows no find tag;
    // nor one whose events named documents no ask covered, or whose documents stopped at a bound (review item 15).
    if (!report.files.cutBackups && !report.docsAgain && report.peer!.tag !== '') await opt.keep.recordPeer({ tag: report.peer!.tag, gen: opt.generations?.sessionGen ?? 0, mine, theirs: final.summary });
    await this.send({ t: 'bye', reason: 'done' }).catch((err: unknown) => { if (!isDrop(err)) throw err; });
    // Both finals are here, so whatever comes now, or no bye at all, changes nothing.
    await this.take().catch(() => undefined);
  }
}
