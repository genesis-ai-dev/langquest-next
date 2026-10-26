import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterAttempt, courierReport, deliverHandOver, ensureDeviceId, parseHandOvers, withHandOver, withoutFinished, type EventStore, type HandOver, type PendingUpload } from '@langquest-next/sync';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { accountOutbox } from '../account/accountData';
import { getBlobStore, type BlobStore } from './blobs';
import { handOverPushToken } from '../notifications/notifications';
import { noteExpected } from '../diagnostics/report';
import { flushDiagnostics } from '../diagnostics/diagnostics';
import { recordAuth } from '../auth/authDiag';
import { OutcomeThrottle } from '../auth/authOutcome';
import { getStore } from './store';
import { actAs, forgetKeptSession, keepSessionAndSignOut, keptSession, keptSessionRaw } from '../server/handOver';
import { dropLockedSession, keepLockedAfterHandOver } from '../server/lock';

/**
 * Shared phones (decisions.md 60): signing out with work still to send
 * hands that work to a courier, which sends it as its author the next time
 * the phone is online, whoever is signed in by then. A browser forgets
 * everything on sign-out instead (forgetBrowser.ts), so the web keeps the
 * old rule: sign out once it has synced.
 */
export const HANDS_OVER = Platform.OS !== 'web';

const LIST_KEY = 'hand-overs';

let writes: Promise<unknown> = Promise.resolve();
export const added = new Set<() => void>();
function change(fn: (list: HandOver[]) => HandOver[]): Promise<void> {
  const next = writes.then(async () => {
    const list = fn(parseHandOvers(await AsyncStorage.getItem(LIST_KEY)));
    if (list.length > 0) await AsyncStorage.setItem(LIST_KEY, JSON.stringify(list));
    else await AsyncStorage.removeItem(LIST_KEY);
  });
  writes = next.catch(() => {});
  return next;
}
async function handOvers(): Promise<HandOver[]> {
  await writes;
  return parseHandOvers(await AsyncStorage.getItem(LIST_KEY));
}

/**
 * One thing at a time with a person's hand-over: a delivery, or their
 * coming back from the lock (takeBackHandOver), so the courier and the
 * signed-in app never hold their session at once.
 */
const turns = new Map<string, Promise<unknown>>();
function turn<T>(actorId: string, fn: () => Promise<T>): Promise<T> {
  const next = (turns.get(actorId) ?? Promise.resolve()).then(fn);
  const settled = next.catch(() => {});
  turns.set(actorId, settled);
  void settled.then(() => { if (turns.get(actorId) === settled) turns.delete(actorId); });
  return next;
}

/** People coming back from the lock right now: their delivery stops before its next recording. */
const released = new Set<string>();
class TakenBack extends Error {}

/**
 * Sign out, leaving this person's unsent work to go as them. Their session
 * moves to its own key with no server call, so this works offline and the
 * session stays good for the courier; the app then shows the signed-out
 * screen as after any sign-out.
 */
export async function signOutHandingOver(actorId: string, uploads: PendingUpload[]): Promise<void> {
  const pushToken = await handOverPushToken();
  await keepSessionAndSignOut(actorId, () =>
    change((list) => withHandOver(list, { actorId, uploads, ...(pushToken ? { pushToken } : {}), savedAt: new Date().toISOString() })));
  for (const listener of added) listener();
}

/** Stop acting for this person. `endSession` signs the kept session out on the server too. */
async function forget(actorId: string, endSession: boolean): Promise<void> {
  await forgetKeptSession(actorId, endSession);
  await change((list) => list.filter((h) => h.actorId !== actorId));
}

/**
 * Courier attempts for diagnostics (`auth` op `courier`): an offline phone
 * polls every few minutes, so a repeat is recorded on a change or once an
 * hour. Keyed by the person in memory only; the record never names them.
 */
const courierNotes = new OutcomeThrottle();

/** Their events still queued on this phone, over every stream. */
async function eventsOf(store: EventStore, actorId: string): Promise<number> {
  let n = 0;
  for (const { orgId, streamId } of await store.pendingStreamsBy(actorId)) n += await store.pendingCountBy(orgId, streamId, actorId);
  return n;
}

const hoursSince = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 3_600_000)) : undefined;
};

