/**
 * Fill and refresh the language and region tables (docs/languoids.md).
 *
 *   npm run languoids -- seed-v2 [--dry-run] [--hosted]
 *   npm run languoids -- preview [--release v5.3] [--report <dir>]
 *   npm run languoids -- apply   [--release v5.3] [--hosted]
 *
 * seed-v2 copies LangQuest v2's languages and regions here once, as they
 * are: every languoid from v2's Glottolog load and every alias, source,
 * property and region link hanging off it, and every region with its
 * aliases and sources (scripts/v2Languoids.ts). It reads v2 anonymously
 * from V2_SUPABASE_URL with V2_SUPABASE_ANON_KEY (v2's publishable key)
 * and refuses to run if languoids are already here. --dry-run only counts.
 *
 * preview and apply bring in a Glottolog CLDF release (fetched from
 * GitHub, cached under GLOTTOLOG_CACHE): preview writes every languoid
 * change to <dir>/languoid-diff.csv and prints how many rows each table
 * would gain, changing nothing; apply makes the changes in one
 * transaction. The first apply after seed-v2 gives v2's rows their
 * glottocodes.
 *
 * The target is SUPABASE_URL (local by default) with
 * SUPABASE_SERVICE_ROLE_KEY. Writing to a hosted project needs --hosted and
 * the owner's go-ahead.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLDF_FILES, cldfUrl, stageGlottolog } from './glottolog';
import { isLocalUrl, LOCAL_URL, supabaseKey } from './local-supabase';
import { V2_COLUMNS, v2Seed, type V2Row, type V2Rows, type V2Table } from './v2Languoids';

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

if (command !== 'seed-v2' && command !== 'preview' && command !== 'apply') {
  console.error('usage: npm run languoids -- seed-v2 [--dry-run] | preview [--release v5.3] [--report <dir>] | apply [--release v5.3]  [--hosted]');
  process.exit(1);
}
const release = value('release', 'v5.3');
const url = process.env['SUPABASE_URL'] ?? LOCAL_URL;
const writes = command === 'apply' || (command === 'seed-v2' && !flag('dry-run'));
if (writes && !isLocalUrl(url) && !flag('hosted')) {
  console.error(`${url} is not local: pass --hosted to write there`);
  process.exit(1);
}
const db = createClient(url, supabaseKey('SUPABASE_SERVICE_ROLE_KEY', url), { auth: { persistSession: false } });

async function insertAll(client: SupabaseClient, table: string, rows: object[]) {
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await client.from(table).insert(rows.slice(i, i + 1000));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/** Every row of a v2 table, by id ranges in parallel (PostgREST caps a response at 1000). */
async function v2All(table: V2Table): Promise<V2Row[]> {
  const v2Url = process.env['V2_SUPABASE_URL'] ?? 'https://unsxkmlcyxgtgmtzfonb.supabase.co';
  const key = process.env['V2_SUPABASE_ANON_KEY'];
  if (!key) throw new Error('seed-v2 needs V2_SUPABASE_ANON_KEY (v2’s publishable key)');
  const hex = '0123456789abcdef';
  const parts = await Promise.all([...hex].map(async (h, i) => {
    const lo = `${h}0000000-0000-0000-0000-000000000000`;
    const hi = i < 15 ? `${hex[i + 1]}0000000-0000-0000-0000-000000000000` : null;
    const rows: V2Row[] = [];
    for (let after: string | null = null; ;) {
      const range = `id=gte.${lo}` + (after ? `&id=gt.${after}` : '') + (hi ? `&id=lt.${hi}` : '');
      const res = await fetch(`${v2Url}/rest/v1/${table}?select=${V2_COLUMNS[table]}&${range}&order=id&limit=1000`, {
        headers: { apikey: key, authorization: `Bearer ${key}` }
      });
      if (!res.ok) throw new Error(`v2 ${table}: HTTP ${res.status} ${await res.text()}`);
      const page = (await res.json()) as V2Row[];
      rows.push(...page);
      if (page.length < 1000) return rows;
      after = page[page.length - 1]!.id;
    }
  }));
  return parts.flat();
}

async function seedV2() {
  const tables = Object.keys(V2_COLUMNS) as V2Table[];
  const v2 = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await v2All(t)] as const))) as V2Rows;
  const { rows, leftOut } = v2Seed(v2);
  console.log('table               v2 rows   copied   left out');
  for (const t of tables) {
    console.log(`${t.padEnd(18)} ${String(v2[t].length).padStart(8)} ${String(rows[t].length).padStart(8)} ${String(leftOut[t]).padStart(10)}`);
  }
  if (flag('dry-run')) return;
  const { count, error } = await db.from('languoid').select('id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  if (count) throw new Error(`${count} languoids are already here; seed-v2 only fills empty tables`);
  for (const t of tables) {
    await insertAll(db, t, rows[t]);
    console.log(`copied ${t}`);
  }
  await rpc('languoid_analyze');
}

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

async function rpc<T>(fn: string, params?: object): Promise<T> {
  const { data, error } = await db.rpc(fn, params);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

const csvField = (v: unknown) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

async function stageRelease() {
  await rpc('languoid_staging_reset');
  const [languages, values, names] = await Promise.all(CLDF_FILES.map(cldf));
  const staged = stageGlottolog({ languages: languages!, values: values!, names: names! });
  await insertAll(db, 'languoid_staging_glottolog', staged.languoids);
  await insertAll(db, 'languoid_staging_glottolog_name', staged.names);
  await rpc('languoid_analyze');
  console.log(`staged Glottolog ${release}: ${staged.languoids.length} languoids, ${staged.names.length} names`);
}

if (command === 'seed-v2') {
  await seedV2();
} else if (command === 'preview') {
  await stageRelease();
  const diff: Record<string, string | null>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.rpc('languoid_import_diff').range(from, from + 999);
    if (error) throw new Error(error.message);
    diff.push(...(data as Record<string, string | null>[]));
    if (data.length < 1000) break;
  }
  const counts = await rpc<{ what: string; n: number }[]>('languoid_import_counts');
  const byChange = new Map<string, number>();
  for (const d of diff) byChange.set(d['change']!, (byChange.get(d['change']!) ?? 0) + 1);
  const dir = value('report', tmpdir());
  await mkdir(dir, { recursive: true });
  const cols = ['change', 'glottocode', 'id', 'name', 'field', 'old', 'new'];
  const file = join(dir, 'languoid-diff.csv');
  await writeFile(file, [cols.join(','), ...diff.map((d) => cols.map((c) => csvField(d[c])).join(','))].join('\n') + '\n');
  console.log(`\nApplying ${release} would, to languoids:`);
  for (const [change, n] of [...byChange].sort()) console.log(`  ${change.padEnd(13)} ${n}`);
  console.log('and to the other tables:');
  for (const c of counts) console.log(`  ${c.what.padEnd(42)} ${c.n}`);
  for (const change of byChange.keys()) {
    console.log(`\n${change}, first rows:`);
    for (const d of diff.filter((x) => x['change'] === change).slice(0, 5)) {
      console.log(`  ${[d['glottocode'], d['name'], d['field'], d['old'], d['new']].filter((x) => x != null).join(' | ')}`);
    }
  }
  console.log(`\nEvery languoid change: ${file}`);
  await rpc('languoid_staging_reset');
} else {
  await stageRelease();
  console.log(`applied Glottolog ${release}:`, await rpc('languoid_import_apply', { p_release: release }));
}
