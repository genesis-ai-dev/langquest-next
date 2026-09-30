import { spawnSync } from 'node:child_process';

/**
 * The local Supabase that the seed scripts default to. Its keys come from
 * the environment when set (always, for a hosted project), else from
 * `supabase status`, so `npm run library:seed` and `npm run sample:org`
 * work against the local database with nothing to export first.
 */

export const LOCAL_URL = 'http://127.0.0.1:54421';

export const isLocalUrl = (url: string): boolean => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url);

let status: Record<string, string> | null = null;

function localStatus(): Record<string, string> {
  const r = spawnSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8' });
  const json = r.stdout.slice(r.stdout.indexOf('{'));
  if (r.status !== 0 || !json.startsWith('{')) {
    throw new Error('The local Supabase is not running (npm run db:start), and SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are not set');
  }
  return JSON.parse(json) as Record<string, string>;
}

export function supabaseKey(name: 'SUPABASE_ANON_KEY' | 'SUPABASE_SERVICE_ROLE_KEY', url: string): string {
  const set = process.env[name];
  if (set) return set;
  if (!isLocalUrl(url)) throw new Error(`${name} is not set; a hosted project needs its keys in the environment`);
  status ??= localStatus();
  const key = status[name === 'SUPABASE_ANON_KEY' ? 'ANON_KEY' : 'SERVICE_ROLE_KEY'];
  if (!key) throw new Error(`supabase status did not report ${name}`);
  return key;
}
