/**
 * LangQuest v2's language and region rows -> the rows to copy into this
 * app's tables of the same names (supabase/migrations/20261008000000_languoids.sql).
 * Pure, so it can be tested; `npm run languoids -- seed-v2` reads v2 and
 * inserts what this returns.
 *
 * v2 loaded Glottolog once, on 2025-10-01; every languoid it has from
 * Glottolog was made that day. Languoids made on other days (a list of
 * ISO 639-3 codes, a legacy "English", ones users made) stay behind, with
 * every row that hangs off them. Regions all come over. Ids, timestamps and
 * flags are kept as they are; download_profiles (PowerSync's) and
 * creator_id (v2's profiles) are not.
 */

export const V2_GLOTTOLOG_LOAD = { from: '2025-10-01', before: '2025-10-02' };

/** The columns read from each v2 table, in insert order (parents before what refers to them). */
export const V2_COLUMNS = {
  region: 'id,parent_id,name,level,geometry,active,created_at,last_updated,creator_id',
  languoid: 'id,parent_id,name,level,ui_ready,active,created_at,last_updated,creator_id',
  languoid_alias: 'id,subject_languoid_id,label_languoid_id,name,alias_type,source_names,active,created_at,last_updated,creator_id',
  languoid_source: 'id,name,version,languoid_id,unique_identifier,url,active,created_at,last_updated,creator_id',
  languoid_property: 'id,languoid_id,key,value,active,created_at,last_updated,creator_id',
  region_alias: 'id,subject_region_id,label_languoid_id,name,active,created_at,last_updated,creator_id',
  region_source: 'id,name,version,region_id,unique_identifier,url,active,created_at,last_updated,creator_id',
  region_property: 'id,region_id,key,value,active,created_at,last_updated,creator_id',
  languoid_region: 'id,languoid_id,region_id,majority,official,native,active,created_at,last_updated,creator_id'
} as const;

export type V2Table = keyof typeof V2_COLUMNS;
export type V2Row = Record<string, unknown> & { id: string; creator_id?: string | null };
export type V2Rows = Record<V2Table, V2Row[]>;

/** Parents first, so each insert's foreign keys already resolve. */
function treeOrder(rows: V2Row[]): V2Row[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const depth = new Map<string, number>();
  const depthOf = (r: V2Row): number => {
    const known = depth.get(r.id);
    if (known !== undefined) return known;
    const parent = r['parent_id'] ? byId.get(r['parent_id'] as string) : undefined;
    depth.set(r.id, 0); // guards a cycle
    const d = parent ? depthOf(parent) + 1 : 0;
    depth.set(r.id, d);
    return d;
  };
  return [...rows].sort((a, b) => depthOf(a) - depthOf(b));
}

export function v2Seed(v2: V2Rows): { rows: V2Rows; leftOut: Record<V2Table, number> } {
  const fromGlottolog = (l: V2Row) => {
    const at = String(l['created_at']);
    return !l.creator_id && at >= V2_GLOTTOLOG_LOAD.from && at < V2_GLOTTOLOG_LOAD.before;
  };
  const languoids = v2.languoid.filter(fromGlottolog);
  const lids = new Set(languoids.map((l) => l.id));
  const regions = v2.region.filter((r) => !r.creator_id);
  const rids = new Set(regions.map((r) => r.id));
  const has = (ids: Set<string>, v: unknown) => typeof v === 'string' && ids.has(v);

  const kept: V2Rows = {
    region: treeOrder(regions.map((r) => ({ ...r, parent_id: has(rids, r['parent_id']) ? r['parent_id'] : null }))),
    languoid: treeOrder(languoids.map((l) => ({ ...l, parent_id: has(lids, l['parent_id']) ? l['parent_id'] : null }))),
    languoid_alias: v2.languoid_alias.filter((a) => !a.creator_id && has(lids, a['subject_languoid_id']) && has(lids, a['label_languoid_id'])),
    languoid_source: v2.languoid_source.filter((s) => !s.creator_id && has(lids, s['languoid_id'])),
    languoid_property: v2.languoid_property.filter((p) => !p.creator_id && has(lids, p['languoid_id'])),
    region_alias: v2.region_alias.filter((a) => !a.creator_id && has(rids, a['subject_region_id']) && has(lids, a['label_languoid_id'])),
    region_source: v2.region_source.filter((s) => !s.creator_id && has(rids, s['region_id'])),
    region_property: v2.region_property.filter((p) => !p.creator_id && has(rids, p['region_id'])),
    languoid_region: v2.languoid_region.filter((x) => !x.creator_id && has(lids, x['languoid_id']) && has(rids, x['region_id']))
  };
  const rows = Object.fromEntries(
    Object.entries(kept).map(([t, list]) => [t, list.map(({ creator_id: _drop, ...r }) => r as V2Row)])
  ) as V2Rows;
  const leftOut = Object.fromEntries(
    (Object.keys(V2_COLUMNS) as V2Table[]).map((t) => [t, v2[t].length - rows[t].length])
  ) as Record<V2Table, number>;
  return { rows, leftOut };
}
