/**
 * Blob reconciler CLI. Lists the bucket independently of the storage trigger.
 *   npm run reconcile            confirms unconfirmed objects
 *   npm run reconcile -- --verify also hashes every object (downloads all bytes)
 * Run confirm-only often (it is cheap), verify on a schedule you can afford.
 */
import { createClient } from '@supabase/supabase-js';
import { runBlobReconciler } from '@langquest-next/client';

const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}
const verify = process.argv.includes('--verify');
const report = await runBlobReconciler(createClient(url, key, { auth: { persistSession: false } }), { verify });
console.log(JSON.stringify(report));
