// Field diagnostics, read as support (docs/diagnostics.md).
//
//   npm run diag -- find <org or language name or id>
//   npm run diag -- report <org> <language> [--days 14] [--install <id>] [--json]
//   npm run diag -- org <org> [--days 14] [--json]       every member's phones, for people who never open a language
//   npm run diag -- person <profileId> [--days 14]      one account's phones, in no organization or waiting to join
//   npm run diag -- jobs [--days 2] [--job <name>]      the server's own jobs: push delivery, projections, import, webhooks
//   npm run diag -- inbox <org>                          push delivery for one organization (counts and ages)
//   npm run diag -- v2                                   the v2 import, per project
//   npm run diag -- error <E-XXXXXX>
//   npm run diag -- timeline <installId> [--days 2]
//   npm run diag -- feedback [--days 30] [--install <id>] [--shot <feedbackId>] [--voice <feedbackId>]
//   npm run diag -- --hosted …    the same against the hosted database
//
// Reads through the `diag` schema only, as `diag_reader` on a hosted
// database (DIAG_DATABASE_URL) or as postgres on the local one. Nothing it
// prints is content: ids, counts, timings, error class names and frames.
// The one exception is `feedback`, which is what people chose to send the
// LangQuest team from help mode (decisions.md 145): their words, and a name,
// an email and a screenshot only where they turned those on.
// --hosted decrypts DIAG_DATABASE_URL from .env.production for this run
// (scripts/diag-access.sh puts it there once).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { REDUCER_VERSION } from '../packages/core/src/index';
import { jobSignals, signals, throughput, type InstallSummary, type JobStat, type Member, type LanguageHealth, type RpcStat } from './diagSignals';

if (process.argv.includes('--hosted')) {
  const rest = process.argv.slice(1).filter((a) => a !== '--hosted');
  if (process.env.DIAG_DATABASE_URL) process.argv = [process.argv[0]!, ...rest];
  else if (process.env.DIAG_HOSTED_RUN) {
    // Decrypted, and still none: never fall back to the local database.
    console.error('x .env.production has no DIAG_DATABASE_URL; run scripts/diag-access.sh once (docs/diagnostics.md)');
    process.exit(1);
  } else {
    const r = spawnSync('npx', ['dotenvx', 'run', '-f', '.env.production', '-fk', '.env.keys', '--strict', '--', 'npx', 'tsx', ...process.argv.slice(1)],
      { stdio: 'inherit', env: { ...process.env, DIAG_HOSTED_RUN: '1' } });
    process.exit(r.status ?? 1);
  }
}

const LOCAL = 'postgresql://postgres:postgres@127.0.0.1:54422/postgres';
const url = process.env.DIAG_DATABASE_URL ?? LOCAL;

