import type { AnyEvent } from '@langquest-next/core';
import { sha256Hex } from '../src/audio';
import type { CopiedFile } from '../src/map';
import { sync, type PassDeps } from '../src/pass';
import type { V2ProjectRows } from '../src/rows';

/**
 * v2 files phones may not play come over converted to M4A (decisions.md 94,
 * amended 2026-10-24): on 2026-10-23 Every Language found Central Thai SPV
 * and Pwo Eastern Karen in Next with no audio, because their chapters were
 * MP3 and the import, which read only WAV and M4A, had written each one
 * down as "not in v2's storage". Driven by fakes: one project with an MP3
 * chapter and a WAV one, the converter a stand-in that makes a small M4A.
 */

const at = '2026-02-26T06:58:19Z';
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** An MP3's first bytes (an ID3 tag), `tag` making them its own. */
const mp3 = (tag: number) => new Uint8Array([...ascii('ID3'), 4, 0, 0, 0, 0, 1, tag]);

/** A WAV of `ms` of silence, 8 kHz mono 16-bit. */
function wav(ms: number): Uint8Array {
  const data = Math.round((8000 * 2 * ms) / 1000);
  const b = new Uint8Array(44 + data);
  const v = new DataView(b.buffer);
  b.set(ascii('RIFF'), 0); v.setUint32(4, 36 + data, true); b.set(ascii('WAVE'), 8);
  b.set(ascii('fmt '), 12); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  b.set(ascii('data'), 36); v.setUint32(40, data, true);
  return b;
}

/** The smallest M4A the import reads: a file type box and a movie header saying `ms` long. */
function m4a(ms: number): Uint8Array {
  const b = new Uint8Array(20 + 28);
  const v = new DataView(b.buffer);
  v.setUint32(0, 20); b.set(ascii('ftypM4A '), 4); b.set(ascii('M4A '), 16);
  v.setUint32(20, 28); b.set(ascii('mvhd'), 24); v.setUint32(40, 1000); v.setUint32(44, ms);
  return b;
}

/** A stand-in for ffmpeg: an MP3 becomes an M4A as long as its tag says in seconds; anything else is not audio. */
const convert = async (bytes: Uint8Array) => (bytes[0] === 0x49 ? m4a(bytes[bytes.length - 1]! * 1000) : null);

function rows(audio: string[]): V2ProjectRows {
  return {
    project: { id: 'p1', name: 'Central Thai SPV', description: null, created_at: at, last_updated: at, active: true, private: false, creator_id: 'owner', template: 'unstructured' },
    languages: [{ languoid_id: 'thai', language_type: 'target', active: true }],
    members: [{ profile_id: 'owner', membership: 'owner', active: true, created_at: at, last_updated: at }],
    quests: [{ id: 'q1', name: 'Mark', parent_id: null, metadata: null, active: true, visible: true, duplicate_of: null, creator_id: 'owner', created_at: at, last_updated: at }],
    placements: audio.map((_, i) => ({ quest_id: 'q1', asset_id: `a${i + 1}`, active: true, visible: true, order_index: i, metadata: null, created_at: at })),
    assets: audio.map((_, i) => ({ id: `a${i + 1}`, name: `Chapter ${i + 1}`, content_type: 'source', source_asset_id: null, creator_id: 'owner', active: true, visible: true, order_index: i, metadata: null, created_at: at, last_updated: at })),
    contents: audio.map((name, i) => ({ id: `c${i + 1}`, asset_id: `a${i + 1}`, text: `Mark Central Thai SPV Chapter ${i + 1}`, audio: [name], languoid_id: 'thai', source_language_id: null, active: true, order_index: 1, created_at: at })),
    votes: []
  };
}

function fakes(opts: { audio: string[]; bucket: Record<string, Uint8Array>; known?: Record<string, CopiedFile> }) {
  const events: AnyEvent[] = [];
  const uploads: { hash: string; format: string; bytes: Uint8Array }[] = [];
  const fileMap: { name: string; file: CopiedFile | null }[] = [];
  const log: { level: string; message: string }[] = [];
  const target = {
    plan: async () => ({
      orgs: [{ org_id: 'o1', name: 'Every Language', existing: false, admins: ['owner'] }],
      placements: [{ project_id: 'p1', org_id: 'o1', languoid_id: null, code: 'tha', confirmed_by: 'caleb', confirmed_at: at }],
      roles: [], links: [], passes: []
    }),
    passStart: async () => 1,
    passProgress: async () => {},
    passFinish: async () => {},
    log: async (lines: { level: string; message: string }[]) => { log.push(...lines); },
    orgCreator: async () => null,
    ledger: async () => new Map(),
    putLedger: async () => {},
    append: async (list: AnyEvent[]) => { events.push(...list); return { accepted: list.length, duplicates: 0, rejected: [] }; },
    files: async (names: string[]) => new Map(names.flatMap((n) => (opts.known?.[n] ? [[n, opts.known[n]!] as const] : []))),
    putFiles: async (list: { name: string; file: CopiedFile | null }[]) => { fileMap.push(...list); },
    stored: async () => new Set(uploads.map((u) => u.hash)),
    upload: async (_org: string, _lang: string, hash: string, format: string, bytes: Uint8Array) => { uploads.push({ hash, format, bytes }); },
    addNames: async () => {}
  };
  const v2 = {
    projectRows: async () => rows(opts.audio),
    people: async () => [],
    download: async (name: string) => opts.bucket[name] ?? null
  };
  const deps = { target, v2, wait: async () => {} } as unknown as PassDeps;
  const run = async (over: Partial<PassDeps> = {}) => {
    const [report] = await sync({ ...deps, ...over }, { projects: ['p1'], summaries: [{ id: 'p1', name: 'Central Thai SPV', template: 'unstructured' } as never] });
    const cards = events.filter((e) => e.type === 'v1.RecordingAdded').flatMap((e) => (e.payload as { cards: { hash: string; durationMs: number; format?: string }[] }).cards);
    return { report: report!, cards, uploads, fileMap, log: log.map((l) => `${l.level}: ${l.message}`) };
  };
  return { run };
}

