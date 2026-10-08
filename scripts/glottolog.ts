/**
 * Glottolog -> the nine language and region tables
 * (supabase/migrations/20261009000000_languoids.sql), keyed by glottocode.
 * Pure, so it can be tested; scripts/languoids.ts fetches the release,
 * gives the rows their ids and loads them.
 *
 * The source is Glottolog's own data for one release
 * (https://github.com/glottolog/glottolog, CC BY 4.0): one md.ini per
 * languoid under languoids/tree, nested as the classification is, with its
 * name, level, codes, coordinates, macroareas, countries, links and other
 * names by provider. Two things md.ini leaves to Glottolog's software come
 * from the same release's CLDF files: the category (values.csv), and the
 * macroareas of a languoid whose md.ini names none (languages.csv, which
 * gives dialects and families their language's or members' macroareas).
 *
 * The rows are shaped as LangQuest v2's loader shaped them
 * (genesis-ai-dev/wikidata-collection), so the tables mean what they meant
 * in v2: names labelled with the languoid they are written in, endonym when
 * that is the languoid itself; links as sources named by site; hid,
 * macroareas, category and coordinates as properties; continents and
 * nations as regions.
 */
import { LABEL_ISO639_3, MACROLANGUAGE_PRINCIPAL } from './glottologLabelCodes';

export interface GlottologFile {
  glottocode: string;
  /** The glottocode of the directory it sits in, or null at the top. */
  parent: string | null;
  ini: string;
}

export type Level = 'family' | 'language' | 'dialect';

export interface GlottologTables {
  languoids: { glottocode: string; parent_glottocode: string | null; name: string; level: Level }[];
  aliases: { glottocode: string; label_glottocode: string; name: string; alias_type: 'endonym' | 'exonym'; source_names: string[] }[];
  sources: { glottocode: string; name: string; version: string | null; unique_identifier: string; url: string | null }[];
  properties: { glottocode: string; key: string; value: string }[];
  regions: { key: string; name: string; level: 'continent' | 'nation'; iso3166_1: string | null }[];
  languoidRegions: { glottocode: string; region_key: string }[];
  /** Names left out because the language they are written in has no single languoid, by tag. */
  unlabelled: Record<string, number>;
}

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and newlines. Rows as header -> value. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  if (!header) return [];
  return body
    .filter((r) => r.length > 1 || r[0] !== '')
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/** Glottolog's INI: [section], key = value, and values continued on tab-indented lines. */
export function parseIni(text: string): Record<string, Record<string, string[]>> {
  const out: Record<string, Record<string, string[]>> = {};
  let section: Record<string, string[]> | null = null;
  let values: string[] | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    const head = /^\[(.+)\]\s*$/.exec(line);
    if (head) {
      section = out[head[1]!] ??= {};
      values = null;
      continue;
    }
    if (/^[ \t]/.test(line)) {
      values?.push(line.trim());
      continue;
    }
    const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (kv && section) {
      values = section[kv[1]!] = kv[2] ? [kv[2].trim()] : [];
    }
  }
  return out;
}

// v2's loader named a link's source by its site, and took its last path
// segment as the identifier.
const SITES: [RegExp, string][] = [
  [/wals\.info/, 'wals'], [/phoible\.org/, 'phoible'], [/wikipedia\.org/, 'wikipedia'], [/wikidata\.org/, 'wikidata'],
  [/grambank\.clld\.org/, 'grambank'], [/lexibank\.clld\.org/, 'lexibank'], [/terrasindigenas\.org\.br/, 'terrasindigenas'],
  [/aiatsis\.gov\.au/, 'aiatsis'], [/endangeredlanguages\.com/, 'elcat']
];

export function linkSource(link: string): { name: string; unique_identifier: string; url: string } | null {
  const url = (/\((https?:\/\/[^)\s]+)\)\s*$/.exec(link) ?? /(https?:\/\/\S+)/.exec(link))?.[1];
  if (!url) return null;
  const host = (/^https?:\/\/([^/]+)/.exec(url)?.[1] ?? '').toLowerCase().replace(/^www\./, '');
  const name = SITES.find(([re]) => re.test(host))?.[1] ?? host.split(':')[0]!;
  let id = url.replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/^.*\//, '');
  if (name === 'wals') id = id.replace(/^wals_code_/, '');
  try {
    id = decodeURIComponent(id);
  } catch {
    // keep it as written
  }
  return id ? { name, unique_identifier: id, url } : null;
}

const LEVELS = new Set<string>(['family', 'language', 'dialect']);
// Placeholders some providers give instead of a name.
const NOT_A_NAME = new Set(['not specified', 'unspecified', 'unknown', '-', '?']);
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });

