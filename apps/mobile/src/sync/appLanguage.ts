import { DEFAULT_TRANSFER_BUDGET_BYTES, TransferBudget } from '@langquest-next/sync';
import * as Crypto from 'expo-crypto';
import { getBlobStore } from './blobs';
import { downloadBlob, uploadBlob } from '../server/blobTransport';
import { diagnostics, flushDiagnostics, registerDeviceProbe, timedTransfer } from '../diagnostics/diagnostics';
import { noteExpected, reportError } from '../diagnostics/report';
import { appBuild } from '../diagnostics/appBuild';
import { getRecordingJournal } from '../recording/recordingJournal';
import { cutWav, deleteRecorderFile } from '../audio/wavCut';
import { isRecording } from '../recording/recorderState';
import { getStore } from '../storage/store';
import { serverTransport } from './serverTransport';
import { trackSync } from './syncActivity';
import type { LanguagePlatform } from './openLanguage';
import type { RecoveryEnv } from './recoverRecordings';

/** Keep this much free for recording, and cap the cache; evict only what the server can give back. */
const LIMITS = { minFreeBytes: 500 * 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 * 1024 };

/** One budget per device, shared by every language's workers. */
const transferBudget = new TransferBudget(DEFAULT_TRANSFER_BUDGET_BYTES);

/** The phone's own pieces for a language session: its store, files, server and measuring. */
export async function appLanguagePlatform(): Promise<LanguagePlatform> {
  const store = await getStore();
  const files = await getBlobStore();
  return {
    store, files,
    transport: serverTransport(),
    budget: transferBudget,
    limits: LIMITS,
    isDeferred: isRecording,
    client: {
      // Hermes has no global crypto.randomUUID.
      newId: () => Crypto.randomUUID(),
      // A long catch-up shares the thread with taps and the meter.
      yieldBetweenPages: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
      diag: diagnostics
    },
    aroundSync: trackSync,
    build: appBuild(),
    newId: () => Crypto.randomUUID(),
    send: uploadBlob,
    fetch: downloadBlob,
    timedTransfer,
    registerProbe: registerDeviceProbe,
    settled: (f, blobsWanted) => { void flushDiagnostics({ blobCacheBytes: f.totalBytes(), blobsWanted }).catch(() => {}); }
  };
}

/** The phone's journal, audio cutter and reporting for finishing an interrupted recording. */
export function appRecoveryEnv(): RecoveryEnv {
  return { journal: getRecordingJournal(), cut: cutWav, deleteChunk: deleteRecorderFile, reportError, noteExpected };
}
