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

const plain = (text: string) => new Response(text, {
  status: 503,
  headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
});

/**
 * The request, passed on unchanged. Without the binding (preview, which has
 * no database of its own yet, and a local Worker started without the admin
 * one) it says so instead of falling through to the page. When the bound
 * Worker throws (it is only the placeholder `npm run secrets` makes, before
 * `npm run admin:deploy`, as happened on 2026-10-23) the page says it is not
 * deployed, rather than Cloudflare's error 1101 for this whole Worker; the
 * log names the error's class only.
 */
export async function toOps(request: Request, ops: Fetcher | undefined): Promise<Response> {
  if (!ops) return plain('The ops dashboard is not set up here: it runs on next.langquest.org. Locally, start it with `npm run admin:dev` beside this Worker.');
  try {
    return await ops.fetch(request);
  } catch (e) {
    console.error(`ops dashboard Worker failed: ${e instanceof Error ? e.name : 'unknown'}`);
    return plain('The ops dashboard is not deployed, or its Worker failed. Deploy it with `npm run admin:deploy` (docs/admin.md, setup step 3).');
  }
}
