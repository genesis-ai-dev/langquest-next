/**
 * Glottolog's CLDF release -> rows for the languoid staging tables
 * (supabase/migrations/20261008000000_languoids.sql). Pure, so it can be
 * tested; scripts/languoids.ts fetches the files and loads the rows.
 *
 * The release is https://github.com/glottolog/glottolog-cldf, files under
 * cldf/: languages.csv (one row per languoid), values.csv (level, category
 * and classification, among others) and names.csv (other names, by
 * provider).
 */

export const CLDF_FILES = ['languages.csv', 'values.csv', 'names.csv'] as const;

export const cldfUrl = (release: string, file: string) =>
  `https://raw.githubusercontent.com/glottolog/glottolog-cldf/${encodeURIComponent(release)}/cldf/${file}`;

export interface StagedLanguoid {
  glottocode: string;
  parent_glottocode: string | null;
  name: string;
  level: 'family' | 'language' | 'dialect';
  category: string | null;
  iso639_3: string | null;
  latitude: number | null;
  longitude: number | null;
  macroareas: string[];
  countries: string[];
}

export interface StagedName {
  glottocode: string;
  name: string;
  lang: string | null;
  providers: string[];
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

const list = (v: string | undefined) => (v ? v.split(';').map((s) => s.trim()).filter(Boolean) : []);
const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : null);
const LEVELS = new Set(['family', 'language', 'dialect']);
// Placeholders some providers give instead of a name.
const NOT_A_NAME = new Set(['not specified', 'unspecified', 'unknown', '-', '?']);

export function stageGlottolog(files: { languages: string; values: string; names: string }): {
  languoids: StagedLanguoid[];
  names: StagedName[];
} {
  const parent = new Map<string, string>();
  const category = new Map<string, string>();
  for (const v of parseCsv(files.values)) {
    if (v['Parameter_ID'] === 'classification' && v['Value']) {
      parent.set(v['Language_ID']!, v['Value'].split('/').pop()!);
    } else if (v['Parameter_ID'] === 'category' && v['Value']) {
      category.set(v['Language_ID']!, v['Value']);
    }
  }

  const languoids: StagedLanguoid[] = [];
  for (const l of parseCsv(files.languages)) {
    const glottocode = l['Glottocode'] || l['ID']!;
    const level = l['Level']!;
    if (!LEVELS.has(level)) throw new Error(`${glottocode}: unknown level "${level}"`);
    languoids.push({
      glottocode,
      parent_glottocode: parent.get(glottocode) ?? null,
      name: l['Name']!,
      level: level as StagedLanguoid['level'],
      category: category.get(glottocode) ?? null,
      iso639_3: l['ISO639P3code'] || null,
      latitude: num(l['Latitude']),
      longitude: num(l['Longitude']),
      macroareas: list(l['Macroarea']),
      countries: list(l['Countries'])
    });
  }

  // One row per (languoid, name, language), with every provider that gives it.
  const known = new Set(languoids.map((l) => l.glottocode));
  const byKey = new Map<string, StagedName>();
  for (const n of parseCsv(files.names)) {
    const glottocode = n['Language_ID']!;
    const name = (n['Name'] ?? '').trim();
    if (!known.has(glottocode) || !name || NOT_A_NAME.has(name.toLowerCase())) continue;
    const lang = n['lang']?.trim() || null;
    const key = `${glottocode}\u0000${name}\u0000${lang ?? ''}`;
    const row = byKey.get(key) ?? { glottocode, name, lang, providers: [] };
    const provider = n['Provider']?.trim();
    if (provider && !row.providers.includes(provider)) row.providers.push(provider);
    byKey.set(key, row);
  }
  for (const row of byKey.values()) row.providers.sort();

  return { languoids, names: [...byKey.values()] };
}

/**
 * langquest v2 loaded Glottolog once, on 2025-10-01; every languoid it has
 * from Glottolog was made then. Rows made on other days came from elsewhere (an ISO
 * 639-3 list, a legacy "English", languoids users made) and are left behind.
 */
export const V2_GLOTTOLOG_LOAD = { from: '2025-10-01', before: '2025-10-02' };

export interface V2Languoid {
  id: string;
  parent_id: string | null;
  name: string | null;
  level: string;
}

/** v2's Glottolog rows and their aliases -> the v2 staging tables. Aliases are tagged with their label language's ISO 639-3 code. */
export function stageV2(
  languoids: V2Languoid[],
  iso: { languoid_id: string; unique_identifier: string }[],
  aliases: { subject_languoid_id: string; label_languoid_id: string; name: string }[]
) {
  const ids = new Set(languoids.map((l) => l.id));
  const isoOf = new Map(iso.filter((s) => /^[a-z]{3}$/.test(s.unique_identifier)).map((s) => [s.languoid_id, s.unique_identifier]));
  return {
    languoids: languoids.map((l) => ({
      id: l.id, parent_id: l.parent_id && ids.has(l.parent_id) ? l.parent_id : null, name: l.name, level: l.level, iso639_3: isoOf.get(l.id) ?? null
    })),
    names: aliases
      .filter((a) => ids.has(a.subject_languoid_id) && a.name.trim())
      .map((a) => ({ languoid_id: a.subject_languoid_id, name: a.name.trim(), lang: isoOf.get(a.label_languoid_id) ?? null }))
  };
}
