import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Invariant 5 (PLAN.md section 4): status is derived, never stored. No
 * `status` or `approved` column anywhere; ask the reducer (passage.ts).
 * Like packages/sync/test/boundary.test.ts this reads source text, so a new
 * column or state field fails here before it reaches a review.
 */
const ROOT = join(__dirname, '../../..');
const STATUSY = /status|approved|verdict|^done$|^state$|^is_?(done|approved|complete)/i;

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules') return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path, ext) : ext.test(name) ? [path] : [];
  });
}

/** Column names declared by `create table` bodies and `add column` clauses in a text. */
function columns(source: string): { table: string; column: string }[] {
  const out: { table: string; column: string }[] = [];
  for (const m of source.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(([\s\S]*?)\n?\)\s*(?:;|`)/gi)) {
    for (const line of m[2]!.split('\n')) {
      const c = line.trim().match(/^"?([a-z_]\w*)"?\s+\w+/i);
      if (c && !/^(primary|unique|foreign|constraint|check|create)$/i.test(c[1]!)) out.push({ table: m[1]!, column: c[1]! });
    }
  }
  for (const m of source.matchAll(/alter\s+table\s+(?:only\s+)?([\w."]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)/gi)) out.push({ table: m[1]!, column: m[2]! });
  return out;
}

/**
 * Columns that look like a status and are not a status of the work, with the
 * reason. Keyed `table.column`.
 */
const ALLOWED: Record<string, string> = {
  'events.status': 'sync status of a local event: pending, confirmed or rejected (invariant 7)',
  'snapshots.state': 'the folded state of a stream (a checkpoint), not a status',
  'timing_jobs.done': 'a count of items a background timing job has finished, not a verdict on translation work',
  'api_device_grants.approved_at': 'when a person approved a device sign-in for the API, not an approval of work',
  'org_verification_requests.status': "where an organization's blue check request stands, the server's own state (decisions.md 173), not a status of work",
};

describe('invariant 5: no stored status', () => {
  const sources = [
    ...files(join(ROOT, 'supabase/migrations'), /\.sql$/),
    ...files(join(ROOT, 'packages/sync/src'), /\.ts$/),
    ...files(join(ROOT, 'apps/mobile/src'), /\.tsx?$/),
  ];

  it('the scan finds the tables it is meant to read', () => {
    const all = sources.flatMap((f) => columns(readFileSync(f, 'utf8')));
    expect(all.length).toBeGreaterThan(100);
    expect(all.some((c) => c.column === 'hlc')).toBe(true);
  });

  it('no SQLite or Postgres table has a status-like column outside the explicit list', () => {
    const found: string[] = [];
    for (const f of sources) {
      for (const { table, column } of columns(readFileSync(f, 'utf8'))) {
        const key = `${table.replace(/^public\./, '').replace(/"/g, '')}.${column}`;
        if (STATUSY.test(column) && !(key in ALLOWED)) found.push(`${relative(ROOT, f)}: ${key}`);
      }
    }
    expect(found, 'Status comes from passage.ts. If this column is not a status of the work, add it to ALLOWED with the reason.').toEqual([]);
  });

  it('the state types hold no field named status or approved', () => {
    const found: string[] = [];
    for (const name of ['state.ts', 'record.ts', 'org.ts']) {
      const f = join(ROOT, 'packages/core/src', name);
      for (const m of readFileSync(f, 'utf8').matchAll(/^\s{2,}([A-Za-z_]\w*)\??:\s/gm)) {
        if (/^(status|approved|isApproved|isDone|verdict|reviewStatus)$/i.test(m[1]!)) found.push(`${name}: ${m[1]}`);
      }
    }
    expect(found).toEqual([]);
  });
});
