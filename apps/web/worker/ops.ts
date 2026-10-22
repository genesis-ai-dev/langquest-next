/**
 * The ops dashboard's paths on the app's host (docs/admin.md, decisions.md
 * 151): the page at /ops-dashboard and its API at /ops/api/*. This Worker
 * only hands them to the admin Worker through the OPS service binding; it
 * holds none of that Worker's keys and reads nothing on the way. wrangler.jsonc
 * lists the same paths in run_worker_first, so the built page never answers
 * them (apps/web/test/ops.test.ts holds the two equal).
 */
export const OPS_PATHS = ['/ops-dashboard', '/ops-dashboard/*', '/ops/api/*'] as const;

export function isOpsPath(pathname: string): boolean {
  return pathname === '/ops-dashboard' || pathname.startsWith('/ops-dashboard/') || pathname.startsWith('/ops/api/');
}

/**
 * The request, passed on unchanged. Without the binding (preview, which has
 * no database of its own yet, and a local Worker started without the admin
 * one) it says so instead of falling through to the page.
 */
export function toOps(request: Request, ops: Fetcher | undefined): Promise<Response> | Response {
  if (ops) return ops.fetch(request);
  return new Response('The ops dashboard is not set up here: it runs on next.langquest.org. Locally, start it with `npm run admin:dev` beside this Worker.', {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
  });
}
