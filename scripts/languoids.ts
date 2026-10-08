/**
 * Fill and refresh the language and region tables from Glottolog
 * (docs/languoids.md).
 *
 *   npm run languoids -- preview [--release v5.3] [--report <dir>]
 *   npm run languoids -- apply   [--release v5.3] [--hosted]
 *   npm run languoids -- explore [--release v5.3] --out <file.html>
 *
 * Each builds the nine tables from one Glottolog release
 * (scripts/glottolog.ts): the release's languoid files, fetched with git
 * (sparse, about 110 MB) and its CLDF languages.csv and values.csv, all
 * cached under GLOTTOLOG_CACHE. A languoid keeps the id it already has here
 * (found by its glottocode source); one not here yet takes the id
 * LangQuest v2 gave it, when V2_SUPABASE_ANON_KEY (v2's publishable key) is
 * set, so imported v2 projects keep pointing at it; otherwise a new UUID.
 * Only v2's ids are read, never its content.
 *
 * preview stages the tables and writes every languoid change to
 * <dir>/languoid-diff.csv with counts per table, changing nothing. apply
 * makes the changes in one transaction. explore writes a page to browse,
 * search and check the tables before loading them (scripts/languoidExplorer.html),
 * without a database.
 *
 * The target is SUPABASE_URL (local by default) with
 * SUPABASE_SERVICE_ROLE_KEY. Writing to a hosted project needs --hosted and
 * the owner's go-ahead.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { buildGlottolog, matchV2, type GlottologFile, type GlottologTables } from './glottolog';
import { isLocalUrl, LOCAL_URL, supabaseKey } from './local-supabase';

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};

if (command !== 'preview' && command !== 'apply' && command !== 'explore') {
  console.error('usage: npm run languoids -- preview [--report <dir>] | apply [--hosted] | explore --out <file>   [--release v5.3]');
  process.exit(1);
}
const release = value('release', 'v5.3');
const cache = join(process.env['GLOTTOLOG_CACHE'] ?? join(tmpdir(), 'langquest-glottolog'), release);
const url = process.env['SUPABASE_URL'] ?? LOCAL_URL;
if (command === 'apply' && !isLocalUrl(url) && !flag('hosted')) {
  console.error(`${url} is not local: pass --hosted to write there`);
  process.exit(1);
}
const db = command === 'explore' ? null : createClient(url, supabaseKey('SUPABASE_SERVICE_ROLE_KEY', url), { auth: { persistSession: false } });

// ---- the release --------------------------------------------------------------

async function cldf(file: string): Promise<string> {
  const path = join(cache, file);
  if (existsSync(path)) return readFile(path, 'utf8');
  const from = `https://raw.githubusercontent.com/glottolog/glottolog-cldf/${encodeURIComponent(release)}/cldf/${file}`;
  console.log(`fetching ${file}`);
  const res = await fetch(from);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status} from ${from}`);
  const text = await res.text();
  await mkdir(cache, { recursive: true });
  await writeFile(path, text);
  return text;
}

/** The release's languoid files: a sparse, shallow clone of glottolog/glottolog at the tag. */
async function languoidFiles(): Promise<GlottologFile[]> {
  const repo = join(cache, 'glottolog');
  if (!existsSync(join(repo, 'languoids', 'tree'))) {
    console.log(`fetching Glottolog ${release} languoid files (git)`);
    await mkdir(cache, { recursive: true });
    execFileSync('git', ['clone', '--quiet', '--depth', '1', '--branch', release, '--filter=blob:none', '--sparse', 'https://github.com/glottolog/glottolog.git', repo], { stdio: 'inherit' });
    execFileSync('git', ['-C', repo, 'sparse-checkout', 'set', 'languoids/tree'], { stdio: 'inherit' });
  }
  const files: GlottologFile[] = [];
  const walk = async (dir: string, parent: string | null) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const d = join(dir, e.name);
      files.push({ glottocode: e.name, parent, ini: await readFile(join(d, 'md.ini'), 'utf8') });
      await walk(d, e.name);
    }
  };
  await walk(join(repo, 'languoids', 'tree'), null);
  return files;
}

// ---- ids ----------------------------------------------------------------------

async function pageAll<T>(client: SupabaseClient, table: string, select: string, filter: (q: any) => any = (q) => q): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(client.from(table).select(select)).order('id').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as T[]));
    if (data.length < 1000) return out;
  }
}

