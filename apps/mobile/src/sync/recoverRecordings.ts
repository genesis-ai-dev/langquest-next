import { classifyTransferFailure, type LanguageSession } from '@langquest-next/sync';
import type { ResumeDeps, ResumeResult } from '../recording/recordingJournalModel';
import type { BlobStore } from './blobs';
import { recoveredRecording, saysFileMissing } from './recoveryModel';

/** What recovery needs of the phone: the journal, the audio cutter, and where to say what went wrong. */
export interface RecoveryEnv {
  journal: {
    resume: (
      language: { orgId: string; languageId: string },
      deps: Omit<ResumeDeps, 'save' | 'fileExists'> & { deleteChunk?: (uri: string) => void }
    ) => Promise<ResumeResult>;
  };
  /** Cut a session part from its chunk (LAN-82). */
  cut: NonNullable<ResumeDeps['cut']>;
  deleteChunk: (uri: string) => void;
  reportError: (where: string, error: unknown) => unknown;
  noteExpected: (where: string, error: unknown, code?: string) => void;
}

/** A failed recovery's cause as a fixed code: its take's file gone, a full disk, or a transfer's class. Never the text. */
export function recoveryCode(error: string): string {
  return saysFileMissing(error) ? 'missing' : classifyTransferFailure(new Error(error));
}

/**
 * Finish any save a crash or kill interrupted (recordingJournalModel.ts).
 * Idempotent by recordingId; call it after the session has started so the
 * upload pass sees the recovered card. Resolves to whether any recording
 * was recovered, in which case the session has been refreshed and told to
 * upload. An entry that failed stays in the journal for the next open.
 */
export async function recoverRecordings(
  session: Pick<LanguageSession, 'hasRecording' | 'refresh' | 'triggerUpload'> & { client: Pick<LanguageSession['client'], 'append'> },
  files: Pick<BlobStore, 'exists' | 'ingest'>,
  language: { orgId: string; languageId: string },
  env: RecoveryEnv,
  isCancelled: () => boolean = () => false
): Promise<boolean> {
  const resumed = await env.journal.resume(language, {
    // A session part the app never got to leave is cut from its chunk as its box last stood (LAN-82).
    cut: env.cut,
    deleteChunk: (uri) => { try { env.deleteChunk(uri); } catch (e) { env.noteExpected('recording recovery: delete chunk', e); } },
    blobExists: (hash, format) => files.exists({ hash, format }),
    ingest: async (uri, format, beforeMove) => {
      const { ref, size } = await files.ingest(uri, format, (ref, size) => beforeMove(ref.hash, size));
      return { hash: ref.hash, size };
    },
    hasRecording: (id) => session.hasRecording(id),
    append: async (e) => { await session.client.append('v1.RecordingAdded', recoveredRecording(e)); }
  }).catch((e: unknown) => { env.reportError('recording recovery', e); return null; });
  // Count each failure by its cause's fixed class (a full disk, a file gone),
  // never its text; how many wait is the journal's own probe.
  for (const f of resumed?.failed ?? []) {
    env.noteExpected('recording recovery entry', new Error('recovery failed'), recoveryCode(f.error));
  }
  if (isCancelled() || !resumed?.resumed.length) return false;
  await session.refresh();
  session.triggerUpload();
  return true;
}
