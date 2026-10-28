import { resolveRange, type BlobBucket } from './blobs';

/**
 * The tutorial videos the filming made (docs/tutorial-videos.md, decisions.md
 * 180): `GET /api/tutorials/<language>/<tutorial>/<sha256>.mp4`, kept in the
 * blobs bucket under `tutorials/`. The publish job reads each one here on
 * its way to YouTube, and the ops dashboard plays one before Publish. They
 * are made to be public, so no sign-in; a file's name is its bytes' hash, so
 * it never changes. Ranges are served, as a browser's video player asks.
 */
const LANGUAGE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?$/;
const TUTORIAL = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FILE = /^([0-9a-f]{64})\.mp4$/;

/** Where a version is kept in the bucket. */
export const tutorialKey = (language: string, tutorial: string, sha256: string) => `tutorials/${language}/${tutorial}/${sha256}.mp4`;

export async function handleTutorialVideo(request: Request, bucket: BlobBucket | undefined): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Only GET is supported.', { status: 405 });
  const m = /^\/api\/tutorials\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(new URL(request.url).pathname);
  const file = m ? FILE.exec(m[3]!) : null;
  if (!m || !file || !LANGUAGE.test(m[1]!) || m[2]!.length > 80 || !TUTORIAL.test(m[2]!)) return new Response('Not found.', { status: 404 });
  if (!bucket) return new Response('Tutorial videos are not set up here.', { status: 503 });
  const key = tutorialKey(m[1]!, m[2]!, file[1]!);
  const head = await bucket.head(key);
  if (!head) return new Response('Not found.', { status: 404 });
  const headers: Record<string, string> = {
    'content-type': 'video/mp4',
    'x-content-type-options': 'nosniff',
    'accept-ranges': 'bytes',
    etag: `"${file[1]}"`,
    'cache-control': 'public, max-age=31536000, immutable'
  };
  const range = resolveRange(request.headers.get('range'), head.size);
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { 'content-range': `bytes */${head.size}` } });
  const length = range ? range.length : head.size;
  const body = request.method === 'HEAD' ? null : (await bucket.get(key, range ?? undefined))?.body;
  if (request.method === 'GET' && !body) return new Response('Not found.', { status: 404 });
  return new Response(body ?? null, {
    status: range ? 206 : 200,
    headers: { ...headers, 'content-length': String(length), ...(range ? { 'content-range': `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}` } : {}) }
  });
}
