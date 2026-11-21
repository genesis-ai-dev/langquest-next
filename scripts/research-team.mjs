// The research team that looks ahead (docs/research-team.md,
// docs/decisions/2026-11-21-a-research-team-looks-ahead.md). Plain Node, no packages.
//
// One time each day, in the job `research` of .github/workflows/user-issues.yml, a lead (Claude, Opus)
// and its scouts look at what can break next: known security holes in the packages, new versions, and one
// more subject each weekday. Code collects the facts first (this file), so the agents spend their time
// on judgment. The lead checks each scout's claim and writes the day's report; scripts/agent-research.mjs
// checks it here (checkTeamReport), files each recommended item in Linear and tells the Worker.
//
//   facts ──▶ lead (Opus) ──Agent tool──▶ scouts side by side (Sonnet or Haiku, one per beat)
//         ──▶ lead checks each claim ──▶ report.json ──▶ checked here ──▶ Linear, the Research page
//
// The search for the same mistake in other places (the beat `twins`) is the older part of the team: its
// own step and checks (agent-research.mjs checkReport, the user-issues skill). The report lists it too.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The beats: what one scout looks into, how often, with which model. 'day' runs every day; mon to fri
 * once a week; 'sat-even' and 'sat-odd' every two weeks, on Saturdays of even or odd ISO weeks. Haiku
 * reads and sorts long lists (release notes, rules); Sonnet judges (does a hole reach our code, can
 * work be lost). The lead is Opus. apps/admin/src/researchTeam.ts draws the same list.
 */
