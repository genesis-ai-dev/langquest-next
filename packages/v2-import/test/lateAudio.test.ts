import type { AnyEvent } from '@langquest-next/core';
import type { CopiedFile } from '../src/map';
import type { LedgerEntry } from '../src/reconcile';
import { sync, type PassDeps } from '../src/pass';
import type { V2ProjectRows } from '../src/rows';

/**
 * A v2 phone that was offline for weeks (decisions.md 94, amended
 * 2026-10-29). A partner asked whether work made that long offline still
 * comes over. It did not wait for its audio: the week a version waits was
 * counted from when the phone recorded it, so it was over before the rows
 * reached v2, and a file the import missed was never asked for again after a
 * week, though v2 said later that it had it. Driven by fakes: v2's rows and
 * storage, and the import's ledger and file map.
 */

const DAY = 86_400_000;
const recorded = '2026-10-01T09:00:00Z';
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

function wav(tag: number): Uint8Array {
  const data = 8000;
  const b = new Uint8Array(44 + data);
  const v = new DataView(b.buffer);
  b.set(ascii('RIFF'), 0); v.setUint32(4, 36 + data, true); b.set(ascii('WAVE'), 8);
  b.set(ascii('fmt '), 12); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  b.set(ascii('data'), 36); v.setUint32(40, data, true);
  b[44] = tag;
  return b;
}

function fakes() {
  let now = Date.parse('2026-10-24T05:00:00Z');
  const iso = (ms: number) => new Date(ms).toISOString();
  // Three weeks after recording, the phone's rows reach v2; one of its two files is still to go up.
  const rows: V2ProjectRows = {
    project: { id: 'kwa', name: 'Kwa', description: null, created_at: recorded, last_updated: recorded, active: true, private: false, creator_id: 'owner', template: 'unstructured' },
    languages: [{ languoid_id: 'kwa', language_type: 'target', active: true }],
    members: [{ profile_id: 'owner', membership: 'owner', active: true, created_at: recorded, last_updated: recorded }],
    quests: [{ id: 'q1', name: 'Mark 1', parent_id: null, metadata: null, active: true, visible: true, duplicate_of: null, creator_id: 'owner', created_at: recorded, last_updated: recorded }],
    placements: [1, 2].map((i) => ({ quest_id: 'q1', asset_id: `a${i}`, active: true, visible: true, order_index: i, metadata: null, created_at: recorded })),
    assets: [1, 2].map((i) => ({ id: `a${i}`, name: `Part ${i}`, content_type: 'source', source_asset_id: null, creator_id: 'owner', active: true, visible: true, order_index: i, metadata: null, created_at: recorded, last_updated: recorded })),
    contents: [1, 2].map((i) => ({
      id: `c${i}`, asset_id: `a${i}`, text: null, audio: [`a${i}.wav`], languoid_id: 'kwa', source_language_id: null, active: true, order_index: 1,
      created_at: recorded, uploaded_at: iso(now - 10 * 60_000), audio_uploaded_at: i === 1 ? iso(now - 10 * 60_000) : null
    })),
    votes: []
  };
  const bucket: Record<string, Uint8Array> = { 'a1.wav': wav(1) };
  const ledgers = new Map<string, Map<string, LedgerEntry>>();
  const fileMap = new Map<string, CopiedFile | { missingSince: string }>();
  const passes: { project_id: string; finished_at: string; report: unknown }[] = [];
  let events: AnyEvent[] = [];
  const target = {
    plan: async () => ({
      orgs: [{ org_id: 'org-kwa', name: 'Kwa', existing: false, admins: ['owner'] }],
      placements: [{ project_id: 'kwa', org_id: 'org-kwa', languoid_id: null, code: 'kwa', confirmed_by: 'caleb', confirmed_at: recorded, language_id: null, moved_at: null }],
      roles: [], links: [], passes: [...passes]
    }),
    cursor: async (_name: string, value?: Date) => (value ? null : new Date(now - 15 * 60_000)),
    passStart: async () => 1,
    passProgress: async () => {},
    passFinish: async (_id: number, report: { projectId: string }) => { passes.push({ project_id: report.projectId, finished_at: iso(now), report }); },
    log: async () => {},
    orgCreator: async () => null,
    ledger: async (scope: string) => new Map(ledgers.get(scope) ?? []),
    putLedger: async (scope: string, entries: LedgerEntry[]) => {
      const l = ledgers.get(scope) ?? new Map<string, LedgerEntry>();
      for (const e of entries) l.set(e.key, e);
      ledgers.set(scope, l);
    },
    putStamps: async () => {},
    append: async (list: AnyEvent[]) => { events.push(...list); return { accepted: list.length, duplicates: 0, rejected: [] }; },
    files: async (names: string[]) => new Map(names.flatMap((n) => (fileMap.has(n) ? [[n, fileMap.get(n)!] as const] : []))),
    putFiles: async (list: { name: string; file: CopiedFile | null }[]) => {
      for (const f of list) fileMap.set(f.name, f.file ?? (fileMap.get(f.name) as { missingSince: string } | undefined) ?? { missingSince: iso(now) });
    },
    stored: async () => new Set<string>(),
    upload: async () => {},
    addNames: async () => {}
  };
  const v2 = {
    projectRows: async () => structuredClone(rows),
    // v2 says the project changed: its rows arrived, or its audio did.
    changedSince: async () => new Set(['kwa']),
    projects: async () => [{ id: 'kwa', name: 'Kwa', template: 'unstructured' }],
    people: async () => [],
    download: async (name: string) => bucket[name] ?? null
  };
  const deps = { target, v2, wait: async () => {}, now: () => now } as unknown as PassDeps;
  return {
    /** A 15-minute pass, `wait` after the last; what it appended and reported. */
    pass: async (wait = 15 * 60_000) => {
      now += wait;
      events = [];
      const [report] = await sync(deps);
      return { report: report!, events };
    },
    /** The phone sends the file it still had, `ago` before the next pass. */
    lands: (name: string, ago: number) => {
      bucket[name] = wav(2);
      rows.contents.find((c) => c.audio?.includes(name))!.audio_uploaded_at = iso(now + 15 * 60_000 - ago);
    }
  };
}

const takes = (events: AnyEvent[]) => events.filter((e) => e.type === 'v1.TakeComposed').map((e) => (e.payload as { cardHashes: string[] }).cardHashes.length);

describe('a v2 phone that was offline for weeks', () => {
  it('waits for its audio from when v2 got its work, not from when it was recorded', async () => {
    const f = fakes();
    const first = await f.pass();
    expect(first.report.map?.waiting).toBe(1);
    expect(takes(first.events)).toEqual([]);
    f.lands('a2.wav', 5 * 60_000);
    const second = await f.pass();
    expect(takes(second.events)).toEqual([2]);
  });

  it('brings audio that reaches v2 more than a week after the import missed it', async () => {
    const f = fakes();
    await f.pass();
    // The phone went offline again before the file went up, for ten days: the week is over.
    const quiet = await f.pass(10 * DAY);
    expect(quiet.report.files).toMatchObject({ copied: 0 });
    expect(takes(quiet.events)).toEqual([1]);
    f.lands('a2.wav', 5 * 60_000);
    const back = await f.pass();
    expect(back.report.files).toMatchObject({ copied: 1 });
    expect(takes(back.events)).toEqual([2]);
  });
});
