/**
 * Download one partition's whole log the way a brand-new client does (pull_events,
 * pages of 500) and save it as JSONL for `bootstrap.ts` to replay offline.
 * Also reports the network phase: time, pages, and bytes on the wire.
 *
 *   BENCH_SUPABASE_URL=https://<ref>.supabase.co BENCH_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/bench/exportPartition.ts <orgId> <partitionId> <outDir>
 *
 * The output is real user data: write it outside the repo.
 */
import { createClient } from '@supabase/supabase-js';
import { SupabaseTransport } from '@langquest-next/client';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [orgId, partitionId, outDir] = process.argv.slice(2);
const url = process.env.BENCH_SUPABASE_URL;
const key = process.env.BENCH_SERVICE_ROLE_KEY;
if (!orgId || !partitionId || !outDir || !url || !key) {
  console.error('usage: BENCH_SUPABASE_URL=... BENCH_SERVICE_ROLE_KEY=... tsx scripts/bench/exportPartition.ts <orgId> <partitionId> <outDir>');
  process.exit(2);
}

const PAGE = 500; // SyncClient's default pullPageSize
const transport = new SupabaseTransport(createClient(url, key, { auth: { persistSession: false } }));
mkdirSync(outDir, { recursive: true });
const out = createWriteStream(join(outDir, `${partitionId}.jsonl`));

let after = 0;
let events = 0;
let bytes = 0;
let pages = 0;
let slowestPageMs = 0;
const started = performance.now();
for (;;) {
  const t = performance.now();
  const page = await transport.pull(orgId, partitionId, after, PAGE);
  slowestPageMs = Math.max(slowestPageMs, performance.now() - t);
  pages += 1;
  for (const e of page) {
    const line = JSON.stringify(e);
    bytes += Buffer.byteLength(line);
    out.write(line + '\n');
    after = Math.max(after, e.serverSeq ?? after);
  }
  events += page.length;
  if (pages % 50 === 0) console.error(`  ${events} events, ${(bytes / 1e6).toFixed(1)} MB`);
  if (page.length < PAGE) break;
}
await new Promise<void>((r) => out.end(r));
const networkMs = performance.now() - started;
const meta = { orgId, partitionId, events, pages, bytes, networkMs: Math.round(networkMs), slowestPageMs: Math.round(slowestPageMs), exportedAt: new Date().toISOString() };
writeFileSync(join(outDir, `${partitionId}.meta.json`), JSON.stringify(meta, null, 2));
console.log(JSON.stringify(meta));