/** A session that cannot be used: out of reach for now, or refused for good. Counts what waits, not whose. */
async function noteSession(h: HandOver, store: EventStore, outcome: 'unreachable' | 'gone'): Promise<void> {
  if (!courierNotes.shouldRecord(h.actorId, outcome, Date.now())) return;
  const ageH = hoursSince(h.savedAt);
  recordAuth('courier', outcome, {
    n: { pending: await eventsOf(store, h.actorId).catch(() => 0), uploadsLeft: h.uploads.length, ...(ageH !== undefined ? { ageH } : {}) }
  });
}

/** One person's work, sent as them. Resolves to whether the server was out of reach. */
async function sendFor(h: HandOver, store: EventStore, deviceId: string, blobs: BlobStore): Promise<boolean> {
  const session = await keptSession(h.actorId);
  // supabase-js drops a session the server refused to renew; one it could
  // not renew for want of a network stays.
  if (session === 'unreachable') { await noteSession(h, store, 'unreachable'); return true; }
  if (session === 'gone') {
    await noteSession(h, store, 'gone');
    courierNotes.forget(h.actorId);
    await forget(h.actorId, false);
    // No lock can bring an ended session back (decisions.md 168).
    await dropLockedSession(h.actorId);
    return false;
  }
  const as = actAs(h.actorId, blobs);
  const result = await deliverHandOver(h, {
    ...as,
    upload: (u) => { if (released.has(h.actorId)) throw new TakenBack(); return as.upload(u); },
    store,
    deviceId,
    outbox: accountOutbox(h.actorId),
    hasFile: (ref) => blobs.exists(ref),
    note: (where, e) => { if (!(e instanceof TakenBack)) noteExpected(where, e); }
  });
  const { attempt, offline } = result;
  const next = afterAttempt(h, attempt);
  const report = courierReport(h, result, next, Date.now());
  if (courierNotes.shouldRecord(h.actorId, report.outcome, Date.now())) {
    const { outcome, ...n } = report;
    recordAuth('courier', outcome, { n });
  }
  if (next.kind === 'done') {
    courierNotes.forget(h.actorId);
    // Locked here, the session stays for its owner to come back to offline; otherwise it ends (decisions.md 168).
    const locked = await keepLockedAfterHandOver(h.actorId, await keptSessionRaw(h.actorId));
    await forget(h.actorId, !locked);
  } else if (next.kind === 'drop') {
    courierNotes.forget(h.actorId);
    await forget(h.actorId, false);
    await dropLockedSession(h.actorId);
  }
  // Read again: a sign-out since this began may have named more recordings.
  else await change((list) => list.map((x) => (x.actorId === h.actorId ? withoutFinished(x, attempt.finished, attempt.unregistered) : x)));
  return offline;
}

export async function sendAll(signedInAs: string | null): Promise<{ offline: boolean }> {
  const list = await handOvers();
  if (list.length === 0) return { offline: false };
  const store = await getStore();
  const deviceId = await ensureDeviceId(store, () => Crypto.randomUUID());
  const blobs = await getBlobStore();
  let offline = false;
  for (const listed of list) {
    await turn(listed.actorId, async () => {
      // Read again in their turn: they may have come back from the lock meanwhile.
      const h = (await handOvers()).find((x) => x.actorId === listed.actorId);
      if (!h) return;
      // Back in as themselves: their own session sends it from here.
      if (h.actorId === signedInAs) { await forget(h.actorId, true); return; }
      try {
        if (await sendFor(h, store, deviceId, blobs)) offline = true;
      } catch (e) {
        offline = true;
        noteExpected('hand-over', e);
      }
    });
  }
  // Reached the server: deliver what diagnostics hold (as whoever is signed in, if anyone).
  if (!offline) void flushDiagnostics();
  return { offline };
}

/**
 * Back from the lock (decisions.md 168): their own session takes over from
 * the courier, as after any sign-in here (60), but is not ended, since it
 * is the same session. A delivery under way stops before its next
 * recording and is waited for, so the two never renew the session at once.
 * Returns the kept session, its newest form, and the notifications it still
 * had to disconnect; null when no hand-over holds a session for them.
 */
export async function takeBackHandOver(actorId: string): Promise<{ session: string; pushToken?: string } | null> {
  released.add(actorId);
  try {
    return await turn(actorId, async () => {
      const h = (await handOvers()).find((x) => x.actorId === actorId);
      const session = h ? await keptSessionRaw(actorId) : null;
      // A hand-over whose session the server ended is the courier's to drop.
      if (!h || !session) return null;
      courierNotes.forget(actorId);
      await forget(actorId, false);
      return { session, ...(h.pushToken ? { pushToken: h.pushToken } : {}) };
    });
  } finally {
    released.delete(actorId);
  }
}