/** Run one statement returning a single JSON value. Variables are bound by psql, never spliced. */
function query<T>(sql: string, vars: Record<string, string> = {}): T {
  const args = [url, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'];
  for (const [k, v] of Object.entries(vars)) args.push('-v', `${k}=${v}`);
  const r = spawnSync('psql', args, { input: `${sql};\n`, encoding: 'utf8' });
  if (r.error) throw new Error(`psql not found or failed to start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(r.stderr.trim());
  return JSON.parse(r.stdout.trim() || 'null') as T;
}

function flag(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--'));
const [command, ...rest] = positional;
const asJson = process.argv.includes('--json');

interface Found { kind: 'org' | 'language'; org_id: string; language_id: string | null; name: string }

function find(text: string): Found[] {
  return query<Found[]>(`select coalesce(jsonb_agg(f), '[]') from diag.find(:'q') f`, { q: text });
}

/** An org and a language from names or ids; refuses to guess between several. */
function resolve(orgText: string, langText: string): { org: Found; lang: Found } {
  const orgs = find(orgText).filter((f) => f.kind === 'org');
  const org = orgs.find((f) => f.org_id === orgText) ?? (orgs.length === 1 ? orgs[0] : undefined);
  if (!org) throw new Error(orgs.length ? `"${orgText}" matches several orgs:\n${orgs.map((o) => `  ${o.org_id}  ${o.name}`).join('\n')}` : `No org matches "${orgText}".`);
  const langs = find(langText).filter((f) => f.kind === 'language' && f.org_id === org.org_id);
  const lang = langs.find((f) => f.language_id === langText) ?? (langs.length === 1 ? langs[0] : undefined);
  if (!lang) throw new Error(langs.length ? `"${langText}" matches several languages in ${org.name}:\n${langs.map((l) => `  ${l.language_id}  ${l.name}`).join('\n')}` : `No language in ${org.name} matches "${langText}".`);
  return { org, lang };
}

const mb = (b?: number | null) => (b ? `${(b / 1024 / 1024).toFixed(1)} MB` : '0');
const s = (ms?: number | null) => (ms ? `${(ms / 1000).toFixed(1)} s` : '-');

function report(orgText: string, langText: string): void {
  const { org, lang } = resolve(orgText, langText);
  const days = flag('days', '14')!;
  const vars = { org: org.org_id, lang: lang.language_id!, since: `${Number(days)} days`, install: flag('install') ?? '' };
  const health = query<LanguageHealth>(`select diag.language_health(:'org', :'lang', ${REDUCER_VERSION})`, vars);
  const members = query<Member[]>(`select coalesce(jsonb_agg(m), '[]') from diag.members(:'org', :'lang') m`, vars);
  const summary = query<Record<string, InstallSummary>>(`select diag.summary(:'org', :'lang', :'since'::interval, nullif(:'install', ''))`, vars);
  const rpc = query<RpcStat[]>(`select coalesce(jsonb_agg(r), '[]') from diag.rpc_stats() r`);
  const found = [...signals(health, members, summary, rpc), ...jobSignals(jobStats('2 days'))];
  if (asJson) {
    console.log(JSON.stringify({ org, language: lang, health, members, summary, rpc, signals: found }, null, 2));
    return;
  }
  const out: string[] = [];
  out.push(`# ${org.name} / ${lang.name}`, '', `org ${org.org_id} · language ${lang.language_id} · last ${days} days · reducer ${REDUCER_VERSION}`, '');
  out.push('## Signals', '');
  if (found.length === 0) out.push('Nothing stands out.');
  for (const f of found) out.push(`- **${f.level}**${f.install ? ` [${f.install}]` : ''} ${f.text}`);
  const snap = health.snapshots.find((x) => x.reducerVersion === REDUCER_VERSION);
  out.push('', '## Language stream', '',
    `- ${health.events.events} events (${health.events.events7d} in 7 days), last at ${health.events.lastEventAt ?? 'never'}`,
    `- snapshot for reducer ${REDUCER_VERSION}: ${snap ? `seq ${snap.seq}, ${snap.tail} behind, ${mb(snap.bytes)}, made ${snap.createdAt}` : 'none'}`,
    `- audio: ${health.blobs.count} files, ${mb(health.blobs.bytes)} (largest ${mb(health.blobs.maxBytes)})`,
    `- roles: ${Object.entries(health.roles).map(([r, n]) => `${r} ${n}`).join(', ') || 'none'}`);
  out.push('', '## Members', '', '| profile | roles | last event here | installs with diagnostics |', '|---|---|---|---|');
  for (const m of members) out.push(`| ${m.profile_id} | ${m.roles} | ${m.last_event_at ?? 'never'} | ${m.installs?.join(', ') ?? 'none'} |`);
  for (const [install, x] of Object.entries(summary)) out.push(...installLines(install, x));
  if (rpc.length) {
    out.push('', '## Server RPCs (all orgs, since stats reset)', '', '| rpc | calls | mean ms | max ms | rows/call |', '|---|---|---|---|---|');
    for (const r of rpc) out.push(`| ${r.rpc} | ${r.calls} | ${r.mean_ms} | ${r.max_ms} | ${r.rows_per_call} |`);
  }
  console.log(out.join('\n'));
}

/** `diag.jobs()` over a window; empty on a database without the jobs migration. */
function jobStats(since: string): JobStat[] {
  try {
    return query<JobStat[]>(`select coalesce(jsonb_agg(j), '[]') from diag.jobs(:'since'::interval) j`, { since });
  } catch {
    return [];
  }
}

/** The server's own jobs: which ran, which stopped, which keep failing. */
function jobsReport(): void {
  const since = `${Number(flag('days', '2'))} days`;
  const job = flag('job');
  if (job) {
    console.log(JSON.stringify(query(`select coalesce(jsonb_agg(h), '[]') from diag.job_history(:'job', :'since'::interval) h`, { job, since }), null, 2));
    return;
  }
  const jobs = query<JobStat[]>(`select coalesce(jsonb_agg(j), '[]') from diag.jobs(:'since'::interval) j`, { since });
  const found = jobSignals(jobs);
  if (asJson) {
    console.log(JSON.stringify({ jobs, signals: found }, null, 2));
    return;
  }
  const out = [`# Server jobs, last ${since}`, '', '## Signals', ''];
  if (found.length === 0) out.push('Nothing stands out.');
  for (const f of found) out.push(`- **${f.level}** ${f.text}`);
  out.push('', '| job | every | runs | failed | partial | streak | last | last ok | p95 ms | totals |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const j of jobs) {
    out.push(`| ${j.job}${j.stale ? ' (stale)' : ''} | ${j.every ?? '-'} | ${j.runs} | ${j.failures} | ${j.partials} | ${j.streak} | ${j.last_at ?? 'never'} ${j.last_outcome ?? ''}${j.last_error_class ? ` (${j.last_error_class})` : ''} | ${j.last_ok_at ?? '-'} | ${j.p95_ms ?? '-'} | ${JSON.stringify(j.totals ?? {})} |`);
  }
  console.log(out.join('\n'));
}

/** One install's section of a report: what it recorded, in the order support reads it. */
function installLines(install: string, x: InstallSummary & { roles?: string; languages?: Record<string, number> | null }): string[] {
  const c = x.context;
  const out = ['', `## Install ${install}`, '',
    `profile ${x.profileId}${x.roles ? ` (${x.roles})` : ''} · ${c.os ?? '?'} ${c.osVersion ?? ''} · ${c.model ?? '?'} · update ${c.updateId ?? 'embedded'} (${c.channel ?? '?'}) · last seen ${x.lastSeen}`];
  if (x.languages) out.push(`- languages recorded: ${Object.entries(x.languages).map(([l, n]) => `${l} (${n})`).join(', ')}`);
  if (x.sync) {
    out.push(`- sync: ${x.sync.count} recorded, p50 ${s(x.sync.p50Ms)}, p95 ${s(x.sync.p95Ms)}; network ${s((x.sync.pullNetMs ?? 0) + (x.sync.pushNetMs ?? 0))} vs phone ${s(x.sync.applyMs)}; pulled ${x.sync.pulled ?? 0}; outcomes ${JSON.stringify(x.sync.outcomes ?? {})}`);
    const rej = Object.entries(x.sync.rejectedBy ?? {}).filter(([, n]) => n);
    if (rej.length) out.push(`- rejected: ${rej.map(([k, n]) => `${k} ${n}`).join(', ')}`);
    if (x.sync.errorCodes) out.push(`- sync errors: ${Object.entries(x.sync.errorCodes).map(([k, n]) => `${k} ×${n}`).join(', ')}`);
  }
  if (x.orgSync) out.push(`- organization stream: ${x.orgSync.count} syncs, p95 ${s(x.orgSync.p95Ms)}, outcomes ${JSON.stringify(x.orgSync.outcomes ?? {})}${x.orgSync.errorCodes ? `, errors ${JSON.stringify(x.orgSync.errorCodes)}` : ''}`);
  const transfers: [string, Record<string, number | undefined>][] = [
    ...Object.entries(x.transfer ?? {}).map(([dir, t]) => [dir === 'down' ? 'downloads' : 'uploads', t] as [string, Record<string, number | undefined>]),
    ...Object.entries(x.otherTransfer ?? {}).map(([k, t]) => [k, t] as [string, Record<string, number | undefined>])
  ];
  for (const [what, t] of transfers) {
    const rate = throughput(t);
    const fails = Object.entries(t).filter(([k, n]) => k.startsWith('fail') && n).map(([k, n]) => `${k.slice(4)} ${n}`);
    out.push(`- ${what}: ${t.count} files, ${mb(t.bytes)}, ${rate ? `${(rate / 1024).toFixed(1)} KB/s` : '-'}; sign ${s(t.signMs)}, network ${s(t.fetchMs)}, verify ${s(t.verifyMs)}; slowest ${s(t.maxMs)}${fails.length ? `; failed: ${fails.join(', ')}` : ''}`);
  }
  if (x.load) out.push(`- open: p50 ${s(x.load.p50Ms)}, p95 ${s(x.load.p95Ms)}, up to ${x.load.maxEvents} events; read ${s(x.load.readMs)}, fold ${s(x.load.foldMs)}; folds by reason ${JSON.stringify(x.load.reasons ?? {})}`);
  if (x.checkpoints) out.push(`- checkpoints: ${x.checkpoints.count}, p95 ${s(x.checkpoints.p95Ms)}, up to ${x.checkpoints.maxKb ?? '?'} KB`);
  for (const o of x.opens ?? []) out.push(`- first pull of ${o.streamId}${o.cold === 'yes' ? ' (cold)' : ''}: ${s(o.ms)} over ${o.syncs ?? '?'} syncs, snapshot ${s(o.snapshotMs)}, at ${o.at}`);
  if (x.device) {
    const d = x.device;
    out.push(`- phone: ${d.freeDiskMb ?? '?'} MB free of ${d.totalDiskMb ?? '?'}, audio cache ${d.blobCacheMb ?? '?'} MB, ${d.blobsWanted ?? '?'} files still wanted; ${d.streams ?? '?'} streams, ${d.localEvents ?? '?'} events, database ${d.dbMb ?? '?'} MB`);
    out.push(`- work waiting: ${d.uploadsWaiting ?? '?'} uploads (oldest ${d.oldestUnsentMin ?? '?'} min), ${d.journalPending ?? 0} takes mid-save, ${d.journalFailed ?? 0} not recovered, ${d.lostFiles ?? 0} files lost (${d.lostRecordings ?? 0} unsent recordings); diagnostics queued ${d.diagQueued ?? '?'}, dropped ${x.diagDropped ?? 0}`);
  }
  if (x.audio) out.push(`- audio: ${Object.entries(x.audio).filter(([, n]) => n).map(([k, n]) => `${k} ${k.endsWith('Ms') ? s(n) : n}`).join(', ')}`);
  for (const g of x.auth ?? []) out.push(`- auth ${g.op}${g.action ? `/${g.action}` : ''}: ${g.outcome}${g.code ? ` (${g.code})` : ''} ×${g.count}, last ${g.lastAt}${g.last ? ` ${JSON.stringify(g.last)}` : ''}`);
  for (const e of x.expected ?? []) out.push(`- expected: ${e.count}× "${e.where}" ${e.name}${e.code ? ` (${e.code})` : ''}, last ${e.lastAt}`);
  for (const e of x.errors ?? []) out.push(`- error: ${e.count}× ${e.name}${e.code ? ` (${e.code})` : ''} at "${e.where}", latest ${e.lastErrorId}`);
  return out;
}

interface OrgSummary {
  installs: Record<string, InstallSummary & { roles?: string; languages?: Record<string, number> | null }>;
  silent: { profileId: string; roles: string }[];
}

/** Every member's phones in an organization, whatever language they opened, and the members never heard from. */
function orgReport(orgText: string): void {
  const orgs = find(orgText).filter((f) => f.kind === 'org');
  const org = orgs.find((f) => f.org_id === orgText) ?? (orgs.length === 1 ? orgs[0] : undefined);
  if (!org) throw new Error(orgs.length ? `"${orgText}" matches several orgs:\n${orgs.map((o) => `  ${o.org_id}  ${o.name}`).join('\n')}` : `No org matches "${orgText}".`);
  const days = flag('days', '14')!;
  const summary = query<OrgSummary>(`select diag.org_summary(:'org', :'since'::interval)`, { org: org.org_id, since: `${Number(days)} days` });
  const found = signals(null, [], summary.installs, []);
  if (asJson) {
    console.log(JSON.stringify({ org, summary, signals: found }, null, 2));
    return;
  }
  const out = [`# ${org.name}`, '', `org ${org.org_id} · last ${days} days · ${Object.keys(summary.installs).length} installs`, '', '## Signals', ''];
  if (found.length === 0) out.push('Nothing stands out.');
  for (const f of found) out.push(`- **${f.level}**${f.install ? ` [${f.install}]` : ''} ${f.text}`);
  for (const m of summary.silent) out.push(`- **watch** Member ${m.profileId} (${m.roles}) has never delivered diagnostics.`);
  for (const [install, x] of Object.entries(summary.installs)) out.push(...installLines(install, x));
  console.log(out.join('\n'));
}

/** One account's phones, whatever organization: someone in none yet, or waiting on a join request. */
function personReport(profileId: string): void {
  const days = flag('days', '14')!;
  const installs = query<Record<string, InstallSummary & { orgs?: string[] | null }>>(`select diag.person(:'p', :'since'::interval)`, { p: profileId, since: `${Number(days)} days` });
  const withProfile = Object.fromEntries(Object.entries(installs).map(([k, v]) => [k, { ...v, profileId }]));
  const found = signals(null, [], withProfile, []);
  if (asJson) {
    console.log(JSON.stringify({ profileId, installs, signals: found }, null, 2));
    return;
  }
  const out = [`# Profile ${profileId}`, '', `last ${days} days · ${Object.keys(installs).length} installs`, '', '## Signals', ''];
  if (Object.keys(installs).length === 0) out.push('No install has delivered diagnostics for this account.');
  else if (found.length === 0) out.push('Nothing stands out.');
  for (const f of found) out.push(`- **${f.level}**${f.install ? ` [${f.install}]` : ''} ${f.text}`);
  for (const [install, x] of Object.entries(withProfile)) out.push(...installLines(install, { ...x, languages: null }), ...(x.orgs?.length ? [`- organizations: ${x.orgs.join(', ')}`] : []));
  console.log(out.join('\n'));
}

interface Feedback {
  id: string; created_at: string; kind: 'bug' | 'idea'; body: string; status: string; install_id: string;
  context: Record<string, string>; has_screenshot: boolean; shared_name: string | null; shared_email: string | null;
  voice_format: 'm4a' | 'wav' | null; voice_ms: number | null;
}

/** Feedback from help mode, newest first; `--shot <id>` and `--voice <id>` save one report's screenshot or voice note beside you. */
function feedbackReport(): void {
  const voice = flag('voice');
  if (voice) {
    const row = query<{ b64: string | null; format: string | null } | null>(
      `select jsonb_build_object('b64', encode(diag.feedback_voice(:'id'::uuid), 'base64'), 'format', (select f.voice_format from diag.feedback('3650 days') f where f.id = :'id'::uuid))`, { id: voice });
    if (!row?.b64) throw new Error(`Feedback ${voice} has no voice note.`);
    const file = `feedback-${voice}.${row.format ?? 'm4a'}`;
    writeFileSync(file, Buffer.from(row.b64.replace(/\s+/g, ''), 'base64'));
    console.log(`saved ${file}`);
    return;
  }
  const shot = flag('shot');
  if (shot) {
    const b64 = query<string | null>(`select to_jsonb(encode(diag.feedback_screenshot(:'id'::uuid), 'base64'))`, { id: shot });
    if (!b64) throw new Error(`Feedback ${shot} has no screenshot.`);
    const file = `feedback-${shot}.jpg`;
    writeFileSync(file, Buffer.from(b64.replace(/\s+/g, ''), 'base64'));
    console.log(`saved ${file}`);
    return;
  }
  const rows = query<Feedback[]>(`select coalesce(jsonb_agg(f), '[]') from diag.feedback(:'since'::interval, nullif(:'install', '')) f`,
    { since: `${Number(flag('days', '30'))} days`, install: flag('install', '')! });
  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  if (rows.length === 0) console.log('No feedback in that time.');
  for (const f of rows) {
    const c = f.context;
    const who = f.shared_name || f.shared_email ? ` · ${[f.shared_name, f.shared_email].filter(Boolean).join(' · ')}` : '';
    console.log([
      `## ${f.kind === 'bug' ? 'Problem' : 'Idea'} · ${f.created_at} · ${f.status}${who}`,
      [`id ${f.id}`, `install ${f.install_id}`, c.screen, [c.os, c.osVersion].filter(Boolean).join(' '), c.model,
        `app ${c.runtimeVersion ?? '?'} (${c.channel ?? '?'})`, c.uiLanguage, f.has_screenshot ? `screenshot: --shot ${f.id}` : undefined,
        f.voice_format ? `voice note ${Math.round((f.voice_ms ?? 0) / 1000)} s: --voice ${f.id}` : undefined]
        .filter(Boolean).join(' · '),
      '',
      f.body || '(said in the voice note)',
      '',
      `diagnostics: npm run diag -- timeline ${f.install_id} --days 2`,
      ''
    ].join('\n'));
  }
}

function main(): void {
  switch (command) {
    case 'find':
      console.table(find(rest.join(' ')));
      return;
    case 'report':
      if (rest.length < 2) throw new Error('usage: npm run diag -- report <org> <language> [--days 14] [--install <id>] [--json]');
      report(rest[0]!, rest[1]!);
      return;
    case 'org':
      if (rest.length < 1) throw new Error('usage: npm run diag -- org <org> [--days 14] [--json]');
      orgReport(rest.join(' '));
      return;
    case 'person':
      if (rest.length < 1) throw new Error('usage: npm run diag -- person <profileId> [--days 14] [--json]');
      personReport(rest[0]!);
      return;
    case 'jobs':
      jobsReport();
      return;
    case 'inbox': {
      if (rest.length < 1) throw new Error('usage: npm run diag -- inbox <org>');
      const orgs = find(rest.join(' ')).filter((f) => f.kind === 'org');
      const org = orgs.find((f) => f.org_id === rest[0]) ?? (orgs.length === 1 ? orgs[0] : undefined);
      if (!org) throw new Error(`"${rest.join(' ')}" matches ${orgs.length ? 'several orgs' : 'no org'}.`);
      console.log(JSON.stringify(query(`select diag.inbox_health(:'org')`, { org: org.org_id }), null, 2));
      return;
    }
    case 'v2':
      console.log(JSON.stringify(query(`select coalesce(jsonb_agg(v), '[]') from diag.v2_import_status() v`), null, 2));
      return;
    case 'error':
      console.log(JSON.stringify(query(`select diag.error(:'id')`, { id: rest[0] ?? '' }), null, 2));
      return;
    case 'timeline':
      console.log(JSON.stringify(query(`select coalesce(jsonb_agg(x), '[]') from diag.timeline(:'install', :'since'::interval) x`, { install: rest[0] ?? '', since: `${Number(flag('days', '2'))} days` }), null, 2));
      return;
    case 'feedback':
      feedbackReport();
      return;
    default:
      console.log('usage: npm run diag -- find <text> | report <org> <language> | org <org> | person <profileId> | jobs | inbox <org> | v2 | error <id> | timeline <installId> | feedback');
  }
}

try {
  main();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
