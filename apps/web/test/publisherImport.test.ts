import { canonicalJson } from '@langquest-next/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { checkImports, importStep, MAX_TRIES, runImports, type CheckJob, type ImportedItem, type OpenRun } from '../../../server/publisherImport';

const V11N = { format: 'versification@1', code: 'eng', name: 'English', maxVerses: { JHN: [51] } };
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** The database as the import steps see it: one run, its documents and what it was told. */
function fakeDb(run: OpenRun | null, checks: CheckJob[] = []) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const kept = new Set<string>();
  let taken = false;
  const sb = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      switch (fn) {
        case 'import_run_next': { const r = taken ? null : run; taken = true; return { data: r, error: null }; }
        case 'library_docs_for_publisher': return { data: [{ hash: sha(canonicalJson(V11N)), body: canonicalJson(V11N), is_current: true }], error: null };
        case 'import_run_put_documents': {
          const hashes = (args['p_bodies'] as string[]).map((b) => { kept.add(sha(b)); return sha(b); });
          return { data: hashes, error: null };
        }
        case 'import_run_save': return { data: true, error: null };
        case 'import_check_next': return { data: checks.shift() ?? null, error: null };
        default: return { data: true, error: null };
      }
    }
  } as unknown as SupabaseClient;
  return { sb, calls, kept, last: (fn: string) => calls.filter((c) => c.fn === fn).at(-1)?.args };
}

const article = (lang: string) => [
  { content_id: `${lang}-jhn-p1-v1`, title: 'John 1:1–5', media_type: 'Text', index_reference: '43001001-43001005',
    content: '<h2>Hear</h2><p>Listen to <data class="resource-ref" data-content-id="eng-t148-v1" data-resource-code="FIAKeyTerms">the Word</data>.</p>' },
  { content_id: `${lang}-jhn-p1-v1-audio`, title: 'John 1:1–5', media_type: 'Audio', index_reference: '43001001-43001005',
    content: "<ul><li><a href='https://s3.example/s1.mp3'>Hear</a></li></ul>" }
];

