/**
 * The files a server-side script sees: recordings and guide media in R2,
 * reached through the app's Worker (apps/web/worker/blobs.ts, decisions.md
 * 69). The reconciler reads, lists and removes; imports and seeds upload.
 */
export interface BlobFiles {
  /** Every object whose key starts with `prefix`. */
  list(prefix: string): Promise<{ key: string; size: number }[]>;
  get(key: string): Promise<Uint8Array>;
  /** Store bytes under their key (`<org>/<stream>/<sha256>.<ext>`); the Worker confirms them. */
  put(key: string, bytes: Uint8Array): Promise<void>;
  remove(key: string): Promise<void>;
}

/** `<org>/<stream>/<hash>.<ext>`, the key every stored file has. */
export const blobKey = (orgId: string, streamId: string, hash: string, format: string) => `${orgId}/${streamId}/${hash}.${format}`;

/**
 * How long a request waits before it asks again after a failure that may pass: about three minutes
 * in all, longer than the failures seen in production (LAN-298: at most about two minutes). Every
 * request waits so (LAN-345): one failed read used to end a whole organization's export.
 */
export const BLOB_WAITS_MS = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000] as const;

/** A status that says the Worker or R2 failed for a moment, so the same request can work again. */
const mayWorkAgain = (status: number) => status === 429 || status >= 500;

/**
 * The Worker's file routes under one token: the service-role key for the
 * reconciler and imports, a person's access token to upload as them.
 * `apiUrl` is the Worker (`http://127.0.0.1:8787` locally, `npm run web:dev`).
 */
export function workerBlobs(apiUrl: string, token: string, opts: { wait?: (ms: number) => Promise<void> } = {}): BlobFiles {
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = apiUrl.replace(/\/$/, '');
  const auth = { authorization: `Bearer ${token}` };
  const path = (key: string) => `${base}/api/blobs/${key.split('/').map(encodeURIComponent).join('/')}`;
  const fail = async (what: string, res: Response) => new Error(`${what} (${res.status}): ${(await res.text()).slice(0, 200)}`);
  // One request, asked again while the Worker or R2 fails for a moment. A list page failed 66
  // times from October to November 2026, at most about two minutes at a time, and each failure
  // stopped a whole v2 project's transfer (LAN-298). A download that failed so ended a whole
  // organization's export, which can run for hours (LAN-345). Each request is safe to send again:
  // a file's name is its content, and removing a file twice removes it once. A listing asks only
  // for the failed page again, not the pages before it, which each cost a class A operation.
  const ask = async <T>(
    what: string,
    url: string,
    init: RequestInit,
    read: (res: Response) => Promise<T>,
    done: (res: Response) => boolean = (res) => res.ok
  ): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= BLOB_WAITS_MS.length;
      const res = await fetch(url, { ...init, headers: auth }).catch((e: unknown) => {
        if (last) throw e;
        return null;
      });
      if (res && done(res)) return read(res);
      if (res && (!mayWorkAgain(res.status) || last)) throw await fail(what, res);
      if (res) await res.body?.cancel();
      await wait(BLOB_WAITS_MS[attempt]!);
    }
  };
  const drop = async (res: Response) => {
    await res.body?.cancel();
  };
  return {
    async list(prefix) {
      const out: { key: string; size: number }[] = [];
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ prefix, ...(cursor ? { cursor } : {}) });
        const page = await ask(`list ${prefix}`, `${base}/api/blobs?${query}`, {}, async (res) =>
          (await res.json()) as { objects: { key: string; size: number }[]; cursor: string | null });
        out.push(...page.objects);
        cursor = page.cursor;
      } while (cursor);
      return out;
    },
    async get(key) {
      return ask(`download ${key}`, path(key), {}, async (res) => new Uint8Array(await res.arrayBuffer()));
    },
    async put(key, bytes) {
      await ask(`upload ${key}`, path(key), { method: 'PUT', body: bytes as BodyInit }, drop);
    },
    async remove(key) {
      await ask(`remove ${key}`, path(key), { method: 'DELETE' }, drop, (res) => res.ok || res.status === 404);
    }
  };
}
