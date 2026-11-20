import { CARRIED_APK_PATH, CARRIED_APK_VERSION_CODE, CARRIED_FILE_TYPE, carriedApkNameOf, carriedApkVersionsPart, carriedFileName, parseCarriedApkName, sameCarriedVersions } from '@langquest-next/core';

/**
 * Carried builds (docs/nearby-sync-plan.md 14.4): `GET /apk/<name>` serves the Play-signed
 * universal APK that scripts/carried-build.mjs put in the APK bucket, for a carrier to download
 * with their browser while online. Only names core's `carriedApkName` writes are asked of the
 * bucket, so nothing else there (its `current.json`) is ever served, and there is no listing:
 * `/apk/` and every other path under it answer 404. A name the bucket lacks is sent on to the
 * newest file for the same versions, whatever its fingerprint, since that installs an app that can
 * join a phone on those versions; the bucket is listed for that, by the versions' start alone, and
 * the list is never shown (docs/decisions/2026-11-18-carried-file-matches-by-versions.md). Public by design and apart from teams'
 * recordings and their auth. The download name is the file's own, which holds only versions, so
 * a file kept in Downloads or on an SD card says nothing about the app. Ranges are passed to R2,
 * so a download cut off on a poor link can go on where it stopped.
 *
 * The same file is also served as `/apk/<versions>.carried`, under the app's own type
 * (`CARRIED_FILE_TYPE`), for a carrier's browser to hand to the app with its Open: the app opens
 * that type, checks the file and keeps a copy for Give the app. Not an install file's name or type,
 * so the browser does not warn that it may be harmful (docs/decisions/0246-a-carried-build-is-the-newcomers.md,
 * amended 2026-11-20). The bucket holds one file per build, under the install file's name.
 */

/** The content type Android installs from. */
export const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';

/** The part of the APK binding this route uses. */
export type ApkBucket = Pick<R2Bucket, 'get' | 'head' | 'list'>;

const notFound = () => new Response('Not found.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

/** What a path asks for: the file in the bucket (`key`), and the name and type it is served under. */
export interface ApkAsked { key: string; served: string; type: string }

/**
 * What a path asks for, when it names a carried build: as an install file (`<versions>.apk`, its
 * own name in the bucket) or for the app to take (`<versions>.carried`, `carriedFileName`); else null.
 */
export function apkNameOf(pathname: string): ApkAsked | null {
  if (!pathname.startsWith(CARRIED_APK_PATH)) return null;
  const name = pathname.slice(CARRIED_APK_PATH.length);
  const key = carriedApkNameOf(name);
  if (!key) return null;
  return { key, served: name, type: parseCarriedApkName(name) ? APK_CONTENT_TYPE : CARRIED_FILE_TYPE };
}

/** The path another build's file is served under, in the same form as `asked`. */
function pathFor(key: string, asked: ApkAsked): string {
  return `${CARRIED_APK_PATH}${asked.type === CARRIED_FILE_TYPE ? carriedFileName(key) : key}`;
}

function headersFor(asked: ApkAsked, object: R2Object): Headers {
  const headers = new Headers();
  headers.set('content-type', asked.type);
  headers.set('content-disposition', `attachment; filename="${asked.served}"`);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  // Kept in no cache: the download list is trace enough on a carrier's phone, which may wear a disguise
  // (security review, 2026-11-10). A Worker's answer is not cached at the edge either way.
  headers.set('cache-control', 'private, no-store');
  return headers;
}

/**
 * The newest file in the bucket for the same versions as `name`, by the Play version code each
 * file records and then by when it was put there; null when the bucket has none. A phone's own
 * build may have no file (one made before carried builds were published, or on a release branch),
 * and any file for its versions lets a new phone join it.
 */
export async function newestFitting(bucket: ApkBucket, name: string): Promise<string | null> {
  const start = carriedApkVersionsPart(name);
  if (!start) return null;
  const listed = await bucket.list({ prefix: start, include: ['customMetadata'] });
  const code = (o: R2Object) => {
    const n = Number(o.customMetadata?.[CARRIED_APK_VERSION_CODE]);
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  };
  const fits = listed.objects.filter((o) => sameCarriedVersions(o.key, name));
  fits.sort((a, b) => code(b) - code(a) || b.uploaded.getTime() - a.uploaded.getTime());
  return fits[0]?.key ?? null;
}

/** Sends the browser to another carried build's file, so it downloads under that file's own name. Never cached: the newest changes. */
function sendTo(path: string): Response {
  return new Response(null, { status: 302, headers: { location: path, 'cache-control': 'private, no-store' } });
}

/** A file the bucket lacks: sent to the newest for the same versions, in the form asked for, or 404 when there is none. */
async function fitting(bucket: ApkBucket, asked: ApkAsked): Promise<Response> {
  const newest = await newestFitting(bucket, asked.key);
  return newest && newest !== asked.key ? sendTo(pathFor(newest, asked)) : notFound();
}

/** `GET` or `HEAD /apk/<name>`: the file from the APK bucket, the newest for the same versions when it lacks that one, or 404. */
export async function serveApk(request: Request, bucket: ApkBucket | undefined): Promise<Response> {
  const asked = apkNameOf(new URL(request.url).pathname);
  if (!asked || (request.method !== 'GET' && request.method !== 'HEAD')) return notFound();
  // No binding is a Worker set up without the bucket (local development): nothing is served.
  if (!bucket) return new Response('Carried builds are not set up here.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  if (request.method === 'HEAD') {
    const object = await bucket.head(asked.key);
    if (!object) return fitting(bucket, asked);
    const headers = headersFor(asked, object);
    headers.set('content-length', String(object.size));
    return new Response(null, { status: 200, headers });
  }
  const object = await bucket.get(asked.key, { range: request.headers });
  if (!object) return fitting(bucket, asked);
  const headers = headersFor(asked, object);
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
