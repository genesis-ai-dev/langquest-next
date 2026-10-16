import { classifyTransferFailure, Diagnostics, ensureDeviceId, sanitizeContext, type DiagContext, type DiagStore, type TransferSource } from '@langquest-next/sync';
import { CLIENT_PROTOCOL_VERSION, REDUCER_VERSION } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { Paths } from 'expo-file-system';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import { applyDiagnosticsOn, readDiagnosticsOn, saveDiagnosticsOn } from './diagnosticsSetting';
import { getDiagStore, getStore } from '../sync/store';
import { BUILD_ID } from '../web/webBuild';
import { currentSession } from '../server/auth';
import { ingestDiagnostics } from '../server/diagnostics';

// Field diagnostics (docs/diagnostics.md, decisions.md 39). One recorder for
// the app: the sync clients, the transfer workers and report.ts write to
// it; `flushDiagnostics` delivers what it holds once the phone's own work
// is out of the way. Nothing recorded is content (packages/sync
// diagnostics.ts holds the allowlist).

/** At most one delivery attempt this often; weeks of records drain over a few syncs. */
const FLUSH_EVERY_MS = 10 * 60_000;

/** The store opens lazily, so recording can start before the database is ready. */
const lazyStore: DiagStore = {
  addDiag: async (r, max) => (await getDiagStore()).addDiag(r, max),
  diagBatch: async (limit) => (await getDiagStore()).diagBatch(limit),
  removeDiag: async (ids) => (await getDiagStore()).removeDiag(ids),
  diagCount: async () => (await getDiagStore()).diagCount()
};

export const diagnostics = new Diagnostics({ store: lazyStore, newId: () => Crypto.randomUUID() });

// The person's choice outlives a restart. Until it is read nothing is sent
// (flush waits for it), and anything recorded in that moment is dropped if
// the answer is off.
const setting = getStore()
  .then(async (store) => applyDiagnosticsOn(diagnostics, lazyStore, await readDiagnosticsOn(store)))
  .catch(() => {});

/** For Settings: whether diagnostics are on, as saved on this phone. */
export async function diagnosticsEnabled(): Promise<boolean> {
  await setting;
  return diagnostics.isEnabled;
}

/** For Settings: off stops recording and sending, and drops what is waiting. */
export async function setDiagnosticsEnabled(on: boolean): Promise<void> {
  await setting;
  await saveDiagnosticsOn(await getStore(), diagnostics, lazyStore, on);
}

/** The phone and build, as the allowlist permits. The install id is the event envelope's deviceId. */
async function context(): Promise<DiagContext> {
  const installId = await ensureDeviceId(await getStore(), () => Crypto.randomUUID());
  const c = Platform.constants as { Model?: string; Release?: string; osVersion?: string };
  return sanitizeContext({
    installId,
    os: Platform.OS,
    osVersion: c.Release ?? c.osVersion ?? String(Platform.Version),
    model: c.Model,
    // A browser has no expo-updates: its build is the commit the page was built from (webBuild.ts).
    runtimeVersion: Platform.OS === 'web' ? BUILD_ID || undefined : Updates.runtimeVersion,
    updateId: Platform.OS === 'web' ? undefined : Updates.updateId,
    channel: Platform.OS === 'web' ? 'web' : Updates.channel,
    embedded: Platform.OS !== 'web' && Updates.isEmbeddedLaunch ? 'yes' : 'no',
    reducerVersion: String(REDUCER_VERSION),
    protocolVersion: String(CLIENT_PROTOCOL_VERSION)
  });
}

const mb = (bytes: number) => Math.round(bytes / (1024 * 1024));

/**
 * Counts a feature reports about this phone in the `device` record, read at
 * each delivery: lost files (the file ledger), unsent recordings (the
 * journal), streams and events held. Each answers only numbers whose names
 * are `device` fields; a probe that throws or is slow is left out.
 */
export type DeviceProbe = () => Promise<Record<string, number | undefined>> | Record<string, number | undefined>;
const probes = new Map<string, DeviceProbe>();

