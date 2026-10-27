/**
 * Publisher imports (decisions.md 173, docs/publisher-imports.md): the
 * runs organizations' admins ask for, built by the app Worker's schedule.
 * Each step takes the oldest open run (`import_run_next`, which holds it for
 * a while), builds one more part of it, keeps the documents for the run
 * (nobody can read them yet) and saves where it got to; a run with nothing
 * left finishes with the items an admin then publishes from the app. A step
 * that dies leaves the run to the next one, which starts that part again:
 * documents are named by their content, so nothing is kept twice.
 *
 * The FIA importer builds one language a step, from Bible Aquifer's
 * repositories under the importer's source (server/fiaAquifer.ts).
 */
import { canonicalJson, type LibraryDoc } from '@langquest-next/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  contentFiles, fiaCollection, fiaGuide, guideArticles, languageNameOf, picturesFrom, termsFrom,
  type AquiferArticle, type AquiferMetadata, type FiaResources
} from './fiaAquifer';

/** What a step was given: the run, as `import_run_next` answers it. */
export interface OpenRun {
  id: string;
  orgId: string;
  importer: string;
  source: string;
  options: { languages?: string[] };
  cursor: Cursor;
  done: number;
  total: number | null;
}

/** An item the run made, as the admin's app publishes it. */
export interface ImportedItem { itemId: string; kind: 'material'; name: string; description: string; docHash: string; count: number; language: string }

/** Where a run has got to: what each finished part made, the parts its source lacks, and failed tries of the part in hand. */
export interface Cursor { items?: ImportedItem[]; missing?: string[]; tries?: number }

export interface ImportDeps {
  fetch: typeof fetch;
  /** Milliseconds; a test's clock. */
  now?: () => number;
}

/** How long a step holds its run: longer than one part takes, short enough that a dead step's run is soon taken up. */
export const LEASE_SECONDS = 15 * 60;
/** A part that fails this many times fails the run. */
export const MAX_TRIES = 3;
/** Documents per call (import_run_put_documents takes 500; a guide is 10–40 KB). */
const BATCH = 40;

/** A source answered in a way that will not change by trying again: the run fails with this, in words for the admin. */
export class ImportProblem extends Error {}

async function rpc<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Keeps a run's documents, a batch at a time, checking the server named each as we did. */
class RunDocs {
  private pending: { text: string; hash: string }[] = [];
  private kept = new Set<string>();
  constructor(private sb: SupabaseClient, private run: string) {}

  async put(doc: LibraryDoc): Promise<string> {
    const text = canonicalJson(doc);
    const hash = await sha256(text);
    if (!this.kept.has(hash)) { this.kept.add(hash); this.pending.push({ text, hash }); }
    if (this.pending.length >= BATCH) await this.flush();
    return hash;
  }

  async flush(): Promise<void> {
    while (this.pending.length) {
      const batch = this.pending.splice(0, BATCH);
      const got = await rpc<string[]>(this.sb, 'import_run_put_documents', { p_run: this.run, p_bodies: batch.map((d) => d.text) });
      batch.forEach((d, i) => { if (got[i] !== d.hash) throw new Error(`the server named a document ${String(got[i])}, not ${d.hash}`); });
    }
  }
}

