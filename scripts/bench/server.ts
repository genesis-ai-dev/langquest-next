/**
 * Runs scripts/bench/server.sql against the local database and prints what
 * it measured (performance-audit.md section 2.5). The SQL runs in one
 * transaction that is rolled back, so nothing is left behind. Needs the
 * local Supabase running (`npm run db:start`).
 *
 *   npm run bench:server
 *   npm run bench:server -- --json=/tmp/server.json
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DB = 'supabase_db_langquest-next';
const sql = readFileSync(fileURLToPath(new URL('./server.sql', import.meta.url)), 'utf8');
const run = spawnSync('docker', ['exec', '-i', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-q'], { input: sql, encoding: 'utf8' });
if (run.status !== 0 || /ERROR/.test(run.stderr)) {
  console.error(run.stderr || run.stdout || `docker exec failed (${run.error?.message ?? run.status}); is the local database running?`);
  process.exit(1);
}
const results = [...run.stderr.matchAll(/NOTICE:\s+bench (\{.*\})/g)].map((m) => JSON.parse(m[1]!) as { measure: string; ms: number | number[] } & Record<string, unknown>);
for (const r of results) {
  const { measure, ms, ...rest } = r;
  const times = Array.isArray(ms) ? `${ms.join(', ')} ms` : `${ms} ms`;
  console.log(`${measure.padEnd(42)} ${times}${Object.keys(rest).length ? `  ${JSON.stringify(rest)}` : ''}`);
}
const out = process.argv.find((a) => a.startsWith('--json='))?.slice(7);
if (out) writeFileSync(out, JSON.stringify(results, null, 2));
