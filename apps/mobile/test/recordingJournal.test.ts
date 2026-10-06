import { parseJournal, removeEntry, resumeEntries, upsertEntry, type JournalEntry, type ResumeDeps } from '../src/recordingJournalCore';

const target = { orgId: 'org', partitionId: 'partition', unitId: 'passage', laneId: 'lane' };
const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  id: 'rec-1', uri: 'file:///staging/a.wav', format: 'wav', durationMs: 900, stage: 'recorded', target, ...over
});

function deps(over: Partial<ResumeDeps> = {}) {
  const calls = { ingest: [] as string[], append: [] as string[], saved: [] as JournalEntry[] };
  const d: ResumeDeps = {
    fileExists: () => true,
    blobExists: () => true,
    ingest: async (uri) => { calls.ingest.push(uri); return { hash: 'h-' + uri, size: 10 }; },
    hasRecording: () => false,
    append: async (e) => { calls.append.push(e.id); },
    save: async (e) => { calls.saved.push(e); },
    ...over
  };
  return { d, calls };
}

describe('recording journal', () => {
  it('parses defensively: a torn write or garbage means an empty journal, never a crash on launch', () => {
    expect(parseJournal(undefined)).toEqual([]);
    expect(parseJournal('{not json')).toEqual([]);
    expect(parseJournal('[{"nope":1}]')).toEqual([]);
    expect(parseJournal(JSON.stringify([entry()]))).toEqual([entry()]);
  });

  it('upsert replaces by id so a stage advance never duplicates an entry', () => {
    const a = upsertEntry([], entry());
    const b = upsertEntry(a, entry({ stage: 'ingested', hash: 'h' }));
    expect(b).toHaveLength(1);
    expect(b[0]?.stage).toBe('ingested');
    expect(removeEntry(b, 'rec-1')).toEqual([]);
  });

  it('a recorded entry is ingested, saved at the ingested stage, then appended', async () => {
    const { d, calls } = deps();
    const r = await resumeEntries([entry()], target, d);
    expect(r).toEqual({ resumed: ['rec-1'], dropped: [], failed: [] });
    expect(calls.ingest).toEqual(['file:///staging/a.wav']);
    expect(calls.saved[0]?.stage).toBe('ingested');
    expect(calls.append).toEqual(['rec-1']);
  });

  it('is idempotent: an entry whose event already reached the fold appends nothing again', async () => {
    const { d, calls } = deps({ hasRecording: (id) => id === 'rec-1' });
    const r = await resumeEntries([entry({ stage: 'ingested', hash: 'h' })], target, d);
    expect(r.resumed).toEqual(['rec-1']);
    expect(calls.append).toEqual([]);
    expect(calls.ingest).toEqual([]);
  });

  it('retains a missing file entry for recovery rather than silently dropping it', async () => {
    const { d, calls } = deps({ fileExists: () => false });
    const r = await resumeEntries([entry()], target, d);
    expect(r.dropped).toEqual([]);
    expect(r.failed[0]?.id).toBe('rec-1');
    expect(calls.append).toEqual([]);
  });

  it('keeps a failing entry for the next pass and touches other partitions not at all', async () => {
    let attempts = 0;
    const { d, calls } = deps({ ingest: async () => { attempts += 1; throw new Error('disk full'); } });
    const other = entry({ id: 'rec-2', target: { ...target, partitionId: 'elsewhere' } });
    const r = await resumeEntries([entry(), other, entry({ id: 'rec-3', target: undefined })], target, d);
    expect(r.failed).toEqual([{ id: 'rec-1', error: 'disk full' }]);
    expect(r.resumed).toEqual([]);
    expect(attempts).toBe(1);
    expect(calls.append).toEqual([]);
  });
});