export const BEATS = {
  security: {
    title: 'Security holes', every: 'day', model: 'sonnet',
    asks: 'Which known holes (CVE, GHSA, OSV) touch a package or tool that we ship or build with, and does each one reach our code?',
    brief: `1. Read "Known holes" in facts.md. For each one, find how the package gets in (its "via" path) and where it runs: in the app (phones and web), in the Worker (apps/web/worker), in the server jobs (server, supabase/functions), only in the build or the tests, or only in GitHub Actions.
2. Judge whether our code can reach the hole: read the advisory (WebFetch), then grep our code for the function or option it names. A hole in a test tool that runs only in GitHub Actions and that nothing outside can call is low. A malicious package (an OSV id MAL-...) is critical: say it first.
3. Find the fix: the first fixed version, and whether it is on the same major version (action "fix") or needs a major step (action "ask"). Several advisories with one fix are one item, tagged with the worst advisory's id.
4. Search the GitHub Advisory Database for holes of the last 3 days in our main stack that OSV may not have yet: Expo, React Native, React, @supabase/supabase-js, Supabase Auth and Storage, PostgreSQL, Cloudflare Workers (wrangler, workerd).`
  },
  versions: {
    title: 'New versions', every: 'day', model: 'haiku',
    asks: 'Which packages and tools that we use have a new version, what changed in it, and should we take it now, later or never?',
    brief: `1. Read "Packages with a new version" in facts.md. For each one on the same major version, read its release notes (its GitHub releases page or changelog). Look for security fixes, fixes to what we use (grep our code for the package) and breaking changes.
2. Recommend (action "fix") a step on the same major version only when it fixes something that touches us. Say "reject" when nothing in it is for us.
3. For a new major version (the Expo SDK, React Native, TypeScript, vitest, wrangler and others), write one "ask" item for each family: what it brings us, what it costs (breaking changes, a new store build) and when to do it.
4. Read "GitHub Actions" and "Tools" in facts.md: an Action or tool far behind is an "ask" item, because workflows wait for a developer.`
  },
  packages: {
    title: 'Package health', every: 'mon', model: 'haiku',
    asks: 'Is each package that we depend on still kept up? Look for deprecated, abandoned, far-behind, unused, doubled and heavy packages.',
    brief: `1. Read "Direct dependencies" in facts.md. For each package, check: deprecated (the registry says so), not changed for 18 months or more, 2 or more major versions behind, not used any more (grep the code for its import), or heavy for the web build when a small import would do.
2. Write one item for each real problem, with the fix: remove it (unused), replace it ("ask"), or step it up.`
  },
  offline: {
    title: 'Offline and sync safety', every: 'tue', model: 'sonnet',
    asks: 'Where can a person lose work, or the app hang, after months offline, on a 2 GB phone, or with a big language?',
    brief: `1. Read PLAN.md section 4 (the invariants) and .agents/skills/event-sourced-sync/SKILL.md. Never recommend what breaks an invariant or a decision in docs/decisions.
2. Read the code where failures hurt most: packages/sync/src (the outbox, uploads, downloads, the event store), apps/mobile/src/blobs.ts, and the server's side of sync (apps/web/worker, supabase/migrations for validate_payload and event_privilege).
3. Look for concrete risks: a network call with no time limit, an error caught and dropped, an upload that can repeat or be lost halfway, a read of a whole language into memory, a step that leaves the phone stuck when the disk is full.
4. Write an item only for what you can show with the exact lines and why it fails. A defect you proved is action "fix" when the change is small and outside sync and the server; anything in sync, the server or an event's shape is action "ask".`
  },
  'code-security': {
    title: 'Code security and privacy', every: 'wed', model: 'sonnet',
    asks: 'Did the code of the last 7 days open a hole, or send what a person wrote where it must not go?',
    brief: `1. Read "Changed in the last 8 days" in facts.md, then each changed file under supabase/migrations, supabase/functions, server, apps/web/worker and apps/admin/src.
2. For each database function: is it security definer with search_path = ''; does it check the caller; is execute revoked from public and anon and granted only where it must be; does each new table have row level security?
3. For each route of the Worker: does it check who calls; does it put a key, a token or what a person wrote in a log, a reply or GitHub; does it check the size of what it reads?
4. Diagnostics (packages/sync/src/diagnostics.ts) record counts and codes only, never content: check that no change breaks this.
5. Write an item for each hole, with the lines. A clear, small fix in apps/admin/src or apps/mobile/src is action "fix"; a change of who may see or do what is action "ask". Never write a working attack: say what is wrong and where.`
  },
  speed: {
    title: 'Speed, size and cost', every: 'thu', model: 'sonnet',
    asks: 'What makes the app slower, bigger or more costly than it needs to be?',
    brief: `1. The web build: read scripts/web-budget* and apps/mobile/src for heavy imports (a whole icon set, a big library for one function).
2. The phone: what a big language costs on a 2 GB phone (memory, disk), and what the first download of a language costs.
3. The database: the functions each screen and the sync call most; queries that read whole tables, run once for each row, or miss an index.
4. GitHub Actions: jobs that run when nothing they test changed, and missing caches.
5. Services: the limits of Supabase, Cloudflare (Workers, R2) and EAS, and which one the app reaches first.
6. Write an item for each saving worth it, with an estimate (seconds, MB, minutes or dollars a month).`
  },
  platform: {
    title: 'Store and platform rules', every: 'fri', model: 'haiku',
    asks: 'Which rule, deadline or end of support from Apple, Google Play, Expo, Supabase, Cloudflare or GitHub touches the app in the next 6 months?',
    brief: `Search the official pages (WebSearch, WebFetch) for rules, deadlines and ends of support in the next 6 months:
- Google Play: the target API level deadline, policies on data safety and on content.
- Apple: the Xcode and SDK version that uploads need, privacy manifests, account deletion.
- Expo: the support window of the SDK the app is on (the version of expo in apps/mobile/package.json), deprecations in the newest SDK.
- Supabase: Postgres version, Auth and Storage deprecations, price changes. Cloudflare: Workers and R2 changes.
- GitHub Actions: runner images, the Node version actions run on.
Read docs/play-store-declarations.md and docs/app-store-declarations.md: say when a new rule makes an answer there untrue.
Write an item for each one with its date ("deadline") and what we must do. Say "reject" in one line for a rule that does not touch us.`
  },
  alternatives: {
    title: 'Better packages', every: 'sat-even', model: 'sonnet',
    asks: 'Is there a more reliable, safer or lighter package for something that we use, and is the move worth its cost?',
    brief: `1. Take the main jobs a package does for us (read apps/mobile/package.json and the root package.json): audio, storage, navigation, translations, tests, the Worker's libraries.
2. For each one, search for a newer, more reliable, safer or lighter package that many people use now. Compare maintenance, size, security record, and how much of our code a move touches.
3. Most moves are not worth it: say "reject" with the reason. Recommend (always action "ask") only a move with a clear gain over its cost.`
  },
  'supply-chain': {
    title: 'Supply chain and licenses', every: 'sat-odd', model: 'haiku',
    asks: 'Can a package or a GitHub Action that we use change under us or be taken over, and does each license fit?',
    brief: `1. Read "Install scripts" in facts.md: each package there runs code when it is installed. Is each one known and needed?
2. Read "GitHub Actions": each Action should be pinned to a commit. A third-party Action pinned by a tag is an "ask" item.
3. For the 15 packages that matter most to the app (expo, react-native, @supabase/supabase-js and the others in apps/mobile/package.json), check on the registry page that the maintainers did not change in the last 90 days.
4. Read "Licenses": a package in the app with a license that does not fit an app in the stores (GPL, AGPL, none) is high.`
  }
};
export const BEAT_IDS = Object.keys(BEATS);
/** The older search for the same mistake in other places: its own step, every day (docs/agent-team.md). */
export const TWINS = { id: 'twins', title: 'Same mistake in other places', every: 'day', model: 'opus' };
/** The whole team, as the Research page draws it: the daily beats and the twins search first. */
export const TEAM = [
  ...BEAT_IDS.filter((b) => BEATS[b].every === 'day').map((id) => ({ id, title: BEATS[id].title, every: BEATS[id].every, model: BEATS[id].model })),
  TWINS,
  ...BEAT_IDS.filter((b) => BEATS[b].every !== 'day').map((id) => ({ id, title: BEATS[id].title, every: BEATS[id].every, model: BEATS[id].model }))
];
/** At most this many scouts in one run (the two daily beats and the beat of the day). */
export const MAX_SCOUTS = 3;
/** The lead stops the team at this many minutes; the step stops at 55. */
export const TEAM_MINUTES = 50;

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** The ISO week number of a date (UTC). */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  return Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7);
}

