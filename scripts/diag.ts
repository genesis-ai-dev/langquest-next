// Field diagnostics, read as support (docs/diagnostics.md).
//
//   npm run diag -- find <org or language name or id>
//   npm run diag -- report <org> <language> [--days 14] [--install <id>] [--json]
//   npm run diag -- error <E-XXXXXX>
//   npm run diag -- timeline <installId> [--days 2]
//
// Reads through the `diag` schema only, as `diag_reader` on a hosted
// database (DIAG_DATABASE_URL) or as postgres on the local one. Nothing it
// prints is content: ids, counts, timings, error class names and frames.
import { spawnSync } from 'node:child_process';
import { REDUCER_VERSION } from '../packages/core/src/index';
import { signals, throughput, type InstallSummary, type Member, type LanguageHealth, type RpcStat } from './diagSignals';

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
  const found = signals(health, members, summary, rpc);
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
  for (const [install, x] of Object.entries(summary)) {
    const c = x.context;
    out.push('', `## Install ${install}`, '',
      `profile ${x.profileId} · ${c.os ?? '?'} ${c.osVersion ?? ''} · ${c.model ?? '?'} · update ${c.updateId ?? 'embedded'} (${c.channel ?? '?'}) · last seen ${x.lastSeen}`);
    if (x.sync) out.push(`- sync: ${x.sync.count} recorded, p50 ${s(x.sync.p50Ms)}, p95 ${s(x.sync.p95Ms)}; network ${s((x.sync.pullNetMs ?? 0) + (x.sync.pushNetMs ?? 0))} vs phone ${s(x.sync.applyMs)}; pulled ${x.sync.pulled ?? 0}; outcomes ${JSON.stringify(x.sync.outcomes ?? {})}`);
    for (const [dir, t] of Object.entries(x.transfer ?? {})) {
      const rate = throughput(t);
      out.push(`- ${dir === 'down' ? 'downloads' : 'uploads'}: ${t.count} files, ${mb(t.bytes)}, ${rate ? `${(rate / 1024).toFixed(1)} KB/s` : '-'}; sign ${s(t.signMs)}, network ${s(t.fetchMs)}, verify ${s(t.verifyMs)}; slowest ${s(t.maxMs)}`);
    }
    if (x.load) out.push(`- open: p50 ${s(x.load.p50Ms)}, p95 ${s(x.load.p95Ms)}, up to ${x.load.maxEvents} events`);
    if (x.device) out.push(`- phone: ${x.device.freeDiskMb ?? '?'} MB free of ${x.device.totalDiskMb ?? '?'}, audio cache ${x.device.blobCacheMb ?? '?'} MB, ${x.device.blobsWanted ?? '?'} files still wanted`);
  }
  if (rpc.length) {
    out.push('', '## Server RPCs (all orgs, since stats reset)', '', '| rpc | calls | mean ms | max ms | rows/call |', '|---|---|---|---|---|');
    for (const r of rpc) out.push(`| ${r.rpc} | ${r.calls} | ${r.mean_ms} | ${r.max_ms} | ${r.rows_per_call} |`);
  }
  console.log(out.join('\n'));
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
    case 'error':
      console.log(JSON.stringify(query(`select diag.error(:'id')`, { id: rest[0] ?? '' }), null, 2));
      return;
    case 'timeline':
      console.log(JSON.stringify(query(`select coalesce(jsonb_agg(x), '[]') from diag.timeline(:'install', :'since'::interval) x`, { install: rest[0] ?? '', since: `${Number(flag('days', '2'))} days` }), null, 2));
      return;
    default:
      console.log('usage: npm run diag -- find <text> | report <org> <language> | error <id> | timeline <installId>');
  }
}

try {
  main();
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
