// Features staff turn on one organization at a time (docs/nearby-sync-plan.md
// 5.10): `nearby`, sharing work between phones with no internet, and
// `nearby_join`, joining offline, which works only while `nearby` is on too.
// Off for everyone by default. A grant reaches an organization's phones the next
// time each reaches the server (get_user_state's orgFeatures, then a
// certificate); a revoke stops new certificates, and phones drop theirs, within
// a day of being online. Each grant and revoke is kept with who did it.
//
//   npm run org-feature -- list                              every grant, live or revoked
//   npm run org-feature -- grant <organization id> nearby
//   npm run org-feature -- revoke <organization id> nearby
//
// Add --hosted to work on the hosted project (after `npx supabase login` and
// `npx supabase link`); without it, the local database (--workdir <dir> for a
// stack of your own). Add --json to print rows as they come.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { quoted, rowsOf } from './global-viewer';

export interface Args {
  command: string;
  org: string | undefined;
  feature: string | undefined;
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
  return { command: rest[0] ?? 'list', org: rest[1], feature: rest[2], hosted: argv.includes('--hosted'), json: argv.includes('--json'), workdir };
}

/** The features there are, as `org_features`' check names them. */
export const FEATURES: Record<string, string> = {
  nearby: 'Share nearby: phones in the organization share work with no internet',
  nearby_join: 'joining offline: a teammate\'s phone lets a new person in, while nearby is on too'
};

export function featureOf(value: string | undefined): string {
  if (!value || !Object.hasOwn(FEATURES, value)) throw new Error(`Name the feature: ${Object.keys(FEATURES).join(', ')}.`);
  return value;
}

function query<T>(sql: string, args: Args): T[] {
  const where = args.hosted ? ['--linked'] : ['--local', ...(args.workdir ? ['--workdir', args.workdir] : [])];
  const r = spawnSync('npx', ['supabase', 'db', 'query', ...where, '-o', 'json', sql], { encoding: 'utf8' });
  if (r.error) throw new Error(`could not run the Supabase CLI: ${r.error.message}`);
  if (r.status !== 0) {
    const out = r.stderr.trim() || r.stdout.trim();
    if (/function public\.org_feature_\w+\(.*\) does not exist/.test(out)) {
      throw new Error(`That database has no organization features yet: apply the migrations first (${args.hosted ? 'merge to main' : 'npm run db:reset'}).`);
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
  org_id: string; org_name: string | null; feature: string; granted_at: string; granted_by: string; revoked_at: string | null; revoked_by: string | null;
}

/** What `list` prints for these rows. */
export function listText(rows: readonly ListRow[]): string {
  if (!rows.length) return 'No organization has a feature on.';
  return rows.map((r) => `${r.org_name ?? r.org_id}  (${r.org_id})  ${r.feature}  ` +
    (r.revoked_at ? `OFF since ${r.revoked_at} (${r.revoked_by}); was turned on ${r.granted_at} by ${r.granted_by}` : `on since ${r.granted_at} (${r.granted_by})`)).join('\n');
}

/** What a grant or revoke answers, in words; throws for a refusal. */
export function answerText(command: 'grant' | 'revoke', feature: string, answer: string | undefined): string {
  if (command === 'grant' && answer === 'granted') {
    return feature === 'nearby'
      ? 'Turned on: each member\'s phone gets its certificate the next time it reaches the server, and Share nearby appears for the languages it holds.'
      : 'Turned on: passes are issued only while nearby is on for this organization too (npm run org-feature -- list).';
  }
  if (command === 'revoke' && answer === 'revoked') {
    return feature === 'nearby'
      ? 'Turned off: phones drop their certificates and Share nearby within a day of reaching the server; joining offline stops too. Work already shared still settles.'
      : 'Turned off: no new passes; nearby sharing itself stays on.';
  }
  throw new Error(answer === 'no_org' ? 'No organization has that id.'
    : answer === 'not_granted' ? 'That organization does not have that feature on.'
    : answer === 'say_who' ? 'Set your name first: git config user.name "Your Name".'
    : answer ?? 'No answer.');
}

function run(args: Args): string {
  switch (args.command) {
    case 'list': {
      const rows = query<ListRow>('select * from public.org_feature_list()', args);
      return args.json ? JSON.stringify(rows, null, 2) : listText(rows);
    }
    case 'grant':
    case 'revoke': {
      if (!args.org) throw new Error('Give the organization\'s id.');
      const feature = featureOf(args.feature);
      const [row] = query<{ answer: string }>(
        `select public.org_feature_${args.command}(${quoted(args.org, 'an organization id', 200)}, '${feature}', ${quoted(operator(), 'your name', 200)}) as answer`, args);
      return answerText(args.command, feature, row?.answer);
    }
    default:
      throw new Error(`Use: list | grant <organization id> <feature> | revoke <organization id> <feature>  [--hosted] [--json] [--workdir <dir>]; features: ${Object.keys(FEATURES).join(', ')}`);
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
