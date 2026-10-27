// Importers for organizations that host their own material (decisions.md 173,
// docs/publisher-imports.md). LangQuest staff turn one on for an organization,
// pointed at where it keeps its material; the organization's admins then ask
// for imports in the app, the app Worker builds them, and the admins publish.
//
//   npm run publisher-import -- list                       every importer, with its latest run
//   npm run publisher-import -- grant <organization id> fia [--source BibleAquifer]
//   npm run publisher-import -- revoke <organization id> fia
//   npm run publisher-import -- step                       build waiting imports now (local only)
//   npm run publisher-import -- check                      look at published imports' sources for what is new, now (local only)
//
// Add --hosted to work on the hosted project (after `npx supabase login` and
// `npx supabase link`); without it, the local database (--workdir <dir> for a
// stack of your own; `step` reads SUPABASE_URL, else the default local one).
// Add --json to print rows as they come. Before granting, check the
// organization is the one the source belongs to: its blue check
// (docs/verified-organizations.md) says its admins speak for its website.
import { createClient } from '@supabase/supabase-js';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { checkImports, runImports } from '../server/publisherImport';
import { quoted, rowsOf } from './global-viewer';
import { isLocalUrl, LOCAL_URL, supabaseKey } from './local-supabase';

export interface Args {
  command: string;
  org: string | undefined;
  importer: string | undefined;
  source: string | undefined;
  hosted: boolean;
  json: boolean;
  workdir: string | undefined;
}

export function parseArgs(argv: readonly string[]): Args {
  const rest: string[] = [];
  let workdir: string | undefined, source: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--workdir') workdir = argv[++i];
    else if (a === '--source') source = argv[++i];
    else if (!a.startsWith('--')) rest.push(a);
  }
  return { command: rest[0] ?? 'list', org: rest[1], importer: rest[2], source, hosted: argv.includes('--hosted'), json: argv.includes('--json'), workdir };
}

/** The importers there are, and where each reads from unless told otherwise. */
export const IMPORTERS: Record<string, { source: string; what: string }> = {
  fia: { source: 'BibleAquifer', what: 'FIA from Bible Aquifer\'s GitHub repositories (FIATranslationGuide, FIAKeyTerms, FIAImages, FIAMaps)' }
};

export function importerOf(value: string | undefined): string {
  if (!value || !IMPORTERS[value]) throw new Error(`Name the importer: ${Object.keys(IMPORTERS).join(', ')}.`);
  return value;
}

function query<T>(sql: string, args: Args): T[] {
  const where = args.hosted ? ['--linked'] : ['--local', ...(args.workdir ? ['--workdir', args.workdir] : [])];
  const r = spawnSync('npx', ['supabase', 'db', 'query', ...where, '-o', 'json', sql], { encoding: 'utf8' });
  if (r.error) throw new Error(`could not run the Supabase CLI: ${r.error.message}`);
  if (r.status !== 0) {
    const out = r.stderr.trim() || r.stdout.trim();
    if (/function public\.org_importer_\w+\(.*\) does not exist/.test(out)) {
      throw new Error(`That database has no publisher imports yet: apply the migrations first (${args.hosted ? 'merge to main' : 'npm run db:reset'}).`);
    }
    throw new Error(out);
  }
  return rowsOf<T>(r.stdout);
}

function operator(): string {
  const r = spawnSync('git', ['config', 'user.name'], { encoding: 'utf8' });
  const name = r.status === 0 ? r.stdout.trim() : '';
  if (!name) throw new Error('Set your name first: git config user.name "Your Name".');
  return name;
}

interface ListRow {
  org_id: string; org_name: string | null; importer: string; source: string; granted_at: string; granted_by: string;
  revoked_at: string | null; revoked_by: string | null; runs: number;
  last_run: { state: string; requestedAt: string; done: number; total: number | null; failure: string | null } | null;
}

