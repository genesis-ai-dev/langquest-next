import { ORG_STREAM, type AnyEvent } from '@langquest-next/core';
import { sha256Hex } from '../src/audio';
import type { CopiedFile } from '../src/map';
import type { LedgerEntry } from '../src/reconcile';
import { sync, type PassDeps } from '../src/pass';
import type { V2ProjectRows } from '../src/rows';

/**
 * A project that came over into one organization comes over again into
 * another as a new language (decisions.md 94, amended 2026-10-24): Every
 * Language asked for BIRAT RAJBANSHI, which had come over into its owners'
 * own organization, and a language cannot move, since its events carry its
 * organization. Driven by fakes: a project already read into one
 * organization, its placement then given another organization and a new
 * language id, as `v2_import_move` does.
 */

const at = '2026-02-27T09:24:48Z';
const NEW = '5c1d0a2e-7b4f-4c1e-9f3a-2d6b8e0f1a77';
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function wav(ms: number, tag: number): Uint8Array {
  const data = Math.round((8000 * 2 * ms) / 1000);
  const b = new Uint8Array(44 + data);
  const v = new DataView(b.buffer);
  b.set(ascii('RIFF'), 0); v.setUint32(4, 36 + data, true); b.set(ascii('WAVE'), 8);
  b.set(ascii('fmt '), 12); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  b.set(ascii('data'), 36); v.setUint32(40, data, true);
  b[44] = tag;
  return b;
}

const rows: V2ProjectRows = {
  project: { id: 'birat', name: 'BIRAT RAJBANSHI', description: null, created_at: at, last_updated: at, active: true, private: false, creator_id: 'owner', template: 'unstructured' },
  languages: [{ languoid_id: 'rjs', language_type: 'target', active: true }],
  members: [{ profile_id: 'owner', membership: 'owner', active: true, created_at: at, last_updated: at }],
  quests: [{ id: 'q1', name: 'Mark 1', parent_id: null, metadata: null, active: true, visible: true, duplicate_of: null, creator_id: 'owner', created_at: at, last_updated: at }],
  placements: [1, 2].map((i) => ({ quest_id: 'q1', asset_id: `a${i}`, active: true, visible: true, order_index: i, metadata: null, created_at: at })),
  assets: [1, 2].map((i) => ({ id: `a${i}`, name: `Part ${i}`, content_type: 'source', source_asset_id: null, creator_id: 'owner', active: true, visible: true, order_index: i, metadata: null, created_at: at, last_updated: at })),
  contents: [1, 2].map((i) => ({ id: `c${i}`, asset_id: `a${i}`, text: null, audio: [`a${i}.wav`], languoid_id: 'rjs', source_language_id: null, active: true, order_index: 1, created_at: at })),
  votes: []
};
const bucket: Record<string, Uint8Array> = { 'a1.wav': wav(500, 1), 'a2.wav': wav(700, 2) };

