// Every server call that a store build may still make has to keep working
// (decisions.md 150). A phone runs its build's own code or an OTA update
// sent to it later, and every merge into main that changes the app reaches
// phones as one or the other. So the calls that store builds make are the
// calls in every commit on main since the oldest store build that we still
// support, and in each store build's own commit.
//
// A server call is a Supabase function (`.rpc('name')`), table or view
// (`.from('name')`), Edge Function (`functions.invoke('name')`), or a route
// of the app's Worker (`/api/<name>`), named in the app's code
// (apps/mobile/src) or the sync package's (packages/sync/src). The check
// says which of them the server would no longer have after this pull
// request: a function, table or view that the migrations drop or rename, an
// Edge Function folder that is gone, or a Worker route that apps/web/worker
// no longer names. It reads files and git history only, so it takes seconds.
//
//   node scripts/server-calls.mjs          check, and name each build and call that broke
//   node scripts/server-calls.mjs --list   the calls of the newest store build
//
// The store builds come from EAS when EXPO_TOKEN is set, and otherwise from
// apps/mobile/store-builds.json, which lists them as EAS had them.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Where the app's code names server calls, at any commit. */
export const SOURCES = ['apps/mobile/src', 'packages/sync/src'];
export const STORE_BUILDS = 'apps/mobile/store-builds.json';

