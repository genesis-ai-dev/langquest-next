import { classifyTransferFailure, Diagnostics, ensureDeviceId, sanitizeContext, type DiagContext, type DiagStore } from '@langquest-next/client';
import { CLIENT_PROTOCOL_VERSION, REDUCER_VERSION } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { Paths } from 'expo-file-system';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import { applyDiagnosticsOn, readDiagnosticsOn, saveDiagnosticsOn } from './diagnosticsSetting';
import { getDiagStore, getStore } from './store';
import { BUILD_ID } from './webBuild';
import { supabase } from './supabase';

// Field diagnostics (docs/diagnostics.md, decisions.md 39). One recorder for
// the app: the sync clients, the transfer workers and report.ts write to
// it; `flushDiagnostics` delivers what it holds once the phone's own work
// is out of the way. Nothing recorded is content (packages/client
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

let lastAttempt = 0;
let flushing = false;

/**
 * Deliver waiting records. Call only when the phone's own work is done: the
 * outbox is empty and uploads are idle (docs/diagnostics.md, "Delivery").
 * Downloads are not waited for, because a stuck download is exactly what
 * support needs to hear about. Never throws; what is not delivered stays.
 */
export async function flushDiagnostics(device: { blobCacheBytes?: number; blobsWanted?: number } = {}): Promise<void> {
  await setting;
  if (!diagnostics.isEnabled || flushing || Date.now() - lastAttempt < FLUSH_EVERY_MS) return;
  flushing = true;
  lastAttempt = Date.now();
  try {
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    const n: Record<string, number> = {};
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
    diagnostics.record('device', { n });
    const ctx = await context();
    await diagnostics.flush(async (records) => {
      const { error } = await supabase.rpc('diag_ingest', { p_context: ctx, p_records: records });
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

/** Time one blob transfer and tally it under its stream, failure or not. Rethrows so the worker's backoff still applies. */
export async function timedTransfer(
  dir: 'up' | 'down',
  where: { orgId: string; streamId: string },
  run: (timings: TransferTimings) => Promise<number>
): Promise<void> {
  const started = Date.now();
  const timings: TransferTimings = {};
  try {
    const bytes = await run(timings);
    diagnostics.transfer(dir, { ...where, ...timings, bytes, ms: Date.now() - started });
  } catch (e) {
    diagnostics.transfer(dir, { ...where, ...timings, bytes: 0, ms: Date.now() - started, failure: classifyTransferFailure(e) });
    throw e;
  }
}
