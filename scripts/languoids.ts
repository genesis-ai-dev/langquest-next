/**
 * Load Glottolog into the languoid tables (docs/languoids.md).
 *
 *   npm run languoids -- preview [--release v5.3] [--v2] [--report <dir>]
 *   npm run languoids -- apply   [--release v5.3] [--v2] [--hosted]
 *
 * Both fetch the release's CLDF files from GitHub (cached under
 * GLOTTOLOG_CACHE), stage them, and ask the database what would change:
 * new languoids, changed names, levels, parents and ISO codes, and ones the
 * release no longer has (they are retired, never deleted). `preview` writes
 * that to <dir>/languoid-diff.csv and a summary to the console and stops;
 * `apply` makes the changes in one transaction and records the release in
 * languoid_import.
 *
 * --v2 also stages langquest v2's Glottolog rows (creator_id is null; the
 * languoids v2 users made are left behind) read anonymously from
 * V2_SUPABASE_URL / V2_SUPABASE_ANON_KEY, as `npm run import:v2` does. Each
 * one matched to a glottocode keeps its v2 UUID, so imported v2 projects
 * keep pointing at their languages. Run it with the first import; once the
 * rows are here it adds nothing.
 *
 * The target is SUPABASE_URL (local by default) with
 * SUPABASE_SERVICE_ROLE_KEY. `apply` to a hosted project needs --hosted and
 * the owner's go-ahead.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLDF_FILES, cldfUrl, stageGlottolog } from './glottolog';
import { isLocalUrl, LOCAL_URL, supabaseKey } from './local-supabase';

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

if (command !== 'preview' && command !== 'apply') {
  console.error('usage: npm run languoids -- preview|apply [--release v5.3] [--v2] [--report <dir>] [--hosted]');
  process.exit(1);
}
const release = value('release', 'v5.3');
const url = process.env['SUPABASE_URL'] ?? LOCAL_URL;
if (command === 'apply' && !isLocalUrl(url) && !flag('hosted')) {
  console.error(`${url} is not local: pass --hosted to apply there`);
  process.exit(1);
}
const db = createClient(url, supabaseKey('SUPABASE_SERVICE_ROLE_KEY', url), { auth: { persistSession: false } });

async function cldf(file: string): Promise<string> {
  const dir = join(process.env['GLOTTOLOG_CACHE'] ?? join(tmpdir(), 'langquest-glottolog'), release);
  const path = join(dir, file);
  try {
    return await readFile(path, 'utf8');
  } catch {
    // not cached
  }
  console.log(`fetching ${file} (${release})`);
  const res = await fetch(cldfUrl(release, file));
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status} from ${cldfUrl(release, file)}`);
  const text = await res.text();
  await mkdir(dir, { recursive: true });
  await writeFile(path, text);
  return text;
}

async function insertAll(client: SupabaseClient, table: string, rows: object[]) {
  for (let i = 0; i < rows.length; i += 2000) {
    const { error } = await client.from(table).insert(rows.slice(i, i + 2000));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/** Every row of a v2 table, page by page (PostgREST caps a response). */
async function v2All<T>(path: string): Promise<T[]> {
  const v2Url = process.env['V2_SUPABASE_URL'] ?? 'https://unsxkmlcyxgtgmtzfonb.supabase.co';
  const key = process.env['V2_SUPABASE_ANON_KEY'];
  if (!key) throw new Error('--v2 needs V2_SUPABASE_ANON_KEY');
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${v2Url}/rest/v1/${path}`, {
      headers: { apikey: key, authorization: `Bearer ${key}`, range: `${from}-${from + 999}`, 'range-unit': 'items' }
    });
    if (!res.ok) throw new Error(`v2 ${path}: HTTP ${res.status} ${await res.text()}`);
    const page = (await res.json()) as T[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

async function stageV2() {
  const languoids = await v2All<{ id: string; parent_id: string | null; name: string | null; level: string }>(
    'languoid?select=id,parent_id,name,level&creator_id=is.null&active=is.true&order=id'
  );
  const iso = await v2All<{ languoid_id: string; unique_identifier: string }>(
    'languoid_source?select=languoid_id,unique_identifier&name=eq.iso639-3&active=is.true&order=id'
  );
  const aliases = await v2All<{ subject_languoid_id: string; label_languoid_id: string; name: string }>(
    'languoid_alias?select=subject_languoid_id,label_languoid_id,name&creator_id=is.null&active=is.true&order=id'
  );
  const ids = new Set(languoids.map((l) => l.id));
  const isoOf = new Map(iso.filter((s) => /^[a-z]{3}$/.test(s.unique_identifier)).map((s) => [s.languoid_id, s.unique_identifier]));
  await insertAll(
    db,
    'languoid_staging_v2',
    languoids.map((l) => ({ ...l, parent_id: l.parent_id && ids.has(l.parent_id) ? l.parent_id : null, iso639_3: isoOf.get(l.id) ?? null }))
  );
  await insertAll(
    db,
    'languoid_staging_v2_name',
    aliases.filter((a) => ids.has(a.subject_languoid_id)).map((a) => ({ languoid_id: a.subject_languoid_id, name: a.name.trim(), lang: isoOf.get(a.label_languoid_id) ?? null }))
  );
  console.log(`staged v2: ${languoids.length} languoids, ${aliases.length} names`);
}

const csvField = (v: unknown) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

const reset = await db.rpc('languoid_staging_reset');
if (reset.error) throw new Error(reset.error.message);

const [languages, values, names] = await Promise.all(CLDF_FILES.map(cldf));
const staged = stageGlottolog({ languages: languages!, values: values!, names: names! });
await insertAll(db, 'languoid_staging_glottolog', staged.languoids);
await insertAll(db, 'languoid_staging_glottolog_name', staged.names);
console.log(`staged Glottolog ${release}: ${staged.languoids.length} languoids, ${staged.names.length} names`);
if (flag('v2')) await stageV2();

if (command === 'preview') {
  const diff: Record<string, string | null>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.rpc('languoid_import_diff').range(from, from + 999);
    if (error) throw new Error(error.message);
    diff.push(...(data as Record<string, string | null>[]));
    if (data.length < 1000) break;
  }
  const counts = new Map<string, number>();
  for (const d of diff) counts.set(d['change']!, (counts.get(d['change']!) ?? 0) + 1);
  const dir = value('report', tmpdir());
  await mkdir(dir, { recursive: true });
  const cols = ['change', 'glottocode', 'id', 'name', 'field', 'old', 'new'];
  const file = join(dir, 'languoid-diff.csv');
  await writeFile(file, [cols.join(','), ...diff.map((d) => cols.map((c) => csvField(d[c])).join(','))].join('\n') + '\n');
  console.log(`\nApplying ${release} would:`);
  for (const [change, n] of [...counts].sort()) console.log(`  ${change.padEnd(13)} ${n}`);
  if (counts.size === 0) console.log('  change nothing');
  for (const change of counts.keys()) {
    console.log(`\n${change}, first rows:`);
    for (const d of diff.filter((x) => x['change'] === change).slice(0, 5)) {
      console.log(`  ${[d['glottocode'], d['name'], d['field'], d['old'], d['new']].filter((x) => x != null).join(' | ')}`);
    }
  }
  console.log(`\nEvery row: ${file}`);
  await db.rpc('languoid_staging_reset');
} else {
  const { data, error } = await db.rpc('languoid_import_apply', { p_release: release });
  if (error) throw new Error(error.message);
  console.log(`applied Glottolog ${release}:`, data);
}