async function v2Rows<T>(path: string): Promise<T[]> {
  const v2Url = process.env['V2_SUPABASE_URL'] ?? 'https://unsxkmlcyxgtgmtzfonb.supabase.co';
  const key = process.env['V2_SUPABASE_ANON_KEY']!;
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${v2Url}/rest/v1/${path}&order=id`, {
      headers: { apikey: key, authorization: `Bearer ${key}`, range: `${from}-${from + 999}`, 'range-unit': 'items' }
    });
    if (!res.ok) throw new Error(`v2 ${path}: HTTP ${res.status} ${await res.text()}`);
    const page = (await res.json()) as T[];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

export interface Ids {
  languoid: Map<string, string>;
  region: Map<string, string>;
  /** How each languoid got its id: here, v2 (and how matched), or new. */
  origin: Map<string, string>;
}

async function assignIds(t: GlottologTables): Promise<Ids> {
  const ids: Ids = { languoid: new Map(), region: new Map(), origin: new Map() };
  if (db) {
    for (const s of await pageAll<{ languoid_id: string; unique_identifier: string }>(db, 'languoid_source', 'id,languoid_id,unique_identifier', (q) => q.eq('name', 'glottolog'))) {
      ids.languoid.set(s.unique_identifier, s.languoid_id);
      ids.origin.set(s.unique_identifier, 'here');
    }
    for (const s of await pageAll<{ region_id: string; unique_identifier: string }>(db, 'region_source', 'id,region_id,unique_identifier', (q) => q.eq('name', 'iso3166-1'))) {
      ids.region.set(`iso3166-1:${s.unique_identifier}`, s.region_id);
    }
    for (const r of await pageAll<{ id: string; name: string }>(db, 'region', 'id,name', (q) => q.eq('level', 'continent'))) {
      ids.region.set(`continent:${r.name}`, r.id);
    }
  }
  if (process.env['V2_SUPABASE_ANON_KEY']) {
    // Only v2's Glottolog load (2025-10-01); the languoids its users made never come over.
    const v2 = await v2Rows<{ id: string; parent_id: string | null; name: string | null; level: string }>(
      'languoid?select=id,parent_id,name,level&creator_id=is.null&created_at=gte.2025-10-01&created_at=lt.2025-10-02'
    );
    const iso = new Map((await v2Rows<{ languoid_id: string; unique_identifier: string }>('languoid_source?select=id,languoid_id,unique_identifier&name=eq.iso639-3')).map((s) => [s.languoid_id, s.unique_identifier]));
    const glIso = new Map(t.sources.filter((s) => s.name === 'iso639-3').map((s) => [s.glottocode, s.unique_identifier]));
    const taken = new Set(ids.languoid.values());
    const matches = matchV2(
      v2.filter((x) => !taken.has(x.id)).map((x) => ({ ...x, iso639_3: iso.get(x.id) ?? null })),
      t.languoids.filter((l) => !ids.languoid.has(l.glottocode)).map((l) => ({ ...l, iso639_3: glIso.get(l.glottocode) ?? null }))
    );
    for (const [glottocode, m] of matches) {
      ids.languoid.set(glottocode, m.id);
      ids.origin.set(glottocode, `v2 (${m.matched_on})`);
    }
    const regions = await v2Rows<{ id: string; name: string; level: string }>('region?select=id,name,level');
    const codes = new Map((await v2Rows<{ region_id: string; unique_identifier: string }>('region_source?select=id,region_id,unique_identifier&name=eq.iso3166-1')).map((s) => [s.region_id, s.unique_identifier]));
    for (const r of regions) {
      const key = r.level === 'continent' ? `continent:${r.name}` : codes.has(r.id) ? `iso3166-1:${codes.get(r.id)}` : null;
      if (key && !ids.region.has(key)) ids.region.set(key, r.id);
    }
    console.log(`v2 ids: ${matches.size} of ${v2.length} v2 Glottolog languoids matched`);
  }
  for (const l of t.languoids) {
    if (!ids.languoid.has(l.glottocode)) {
      ids.languoid.set(l.glottocode, randomUUID());
      ids.origin.set(l.glottocode, 'new');
    }
  }
  for (const r of t.regions) if (!ids.region.has(r.key)) ids.region.set(r.key, randomUUID());
  return ids;
}

// ---- staging, preview, apply ---------------------------------------------------

async function insertAll(table: string, rows: object[]) {
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await db!.from(table).insert(rows.slice(i, i + 1000));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function rpc<T>(fn: string, params?: object): Promise<T> {
  const { data, error } = await db!.rpc(fn, params);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

async function stage(t: GlottologTables, ids: Ids) {
  await rpc('languoid_staging_reset');
  await insertAll('languoid_staging', t.languoids.map((l) => ({ id: ids.languoid.get(l.glottocode), ...l })));
  await insertAll('region_staging', t.regions.map((r) => ({ id: ids.region.get(r.key), ...r })));
  await insertAll('languoid_alias_staging', t.aliases);
  await insertAll('languoid_source_staging', t.sources);
  await insertAll('languoid_property_staging', t.properties);
  await insertAll('languoid_region_staging', t.languoidRegions);
  await rpc('languoid_analyze');
}

const csvField = (v: unknown) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

// ---- the explorer's data -------------------------------------------------------

/** The tables, columnar and indexed, for the explorer page. */
function explorerData(t: GlottologTables, ids: Ids) {
  const li = new Map(t.languoids.map((l, i) => [l.glottocode, i]));
  const ri = new Map(t.regions.map((r, i) => [r.key, i]));
  const dict = (values: string[]) => {
    const list = [...new Set(values)];
    const at = new Map(list.map((v, i) => [v, i]));
    return { list, at };
  };
  const sourceNames = dict(t.aliases.map((a) => a.source_names.join('|')));
  const sourceKinds = dict(t.sources.map((s) => s.name));
  const propKeys = dict(t.properties.map((p) => p.key));
  const levels = ['family', 'language', 'dialect'];
  return {
    release,
    built: new Date().toISOString(),
    unlabelled: t.unlabelled,
    languoid: {
      id: t.languoids.map((l) => ids.languoid.get(l.glottocode)),
      glottocode: t.languoids.map((l) => l.glottocode),
      name: t.languoids.map((l) => l.name),
      level: t.languoids.map((l) => levels.indexOf(l.level)),
      parent: t.languoids.map((l) => (l.parent_glottocode ? li.get(l.parent_glottocode)! : -1)),
      origin: t.languoids.map((l) => ids.origin.get(l.glottocode) ?? 'new')
    },
    alias: {
      subject: t.aliases.map((a) => li.get(a.glottocode)),
      label: t.aliases.map((a) => li.get(a.label_glottocode)),
      name: t.aliases.map((a) => a.name),
      endonym: t.aliases.map((a) => (a.alias_type === 'endonym' ? 1 : 0)),
      sources: t.aliases.map((a) => sourceNames.at.get(a.source_names.join('|'))),
      sourceList: sourceNames.list
    },
    source: {
      languoid: t.sources.map((s) => li.get(s.glottocode)),
      kind: t.sources.map((s) => sourceKinds.at.get(s.name)),
      kindList: sourceKinds.list,
      id: t.sources.map((s) => s.unique_identifier),
      // The glottolog URL is rebuilt from the glottocode.
      url: t.sources.map((s) => (s.name === 'glottolog' ? '' : s.url ?? '')),
      version: t.sources.map((s) => s.version ?? '')
    },
    property: {
      languoid: t.properties.map((p) => li.get(p.glottocode)),
      key: t.properties.map((p) => propKeys.at.get(p.key)),
      keyList: propKeys.list,
      value: t.properties.map((p) => p.value)
    },
    region: {
      id: t.regions.map((r) => ids.region.get(r.key)),
      name: t.regions.map((r) => r.name),
      level: t.regions.map((r) => r.level),
      iso: t.regions.map((r) => r.iso3166_1 ?? '')
    },
    languoidRegion: {
      languoid: t.languoidRegions.map((x) => li.get(x.glottocode)),
      region: t.languoidRegions.map((x) => ri.get(x.region_key))
    }
  };
}

// ---- run -------------------------------------------------------------------------

const [values, languages, files] = await Promise.all([cldf('values.csv'), cldf('languages.csv'), languoidFiles()]);
const tables = buildGlottolog({ files, values, languages, release });
console.log(`Glottolog ${release}: ${tables.languoids.length} languoids, ${tables.aliases.length} names, ${tables.sources.length} sources, ${tables.properties.length} properties, ${tables.regions.length} regions, ${tables.languoidRegions.length} region links`);
const ids = await assignIds(tables);

if (command === 'explore') {
  // The page (scripts/languoidExplorer.html) with the tables in it, gzipped
  // and base64'd: one file, about 3.5 MB, that opens anywhere.
  const out = value('out', join(tmpdir(), 'languoid-explorer.html'));
  const data = gzipSync(JSON.stringify(explorerData(tables, ids)), { level: 9 }).toString('base64');
  const page = await readFile(new URL('./languoidExplorer.html', import.meta.url), 'utf8');
  await writeFile(out, page.replace('__DATA__', data));
  console.log(`explorer: ${out}`);
} else if (command === 'preview') {
  await stage(tables, ids);
  const diff: Record<string, string | null>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db!.rpc('languoid_import_diff').range(from, from + 999);
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
  console.log('and to every table:');
  for (const c of counts) console.log(`  ${c.what.padEnd(36)} ${c.n}`);
  console.log(`\nEvery languoid change: ${file}`);
  await rpc('languoid_staging_reset');
} else {
  await stage(tables, ids);
  console.log(`applied Glottolog ${release}:`, await rpc('languoid_import_apply', { p_release: release }));
}
