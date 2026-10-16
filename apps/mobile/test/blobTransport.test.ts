/**
 * The app's side of the Worker's file routes (apps/web/worker/blobs.ts,
 * decisions.md 69): the method, address and token each platform sends.
 * The Worker answers anything but PUT with 405, which the uploader takes
 * as a refusal, so a wrong method silently strands every recording.
 */
const env = vi.hoisted(() => ({
  platform: { OS: 'web' as string },
  uploads: [] as { url: string; options: Record<string, unknown> }[],
  tallied: [] as { dir: string; where: Record<string, string>; failed: boolean }[]
}));

vi.mock('react-native', () => ({ Platform: env.platform }));
vi.mock('../src/server/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } }, error: null }) } }
}));
vi.mock('expo-file-system', () => ({ File: class {}, UploadType: { BINARY_CONTENT: 0 } }));
// The diagnostics recorder, with its tally seen here: what streamed play counts.
vi.mock('../src/diagnostics/diagnostics', () => ({
  timedTransfer: async (dir: string, where: Record<string, string>, run: (t: object) => Promise<unknown>) => {
    try { const r = await run({}); env.tallied.push({ dir, where, failed: false }); return r; }
    catch (e) { env.tallied.push({ dir, where, failed: true }); throw e; }
  }
}));
vi.mock('../src/sync/blobs', () => ({
  mimeOf: () => 'audio/wav',
  BlobStore: { hashOf: async () => 'h'.repeat(64) }
}));

const HASH = 'a'.repeat(64);
const ref = { hash: HASH, format: 'wav' as const };
const store = {
  rechecks: 0,
  exists: true,
  readBytes: async (): Promise<Uint8Array | null> => new Uint8Array([1, 2, 3]),
  recheck() { this.rechecks++; },
  fileFor: () => ({
    exists: store.exists,
    upload: async (url: string, options: Record<string, unknown>) => { env.uploads.push({ url, options }); return { status: 200, body: '{}' }; }
  })
};

async function load(os: string) {
  env.platform.OS = os;
  vi.resetModules();
  return import('../src/server/blobTransport');
}

describe('blob transport', () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  beforeEach(() => {
    calls.length = 0;
    env.uploads.length = 0;
    env.tallied.length = 0;
    vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://next.example/');
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/api/blob-urls/')) return new Response(JSON.stringify({ path: `/api/blobs/o/L1/${HASH}.wav?expires=1&sig=s`, expiresAt: 1 }));
      return new Response('{}');
    });
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('the web uploads with PUT to the Worker, with the person\'s token', async () => {
    const { uploadBlob } = await load('web');
    await uploadBlob('o', 'L1', ref, store as never);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`https://next.example/api/blobs/o/L1/${HASH}.wav`);
    expect(calls[0]!.init?.method).toBe('PUT');
    expect((calls[0]!.init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
  });

  it('a phone uploads the file natively with PUT to the same address', async () => {
    const { uploadBlob } = await load('ios');
    await uploadBlob('o', 'L1', ref, store as never);
    expect(env.uploads).toHaveLength(1);
    expect(env.uploads[0]!.url).toBe(`https://next.example/api/blobs/o/L1/${HASH}.wav`);
    expect(env.uploads[0]!.options['httpMethod']).toBe('PUT');
  });

  it('a recording gone from the disk is not sent, and the store looks for others gone with it (decisions.md 92)', async () => {
    const { uploadBlob } = await load('ios');
    store.exists = false;
    store.rechecks = 0;
    try {
      await expect(uploadBlob('o', 'L1', ref, store as never)).rejects.toThrow(/gone from this device/);
    } finally {
      store.exists = true;
    }
    expect(env.uploads).toHaveLength(0);
    expect(store.rechecks).toBe(1);
    const web = await load('web');
    const readBytes = store.readBytes;
    store.readBytes = async () => null;
    try {
      await expect(web.uploadBlob('o', 'L1', ref, store as never)).rejects.toThrow(/no bytes/);
    } finally {
      store.readBytes = readBytes;
    }
    expect(store.rechecks).toBe(2);
  });

  it('a read link is the Worker\'s signed path on the Worker\'s address', async () => {
    const { streamUrl } = await load('ios');
    expect(await streamUrl('o', 'L1', ref)).toBe(`https://next.example/api/blobs/o/L1/${HASH}.wav?expires=1&sig=s`);
    expect(calls[0]!.url).toBe(`https://next.example/api/blob-urls/o/L1/${HASH}.wav`);
  });

  it('a link to play from is tallied as a stream transfer of its language; a download\'s own link is not', async () => {
    const { streamUrl, downloadBlob } = await load('web');
    await streamUrl('o', 'L1', ref);
    expect(env.tallied).toEqual([{ dir: 'down', where: { orgId: 'o', streamId: 'L1', src: 'stream' }, failed: false }]);
    vi.stubGlobal('fetch', async () => new Response('no', { status: 403 }));
    await expect(streamUrl('o', 'L1', ref)).rejects.toThrow(/\(403\)/);
    expect(env.tallied[1]).toEqual({ dir: 'down', where: { orgId: 'o', streamId: 'L1', src: 'stream' }, failed: true });
    await expect(downloadBlob('o', 'L1', ref, store as never)).rejects.toThrow();
    expect(env.tallied).toHaveLength(2);
  });

  it('a refusal is a refusal, and a server fault is worth retrying', async () => {
    const { UploadError } = await load('web');
    expect(new UploadError(405, '').refused).toBe(true);
    expect(new UploadError(422, '').refused).toBe(true);
    expect(new UploadError(502, '').refused).toBe(false);
  });
});
