/**
 * The projection pass for large languages (decisions.md 103): the same work
 * as the Edge Function's pass (`server/projectionEdge.ts`), for the
 * languages too big for it, with Node's memory. The scheduled workflow
 * `.github/workflows/projections.yml` runs it every ten minutes.
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx server/projections.ts [--all]
 * `--all` covers every language that changed, small ones too, as the Edge
 * pass would. The repository is public, so it prints counts, never names.
 */
import { createClient } from '@supabase/supabase-js';
import { runProjections } from './projectionWorker';

const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}
const scope = process.argv.includes('--all') ? 'all' : 'large';
const started = Date.now();
const done = await runProjections(createClient(url, key, { auth: { persistSession: false } }), scope);
console.log(`${scope} languages: ${done.languages} projected, ${done.snapshots} new snapshots, ${Math.round((Date.now() - started) / 1000)} s`);
