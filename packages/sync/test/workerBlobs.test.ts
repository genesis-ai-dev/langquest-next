import { afterEach, vi } from 'vitest';
import { blobKey, BLOB_WAITS_MS, workerBlobs } from '../src/workerBlobs';

/** The Worker's file routes, answered by a scripted fetch. */
function script(...replies: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = replies.shift();
    if (!next) throw new Error('no reply scripted');
    if (next instanceof Error) throw next;
    return next;
  });
  return calls;
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
/** One reply for each try a request makes before it fails for good. */
const everyTry = (reply: () => Response | Error) => Array.from({ length: BLOB_WAITS_MS.length + 1 }, reply);

afterEach(() => vi.unstubAllGlobals());

describe('workerBlobs (the server-side view of the file store)', () => {
  const files = () => workerBlobs('http://127.0.0.1:8787/', 'tok');
  const waited: number[] = [];
  /** A client whose waits are recorded, not slept. */
  const patient = () => workerBlobs('http://127.0.0.1:8787/', 'tok', { wait: async (ms) => { waited.push(ms); } });
  afterEach(() => { waited.length = 0; });

  it('names a file org/stream/hash.format', () => {
    expect(blobKey('o', 's', 'h', 'wav')).toBe('o/s/h.wav');
  });

  it('get sends the token and returns the bytes, with each key part encoded', async () => {
    const calls = script(new Response(new Uint8Array([1, 2, 3])));
    expect([...(await files().get('org 1/s/h.wav'))]).toEqual([1, 2, 3]);
    expect(calls[0]!.url).toBe('http://127.0.0.1:8787/api/blobs/org%201/s/h.wav');
    expect(calls[0]!.init?.headers).toEqual({ authorization: 'Bearer tok' });
  });

  it('a 401 is an error naming the file and the status', async () => {
    script(new Response('bad token', { status: 401 }));
    await expect(files().get('o/s/h.wav')).rejects.toThrow('download o/s/h.wav (401): bad token');
  });

  it('a 500 that does not pass carries the server message, cut at 200 characters', async () => {
    script(...everyTry(() => new Response('x'.repeat(500), { status: 500 })));
    const err = await patient().put('o/s/h.wav', new Uint8Array([1])).catch((e: Error) => e);
    expect((err as Error).message).toBe(`upload o/s/h.wav (500): ${'x'.repeat(200)}`);
  });

  it('a network failure that does not pass surfaces as the fetch error', async () => {
    script(...everyTry(() => new TypeError('fetch failed')));
    await expect(patient().get('o/s/h.wav')).rejects.toThrow('fetch failed');
  });

  it('put uploads the bytes with PUT', async () => {
    const calls = script(new Response(null, { status: 200 }));
    await files().put('o/s/h.wav', new Uint8Array([9]));
    expect(calls[0]!.init?.method).toBe('PUT');
  });

  it('remove treats an already-missing file as removed, and any other failure as an error', async () => {
    script(new Response(null, { status: 404 }));
    await expect(files().remove('o/s/h.wav')).resolves.toBeUndefined();
    script(new Response('no', { status: 403 }));
    await expect(files().remove('o/s/h.wav')).rejects.toThrow('remove o/s/h.wav (403)');
  });

  it('list follows the cursor to the last page', async () => {
    const calls = script(
      json({ objects: [{ key: 'o/s/a.wav', size: 1 }], cursor: 'c1' }),
      json({ objects: [{ key: 'o/s/b.wav', size: 2 }], cursor: null })
    );
    expect(await files().list('o/s/')).toEqual([{ key: 'o/s/a.wav', size: 1 }, { key: 'o/s/b.wav', size: 2 }]);
    expect(calls[0]!.url).toBe('http://127.0.0.1:8787/api/blobs?prefix=o%2Fs%2F');
    expect(calls[1]!.url).toContain('cursor=c1');
  });

  describe('a list page that fails for a moment (LAN-298: at most about two minutes)', () => {
    it('is asked for again, and only that page: the pages before it are not listed again', async () => {
      const calls = script(
        json({ objects: [{ key: 'o/s/a.wav', size: 1 }], cursor: 'c1' }),
        new Response('{"error":"Files are not available just now. Try again."}', { status: 502 }),
        new TypeError('fetch failed'),
        json({ objects: [{ key: 'o/s/b.wav', size: 2 }], cursor: null })
      );
      expect(await patient().list('o/s/')).toEqual([{ key: 'o/s/a.wav', size: 1 }, { key: 'o/s/b.wav', size: 2 }]);
      expect(calls.map((c) => c.url.includes('cursor=c1'))).toEqual([false, true, true, true]);
      expect(waited).toEqual([BLOB_WAITS_MS[0], BLOB_WAITS_MS[1]]);
    });

    it('waits about three minutes in all before the listing fails', async () => {
      const tries = BLOB_WAITS_MS.length + 1;
      const calls = script(json({ objects: [], cursor: 'c1' }), ...everyTry(() => new Response('down', { status: 502 })));
      await expect(patient().list('o/s/')).rejects.toThrow('list o/s/ (502): down');
      expect(calls).toHaveLength(1 + tries);
      expect(waited).toEqual([...BLOB_WAITS_MS]);
      const total = waited.reduce((a, b) => a + b, 0);
      expect(total).toBeGreaterThanOrEqual(150_000);
      expect(total).toBeLessThanOrEqual(240_000);
    });

    it('is not asked for again when the Worker refuses it (a 4xx)', async () => {
      const calls = script(new Response('bad token', { status: 401 }));
      await expect(patient().list('o/s/')).rejects.toThrow('list o/s/ (401): bad token');
      expect(calls).toHaveLength(1);
      expect(waited).toEqual([]);
    });
  });

  describe('a file request that fails for a moment (LAN-345: one failed read ended a whole export)', () => {
    const passing = () => [
      new Response('{"error":"Files are not available just now. Try again."}', { status: 502 }),
      new TypeError('fetch failed'),
      new Response('slow down', { status: 429 })
    ];

    it('get asks for the file again and returns its bytes', async () => {
      const calls = script(...passing(), new Response(new Uint8Array([4, 5])));
      expect([...(await patient().get('o/s/h.wav'))]).toEqual([4, 5]);
      expect(calls.map((c) => c.url)).toEqual(Array(4).fill('http://127.0.0.1:8787/api/blobs/o/s/h.wav'));
      expect(waited).toEqual(BLOB_WAITS_MS.slice(0, 3));
    });

    it('put sends the same bytes again, with the token, until the Worker stores them', async () => {
      const bytes = new Uint8Array([7, 8]);
      const calls = script(...passing(), new Response('{}', { status: 200 }));
      await patient().put('o/s/h.wav', bytes);
      expect(calls).toHaveLength(4);
      for (const c of calls) expect(c.init).toMatchObject({ method: 'PUT', body: bytes, headers: { authorization: 'Bearer tok' } });
    });

    it('remove asks again, and a file already gone on the next try counts as removed', async () => {
      const calls = script(new Response('down', { status: 503 }), new Response(null, { status: 404 }));
      await expect(patient().remove('o/s/h.wav')).resolves.toBeUndefined();
      expect(calls.map((c) => c.init?.method)).toEqual(['DELETE', 'DELETE']);
    });

    it('is not asked again when the Worker refuses it (a 4xx), so a missing file is still one 404', async () => {
      const calls = script(new Response('{"error":"Not stored."}', { status: 404 }), new Response('no', { status: 403 }));
      await expect(patient().get('o/s/h.wav')).rejects.toThrow('download o/s/h.wav (404)');
      await expect(patient().put('o/s/h.wav', new Uint8Array([1]))).rejects.toThrow('upload o/s/h.wav (403)');
      expect(calls).toHaveLength(2);
      expect(waited).toEqual([]);
    });

    it('fails after about three minutes when the failure does not pass', async () => {
      const calls = script(...everyTry(() => new Response('down', { status: 500 })));
      await expect(patient().get('o/s/h.wav')).rejects.toThrow('download o/s/h.wav (500): down');
      expect(calls).toHaveLength(BLOB_WAITS_MS.length + 1);
      expect(waited).toEqual([...BLOB_WAITS_MS]);
    });
  });
});
