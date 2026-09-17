import { parseJournal, removeEntry, resumeEntries, upsertEntry, type JournalEntry, type ResumeDeps } from '../src/recordingJournalCore';

const target = { orgId: 'org', projectId: 'project', unitId: 'passage', laneId: 'lane' };
const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  id: 'rec-1', uri: 'file:///staging/a.wav', format: 'wav', durationMs: 900, stage: 'recorded', target, ...over
});

function deps(over: Partial<ResumeDeps> = {}) {
  const calls = { ingest: [] as string[], append: [] as string[], saved: [] as JournalEntry[] };
  const d: ResumeDeps = {
    fileExists: () => true,
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

  it('drops an entry whose staging audio is gone: there is nothing left to recover', async () => {
    const { d, calls } = deps({ fileExists: () => false });
    const r = await resumeEntries([entry()], target, d);
    expect(r.dropped).toEqual(['rec-1']);
    expect(calls.append).toEqual([]);
  });

  it('keeps a failing entry for the next pass and touches other partitions not at all', async () => {
    let attempts = 0;
    const { d, calls } = deps({ ingest: async () => { attempts += 1; throw new Error('disk full'); } });
    const other = entry({ id: 'rec-2', target: { ...target, projectId: 'elsewhere' } });
    const r = await resumeEntries([entry(), other, entry({ id: 'rec-3', target: undefined })], target, d);
    expect(r.failed).toEqual([{ id: 'rec-1', error: 'disk full' }]);
    expect(r.resumed).toEqual([]);
    expect(attempts).toBe(1);
    expect(calls.append).toEqual([]);
  });
});
