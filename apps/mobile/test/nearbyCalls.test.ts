/**
 * The app's side of the Worker's nearby routes (src/server/nearby.ts, apps/web/worker/nearby.ts):
 * the address, method, token and body each sends, and what each status means to the phone.
 * Each test loads the module afresh, so errors are matched by name (sync's classes load again too).
 */

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('../src/server/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } }, error: null }) } }
}));

const calls: { url: string; init: RequestInit | undefined }[] = [];
let reply: () => Response | Promise<Response> = () => new Response('null');

async function load() {
  vi.resetModules();
  return import('../src/server/nearby');
}

beforeEach(() => {
  calls.length = 0;
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://next.example/');
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => { calls.push({ url, init }); return reply(); });
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const request = { publicKey: 'pk', deviceId: 'd', languages: ['o1/L1'], proof: 'p' };

describe('the certificate call', () => {
  it('posts the request with the bearer token, and hands back the answer', async () => {
    const { requestCertificate } = await load();
    reply = () => new Response(JSON.stringify({ revoked: true }));
    expect(await requestCertificate(request)).toEqual({ kind: 'answer', body: { revoked: true } });
    expect(calls[0]!.url).toBe('https://next.example/api/nearby/certificate');
    expect(calls[0]!.init?.method).toBe('POST');
    expect((calls[0]!.init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual(request);
  });

  it('429 and 503 are later; anything else throws with its status; no network is offline', async () => {
    const { requestCertificate, NearbyCallError } = await load();
    for (const status of [429, 503]) {
      reply = () => new Response('{}', { status });
      expect(await requestCertificate(request)).toEqual({ kind: 'later', status });
    }
    reply = () => new Response('{}', { status: 401 });
    await expect(requestCertificate(request)).rejects.toBeInstanceOf(NearbyCallError);
    reply = () => { throw new TypeError('Network request failed'); };
    await expect(requestCertificate(request)).rejects.toMatchObject({ name: 'OfflineError' });
  });

  it('a build with no Worker address cannot call', async () => {
    vi.stubEnv('EXPO_PUBLIC_API_URL', '');
    const { requestCertificate } = await load();
    await expect(requestCertificate(request)).rejects.toThrow(/EXPO_PUBLIC_API_URL/);
    expect(calls).toEqual([]);
  });
});

describe('the attestation call', () => {
  it('posts the stream and seq, and reads the signed text', async () => {
    const { attestPulled } = await load();
    reply = () => new Response(JSON.stringify({ text: '{"v":1}', kid: 'k1', sig: 's' }));
    expect(await attestPulled('o1', 'L1', 7)).toEqual({ text: '{"v":1}', kid: 'k1', sig: 's' });
    expect(calls[0]!.url).toBe('https://next.example/api/nearby/attest');
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({ orgId: 'o1', streamId: 'L1', afterSeq: 7 });
  });

  it('null while off or on 503, not authorized on 403, and a throw for anything it would not send', async () => {
    const { attestPulled, NearbyCallError } = await load();
    reply = () => new Response('null');
    expect(await attestPulled('o1', 'L1', 0)).toBeNull();
    reply = () => new Response('{}', { status: 503 });
    expect(await attestPulled('o1', 'L1', 0)).toBeNull();
    reply = () => new Response('{}', { status: 403 });
    await expect(attestPulled('o1', 'L1', 0)).rejects.toMatchObject({ name: 'NotAuthorizedError' });
    reply = () => new Response('{}', { status: 500 });
    await expect(attestPulled('o1', 'L1', 0)).rejects.toBeInstanceOf(NearbyCallError);
    reply = () => new Response(JSON.stringify({ text: 1, kid: 'k1', sig: 's' }));
    await expect(attestPulled('o1', 'L1', 0)).rejects.toBeInstanceOf(NearbyCallError);
  });

  it('is the transport\'s attest, beside the Supabase calls', async () => {
    vi.resetModules();
    const { supabaseTransport } = await import('../src/server/sync');
    const { attestPulled } = await import('../src/server/nearby');
    const transport = supabaseTransport();
    expect(transport.attest).toBe(attestPulled);
    expect(typeof transport.pull).toBe('function');
  });
});
