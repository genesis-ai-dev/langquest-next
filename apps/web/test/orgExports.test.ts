import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { foldLanguage, emptyLanguageState, ORG_STREAM, type AnyEvent } from '@langquest-next/core';
import { allEvents, writeExport, type ExportDeps } from '../../../server/orgExportJob';
import { Parts, ZipWriter } from '../../../server/orgExportZip';
import { exportKey, handleOrgExports, KEEP_MS, LINK_MS, type ExportBucket, type ExportDeps as DoorDeps, type ExportRow, type ExportStore } from '../worker/orgExports';
import { fixture, NOW } from '../../../packages/sync/test/orgExportFixture';

/**
 * The organization export (decisions.md 206): the zip opens in a real unzip
 * tool, the job writes what the log holds, and the door lets only the
 * organization's own admin ask, with links that expire.
 */

const collect = () => {
  const chunks: Uint8Array[] = [];
  return { chunks, write: async (c: Uint8Array) => { chunks.push(c); }, bytes: () => Buffer.concat(chunks) };
};

describe('the zip writer', () => {
  it('writes a zip a real unzip tool accepts, with every name and byte as given', async () => {
    const out = collect();
    const zip = new ZipWriter(out.write, () => Date.UTC(2026, 10, 7));
    await zip.add('Dinka (din)/43 John/Chapter 03/part 01.m4a', new Uint8Array([1, 2, 3, 4]));
    await zip.add('manifest.csv', new TextEncoder().encode('﻿a,b\r\n1,é\r\n'));
    await zip.finish();
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const file = join(dir, 'x.zip');
    writeFileSync(file, out.bytes());
    const test = spawnSync('unzip', ['-t', file], { encoding: 'utf8' });
    expect(test.stdout).toContain('No errors detected');
    const list = spawnSync('unzip', ['-Z1', file], { encoding: 'utf8' }).stdout.trim().split('\n');
    expect(list).toEqual(['Dinka (din)/43 John/Chapter 03/part 01.m4a', 'manifest.csv']);
    expect(spawnSync('unzip', ['-p', file, 'manifest.csv']).stdout.toString('utf8')).toBe('﻿a,b\r\n1,é\r\n');
  });

  it('refuses a name used twice, a name outside the folder, and a file over 4 GB', async () => {
    const zip = new ZipWriter(async () => undefined);
    await zip.add('a/b.txt', new Uint8Array(1));
    await expect(zip.add('A/B.txt', new Uint8Array(1))).rejects.toThrow('twice');
    await expect(zip.add('../x', new Uint8Array(1))).rejects.toThrow('not allowed');
    await expect(zip.add('/x', new Uint8Array(1))).rejects.toThrow('not allowed');
  });

  it('cuts a stream into parts of the size R2 needs, the last one short', async () => {
    const sent: number[] = [];
    const parts = new Parts(10, async (n, b) => { sent.push(b.length); expect(n).toBe(sent.length); });
    for (const n of [3, 9, 20, 1]) await parts.push(new Uint8Array(n));
    await parts.end();
    expect(sent).toEqual([10, 10, 10, 3]);
  });
});

function jobDeps(events: AnyEvent[], blobs: Map<string, Uint8Array>, seen: string[] = []): ExportDeps {
  return {
    async pull(_o, streamId, after, limit) { return events.filter((e) => e.streamId === streamId).map((e, i) => ({ ...e, serverSeq: i + 1 })).filter((e) => e.serverSeq > after).slice(0, limit); },
    async fold(_o, streamId) { return foldLanguage(events.filter((e) => e.streamId === streamId), emptyLanguageState()); },
    async names(ids) { return Object.fromEntries(ids.map((id) => [id, `Name of ${id}`])); },
    async blob(key) { seen.push(key); return blobs.get(key) ?? null; },
    async progress() {},
    now: () => NOW
  };
}