/** Register (or replace) a probe under a name; returns a function that removes it. */
export function registerDeviceProbe(name: string, probe: DeviceProbe): () => void {
  probes.set(name, probe);
  return () => { if (probes.get(name) === probe) probes.delete(name); };
}

async function probeAll(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all([...probes.values()].map(async (probe) => {
    try {
      const values = await Promise.race([
        Promise.resolve(probe()),
        new Promise<Record<string, number | undefined>>((resolve) => setTimeout(() => resolve({}), 2000))
      ]);
      // Several languages open at once: counts add up, ages take the oldest.
      for (const [k, v] of Object.entries(values)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) continue;
        out[k] = /Min$/.test(k) ? Math.max(out[k] ?? 0, v) : (out[k] ?? 0) + v;
      }
    } catch { /* a probe never stops a delivery */ }
  }));
  return out;
}

let lastAttempt = 0;
let flushing = false;

/**
 * Deliver waiting records. Called when this phone's own work has had its
 * turn: after a language sync that left nothing to push and no upload that
 * has not yet been tried, after the organization stream settles, and on
 * sign-in (docs/diagnostics.md, "Delivery"). Downloads are not waited for,
 * and neither are uploads that keep failing: a stuck transfer is exactly
 * what support needs to hear about. Never throws; what is not delivered
 * stays.
 */
export async function flushDiagnostics(device: { blobCacheBytes?: number; blobsWanted?: number } = {}): Promise<void> {
  await setting;
  if (!diagnostics.isEnabled || flushing || Date.now() - lastAttempt < FLUSH_EVERY_MS) return;
  flushing = true;
  try {
    // Signed out is not an attempt: the first delivery after sign-in must not wait out the throttle.
    if (!await currentSession()) return;
    lastAttempt = Date.now();
    const n: Record<string, number> = await probeAll();
    // The web's expo-file-system answers 0 rather than throwing, which would
    // read as a full disk; a browser leaves the numbers out.
    if (Platform.OS !== 'web') {
      try {
        n.freeDiskMb = mb(Paths.availableDiskSpace);
        n.totalDiskMb = mb(Paths.totalDiskSpace);
      } catch { /* not every platform reports disk */ }
    }
    if (device.blobCacheBytes !== undefined) n.blobCacheMb = mb(device.blobCacheBytes);
    if (device.blobsWanted !== undefined) n.blobsWanted = device.blobsWanted;
    await diagnostics.settle();
    n.diagQueued = await diagnostics.pendingCount();
    n.diagDropped = diagnostics.takeDropped();
    diagnostics.record('device', { n });
    const ctx = await context();
    await diagnostics.flush(async (records) => {
      const { error } = await ingestDiagnostics(ctx, records);
      if (error) throw new Error(error.message);
    });
  } catch {
    // Offline, or a server without the diagnostics migration: try again later.
  } finally {
    flushing = false;
  }
}

export interface TransferTimings {
  signMs?: number;
  fetchMs?: number;
  verifyMs?: number;
}

/**
 * Time one blob transfer and tally it under its stream and source, failure
 * or not. Rethrows so the caller's backoff still applies. `src` defaults to
 * `lang`, a language's own upload and download lists; guide media, hand-over,
 * streamed play, source audio, help and study files name theirs. Answers
 * what `run` answered.
 */
export async function timedTransfer<T extends number | { bytes: number }>(
  dir: 'up' | 'down',
  where: { orgId: string; streamId: string; src?: TransferSource },
  run: (timings: TransferTimings) => Promise<T>
): Promise<T> {
  const started = Date.now();
  const timings: TransferTimings = {};
  try {
    const result = await run(timings);
    const bytes = typeof result === 'number' ? result : result.bytes;
    diagnostics.transfer(dir, { ...where, ...timings, bytes, ms: Date.now() - started });
    return result;
  } catch (e) {
    diagnostics.transfer(dir, { ...where, ...timings, bytes: 0, ms: Date.now() - started, failure: classifyTransferFailure(e) });
    throw e;
  }
}
