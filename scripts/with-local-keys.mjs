#!/usr/bin/env node
// Runs a command with the local Supabase's keys in SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY, read from `supabase status`:
//
//   node scripts/with-local-keys.mjs tsx server/snapshotWorker.ts
//
// A key already in the environment is kept, so the same command runs
// against a hosted project when its keys are exported first. The keys are
// passed to the command only, never printed.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const command = process.argv.slice(2);
if (!command.length) {
  console.error('usage: node scripts/with-local-keys.mjs <command> [args…]');
  process.exit(2);
}

const env = { ...process.env };
if (!env.SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) {
  const r = spawnSync('npx', ['supabase', 'status', '-o', 'json'], { cwd: root, encoding: 'utf8' });
  const json = r.stdout.slice(r.stdout.indexOf('{'));
  if (r.status !== 0 || !json.startsWith('{')) {
    console.error('x The local Supabase is not running (npm run db:start), and SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are not set');
    process.exit(1);
  }
  const status = JSON.parse(json);
  env.SUPABASE_ANON_KEY ||= status.ANON_KEY;
  env.SUPABASE_SERVICE_ROLE_KEY ||= status.SERVICE_ROLE_KEY;
}

const run = spawnSync(command[0], command.slice(1), { cwd: process.cwd(), env, stdio: 'inherit' });
process.exit(run.status ?? 1);
