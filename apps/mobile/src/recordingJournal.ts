import { getStore } from './store';
import { File, Paths } from 'expo-file-system';
import {
  parseJournal, removeEntry, resumeEntries, upsertEntry,
  type JournalEntry, type ResumeDeps, type ResumeResult
} from './recordingJournalCore';

/**
 * SQLite-backed recording journal (PLAN.md section 14 spirit: derived work
 * lists everywhere else, but a recording that has not reached the log yet
 * exists nowhere else, so this is the one place it is written down).
 * Changes serialize before reading and commit atomically.
 */
const FILE_NAME = 'recording-journal.json';

export class RecordingJournal {
  private readonly file = new File(Paths.document, FILE_NAME);
  private entries: JournalEntry[] | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private loading: Promise<JournalEntry[]> | undefined;

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
    const raw = saved ?? (this.file.exists ? await this.file.text() : undefined);
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
    return this.change((entries) => removeEntry(entries, id));
  }

  /** Finish unfinished saves for one partition; entries that succeed or are unrecoverable leave the journal. */
  async resume(partition: { orgId: string; projectId: string }, deps: Omit<ResumeDeps, 'save' | 'fileExists'>): Promise<ResumeResult> {
    const result = await resumeEntries([...(await this.all())], partition, {
      ...deps,
      fileExists: (uri) => { try { return new File(uri).exists; } catch { return false; } },
      save: (entry) => this.put(entry)
    });
    for (const id of [...result.resumed, ...result.dropped]) await this.remove(id);
    return result;
  }
}

let journal: RecordingJournal | undefined;
export function getRecordingJournal(): RecordingJournal {
  if (!journal) journal = new RecordingJournal();
  return journal;
}
