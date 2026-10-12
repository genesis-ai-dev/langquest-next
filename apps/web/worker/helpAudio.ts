import type { BlobBucket } from './blobs';

/**
 * Help mode's recorded lines (LAN-42, docs/localization.md): a voice saying
 * each screen's intro and each part's explanation, in each app language.
 * `GET /api/help-audio/<language>/index.json` lists the lines recorded for a
 * language (by the hash of the words they say), and
 * `GET /api/help-audio/<language>/<hash>.m4a` is one line. The same for
 * everyone and never private, so no sign-in; phones keep what they fetch.
 * Kept in the blobs bucket under `help-audio/`, put there by
 * `npm run help-audio` (scripts/help-audio.ts).
 */
const LANGUAGE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?$/;
const FILE = /^(index\.json|[0-9a-f]{16}\.m4a)$/;

export async function handleHelpAudio(request: Request, bucket: BlobBucket | undefined): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Only GET is supported.', { status: 405 });
  const match = /^\/api\/help-audio\/([^/]+)\/([^/]+)$/.exec(new URL(request.url).pathname);
  if (!match || !LANGUAGE.test(match[1]!) || !FILE.test(match[2]!)) return new Response('Not found.', { status: 404 });
  if (!bucket) return new Response('Help audio is not set up here.', { status: 503 });
  const object = await bucket.get(`help-audio/${match[1]}/${match[2]}`);
  if (!object) return new Response('Not found.', { status: 404 });
  const index = match[2] === 'index.json';
  return new Response(request.method === 'HEAD' ? null : object.body, {
    headers: {
      'content-type': index ? 'application/json' : 'audio/mp4',
      'content-length': String(object.size),
      // A line's file never changes (its name is its words' hash); the list does when lines are added.
      'cache-control': index ? 'public, max-age=3600' : 'public, max-age=31536000, immutable'
    }
  });
}
