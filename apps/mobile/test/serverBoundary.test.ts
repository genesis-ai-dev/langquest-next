import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Every call this app makes to Supabase lives in src/server (decisions.md
 * 105): screens, hooks and models call its functions, so RPC names, their
 * parameters and what a refusal looks like are in one place, and the logic
 * around them can be tested without a server. Outside that folder nothing
 * imports the client or supabase-js (types aside), or calls `.rpc(`,
 * `.auth.` or `.functions.invoke(`.
 */
const APP = join(__dirname, '..');
const SERVER = join(APP, 'src/server');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return path === SERVER ? [] : files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The code without its comments, which may name these calls. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const RULES: { what: string; test: RegExp }[] = [
  { what: 'imports the Supabase client', test: /from\s+['"][./]*(server\/)?supabase['"]/ },
  { what: 'imports supabase-js', test: /^\s*import\s+(?!type\b)[^;]*from\s+['"]@supabase\/supabase-js['"]/m },
  { what: 'calls an RPC', test: /\.rpc\(/ },
  { what: 'calls auth', test: /\.auth\./ },
  { what: 'invokes a function', test: /\.functions\.invoke\(/ }
];

describe('Supabase calls live in src/server', () => {
  it('nothing outside src/server talks to Supabase directly', () => {
    const found: string[] = [];
    for (const file of [...files(join(APP, 'src')), join(APP, 'App.tsx')]) {
      const source = code(readFileSync(file, 'utf8'));
      for (const rule of RULES) if (rule.test.test(source)) found.push(`${relative(APP, file)} ${rule.what}`);
    }
    expect(found, 'Add a function to src/server and call it instead (decisions.md 105).').toEqual([]);
  });
});
