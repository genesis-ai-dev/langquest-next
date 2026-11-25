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
 * How long a listing waits before it asks for a failed page again: about three minutes in all, longer
 * than the list failures seen in production (LAN-298: at most about two minutes).
 */
export const LIST_WAITS_MS = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000] as const;

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
  // One page of a listing, asked again while it fails for a moment (LAN-298): a list page failed
  // 66 times from October to November 2026, at most about two minutes at a time, and each failure
  // stopped a whole v2 project's transfer. Only that page is asked again, not the pages before it,
  // which each cost a class A operation.
  const listPage = async (url: string, prefix: string) => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: auth }).catch((e: unknown) => {
        if (attempt >= LIST_WAITS_MS.length) throw e;
        return null;
      });
      if (res?.ok) return (await res.json()) as { objects: { key: string; size: number }[]; cursor: string | null };
      if (res && (!mayWorkAgain(res.status) || attempt >= LIST_WAITS_MS.length)) throw await fail(`list ${prefix}`, res);
      if (res) await res.body?.cancel();
      await wait(LIST_WAITS_MS[attempt]!);
    }
  };
  return {
    async list(prefix) {
      const out: { key: string; size: number }[] = [];
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ prefix, ...(cursor ? { cursor } : {}) });
        const page = await listPage(`${base}/api/blobs?${query}`, prefix);
        out.push(...page.objects);
        cursor = page.cursor;
      } while (cursor);
      return out;
    },
    async get(key) {
      const res = await fetch(path(key), { headers: auth });
      if (!res.ok) throw await fail(`download ${key}`, res);
      return new Uint8Array(await res.arrayBuffer());
    },
    async put(key, bytes) {
      const res = await fetch(path(key), { method: 'PUT', headers: auth, body: bytes as BodyInit });
      if (!res.ok) throw await fail(`upload ${key}`, res);
    },
    async remove(key) {
      const res = await fetch(path(key), { method: 'DELETE', headers: auth });
      if (!res.ok && res.status !== 404) throw await fail(`remove ${key}`, res);
    }
  };
}
