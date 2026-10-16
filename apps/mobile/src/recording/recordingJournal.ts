import { getStore } from '../sync/store';
import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { registerDeviceProbe } from '../diagnostics/diagnostics';
import {
  journalCounts, parseJournal, removeEntry, resumeEntries, upsertEntry,
  type JournalEntry, type ResumeDeps, type ResumeResult
} from './recordingJournalModel';

/**
 * SQLite-backed recording journal (PLAN.md section 14 spirit: derived work
 * lists everywhere else, but a recording that has not reached the log yet
 * exists nowhere else, so this is the one place it is written down).
 * Changes serialize before reading and commit atomically.
 */
const FILE_NAME = 'recording-journal.json';

export class RecordingJournal {
  // The legacy file to import; the web never had one.
  private readonly file = Platform.OS === 'web' ? null : new File(Paths.document, FILE_NAME);
  private entries: JournalEntry[] | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private loading: Promise<JournalEntry[]> | undefined;
  /** Entries the last pass for their language could not finish; they stay for the next. */
  private readonly failedIds = new Set<string>();

  private async load(): Promise<JournalEntry[]> {
    if (this.entries) return this.entries;
    return this.loading ??= this.readInitial().catch((error) => {
      this.loading = undefined;
      throw error;
    });
  }

  private async readInitial(): Promise<JournalEntry[]> {
    const store = await getStore();
    const saved = await store.meta(FILE_NAME);
    // Import the legacy file once. SQLite commits journal changes atomically.
    const raw = saved ?? (this.file?.exists ? await this.file.text() : undefined);
    if (raw) JSON.parse(raw); // Never silently erase a damaged journal.
    const entries = parseJournal(raw);
    if (saved === undefined) await store.setMeta(FILE_NAME, JSON.stringify(entries));
    this.entries = entries;
    return entries;
  }

  private change(update: (entries: JournalEntry[]) => JournalEntry[]): Promise<void> {
    const run = this.chain.then(async () => {
      const next = update(await this.load());
      await (await getStore()).setMeta(FILE_NAME, JSON.stringify(next));
      this.entries = next;
    });
    this.chain = run.catch(() => {});
    return run;
  }

  async all(): Promise<readonly JournalEntry[]> {
    await this.chain;
    return this.load();
  }

  put(entry: JournalEntry): Promise<void> {
    return this.change((entries) => upsertEntry(entries, entry));
  }

  remove(id: string): Promise<void> {
    this.failedIds.delete(id);
    return this.change((entries) => removeEntry(entries, id));
  }

  /** Takes waiting to be saved, and those a recovery could not save, for field diagnostics. */
  async counts(): Promise<{ journalPending: number; journalFailed: number }> {
    return journalCounts(await this.all(), this.failedIds);
  }

  /**
   * Finish unfinished saves for one language; entries that succeed or are
   * unrecoverable leave the journal. The caller notes each failure for field
   * diagnostics (useLanguage.ts); the journal counts those still waiting.
   */
  async resume(language: { orgId: string; languageId: string },
    deps: Omit<ResumeDeps, 'save' | 'fileExists'> & { deleteChunk?: (uri: string) => void }): Promise<ResumeResult> {
    // A session still open on this screen is not interrupted: its parts are cut when it is left (useRecorder).
    const entries = (await this.all()).filter((e) => !liveParts.has(e.id));
    const chunks = new Set(entries.flatMap((e) => (e.range ? [e.uri] : [])));
    const { deleteChunk, ...rest } = deps;
    const result = await resumeEntries([...entries], language, {
      ...rest,
      // On the web a recording's blob: URL does not outlive the page. Once
      // ingested its bytes are in the browser's files (blobs.ts) and it
      // resumes by hash above this check; before that, a reload loses it.
      fileExists: (uri) => { if (Platform.OS === 'web') return false; try { return new File(uri).exists; } catch { return false; } },
      save: (entry) => this.put(entry)
    });
    for (const { id } of result.failed) this.failedIds.add(id);
    for (const id of [...result.resumed, ...result.dropped]) await this.remove(id);
    // A session chunk whose parts are all cut is no longer needed.
    const still = new Set((await this.all()).flatMap((e) => (e.range ? [e.uri] : [])));
    for (const uri of chunks) if (!still.has(uri)) deleteChunk?.(uri);
    return result;
  }
}

/** Parts of a recording session open right now: theirs is not an interrupted save, so recovery leaves them. */
export const liveParts = new Set<string>();

let journal: RecordingJournal | undefined;
export function getRecordingJournal(): RecordingJournal {
  if (!journal) {
    const created = new RecordingJournal();
    journal = created;
    registerDeviceProbe('recordingJournal', () => created.counts());
  }
  return journal;
}
