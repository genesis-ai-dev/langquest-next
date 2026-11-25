import { readFileSync } from 'node:fs';
import { CARRIED_APK_BUILT_MS, CARRIED_APK_VERSION_CODE, CARRIED_BUILT_HEADER, CARRIED_FILE_TYPE, carriedApkName, carriedApkNameHere, carriedFileName } from '@langquest-next/core';
import { APK_CONTENT_TYPE, apkNameOf, newestFitting, serveApk, type ApkBucket } from '../worker/apk';
import { ownsResponse } from '../worker/securityHeaders';
import { routeClass } from '../worker/requestTally';

/**
 * `GET /apk/<name>` (worker/apk.ts, docs/nearby-sync-plan.md 14.4): a carried build's APK from the
 * APK bucket, under a name that holds only versions, and nothing else from that bucket or anywhere.
 */

const NAME = carriedApkName({ reducer: 21, lines: 1, protocol: { min: 1, max: 1 }, fingerprint: '0a1b2c3d4e5f' })!;

/**
 * An R2 bucket of named byte arrays, answering get (with ranges), head and list (by prefix, with
 * custom metadata) as the binding does. `put` gives a file's version code, when its JavaScript was
 * built and when it was put there.
 */
function fakeBucket(files: Record<string, Uint8Array>, put: Record<string, { code?: string; built?: string; at?: number }> = {}) {
  const asked: string[] = [];
  const meta = (key: string, bytes: Uint8Array) => ({
    key, size: bytes.length, httpEtag: `"${key.length}-${bytes.length}"`, uploaded: new Date(put[key]?.at ?? 0),
    customMetadata: {
      ...(put[key]?.code === undefined ? {} : { [CARRIED_APK_VERSION_CODE]: put[key].code }),
      ...(put[key]?.built === undefined ? {} : { [CARRIED_APK_BUILT_MS]: put[key].built })
    }
  });
  const bucket = {
    async list(options: { prefix?: string; include?: string[] }) {
      asked.push(`list ${options.prefix}`);
      expect(options.include).toEqual(['customMetadata']);
      const keys = Object.keys(files).filter((k) => k.startsWith(options.prefix ?? '')).sort();
      return { objects: keys.map((k) => meta(k, files[k]!)), truncated: false, delimitedPrefixes: [] };
    },
    async head(key: string) {
      asked.push(`head ${key}`);
      const bytes = files[key];
      return bytes ? meta(key, bytes) : null;
    },
    async get(key: string, options?: { range?: Headers }) {
      asked.push(`get ${key}`);
      const bytes = files[key];
      if (!bytes) return null;
      const m = /^bytes=(\d+)-(\d*)$/.exec(options?.range?.get('range') ?? '');
      if (m) {
        const offset = Number(m[1]);
        const end = m[2] ? Number(m[2]) : bytes.length - 1;
        return { ...meta(key, bytes), range: { offset, length: end - offset + 1 }, body: new Blob([bytes.slice(offset, end + 1)]).stream() };
      }
      return { ...meta(key, bytes), body: new Blob([bytes]).stream() };
    }
  };
  return { bucket: bucket as unknown as ApkBucket, asked };
}

const apk = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]);
const ask = (path: string, init: RequestInit = {}) => new Request(`https://next.langquest.org${path}`, init);

