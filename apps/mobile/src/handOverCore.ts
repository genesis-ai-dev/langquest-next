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

export type Next =
  /** Some of it is still to go: try again later. */
  | { kind: 'keep'; handOver: HandOver }
  /** All of it went: end their session and forget it. */
  | { kind: 'done' }
  /** It cannot go as them any more; it waits on the phone for their next sign-in. */
  | { kind: 'drop' };

export function afterAttempt(h: HandOver, a: Attempt): Next {
  if (a.sessionGone) return { kind: 'drop' };
  const handOver = withoutFinished(h, a.finished, a.unregistered);
  if (a.eventsLeft === 0 && a.accountLeft === 0 && handOver.uploads.length === 0 && !handOver.pushToken) return { kind: 'done' };
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
  return [...list.filter((x) => x.actorId !== h.actorId), { ...h, uploads, ...(pushToken ? { pushToken } : {}) }];
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
