import type { BlobRef } from '@langquest-next/core';

/**
 * Someone signed out of a shared phone with work still to send
 * (decisions.md 60). The phone keeps their session, under its own key,
 * only until that work has gone; nothing on screen can use it. Their
 * events wait in the phone's log as always; this lists what the log does
 * not know about: the recordings the server had not confirmed, and the
 * notifications still pointed at this phone.
 */
export interface HandOver {
  actorId: string;
  uploads: PendingUpload[];
  /** Their notifications, still pointed at this phone because it was offline at sign-out. */
  pushToken?: string;
  savedAt: string;
  /** They switched person rather than signing out (decision 88): their session stays for their code. */
  parked?: Parked;
}

/**
 * Someone who stepped aside on a shared phone (decision 88). Their session
 * stays under the hand-over key after their work has gone, until they come
 * back with their code, offline or not. The code is checked on the phone
 * only and never sent: its hash and salt live here.
 */
export interface Parked {
  name: string;
  salt: string;
  codeHash: string;
  /** Wrong codes in a row; from the fifth, another try waits (`waitUntil`). */
  misses: number;
  waitUntil?: string;
}
export interface PendingUpload { orgId: string; languageId: string; ref: BlobRef }

/** What one attempt to send their work found. */
export interface Attempt {
  /** Their session is gone for good: the server refused to renew it. */
  sessionGone: boolean;
  /** Events and account changes of theirs still queued afterwards. */
  eventsLeft: number;
  accountLeft: number;
  /** Uploads that landed this time, or whose file is no longer here, by hash. */
  finished: string[];
  /** Their notifications no longer come to this phone. */
  unregistered: boolean;
}

type Next =
  /** Some of it is still to go: try again later. */
  | { kind: 'keep'; handOver: HandOver }
  /** All of it went: end their session and forget it. */
  | { kind: 'done' }
  /** It cannot go as them any more; it waits on the phone for their next sign-in. */
  | { kind: 'drop' };

export function afterAttempt(h: HandOver, a: Attempt): Next {
  if (a.sessionGone) return { kind: 'drop' };
  const handOver = withoutFinished(h, a.finished, a.unregistered);
  // Someone who switched person keeps their session for when they come back (decision 88).
  if (a.eventsLeft === 0 && a.accountLeft === 0 && handOver.uploads.length === 0 && !handOver.pushToken && !h.parked) return { kind: 'done' };
  return { kind: 'keep', handOver };
}

export function withoutFinished(h: HandOver, finished: readonly string[], unregistered: boolean): HandOver {
  const done = new Set(finished);
  const { pushToken, ...rest } = h;
  return { ...rest, uploads: h.uploads.filter((u) => !done.has(u.ref.hash)), ...(pushToken && !unregistered ? { pushToken } : {}) };
}

/**
 * Add or replace one person's hand-over. Signing out twice before the
 * phone is online keeps one record, with every recording either time named.
 */
export function withHandOver(list: HandOver[], h: HandOver): HandOver[] {
  const before = list.find((x) => x.actorId === h.actorId);
  const seen = new Set(h.uploads.map((u) => u.ref.hash));
  const uploads = [...h.uploads, ...(before?.uploads ?? []).filter((u) => !seen.has(u.ref.hash))];
  const pushToken = h.pushToken ?? before?.pushToken;
  // Signing out leaves no code behind; switching again brings the code chosen this time.
  return [...list.filter((x) => x.actorId !== h.actorId), { ...h, uploads, ...(pushToken ? { pushToken } : {}) }];
}

// ---- coming back with a code (decision 88) -------------------------------------------------

/** A code is four digits: easy to type on any phone, in any script's number pad. */
export function isCode(code: string): boolean {
  return /^[0-9]{4}$/.test(code);
}

/** What is stored for a code: never the code itself. */
export function codeText(salt: string, actorId: string, code: string): string {
  return `langquest-switch-code:v1:${salt}:${actorId}:${code}`;
}

const FREE_MISSES = 4;
const FIRST_WAIT_MS = 60_000;
const LONGEST_WAIT_MS = 60 * 60_000;

/** How long before another try, in milliseconds; 0 when it may be tried now. */
export function waitLeft(p: Parked, now: number): number {
  return p.waitUntil ? Math.max(0, Date.parse(p.waitUntil) - now) : 0;
}

/** A wrong code: four are free, then each waits twice as long as the last, up to an hour. */
export function afterMiss(p: Parked, now: number): Parked {
  const misses = p.misses + 1;
  if (misses <= FREE_MISSES) return { ...p, misses };
  const wait = Math.min(LONGEST_WAIT_MS, FIRST_WAIT_MS * 2 ** (misses - FREE_MISSES - 1));
  return { ...p, misses, waitUntil: new Date(now + wait).toISOString() };
}

export type CodeCheck = { kind: 'ok' } | { kind: 'wrong'; parked: Parked } | { kind: 'wait'; ms: number };

/** Check a code against what was saved, counting misses. `sha256` returns hex. */
export async function checkCode(p: Parked, actorId: string, code: string, sha256: (text: string) => Promise<string>, now: number): Promise<CodeCheck> {
  const ms = waitLeft(p, now);
  if (ms > 0) return { kind: 'wait', ms };
  if (isCode(code) && await sha256(codeText(p.salt, actorId, code)) === p.codeHash) return { kind: 'ok' };
  return { kind: 'wrong', parked: afterMiss(p, now) };
}

/** A torn write or garbage reads as no hand-overs, never a crash on launch. */
export function parseHandOvers(raw: string | null | undefined): HandOver[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((h): h is HandOver =>
      typeof h === 'object' && h !== null && typeof (h as HandOver).actorId === 'string' && Array.isArray((h as HandOver).uploads));
  } catch {
    return [];
  }
}