describe('the APK route', () => {
  it('serves a carried build by its name, as an APK to download under that same neutral name', async () => {
    const { bucket } = fakeBucket({ [NAME]: apk });
    const res = await serveApk(ask(`/apk/${NAME}`), bucket);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.android.package-archive');
    expect(APK_CONTENT_TYPE).toBe('application/vnd.android.package-archive');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${NAME}"`);
    expect(res.headers.get('content-length')).toBe(String(apk.length));
    // No copy kept in the browser's cache, a trace on a phone that may wear a disguise.
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(apk);
    // The name holds versions only: nothing in it names the app or an organization.
    expect(NAME).toMatch(/^r\d+-l\d+-p\d+-[0-9a-f]{8}\.apk$/);
    expect(NAME.toLowerCase()).not.toMatch(/lang|quest|frontier|next/);
  });

  it('answers HEAD with the size and no body, and a range with 206, so a cut-off download goes on', async () => {
    const { bucket } = fakeBucket({ [NAME]: apk });
    const head = await serveApk(ask(`/apk/${NAME}`, { method: 'HEAD' }), bucket);
    expect([head.status, head.headers.get('content-length'), head.body]).toEqual([200, String(apk.length), null]);
    const part = await serveApk(ask(`/apk/${NAME}`, { headers: { range: 'bytes=4-' } }), bucket);
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe(`bytes 4-9/${apk.length}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(apk.slice(4));
  });

  it('says when the file\'s JavaScript was built, on HEAD and GET, so a carrier\'s phone can tell it from the copy it keeps', async () => {
    const { bucket } = fakeBucket({ [NAME]: apk }, { [NAME]: { code: '74', built: '1795600000000' } });
    for (const method of ['HEAD', 'GET']) {
      const res = await serveApk(ask(`/apk/${NAME}`, { method }), bucket);
      expect(res.status).toBe(200);
      expect(res.headers.get(CARRIED_BUILT_HEADER)).toBe('1795600000000');
    }
    const asTaken = await serveApk(ask(`/apk/${carriedFileName(NAME)}`, { method: 'HEAD' }), bucket);
    expect(asTaken.headers.get(CARRIED_BUILT_HEADER)).toBe('1795600000000');
    // A file published before the time was recorded, or with one that is not a time, says nothing.
    for (const built of [undefined, '', 'soon', '-5', '0', '1.5']) {
      const { bucket: other } = fakeBucket({ [NAME]: apk }, { [NAME]: { code: '72', ...(built === undefined ? {} : { built }) } });
      expect((await serveApk(ask(`/apk/${NAME}`, { method: 'HEAD' }), other)).headers.has(CARRIED_BUILT_HEADER)).toBe(false);
    }
  });

  it('is 404 for a name the bucket lacks, anything that is not a carried build\'s name, and other methods, and never lists', async () => {
    const { bucket, asked } = fakeBucket({ [NAME]: apk, 'current.json': new Uint8Array([123, 125]), 'other.apk': apk });
    const other = carriedApkName({ reducer: 22, lines: 1, protocol: { min: 1, max: 1 }, fingerprint: '0a1b2c3d4e5f' })!;
    expect((await serveApk(ask(`/apk/${other}`), bucket)).status).toBe(404);
    for (const path of ['/apk/', '/apk', '/apk/current.json', '/apk/other.apk', `/apk/${NAME}/x`, `/apk/x/${NAME}`, `/apk/${NAME.toUpperCase()}`,
      '/apk/..%2Fcurrent.json', '/apk/?list-type=2', `/apk//${NAME}`]) {
      expect((await serveApk(ask(path), bucket)).status, path).toBe(404);
    }
    for (const method of ['PUT', 'POST', 'DELETE']) expect((await serveApk(ask(`/apk/${NAME}`, { method }), bucket)).status, method).toBe(404);
    // Only the carried build's names were ever asked of the bucket, and listed only by that name's versions.
    expect(asked).toEqual([`get ${other}`, 'list r22-l1-p1-']);
  });

  it('sends a name the bucket lacks to the newest file for the same versions, by version code, so a phone whose build has no file still gets one', async () => {
    const fp = (f: string) => carriedApkName({ reducer: 21, lines: 1, protocol: { min: 1, max: 1 }, fingerprint: f })!;
    const [mine, older, newest, unmarked] = [fp('52e6dfee'), fp('3f882a53'), fp('401de22e'), fp('aaaaaaaa')];
    const otherVersions = carriedApkName({ reducer: 22, lines: 1, protocol: { min: 1, max: 1 }, fingerprint: 'bbbbbbbb' })!;
    const otherProtocol = carriedApkName({ reducer: 21, lines: 1, protocol: { min: 1, max: 2 }, fingerprint: 'cccccccc' })!;
    // Put there in another order than their version codes: a build published again later is not the newest.
    const { bucket } = fakeBucket(
      { [older]: apk, [newest]: apk, [unmarked]: apk, [otherVersions]: apk, [otherProtocol]: apk, 'current.json': new Uint8Array([123, 125]) },
      { [older]: { code: '54', at: 3 }, [newest]: { code: '56', at: 2 }, [unmarked]: { at: 9 }, [otherVersions]: { code: '99', at: 9 }, [otherProtocol]: { code: '98', at: 9 } }
    );
    for (const method of ['GET', 'HEAD']) {
      const res = await serveApk(ask(`/apk/${mine}`, { method }), bucket);
      expect([res.status, res.headers.get('location'), res.headers.get('cache-control')], method).toEqual([302, `/apk/${newest}`, 'private, no-store']);
    }
    // The file it is sent to is served under its own name, so Downloads holds what it is.
    const there = await serveApk(ask(`/apk/${newest}`), bucket);
    expect([there.status, there.headers.get('content-disposition')]).toEqual([200, `attachment; filename="${newest}"`]);
    // With no version codes, the one put there last; with no file for those versions at all, 404.
    expect(await newestFitting(fakeBucket({ [older]: apk, [unmarked]: apk }, { [unmarked]: { at: 9 } }).bucket, mine)).toBe(unmarked);
    const none = fakeBucket({ [otherVersions]: apk, [otherProtocol]: apk });
    expect((await serveApk(ask(`/apk/${mine}`), none.bucket)).status).toBe(404);
    expect(none.asked).toEqual([`get ${mine}`, 'list r21-l1-p1-']);
  });

  it('serves the same file for the app to take, under the same versions ending .carried and the app\'s own type, so the carrier\'s browser hands it to the app', async () => {
    const { bucket, asked } = fakeBucket({ [NAME]: apk });
    const file = carriedFileName(NAME)!;
    const res = await serveApk(ask(`/apk/${file}`), bucket);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(CARRIED_FILE_TYPE);
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="${file}"`);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(apk);
    const part = await serveApk(ask(`/apk/${file}`, { headers: { range: 'bytes=4-' } }), bucket);
    expect([part.status, part.headers.get('content-type'), part.headers.get('content-range')]).toEqual([206, CARRIED_FILE_TYPE, `bytes 4-9/${apk.length}`]);
    const head = await serveApk(ask(`/apk/${file}`, { method: 'HEAD' }), bucket);
    expect([head.status, head.headers.get('content-type'), head.headers.get('content-length')]).toEqual([200, CARRIED_FILE_TYPE, String(apk.length)]);
    // The bucket holds one file per build, asked for by the install file's name.
    expect(asked).toEqual([`get ${NAME}`, `get ${NAME}`, `head ${NAME}`]);
    for (const path of [`/apk/${file}.apk`, `/apk/${NAME}.carried`, `/apk/${file.toUpperCase()}`, '/apk/current.carried', `/apk/${file.replace('.carried', ' (1).carried')}`]) {
      expect((await serveApk(ask(path), bucket)).status, path).toBe(404);
    }
  });

  it('sends a .carried name the bucket lacks to the newest file for the same versions, as .carried', async () => {
    const fp = (f: string) => carriedApkName({ reducer: 21, lines: 1, protocol: { min: 1, max: 1 }, fingerprint: f })!;
    const [mine, newest] = [fp('52e6dfee'), fp('401de22e')];
    const { bucket } = fakeBucket({ [newest]: apk }, { [newest]: { code: '56', at: 2 } });
    for (const method of ['GET', 'HEAD']) {
      const res = await serveApk(ask(`/apk/${carriedFileName(mine)}`, { method }), bucket);
      expect([res.status, res.headers.get('location')], method).toEqual([302, `/apk/${carriedFileName(newest)}`]);
    }
    // The install file's own name still goes to the install file.
    expect((await serveApk(ask(`/apk/${mine}`), bucket)).headers.get('location')).toBe(`/apk/${newest}`);
  });

  it('says it is not set up where the Worker has no APK bucket', async () => {
    expect((await serveApk(ask(`/apk/${NAME}`), undefined)).status).toBe(503);
    expect((await serveApk(ask('/apk/nothing'), undefined)).status).toBe(404);
  });

  it('reads names with the same function that names the file for the script and Let someone in', () => {
    const here = carriedApkNameHere('0a1b2c3d4e5f')!;
    expect(apkNameOf(`/apk/${here}`)).toEqual({ key: here, served: here, type: APK_CONTENT_TYPE });
    expect(apkNameOf(`/apk/${carriedFileName(here)}`)).toEqual({ key: here, served: carriedFileName(here), type: CARRIED_FILE_TYPE });
    expect(apkNameOf('/api/apk/x')).toBeNull();
  });

  it('runs before the built page, carries the Worker\'s security headers and is counted, and the bucket is bound in both environments', () => {
    expect(ownsResponse(new URL(`https://x/apk/${NAME}`), { method: 'GET' })).toBe(true);
    expect(routeClass('GET', `/apk/${NAME}`)).toBe('other');
    const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    const config = JSON.parse(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1'));
    expect(config.assets.run_worker_first).toContain('/apk/*');
    const apks = (buckets: { binding: string; bucket_name: string }[]) => buckets.find((b) => b.binding === 'APKS')?.bucket_name;
    expect(apks(config.r2_buckets)).toBe('langquest-next-apks');
    expect(apks(config.env.preview.r2_buckets)).toBe('langquest-next-apks-preview');
    // Apart from teams' recordings: never the recordings bucket.
    expect(apks(config.r2_buckets)).not.toBe(config.r2_buckets.find((b: { binding: string }) => b.binding === 'BLOBS').bucket_name);
    const index = readFileSync(new URL('../worker/index.ts', import.meta.url), 'utf8');
    expect(index).toMatch(/if \(url\.pathname\.startsWith\('\/apk\/'\)\) \{\n\s*const \{ serveApk \} = await import\('\.\/apk'\);\n\s*return serveApk\(request, env\.APKS\);/);
  });
});