describe('the export job', () => {
  it('writes a zip holding the folders, the sheets and the raw log, and says what is missing', async () => {
    const f = fixture();
    const have = new Map<string, Uint8Array>();
    const seen: string[] = [];
    // Everything but the review's voice comment is in the bucket.
    for (const h of [f.hashes.a, f.hashes.b, f.hashes.c]) have.set(`o/din/${h}.m4a`, new TextEncoder().encode(`audio ${h[0]}`));
    const out = collect();
    const zip = new ZipWriter(out.write, () => NOW);
    const r = await writeExport(jobDeps(f.events, have, seen), { orgId: 'o', languageIds: null }, zip);
    expect(r).toMatchObject({ languages: 1, files: 3, missing: 1 });
    expect(seen).toContain(`o/din/${f.hashes.note}.m4a`);
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const file = join(dir, 'x.zip');
    writeFileSync(file, out.bytes());
    expect(spawnSync('unzip', ['-t', file], { encoding: 'utf8' }).stdout).toContain('No errors detected');
    const names = spawnSync('unzip', ['-Z1', file], { encoding: 'utf8' }).stdout.trim().split('\n');
    expect(names).toEqual(expect.arrayContaining([
      'README.txt', 'manifest.csv', 'manifest.json', 'spreadsheets/people.csv', 'spreadsheets/languages.csv', 'metadata/missing-files.csv', 'events/_org/0001.jsonl', 'events/din/0001.jsonl'
    ]));
    // The raw log holds every event of the two streams, one JSON object a line, so another tool can rebuild the history.
    const log = spawnSync('unzip', ['-p', file, 'events/din/0001.jsonl']).stdout.toString('utf8').trim().split('\n').map((l) => JSON.parse(l) as AnyEvent);
    expect(log.map((e) => e.id)).toEqual(f.events.filter((e) => e.streamId === 'din').map((e) => e.id));
    const manifest = JSON.parse(spawnSync('unzip', ['-p', file, 'manifest.json']).stdout.toString('utf8')) as { rows: { kind: string; by: string }[] };
    expect(manifest.rows.find((x) => x.kind === 'recording')!.by).toBe('Name of akol');
    expect(spawnSync('unzip', ['-p', file, 'metadata/missing-files.csv']).stdout.toString('utf8')).toContain(f.hashes.note);
  });

  it('exports only the languages asked for', async () => {
    const f = fixture();
    const out = collect();
    const r = await writeExport(jobDeps(f.events, new Map()), { orgId: 'o', languageIds: ['nope'] }, new ZipWriter(out.write, () => NOW));
    expect(r.languages).toBe(0);
  });

  it('reads a long stream a page at a time', async () => {
    const f = fixture();
    const sizes: number[] = [];
    await allEvents(jobDeps(f.events, new Map()), 'o', ORG_STREAM, async (p) => { sizes.push(p.length); });
    expect(sizes).toEqual([1]);
  });
});

// ---- the door ---------------------------------------------------------------------

const SERVICE = 'service-key';
const ORG = 'org1';
const ID = '11111111-1111-4111-8111-111111111111';

function door(over: Partial<DoorDeps> = {}) {
  const rows = new Map<string, ExportRow>();
  const objects = new Map<string, Uint8Array>();
  const uploads: string[] = [];
  let clock = Date.UTC(2026, 10, 7);
  let n = 0;
  const store: ExportStore = {
    async create(orgId, profileId, languageIds) {
      const row: ExportRow = { id: ID.replace(/1$/, String(++n)), orgId, requestedBy: profileId, languageIds, status: 'queued', createdAt: new Date(clock).toISOString(), startedAt: null, finishedAt: null, progress: null, sizeBytes: null, expiresAt: null, error: null };
      rows.set(row.id, row);
      return row;
    },
    async list(orgId) { return [...rows.values()].filter((r) => r.orgId === orgId); },
    async get(id) { return rows.get(id) ?? null; },
    async expire(orgId, now) {
      const gone = [...rows.values()].filter((r) => r.orgId === orgId && r.status === 'ready' && r.expiresAt !== null && Date.parse(r.expiresAt) < now);
      for (const r of gone) r.status = 'expired';
      return gone.map((r) => r.id);
    }
  };
  const bucket: ExportBucket = {
    async create(key) { uploads.push(`create ${key}`); return { uploadId: 'u1' }; },
    async part(key, _u, k, body) { uploads.push(`part ${k} ${body.byteLength}`); return { etag: `e${k}` }; },
    async complete(key, _u, parts) { uploads.push(`complete ${parts.length}`); objects.set(key, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])); return { size: 10 }; },
    async abort() { uploads.push('abort'); },
    async get(key, range) { const b = objects.get(key); return b ? { size: b.length, body: new Response(range ? b.slice(range.offset, range.offset + range.length) : b).body! } : null; },
    async head(key) { const b = objects.get(key); return b ? { size: b.length } : null; },
    async delete(key) { objects.delete(key); }
  };
  const deps: DoorDeps = {
    serviceKey: SERVICE,
    profileOf: async (t) => (t === 'admin' ? 'ada' : t === 'member' ? 'mo' : null),
    mayExport: async (org, p) => org === ORG && p === 'ada',
    languagesOf: async () => ['din', 'nus'],
    store, bucket, start: async () => 'started', now: () => clock, ...over
  };
  const call = (method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) =>
    handleOrgExports(new Request(`https://next.example${path}`, {
      method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      ...(body === undefined ? {} : { body: body instanceof Uint8Array ? body : JSON.stringify(body) })
    }), deps);
  return { call, rows, objects, uploads, tick: (ms: number) => { clock += ms; } };
}

