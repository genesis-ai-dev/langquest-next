#!/usr/bin/env node
/**
 * The nightly phone tests' report (.github/workflows/phone-tests.yml,
 * decision 207). Each night the phone flows (apps/mobile/test/maestro) run
 * on an Android emulator and an iPhone simulator; this turns what they left
 * into one summary, files each failure in Linear, and puts the summary and a
 * picture of each failed screen where the ops dashboard reads them.
 *
 *   summary  --in <dir> --out <dir> --sha <sha> --url <run> [--event <e>] [--status android=success,ios=failure]
 *            reads <in>/android and <in>/ios (each phone job's results:
 *            Maestro's junit report, its output with the screenshot it takes
 *            when a flow fails, skipped.json, device.json) and writes
 *            <out>/summary.json and <out>/shots/
 *   look     --out <dir>   adds Claude's words (<out>/look.json) to the summary
 *   linear   --out <dir> [--dry-run]   files failures in Linear, as the web
 *            suite's nightly does (scripts/nightly-report.mjs): one issue per
 *            failing flow and phone, under LAN-210, with its picture; one for
 *            a phone's run when it broke as a whole; a failure that stays adds
 *            nothing, a turn either way is a comment. Writes each issue's id
 *            into the summary.
 *   publish  --out <dir>   puts summary.json, history.json (the last 30
 *            nights) and the pictures in the repository's `phone-tests`
 *            release (gh, GH_TOKEN), and removes pictures older than 14 days
 *   markdown --out <dir>   the run's summary page, for $GITHUB_STEP_SUMMARY
 *
 * The release is public, as the repository is: the pictures show the test
 * server's made-up organization and people only, never anyone's real work.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dryApi, flags, linearApi, plan, PREFIX } from './nightly-report.mjs';

export const PLATFORMS = {
  android: { label: 'Android emulator', short: 'Android' },
  ios: { label: 'iPhone simulator', short: 'iPhone' }
};
export const RELEASE = 'phone-tests';
/** More failing flows than this on one phone is one cause (the server or the phone down), filed once. */
export const MANY = 10;
/** The Linear issue the nightly failures are filed under. */
export const PARENT = 'LAN-210';
export const HISTORY_NIGHTS = 30;
export const SHOT_DAYS = 14;
export const CAUSES = ['app', 'test', 'machine'];
const FLOWS_DIR = 'apps/mobile/test/maestro/flows';

