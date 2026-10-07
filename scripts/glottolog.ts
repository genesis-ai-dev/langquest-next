import { LABEL_ISO639_3 } from './glottologLabelCodes';

/**
 * Glottolog's CLDF release -> rows for the languoid staging tables, and
 * LangQuest v2's language and region rows -> the rows to copy here
 * (supabase/migrations/20261008000000_languoids.sql). Pure, so it can be
 * tested; scripts/languoids.ts fetches and loads.
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
  /** The ISO 639-3 code of the language the name is written in. */
  label_iso639_3: string;
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
      // v2 wrote categories as Glottolog's site does: "Spoken L1 Language".
      category.set(v['Language_ID']!, v['Value'].replace(/_/g, ' '));
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

  // One row per (languoid, name, label language), with every provider that
  // gives it. As v2's loader did: a name with no language tag is English,
  // and artificial languages get no names.
  const artificial = new Set(languoids.filter((l) => l.category === 'Artificial Language').map((l) => l.glottocode));
  const known = new Set(languoids.map((l) => l.glottocode));
  const byKey = new Map<string, StagedName>();
  for (const n of parseCsv(files.names)) {
    const glottocode = n['Language_ID']!;
    const name = (n['Name'] ?? '').trim();
    if (!known.has(glottocode) || artificial.has(glottocode) || !name || NOT_A_NAME.has(name.toLowerCase())) continue;
    const tag = n['lang']?.trim();
    const label = tag ? LABEL_ISO639_3[tag] : 'eng';
    if (!label) throw new Error(`${glottocode}: no ISO 639-3 code for the language tag "${tag}" (scripts/glottologLabelCodes.ts)`);
    const key = `${glottocode}\u0000${name}\u0000${label}`;
    const row = byKey.get(key) ?? { glottocode, name, label_iso639_3: label, providers: [] };
    const provider = n['Provider']?.trim();
    if (provider && !row.providers.includes(provider)) row.providers.push(provider);
    byKey.set(key, row);
  }
  for (const row of byKey.values()) row.providers.sort();

  return { languoids, names: [...byKey.values()] };
}

