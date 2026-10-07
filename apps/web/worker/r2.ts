import { BadDigest, type BlobBucket } from './blobs';

/** R2's code for bytes that do not match the checksum they were sent with. */
const BAD_DIGEST = /\(10037\)|did not match what we received/i;

/** The R2 binding as blobs.ts uses it. */
export function r2Bucket(r2: R2Bucket): BlobBucket {
  return {
    async get(key, range) {
      const object = await r2.get(key, range ? { range } : {});
      return object ? { size: object.size, body: object.body } : null;
    },
    async head(key) {
      const object = await r2.head(key);
      return object ? { size: object.size } : null;
    },
    async put(key, body, length, sha256, contentType) {
      // R2 needs to know a stream's length up front.
      const value = body instanceof Uint8Array ? body : body.pipeThrough(new FixedLengthStream(length));
      try {
        const object = await r2.put(key, value, { sha256, httpMetadata: { contentType } });
        if (!object) throw new Error('R2 stored nothing');
        return { size: object.size };
      } catch (e) {
        if (BAD_DIGEST.test(String((e as Error).message))) throw new BadDigest((e as Error).message);
        throw e;
      }
    },
    async delete(key) {
      await r2.delete(key);
    },
    async list(prefix, cursor) {
      const page = await r2.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
      return { objects: page.objects.map((o) => ({ key: o.key, size: o.size })), ...(page.truncated ? { cursor: page.cursor } : {}) };
    }
  };
}
