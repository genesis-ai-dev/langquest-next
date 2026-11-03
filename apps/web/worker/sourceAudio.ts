import { isSourceAudioUrl } from '@langquest-next/core';

/**
 * A source's audio for a browser to keep offline (decisions.md 200). The
 * page may read only its own site and Supabase (the content security policy,
 * apps/mobile/scripts/webHeaders.mjs), and OpenBible allows no other site's
 * reads, so every chapter a browser tried to keep failed before it left the
 * page. The Worker fetches it instead and passes the bytes on as they come,
 * keeping nothing.
 *
 * `GET /api/source-audio?url=<link>` with `Authorization: Bearer <Supabase
 * access token>`: a library source's link, only on a host in core's
 * SOURCE_AUDIO_HOSTS, so this is never a way to fetch anything else. Bible
 * Brain's files come through `/api/bible/file/...` (bible.ts), which checks
 * that FCBH lets us download them.
 */
export interface SourceAudioDeps {
  /** The profile a Supabase access token belongs to, or null. */
  profileOf(token: string): Promise<string | null>;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

export async function handleSourceAudio(request: Request, deps: SourceAudioDeps): Promise<Response> {
  if (request.method !== 'GET') return text(405, 'Only GET is supported.');
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token || !(await deps.profileOf(token))) return text(401, 'Sign in again.');
  const link = new URL(request.url).searchParams.get('url') ?? '';
  if (!isSourceAudioUrl(link)) return text(404, 'Not a source audio link.');
  return passAudioThrough(deps.fetch ?? ((u, i) => fetch(u, i)), link);
}

/**
 * Fetch an audio file and answer with its bytes as they arrive: never
 * cached, here or by the browser (the app keeps its own copy, by hash).
 * 404 when the host has no such file, 502 when it did not answer with audio.
 */
export async function passAudioThrough(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, link: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetchImpl(link, { headers: { accept: 'audio/*' } });
  } catch {
    return text(502, 'The audio did not come just now. Try again.');
  }
  if (res.status === 404 || res.status === 410) return text(404, 'No such audio file.');
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !res.body || !/^(audio\/|application\/octet-stream)/i.test(type)) {
    await res.body?.cancel().catch(() => undefined);
    return text(502, 'The audio did not come just now. Try again.');
  }
  const length = res.headers.get('content-length');
  return new Response(res.body, {
    status: 200,
    headers: { 'content-type': type, ...(length ? { 'content-length': length } : {}), 'cache-control': 'private, no-store' }
  });
}

const text = (status: number, body: string) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, no-store' } });
