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
vi.mock('../src/storage/storedFile', () => ({
  mimeOf: () => 'audio/wav',
  hashOf: async () => 'h'.repeat(64)
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

  describe('a web download on a connection that died (LAN-343)', () => {
    // Why: the web read a recording with a bare fetch. On a connection that
    // died without an error the download never ended, and the transfers held
    // the language's later downloads until the tab was reloaded.
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const kept: number[] = [];
    const web = { ...store, putVerified: async (_ref: unknown, bytes: Uint8Array) => { kept.push(bytes.byteLength); } };
    /** The hash the faked hashOf gives, so a whole download is kept. */
    const whole = { hash: 'h'.repeat(64), format: 'wav' as const };

    /** The Worker: the link at once, then the file's headers at once and `body` as it comes. */
    function serve(body: () => ReadableStream<Uint8Array>, heard: { stopped: boolean }) {
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (url.includes('/api/blob-urls/')) return new Response(JSON.stringify({ path: `/api/blobs/o/L1/${HASH}.wav?expires=1&sig=s` }));
        init?.signal?.addEventListener('abort', () => { heard.stopped = true; });
        return new Response(body());
      });
    }
    /** One piece of the file, then nothing more, and no error. */
    const stalls = () => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1])); } });

    it('a download whose body stops coming fails as offline in time, and is stopped', async () => {
      const { downloadBlob } = await load('web');
      const { ANSWER_WITHIN_MS, NO_ANSWER } = await import('../src/server/sessionSafeFetch');
      const heard = { stopped: false };
      serve(stalls, heard);
      const outcome = downloadBlob('o', 'L1', whole, web as never).then(() => 'kept', (e: unknown) => e);
      await vi.advanceTimersByTimeAsync(ANSWER_WITHIN_MS - 1000);
      expect(await Promise.race([outcome, Promise.resolve('waiting')])).toBe('waiting');
      await vi.advanceTimersByTimeAsync(1000);
      expect(String(await outcome)).toContain(NO_ANSWER);
      expect(heard.stopped).toBe(true);
    });

    it('a slow download that keeps sending finishes, however long the whole file takes', async () => {
      const { downloadBlob } = await load('web');
      const { ANSWER_WITHIN_MS } = await import('../src/server/sessionSafeFetch');
      const heard = { stopped: false };
      kept.length = 0;
      // Five pieces, each 90 seconds after the last: 7.5 minutes for the file, never 2 minutes without a byte.
      serve(() => {
        let sent = 0;
        return new ReadableStream<Uint8Array>({
          async pull(c) {
            await new Promise((r) => setTimeout(r, 90_000));
            if (sent++ < 5) c.enqueue(new Uint8Array(10));
            else c.close();
          }
        });
      }, heard);
      const outcome = downloadBlob('o', 'L1', whole, web as never).then(() => 'kept', (e: unknown) => e);
      await vi.advanceTimersByTimeAsync(6 * 90_000 + ANSWER_WITHIN_MS);
      expect(await outcome).toBe('kept');
      expect(kept).toEqual([50]);
      expect(heard.stopped).toBe(false);
    });

    it('when the network goes or comes back, a download still out is stopped at once', async () => {
      const { downloadBlob } = await load('web');
      const { NETWORK_CHANGED, stopRequestsInFlight } = await import('../src/server/sessionSafeFetch');
      const heard = { stopped: false };
      serve(stalls, heard);
      const outcome = downloadBlob('o', 'L1', whole, web as never).then(() => 'kept', (e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1000);
      expect(stopRequestsInFlight()).toBe(1);
      expect(String(await outcome)).toContain(NETWORK_CHANGED);
      expect(heard.stopped).toBe(true);
    });

    it('a download that is refused or finished leaves nothing out to stop', async () => {
      const { downloadBlob } = await load('web');
      const { stopRequestsInFlight } = await import('../src/server/sessionSafeFetch');
      vi.stubGlobal('fetch', async (url: string) => (url.includes('/api/blob-urls/')
        ? new Response(JSON.stringify({ path: `/api/blobs/o/L1/${HASH}.wav?expires=1&sig=s` }))
        : new Response('gone', { status: 404 })));
      await expect(downloadBlob('o', 'L1', whole, web as never)).rejects.toThrow('Download failed (404)');
      expect(stopRequestsInFlight()).toBe(0);
      serve(() => new Response('abc').body!, { stopped: false });
      await downloadBlob('o', 'L1', whole, web as never);
      expect(stopRequestsInFlight()).toBe(0);
    });
  });

  it('a refusal is a refusal, and a server fault is worth retrying', async () => {
    const { UploadError } = await load('web');
    expect(new UploadError(405, '').refused).toBe(true);
    expect(new UploadError(422, '').refused).toBe(true);
    expect(new UploadError(502, '').refused).toBe(false);
  });
});
