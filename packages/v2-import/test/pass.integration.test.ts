/**
 * A pass against a real local database (`supabase start` with this
 * repository's migrations and `npm run library:seed`): v2 is a fake, the
 * files go to memory, everything else is the server.
 *
 *   SUPABASE_URL=http://127.0.0.1:54421 node scripts/with-local-keys.mjs npx vitest run packages/v2-import/test/pass.integration.test.ts
 *
 * Skipped without a service-role key, so `npm test` never needs a database.
 */
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { derivePassage, foldLanguage, foldOrg, type AnyEvent } from '@langquest-next/core';
import { sync, type BlobFilesLike, type V2Reader } from '../src';
import { supabaseTarget } from '../src/target';
import type { V2ProjectRows } from '../src/rows';

const URL = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
const SERVICE = process.env['SUPABASE_SERVICE_ROLE_KEY'] ?? '';

/** A WAV file of `ms` milliseconds of silence, 8 kHz mono 16-bit, with `tag` making its bytes its own. */
function wav(ms: number, tag: number): Uint8Array {
  const data = Math.round((8000 * 2 * ms) / 1000);
  const b = new Uint8Array(44 + data);
  const v = new DataView(b.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => (b[at + i] = c.charCodeAt(0)));
  text(0, 'RIFF'); v.setUint32(4, 36 + data, true); text(8, 'WAVE');
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, data, true);
  b[44] = tag;
  return b;
}

function project(id: string, assets: number): V2ProjectRows {
  const at = '2025-02-01T00:00:00Z';
  const ids = Array.from({ length: assets }, (_, i) => `${id}-a${i + 1}`);
  return {
    project: { id, name: `Kwa ${id}`, description: null, created_at: '2025-01-01T00:00:00Z', last_updated: at, active: true, private: false, creator_id: `${id}-owner`, template: 'bible' },
    languages: [{ languoid_id: '00000000-0000-4000-8000-00000000000a', language_type: 'target', active: true }],
    members: [{ profile_id: `${id}-owner`, membership: 'owner', active: true, created_at: at, last_updated: at }],
    quests: [
      { id: `${id}-mrk`, name: 'Mark', parent_id: null, metadata: JSON.stringify({ bible: { book: 'mar' } }), active: true, visible: true, duplicate_of: null, creator_id: null, created_at: at, last_updated: at },
      { id: `${id}-mrk1`, name: 'Mark 1', parent_id: `${id}-mrk`, metadata: JSON.stringify({ bible: { book: 'mar', chapter: 1 } }), active: true, visible: true, duplicate_of: null, creator_id: null, created_at: at, last_updated: at }
    ],
    placements: ids.map((a, i) => ({ quest_id: `${id}-mrk1`, asset_id: a, active: true, visible: true, order_index: (i + 1) * 1_000_000, metadata: JSON.stringify({ verse: { from: i + 1, to: i + 1 } }), created_at: at })),
    assets: ids.map((a, i) => ({ id: a, name: null, content_type: 'source', source_asset_id: null, creator_id: `${id}-owner`, active: true, visible: true, order_index: i, metadata: null, created_at: `2025-02-0${i + 1}T00:00:00Z`, last_updated: at })),
    contents: ids.map((a) => ({ id: `c-${a}`, asset_id: a, text: null, audio: [`${a}.wav`], languoid_id: '00000000-0000-4000-8000-00000000000a', source_language_id: null, active: true, order_index: 1, created_at: '2025-02-01 00:00:00' })),
    votes: [{ id: `${id}-v1`, asset_id: ids[0]!, polarity: 'up', comment: '', creator_id: `${id}-rev`, active: true, created_at: '2025-03-01T00:00:00Z', last_updated: '2025-03-01T00:00:00Z' }]
  };
}