const KINDS = {
  rpc: { label: 'the database function', pattern: /\.rpc\(\s*['"]([a-z][a-z0-9_]*)['"]/g },
  from: { label: 'the table or view', pattern: /(?<!storage)\.from\(\s*['"]([a-z][a-z0-9_]*)['"]/g },
  invoke: { label: 'the Edge Function', pattern: /(?:functions\.invoke|invokeFunction)\(\s*['"]([a-z][a-z0-9_-]*)['"]/g },
  route: { label: 'the Worker route', pattern: /\/api\/([a-z][a-z0-9-]*)/g },
};

/** The server calls that some source text names, as `kind:name`. */
export function callsIn(text) {
  const calls = new Set();
  for (const [kind, { pattern }] of Object.entries(KINDS)) for (const m of text.matchAll(pattern)) calls.add(`${kind}:${m[1]}`);
  return calls;
}

/** How a `kind:name` call reads in a message: "the database function pull_events". */
export function describe(call) {
  const [kind, name] = call.split(':');
  return `${KINDS[kind].label} ${kind === 'route' ? `/api/${name}` : name}`;
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
}

const GREP = [String.raw`\.rpc\(|\.from\(|invoke|invokeFunction\(|/api/`];
const GREP_PATHS = ['--', ...SOURCES, ':(exclude)**/test/**', ':(exclude)**/*.test.ts', ':(exclude)**/*.test.tsx'];

/** The server calls in the app's code at each commit, read in one pass; test files are left out. */
export function callsAtEach(shas) {
  const out = new Map(shas.map((sha) => [sha, new Set()]));
  for (let i = 0; i < shas.length; i += 200) {
    let text = '';
    try {
      text = git(['grep', '-I', '-E', ...GREP, ...shas.slice(i, i + 200), ...GREP_PATHS]);
    } catch (err) {
      if (err.status !== 1) throw err; // 1: nothing matched
    }
    for (const line of text.split('\n')) {
      const sha = line.slice(0, line.indexOf(':'));
      if (out.has(sha)) for (const call of callsIn(line.slice(sha.length))) out.get(sha).add(call);
    }
  }
  return out;
}

/** The server calls in the app's code at one commit. */
export const callsAt = (sha) => callsAtEach([sha]).get(sha);

const stripSql = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
const NAME = String.raw`(?:"?public"?\.)?"?([a-z][a-z0-9_]*)"?`;

/**
 * The functions, tables and views that the migrations leave in the public
 * schema, read from their text in order: each create adds a name, each drop
 * or rename takes it away. Dynamic SQL (`execute '…'`) is not read.
 */
export function schemaAfter(migrations) {
  const have = { function: new Set(), relation: new Set() };
  const statement = new RegExp(
    String.raw`\b(create(?:\s+or\s+replace)?\s+(function|(?:materialized\s+)?view|table(?:\s+if\s+not\s+exists)?)\s+${NAME}` +
      String.raw`|drop\s+(function|(?:materialized\s+)?view|table)(?:\s+if\s+exists)?\s+((?:${NAME}(?:\s*\([^)]*\))?\s*,\s*)*${NAME})` +
      String.raw`|alter\s+(table|(?:materialized\s+)?view)(?:\s+if\s+exists)?\s+(?:only\s+)?${NAME}\s+rename\s+to\s+"?([a-z][a-z0-9_]*)"?)`,
    'gi',
  );
  for (const sql of migrations) {
    for (const m of stripSql(sql).matchAll(statement)) {
      const lower = m[0].toLowerCase();
      if (lower.startsWith('create')) {
        have[/function/i.test(m[2]) ? 'function' : 'relation'].add(m[3].toLowerCase());
      } else if (lower.startsWith('drop')) {
        const set = have[/function/i.test(m[4]) ? 'function' : 'relation'];
        for (const n of m[5].matchAll(new RegExp(NAME, 'gi'))) set.delete(n[1].toLowerCase());
      } else {
        have.relation.delete(m[9].toLowerCase());
        have.relation.add(m[10].toLowerCase());
      }
    }
  }
  return have;
}

/** What the server has after this checkout's migrations, Edge Functions and Worker. */
export function serverHere(dir = root) {
  const migrationsDir = join(dir, 'supabase/migrations');
  const migrations = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(migrationsDir, f), 'utf8'));
  const functionsDir = join(dir, 'supabase/functions');
  const workerDir = join(dir, 'apps/web/worker');
  const worker = readdirSync(workerDir, { recursive: true })
    .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
    .map((f) => readFileSync(join(workerDir, f), 'utf8'))
    .join('\n');
  return {
    schema: schemaAfter(migrations),
    edgeFunction: (name) => existsSync(join(functionsDir, name)),
    route: (name) => new RegExp(String.raw`['"\`/^]\\?/api\\?/${name}\b`).test(worker),
  };
}

/** The calls in `calls` that `server` no longer has. */
export function missing(calls, server) {
  return [...calls].filter((call) => {
    const [kind, name] = call.split(':');
    if (kind === 'rpc') return !server.schema.function.has(name);
    if (kind === 'from') return !server.schema.relation.has(name);
    if (kind === 'invoke') return !server.edgeFunction(name);
    return !server.route(name);
  });
}

/** The store builds, newest first: from EAS with EXPO_TOKEN, otherwise from the committed list. */
export async function storeBuilds(env = process.env) {
  const listed = JSON.parse(readFileSync(join(root, STORE_BUILDS), 'utf8'));
  const kept = { oldestSupported: listed.oldestSupported, retired: listed.retired };
  if (!env.EXPO_TOKEN) return { source: STORE_BUILDS, ...kept, builds: listed.builds };
  return { source: 'EAS', ...kept, builds: await easBuilds(listed.projectId, env.EXPO_TOKEN) };
}

/** Every finished production build of the project on EAS, newest first. */
async function easBuilds(projectId, token) {
  const builds = [];
  for (let offset = 0; ; offset += 50) {
    const res = await fetch('https://api.expo.dev/graphql', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        query: `query ($id: String!, $offset: Int!) { app { byId(appId: $id) { builds(offset: $offset, limit: 50, filter: { buildProfile: "production", status: FINISHED }) {
          platform appBuildVersion gitCommitHash createdAt } } } }`,
        variables: { id: projectId, offset },
      }),
    });
    if (!res.ok) throw new Error(`EAS answered ${res.status}`);
    const body = await res.json();
    if (body.errors) throw new Error(`EAS: ${body.errors.map((e) => e.message).join('; ')}`);
    const page = body.data.app.byId.builds;
    builds.push(...page.map((b) => ({ platform: b.platform.toLowerCase(), build: Number(b.appBuildVersion), commit: b.gitCommitHash, at: b.createdAt })));
    if (page.length < 50) break;
  }
  return builds.sort((a, b) => b.at.localeCompare(a.at));
}

const label = (b) => `Build ${b.build} (${b.platform === 'ios' ? 'iPhone' : 'Android'})`;

/**
 * Every call that phones may make: the calls in each store build's own
 * code, and each call on a line that a commit since the oldest build added
 * (an OTA update carries it). Reading the added lines instead of every
 * commit's whole tree keeps this to a few seconds.
 */
export function phoneCalls(oldest, builds, head = 'origin/main') {
  const byBuild = callsAtEach([...new Set([oldest, ...builds.map((b) => b.commit)])]);
  const added = new Map();
  const log = git(['log', '-p', '--no-color', '--format=commit %H', `${oldest}..${head}`, ...GREP_PATHS]);
  let sha = null;
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) sha = line.slice(7);
    else if (line.startsWith('+') && !line.startsWith('+++')) for (const call of callsIn(line)) if (!added.has(call)) added.set(call, sha);
  }
  return { byBuild, added };
}

/**
 * Each call that is missing, with the newest store build whose own code
 * makes it, or else the commit whose OTA update brought it.
 */
export function brokenCalls({ byBuild, added }, builds, server) {
  const all = new Set([...added.keys(), ...[...byBuild.values()].flatMap((calls) => [...calls])]);
  return missing(all, server).map((call) => ({ call, build: builds.find((b) => byBuild.get(b.commit)?.has(call)), commit: added.get(call) }));
}

async function main() {
  const { source, oldestSupported, retired, builds } = await storeBuilds();
  const supported = builds.filter((b) => b.build >= oldestSupported[b.platform] && !retired.some((r) => r.platform === b.platform && r.build === b.build));
  if (process.argv.includes('--list')) {
    for (const call of [...callsAt(supported[0].commit)].sort()) console.log(describe(call));
    return;
  }
  const oldest = supported.map((b) => b.commit).reduce((a, b) => (isAncestor(a, b) ? a : b));
  const broken = brokenCalls(phoneCalls(oldest, supported), supported, serverHere());
  console.log(`${supported.length} store builds (from ${source}), and every OTA update since ${oldest.slice(0, 8)}.`);
  if (broken.length === 0) return console.log('Every server call that they make is still there.');
  for (const { call, build, commit } of broken) {
    const who = build ? `${label(build)} still uses` : `The OTA update from ${commit.slice(0, 8)} still uses`;
    console.log(`::error::${who} ${describe(call)}, which the server would no longer have. Add a new server call next to the old one instead.`);
  }
  process.exit(1);
}

function isAncestor(a, b) {
  try {
    git(['merge-base', '--is-ancestor', a, b]);
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
