import { describe, expect, it } from 'vitest';
import { v2Seed, type V2Rows } from './v2Languoids';

const LOAD = '2025-10-01T03:26:56+00:00';
const l = (id: string, parent: string | null, extra: object = {}) => ({ id, parent_id: parent, name: id, level: 'language', ui_ready: false, active: true, created_at: LOAD, last_updated: LOAD, creator_id: null, ...extra });

const v2: V2Rows = {
  region: [{ id: 'r-ss', parent_id: null, name: 'South Sudan', level: 'nation', creator_id: null }],
  // child before parent, to check the order; a user-made and an ISO-list languoid stay behind
  languoid: [l('dinka', 'nilotic'), l('nilotic', null, { level: 'family' }), l('mine', null, { creator_id: 'p1' }), l('old-hittite', null, { created_at: '2025-12-08T00:00:00+00:00' }), l('english', null)],
  languoid_alias: [
    { id: 'a1', subject_languoid_id: 'dinka', label_languoid_id: 'english', name: 'Jieng', alias_type: 'exonym', creator_id: null },
    { id: 'a2', subject_languoid_id: 'mine', label_languoid_id: 'english', name: 'Mine', alias_type: 'exonym', creator_id: null }
  ],
  languoid_source: [
    { id: 's1', languoid_id: 'dinka', name: 'iso639-3', unique_identifier: 'din', creator_id: null },
    { id: 's2', languoid_id: 'old-hittite', name: 'iso639-3', unique_identifier: 'oht', creator_id: null }
  ],
  languoid_property: [{ id: 'p1', languoid_id: 'dinka', key: 'fia_available', value: 'true', creator_id: null }],
  region_alias: [{ id: 'ra', subject_region_id: 'r-ss', label_languoid_id: 'english', name: 'S. Sudan', creator_id: null }],
  region_source: [{ id: 'rs', region_id: 'r-ss', name: 'iso3166-1', unique_identifier: 'SS', creator_id: null }],
  region_property: [],
  languoid_region: [
    { id: 'lr1', languoid_id: 'dinka', region_id: 'r-ss', native: true, creator_id: null },
    { id: 'lr2', languoid_id: 'mine', region_id: 'r-ss', creator_id: null }
  ]
};

describe('v2Seed', () => {
  const { rows, leftOut } = v2Seed(v2);

  it('keeps only languoids from the Glottolog load, parents first', () => {
    expect(rows.languoid.map((x) => x.id)).toEqual(['nilotic', 'english', 'dinka']);
    expect(leftOut.languoid).toBe(2);
  });

  it('keeps every row that hangs off a kept languoid or region, ids and all, and nothing else', () => {
    expect(rows.languoid_alias.map((x) => x.id)).toEqual(['a1']);
    expect(rows.languoid_source.map((x) => x.id)).toEqual(['s1']);
    expect(rows.languoid_property.map((x) => x.id)).toEqual(['p1']);
    expect(rows.languoid_region).toEqual([{ id: 'lr1', languoid_id: 'dinka', region_id: 'r-ss', native: true }]);
    expect(rows.region_alias.map((x) => x.id)).toEqual(['ra']);
    expect(rows.region_source.map((x) => x.id)).toEqual(['rs']);
  });

  it('drops v2 profile ids', () => {
    expect(Object.values(rows).flat().some((r) => 'creator_id' in r)).toBe(false);
  });
});
