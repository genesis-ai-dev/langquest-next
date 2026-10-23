// Global Viewers, made and ended by an operator (decisions.md 158,
// docs/global-viewers.md). Nothing in the app can do this.
//
//   npm run global-viewer -- list                                 who, since when, authenticators, last sign-in
//   npm run global-viewer -- grant <email> --note "<who asked, why>"
//   npm run global-viewer -- revoke <email>                       access off now, every sign-in ended
//   npm run global-viewer -- reset-mfa <email>                    a lost authenticator: set up again on a call
//
// Add --hosted to work on the hosted project (after `npx supabase login` and
// `npx supabase link`); without it, the local database. Add --json to print
// rows as they come. Grant on a call with the person: they sign up, you
// grant, they set up their authenticator in the app (Me → Global Viewer), and
// `list` shows it verified just now. The checks are in SQL
// (`global_viewer_grant` and the rest), so the smoke holds them.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export interface Args {
  command: string;
  email: string | undefined;
  note: string | undefined;
  hosted: boolean;
  json: boolean;
}

/** The command line, `--note` taking the word after it. */
export function parseArgs(argv: readonly string[]): Args {
  const rest: string[] = [];
  let note: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--note') note = argv[++i];
    else if (a.startsWith('--note=')) note = a.slice('--note='.length);
    else if (!a.startsWith('--')) rest.push(a);
  }
  return { command: rest[0] ?? 'list', email: rest[1], note, hosted: argv.includes('--hosted'), json: argv.includes('--json') };
}

/** A SQL string literal. Refuses what an email or a note never holds, rather than quoting it. */
export function quoted(value: string | undefined, what: string, max = 500): string {
  if (value === undefined || value.trim() === '') throw new Error(`Give ${what}.`);
  if (value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`That is not ${what}.`);
  return `'${value.replace(/'/g, "''")}'`;
}

/** An email, as far as is worth checking here; the database finds the account. */
export function email(value: string | undefined): string {
  if (!value || !/^[^\s@']+@[^\s@']+\.[^\s@']+$/.test(value)) throw new Error('Give the account\'s email.');
  return quoted(value, 'an email', 320);
}

function query<T>(sql: string, hosted: boolean): T[] {
  const r = spawnSync('npx', ['supabase', 'db', 'query', hosted ? '--linked' : '--local', '-o', 'json', sql], { encoding: 'utf8' });
  if (r.error) throw new Error(`could not run the Supabase CLI: ${r.error.message}`);
  if (r.status !== 0) {
    const out = r.stderr.trim() || r.stdout.trim();
    if (/Cannot find project ref/.test(out)) {
      throw new Error('This checkout is not linked to the hosted project. Run `npx supabase link --project-ref <ref>` here first, or run this from a checkout that is.');
    }
    if (/function public\.global_viewer_\w+\(.*\) does not exist/.test(out)) {
      throw new Error(`That database has no Global Viewers yet: apply the migrations first (${hosted ? 'merge to main' : 'npm run db:reset'}).`);
    }
    throw new Error(out);
  }
  return rowsOf<T>(r.stdout);
}

/**
 * The rows in what `supabase db query -o json` printed. The CLI prints the
 * rows as a bare array in a terminal, and as `{ boundary, rows, warning }`
 * when it thinks an AI agent is running it; it may also print other JSON
 * beside them. Take whichever holds the rows.
 */
export function rowsOf<T>(stdout: string): T[] {
  const candidates = [stdout.trim(), ...(stdout.match(/^[[{][\s\S]*?^[\]}]\s*$/gm) ?? [])];
  for (const text of candidates) {
    try {
      const parsed = JSON.parse(text) as T[] | { rows?: T[] };
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.rows)) return parsed.rows;
    } catch { /* not the answer: keep looking */ }
  }
  throw new Error(`The Supabase CLI gave no rows. It printed:\n${stdout.trim().slice(0, 800)}`);
}

/** Who is running this, for `granted_by` and `revoked_by`. */
function operator(): string {
  const r = spawnSync('git', ['config', 'user.name'], { encoding: 'utf8' });
  const name = r.status === 0 ? r.stdout.trim() : '';
  if (!name) throw new Error('Set your name first: git config user.name "Your Name".');
  return name;
}

interface ListRow {
  email: string; display_name: string | null; granted_at: string; granted_by: string; note: string;
  revoked_at: string | null; revoked_by: string | null; authenticators: number;
  authenticator_verified_at: string | null; last_sign_in_at: string | null;
}

function list(args: Args): void {
  const rows = query<ListRow>('select * from public.global_viewer_list()', args.hosted);
  if (args.json) { console.log(JSON.stringify(rows, null, 2)); return; }
  if (!rows.length) { console.log('No Global Viewers.'); return; }
  for (const r of rows) {
    console.log(`\n${r.email}${r.display_name ? `  (${r.display_name})` : ''}${r.revoked_at ? '  REVOKED' : ''}`);
    console.log(`  granted ${r.granted_at} by ${r.granted_by}: ${r.note}`);
    if (r.revoked_at) console.log(`  revoked ${r.revoked_at} by ${r.revoked_by}`);
    console.log(r.authenticators
      ? `  ${r.authenticators} authenticator${r.authenticators === 1 ? '' : 's'}, last verified ${r.authenticator_verified_at}`
      : '  no authenticator yet: access stays off until they set one up');
    console.log(`  last signed in ${r.last_sign_in_at ?? 'never'}`);
  }
  console.log(`\n${rows.filter((r) => !r.revoked_at).length} active.`);
}

/** Runs one command; returns what to print. */
function run(args: Args): string | null {
  switch (args.command) {
    case 'list': list(args); return null;
    case 'grant': {
      const [row] = query<{ answer: string }>(
        `select public.global_viewer_grant(${email(args.email)}, ${quoted(operator(), 'your name', 200)}, ${quoted(args.note, 'a note saying who asked and why (--note)')}) as answer`,
        args.hosted);
      if (row?.answer !== 'granted') throw new Error(row?.answer ?? 'No answer.');
      return [
        `Granted. Access stays off until ${args.email} sets up an authenticator:`,
        '  in the app, Me → Global Viewer → Set up authenticator, while you are on the call.',
        `Then run \`npm run global-viewer -- list${args.hosted ? ' --hosted' : ''}\`: it must show the authenticator verified just now.`,
        'If it was verified before you watched, revoke and reset-mfa, and start again.'
      ].join('\n');
    }
    case 'revoke': {
      const [row] = query<{ answer: string }>(
        `select public.global_viewer_revoke(${email(args.email)}, ${quoted(operator(), 'your name', 200)}) as answer`, args.hosted);
      if (row?.answer !== 'revoked') throw new Error(row?.answer ?? 'No answer.');
      return 'Revoked. Access is off now, and every sign-in of that account ends at its next request.';
    }
    case 'reset-mfa': {
      const [row] = query<{ answer: string }>(`select public.global_viewer_reset_mfa(${email(args.email)}) as answer`, args.hosted);
      if (row?.answer !== 'reset') throw new Error(row?.answer ?? 'No answer.');
      return 'Reset: their authenticators are gone and they are signed out. They set up a new one on a call with you, then check `list`.';
    }
    default:
      throw new Error('Use: list | grant <email> --note "<who asked, why>" | revoke <email> | reset-mfa <email>  [--hosted] [--json]');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const out = run(parseArgs(process.argv.slice(2)));
    if (out) console.log(out);
  } catch (e) {
    // A message for the operator, not a stack trace.
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
