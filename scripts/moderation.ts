// Reports, read and acted on by LangQuest staff (decisions.md 48).
//
//   npm run moderation                          open reports, oldest first
//   npm run moderation -- remove <reportId>     take what was reported out of the record
//   npm run moderation -- dismiss <reportId>    leave it; closes every report about it
//   npm run moderation -- suspend <profileId>   stop the account signing in
//   npm run moderation -- unsuspend <profileId>
//
// Add --hosted to work on the hosted project (after `npx supabase login` and
// `npx supabase link`); without it, the local database. Add --json to print
// rows as they come. Organization admins act on their own reports in the
// app; this is for everything else, including reports about admins.
// Removing someone from an organization is an admin's job in the app; an
// account can be deleted with delete_account_for_email (decisions.md 46).
import { spawnSync } from 'node:child_process';

const hosted = process.argv.includes('--hosted');
const asJson = process.argv.includes('--json');
const [command = 'list', arg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));

/** One statement through the Supabase CLI, as JSON rows. Values are checked, then quoted. */
function query<T>(sql: string): T[] {
  const r = spawnSync('npx', ['supabase', 'db', 'query', hosted ? '--linked' : '--local', '-o', 'json', sql], { encoding: 'utf8' });
  if (r.error) throw new Error(`could not run the Supabase CLI: ${r.error.message}`);
  if (r.status !== 0) {
    const out = r.stderr.trim() || r.stdout.trim();
    if (/Cannot find project ref/.test(out)) {
      throw new Error('This checkout is not linked to the hosted project. Run `npx supabase link --project-ref <ref>` here first, or run this from a checkout that is.');
    }
    if (/relation "public.content_reports" does not exist|function public\.\w+\(.*\) does not exist/.test(out)) {
      throw new Error(`That database has no reports yet: apply the migrations first (${hosted ? 'merge to main' : 'npm run db:reset'}).`);
    }
    throw new Error(out);
  }
  const start = r.stdout.indexOf('{');
  return (JSON.parse(r.stdout.slice(start)) as { rows: T[] }).rows;
}

function literal(value: string | undefined, what: string): string {
  if (!value || !/^[A-Za-z0-9:_.-]{1,100}$/.test(value)) throw new Error(`Give a ${what}.`);
  return `'${value}'`;
}

interface OpenRow {
  id: string; created_at: string; org: string; language_id: string | null; target_kind: string; target_id: string;
  unit_id: string | null; reported_profile: string; reported_name: string | null;
  reported_email: string | null; reporter_id: string | null; reason: string; details: string | null;
  content: { type: string; payload: Record<string, unknown> }[] | null;
}

function list(): void {
  const rows = query<OpenRow>(`
    select r.id, r.created_at,
      coalesce((select e.payload->>'name' from public.events e where e.org_id = r.org_id and e.stream_id = '_org'
        and e.type = 'v1.OrgCreated' order by e.hlc desc limit 1), r.org_id) || ' (' || r.org_id || ')' as org,
      r.language_id, r.target_kind, r.target_id, r.unit_id, r.reported_profile,
      (select p.display_name from public.profiles p where p.id = r.reported_profile) as reported_name,
      (select u.email from auth.users u where u.id::text = r.reported_profile) as reported_email,
      r.reporter_id, r.reason, r.details,
      (select jsonb_agg(jsonb_build_object('type', e.type, 'payload', e.payload) order by e.server_seq)
         from public._content_events(r.org_id, r.language_id, r.target_kind, r.target_id) c
         join public.events e on e.id = c.event_id where not c.redacted) as content
    from public.content_reports r where r.resolved_at is null order by r.created_at`);
  if (asJson) { console.log(JSON.stringify(rows, null, 2)); return; }
  if (!rows.length) { console.log('No open reports.'); return; }
  for (const r of rows) {
    console.log(`\n${r.id}  ${r.created_at}  ${r.reason}`);
    console.log(`  ${r.target_kind} ${r.target_id} in ${r.org}${r.language_id ? `, language ${r.language_id}` : ''}${r.unit_id ? `, unit ${r.unit_id}` : ''}`);
    console.log(`  made by ${r.reported_name ?? '(no name)'} <${r.reported_email ?? 'deleted'}> ${r.reported_profile}`);
    console.log(`  reported by ${r.reporter_id ?? '(account deleted)'}`);
    if (r.details) console.log(`  they said: ${r.details}`);
    for (const c of r.content ?? []) console.log(`  ${c.type} ${JSON.stringify(c.payload)}`);
    if (r.target_kind !== 'person' && !r.content?.length) console.log('  (already gone from the record)');
  }
  console.log(`\n${rows.length} open. Audio is in R2 by hash (cardHashes, blobHash).`);
}

function main(): void {
  switch (command) {
    case 'list': list(); break;
    case 'remove':
    case 'dismiss': {
      const [row] = query<{ n: number }>(`select public.staff_resolve_report(${literal(arg, 'report id')}, '${command}') as n`);
      console.log(command === 'remove' ? `Removed: ${row?.n ?? 0} events redacted.` : 'Dismissed.');
      break;
    }
    case 'suspend':
    case 'unsuspend': {
      const [row] = query<{ found: boolean }>(`select public.suspend_account(${literal(arg, 'profile id')}, ${command === 'suspend'}) as found`);
      console.log(row?.found ? `${command === 'suspend' ? 'Suspended' : 'Let back in'}.` : 'No account has that id.');
      break;
    }
    default:
      console.error('Use: list, remove <reportId>, dismiss <reportId>, suspend <profileId>, unsuspend <profileId> [--hosted] [--json]');
      process.exitCode = 1;
  }
}

try {
  main();
} catch (e) {
  // A message for staff, not a stack trace.
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}