function list(args: Args): void {
  const rows = query<ListRow>('select * from public.org_importer_list()', args);
  if (args.json) { console.log(JSON.stringify(rows, null, 2)); return; }
  if (!rows.length) { console.log('No importers.'); return; }
  for (const r of rows) {
    console.log(`\n${r.org_name ?? r.org_id}  (${r.org_id})  ${r.importer} from ${r.source}${r.revoked_at ? `  OFF since ${r.revoked_at} (${r.revoked_by})` : ''}`);
    console.log(`  turned on ${r.granted_at} by ${r.granted_by}; ${r.runs} run${r.runs === 1 ? '' : 's'}`);
    const l = r.last_run;
    if (l) console.log(`  latest: ${l.state}, asked ${l.requestedAt}${l.total ? `, ${l.done} of ${l.total}` : ''}${l.failure ? ` (${l.failure})` : ''}`);
  }
}

/** The local database as the Worker uses it; the hosted one is the Worker's. */
function localWorker(args: Args, what: string) {
  if (args.hosted) throw new Error(`The app Worker ${what} on the hosted project by itself; this is for a local stack.`);
  const url = process.env['SUPABASE_URL'] ?? LOCAL_URL;
  if (!isLocalUrl(url)) throw new Error(`SUPABASE_URL is ${url}; this is for a local stack.`);
  return createClient(url, supabaseKey('SUPABASE_SERVICE_ROLE_KEY', url), { auth: { persistSession: false, autoRefreshToken: false } });
}

async function step(args: Args): Promise<string> {
  const sb = localWorker(args, 'builds imports every ten minutes');
  const r = await runImports(sb, { fetch }, 30 * 60_000);
  if (r.errors) throw new Error(`${r.steps} step${r.steps === 1 ? '' : 's'}, ${r.errors} failed (the log above says why).`);
  return r.steps ? `${r.steps} step${r.steps === 1 ? '' : 's'} built.` : 'No import is waiting.';
}

async function check(args: Args): Promise<string> {
  const sb = localWorker(args, 'looks at sources once a day');
  const r = await checkImports(sb, { fetch }, 0);
  if (r.errors) throw new Error(`${r.checked} looked at, ${r.errors} failed (the log above says why).`);
  return r.checked ? `Looked at ${r.checked} source${r.checked === 1 ? '' : 's'}; the app shows what is new.` : 'No published import to look at.';
}

async function run(args: Args): Promise<string | null> {
  switch (args.command) {
    case 'list': list(args); return null;
    case 'grant': {
      if (!args.org) throw new Error('Give the organization\'s id.');
      const importer = importerOf(args.importer);
      const source = args.source ?? IMPORTERS[importer]!.source;
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(source)) throw new Error('A source is a GitHub owner\'s name, letters, digits, . _ and - only.');
      const [row] = query<{ answer: string }>(
        `select public.org_importer_grant(${quoted(args.org, 'an organization id', 200)}, '${importer}', '${source}', ${quoted(operator(), 'your name', 200)}) as answer`, args);
      if (row?.answer !== 'granted') throw new Error(row?.answer === 'no_org' ? 'No organization has that id.' : row?.answer ?? 'No answer.');
      return `Turned on: the organization's admins see "Import" under Setup → Reference Material, reading ${IMPORTERS[importer]!.what.replace('Bible Aquifer\'s', `${source}'s`)}.`;
    }
    case 'revoke': {
      if (!args.org) throw new Error('Give the organization\'s id.');
      const importer = importerOf(args.importer);
      const [row] = query<{ answer: string }>(
        `select public.org_importer_revoke(${quoted(args.org, 'an organization id', 200)}, '${importer}', ${quoted(operator(), 'your name', 200)}) as answer`, args);
      if (row?.answer !== 'revoked') throw new Error(row?.answer === 'not_granted' ? 'That organization has no such importer on.' : row?.answer ?? 'No answer.');
      return 'Turned off: imports under way stop; what the organization published stays.';
    }
    case 'step': return step(args);
    case 'check': return check(args);
    default:
      throw new Error('Use: list | grant <organization id> <importer> [--source <owner>] | revoke <organization id> <importer> | step | check  [--hosted] [--json] [--workdir <dir>]');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(parseArgs(process.argv.slice(2))).then((out) => { if (out) console.log(out); }).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