const unescapeXml = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const plain = (text) => text.replace(/\x1b\[[0-9;]*m/g, '');
export function excerpt(text, chars = 1200) {
  const t = plain(text).trim();
  return t.length > chars ? `${t.slice(0, chars)}…` : t;
}

/** Each flow in a Maestro junit report: its name, seconds, and whether it passed, with the error when not. */
export function junitFlows(xml) {
  const out = [];
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const attrs = Object.fromEntries([...m[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((a) => [a[1], unescapeXml(a[2])]));
    const inner = m[2] ?? '';
    if (/<skipped\b/.test(inner)) continue;
    const failure = /<(failure|error)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/.exec(inner);
    const failed = Boolean(failure) || ['ERROR', 'FAILURE', 'FAILED'].includes((attrs.status ?? '').toUpperCase());
    const message = failure ? (unescapeXml(failure[3] ?? '').trim() || unescapeXml(/message="([^"]*)"/.exec(failure[2])?.[1] ?? '')) : '';
    out.push({
      name: attrs.name || attrs.id || attrs.classname || 'flow',
      seconds: Number.isFinite(Number(attrs.time)) && attrs.time !== undefined ? Number(attrs.time) : null,
      passed: !failed,
      error: failed ? excerpt(message || 'failed') : null
    });
  }
  return out;
}

/** A name as a file name: lower case, letters and digits, dashes between. */
export const slug = (name) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'flow';

/** Each flow file's name (its `name:`, as Maestro reports it) and file. */
export function flowFiles(dir) {
  if (!existsSync(dir)) return new Map();
  return new Map(readdirSync(dir).filter((f) => f.endsWith('.yaml')).map((f) => {
    const head = readFileSync(join(dir, f), 'utf8').split(/^---\s*$/m)[0] ?? '';
    const name = /^name:\s*"?(.+?)"?\s*$/m.exec(head)?.[1] ?? f.replace(/\.yaml$/, '');
    return [name, f];
  }));
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/**
 * The screenshot Maestro took when a flow failed (`screenshot-❌-<time>-(<flow>).png`
 * in its output), or the newest picture that names the flow.
 */
export function shotFor(files, name) {
  const named = files.filter((f) => f.endsWith('.png') && basename(f).includes(`(${name})`));
  const failed = named.filter((f) => basename(f).includes('❌'));
  const pick = (list) => [...list].sort((a, b) => basename(b).localeCompare(basename(a)))[0] ?? null;
  return pick(failed) ?? pick(named);
}

const readJson = (file, fallback) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
};
const said = (status) => (status === 'failure' ? 'failed' : status === 'cancelled' ? 'was cancelled' : status === 'skipped' ? 'did not run' : `ended ${status ?? 'without a status'}`);

/**
 * One phone's night, from its results folder. `status` is its job's result
 * (success, failure, cancelled, skipped). `day` (YYYYMMDD) starts each
 * picture's name, so a night's pictures never replace another's.
 */
export function platformSummary(platform, dir, status, { day, files = new Map(), shotsOut = null } = {}) {
  const reports = ['report-ordered.xml', 'report.xml'].map((f) => join(dir, f)).filter((f) => existsSync(f));
  const tests = reports.length ? reports.flatMap((f) => junitFlows(readFileSync(f, 'utf8'))) : null;
  const all = walk(dir);
  const device = readJson(join(dir, 'device.json'), {});
  const notRun = readJson(join(dir, 'skipped.json'), []).map((s) => ({ flow: s.flow, why: s.why }));
  const flows = (tests ?? []).map((t) => {
    let shot = null;
    if (!t.passed) {
      const found = shotFor(all, t.name);
      if (found) {
        shot = `${day}-${platform}-${slug(t.name)}.png`;
        if (shotsOut) copyFileSync(found, join(shotsOut, shot));
      }
    }
    return { name: t.name, file: files.get(t.name) ?? null, passed: t.passed, seconds: t.seconds, error: t.error, shot };
  }).sort((a, b) => Number(a.passed) - Number(b.passed));
  const failed = flows.filter((f) => !f.passed).length;
  let broke = null;
  if (!tests) broke = `The ${PLATFORMS[platform].label} job ${said(status)} before the flows ran to the end, and left no report.`;
  else if (!flows.length) broke = `The ${PLATFORMS[platform].label} job ${said(status)} and no flow ran.`;
  else if (failed > MANY) broke = `${failed} of ${flows.length} flows failed on the ${PLATFORMS[platform].label}: one cause, most likely the test server or the phone, rather than ${failed}.`;
  else if (status !== 'success' && !failed) broke = `The ${PLATFORMS[platform].label} job ${said(status)} with every flow that ran passing: a step around the flows broke.`;
  return {
    platform, label: PLATFORMS[platform].label,
    device: typeof device.device === 'string' ? device.device : null,
    os: typeof device.os === 'string' ? device.os : null,
    status: status ?? 'unknown', broke,
    ran: flows.length, passed: flows.length - failed, failed,
    seconds: flows.reduce((s, f) => s + (f.seconds ?? 0), 0) || null,
    notRun, flows
  };
}

/** The night as a whole. */
export function nightSummary({ inDir, sha, url, event, statuses, at = new Date(), shotsOut = null, flowsDir = FLOWS_DIR }) {
  const day = at.toISOString().slice(0, 10).replace(/-/g, '');
  const files = flowFiles(flowsDir);
  const platforms = Object.keys(PLATFORMS)
    // A phone a manual run left out is not in the night at all.
    .filter((p) => existsSync(join(inDir, p)) || (statuses[p] !== undefined && statuses[p] !== 'skipped'))
    .map((p) => platformSummary(p, join(inDir, p), statuses[p], { day, files, shotsOut }));
  return { version: 1, at: at.toISOString(), sha, url, event: event ?? null, platforms };
}

/** Claude's words for each failed flow (look.json), checked, added to the summary. Anything else in the file is left out. */
export function addLook(summary, look) {
  if (!Array.isArray(look)) return summary;
  for (const item of look) {
    if (!item || typeof item !== 'object') continue;
    const p = summary.platforms.find((x) => x.platform === item.platform);
    const flow = p?.flows.find((f) => f.name === item.flow && !f.passed);
    if (!flow || typeof item.what !== 'string' || !item.what.trim()) continue;
    flow.what = excerpt(item.what.replace(/\s+/g, ' '), 300);
    if (CAUSES.includes(item.cause)) flow.cause = item.cause;
  }
  return summary;
}

// --- Linear -------------------------------------------------------------------------

export const runKey = (p) => `the ${PLATFORMS[p.platform].label} phone tests`;
export const flowKey = (p, flow) => `${flow.name} [${PLATFORMS[p.platform].label}]`;
export const PICTURE = '{{picture}}';

const NEXT = 'Fix it and name this issue in the commit. If the flow fails without a product cause, fix the flow, or tag it `quarantine` and name this issue beside the tag (docs/testing.md).';

function flowBody(p, flow, summary) {
  const file = flow.file ? `${FLOWS_DIR}/${flow.file}` : null;
  const avd = p.platform === 'android' ? '<avd name>' : '<simulator udid>';
  return [
    ...(flow.what ? [`**What went wrong:** ${flow.what}`, ''] : []),
    `The phone flow ${file ? `\`${file}\`` : `"${flow.name}"`} failed on the ${p.label}${p.os ? ` (${p.os})` : ''} in the nightly run at ${summary.sha.slice(0, 7)}: ${summary.url}`,
    '',
    ...(flow.shot ? [PICTURE, ''] : []),
    '```',
    flow.error ?? 'failed',
    '```',
    '',
    `Here: \`npm run test:ui:build -- --platform ${p.platform} --device ${avd}\`, then \`npm run test:ui:phone -- --platform ${p.platform}${file ? ` --flow ${file}` : ''}\`. The run's pictures and logs are in its \`phone-tests-${p.platform}\` artifact, and the ops dashboard's Phone tests section shows the last night.`,
    '',
    NEXT
  ].join('\n');
}

/** What one night says, as outcomes for nightly-report's `plan`: one per phone's run, one per flow that ran. */
export function phoneOutcomes(summary) {
  const out = [];
  for (const p of summary.platforms) {
    if (p.status === 'skipped' && !p.ran) continue;
    if (p.broke) out.push({ key: runKey(p), passed: false, body: `${p.broke}\n\nRun: ${summary.url}` });
    else out.push({ key: runKey(p), passed: true });
    if (p.failed > MANY) continue;
    for (const f of p.flows) {
      if (f.passed) out.push({ key: flowKey(p, f), passed: true });
      else out.push({ key: flowKey(p, f), passed: false, body: flowBody(p, f, summary), shot: f.shot });
    }
  }
  return out;
}

async function gql(key, query, variables) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: key },
    body: JSON.stringify({ query, variables })
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`Linear: ${JSON.stringify(json.errors ?? res.status)}`);
  return json.data;
}

