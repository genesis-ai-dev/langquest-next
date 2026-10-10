// The language list (docs/languoids.md): Glottolog's languages and dialects,
// global reference data the app searches online and never keeps. A language
// in an organization links to one with v1.LanguageCodeSet; until then it is
// unlinked (typed in offline, or not in Glottolog yet). Pure, so it can be
// tested; languoidPicker.tsx does the searching. Language names are
// Glottolog's data and are shown as they are; the words around them are the
// app's, in the language showing.
import { t } from './i18n';

/** One row of the SQL search_languoids. */
export interface LanguoidRow {
  id: string;
  name: string | null;
  level: string;
  parent_name: string | null;
  matched_alias_name: string | null;
  matched_alias_type: string | null;
  iso_code: string | null;
  glottocode: string | null;
}

/** A language someone may pick from the list. */
export interface LanguoidHit {
  id: string;
  name: string;
  dialect: boolean;
  parentName: string | null;
  /** The other name the search matched, when it was not the languoid's own. */
  alsoCalled: string | null;
  /** What a language linked to it goes by: its ISO 639-3 code, else its glottocode. */
  code: string;
}

export function languoidHits(rows: readonly LanguoidRow[]): LanguoidHit[] {
  return rows.flatMap((r) => {
    const code = (r.iso_code ?? r.glottocode ?? '').toLowerCase();
    if (!r.name || !code) return [];
    // A code that matched says nothing a reader needs: the code is shown anyway.
    const other = r.matched_alias_name && r.matched_alias_type !== 'iso639-3' && r.matched_alias_type !== 'glottolog'
      && r.matched_alias_name.toLowerCase() !== r.name.toLowerCase() ? r.matched_alias_name : null;
    return [{ id: r.id, name: r.name, dialect: r.level === 'dialect', parentName: r.parent_name, alsoCalled: other, code }];
  });
}

/**
 * Glottolog's places for languages it cannot classify (its "pseudo
 * families"), which say nothing as a family: "Bookkeeping family" would.
 */
// i18n-ignore: Glottolog's own names for these, compared with its data and never shown
const NO_FAMILY = new Set(['Bookkeeping', 'Unclassifiable', 'Unattested']);

/** What a match says under its name: "DIK · Dinka family · also called Rek". */
export function hitLine(h: LanguoidHit): string {
  const parent = h.parentName && !NO_FAMILY.has(h.parentName) ? h.parentName : null;
  const where = parent ? (h.dialect ? t('languoid.dialectOf', { parent }) : t('languoid.family', { parent })) : h.dialect ? t('languoid.dialect') : null;
  return [h.code.toUpperCase(), where, h.alsoCalled ? t('languoid.alsoCalled', { name: h.alsoCalled }) : null].filter(Boolean).join(' · ');
}
