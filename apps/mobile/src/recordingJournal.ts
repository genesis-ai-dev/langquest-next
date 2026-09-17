import { File, Paths } from 'expo-file-system';
import {
  parseJournal, removeEntry, resumeEntries, upsertEntry,
  type JournalEntry, type ResumeDeps, type ResumeResult
} from './recordingJournalCore';

/**
 * File-backed recording journal (PLAN.md section 14 spirit: derived work
 * lists everywhere else, but a recording that has not reached the log yet
 * exists nowhere else, so this is the one place it is written down).
 * Small: one JSON array, rewritten on every change, serialized by a chain.
 */
const FILE_NAME = 'recording-journal.json';

export class RecordingJournal {
  private readonly file = new File(Paths.document, FILE_NAME);
  private entries: JournalEntry[] | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  private async load(): Promise<JournalEntry[]> {
    if (this.entries) return this.entries;
    let text: string | undefined;
    try { if (this.file.exists) text = await this.file.text(); } catch { text = undefined; }
    this.entries = parseJournal(text);
    return this.entries;
  }

  private write(entries: JournalEntry[]): Promise<void> {
    this.entries = entries;
    const run = this.chain.then(() => this.file.write(JSON.stringify(entries)));
    this.chain = run.catch(() => {});
    return run;
  }

  async all(): Promise<readonly JournalEntry[]> {
    return this.load();
  }

  async put(entry: JournalEntry): Promise<void> {
    await this.write(upsertEntry(await this.load(), entry));
  }

  async remove(id: string): Promise<void> {
    await this.write(removeEntry(await this.load(), id));
  }

  /** Finish unfinished saves for one partition; entries that succeed or are unrecoverable leave the journal. */
  async resume(partition: { orgId: string; projectId: string }, deps: Omit<ResumeDeps, 'save' | 'fileExists'>): Promise<ResumeResult> {
    const result = await resumeEntries(await this.load(), partition, {
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