export function buildGlottolog(input: { files: GlottologFile[]; values: string; languages: string; release: string }): GlottologTables {
  const category = new Map<string, string>();
  for (const v of parseCsv(input.values)) {
    // v2 wrote categories as Glottolog's site does: "Spoken L1 Language".
    if (v['Parameter_ID'] === 'category' && v['Value']) category.set(v['Language_ID']!, v['Value'].replace(/_/g, ' '));
  }

  const cldfMacroareas = new Map<string, string[]>();
  for (const l of parseCsv(input.languages)) {
    const m = (l['Macroarea'] ?? '').split(';').map((x) => x.trim()).filter(Boolean);
    if (m.length) cldfMacroareas.set(l['ID']!, m);
  }

  const parsed = input.files.map((f) => ({ ...f, md: parseIni(f.ini) }));
  const t: GlottologTables = { languoids: [], aliases: [], sources: [], properties: [], regions: [], languoidRegions: [], unlabelled: {} };
  const one = (md: Record<string, Record<string, string[]>>, s: string, k: string) => md[s]?.[k]?.[0] ?? null;

  // The languoid each ISO 639-3 code labels a name with: the one that has
  // the code, when only one does.
  const byIso = new Map<string, string | null>();
  for (const f of parsed) {
    const iso = one(f.md, 'core', 'iso639-3');
    if (iso) byIso.set(iso, byIso.has(iso) ? null : f.glottocode);
  }

  const continents = new Set<string>();
  const nations = new Set<string>();
  for (const { glottocode, parent, md } of parsed) {
    const name = one(md, 'core', 'name');
    const level = one(md, 'core', 'level');
    if (!name) throw new Error(`${glottocode}: no name`);
    if (!level || !LEVELS.has(level)) throw new Error(`${glottocode}: unknown level "${level}"`);
    t.languoids.push({ glottocode, parent_glottocode: parent, name, level: level as Level });

    const iso = one(md, 'core', 'iso639-3');
    t.sources.push({ glottocode, name: 'glottolog', version: input.release, unique_identifier: glottocode, url: `https://glottolog.org/resource/languoid/id/${glottocode}` });
    if (iso) t.sources.push({ glottocode, name: 'iso639-3', version: null, unique_identifier: iso, url: null });
    const seen = new Set(t.sources.filter((s) => s.glottocode === glottocode).map((s) => `${s.name}\u0000${s.unique_identifier}`));
    for (const link of md['core']?.['links'] ?? []) {
      const s = linkSource(link);
      if (!s || seen.has(`${s.name}\u0000${s.unique_identifier}`)) continue;
      seen.add(`${s.name}\u0000${s.unique_identifier}`);
      t.sources.push({ glottocode, version: null, ...s });
    }

    const own = md['core']?.['macroareas'] ?? [];
    const macroareas = own.length ? own : (cldfMacroareas.get(glottocode) ?? []);
    const countries = md['core']?.['countries'] ?? [];
    const props: [string, string | null][] = [
      ['hid', one(md, 'core', 'hid')],
      ['macroareas', macroareas.length ? macroareas.join(', ') : null],
      ['category', category.get(glottocode) ?? null],
      ['latitude', one(md, 'core', 'latitude')],
      ['longitude', one(md, 'core', 'longitude')]
    ];
    for (const [key, value] of props) if (value) t.properties.push({ glottocode, key, value });

    for (const m of macroareas) {
      continents.add(m);
      t.languoidRegions.push({ glottocode, region_key: `continent:${m}` });
    }
    for (const c of countries) {
      nations.add(c);
      t.languoidRegions.push({ glottocode, region_key: `iso3166-1:${c}` });
    }

    // Names, as v2's loader did: an untagged name is English; artificial
    // languages get none.
    if (category.get(glottocode) === 'Artificial Language') continue;
    const names = new Map<string, GlottologTables['aliases'][number]>();
    for (const [provider, list] of Object.entries(md['altnames'] ?? {})) {
      for (const raw of list) {
        const tagged = /^(.*?)\s*\[([A-Za-z-]+)\]$/.exec(raw);
        const text = (tagged ? tagged[1]! : raw).trim();
        if (!text || NOT_A_NAME.has(text.toLowerCase())) continue;
        const tag = tagged?.[2];
        // A script subtag ("bo-Tibt") names the same language; a three-letter
        // tag the table lacks is taken as an ISO 639-3 code.
        const base = tag?.split('-')[0];
        const labelIso = tag ? (LABEL_ISO639_3[tag] ?? LABEL_ISO639_3[base!] ?? (/^[a-z]{3}$/.test(base!) ? base : undefined)) : 'eng';
        const label = labelIso ? (byIso.get(labelIso) ?? byIso.get(MACROLANGUAGE_PRINCIPAL[labelIso] ?? '')) : undefined;
        if (!label) {
          t.unlabelled[tag ?? 'eng'] = (t.unlabelled[tag ?? 'eng'] ?? 0) + 1;
          continue;
        }
        const alias_type = label === glottocode ? 'endonym' : 'exonym';
        const key = `${label}\u0000${alias_type}\u0000${text}`;
        const row = names.get(key) ?? { glottocode, label_glottocode: label, name: text, alias_type, source_names: [] };
        if (!row.source_names.includes(provider)) row.source_names.push(provider);
        names.set(key, row);
      }
    }
    for (const row of names.values()) {
      row.source_names.sort();
      t.aliases.push(row);
    }
  }

  for (const m of [...continents].sort()) t.regions.push({ key: `continent:${m}`, name: m, level: 'continent', iso3166_1: null });
  for (const c of [...nations].sort()) t.regions.push({ key: `iso3166-1:${c}`, name: regionNames.of(c) ?? c, level: 'nation', iso3166_1: c });
  return t;
}