/** GitHub as Aquifer's repositories answer: English and French guides, English terms only. */
function fakeGitHub(opts: { fail?: boolean } = {}) {
  const asked: string[] = [];
  const files: Record<string, unknown> = {
    'BibleAquifer/FIATranslationGuide/main/eng/metadata.json': {
      scripture_burrito: { languages: [{ name: { en: 'English' } }], ingredients: { 'json/43.content.json': {} } },
      article_metadata: { 'eng-jhn-p1-v1': {}, 'eng-jhn-p1-v1-audio': {} }
    },
    'BibleAquifer/FIATranslationGuide/main/eng/json/43.content.json': article('eng'),
    'BibleAquifer/FIAKeyTerms/main/eng/metadata.json': { scripture_burrito: { ingredients: { 'json/001.content.json': {} } } },
    'BibleAquifer/FIAKeyTerms/main/eng/json/001.content.json': [{ content_id: 'eng-t148-v1', title: 'Word', media_type: 'Text', content: '<p>The word of God.</p>' }]
  };
  const fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    if (opts.fail) return new Response('down', { status: 503 });
    const body = files[url.replace('https://raw.githubusercontent.com/', '')];
    return body ? new Response(JSON.stringify(body), { status: 200 }) : new Response('404: Not Found', { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, asked };
}

const run = (over: Partial<OpenRun> = {}): OpenRun => ({
  id: 'run-1', orgId: 'org-wc', importer: 'fia', source: 'BibleAquifer', options: { languages: ['eng', 'xyz'] }, cursor: {}, done: 0, total: null, ...over
});

describe('publisher import steps', () => {
  it('builds one language a step, then finishes with the items it made; a language Aquifer lacks is passed over', async () => {
    const db = fakeDb(null);
    const gh = fakeGitHub();
    const after1 = await importStep(db.sb, { fetch: gh.fetch }, run());
    const item = after1!.cursor.items![0]!;
    expect(item).toMatchObject({ itemId: 'fia.eng', kind: 'material', name: 'FIA study guides (English)', count: 1, language: 'eng' });
    // The versification, the guide and the collection, all kept for the run.
    expect(db.kept.size).toBe(3);
    expect(db.kept.has(item.docHash)).toBe(true);
    expect(db.last('import_run_save')).toMatchObject({ p_done: 1, p_total: 2, p_cursor: { tries: 0 } });
    // What the language took, for later looks at the source.
    expect(db.last('import_run_put_part')).toEqual({ p_run: 'run-1', p_part: 'eng', p_ids: ['eng-jhn-p1-v1'] });

    const after2 = await importStep(db.sb, { fetch: gh.fetch }, after1!);
    expect(after2!.cursor.missing).toEqual(['xyz']);
    expect(await importStep(db.sb, { fetch: gh.fetch }, after2!)).toBeNull();
    expect((db.last('import_run_finish')!['p_manifest'] as ImportedItem[]).map((i) => i.itemId)).toEqual(['fia.eng']);
  });

  it('fails a run whose languages Aquifer has none of', async () => {
    const db = fakeDb(null);
    let r = await importStep(db.sb, { fetch: fakeGitHub().fetch }, run({ options: { languages: ['xyz'] } }));
    r = await importStep(db.sb, { fetch: fakeGitHub().fetch }, r!);
    expect(r).toBeNull();
    expect(db.last('import_run_fail')).toMatchObject({ p_failure: 'Bible Aquifer has no FIA in xyz.' });
  });

  it('counts a try before making it, leaves a failing part for later, and fails the run after three', async () => {
    const db = fakeDb(run());
    const out = await runImports(db.sb, { fetch: fakeGitHub({ fail: true }).fetch }, 60_000);
    expect(out).toEqual({ steps: 1, errors: 1 });
    expect(db.last('import_run_save')).toMatchObject({ p_cursor: { tries: 1 } });
    expect(db.calls.some((c) => c.fn === 'import_run_fail')).toBe(false);
    expect(await importStep(db.sb, { fetch: fakeGitHub().fetch }, run({ cursor: { tries: MAX_TRIES } }))).toBeNull();
    expect(db.last('import_run_fail')).toMatchObject({ p_failure: `The import stopped at eng after ${MAX_TRIES} tries.` });
  });

  it('keeps a run going while time is left, and lets it go when time is up', async () => {
    const db = fakeDb(run());
    let t = 0;
    const out = await runImports(db.sb, { fetch: fakeGitHub().fetch, now: () => (t += 1000) }, 2500);
    expect(out.steps).toBe(2);
    expect(db.last('import_run_save')).toMatchObject({ p_lease_seconds: 60 });
  });

  it('looks at the source of each published import and saves what is new; a language the source dropped finds nothing', async () => {
    const job = (orgId: string, parts: Record<string, string[]>): CheckJob => ({ orgId, importer: 'fia', source: 'BibleAquifer', parts });
    const db = fakeDb(null, [job('org-wc', { eng: ['eng-jhn-p1-v0'], xyz: ['xyz-jhn-p1-v1'] }), job('org-b', { eng: ['eng-jhn-p1-v1'] }), job('org-wc', { eng: [] })]);
    const out = await checkImports(db.sb, { fetch: fakeGitHub().fetch });
    expect(out).toEqual({ checked: 2, errors: 0 });
    const saved = db.calls.filter((c) => c.fn === 'import_check_save').map((c) => c.args);
    expect(saved).toEqual([
      { p_org: 'org-wc', p_importer: 'fia', p_found: { eng: { added: 0, updated: 1 } } },
      { p_org: 'org-b', p_importer: 'fia', p_found: {} }
    ]);
  });

  it('counts a look that fails, and goes on to the next', async () => {
    const db = fakeDb(null, [{ orgId: 'org-wc', importer: 'fia', source: 'BibleAquifer', parts: { eng: [] } }]);
    expect(await checkImports(db.sb, { fetch: fakeGitHub({ fail: true }).fetch })).toEqual({ checked: 0, errors: 1 });
    expect(db.calls.some((c) => c.fn === 'import_check_save')).toBe(false);
  });
});
