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
 * The Worker's file routes under one token: the service-role key for the
 * reconciler and imports, a person's access token to upload as them.
 * `apiUrl` is the Worker (`http://127.0.0.1:8787` locally, `npm run web:dev`).
 */
export function workerBlobs(apiUrl: string, token: string): BlobFiles {
  const base = apiUrl.replace(/\/$/, '');
  const auth = { authorization: `Bearer ${token}` };
  const path = (key: string) => `${base}/api/blobs/${key.split('/').map(encodeURIComponent).join('/')}`;
  const fail = async (what: string, res: Response) => new Error(`${what} (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return {
    async list(prefix) {
      const out: { key: string; size: number }[] = [];
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ prefix, ...(cursor ? { cursor } : {}) });
        const res = await fetch(`${base}/api/blobs?${query}`, { headers: auth });
        if (!res.ok) throw await fail(`list ${prefix}`, res);
        const page = (await res.json()) as { objects: { key: string; size: number }[]; cursor: string | null };
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
