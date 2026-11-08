import { CARRIED_APK_PATH, parseCarriedApkName } from '@langquest-next/core';

/**
 * Carried builds (docs/nearby-sync-plan.md 14.4): `GET /apk/<name>` serves the Play-signed
 * universal APK that scripts/carried-build.mjs put in the APK bucket, for a carrier to download
 * with their browser while online. Only names core's `carriedApkName` writes are asked of the
 * bucket, so nothing else there (its `current.json`) is ever served, and there is no listing:
 * `/apk/` and every other path under it answer 404. Public by design and apart from teams'
 * recordings and their auth. The download name is the file's own, which holds only versions, so
 * a file kept in Downloads or on an SD card says nothing about the app. Ranges are passed to R2,
 * so a download cut off on a poor link can go on where it stopped.
 */

/** The content type Android installs from. */
export const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';

/** The part of the APK binding this route uses. */
export type ApkBucket = Pick<R2Bucket, 'get' | 'head'>;

const notFound = () => new Response('Not found.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/** The name a path asks for, when it is a carried build's name, else null. */
export function apkNameOf(pathname: string): string | null {
  if (!pathname.startsWith(CARRIED_APK_PATH)) return null;
  const name = pathname.slice(CARRIED_APK_PATH.length);
  return parseCarriedApkName(name) ? name : null;
}

function headersFor(name: string, object: R2Object): Headers {
  const headers = new Headers();
  headers.set('content-type', APK_CONTENT_TYPE);
  headers.set('content-disposition', `attachment; filename="${name}"`);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  // A name stands for its versions, and a carried build of the same versions is rare, so an hour is enough.
  headers.set('cache-control', 'public, max-age=3600');
  return headers;
}

/** `GET` or `HEAD /apk/<name>`: the file from the APK bucket, or 404. */
export async function serveApk(request: Request, bucket: ApkBucket | undefined): Promise<Response> {
  const name = apkNameOf(new URL(request.url).pathname);
  if (!name || (request.method !== 'GET' && request.method !== 'HEAD')) return notFound();
  // No binding is a Worker set up without the bucket (local development): nothing is served.
  if (!bucket) return new Response('Carried builds are not set up here.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  if (request.method === 'HEAD') {
    const object = await bucket.head(name);
    if (!object) return notFound();
    const headers = headersFor(name, object);
    headers.set('content-length', String(object.size));
    return new Response(null, { status: 200, headers });
  }
  const object = await bucket.get(name, { range: request.headers });
  if (!object) return notFound();
  const headers = headersFor(name, object);
  const range = object.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && request.headers.has('range')) {
    const offset = range.suffix !== undefined ? object.size - range.suffix : range.offset ?? 0;
    const length = range.suffix !== undefined ? range.suffix : range.length ?? object.size - offset;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('content-length', String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('content-length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}
