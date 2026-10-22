import { beforeEach, describe, expect, it, vi } from 'vitest';
import { access, forgetSignIns } from '../src/auth';
import { csp, page } from '../src/page';
import { settle } from '../src/section';
import { handle } from '../src/index';
import type { Env } from '../src/env';

const ADMIN = '0857d1bc-0000-4000-8000-000000000001';
const OTHER = '11111111-0000-4000-8000-000000000002';

function authFetch(answers: Record<string, string | number>): typeof fetch {
  return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const token = String(new Headers(init?.headers).get('authorization')).replace('Bearer ', '');
    const answer = answers[token] ?? 401;
    return typeof answer === 'number' ? new Response('{}', { status: answer }) : Response.json({ id: answer });
  }) as unknown as typeof fetch;
}

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon', ADMIN_PROFILE_IDS: `${ADMIN}, ` };
const req = (token?: string) => new Request('https://next.langquest.org/ops/api/me', token ? { headers: { authorization: `Bearer ${token}` } } : {});

describe('who may open the admin page', () => {
  beforeEach(() => forgetSignIns());

  it('lets in a signed-in account on the list', async () => {
    expect(await access(req('good'), env, authFetch({ good: ADMIN }))).toEqual({ ok: true, profileId: ADMIN });
  });

  it('turns away an account not on the list, and tells it its own id', async () => {
    expect(await access(req('other'), env, authFetch({ other: OTHER }))).toMatchObject({ ok: false, status: 403, profileId: OTHER });
  });

  it('asks for a sign-in without a token, or when Supabase refuses it (a signed-out session)', async () => {
    expect(await access(req(), env, authFetch({}))).toMatchObject({ ok: false, status: 401 });
    expect(await access(req('stale'), env, authFetch({ stale: 403 }))).toMatchObject({ ok: false, status: 401 });
  });

  it('lets no one in while the list is empty, but tells whoever signs in their id, to start the list with', async () => {
    expect(await access(req('good'), { ...env, ADMIN_PROFILE_IDS: ' , ' }, authFetch({ good: ADMIN }))).toMatchObject({ ok: false, status: 403, profileId: ADMIN });
  });

  it('says Supabase is down rather than signing the person out', async () => {
    expect(await access(req('good'), env, authFetch({ good: 502 }))).toMatchObject({ ok: false, status: 503 });
  });

  it('asks Supabase once a minute per token, not on every call', async () => {
    const fetcher = authFetch({ good: ADMIN });
    await access(req('good'), env, fetcher);
    await access(req('good'), env, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('the page', () => {
  it('runs only its own script and style, and talks only to itself and Supabase', async () => {
    const response = page({ supabaseUrl: 'https://example.supabase.co', anonKey: 'anon' }, 'n0nce');
    const policy = response.headers.get('content-security-policy')!;
    expect(policy).toBe(csp('https://example.supabase.co', 'n0nce'));
    expect(policy).toContain("script-src 'nonce-n0nce'");
    expect(policy).toContain("connect-src 'self' https://example.supabase.co");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain('media-src blob:');
    const html = await response.text();
    expect(html).toContain('<script nonce="n0nce">');
    expect(html).not.toMatch(/ style="/);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it("serves a script that parses (a template literal's escapes are easy to lose)", async () => {
    const html = await page({ supabaseUrl: 'https://x.supabase.co', anonKey: 'k' }, 'n').text();
    const script = html.slice(html.indexOf('<script nonce="n">') + '<script nonce="n">'.length, html.lastIndexOf('</script>'));
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain('/\\d{4}-\\d{2}-\\d{2}T');
  });

  it('keeps the config from closing its script tag', async () => {
    const html = await page({ supabaseUrl: 'https://x.supabase.co', anonKey: '</script><b>' }, 'n').text();
    expect(html).not.toContain('</script><b>');
  });
});

describe('the API', () => {
  const fullEnv = { ...env, DIAG_DATABASE_URL: 'postgresql://diag_reader:x@127.0.0.1:1/postgres' } as unknown as Env;

  it('answers the page at /ops-dashboard and its links, and refuses anything but GET', async () => {
    for (const path of ['/ops-dashboard', '/ops-dashboard/org/abc']) {
      expect((await handle(new Request(`https://next.langquest.org${path}`), fullEnv)).headers.get('content-type')).toContain('text/html');
    }
    expect((await handle(new Request('https://next.langquest.org/ops/api/diag', { method: 'POST' }), fullEnv)).status).toBe(405);
    expect((await handle(new Request('https://next.langquest.org/favicon.ico'), fullEnv)).status).toBe(404);
    expect((await handle(new Request('https://next.langquest.org/api/diag'), fullEnv)).status).toBe(404);
  });

  it('sends a local visit to / to the page', async () => {
    const response = await handle(new Request('http://localhost:8791/'), fullEnv);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://localhost:8791/ops-dashboard');
  });

  it('calls only /ops/api from the page', async () => {
    const html = await (await handle(new Request('https://next.langquest.org/ops-dashboard'), fullEnv)).text();
    expect(html).not.toMatch(/['"]\/api\//);
    expect(html).toContain("'/ops/api/");
  });

  it('checks the sign-in before any section', async () => {
    const response = await handle(new Request('https://next.langquest.org/ops/api/diag'), fullEnv);
    expect(response.status).toBe(401);
  });
});

describe('a section that hangs or throws', () => {
  it('becomes an error section, so the others still show', async () => {
    expect(await settle('slow', () => new Promise(() => {}), 10)).toMatchObject({ state: 'error', error: 'slow did not answer within 0 s' });
    expect(await settle('boom', async () => { throw new Error('HTTP 500'); })).toMatchObject({ state: 'error', error: 'HTTP 500' });
  });
});