async function getJson<T>(deps: ImportDeps, url: string): Promise<T | null> {
  const res = await deps.fetch(url, { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

const raw = (owner: string, repo: string, path: string) => `https://raw.githubusercontent.com/${owner}/${repo}/main/${path}`;

/** Every article in one language's folder of one repository; null when the repository has no such language. */
async function folder(deps: ImportDeps, owner: string, repo: string, lang: string): Promise<{ meta: AquiferMetadata; articles: () => AsyncGenerator<AquiferArticle[]> } | null> {
  const meta = await getJson<AquiferMetadata>(deps, raw(owner, repo, `${lang}/metadata.json`));
  if (!meta) return null;
  return {
    meta,
    async *articles() {
      for (const file of contentFiles(meta)) {
        const list = await getJson<AquiferArticle[]>(deps, raw(owner, repo, `${lang}/${file}`));
        if (!Array.isArray(list)) throw new ImportProblem(`${repo}/${lang}/${file} is not a list of articles.`);
        yield list;
      }
    }
  };
}

async function all(f: Awaited<ReturnType<typeof folder>>): Promise<AquiferArticle[]> {
  const out: AquiferArticle[] = [];
  if (f) for await (const list of f.articles()) out.push(...list);
  return out;
}

/** The English versification FIA numbers its passages by: LangQuest's own document, which the run keeps a copy of. */
async function englishVersification(sb: SupabaseClient, docs: RunDocs): Promise<string> {
  const rows = await rpc<{ hash: string; body: string; is_current: boolean }[]>(sb, 'library_docs_for_publisher', { p_org: 'langquest', p_item: 'langquest.versification.eng' });
  const current = (rows ?? []).find((r) => r.is_current);
  if (!current) throw new ImportProblem('LangQuest has no English versification to number FIA\'s passages by.');
  const hash = await docs.put(JSON.parse(current.body) as LibraryDoc);
  if (hash !== current.hash) throw new Error('the English versification changed when copied');
  return hash;
}

/** One language of FIA: its guides, then the collection that lists them. Null when Aquifer has no FIA in that language. */
export async function importFiaLanguage(sb: SupabaseClient, deps: ImportDeps, run: OpenRun, lang: string): Promise<ImportedItem | null> {
  const guidesFolder = await folder(deps, run.source, 'FIATranslationGuide', lang);
  if (!guidesFolder) return null;
  const languageName = languageNameOf(guidesFolder.meta, lang);
  const docs = new RunDocs(sb, run.id);
  const versification = await englishVersification(sb, docs);
  // Terms and pictures in the language, else English's; maps are English only.
  const terms = termsFrom(await all(await folder(deps, run.source, 'FIAKeyTerms', lang) ?? await folder(deps, run.source, 'FIAKeyTerms', 'eng')));
  const pictures = picturesFrom(await all(await folder(deps, run.source, 'FIAImages', lang) ?? await folder(deps, run.source, 'FIAImages', 'eng')));
  const maps = picturesFrom(await all(await folder(deps, run.source, 'FIAMaps', lang) ?? await folder(deps, run.source, 'FIAMaps', 'eng')));
  const res: FiaResources = { terms, pictures, maps };
  const entries: { ref: string; title: string; doc: string }[] = [];
  for await (const list of guidesFolder.articles()) {
    for (const { text, audio } of guideArticles(list)) {
      const guide = fiaGuide(text, audio, res, lang, languageName, versification);
      if (guide) entries.push({ ref: guide.ref, title: guide.title, doc: await docs.put(guide) });
    }
  }
  if (!entries.length) throw new ImportProblem(`Bible Aquifer's FIA in ${languageName} has no guides LangQuest can read.`);
  const c = fiaCollection(lang, languageName, versification, entries);
  const docHash = await docs.put(c.doc);
  await docs.flush();
  return { itemId: c.itemId, kind: 'material', name: c.name, description: c.description, docHash, count: entries.length, language: lang };
}

/** The parts of a run, in order: for FIA, its languages. */
const partsOf = (run: OpenRun) => (run.importer === 'fia' ? [...(run.options.languages ?? [])] : []);

/**
 * One step of a run: the next part, then where it got to. Answers the run
 * with its new place when parts are left, and null when the run is over
 * (finished, failed, withdrawn).
 */
export async function importStep(sb: SupabaseClient, deps: ImportDeps, run: OpenRun): Promise<OpenRun | null> {
  const parts = partsOf(run);
  const cursor: Cursor = { items: [...(run.cursor.items ?? [])], missing: [...(run.cursor.missing ?? [])], tries: run.cursor.tries ?? 0 };
  const done = new Set([...cursor.items!.map((i) => i.language), ...cursor.missing!]);
  const next = parts.find((p) => !done.has(p));
  if (!next) {
    if (!cursor.items!.length) {
      await rpc(sb, 'import_run_fail', { p_run: run.id, p_failure: `Bible Aquifer has no FIA in ${cursor.missing!.join(', ')}.` });
      return null;
    }
    await rpc(sb, 'import_run_finish', { p_run: run.id, p_manifest: cursor.items });
    return null;
  }
  // Count the try before making it, so a part that kills its step still counts.
  if (cursor.tries! >= MAX_TRIES) {
    await rpc(sb, 'import_run_fail', { p_run: run.id, p_failure: `The import stopped at ${next} after ${MAX_TRIES} tries.` });
    return null;
  }
  const save = (c: Cursor, n: number, lease = LEASE_SECONDS) =>
    rpc<boolean>(sb, 'import_run_save', { p_run: run.id, p_cursor: c, p_done: n, p_total: parts.length, p_lease_seconds: lease });
  if (!await save({ ...cursor, tries: cursor.tries! + 1 }, done.size)) return null;
  try {
    const item = run.importer === 'fia' ? await importFiaLanguage(sb, deps, run, next) : null;
    if (item) cursor.items!.push(item); else cursor.missing!.push(next);
  } catch (e) {
    if (e instanceof ImportProblem) {
      await rpc(sb, 'import_run_fail', { p_run: run.id, p_failure: e.message });
      return null;
    }
    throw e;
  }
  cursor.tries = 0;
  if (!await save(cursor, done.size + 1)) return null;
  return { ...run, cursor, done: done.size + 1, total: parts.length };
}

/**
 * Steps until `budgetMs` has gone or no run is open: what the Worker's
 * schedule runs. A run keeps its step until it is over or time is up; then
 * it is let go, for the next schedule to take up.
 */
export async function runImports(sb: SupabaseClient, deps: ImportDeps, budgetMs: number): Promise<{ steps: number; errors: number }> {
  const now = deps.now ?? Date.now;
  const until = now() + budgetMs;
  let steps = 0, errors = 0;
  while (now() < until) {
    let run = await rpc<OpenRun | null>(sb, 'import_run_next', { p_lease_seconds: LEASE_SECONDS });
    if (!run) break;
    try {
      while (run) {
        steps++;
        run = await importStep(sb, deps, run);
        if (run && now() >= until) {
          await rpc(sb, 'import_run_save', { p_run: run.id, p_cursor: run.cursor, p_done: run.done, p_total: run.total, p_lease_seconds: 60 });
          break;
        }
      }
    } catch (e) {
      // Left to a later schedule, once its hold runs out; the tries it counted stop it going round for ever.
      errors++;
      console.error(`import ${run?.id ?? ''}`, e);
      break;
    }
  }
  return { steps, errors };
}
