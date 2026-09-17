/**
 * Recording journal (pure). One entry per recorded file from the moment the
 * native recorder hands it over until its RecordingAdded event is durable.
 * The stage says how far the save got, so a restart can resume it:
 *
 *   recorded  -> file sits in staging under `uri`; not yet content-addressed
 *   ingested  -> file is in the blob store as `hash`; event not yet appended
 *
 * `id` is the recordingId the event will carry, chosen when the entry is
 * created, so resuming after a crash between "event written" and "entry
 * removed" appends nothing twice: the fold already has that id.
 */
export interface JournalTarget {
  orgId: string;
  projectId: string;
  unitId: string;
  laneId: string;
}

export interface JournalEntry {
  id: string;
  uri: string;
  format: 'wav' | 'm4a';
  durationMs: number;
  stage: 'recorded' | 'ingested';
  hash?: string;
  size?: number;
  /** Absent for recordings the user still has to place (key terms). */
  target?: JournalTarget;
}

export function parseJournal(text: string | undefined): JournalEntry[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? (parsed as JournalEntry[]).filter((e) => e && typeof e.id === 'string') : [];
  } catch {
    return [];
  }
}

export function upsertEntry(entries: JournalEntry[], entry: JournalEntry): JournalEntry[] {
  const i = entries.findIndex((e) => e.id === entry.id);
  if (i < 0) return [...entries, entry];
  const next = entries.slice();
  next[i] = entry;
  return next;
}

export function removeEntry(entries: JournalEntry[], id: string): JournalEntry[] {
  return entries.filter((e) => e.id !== id);
}

export interface ResumeDeps {
  /** Is the staging file (stage `recorded`) still on disk? */
  fileExists: (uri: string) => boolean;
  /** Hash and move the file into the blob store. */
  ingest: (uri: string, format: JournalEntry['format']) => Promise<{ hash: string; size: number }>;
  /** Has the fold already got this recording? */
  hasRecording: (id: string) => boolean;
  /** Append RecordingAdded for a fully ingested entry. */
  append: (entry: JournalEntry & { hash: string; target: JournalTarget }) => Promise<void>;
  /** Persist a partial step so a second interruption resumes from here. */
  save: (entry: JournalEntry) => Promise<void>;
}

export interface ResumeResult {
  resumed: string[];
  /** Entries whose audio is gone or that cannot be placed; nothing to recover. */
  dropped: string[];
  /** Entries that failed this pass and stay in the journal for the next one. */
  failed: { id: string; error: string }[];
}

/**
 * Finish every unfinished save for one partition. Idempotent: every step
 * checks what already happened before doing it again.
 */
export async function resumeEntries(
  entries: JournalEntry[],
  partition: { orgId: string; projectId: string },
  deps: ResumeDeps
): Promise<ResumeResult> {
  const result: ResumeResult = { resumed: [], dropped: [], failed: [] };
  for (const original of entries) {
    const t = original.target;
    if (!t || t.orgId !== partition.orgId || t.projectId !== partition.projectId) continue;
    let entry = original;
    try {
      if (entry.stage === 'recorded') {
        if (!deps.fileExists(entry.uri)) {
          result.dropped.push(entry.id);
          continue;
        }
        const { hash, size } = await deps.ingest(entry.uri, entry.format);
        entry = { ...entry, stage: 'ingested', hash, size };
        await deps.save(entry);
      }
      if (!entry.hash) {
        result.dropped.push(entry.id);
        continue;
      }
      if (!deps.hasRecording(entry.id)) await deps.append({ ...entry, hash: entry.hash, target: t });
      result.resumed.push(entry.id);
    } catch (err) {
      result.failed.push({ id: entry.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}
