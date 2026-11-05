import { afterEach, vi } from 'vitest';
import { blobKey, workerBlobs } from '../src/workerBlobs';

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

afterEach(() => vi.unstubAllGlobals());

describe('workerBlobs (the server-side view of the file store)', () => {
  const files = () => workerBlobs('http://127.0.0.1:8787/', 'tok');

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

  it('a 500 carries the server message, cut at 200 characters', async () => {
    script(new Response('x'.repeat(500), { status: 500 }));
    const err = await files().put('o/s/h.wav', new Uint8Array([1])).catch((e: Error) => e);
    expect((err as Error).message).toBe(`upload o/s/h.wav (500): ${'x'.repeat(200)}`);
  });

  it('a network failure surfaces as the fetch error', async () => {
    script(new TypeError('fetch failed'));
    await expect(files().get('o/s/h.wav')).rejects.toThrow('fetch failed');
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

  it('a failed list page fails the whole listing', async () => {
    script(json({ objects: [], cursor: 'c1' }), new Response('down', { status: 502 }));
    await expect(files().list('o/s/')).rejects.toThrow('list o/s/ (502): down');
  });
});
