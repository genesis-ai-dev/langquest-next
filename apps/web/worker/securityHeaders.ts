import { isOpsPath } from './ops';

/**
 * Headers for the answers the Worker makes itself. The built page's come from
 * `_headers` (apps/mobile/scripts/webHeaders.mjs, which has the policy and
 * the reasons); static assets bypass the Worker for routes not listed in
 * run_worker_first, and the Worker's own answers bypass that file, so these
 * three are set here with the same values. Content-Security-Policy stays the
 * page's: the API answers JSON and the Worker's pages carry their own.
 */
const HEADERS: readonly [string, string][] = [
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin']
];

/** Whether the Worker itself answers this request (index.ts), rather than passing it to the built page's assets. */
export function ownsResponse(url: URL, request: Pick<Request, 'method'>): boolean {
  if (isOpsPath(url.pathname)) return true;
  if (url.pathname === '/connect' && request.method === 'GET') return true;
  if (/^\/r\/[A-Za-z0-9_-]{22}\/?$/.test(url.pathname) && request.method === 'GET') return true;
  return url.pathname.startsWith('/api/');
}

/**
 * The response with the headers added where it set none of its own. A copy
 * (a response from a fetch or an object has immutable headers) with the same
 * body, status and, for an upgrade, socket; the body is passed on unread, so
 * a stream stays a stream.
 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  let changed = false;
  for (const [name, value] of HEADERS) {
    if (!headers.has(name)) { headers.set(name, value); changed = true; }
  }
  if (!changed) return response;
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers, ...(response.webSocket ? { webSocket: response.webSocket } : {}) } as ResponseInit);
}