describe('a v2 file phones may not play', () => {
  it('comes over converted to M4A, as a recording like any other', async () => {
    const { run } = fakes({ audio: ['ch1.mp3', 'ch2.wav'], bucket: { 'ch1.mp3': mp3(42), 'ch2.wav': wav(500) } });
    const { report, cards, uploads, fileMap, log } = await run({ convert });
    const hash = await sha256Hex(m4a(42_000));
    expect(report.skipped).toBeUndefined();
    expect(report.files).toMatchObject({ copied: 2, converted: 1, missing: 0, unreadable: 0, later: 0, uploaded: 2 });
    // Stored as the M4A, under the M4A's hash, with the M4A's length.
    expect(uploads.find((u) => u.hash === hash)).toMatchObject({ format: 'm4a', bytes: m4a(42_000) });
    expect(fileMap.find((f) => f.name === 'ch1.mp3')?.file).toEqual({ hash, size: m4a(42_000).length, durationMs: 42_000, format: 'm4a' });
    expect(cards).toContainEqual({ hash, durationMs: 42_000 });
    expect(cards).toHaveLength(2);
    expect(log).toContain('info: Of those, 1 were MP3 or another kind phones may not play, and were converted to M4A');
    expect(log.some((l) => l.includes("not in v2's storage"))).toBe(false);
  });

  it('where nothing converts, is left for a run that can, and never written down as missing', async () => {
    const { run } = fakes({ audio: ['ch1.mp3', 'ch2.wav'], bucket: { 'ch1.mp3': mp3(42), 'ch2.wav': wav(500) } });
    const { report, cards, fileMap, log } = await run();
    expect(report.files).toMatchObject({ copied: 1, converted: 0, missing: 0, later: 1 });
    // Not in the file map at all, so the next pass that reads the project asks for it again.
    expect(fileMap.map((f) => f.name)).toEqual(['ch2.wav']);
    expect(cards).toHaveLength(1);
    expect(log.some((l) => l.startsWith('warn: 1 audio files are MP3 or another kind that needs converting'))).toBe(true);
  });

  it('that is not audio at all is written down as missing, and said to be unreadable rather than absent', async () => {
    const { run } = fakes({ audio: ['page.mp3', 'gone.wav'], bucket: { 'page.mp3': new Uint8Array(ascii('<html>')) } });
    const { report, fileMap, log } = await run({ convert });
    expect(report.files).toMatchObject({ copied: 0, unreadable: 1, missing: 1 });
    expect(fileMap).toEqual(expect.arrayContaining([{ name: 'page.mp3', file: null }, { name: 'gone.wav', file: null }]));
    expect(log).toContain("warn: 1 files are in v2's storage but could not be read as audio");
    expect(log).toContain("warn: 1 audio files are not in v2's storage");
  });

  it('copied for one language is converted again for another, and stored only if it comes out the same', async () => {
    const hash = await sha256Hex(m4a(42_000));
    const known = { 'ch1.mp3': { hash, size: m4a(42_000).length, durationMs: 42_000, format: 'm4a' as const } };
    const same = fakes({ audio: ['ch1.mp3'], bucket: { 'ch1.mp3': mp3(42) }, known });
    const ok = await same.run({ convert });
    expect(ok.uploads).toEqual([{ hash, format: 'm4a', bytes: m4a(42_000) }]);
    expect(ok.report.files).toMatchObject({ uploaded: 1, mismatched: 0 });

    // A converter that changed (a new ffmpeg) would make bytes R2 refuses under the first hash: not stored, and the project goes on.
    const changed = fakes({ audio: ['ch1.mp3'], bucket: { 'ch1.mp3': mp3(42) }, known });
    const off = await changed.run({ convert: async () => m4a(41_000) });
    expect(off.report.skipped).toBeUndefined();
    expect(off.uploads).toEqual([]);
    expect(off.report.files).toMatchObject({ uploaded: 0, mismatched: 1 });
    expect(off.log).toContain('error: 1 converted files came out different from their first conversion, so they were not stored for this language');
  });
});