function fakes() {
  const placement = { project_id: 'birat', org_id: 'org-birat', languoid_id: null, code: 'rjs', confirmed_by: 'caleb', confirmed_at: at, language_id: null as string | null, moved_at: null as string | null };
  const ledgers = new Map<string, Map<string, LedgerEntry>>();
  const fileMap = new Map<string, CopiedFile | { missingSince: string }>();
  const r2 = new Set<string>();
  const passes: { project_id: string; finished_at: string; report: unknown }[] = [];
  let events: AnyEvent[] = [];
  let now = Date.parse('2026-10-24T05:00:00Z');
  const target = {
    plan: async () => ({
      orgs: [
        { org_id: 'org-birat', name: 'BIRAT RAJBANSHI', existing: false, admins: ['owner'] },
        { org_id: 'org-v2-everylanguage', name: 'Every Language', existing: false, admins: ['el'] }
      ],
      placements: [{ ...placement }], roles: [], links: [], passes: [...passes]
    }),
    cursor: async (_name: string, value?: Date) => (value ? null : new Date(now - 60_000)),
    passStart: async () => 1,
    passProgress: async () => {},
    passFinish: async (_id: number, report: { projectId: string }) => { passes.push({ project_id: report.projectId, finished_at: new Date(now).toISOString(), report }); },
    log: async () => {},
    orgCreator: async () => null,
    ledger: async (scope: string) => new Map(ledgers.get(scope) ?? []),
    putLedger: async (scope: string, entries: LedgerEntry[]) => {
      const l = ledgers.get(scope) ?? new Map<string, LedgerEntry>();
      for (const e of entries) l.set(e.key, e);
      ledgers.set(scope, l);
    },
    append: async (list: AnyEvent[]) => { events.push(...list); return { accepted: list.length, duplicates: 0, rejected: [] }; },
    files: async (names: string[]) => new Map(names.flatMap((n) => (fileMap.has(n) ? [[n, fileMap.get(n)!] as const] : []))),
    putFiles: async (list: { name: string; file: CopiedFile | null }[]) => { for (const f of list) fileMap.set(f.name, f.file ?? { missingSince: new Date(now).toISOString() }); },
    stored: async (org: string, lang: string) => new Set([...r2].filter((k) => k.startsWith(`${org}/${lang}/`)).map((k) => k.split('/')[2]!)),
    upload: async (org: string, lang: string, hash: string) => { r2.add(`${org}/${lang}/${hash}`); },
    addNames: async () => {}
  };
  const v2 = {
    projectRows: async () => structuredClone(rows),
    changedSince: async () => new Set<string>(),
    projects: async () => [{ id: 'birat', name: 'BIRAT RAJBANSHI', template: 'unstructured' }],
    people: async () => [],
    download: async (name: string) => bucket[name] ?? null
  };
  const deps = { target, v2, wait: async () => {}, now: () => now } as unknown as PassDeps;
  return {
    placement, ledgers, r2,
    /** A 15-minute pass, a while after the last. */
    pass: async () => {
      now += 15 * 60_000;
      events = [];
      const reports = await sync(deps);
      return { reports, events };
    },
    /** What `v2_import_move` does to the placement. */
    move: () => {
      now += 60_000;
      Object.assign(placement, { org_id: 'org-v2-everylanguage', language_id: NEW, moved_at: new Date(now).toISOString() });
    }
  };
}

describe('a project brought over again into another organization', () => {
  it('becomes a new language there, with its whole work and its recordings stored again for it', async () => {
    const f = fakes();
    const first = await f.pass();
    expect(first.events.find((e) => e.type === 'v1.LanguageAdded')).toMatchObject({ orgId: 'org-birat', streamId: ORG_STREAM, payload: { languageId: 'birat' } });

    f.move();
    const again = await f.pass();
    // Read on the next 15-minute pass, though v2 says nothing changed.
    expect(again.reports.map((r) => r.projectId)).toEqual(['birat']);
    const added = again.events.find((e) => e.type === 'v1.LanguageAdded');
    expect(added).toMatchObject({ orgId: 'org-v2-everylanguage', streamId: ORG_STREAM, payload: { languageId: NEW, name: 'BIRAT RAJBANSHI' } });
    const work = again.events.filter((e) => e.streamId !== ORG_STREAM);
    expect(work.length).toBeGreaterThan(0);
    expect(work.every((e) => e.streamId === NEW && e.orgId === 'org-v2-everylanguage')).toBe(true);
    expect(work.filter((e) => e.type === 'v1.RecordingAdded')).toHaveLength(2);
    // Event ids are the new language's own, so none is taken for the first copy's.
    expect(again.events.every((e) => e.id.startsWith(`v2:${NEW}:`) || e.id.startsWith('v2:org:'))).toBe(true);
    // Its owner is a member of the new language, in the organization it is in now.
    expect(again.events.find((e) => e.type === 'v1.MemberAdded' && (e.payload as { scope: { languageId?: string } }).scope.languageId === NEW)).toMatchObject({ orgId: 'org-v2-everylanguage' });
    // The audio was copied before, so it is not hashed again, only stored for the new language.
    const hashes = await Promise.all(Object.values(bucket).map((b) => sha256Hex(b)));
    for (const h of hashes) expect(f.r2.has(`org-v2-everylanguage/${NEW}/${h}`)).toBe(true);
    expect(again.reports[0]!.files).toMatchObject({ copied: 0, uploaded: 2 });
  });

  it('leaves the first copy alone: nothing more is said in the old organization or the old language', async () => {
    const f = fakes();
    await f.pass();
    const before = new Map(f.ledgers.get('birat'));
    f.move();
    const again = await f.pass();
    expect(again.events.some((e) => e.type === 'v1.RecordingAdded')).toBe(true);
    expect(again.events.some((e) => e.orgId === 'org-birat')).toBe(false);
    expect(again.events.some((e) => e.streamId === 'birat')).toBe(false);
    expect(f.ledgers.get('birat')).toEqual(before);
    // And a pass after that, with nothing new in v2, says nothing at all.
    const quiet = await f.pass();
    expect(quiet.reports).toEqual([]);
  });
});