function fakeV2(rows: Map<string, V2ProjectRows>): V2Reader {
  return {
    async projectRows(id) { return structuredClone(rows.get(id)!); },
    async changedSince() { return new Set(rows.keys()); },
    async projects() {
      return [...rows.values()].map(({ project: p }) => ({ id: p.id, name: p.name, active: p.active, private: p.private, created_at: p.created_at, creator_id: p.creator_id, template: p.template, assets: 0, lastActivity: null }));
    },
    async memberships() { return []; },
    async people(ids) { return ids.map((id) => ({ id, name: `Person ${id}`, email: null })); },
    async projectLanguages() { return []; },
    async download(name) {
      const n = Number(/a(\d+)\.wav$/.exec(name)?.[1] ?? 0);
      return n ? wav(500 + n * 100, n) : null;
    }
  };
}

function memoryFiles(): BlobFilesLike & { keys: Set<string> } {
  const keys = new Set<string>();
  return { keys, async list(prefix) { return [...keys].filter((k) => k.startsWith(prefix)).map((key) => ({ key, size: 1 })); }, async put(key) { keys.add(key); } };
}

describe.skipIf(!SERVICE)('a pass against the local database', () => {
  it('reads back more than the 1,000 rows the API returns from one call', async () => {
    const target = supabaseTarget(createClient(URL, SERVICE, { auth: { persistSession: false } }), memoryFiles());
    const tag = `rows-${Date.now().toString(36)}`;
    const keys = Array.from({ length: 2500 }, (_, i) => `k${String(i).padStart(5, '0')}`);
    await target.putLedger(tag, keys.map((key) => ({ key, streamId: '_org', n: 1, lastSaid: 1, digest: 'd', hlc: '', live: [], withdrawn: false })));
    expect((await target.ledger(tag)).size).toBe(2500);
    const names = keys.map((k) => `${tag}/${k}.wav`);
    await target.putFiles(names.map((name) => ({ name, file: { hash: 'a'.repeat(64), size: 1, durationMs: 1, format: 'wav' as const } })));
    expect((await target.files(names)).size).toBe(2500);
  });

  it('brings a confirmed project over once, then only what changes', async () => {
    const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
    const run = `t${Date.now().toString(36)}`;
    const id = `${run}-p`;
    const orgId = `org-v2-test-${run}`;
    const rows = new Map([[id, project(id, 2)]]);
    const files = memoryFiles();
    const target = supabaseTarget(db, files);
    await target.savePlan(
      [{ org_id: orgId, name: `Test ${run}`, existing: false, admins: [`${id}-owner`] }],
      [{ project_id: id, org_id: orgId, name: 'Kwa', languoid_id: null, code: 'kwa', confirmed: true }], 'test'
    );
    // The reviewer is made a coordinator on the dashboard.
    await target.setRole(id, `${id}-rev`, 'coordinator', 'test');
    const deps = { v2: fakeV2(rows), target };

    const first = await sync(deps, { projects: [id] });
    expect(first[0]?.rejected ?? []).toEqual([]);
    expect(first[0]?.files).toMatchObject({ copied: 2, uploaded: 2 });
    const second = await sync(deps, { projects: [id] });
    expect(second[0]?.append).toMatchObject({ accepted: 0 });

    rows.set(id, project(id, 3));
    const third = await sync(deps, { projects: [id] });
    expect(third[0]?.rejected ?? []).toEqual([]);

    const events = async (stream: string) => {
      const { data, error } = await db.from('events').select('id, type, org_id, stream_id, actor_id, device_id, hlc, payload').eq('org_id', orgId).eq('stream_id', stream).order('server_seq');
      if (error) throw error;
      return (data ?? []).map((e) => ({ id: e.id, type: e.type, orgId: e.org_id, streamId: e.stream_id, actorId: e.actor_id, deviceId: e.device_id, hlc: e.hlc, payload: e.payload }) as AnyEvent);
    };
    const org = foldOrg(await events('_org'));
    expect(org.languages[id]?.added?.name).toBe('Kwa');
    expect(org.members[`${id}-rev`]).toBeTruthy();
    expect(Object.values(org.members[`${id}-rev`] ?? {}).map((m) => m.roleId.value)).toEqual(['coordinator']);
    expect(Object.keys(org.library)).toEqual(['sub.langquest.langquest.bible.chapters']);
    const lang = foldLanguage(await events(id));
    expect(Object.keys(lang.invalidEvents)).toEqual([]);
    const passage = derivePassage(lang, 'sub.langquest.langquest.bible.chapters/MRK.1');
    expect(passage.versions.map((v) => v.cardHashes.length)).toEqual([2, 3]);
    expect(passage.reviews.map((r) => r.outcome)).toEqual(['looks_good']);
    const { data: names } = await db.from('profiles').select('id, display_name').in('id', [`${id}-owner`, `${id}-rev`]);
    expect((names ?? []).length).toBe(2);

    // The reviewer turns out to have an account in Next already: confirmed on the dashboard, their membership moves to it.
    await target.link(`${id}-rev`, `${id}-next`, null, 'test');
    const linked = await sync(deps, { projects: [id] });
    expect(linked[0]?.rejected ?? []).toEqual([]);
    const after = foldOrg(await events('_org'));
    const live = (who: string) => Object.values(after.members[who] ?? {}).filter((m) => !m.removed.value).map((m) => m.roleId.value);
    expect(live(`${id}-next`)).toEqual(['coordinator']);
    expect(live(`${id}-rev`)).toEqual([]);
    // Undo: the membership goes back to the v2 id.
    await target.unlink(`${id}-rev`, 'test');
    const undone = await sync(deps, { projects: [id] });
    expect(undone[0]?.rejected ?? []).toEqual([]);
    const back = foldOrg(await events('_org'));
    const liveBack = (who: string) => Object.values(back.members[who] ?? {}).filter((m) => !m.removed.value).map((m) => m.roleId.value);
    expect(liveBack(`${id}-rev`)).toEqual(['coordinator']);
    expect(liveBack(`${id}-next`)).toEqual([]);
  }, 60_000);

  it("follows FIA's guides for an FIA project and offers them to its team", async () => {
    const db = createClient(URL, SERVICE, { auth: { persistSession: false } });
    const run = `f${Date.now().toString(36)}`;
    const id = `${run}-p`;
    const orgId = `org-v2-test-${run}`;
    const rows = project(id, 0);
    rows.project.template = 'fia';
    rows.quests = [];
    const target = supabaseTarget(db, memoryFiles());
    await target.savePlan(
      [{ org_id: orgId, name: `Test ${run}`, existing: false, admins: [`${id}-owner`] }],
      [{ project_id: id, org_id: orgId, name: 'Kwa', languoid_id: null, code: 'kwa', confirmed: true }], 'test'
    );
    const first = await sync({ v2: fakeV2(new Map([[id, rows]])), target }, { projects: [id] });
    expect(first[0]?.rejected ?? []).toEqual([]);
    const events = async (stream: string) => {
      const { data, error } = await db.from('events').select('id, type, org_id, stream_id, actor_id, device_id, hlc, payload').eq('org_id', orgId).eq('stream_id', stream).order('server_seq');
      if (error) throw error;
      return (data ?? []).map((e) => ({ id: e.id, type: e.type, orgId: e.org_id, streamId: e.stream_id, actorId: e.actor_id, deviceId: e.device_id, hlc: e.hlc, payload: e.payload }) as AnyEvent);
    };
    const guides = 'sub.langquest.langquest.fia.eng';
    expect(Object.keys(foldOrg(await events('_org')).library)).toEqual(expect.arrayContaining([guides]));
    const lang = foldLanguage(await events(id));
    expect(Object.keys(lang.invalidEvents)).toEqual([]);
    expect(lang.languageReferences[guides]?.value).toBe('recommended');
  }, 60_000);
});
