/**
 * Snapshot worker CLI. Runs one pass over every partition.
 *   npm run snapshot            (local Supabase; key read from `supabase status`)
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx server/snapshotWorker.ts
 * Schedule it (cron, a Worker, pg_cron calling an HTTP endpoint) at whatever
 * lag coordinators can tolerate; translators never wait on it.
 */
import { createClient } from '@supabase/supabase-js';
import { runSnapshotWorker } from '@langquest-next/client';

const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}
const results = await runSnapshotWorker(createClient(url, key, { auth: { persistSession: false } }));
for (const r of results) console.log(`${r.orgId}/${r.projectId} seq=${r.serverSeq} ${r.updated ? 'updated' : 'unchanged'}`);
