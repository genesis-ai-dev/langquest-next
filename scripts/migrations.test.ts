import { readdirSync } from 'node:fs';

// Supabase records a migration by the version at the start of its file name
// (supabase_migrations.schema_migrations, primary key version). Two files
// with the same version apply locally one after the other and then fail the
// second insert, which is how a merge of two branches that each added a
// migration at the same minute broke every CI job that starts the stack
// (2026-10-14). The versions must be unique, and in file order.

const dir = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

describe('supabase migrations', () => {
  it('each file starts with a 14-digit version and a name', () => {
    for (const f of files) expect(f, f).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it('no two files share a version', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const f of files) {
      const version = f.slice(0, 14);
      const other = seen.get(version);
      if (other) clashes.push(`${other} and ${f}`);
      seen.set(version, f);
    }
    expect(clashes, 'rename the newer one to a later version').toEqual([]);
  });
});
