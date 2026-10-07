/**
 * Blob reconciler CLI. Lists the files in R2 through the app's Worker,
 * independently of the confirmation each upload gets (decisions.md 17, 69).
 *   npm run reconcile            confirms unconfirmed objects
 *   npm run reconcile -- --verify also hashes every object (downloads all bytes)
 * Run confirm-only often (it is cheap), verify on a schedule you can afford.
 * Locally the Worker is `npm run web:dev`; hosted, export SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY and API_URL (the Worker, e.g. https://next.langquest.org).
 */
import { createClient } from '@supabase/supabase-js';
import { runBlobReconciler, workerBlobs } from '@langquest-next/client';

const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
const apiUrl = process.env['API_URL'] ?? 'http://127.0.0.1:8787';
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}
const verify = process.argv.includes('--verify');
const report = await runBlobReconciler(createClient(url, key, { auth: { persistSession: false } }), workerBlobs(apiUrl, key), { verify });
console.log(JSON.stringify(report));