/** Does a beat run on this day (UTC)? */
export function beatDue(beat, date) {
  const every = BEATS[beat]?.every;
  if (!every) return false;
  if (every === 'day') return true;
  const dow = DAYS[date.getUTCDay()];
  if (every === dow) return true;
  if (every === 'sat-even') return dow === 'sat' && isoWeek(date) % 2 === 0;
  if (every === 'sat-odd') return dow === 'sat' && isoWeek(date) % 2 === 1;
  return false;
}

/**
 * The beats of one run: the day's schedule, or the ones a person asked for ("security,platform"), at
 * most MAX_SCOUTS, the daily ones first. Unknown names are dropped.
 * @returns {string[]}
 */
export function beatsFor(date, asked = '') {
  const want = String(asked || '').split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const list = want.length ? BEAT_IDS.filter((b) => want.includes(b)) : BEAT_IDS.filter((b) => beatDue(b, date));
  return list.sort((a, b) => Number(BEATS[b].every === 'day') - Number(BEATS[a].every === 'day')).slice(0, MAX_SCOUTS);
}

// ------------------------------------------------------------------------------------------ the report

export const KINDS = ['vulnerability', 'upgrade', 'replace', 'bug', 'risk', 'cost', 'deadline', 'other'];
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
export const DECISIONS = ['recommend', 'watch', 'reject'];
export const ACTIONS = ['fix', 'ask', 'none'];
export const RESULTS = ['clear', 'found', 'failed', 'skipped'];
export const TEAM_LIMITS = { items: 40, title: 200, found: 600, why: 600, places: 8, links: 6, headline: 200, summary: 5, line: 300, checked: 400 };
/** Linear's priority for a recommended item, by how bad it is: 1 urgent, 2 high, 3 medium, 4 low. */
export const PRIORITY = { critical: 1, high: 2, medium: 3, low: 4, info: 4 };

