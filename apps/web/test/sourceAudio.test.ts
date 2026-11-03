import { handleApi, type ApiDeps } from '../worker/api';
import { handleSourceAudio } from '../worker/sourceAudio';

/**
 * A library source's audio, fetched by the Worker for a browser that cannot
 * read it itself (decisions.md 200): signed in, GET, and only from a host
 * library sources use (core SOURCE_AUDIO_HOSTS).
 */

const LINK = 'https://openbible.com/audio/bsb_frederick_surrey/BSB_43_Jhn_003_FS.mp3';

function setup(answer: (url: string) => Response | Promise<Response> = () => new Response('mp3', { headers: { 'content-type': 'audio/mpeg', 'content-length': '3' } })) {
  const asked: string[] = [];
  const deps = {
    profileOf: async (t: string) => (t === 'good' ? 'p1' : null),
    fetch: async (url: string) => { asked.push(url); return answer(url); }
  };
  const call = async (link: string, opts: { token?: string | null; method?: string } = {}) => {
    const token = opts.token === undefined ? 'good' : opts.token;
    const res = await handleSourceAudio(new Request(`https://next.langquest.org/api/source-audio?url=${encodeURIComponent(link)}`, {
      method: opts.method ?? 'GET', headers: token ? { authorization: `Bearer ${token}` } : {}
    }), deps);
    return { status: res.status, text: await res.text(), headers: res.headers };
  };
  return { asked, call };
}

describe('the source audio route', () => {
  it('passes a library source\'s chapter on as it comes, and asks nothing to keep it', async () => {
    const { asked, call } = setup();
    const res = await call(LINK);
    expect(res.status).toBe(200);
    expect(res.text).toBe('mp3');
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('content-length')).toBe('3');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(asked).toEqual([LINK]);
  });

  it('is for people signed in, GET only', async () => {
    const { asked, call } = setup();
    expect((await call(LINK, { token: null })).status).toBe(401);
    expect((await call(LINK, { token: 'forged' })).status).toBe(401);
    expect((await call(LINK, { method: 'POST' })).status).toBe(405);
    expect(asked).toEqual([]);
  });

  it('fetches nothing from any other host, scheme or port', async () => {
    const { asked, call } = setup();
    for (const link of ['https://example.com/a.mp3', 'http://openbible.com/a.mp3', 'https://openbible.com.evil.example/a.mp3', 'https://openbible.com:444/a.mp3', '']) {
      expect((await call(link)).status).toBe(404);
    }
    expect(asked).toEqual([]);
  });

  it('says 404 for a missing file, and 502 when the host fails or answers with something that is not audio', async () => {
    expect((await setup(() => new Response('gone', { status: 404 })).call(LINK)).status).toBe(404);
    expect((await setup(() => new Response('busy', { status: 503 })).call(LINK)).status).toBe(502);
    expect((await setup(() => new Response('<html>', { headers: { 'content-type': 'text/html' } })).call(LINK)).status).toBe(502);
    expect((await setup(() => { throw new TypeError('fetch failed'); }).call(LINK)).status).toBe(502);
  });

  it('is reached at /api/source-audio through the API router', async () => {
    const deps: ApiDeps = { profileOf: async () => null, reports: async () => null };
    const res = await handleApi(new Request(`https://next.langquest.org/api/source-audio?url=${encodeURIComponent(LINK)}`), deps);
    expect(res.status).toBe(401);
  });
});
