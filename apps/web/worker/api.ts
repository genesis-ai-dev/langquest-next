import { summarizeReports, type OrgReportsResponse } from '@langquest-next/core';
import { handleBible, type BibleDeps } from './bible';

export interface ApiDeps {
  /** The profile a Supabase access token belongs to, or null when it is not valid. */
  profileOf(token: string): Promise<string | null>;
  /** The caller's languages in the organization, or null when they are not in it. */
  reports(orgId: string, profileId: string, fresh: boolean): Promise<OrgReportsResponse | null>;
  /** Bible Brain (`/api/bible/*`, bible.ts); without it, or without its key, those routes answer 503. */
  bible?: Omit<BibleDeps, 'profileOf'>;
}

const NO_STORE = { 'cache-control': 'private, no-store' };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...NO_STORE, ...headers } });

/** A validator for the rows alone, so an unchanged answer is a 304 even though `asOf` moved on. */
async function etagOf(rows: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows)));
  return `"${[...new Uint8Array(digest).slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')}"`;
}

/**
 * The app on a developer's machine (Metro's web page, a simulator) runs on
 * another origin than the Worker. Hosted, the web app is served from the
 * Worker's own origin and phones need no CORS, so only local origins get it.
 * The token travels in a header, never a cookie, so no credentials are allowed.
 */
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d+)?$/;

function withCors(request: Request, res: Response): Response {
  const origin = request.headers.get('origin');
  if (!origin || !LOCAL_ORIGIN.test(origin)) return res;
  const headers = new Headers(res.headers);
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-headers', 'authorization, if-none-match');
  headers.set('access-control-expose-headers', 'etag, x-as-of');
  headers.set('vary', 'origin');
  return new Response(res.body, { status: res.status, headers });
}

/**
 * `GET /api/orgs/:org/reports[?fresh=1][&view=summary]` with
 * `Authorization: Bearer <access token>`. `view=summary` answers each
 * language's progress alone (a phone's overview). Every 200 carries an
 * ETag over its rows and `X-As-Of`; a matching `If-None-Match` gets a 304
 * with the same headers, so a phone keeps what it has and learns how fresh
 * it is without downloading it again.
 */
export async function handleApi(request: Request, deps: ApiDeps): Promise<Response> {
  if (request.method === 'OPTIONS') return withCors(request, new Response(null, { status: 204, headers: { 'access-control-allow-methods': 'GET' } }));
  return withCors(request, await answer(request, deps));
}

async function answer(request: Request, deps: ApiDeps): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/bible/')) return handleBible(request, { key: undefined, ...deps.bible, profileOf: deps.profileOf });
  const match = /^\/api\/orgs\/([^/]+)\/reports$/.exec(url.pathname);
  if (!match) return json(404, { error: 'Not found.' });
  if (request.method !== 'GET') return json(405, { error: 'Only GET is supported.' });
  let orgId: string;
  try {
    orgId = decodeURIComponent(match[1]!);
  } catch {
    return json(400, { error: 'That organization id is not valid.' });
  }
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const profileId = token ? await deps.profileOf(token) : null;
  if (!profileId) return json(401, { error: 'Sign in again.' });
  let out: OrgReportsResponse | null;
  try {
    out = await deps.reports(orgId, profileId, url.searchParams.get('fresh') === '1');
  } catch (e) {
    console.error(`reports ${orgId}:`, e);
    return json(502, { error: 'The dashboard could not read this organization just now. Try again.' });
  }
  if (!out) return json(403, { error: 'You are not a member of this organization.' });
  const body = url.searchParams.get('view') === 'summary' ? summarizeReports(out) : out;
  const headers = { etag: await etagOf(body.rows), 'x-as-of': body.asOf };
  if (request.headers.get('if-none-match') === headers.etag) return new Response(null, { status: 304, headers: { ...NO_STORE, ...headers } });
  return json(200, body, headers);
}