/** Linear as the reporter uses it, plus a parent for new issues and a picture upload. */
export function phoneLinearApi(key) {
  const base = linearApi(key);
  let ids;
  return {
    issues: base.issues,
    comment: base.comment,
    async create(title, description) {
      ids ??= await gql(key, `query($id: String!) { issue(id: $id) { id team { id } } }`, { id: PARENT }).then((d) => ({ parentId: d.issue.id, teamId: d.issue.team.id }));
      const data = await gql(key, `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { issue { identifier } } }`,
        { input: { teamId: ids.teamId, parentId: ids.parentId, title, description } });
      return data.issueCreate.issue.identifier;
    },
    /** Puts a picture in Linear's own storage and returns its address, so an issue keeps its picture after the release drops it. */
    async upload(file) {
      const bytes = readFileSync(file);
      const data = await gql(key, `mutation($type: String!, $name: String!, $size: Int!) { fileUpload(contentType: $type, filename: $name, size: $size) { uploadFile { uploadUrl assetUrl headers { key value } } } }`,
        { type: 'image/png', name: basename(file), size: bytes.length });
      const u = data.fileUpload.uploadFile;
      const res = await fetch(u.uploadUrl, { method: 'PUT', body: bytes, headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000', ...Object.fromEntries(u.headers.map((h) => [h.key, h.value])) } });
      if (!res.ok) throw new Error(`Linear upload: HTTP ${res.status}`);
      return u.assetUrl;
    }
  };
}

/**
 * Tells Linear, and returns each failed flow's issue: the one opened now or
 * the open one it already had. `shotsDir` holds the pictures named in the
 * outcomes; a picture that will not upload leaves the issue without it.
 */
export async function file(api, summary, shotsDir) {
  const outcomes = phoneOutcomes(summary);
  const issues = await api.issues();
  const actions = plan(issues, outcomes, summary.sha, summary.url);
  const said = [];
  const issueOf = new Map();
  for (const a of actions) {
    if (a.create) {
      const o = outcomes.find((x) => `${PREFIX}${x.key}` === a.create.title);
      let picture = '';
      if (o?.shot && api.upload && existsSync(join(shotsDir, o.shot))) {
        picture = await api.upload(join(shotsDir, o.shot)).then((u) => `![The screen when the flow failed](${u})`, (e) => (said.push(`picture not uploaded: ${e.message}`), ''));
      }
      const id = await api.create(a.create.title, a.create.description.replace(PICTURE, picture));
      issueOf.set(a.create.title, id);
      said.push(`opened ${id}: ${a.create.title}`);
    } else {
      await api.comment(a.comment.issue.id, a.comment.body);
      said.push(`${a.comment.issue.identifier}: ${a.comment.body.split(' · ')[0]}`);
    }
  }
  const open = (title) => issues.filter((i) => i.title === title && !['completed', 'canceled'].includes(i.stateType))
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0]?.identifier;
  for (const p of summary.platforms) {
    for (const f of p.flows.filter((x) => !x.passed)) {
      const title = `${PREFIX}${flowKey(p, f)}`;
      const id = issueOf.get(title) ?? open(title);
      if (id) f.issue = id;
    }
    if (p.broke) {
      const title = `${PREFIX}${runKey(p)}`;
      const id = issueOf.get(title) ?? open(title);
      if (id) p.issue = id;
    }
  }
  if (!said.length) said.push('nothing new to tell Linear');
  return said;
}

// --- The release the ops dashboard reads ----------------------------------------------

/** The night added to the history, newest first, at most HISTORY_NIGHTS. */
export function addToHistory(history, summary) {
  const night = {
    at: summary.at, sha: summary.sha, url: summary.url, event: summary.event,
    platforms: summary.platforms.map((p) => ({ platform: p.platform, status: p.status, broke: Boolean(p.broke), ran: p.ran, passed: p.passed, failed: p.failed }))
  };
  const before = Array.isArray(history) ? history.filter((n) => n && n.url !== summary.url) : [];
  return [night, ...before].slice(0, HISTORY_NIGHTS);
}

/** The release's pictures older than SHOT_DAYS, by the day their name starts with. */
export function oldShots(names, now = new Date()) {
  const cutoff = new Date(now.getTime() - SHOT_DAYS * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
  return names.filter((n) => /^\d{8}-.+\.png$/.test(n) && n.slice(0, 8) < cutoff);
}

function gh(args, { input, quiet } = {}) {
  const r = spawnSync('gh', args, { encoding: 'utf8', input, stdio: [input ? 'pipe' : 'ignore', 'pipe', quiet ? 'pipe' : 'inherit'] });
  return { ok: r.status === 0, out: r.stdout ?? '' };
}

function publish(out) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set');
  const summary = readJson(join(out, 'summary.json'), null);
  if (!summary) throw new Error(`${out}/summary.json is missing`);
  if (!gh(['release', 'view', RELEASE, '--repo', repo], { quiet: true }).ok) {
    if (!gh(['release', 'create', RELEASE, '--repo', repo, '--prerelease', '--latest=false', '--title', 'Nightly phone tests',
      '--notes', 'What the nightly phone tests found (.github/workflows/phone-tests.yml): summary.json for the last night, history.json for the last 30, and a picture of each failed screen. The ops dashboard reads them. Made-up test data only.']).ok) {
      throw new Error(`could not make the ${RELEASE} release`);
    }
  }
  const tmp = join(out, 'release');
  mkdirSync(tmp, { recursive: true });
  gh(['release', 'download', RELEASE, '--repo', repo, '-p', 'history.json', '-D', tmp, '--clobber'], { quiet: true });
  writeFileSync(join(out, 'history.json'), JSON.stringify(addToHistory(readJson(join(tmp, 'history.json'), []), summary), null, 2));
  const shots = existsSync(join(out, 'shots')) ? readdirSync(join(out, 'shots')).map((f) => join(out, 'shots', f)) : [];
  // Pictures first, so the summary never names one that is not there yet.
  for (const files of [shots, [join(out, 'history.json'), join(out, 'summary.json')]]) {
    if (files.length && !gh(['release', 'upload', RELEASE, '--repo', repo, '--clobber', ...files]).ok) throw new Error('could not upload to the release');
  }
  const names = JSON.parse(gh(['release', 'view', RELEASE, '--repo', repo, '--json', 'assets'], { quiet: true }).out || '{"assets":[]}').assets.map((a) => a.name);
  for (const name of oldShots(names)) gh(['release', 'delete-asset', RELEASE, name, '--repo', repo, '--yes']);
  console.log(`put ${shots.length} picture(s), summary.json and history.json in the ${RELEASE} release`);
}

// --- The run's summary page --------------------------------------------------------------

export function markdown(summary) {
  const lines = ['## Nightly phone tests', '', `Commit ${summary.sha.slice(0, 7)} · [run](${summary.url})`, '',
    '| Phone | Passed | Failed | Not run |', '| --- | --- | --- | --- |'];
  for (const p of summary.platforms) lines.push(`| ${p.label}${p.os ? ` (${p.os})` : ''} | ${p.passed} | ${p.failed} | ${p.notRun.length} |`);
  for (const p of summary.platforms) {
    if (p.broke) lines.push('', `**${p.label}:** ${p.broke}`);
    const failed = p.flows.filter((f) => !f.passed);
    if (!failed.length) continue;
    lines.push('', `### Failed on the ${p.label}`, '');
    for (const f of failed) lines.push(`- **${f.name}**${f.issue ? ` (${f.issue})` : ''}: ${f.what ?? (f.error ?? '').split('\n')[0]}`);
  }
  return `${lines.join('\n')}\n`;
}

// --- CLI ----------------------------------------------------------------------------

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opt = flags(rest);
  const out = opt.out;
  if (!out || !['summary', 'look', 'linear', 'publish', 'markdown'].includes(command)) {
    console.error('usage: phone-tests.mjs summary|look|linear|publish|markdown --out <dir> (see the file\'s header)');
    process.exit(2);
  }
  const summaryFile = join(out, 'summary.json');
  if (command === 'summary') {
    if (!opt.in || !opt.sha || !opt.url) throw new Error('summary needs --in, --sha and --url');
    const statuses = Object.fromEntries(String(opt.status ?? '').split(',').filter(Boolean).map((s) => s.split('=')));
    mkdirSync(join(out, 'shots'), { recursive: true });
    const summary = nightSummary({ inDir: opt.in, sha: opt.sha, url: opt.url, event: opt.event, statuses, shotsOut: join(out, 'shots') });
    writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    // What Claude looks at: the failed flows alone.
    const failures = summary.platforms.flatMap((p) => p.flows.filter((f) => !f.passed).map((f) => ({ platform: p.platform, flow: f.name, file: f.file, error: f.error, shot: f.shot })));
    writeFileSync(join(out, 'failures.json'), JSON.stringify(failures, null, 2));
    for (const p of summary.platforms) console.log(`${p.label}: ${p.passed} passed, ${p.failed} failed, ${p.notRun.length} not run${p.broke ? ` (${p.broke})` : ''}`);
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `failures=${failures.length}\n`, { flag: 'a' });
    return;
  }
  const summary = readJson(summaryFile, null);
  if (!summary) throw new Error(`${summaryFile} is missing: run summary first`);
  if (command === 'look') {
    writeFileSync(summaryFile, JSON.stringify(addLook(summary, readJson(join(out, 'look.json'), [])), null, 2));
  } else if (command === 'linear') {
    const key = process.env.LINEAR_API_KEY;
    if (!opt['dry-run'] && !key) {
      console.error('::error::Add the LINEAR_API_KEY secret; the nightly phone failures cannot be filed without it.');
      process.exit(1);
    }
    const api = opt['dry-run'] ? dryApi() : phoneLinearApi(key);
    for (const line of await file(api, summary, join(out, 'shots'))) console.log(line);
    writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
  } else if (command === 'publish') {
    publish(out);
  } else {
    process.stdout.write(markdown(summary));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