const TAG = /^[a-z0-9][a-z0-9-]{2,59}$/;
const PLACE = /^([A-Za-z0-9_@.()[\]/-]{1,200}?)(:[0-9]{1,6})?$/;
const LINK = /^https:\/\/[^\s<>"'`]{4,295}$/;
const PACKAGE = /^(@[a-z0-9._-]{1,100}\/)?[a-z0-9._-]{1,100}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,40}$/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Claude's words, cut to size, with no address. */
const said = (v, max) => (typeof v === 'string' ? v.replace(EMAIL, '[address]').replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** A tag made from words: small letters, "-" for each run of other characters. */
export function slug(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}

/** A choice the team asks of a developer, checked; null when it is not one. */
export function askOf(raw) {
  if (!isObj(raw) || !Array.isArray(raw.choices)) return null;
  const why = said(raw.why, 300);
  const choices = raw.choices.filter(isObj).map((c) => ({ label: said(c.label, 80), then: said(c.then, 200) || null })).filter((c) => c.label).slice(0, 4);
  return why && choices.length >= 2 ? { why, choices } : null;
}

/**
 * One item of the lead's report (or a scout's notes), checked and cut to size; null when it is not
 * one. `isFile` says whether a path is a file of main. A recommended item keeps only places that are
 * files and links that are https; with neither left it is not proven, so it becomes "watch". A
 * "recommend" with no action becomes "ask" (a developer chooses).
 */
export function teamItem(x, beats, isFile) {
  if (!isObj(x)) return null;
  const title = said(x.title, TEAM_LIMITS.title), found = said(x.found, TEAM_LIMITS.found), why = said(x.why, TEAM_LIMITS.why);
  if (!title || !found || !why) return null;
  const tag = typeof x.tag === 'string' && TAG.test(x.tag) ? x.tag : slug(title);
  if (!TAG.test(tag)) return null;
  const places = [...new Set((Array.isArray(x.places) ? x.places : []).filter((p) => {
    const m = typeof p === 'string' && !p.includes('..') ? PLACE.exec(p) : null;
    return m !== null && isFile(m[1]);
  }))].slice(0, TEAM_LIMITS.places);
  const links = [...new Set((Array.isArray(x.links) ? x.links : []).filter((l) => typeof l === 'string' && LINK.test(l) && !EMAIL.test(l)))].slice(0, TEAM_LIMITS.links);
  let decision = DECISIONS.includes(x.decision) ? x.decision : 'watch';
  let action = ACTIONS.includes(x.action) ? x.action : 'none';
  if (decision !== 'recommend') action = 'none';
  else if (action === 'none') action = 'ask';
  if (decision === 'recommend' && !places.length && !links.length) (decision = 'watch'), (action = 'none');
  const plain = (v, re) => (typeof v === 'string' && re.test(v.trim()) ? v.trim() : null);
  const ask = action === 'ask' ? askOf(x.ask) : null;
  return {
    tag, title, like: null, found, why, places, steps: null, decision, action, issue: null,
    beat: beats.includes(x.beat) ? x.beat : beats[0] ?? null,
    kind: KINDS.includes(x.kind) ? x.kind : 'other',
    severity: SEVERITIES.includes(x.severity) ? x.severity : 'info',
    links, package: plain(x.package, PACKAGE), from: plain(x.from, VERSION), to: plain(x.to, VERSION),
    deadline: plain(x.deadline, /^\d{4}-\d{2}-\d{2}$/), ask
  };
}

/** The numbers at the top of a day's report. */
export function counts(items) {
  const n = (f) => items.filter(f).length;
  return {
    found: items.length, recommended: n((i) => i.decision === 'recommend'), rejected: n((i) => i.decision === 'reject'), watching: n((i) => i.decision === 'watch'),
    toFix: n((i) => i.decision === 'recommend' && i.action === 'fix'), toAsk: n((i) => i.decision === 'recommend' && i.action === 'ask')
  };
}

/**
 * The lead's report.json, checked: the headline, the summary, one line for each beat of the run and the
 * items, one for each tag. An item of an earlier run keeps its Linear issue (`known`: the items of
 * facts.json by tag). Null when it is not a report (no headline). `dropped` says why each item went.
 */
export function checkTeamReport(raw, { beats, isFile, known = new Map() }) {
  if (!isObj(raw)) return null;
  const headline = said(raw.headline, TEAM_LIMITS.headline);
  if (!headline) return null;
  const items = [], dropped = [], seen = new Set();
  for (const [n, x] of (Array.isArray(raw.items) ? raw.items : []).entries()) {
    const it = teamItem(x, beats, isFile);
    if (!it) { dropped.push(`items[${n}]: needs a title, found and why`); continue; }
    if (seen.has(it.tag)) { dropped.push(`items[${n}] ${it.tag}: the tag of another item`); continue; }
    if (items.length >= TEAM_LIMITS.items) { dropped.push(`items[${n}]: more than ${TEAM_LIMITS.items} items`); continue; }
    if (isObj(x) && x.decision === 'recommend' && it.decision === 'watch') dropped.push(`items[${n}] ${it.tag}: recommended with no file of main and no link; kept as watch`);
    const before = known.get(it.tag);
    if (typeof before?.issue === 'string' && /^[A-Z]{1,10}-[0-9]{1,7}$/.test(before.issue)) it.issue = before.issue;
    seen.add(it.tag);
    items.push(it);
  }
  const lines = new Map();
  for (const b of Array.isArray(raw.beats) ? raw.beats : []) {
    if (!isObj(b) || !beats.includes(b.id) || lines.has(b.id)) continue;
    lines.set(b.id, { checked: said(b.checked, TEAM_LIMITS.checked), result: RESULTS.includes(b.result) ? b.result : 'clear', note: said(b.note, TEAM_LIMITS.line) || null });
  }
  return {
    headline,
    summary: (Array.isArray(raw.summary) ? raw.summary : []).map((s) => said(s, TEAM_LIMITS.line)).filter(Boolean).slice(0, TEAM_LIMITS.summary),
    beats: beats.map((id) => ({ id, title: BEATS[id].title, model: BEATS[id].model, ...(lines.get(id) ?? { checked: '', result: 'skipped', note: 'The lead wrote nothing for this beat.' }) })),
    items, dropped
  };
}

/**
 * When the lead gives no report (it broke or ran out of time), the scouts' own notes become the report,
 * with a headline that says so. `notes` are [beat, the scout's JSON or null].
 */
export function reportFromScouts(notes, { isFile, known = new Map() }) {
  const beats = notes.map(([b]) => b);
  const items = [];
  const lines = [];
  for (const [beat, raw] of notes) {
    const r = isObj(raw) ? raw : null;
    const its = r ? (Array.isArray(r.items) ? r.items : []).map((x) => teamItem(isObj(x) ? { ...x, beat } : x, [beat], isFile)).filter(Boolean) : [];
    for (const it of its) if (!items.some((i) => i.tag === it.tag) && items.length < TEAM_LIMITS.items) items.push(it);
    lines.push({ id: beat, title: BEATS[beat].title, model: BEATS[beat].model, checked: r ? said(r.checked, TEAM_LIMITS.checked) : '', result: !r ? 'failed' : its.length ? 'found' : 'clear', note: r ? null : 'The scout left no notes.' });
  }
  for (const it of items) {
    const before = known.get(it.tag);
    if (typeof before?.issue === 'string') it.issue = before.issue;
  }
  return { headline: 'The lead did not finish today, so this report is the scouts\' own notes, not checked a second time.', summary: [], beats: lines.filter((l) => beats.includes(l.id)), items, dropped: [] };
}

/** How long Claude's session took and how many turns, from claude-code-action's execution file; nulls when it cannot say. */
export function sessionOf(text) {
  try {
    const list = JSON.parse(String(text));
    const result = (Array.isArray(list) ? list : []).filter((m) => m?.type === 'result').pop();
    if (!result) return { minutes: null, turns: null };
    const ms = Number(result.duration_ms);
    const turns = Number(result.num_turns);
    return { minutes: Number.isFinite(ms) ? Math.round(ms / 6000) / 10 : null, turns: Number.isInteger(turns) ? turns : null };
  } catch {
    return { minutes: null, turns: null };
  }
}

/** The Linear issue of a recommended item: Claude's words about the code and public pages, nothing a person wrote. */
export function teamItemDescription(item, run) {
  return [
    `Found by the research team's scout for **${BEATS[item.beat]?.title ?? 'research'}** (docs/research-team.md).`,
    '',
    `**What:** ${item.found}`,
    '',
    `**Why:** ${item.why}`,
    ...(item.package ? ['', `**Package:** \`${item.package}\`${item.from ? ` ${item.from}` : ''}${item.to ? ` → ${item.to}` : ''}`] : []),
    ...(item.deadline ? ['', `**Date that matters:** ${item.deadline}`] : []),
    ...(item.places.length || item.links.length ? ['', '**Evidence:**', ...item.places.map((p) => `- \`${p}\``), ...item.links.map((l) => `- ${l}`)] : []),
    ...(item.ask ? ['', `**Your choice:** ${item.ask.why}`, ...item.ask.choices.map((c, n) => `${n + 1}. ${c.label}${c.then ? `: ${c.then}` : ''}`), '', 'Choose on the ops dashboard (Research), or tell Claude there.'] : []),
    '',
    `**Recommended:** ${item.action === 'fix' ? 'the fix team writes the change. Its rule decides whether it merges without a person or waits for a developer.' : 'a developer decides first.'}`,
    '',
    `[The run that found it](${run})`
  ].join('\n');
}

// ------------------------------------------------------------------------------------------ the facts

/** The workspaces' package.json files: the root, apps/*, packages/*. */
function manifests(root) {
  const out = [['(root)', join(root, 'package.json')]];
  for (const dir of ['apps', 'packages']) {
    if (!existsSync(join(root, dir))) continue;
    for (const name of readdirSync(join(root, dir))) if (existsSync(join(root, dir, name, 'package.json'))) out.push([`${dir}/${name}`, join(root, dir, name, 'package.json')]);
  }
  return out;
}

/** "uses: owner/repo@sha # v1.2.3" in the workflows: each Action, its pin and the version its comment names. */
export function actionsIn(texts) {
  const seen = new Map();
  for (const text of texts) {
    for (const m of String(text).matchAll(/uses:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\/[^@\s]*)?@([^\s#]+)(?:\s*#\s*(v?[0-9][^\s]*))?/g)) {
      const [, action, ref, comment] = m;
      if (!seen.has(action)) seen.set(action, { action, ref, version: comment ?? (/^v?\d/.test(ref) ? ref : null), pinned: /^[0-9a-f]{40}$/.test(ref) });
    }
  }
  return [...seen.values()].sort((a, b) => a.action.localeCompare(b.action));
}

/** A license that may not fit an app in the stores. */
export const ODD_LICENSE = (l) => !l || /\b(A?GPL|SSPL|BUSL|UNLICENSED|Commons-Clause)\b/i.test(String(l));

/**
 * What code finds out before any agent starts. Each source fails alone: a note says so and the rest goes
 * on. `fetch` and `run` are injected so a test can give its own.
 */
export async function gatherFacts({ root, githubToken = '', fetch: get = globalThis.fetch, run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }), log = () => {} }) {
  const notes = [];
  const soft = async (what, fn, fallback) => {
    try {
      return await fn();
    } catch (e) {
      notes.push(`${what}: ${e instanceof Error ? e.message.slice(0, 200) : e}`);
      return fallback;
    }
  };
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const entries = Object.entries(lock.packages ?? {}).filter(([k, p]) => k.includes('node_modules/') && !p.link);
  const nameOf = (k) => k.slice(k.lastIndexOf('node_modules/') + 'node_modules/'.length);

  // Direct dependencies of each workspace, with the version the lockfile holds.
  const direct = new Map();
  for (const [where, file] of manifests(root)) {
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    for (const field of ['dependencies', 'devDependencies']) {
      for (const [name, want] of Object.entries(pkg[field] ?? {})) {
        if (String(want).startsWith('file:') || String(want).startsWith('workspace:') || String(want) === '*') continue;
        const had = direct.get(name) ?? { name, want: String(want), installed: lock.packages?.[`node_modules/${name}`]?.version ?? null, dev: field === 'devDependencies', in: [] };
        had.in.push(where);
        if (field === 'dependencies') had.dev = false;
        direct.set(name, had);
      }
    }
  }

  // Known holes: npm audit on the lockfile, and OSV.dev for every package in it.
  const audit = await soft('npm audit', async () => {
    let text;
    try {
      text = run('npm', ['audit', '--package-lock-only', '--json']);
    } catch (e) {
      text = e?.stdout; // npm audit exits 1 when it finds holes
      if (!text) throw e;
    }
    const v = JSON.parse(text).vulnerabilities ?? {};
    return Object.values(v).map((x) => ({
      name: x.name, severity: x.severity, range: x.range,
      via: (x.via ?? []).map((y) => (typeof y === 'string' ? y : `${y.title ?? ''} ${y.url ?? ''}`.trim())).slice(0, 4),
      fix: x.fixAvailable === true ? 'yes' : isObj(x.fixAvailable) ? `${x.fixAvailable.name}@${x.fixAvailable.version}${x.fixAvailable.isSemVerMajor ? ' (major)' : ''}` : 'no'
    }));
  }, null);
  const osv = await soft('OSV.dev', async () => {
    const pkgs = [...new Map(entries.map(([k, p]) => [`${nameOf(k)}@${p.version}`, { name: nameOf(k), version: p.version }])).values()].filter((p) => p.version);
    const found = [];
    for (let i = 0; i < pkgs.length; i += 1000) {
      const part = pkgs.slice(i, i + 1000);
      const res = await get('https://api.osv.dev/v1/querybatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queries: part.map((p) => ({ package: { name: p.name, ecosystem: 'npm' }, version: p.version })) }), signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      const body = await res.json();
      (body.results ?? []).forEach((r, n) => { for (const v of r?.vulns ?? []) found.push({ id: v.id, package: part[n].name, version: part[n].version }); });
    }
    return found;
  }, null);

  // The registry: the newest version of each direct dependency, whether it is deprecated, when it last changed.
  const outdated = [];
  const deprecated = [];
  await soft('the npm registry', async () => {
    const list = [...direct.values()];
    for (let i = 0; i < list.length; i += 12) {
      await Promise.all(list.slice(i, i + 12).map(async (d) => {
        const res = await get(`https://registry.npmjs.org/${d.name.replace('/', '%2F')}`, { headers: { accept: 'application/vnd.npm.install-v1+json' }, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) return;
        const doc = await res.json();
        const latest = doc['dist-tags']?.latest ?? null;
        d.latest = latest;
        d.modified = doc.modified ?? null;
        if (latest && d.installed && latest !== d.installed) outdated.push({ name: d.name, installed: d.installed, latest, major: latest.split('.')[0] !== d.installed.split('.')[0], dev: d.dev });
        const dep = d.installed ? doc.versions?.[d.installed]?.deprecated : null;
        if (dep) deprecated.push({ name: d.name, version: d.installed, why: String(dep).slice(0, 200) });
      }));
    }
  }, null);

  // GitHub Actions in the workflows, and the newest release of each.
  const dir = join(root, '.github/workflows');
  const actions = actionsIn(existsSync(dir) ? readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => readFileSync(join(dir, f), 'utf8')) : []);
  await soft('GitHub releases', async () => {
    await Promise.all(actions.map(async (a) => {
      const res = await get(`https://api.github.com/repos/${a.action}/releases/latest`, { headers: { accept: 'application/vnd.github+json', ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {}) }, signal: AbortSignal.timeout(20_000) });
      if (res.ok) a.latest = (await res.json()).tag_name ?? null;
    }));
  }, null);

  const read = (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), 'utf8').trim() : null);
  const mobile = JSON.parse(read('apps/mobile/package.json') ?? '{}');
  const tools = {
    node: read('.node-version'),
    expo: mobile.dependencies?.expo ?? null,
    reactNative: mobile.dependencies?.['react-native'] ?? null,
    wrangler: lock.packages?.['node_modules/wrangler']?.version ?? null,
    supabase: lock.packages?.['node_modules/supabase']?.version ?? null
  };
  const scripts = entries.filter(([, p]) => p.hasInstallScript).map(([k, p]) => `${nameOf(k)}@${p.version}`).sort();
  const licenses = entries.filter(([, p]) => !p.dev && ODD_LICENSE(p.license)).map(([k, p]) => `${nameOf(k)}@${p.version} (${p.license ?? 'no license'})`).sort().slice(0, 40);
  const changed = await soft('git log', async () => run('git', ['log', '--since=8 days ago', '--name-only', '--format=--- %h %ad %s', '--date=short', '--no-merges']).split('\n').slice(0, 1500).join('\n'), '');

  log(`facts: ${direct.size} direct dependencies, ${entries.length} packages in the lockfile, ${audit?.length ?? '?'} audit rows, ${osv?.length ?? '?'} OSV ids, ${outdated.length} with a new version, ${actions.length} Actions`);
  return { direct: [...direct.values()], lockfile: entries.length, audit, osv, outdated, deprecated, actions, tools, scripts, licenses, changed, notes };
}

