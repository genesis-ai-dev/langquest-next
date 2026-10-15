import { ownsResponse, withSecurityHeaders } from '../worker/securityHeaders';
import { headersFor } from '../../mobile/scripts/webHeaders.mjs';

/** The Worker's own answers carry the headers the built page gets from `_headers`. */

describe('security headers on the Worker\'s own answers', () => {
  it('adds the three, with the values the static file sets', () => {
    const res = withSecurityHeaders(Response.json({ ok: true }));
    const file = headersFor({ supabaseUrl: 'https://x.supabase.co' });
    for (const name of ['Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy']) {
      expect(file).toContain(`${name}: ${res.headers.get(name)}`);
    }
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('keeps a header the route set, the status and the body', async () => {
    const res = withSecurityHeaders(new Response('hi', { status: 201, headers: { 'Referrer-Policy': 'no-referrer', 'X-Other': '1' } }));
    expect(res.status).toBe(201);
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('X-Other')).toBe('1');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await res.text()).toBe('hi');
  });

  it('passes an empty 304 and a stream through whole', async () => {
    const empty = withSecurityHeaders(new Response(null, { status: 304 }));
    expect(empty.status).toBe(304);
    expect(empty.body).toBeNull();
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new TextEncoder().encode('a')); c.enqueue(new TextEncoder().encode('b')); c.close(); } });
    const res = withSecurityHeaders(new Response(stream));
    expect(res.body).toBe(stream);
    expect(await res.text()).toBe('ab');
  });

  it('returns the same response when it has all three', () => {
    const first = withSecurityHeaders(new Response('x'));
    expect(withSecurityHeaders(first)).toBe(first);
  });

  it('applies to the routes the Worker answers, not the built page', () => {
    const own = (path: string, method = 'GET') => ownsResponse(new URL(`https://x${path}`), { method });
    expect(own('/api/reports/o')).toBe(true);
    expect(own('/connect')).toBe(true);
    expect(own(`/r/${'a'.repeat(22)}`)).toBe(true);
    expect(own('/')).toBe(false);
    expect(own('/index.html')).toBe(false);
    expect(own('/connect', 'POST')).toBe(false);
  });
});
