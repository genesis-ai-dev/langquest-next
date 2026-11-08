import { readFileSync } from 'node:fs';
import { carriedApkName, carriedApkNameHere } from '@langquest-next/core';
import { APK_CONTENT_TYPE, apkNameOf, serveApk, type ApkBucket } from '../worker/apk';
import { ownsResponse } from '../worker/securityHeaders';
import { routeClass } from '../worker/requestTally';

/**
 * `GET /apk/<name>` (worker/apk.ts, docs/nearby-sync-plan.md 14.4): a carried build's APK from the
 * APK bucket, under a name that holds only versions, and nothing else from that bucket or anywhere.
 */

const NAME = carriedApkName({ reducer: 21, lines: 1, protocol: { min: 1, max: 1 }, fingerprint: '0a1b2c3d4e5f' })!;

/** An R2 bucket of named byte arrays, answering get (with ranges) and head as the binding does. */
function fakeBucket(files: Record<string, Uint8Array>) {
  const asked: string[] = [];
  const meta = (key: string, bytes: Uint8Array) => ({ key, size: bytes.length, httpEtag: `"${key.length}-${bytes.length}"` });
  const bucket = {
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

  it('is 404 for a name the bucket lacks, anything that is not a carried build\'s name, and other methods, and never lists', async () => {
    const { bucket, asked } = fakeBucket({ [NAME]: apk, 'current.json': new Uint8Array([123, 125]), 'other.apk': apk });
    const other = carriedApkName({ reducer: 22, lines: 1, protocol: { min: 1, max: 1 }, fingerprint: '0a1b2c3d4e5f' })!;
    expect((await serveApk(ask(`/apk/${other}`), bucket)).status).toBe(404);
    for (const path of ['/apk/', '/apk', '/apk/current.json', '/apk/other.apk', `/apk/${NAME}/x`, `/apk/x/${NAME}`, `/apk/${NAME.toUpperCase()}`,
      '/apk/..%2Fcurrent.json', '/apk/?list-type=2', `/apk//${NAME}`]) {
      expect((await serveApk(ask(path), bucket)).status, path).toBe(404);
    }
    for (const method of ['PUT', 'POST', 'DELETE']) expect((await serveApk(ask(`/apk/${NAME}`, { method }), bucket)).status, method).toBe(404);
    // Only the carried build's names were ever asked of the bucket.
    expect(asked).toEqual([`get ${other}`]);
  });

  it('says it is not set up where the Worker has no APK bucket', async () => {
    expect((await serveApk(ask(`/apk/${NAME}`), undefined)).status).toBe(503);
    expect((await serveApk(ask('/apk/nothing'), undefined)).status).toBe(404);
  });

  it('reads names with the same function that names the file for the script and Let someone in', () => {
    expect(apkNameOf(`/apk/${carriedApkNameHere('0a1b2c3d4e5f')}`)).toBe(carriedApkNameHere('0a1b2c3d4e5f'));
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