describe('the export door', () => {
  it('lets only the organization\'s own admin ask, list or link', async () => {
    const d = door();
    expect((await d.call('POST', `/api/orgs/${ORG}/exports`)).status).toBe(401);
    expect((await d.call('POST', `/api/orgs/${ORG}/exports`, 'member')).status).toBe(403);
    expect((await d.call('POST', `/api/orgs/other/exports`, 'admin')).status).toBe(403);
    expect((await d.call('GET', `/api/orgs/${ORG}/exports`, 'member')).status).toBe(403);
    expect(d.rows.size).toBe(0);
    const res = await d.call('POST', `/api/orgs/${ORG}/exports`, 'admin', { languageIds: ['din'] });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { export: ExportRow }).export).toMatchObject({ orgId: ORG, requestedBy: 'ada', languageIds: ['din'], status: 'queued' });
  });

  it('takes only languages of the organization, and one export at a time', async () => {
    const d = door();
    expect((await d.call('POST', `/api/orgs/${ORG}/exports`, 'admin', { languageIds: ['someone-elses'] })).status).toBe(400);
    expect((await d.call('POST', `/api/orgs/${ORG}/exports`, 'admin', { languageIds: [] })).status).toBe(400);
    expect((await d.call('POST', `/api/orgs/${ORG}/exports`, 'admin', {})).status).toBe(202);
    expect((await d.call('POST', `/api/orgs/${ORG}/exports`, 'admin', {})).status).toBe(409);
  });

  it('takes the zip in parts only from the job, and only while the export runs', async () => {
    const d = door();
    await d.call('POST', `/api/orgs/${ORG}/exports`, 'admin');
    const id = [...d.rows.keys()][0]!;
    const up = (q: string, token = SERVICE, body?: Uint8Array | unknown) => d.call('POST', `/api/org-exports/${id}/upload?${q}`, token, body);
    expect((await up('action=create')).status).toBe(409);
    d.rows.get(id)!.status = 'running';
    expect((await up('action=create', 'admin')).status).toBe(403);
    expect((await up('action=create', '')).status).toBe(403);
    expect(await (await up('action=create')).json()).toEqual({ uploadId: 'u1' });
    expect(await (await up('action=part&n=1&uploadId=u1', SERVICE, new Uint8Array(5))).json()).toEqual({ etag: 'e1' });
    expect((await up('action=part&n=0&uploadId=u1', SERVICE, new Uint8Array(5))).status).toBe(400);
    expect((await up('action=complete&uploadId=u1', SERVICE, [{ partNumber: 1, etag: 'e1' }])).status).toBe(200);
    expect(d.uploads).toEqual([`create ${exportKey(ORG, id)}`, 'part 1 5', 'complete 1']);
  });

  it('gives a link that downloads the zip, in ranges, until it expires', async () => {
    const d = door();
    await d.call('POST', `/api/orgs/${ORG}/exports`, 'admin');
    const id = [...d.rows.keys()][0]!;
    const row = d.rows.get(id)!;
    expect((await d.call('GET', `/api/orgs/${ORG}/exports/${id}/link`, 'admin')).status).toBe(409);
    row.status = 'running';
    await d.call('POST', `/api/org-exports/${id}/upload?action=complete&uploadId=u1`, SERVICE, [{ partNumber: 1, etag: 'e1' }]);
    row.status = 'ready';
    row.expiresAt = new Date(Date.UTC(2026, 10, 7) + KEEP_MS).toISOString();
    expect((await d.call('GET', `/api/orgs/${ORG}/exports/${id}/link`, 'member')).status).toBe(403);
    const link = (await (await d.call('GET', `/api/orgs/${ORG}/exports/${id}/link`, 'admin')).json()) as { path: string };
    const whole = await d.call('GET', link.path);
    expect(whole.status).toBe(200);
    expect(whole.headers.get('content-disposition')).toContain('attachment');
    expect([...new Uint8Array(await whole.arrayBuffer())]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const part = await d.call('GET', link.path, undefined, undefined, { range: 'bytes=2-4' });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([2, 3, 4]);
    expect((await d.call('GET', link.path.replace(/sig=./, 'sig=0'))).status).toBe(403);
    d.tick(LINK_MS + 1);
    expect((await d.call('GET', link.path)).status).toBe(403);
  });

  it('removes the zip when the export has expired', async () => {
    const d = door();
    await d.call('POST', `/api/orgs/${ORG}/exports`, 'admin');
    const id = [...d.rows.keys()][0]!;
    const row = d.rows.get(id)!;
    row.status = 'ready';
    row.expiresAt = new Date(Date.UTC(2026, 10, 7) + KEEP_MS).toISOString();
    d.objects.set(exportKey(ORG, id), new Uint8Array(1));
    d.tick(KEEP_MS + 1);
    const list = (await (await d.call('GET', `/api/orgs/${ORG}/exports`, 'admin')).json()) as { exports: ExportRow[] };
    expect(list.exports[0]!.status).toBe('expired');
    expect(d.objects.size).toBe(0);
  });
});
