import { BadDigest, fromService, resolveRange, type BlobBucket } from './blobs';
import { TtlCache } from './isolateCache';
import { CHANNELS, type ChannelLanguage } from '../../../server/youtube';

/**
 * The tutorial videos the filming made (docs/tutorial-videos.md, decisions.md
 * 180): `GET /api/tutorials/<language>/<tutorial>/<sha256>.mp4`, kept in the
 * blobs bucket under `tutorials/`. The publish job reads each one here on
 * its way to YouTube, and the ops dashboard plays one before Publish. They
 * are made to be public, so no sign-in; a file's name is its bytes' hash, so
 * it never changes. Ranges are served, as a browser's video player asks.
 *
 * `PUT` with the service key is how a version gets there: the intake job
 * (server/tutorialIntake.ts) brings each film the nightly filming made on
 * GitHub, and R2 refuses bytes that do not hash to the name.
 */
const LANGUAGE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?$/;
const TUTORIAL = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const FILE = /^([0-9a-f]{64})\.mp4$/;
/** Cloudflare takes a request body of up to 100 MB on the plan we use; a film is about 10 MB. */
export const TUTORIAL_MAX_BYTES = 100 * 1024 * 1024;

/** Where a version is kept in the bucket. */
export const tutorialKey = (language: string, tutorial: string, sha256: string) => `tutorials/${language}/${tutorial}/${sha256}.mp4`;

export async function handleTutorialVideo(request: Request, blobs: { bucket: BlobBucket; serviceKey: string } | undefined): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'PUT') return new Response('Only GET, HEAD and PUT are supported.', { status: 405 });
  const m = /^\/api\/tutorials\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(new URL(request.url).pathname);
  const file = m ? FILE.exec(m[3]!) : null;
  if (!m || !file || !LANGUAGE.test(m[1]!) || m[2]!.length > 80 || !TUTORIAL.test(m[2]!)) return new Response('Not found.', { status: 404 });
  if (!blobs) return new Response('Tutorial videos are not set up here.', { status: 503 });
  const { bucket } = blobs;
  const key = tutorialKey(m[1]!, m[2]!, file[1]!);
  if (request.method === 'PUT') return put(request, blobs, key, file[1]!);
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

async function put(request: Request, blobs: { bucket: BlobBucket; serviceKey: string }, key: string, sha256: string): Promise<Response> {
  if (!(await fromService(request, blobs.serviceKey))) return new Response('Only the service puts tutorial videos.', { status: 401 });
  const length = Number(request.headers.get('content-length') ?? NaN);
  if (!Number.isSafeInteger(length) || length <= 0) return new Response('Send the video with its length.', { status: 411 });
  if (length > TUTORIAL_MAX_BYTES) return new Response(`A video is at most ${TUTORIAL_MAX_BYTES / 1024 / 1024} MB.`, { status: 413 });
  try {
    const stored = await blobs.bucket.put(key, request.body ?? new Uint8Array(), length, sha256, 'video/mp4');
    return Response.json({ sha256, size: stored.size });
  } catch (e) {
    if (e instanceof BadDigest) return new Response('The video does not match its name; it was not stored.', { status: 422 });
    console.error(`tutorial put ${key}:`, e);
    return new Response('The video could not be stored just now. Try again.', { status: 502 });
  }
}

/** How long a watch link's answer is kept, in the isolate and in the browser. */
const WATCH_MS = 5 * 60_000;
const watched = new TtlCache<string>(2000);

/**
 * `GET /v/<language>/<tutorial>`: the link each video's description gives to
 * the same video in another language (e2e/tutorials/playlists.ts
 * `watchLink`). It goes on to that video's newest version on YouTube, or to
 * the language's channel while none is up, so a description never has to
 * change when a version is replaced. `newest` is asked at most every five
 * minutes for each video; when it fails, the channel is the answer.
 */
export async function handleWatch(request: Request, newest: (tutorial: string, language: string) => Promise<string | null>): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Only GET is supported.', { status: 405 });
  const m = /^\/v\/([^/]+)\/([^/]+)\/?$/.exec(new URL(request.url).pathname);
  if (!m || !Object.hasOwn(CHANNELS, m[1]!) || m[2]!.length > 80 || !TUTORIAL.test(m[2]!)) return new Response('Not found.', { status: 404 });
  const language = m[1] as ChannelLanguage;
  const key = `${language}/${m[2]}`;
  let to = watched.get(key);
  if (!to) {
    const id = await newest(m[2]!, language).catch((e: unknown) => {
      console.error(`tutorial watch ${key}:`, e);
      return undefined;
    });
    to = id ? `https://youtu.be/${id}` : `https://www.youtube.com/channel/${CHANNELS[language]}`;
    if (id !== undefined) watched.set(key, to, Date.now() + WATCH_MS);
  }
  return new Response(null, { status: 302, headers: { location: to, 'cache-control': `public, max-age=${WATCH_MS / 1000}` } });
}
