/**
 * One copy of the Supabase Storage "blobs" bucket into R2 (decisions.md 69).
 *
 *   npm run blobs:copy                 copy what R2 does not have yet; safe to run again
 *   npm run blobs:copy -- --dry-run    count only
 *   npm run blobs:copy -- --remove     then empty and delete the old bucket, once nothing failed
 *
 * Each file goes through the Worker with the service key, so R2 checks it
 * against its name and the Worker records it (record_blob is idempotent by
 * hash and size, so a file already confirmed gets no second event). A file
 * whose bytes do not match its name, or whose name is not a hash, is not
 * copied: it is listed, and the reconciler's verdict on it stands. Keys are unchanged, so every
 * v1.BlobStored already in the log still names the right file.
 *
 * Hosted, export SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and API_URL (the
 * environment's Worker) first; locally the defaults are the local stack and
 * `npm run web:dev`.
 */
import { createClient } from '@supabase/supabase-js';
import { workerBlobs } from '@langquest-next/client';

const BUCKET = 'blobs';
/** The only names the Worker serves (apps/web/worker/blobs.ts): anything else could never be read again. */
const HASH_NAME = /^[0-9a-f]{64}\.[a-z0-9]+$/;
const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
const apiUrl = process.env['API_URL'] ?? 'http://127.0.0.1:8787';
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}
const dryRun = process.argv.includes('--dry-run');
const remove = process.argv.includes('--remove');

const service = createClient(url, key, { auth: { persistSession: false } });
const storage = service.storage.from(BUCKET);
const r2 = workerBlobs(apiUrl, key);

/** One level of the bucket: folders have no id. */
async function entries(prefix: string): Promise<{ name: string; folder: boolean; size: number }[]> {
  const out: { name: string; folder: boolean; size: number }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await storage.list(prefix, { limit: 1000, offset });
    if (error) throw new Error(`list ${prefix || '/'}: ${error.message}`);
    for (const f of data ?? []) out.push({ name: f.name, folder: !f.id, size: Number((f.metadata as { size?: number } | null)?.size ?? 0) });
    if (!data || data.length < 1000) return out;
  }
}

const { data: buckets, error: bucketError } = await service.storage.listBuckets();
if (bucketError) throw new Error(`list buckets: ${bucketError.message}`);
if (!buckets?.some((b) => b.id === BUCKET)) {
  console.log(`no "${BUCKET}" bucket: nothing to copy`);
  process.exit(0);
}

const report = { files: 0, alreadyInR2: 0, copied: 0, mismatched: [] as string[], failed: [] as string[], removed: 0 };
const done: string[] = [];
for (const org of (await entries('')).filter((e) => e.folder)) {
  for (const stream of (await entries(org.name)).filter((e) => e.folder)) {
    const prefix = `${org.name}/${stream.name}`;
    const inR2 = new Map((await r2.list(`${prefix}/`)).map((o) => [o.key, o.size]));
    for (const file of (await entries(prefix)).filter((e) => !e.folder)) {
      const name = `${prefix}/${file.name}`;
      report.files += 1;
      if (inR2.get(name) === file.size) {
        report.alreadyInR2 += 1;
        done.push(name);
        continue;
      }
      if (!HASH_NAME.test(file.name)) {
        report.mismatched.push(name);
        continue;
      }
      if (dryRun) continue;
      const { data, error } = await storage.download(name);
      if (error || !data) {
        report.failed.push(`${name}: ${error?.message ?? 'no data'}`);
        continue;
      }
      try {
        await r2.put(name, new Uint8Array(await data.arrayBuffer()));
        report.copied += 1;
        done.push(name);
      } catch (e) {
        const message = (e as Error).message;
        // 422: the bytes do not hash to the name (or the name is not a hash). Not worth keeping.
        if (/\((404|422)\)/.test(message)) report.mismatched.push(name);
        else report.failed.push(`${name}: ${message}`);
      }
    }
  }
}

if (remove && !dryRun) {
  if (report.failed.length) {
    console.error(`x ${report.failed.length} files failed to copy; the old bucket is kept. Run again.`);
  } else {
    for (let i = 0; i < done.length; i += 100) {
      const { error } = await storage.remove(done.slice(i, i + 100));
      if (error) throw new Error(`remove: ${error.message}`);
      report.removed += Math.min(100, done.length - i);
    }
    // What is left would not copy; it hashes wrong, so nobody can use it.
    if (report.mismatched.length) {
      const { error } = await storage.remove(report.mismatched);
      if (error) throw new Error(`remove mismatched: ${error.message}`);
      report.removed += report.mismatched.length;
    }
    const { error } = await service.storage.deleteBucket(BUCKET);
    if (error) throw new Error(`delete bucket: ${error.message}`);
    console.log(`the "${BUCKET}" bucket is gone`);
  }
}

console.log(JSON.stringify(report, null, 1));
if (report.failed.length) process.exit(1);
