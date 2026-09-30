import type { OrgReportsResponse } from '../src/types';

export interface ApiDeps {
  /** The profile a Supabase access token belongs to, or null when it is not valid. */
  profileOf(token: string): Promise<string | null>;
  /** The caller's languages in the organization, or null when they are not in it. */
  reports(orgId: string, profileId: string, fresh: boolean): Promise<OrgReportsResponse | null>;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } });

/** `GET /api/orgs/:org/reports[?fresh=1]` with `Authorization: Bearer <access token>`. */
export async function handleApi(request: Request, deps: ApiDeps): Promise<Response> {
  const url = new URL(request.url);
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
  try {
    const out = await deps.reports(orgId, profileId, url.searchParams.get('fresh') === '1');
    return out ? json(200, out) : json(403, { error: 'You are not a member of this organization.' });
  } catch (e) {
    console.error(`reports ${orgId}:`, e);
    return json(502, { error: 'The dashboard could not read this organization just now. Try again.' });
  }
}
