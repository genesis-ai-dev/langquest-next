import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import { parseJsonc } from '../../../scripts/env-files.mjs';
import { OPS_PATHS, isOpsPath, toOps } from '../worker/ops';
import { ownsResponse } from '../worker/securityHeaders';

/** The ops dashboard's paths reach its Worker through the binding, and nothing else does (decisions.md 160). */

const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')) as {
  assets: { run_worker_first: string[] };
  services?: { binding: string; service: string }[];
  env: { preview: { services?: unknown } };
};

describe('the ops dashboard on the app host', () => {
  it('sends the page, its links and its API, and nothing near them', () => {
    for (const path of ['/ops-dashboard', '/ops-dashboard/', '/ops-dashboard/org/abc', '/ops/api/diag', '/ops/api/feedback/x/voice']) {
      expect(isOpsPath(path), path).toBe(true);
    }
    for (const path of ['/', '/ops', '/ops/', '/ops/other', '/ops-dashboardx', '/status', '/api/ops', '/reports']) {
      expect(isOpsPath(path), path).toBe(false);
    }
  });

  it('runs the Worker first on exactly those paths, so the built page never answers them', () => {
    for (const path of OPS_PATHS) expect(config.assets.run_worker_first).toContain(path);
  });

  it('binds the admin Worker in production only', () => {
    expect(config.services).toEqual([{ binding: 'OPS', service: 'langquest-next-admin' }]);
    expect(config.env.preview.services).toBeUndefined();
  });

  it('passes the request on unchanged', async () => {
    const seen: Request[] = [];
    const ops = { fetch: async (r: Request) => { seen.push(r); return new Response('page'); } } as unknown as Fetcher;
    const request = new Request('https://next.langquest.org/ops/api/diag?fresh=1', { headers: { authorization: 'Bearer t' } });
    const res = await toOps(request, ops);
    expect(await res.text()).toBe('page');
    expect(seen[0]).toBe(request);
  });

  it('says it is not set up where there is no binding, instead of showing the app', async () => {
    const res = await toOps(new Request('https://next-preview.langquest.org/ops-dashboard'), undefined);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('not set up here');
  });

  it('says the dashboard is not deployed when its Worker throws, instead of failing this Worker', async () => {
    const throwing = { fetch: () => { throw new Error('placeholder script'); } } as unknown as Fetcher;
    const rejecting = { fetch: async () => { throw new TypeError('no fetch handler'); } } as unknown as Fetcher;
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const ops of [throwing, rejecting]) {
      const res = await toOps(new Request('https://next.langquest.org/ops-dashboard'), ops);
      expect(res.status).toBe(503);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toContain('npm run admin:deploy');
    }
    // The log names the class only, never the error's message.
    expect(quiet.mock.calls.map((c) => String(c[0]))).toEqual(['ops dashboard Worker failed: Error', 'ops dashboard Worker failed: TypeError']);
    quiet.mockRestore();
  });

  it('gets the Worker\'s security headers', () => {
    expect(ownsResponse(new URL('https://x/ops-dashboard'), { method: 'GET' })).toBe(true);
    expect(ownsResponse(new URL('https://x/ops/api/diag'), { method: 'GET' })).toBe(true);
  });
});
