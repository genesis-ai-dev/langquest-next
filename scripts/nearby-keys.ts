// A person's nearby install keys, for staff (docs/nearby-sync-plan.md section
// 6): list them with what each revoked key has delivered against its cap,
// revoke them for someone who cannot reach their email (a detained person, a
// phone taken with the mail app signed in), which also ends their sessions,
// and raise one revoked key's cap when a thief used it up and real work waits
// as refused on teammates' phones (Carl's answer 16; Try again then delivers).
// New password's "A phone of mine was lost or taken" and a helper's lost-phone
// code revoke without staff. Nobody else can revoke a member's phone on this
// branch (Carl's answer 23).
//
//   npm run nearby-keys -- list <email or account id>
//   npm run nearby-keys -- revoke <email or account id>
//   npm run nearby-keys -- raise <account id> <public key> <events> <bytes>
//
// Add --hosted to work on the hosted project (after `npx supabase login` and
// `npx supabase link`); without it, the local database (--workdir <dir> for a
// stack of your own). Add --json to print rows as they come.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { quoted, rowsOf } from './global-viewer';

export interface Args {
  command: string;
  rest: string[];
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
  return { command: rest[0] ?? 'list', rest: rest.slice(1), hosted: argv.includes('--hosted'), json: argv.includes('--json'), workdir };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{43}$/;

/** An email or an account id, as SQL. */
export function who(value: string | undefined): string {
  if (!value || !(UUID.test(value) || /^[^\s@']+@[^\s@']+\.[^\s@']+$/.test(value))) throw new Error('Give the account\'s email or id.');
  return quoted(value, 'an email or account id', 320);
}

/** A whole number for a limit, as SQL; the database keeps the greater of it and what is there. */
export function limit(value: string | undefined, what: string): string {
  if (!value || !/^\d{1,15}$/.test(value)) throw new Error(`Give ${what} as a whole number.`);
  return String(Number(value));
}

function query<T>(sql: string, args: Args): T[] {
  const where = args.hosted ? ['--linked'] : ['--local', ...(args.workdir ? ['--workdir', args.workdir] : [])];
  const r = spawnSync('npx', ['supabase', 'db', 'query', ...where, '-o', 'json', sql], { encoding: 'utf8' });
  if (r.error) throw new Error(`could not run the Supabase CLI: ${r.error.message}`);
  if (r.status !== 0) {
    const out = r.stderr.trim() || r.stdout.trim();
    if (/function public\.(install_key_\w+|install_keys_staff_revoke)\(.*\) does not exist/.test(out)) {
      throw new Error(`That database has no nearby delivery yet: apply the migrations first (${args.hosted ? 'merge to main' : 'npm run db:reset'}).`);
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

export interface KeyRow {
  public_key: string; install_id: string; created_at: string; last_certified_at: string; revoked_at: string | null; revoked_by: string | null;
  after_revoked_events: number; after_revoked_events_limit: number; after_revoked_bytes: number; after_revoked_bytes_limit: number; after_revoked_raised_by: string | null;
}

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

/** What `list` prints for these rows. */
export function listText(rows: readonly KeyRow[]): string {
  if (!rows.length) return 'No nearby keys for that account.';
  return rows.map((r) => `${r.public_key}  device ${r.install_id}  made ${r.created_at}, last certified ${r.last_certified_at}\n  ` +
    (r.revoked_at
      ? `REVOKED ${r.revoked_at} (${r.revoked_by}); since then delivered ${r.after_revoked_events} of ${r.after_revoked_events_limit} events, ` +
        `${mb(r.after_revoked_bytes)} of ${mb(r.after_revoked_bytes_limit)}${r.after_revoked_raised_by ? `; raised by ${r.after_revoked_raised_by}` : ''}`
      : 'good')).join('\n');
}

/** What a revoke answers, in words; throws for a refusal. */
export function revokeText(answer: string | undefined): string {
  const n = /^revoked (\d+)$/.exec(answer ?? '')?.[1];
  if (n === undefined) throw new Error(answer ?? 'No answer.');
  return n === '0'
    ? 'Nothing more to revoke; their sessions were ended. Phones learn of it from teammates who have met someone online.'
    : `Revoked ${n} key${n === '1' ? '' : 's'} and ended their sessions. Work signed before now is still delivered, up to each key's cap; later work is refused.`;
}

/** What a raise answers, in words; throws for a refusal. */
export function raiseText(answer: string | undefined): string {
  if (answer === 'raised') return 'Raised. Teammates\' phones deliver the refused work when someone presses Try again on Sync.';
  throw new Error(answer === 'no_key' ? 'That account holds no such key.' : answer === 'say_who' ? 'Set your name first: git config user.name "Your Name".' : answer ?? 'No answer.');
}

function run(args: Args): string {
  switch (args.command) {
    case 'list': {
      const rows = query<KeyRow>(`select * from public.install_key_list(${who(args.rest[0])})`, args);
      return args.json ? JSON.stringify(rows, null, 2) : listText(rows);
    }
    case 'revoke': {
      const [row] = query<{ answer: string }>(`select public.install_keys_staff_revoke(${who(args.rest[0])}, ${quoted(operator(), 'your name', 200)}) as answer`, args);
      return revokeText(row?.answer);
    }
    case 'raise': {
      const [account, key, events, bytes] = args.rest;
      if (!account || !UUID.test(account)) throw new Error('Give the account\'s id (npm run nearby-keys -- list <email> shows it).');
      if (!key || !KEY.test(key)) throw new Error('Give the key as list prints it.');
      const [row] = query<{ answer: string }>(
        `select public.install_key_limit_raise('${key}', '${account}', ${limit(events, 'the events')}, ${limit(bytes, 'the bytes')}, ${quoted(operator(), 'your name', 200)}) as answer`, args);
      return raiseText(row?.answer);
    }
    default:
      throw new Error('Use: list <email or id> | revoke <email or id> | raise <account id> <key> <events> <bytes>  [--hosted] [--json] [--workdir <dir>]');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(run(parseArgs(process.argv.slice(2))));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
