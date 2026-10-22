import { beforeEach, describe, expect, it, vi } from 'vitest';
import { access, forgetSignIns, viewerState } from '../src/auth';
import { csp, page } from '../src/page';
import { SECTION_ORDER } from '../src/pageOps';
import { settle } from '../src/section';
import { handle } from '../src/index';
import type { Env } from '../src/env';
import { sessionStorageKey } from '../../mobile/src/server/sessionKey';

const VIEWER = '0857d1bc-0000-4000-8000-000000000001';

/** Supabase as the Worker sees it: who each token is, and that person's Global Viewer state. */
function authFetch(users: Record<string, string | number>, states: Record<string, unknown | number> = {}): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const token = String(new Headers(init?.headers).get('authorization')).replace('Bearer ', '');
    if (String(url).endsWith('/rest/v1/rpc/get_user_state')) {
      const state = states[token];
      return typeof state === 'number' ? new Response('{}', { status: state }) : Response.json({ termsVersion: null, globalViewer: state ?? null });
    }
    const answer = users[token] ?? 401;
    return typeof answer === 'number' ? new Response('{}', { status: answer }) : Response.json({ id: answer });
  }) as unknown as typeof fetch;
}

const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon' };
const req = (token?: string) => new Request('https://next.langquest.org/ops/api/me', token ? { headers: { authorization: `Bearer ${token}` } } : {});

describe('who may open the ops dashboard', () => {
  beforeEach(() => forgetSignIns());

  it('lets in a Global Viewer on a session verified with their authenticator', async () => {
    expect(await access(req('good'), env, authFetch({ good: VIEWER }, { good: 'on' }))).toEqual({ ok: true, profileId: VIEWER });
  });

  it('asks a Global Viewer signed in with a password only for their code', async () => {
    expect(await access(req('aal1'), env, authFetch({ aal1: VIEWER }, { aal1: 'needs_code' }))).toMatchObject({ ok: false, status: 403, need: 'code' });
  });

  it('sends one with no authenticator yet to set one up in the app', async () => {
    expect(await access(req('new'), env, authFetch({ new: VIEWER }, { new: 'needs_setup' }))).toMatchObject({ ok: false, status: 403, need: 'setup' });
  });

  it('turns away everyone else, a revoked Global Viewer included, without telling them anything about the page', async () => {
    for (const state of [null, 'revoked', 'something new']) {
      forgetSignIns();
      const answer = await access(req('other'), env, authFetch({ other: VIEWER }, { other: state }));
      expect(answer).toMatchObject({ ok: false, status: 403 });
      expect(answer).not.toHaveProperty('need');
    }
  });

  it('asks for a sign-in without a token, or when Supabase refuses it (a signed-out session)', async () => {
    expect(await access(req(), env, authFetch({}))).toMatchObject({ ok: false, status: 401 });
    expect(await access(req('stale'), env, authFetch({ stale: 403 }))).toMatchObject({ ok: false, status: 401 });
  });

  it('says Supabase or the database is down rather than signing the person out', async () => {
    expect(await access(req('good'), env, authFetch({ good: 502 }))).toMatchObject({ ok: false, status: 503 });
    expect(await access(req('good'), env, authFetch({ good: VIEWER }, { good: 500 }))).toMatchObject({ ok: false, status: 503 });
  });

  it('asks Supabase once a minute per token and the database once every 30 seconds, not on every call', async () => {
    const fetcher = authFetch({ good: VIEWER }, { good: 'on' });
    await access(req('good'), env, fetcher);
    await access(req('good'), env, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const later = Date.now() + 31_000;
    expect(await viewerState('good', env.SUPABASE_URL, env.SUPABASE_ANON_KEY, fetcher, later)).toBe('on');
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('asks the database as the person, so it reads their own session\'s level', async () => {
    const fetcher = authFetch({ good: VIEWER }, { good: 'on' });
    await access(req('good'), env, fetcher);
    const [url, init] = (fetcher as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.find(([u]) => String(u).includes('get_user_state'))!;
    expect(url).toBe('https://example.supabase.co/rest/v1/rpc/get_user_state');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer good');
    expect(new Headers(init.headers).get('apikey')).toBe('anon');
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

describe('the entry module', () => {
  it('exports nothing the Workers runtime would refuse as an entrypoint', async () => {
    const mod = await import('../src/index');
    for (const [name, value] of Object.entries(mod)) {
      expect(typeof value === 'function' || (name === 'default' && typeof value === 'object'), name).toBe(true);
    }
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

  it('uses the web app\'s own session only to read, and only once it is verified with an authenticator', async () => {
    const html = await (await handle(new Request('https://next.langquest.org/ops-dashboard'), fullEnv)).text();
    expect(html).toContain("'sb-' + new URL(CFG.supabaseUrl).hostname.split('.')[0] + '-auth-token'");
    expect(html).toContain("claims(s.access_token).aal === 'aal2'");
    expect(html).not.toMatch(/localStorage\.(setItem|removeItem)/);
    // The same key the app keeps its session under.
    expect(sessionStorageKey('https://abc.supabase.co')).toBe('sb-abc-auth-token');
  });

  it('lists every section in page order', async () => {
    const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
    const script = html.split('<script nonce="n">')[1]!.split('</script>')[0]!;
    for (const id of SECTION_ORDER) expect(script).toContain(`"${id}"`);
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