/** The facts as the agents read them (facts.md): short tables, the most useful first. */
export function factsMarkdown(f) {
  const L = ['# Facts code found today (no AI)', ''];
  const holes = [...(f.audit ?? []).map((a) => `- ${a.name} (${a.severity}, ${a.range}): ${a.via.join('; ')}. Fix: ${a.fix}.`), ...(f.osv ?? []).map((o) => `- ${o.id}: ${o.package}@${o.version}`)];
  L.push(`## Known holes (npm audit: ${f.audit ? f.audit.length : 'did not run'}; OSV.dev: ${f.osv ? f.osv.length : 'did not run'})`, '', ...(holes.length ? holes.slice(0, 120) : ['None.']), '');
  L.push(`## Packages with a new version (${f.outdated.length})`, '', ...(f.outdated.length ? f.outdated.map((o) => `- ${o.name}: ${o.installed} → ${o.latest}${o.major ? ' (new major)' : ''}${o.dev ? ' (dev)' : ''}`) : ['None.']), '');
  L.push(`## Deprecated (${f.deprecated.length})`, '', ...(f.deprecated.length ? f.deprecated.map((d) => `- ${d.name}@${d.version}: ${d.why}`) : ['None.']), '');
  L.push(`## Direct dependencies (${f.direct.length})`, '', ...f.direct.map((d) => `- ${d.name} ${d.installed ?? d.want}${d.latest && d.latest !== d.installed ? ` (newest ${d.latest})` : ''}${d.modified ? `, changed ${String(d.modified).slice(0, 10)}` : ''}${d.dev ? ', dev' : ''}: ${d.in.join(', ')}`), '');
  L.push(`## GitHub Actions (${f.actions.length})`, '', ...f.actions.map((a) => `- ${a.action}@${a.version ?? a.ref}${a.pinned ? ' (pinned to a commit)' : ' (NOT pinned to a commit)'}${a.latest ? `, newest ${a.latest}` : ''}`), '');
  L.push('## Tools', '', ...Object.entries(f.tools).map(([k, v]) => `- ${k}: ${v ?? '?'}`), '');
  L.push(`## Install scripts (${f.scripts.length})`, '', ...(f.scripts.length ? f.scripts.map((s) => `- ${s}`) : ['None.']), '');
  L.push(`## Licenses that may not fit (${f.licenses.length})`, '', ...(f.licenses.length ? f.licenses.map((s) => `- ${s}`) : ['None.']), '');
  L.push('## Changed in the last 8 days', '', '```', f.changed || '(nothing)', '```', '');
  if (f.notes.length) L.push('## What code could not find out', '', ...f.notes.map((n) => `- ${n}`), '');
  return `${L.join('\n')}\n`;
}

