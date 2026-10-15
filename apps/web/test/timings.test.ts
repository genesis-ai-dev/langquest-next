import type { SupabaseClient } from '@supabase/supabase-js';
import { canonicalJson, withDeps, type LibraryDoc, type SourceDoc, type TimingDoc, type VersificationDoc } from '@langquest-next/core';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { publishLangQuestTimings } from '../worker/timings';

/**
 * Publishing a finished timing job to a LangQuest source (docs/reference-material.md):
 * driven by a fake `sb.rpc`, so no Supabase is needed. The Worker runs this on a
 * schedule, so the contract is that a second run publishes the same events.
 */

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const store = (doc: LibraryDoc) => { const text = canonicalJson(doc); return { text, hash: sha(text) }; };

const ENG: VersificationDoc = { format: 'versification@1', code: 'eng', name: 'English', maxVerses: { MAT: [2] }, mappedVerses: {}, excludedVerses: [], partialVerses: {} };
const eng = store(ENG);
const SOURCE: SourceDoc = withDeps({
  format: 'source@1', name: 'Test Bible', abbreviation: 'TB', language: 'eng', versification: eng.hash,
  provider: { kind: 'library' }, offline: 'allowed', copyright: {}, books: [{ book: 'MAT', name: 'Matthew' }], deps: []
});
const source = store(SOURCE);

const timing: TimingDoc = {
  format: 'timing@1', book: 'MAT', chapter: 1, versification: 'eng', audio: { sha256: 'a'.repeat(64), durationMs: 60000 }, introEndMs: 1000,
  segments: [{ verseStart: 1, verseEnd: 1, startMs: 1000, endMs: 30000 }, { verseStart: 2, verseEnd: 2, startMs: 30000, endMs: 60000 }],
  source: 'ctc', check: { ok: true }, deps: []
};

type Call = { fn: string; args: Record<string, unknown> };

/** The database as the Worker sees it: one finished job waiting to be published. */
function fakeDb(opts: { publishOrg?: string; failOn?: string } = {}) {
  const calls: Call[] = [];
  const documents = new Map<string, string>();
  const events: { id: string; type: string; payload: Record<string, unknown> }[] = [];
  let waiting = true;
  const job = { id: 'job-1', publish_org: opts.publishOrg ?? 'langquest', publish_item: 'langquest.source.eng' };
  const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    if (fn === opts.failOn) return { data: null, error: { message: 'boom' } };
    switch (fn) {
      case 'timing_jobs_to_publish': return { data: waiting ? [job] : [], error: null };
      case 'timing_job_published': waiting = false; return { data: null, error: null };
      case 'library_docs_for_publisher': {
        const item = String(args['p_item']);
        if (item === 'langquest.source.eng') return { data: [{ hash: source.hash, body: source.text, is_current: true }], error: null };
        if (item === 'langquest.versification.eng') return { data: [{ hash: eng.hash, body: eng.text, is_current: true }], error: null };
        return { data: [], error: null };
      }
      case 'timing_job_results_for_publisher': return { data: [{ book: 'MAT', chapter: 1, ok: true, body: timing }], error: null };
      case 'library_seed_document': {
        const text = String(args['p_body']);
        documents.set(sha(text), text);
        return { data: sha(text), error: null };
      }
      case 'library_seed_events': {
        for (const e of args['p_events'] as typeof events) if (!events.some((x) => x.id === e.id)) events.push(e);
        return { data: null, error: null };
      }
      default: throw new Error(`unexpected rpc ${fn}`);
    }
  };
  return { sb: { rpc } as unknown as SupabaseClient, calls, documents, events, setWaiting: (v: boolean) => { waiting = v; } };
}

describe('publishLangQuestTimings', () => {
  it('publishes a finished job as the item\'s next version and marks the job published', async () => {
    const db = fakeDb();
    expect(await publishLangQuestTimings(db.sb)).toEqual({ jobs: 1, published: 1 });
    expect(db.events).toHaveLength(1);
    expect(db.events[0]!).toMatchObject({ type: 'v1.LibraryVersionPublished', payload: { itemId: 'langquest.source.eng', kind: 'material', note: 'Verse timings for 1 chapter' } });
    const docHash = db.events[0]!.payload['docHash'] as string;
    expect(db.documents.has(docHash)).toBe(true);
    expect(JSON.parse(db.documents.get(docHash)!)).toMatchObject({ format: 'source@1', name: 'Test Bible' });
    // Timing and book documents were stored under their own hashes.
    expect([...db.documents.values()].map((t) => (JSON.parse(t) as { format: string }).format).sort()).toEqual(['source@1', 'sourceBook@1', 'timing@1']);
    expect(db.calls.at(-1)).toEqual({ fn: 'timing_job_published', args: { p_job: 'job-1' } });
  });

  it('is safe to run again: the same event id and the same documents', async () => {
    const db = fakeDb();
    await publishLangQuestTimings(db.sb);
    const first = { events: structuredClone(db.events), documents: [...db.documents.keys()].sort() };
    db.setWaiting(true); // the mark was lost, as when the Worker stopped between steps
    expect(await publishLangQuestTimings(db.sb)).toEqual({ jobs: 1, published: 1 });
    expect(db.events).toEqual(first.events);
    expect(db.events[0]!.id).toBe(`timings:job-1:${(db.events[0]!.payload['docHash'] as string).slice(0, 12)}`);
    expect([...db.documents.keys()].sort()).toEqual(first.documents);
  });

  it('does nothing when no job is waiting', async () => {
    const db = fakeDb();
    db.setWaiting(false);
    expect(await publishLangQuestTimings(db.sb)).toEqual({ jobs: 0, published: 0 });
    expect(db.calls.map((c) => c.fn)).toEqual(['timing_jobs_to_publish']);
  });

  it('marks a job for another publisher published without writing anything', async () => {
    const db = fakeDb({ publishOrg: 'some-org' });
    expect(await publishLangQuestTimings(db.sb)).toEqual({ jobs: 1, published: 0 });
    expect(db.events).toEqual([]);
    expect(db.calls.map((c) => c.fn)).toEqual(['timing_jobs_to_publish', 'timing_job_published']);
  });

  it('names the rpc that failed', async () => {
    await expect(publishLangQuestTimings(fakeDb({ failOn: 'timing_jobs_to_publish' }).sb)).rejects.toThrow('timing_jobs_to_publish: boom');
    await expect(publishLangQuestTimings(fakeDb({ failOn: 'timing_job_results_for_publisher' }).sb)).rejects.toThrow('timing_job_results_for_publisher: boom');
    await expect(publishLangQuestTimings(fakeDb({ failOn: 'library_seed_events' }).sb)).rejects.toThrow('library_seed_events: boom');
    const db = fakeDb({ failOn: 'timing_job_published' });
    await expect(publishLangQuestTimings(db.sb)).rejects.toThrow('timing_job_published: boom');
  });
});
