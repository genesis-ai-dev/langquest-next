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
import { actAs, forgetKeptSession, keepSessionAndSignOut, keptSession } from '../server/handOver';

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
    return false;
  }
  const result = await deliverHandOver(h, {
    ...actAs(h.actorId, blobs),
    store,
    deviceId,
    outbox: accountOutbox(h.actorId),
    hasFile: (ref) => blobs.exists(ref),
    note: noteExpected
  });
  const { attempt, offline } = result;
  const next = afterAttempt(h, attempt);
  const report = courierReport(h, result, next, Date.now());
  if (courierNotes.shouldRecord(h.actorId, report.outcome, Date.now())) {
    const { outcome, ...n } = report;
    recordAuth('courier', outcome, { n });
  }
  if (next.kind === 'done') { courierNotes.forget(h.actorId); await forget(h.actorId, true); }
  else if (next.kind === 'drop') { courierNotes.forget(h.actorId); await forget(h.actorId, false); }
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
  for (const h of list) {
    // Back in as themselves: their own session sends it from here.
    if (h.actorId === signedInAs) { await forget(h.actorId, true); continue; }
    try {
      if (await sendFor(h, store, deviceId, blobs)) offline = true;
    } catch (e) {
      offline = true;
      noteExpected('hand-over', e);
    }
  }
  // Reached the server: deliver what diagnostics hold (as whoever is signed in, if anyone).
  if (!offline) void flushDiagnostics();
  return { offline };
}