/** What the team knows already (context.md), from the Worker's research context: open, fixed and rejected items, and the last headline. */
export function contextMarkdown(ctx) {
  const items = (Array.isArray(ctx?.items) ? ctx.items : []).filter((i) => isObj(i) && i.beat);
  const line = (i) => `- \`${i.tag}\` ${i.severity ?? ''} ${i.kind ?? ''}: ${said(i.title, 160)} (${i.decision}${i.action && i.action !== 'none' ? `, ${i.action}` : ''}${i.package ? `; ${i.package} ${i.from ?? '?'} → ${i.to ?? '?'}` : ''}${i.issue ? `; ${i.issue}` : ''}${i.fixed ? `; fixed in PR ${i.pr}` : i.pr ? `; PR ${i.pr} waits` : ''})`;
  const open = items.filter((i) => i.decision !== 'reject' && !i.fixed);
  const fixed = items.filter((i) => i.fixed);
  const rejected = items.filter((i) => i.decision === 'reject');
  return [
    '# What the team knows already', '',
    ...(ctx?.last?.headline ? [`Last report (${ctx.last.day}): ${said(ctx.last.headline, 200)}`, ''] : []),
    `## Open items (${open.length})`, '', ...(open.length ? open.slice(0, 60).map(line) : ['None.']), '',
    `## Fixed (${fixed.length})`, '', ...(fixed.length ? fixed.slice(0, 30).map(line) : ['None.']), '',
    `## Rejected before (${rejected.length}): do not recommend again unless something new happened`, '',
    ...(rejected.length ? rejected.slice(0, 60).map((i) => `${line(i)}. Why: ${said(i.why, 200)}`) : ['None.']), ''
  ].join('\n');
}

/** Today's beats with their briefs (beats.md): what the lead hands each scout. */
export function beatsMarkdown(beats) {
  return ['# Today\'s scouts', '', ...beats.flatMap((b) => [`## ${b}: ${BEATS[b].title} (model: ${BEATS[b].model})`, '', `The question: ${BEATS[b].asks}`, '', BEATS[b].brief, ''])].join('\n');
}
