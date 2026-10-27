// Blue checks for organizations, decided by LangQuest staff (decisions.md 173,
// docs/verified-organizations.md). An organization's admin asks in the app and
// confirms an address at its domain; staff then grant or decline here or on
// the ops dashboard, and revoke here only.
//
//   npm run org-verification -- list [waiting|granted|declined|confirming|withdrawn]
//                                   every request: organization, domain, the confirmed address, who asked
//   npm run org-verification -- grant <request id>     the check on, with the request's domain
//   npm run org-verification -- decline <request id>
//   npm run org-verification -- revoke <organization id>
//
// Add --hosted to work on the hosted project (after `npx supabase login` and
// `npx supabase link`); without it, the local database (--workdir <dir> for a
// stack of your own). Add --json to print rows as they come. Before granting,
// open the domain's website and check it is the organization the name says,
// and that the confirmed address is someone who may speak for it.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { quoted, rowsOf } from './global-viewer';

export interface Args {
  command: string;
  target: string | undefined;
  hosted: boolean;
  json: boolean;
  workdir: string | undefined;
}

export function parseArgs(argv: readonly string[]): Args {
  const rest: string[] = [];
  let workdir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--workdir') workdir = argv[++i];
    else if (!a.startsWith('--')) rest.push(a);
  }
  return { command: rest[0] ?? 'list', target: rest[1], hosted: argv.includes('--hosted'), json: argv.includes('--json'), workdir };
}

const STATUSES = ['confirming', 'waiting', 'granted', 'declined', 'withdrawn'];

/** A request's id, as the list prints it. */
export function requestId(value: string | undefined): string {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('Give the request\'s id, from `list`.');
  return `'${value.toLowerCase()}'`;
}

function query<T>(sql: string, args: Args): T[] {
  const where = args.hosted ? ['--linked'] : ['--local', ...(args.workdir ? ['--workdir', args.workdir] : [])];
  const r = spawnSync('npx', ['supabase', 'db', 'query', ...where, '-o', 'json', sql], { encoding: 'utf8' });
  if (r.error) throw new Error(`could not run the Supabase CLI: ${r.error.message}`);
  if (r.status !== 0) {
    const out = r.stderr.trim() || r.stdout.trim();
    if (/function public\.org_verification_\w+\(.*\) does not exist/.test(out)) {
      throw new Error(`That database has no blue checks yet: apply the migrations first (${args.hosted ? 'merge to main' : 'npm run db:reset'}).`);
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
  id: string; org_id: string; org_name: string | null; domain: string; email: string; requested_by: string | null; status: string;
  created_at: string; email_confirmed_at: string | null; decided_at: string | null; decided_by: string | null;
}

function list(args: Args): void {
  const status = args.target;
  if (status && !STATUSES.includes(status)) throw new Error(`List by one of: ${STATUSES.join(', ')}.`);
  const rows = query<ListRow>(`select * from public.org_verification_list(${status ? `'${status}'` : 'null'})`, args);
  if (args.json) { console.log(JSON.stringify(rows, null, 2)); return; }
  if (!rows.length) { console.log('No requests.'); return; }
  for (const r of rows) {
    console.log(`\n${r.org_name ?? r.org_id}  (${r.org_id})  ${r.status.toUpperCase()}`);
    console.log(`  domain ${r.domain}, address ${r.email}${r.email_confirmed_at ? ` confirmed ${r.email_confirmed_at}` : ' not confirmed'}`);
    console.log(`  asked by ${r.requested_by ?? 'someone with no name'} on ${r.created_at}`);
    if (r.decided_at) console.log(`  ${r.status} ${r.decided_at} by ${r.decided_by}`);
    console.log(`  request ${r.id}`);
  }
}

function run(args: Args): string | null {
  switch (args.command) {
    case 'list': list(args); return null;
    case 'grant':
    case 'decline': {
      const grant = args.command === 'grant';
      const [row] = query<{ answer: string }>(
        `select public.org_verification_decide(${requestId(args.target)}, ${grant}, ${quoted(operator(), 'your name', 200)}) as answer`, args);
      if (row?.answer !== (grant ? 'granted' : 'declined')) throw new Error(row?.answer === 'not_waiting' ? 'That request is not waiting for staff.' : row?.answer ?? 'No answer.');
      return grant ? 'Granted: the blue check shows after the organization\'s name within ten minutes on every phone.' : 'Declined: its admins see it on the organization\'s page and may ask again.';
    }
    case 'revoke': {
      if (!args.target) throw new Error('Give the organization\'s id.');
      const [row] = query<{ answer: string }>(
        `select public.org_verification_revoke(${quoted(args.target, 'an organization id', 200)}, ${quoted(operator(), 'your name', 200)}) as answer`, args);
      if (row?.answer !== 'revoked') throw new Error(row?.answer === 'not_verified' ? 'That organization has no blue check.' : row?.answer ?? 'No answer.');
      return 'Revoked: the check goes from phones within ten minutes.';
    }
    default:
      throw new Error('Use: list [status] | grant <request id> | decline <request id> | revoke <organization id>  [--hosted] [--json] [--workdir <dir>]');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const out = run(parseArgs(process.argv.slice(2)));
    if (out) console.log(out);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
