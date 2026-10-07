#!/usr/bin/env node
// The server's checks on a fresh local database (`npm run db:test`, and CI):
//
//   node scripts/db-test.mjs            reset, every smoke, then the parity check
//   node scripts/db-test.mjs --parity   the parity check alone, on the database as it is
//
// It resets with `supabase db reset` directly, not `npm run db:reset`, so no
// projection worker pass runs under the smokes (they count snapshots and
// Inbox rows; scripts/local-db.mjs). The parity check holds the SQL
// validate_payload, event_privilege and language_of_org_event to core for
// every event type (scripts/record-parity-sql.ts).
//
// server/accountSmoke.sql is not here: it runs against a populated database
// and rolls itself back (server/README.md).
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const DB = 'supabase_db_langquest-next';

/** In order: each starts from what the ones before it left. */
const SMOKES = [
  'server/smoke.sql',
  'server/library-smoke.sql',
  'server/diag-smoke.sql',
  'server/delete-account-smoke.sql',
  'server/moderation-smoke.sql',
  'server/inviteKeysSmoke.sql',
  'server/joinSmoke.sql'
];

function run(cmd, args, input) {
  const r = spawnSync(cmd, args, { cwd: root, input, stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'] });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`);
}

const psql = (sql, quiet = false) =>
  run('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', ...(quiet ? ['-q'] : [])], sql);

function parity() {
  const file = join(root, '.record-parity.sql');
  try {
    run('npx', ['tsx', 'scripts/record-parity-sql.ts', file]);
    psql(readFileSync(file), true);
  } finally {
    rmSync(file, { force: true });
  }
}

try {
  if (!process.argv.includes('--parity')) {
    run('npx', ['supabase', 'db', 'reset']);
    for (const smoke of SMOKES) {
      console.log(`→ ${smoke}`);
      psql(readFileSync(join(root, smoke)));
    }
  }
  console.log('→ parity with core');
  parity();
} catch (err) {
  console.error(`x ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