/**
 * The v2 languoid each glottocode is, so a languoid keeps the id v2 gave it
 * and imported v2 projects still point at it. v2 never kept glottocodes, so:
 * its ISO 639-3 code where that is unique on both sides, else its chain of
 * names from the root, else a name and level only one languoid has on each
 * side. Each is used at most once either way.
 */
export function matchV2(
  v2: { id: string; parent_id: string | null; name: string | null; level: string; iso639_3: string | null }[],
  glottolog: { glottocode: string; parent_glottocode: string | null; name: string; level: string; iso639_3: string | null }[]
): Map<string, { id: string; matched_on: 'iso639-3' | 'name path' | 'name and level' }> {
  const count = <T>(xs: T[], key: (x: T) => string | null) => {
    const m = new Map<string, number>();
    for (const x of xs) {
      const k = key(x);
      if (k !== null) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const path = <T extends { name: string | null; level: string }>(byId: Map<string, T>, parentOf: (x: T) => string | null) => {
    const memo = new Map<T, string>();
    const of = (x: T, depth = 0): string => {
      const known = memo.get(x);
      if (known !== undefined) return known;
      const parentKey = parentOf(x);
      const parent = parentKey ? byId.get(parentKey) : undefined;
      const p = (parent && depth < 64 ? of(parent, depth + 1) + '/' : '') + `${x.name ?? ''}:${x.level}`;
      memo.set(x, p);
      return p;
    };
    return of;
  };

  const v2ById = new Map(v2.map((x) => [x.id, x]));
  const glById = new Map(glottolog.map((x) => [x.glottocode, x]));
  const v2Path = path(v2ById, (x) => x.parent_id);
  const glPath = path(glById, (x) => x.parent_glottocode);
  const v2Iso = count(v2, (x) => x.iso639_3);
  const glIso = count(glottolog, (x) => x.iso639_3);
  const glPaths = count(glottolog, (x) => glPath(x));
  const v2Names = count(v2, (x) => `${x.name}\u0000${x.level}`);
  const glNames = count(glottolog, (x) => `${x.name}\u0000${x.level}`);
  const glByIso = new Map(glottolog.filter((x) => x.iso639_3).map((x) => [x.iso639_3!, x]));
  const glByPath = new Map(glottolog.map((x) => [glPath(x), x]));
  const glByName = new Map(glottolog.map((x) => [`${x.name}\u0000${x.level}`, x]));

  const out = new Map<string, { id: string; matched_on: 'iso639-3' | 'name path' | 'name and level' }>();
  const used = new Set<string>();
  const take = (rank: 'iso639-3' | 'name path' | 'name and level', pick: (x: (typeof v2)[number]) => (typeof glottolog)[number] | undefined) => {
    for (const x of v2) {
      if (used.has(x.id)) continue;
      const g = pick(x);
      if (!g || out.has(g.glottocode)) continue;
      out.set(g.glottocode, { id: x.id, matched_on: rank });
      used.add(x.id);
    }
  };
  take('iso639-3', (x) => (x.iso639_3 && v2Iso.get(x.iso639_3) === 1 && glIso.get(x.iso639_3) === 1 ? glByIso.get(x.iso639_3) : undefined));
  take('name path', (x) => (glPaths.get(v2Path(x)) === 1 ? glByPath.get(v2Path(x)) : undefined));
  take('name and level', (x) => {
    const k = `${x.name}\u0000${x.level}`;
    return v2Names.get(k) === 1 && glNames.get(k) === 1 ? glByName.get(k) : undefined;
  });
  return out;
}