// Interrupt at the exact boundary between file relocation and journal advancement.
it('recovers a moved blob using the destination saved before relocation', async () => {
  let persisted = entry();
  let sourceExists = true;
  let destinationExists = false;
  const { d, calls } = deps({
    fileExists: () => sourceExists,
    blobExists: (hash) => hash === 'content-hash' && destinationExists,
    save: async (e) => { persisted = e; },
    ingest: async (_uri, _format, beforeMove) => {
      await beforeMove('content-hash', 10);
      sourceExists = false;
      destinationExists = true;
      throw new Error('process interrupted');
    }
  });
  expect((await resumeEntries([persisted], target, d)).failed).toHaveLength(1);
  expect(persisted).toMatchObject({ stage: 'recorded', hash: 'content-hash' });
  expect((await resumeEntries([persisted], target, d)).resumed).toEqual(['rec-1']);
  expect(calls.append).toEqual(['rec-1']);
});

it('does not relocate audio when the destination journal write fails', async () => {
  let moved = false;
  const { d } = deps({
    save: async () => { throw new Error('disk full'); },
    ingest: async (_uri, _format, beforeMove) => {
      await beforeMove('hash', 10);
      moved = true;
      return { hash: 'hash', size: 10 };
    }
  });
  expect((await resumeEntries([entry()], target, d)).failed).toHaveLength(1);
  expect(moved).toBe(false);
});


it('does not append an ingested recording when its blob is missing', async () => {
  const { d, calls } = deps({ blobExists: () => false });
  const result = await resumeEntries([entry({ stage: 'ingested', hash: 'lost' })], target, d);
  expect(result.failed).toHaveLength(1);
  expect(result.dropped).toEqual([]);
  expect(calls.append).toEqual([]);
});


const disk = vi.hoisted(() => ({
  value: '[]' as string | undefined,
  legacy: undefined as string | undefined,
  fail: false,
  reads: 0
}));
vi.mock('../src/store', () => ({ getStore: async () => ({
  meta: async () => { disk.reads++; await Promise.resolve(); return disk.value; },
  setMeta: async (_key: string, value: string) => {
    if (disk.fail) throw new Error('disk full');
    disk.value = value;
  }
}) }));
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-file-system', () => ({
  Paths: { document: 'file:///documents' },
  File: class {
    get exists() { return disk.legacy !== undefined; }
    async text() { return disk.legacy; }
  }
}));

// Exercise the production journal's read/modify/commit chain, not only recovery.
describe('durable journal storage', () => {
  beforeEach(() => {
    disk.value = '[]'; disk.legacy = undefined; disk.fail = false; disk.reads = 0;
  });

  it('shares initial loading and preserves concurrent additions', async () => {
    const { RecordingJournal } = await import('../src/recordingJournal');
    const journal = new RecordingJournal();
    await Promise.all([journal.all(), journal.put(entry()), journal.put(entry({ id: 'second' }))]);
    expect(disk.reads).toBe(1);
    expect((await journal.all()).map((e) => e.id)).toEqual(['rec-1', 'second']);
    expect(JSON.parse(disk.value!).map((e: JournalEntry) => e.id)).toEqual(['rec-1', 'second']);
  });

  it('does not publish a failed write and permits a later retry', async () => {
    const { RecordingJournal } = await import('../src/recordingJournal');
    const journal = new RecordingJournal();
    await journal.all();
    disk.fail = true;
    await expect(journal.put(entry())).rejects.toThrow('disk full');
    expect(await journal.all()).toEqual([]);
    disk.fail = false;
    await journal.put(entry());
    expect(await journal.all()).toHaveLength(1);
  });

  it('imports the previous journal once without overwriting a SQLite journal', async () => {
    const { RecordingJournal } = await import('../src/recordingJournal');
    disk.value = undefined;
    disk.legacy = JSON.stringify([entry()]);
    const journal = new RecordingJournal();
    expect(await journal.all()).toHaveLength(1);
    await journal.remove('rec-1');
    expect(await new RecordingJournal().all()).toEqual([]);
  });

  it('retains a damaged legacy journal instead of replacing it with an empty one', async () => {
    const { RecordingJournal } = await import('../src/recordingJournal');
    disk.value = undefined;
    disk.legacy = '{torn';
    await expect(new RecordingJournal().all()).rejects.toThrow();
    expect(disk.value).toBeUndefined();
  });
});
