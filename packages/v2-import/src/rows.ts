/**
 * LangQuest v2's rows for one project, as the import reads them: the columns
 * the mapper uses, named and typed as v2's Postgres has them (its migration
 * chain, read in order; docs/v2-import.md). Rows marked inactive are read
 * too, since the import takes back what v2 turned off.
 *
 * Two of v2's quirks are handled where rows are read, not here: production's
 * `asset_content_link.created_at` is text in several formats (`isoTime`), and
 * `metadata` columns hold JSON text, sometimes encoded twice (`metadataOf`).
 */

export type V2Template = 'unstructured' | 'bible' | 'fia';

export interface V2ProjectRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  last_updated: string;
  active: boolean | null;
  private: boolean | null;
  creator_id: string | null;
  template: V2Template | null;
}

/** project_language_link: one active target at most, any number of sources. */
export interface V2LanguageLink {
  languoid_id: string;
  language_type: 'source' | 'target';
  active: boolean;
}

/** profile_project_link: v2 knows owner and member only. */
export interface V2Membership {
  profile_id: string;
  membership: 'owner' | 'member';
  active: boolean;
  created_at: string;
  last_updated: string;
}

export interface V2Quest {
  id: string;
  name: string | null;
  parent_id: string | null;
  metadata: string | null;
  active: boolean;
  visible: boolean | null;
  /** A duplicate book quest v2 folded into another (its children moved there). */
  duplicate_of: string | null;
  creator_id: string | null;
  created_at: string;
  last_updated: string;
}

/** quest_asset_link: where an asset sits in a quest. An asset may sit in several. */
export interface V2Placement {
  quest_id: string;
  asset_id: string;
  active: boolean;
  visible: boolean;
  order_index: number;
  metadata: string | null;
  created_at: string;
}

export interface V2Asset {
  id: string;
  name: string | null;
  /** `source` is a recording or a piece of source material; `translation` and `transcription` hang off one (`source_asset_id`). */
  content_type: 'source' | 'translation' | 'transcription' | null;
  source_asset_id: string | null;
  creator_id: string | null;
  active: boolean;
  visible: boolean | null;
  order_index: number | null;
  metadata: string | null;
  created_at: string;
  last_updated: string;
}

/** asset_content_link: a segment of an asset, with text, audio files or both. */
export interface V2Content {
  id: string;
  asset_id: string;
  text: string | null;
  /** File names in v2's bucket. Names that never left a phone (`local/…`, `file://…`) are kept and reported. */
  audio: string[] | null;
  /** The segment's language; `source_language_id` holds a languoid id on rows from before. */
  languoid_id: string | null;
  source_language_id: string | null;
  active: boolean;
  order_index: number;
  created_at: string;
  /** When v2's server got the segment (its own clock, set on insert); `created_at` is the phone's. */
  uploaded_at?: string | null;
  /** When v2's server had every file `audio` names (its own clock, from its storage); null until then. */
  audio_uploaded_at?: string | null;
}

export interface V2Vote {
  id: string;
  asset_id: string;
  polarity: 'up' | 'down' | string;
  comment: string | null;
  creator_id: string | null;
  active: boolean;
  created_at: string;
  last_updated: string;
  /** When v2's server got the vote (its own clock, set on insert); `created_at` is the phone's. */
  uploaded_at?: string | null;
}

export interface V2ProjectRows {
  project: V2ProjectRow;
  languages: V2LanguageLink[];
  members: V2Membership[];
  quests: V2Quest[];
  placements: V2Placement[];
  assets: V2Asset[];
  contents: V2Content[];
  votes: V2Vote[];
}

/** v2's own time text as ISO 8601: a bare "2026-03-16 05:12:11" is UTC. */
export function isoTime(text: string): string {
  const t = text.trim().replace(' ', 'T');
  return /(Z|[+-]\d\d(:?\d\d)?)$/.test(t) ? t : `${t}Z`;
}

/** A `metadata` column's JSON, decoded once or twice; null when it is not an object. */
export function metadataOf(text: string | null): Record<string, unknown> | null {
  let v: unknown = text;
  for (let i = 0; i < 2 && typeof v === 'string'; i++) {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** A file name that reached v2's bucket, or null for one that never left a phone. */
export function bucketName(name: string): string | null {
  const n = name.trim();
  if (!n || /^(local\/|file:|blob:|content:|https?:)/i.test(n)) return null;
  return n;
}
