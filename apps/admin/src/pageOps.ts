/**
 * The page's script for the sections the ops dashboard plan added
 * (docs/ops-dashboard-plan.md section 5), kept apart from page.ts so that
 * file stays readable. Plain JavaScript run inside page.ts's script, after
 * its helpers (esc, num, ms, bytes, when, table, short, stat, api) and its
 * RENDER table, which this extends. Everything shown is escaped.
 */

/**
 * The page's sections, in page order: each one gathers the parts (what one
 * source answers, by its id) about one subject, so a figure is shown once,
 * where it belongs. A part with no title of its own here keeps its source's
 * title as its sub-heading (page.ts BASE_SECTIONS, OPS_SECTIONS below).
 * Look up has no parts: it is a tool, right under Needs attention, where a
 * link to an install lands.
 */
export const GROUPS = [
  { id: 'lookup', title: 'Look up', src: 'An error code someone read out (E-…), an email or profile id, an install id, or an organization or language name', parts: [] },
  { id: 'userissues', title: 'User issues', src: 'What the watch for user issues filed in Linear or found already fixed, each issue\'s state and the pull request that fixed it', wide: true, parts: ['userissues'] },
  { id: 'safety', title: 'Sync and data safety', src: 'Refused work, upload delay, clock skew, the fold canary, projection lag and snapshots', wide: true, parts: ['safety'] },
  { id: 'phones', title: 'Phones and browsers', src: 'What installs report, the builds they run and how often each crashes, and phones that are stuck or quiet', wide: true, parts: ['clients', 'fleet'] },
  { id: 'releases', title: 'Releases', src: 'Where each store build and update is now, main and its CI, last night\'s tests, what each host serves, migrations, what shipped against errors, EAS builds and updates', wide: true, parts: ['pipeline', 'code', 'nightly', 'releases', 'expo', 'adoption'] },
  { id: 'jobs', title: 'Server jobs', src: 'Each job\'s runs and whether it runs now, pg_cron, push delivery, and the v2 import', wide: true, parts: ['jobs', 'container', 'cron', 'push', 'v2'] },
  { id: 'database', title: 'Database', src: 'Connections, cache, slow calls, largest tables, long transactions, and the Supabase project', parts: ['database', 'dbdetail', 'supabase'] },
  { id: 'traffic', title: 'Workers and traffic', src: 'Each Cloudflare Worker\'s requests, errors and latest build, and the app Worker\'s routes', parts: ['cloudflare', 'worker'] },
  { id: 'storage', title: 'Storage and capacity', src: 'Backups, R2, files lost on phones, the nightly R2 check, growth against the plan and this month\'s usage', parts: ['storage', 'capacity'] },
  { id: 'people', title: 'People and organizations', src: 'Counted, never named: accounts, activity, organizations, joining', wide: true, parts: ['people'] },
  { id: 'support', title: 'Support', src: 'Content reports, suspensions, deletions, feedback, and what was done from this page', wide: true, parts: ['support', 'feedback'] },
  { id: 'access', title: 'Access and integrations', src: 'Global Viewers, limits hit, tokens, device grants, webhooks, review links, and what expires', parts: ['security', 'integrations', 'expiry'] },
  { id: 'stores', title: 'App stores', src: 'Google Play vitals and reviews, App Store review state, builds and reviews', parts: ['googleplay', 'appstore'] },
  { id: 'tutorials', title: 'Tutorial videos', src: 'Each video\'s state and timeline in each app language, what an admin must do, what the workers do now and tonight, each channel, Publish, and what came in', wide: true, parts: ['videos', 'tutorials', 'videofeedback'] }
] as const;

/** Sub-headings where a source's own title would repeat its section's, or say too little inside it. */
export const PART_TITLES: Record<string, string> = {
  pipeline: 'Where each build and update is', clients: 'What installs report', fleet: 'Builds in the field and stuck phones', code: 'Code and deploys', releases: 'What shipped',
  expo: 'EAS builds and updates', adoption: 'Update adoption', jobs: 'Jobs', cron: 'pg_cron', push: 'Push delivery and Inbox', v2: 'v2 import',
  database: 'Health', dbdetail: 'Where the space goes', supabase: 'Supabase project', cloudflare: 'Cloudflare Workers', worker: 'App Worker routes, last 24 h',
  storage: 'Storage and backups', capacity: 'Capacity and cost', support: 'Queue', feedback: 'Feedback', security: 'Global Viewers and limits',
  integrations: 'Integrations', expiry: 'Expiry dates', googleplay: 'Google Play', appstore: 'App Store', videos: 'Videos, your list and the workers\' list', tutorials: 'Channels and videos', videofeedback: 'What came in, and notes',
  userissues: 'Problems people hit', nightly: 'Nightly tests'
};

/** Read as diag_reader in one call (/ops/api/ops). */
export const OPS_IDS = ['fleet', 'safety', 'people', 'cron', 'dbdetail', 'push', 'worker', 'integrations', 'support', 'security', 'tutorials', 'videofeedback', 'userissues'] as const;

/** Each from its own call (/ops/api/<id>), like the providers. */
export const OWN_CALL_IDS = ['expiry', 'storage', 'capacity', 'releases', 'container', 'adoption', 'videos', 'pipeline', 'nightly'] as const;

export const OPS_SECTIONS = [
  { id: 'safety', title: 'Sync and data safety', src: 'Refused work, upload delay, clock skew, the fold canary, projection lag and snapshots', wide: true },
  { id: 'fleet', title: 'Builds and stuck phones', src: 'Updates in the field and their crash-free rate, versions, time to a usable Map, stuck and silent phones', wide: true },
  { id: 'releases', title: 'Release health', src: 'Merges, deploys and EAS updates over 14 days against errors; hosts; migrations against main' },
  { id: 'adoption', title: 'Update adoption', src: 'For each channel, platform and runtime: the newest EAS update and how many active installs run it' },
  { id: 'pipeline', title: 'Where each build and update is', src: 'Each store build in its stage (EAS, TestFlight or internal testing, review, live), with the over-the-air updates it takes (decisions.md 157)' },
  { id: 'container', title: 'Job container', src: 'Whether each server job runs now (the app Worker\'s JobStatus)' },
  { id: 'cron', title: 'Scheduled database jobs', src: 'pg_cron runs and failures, last 24 h' },
  { id: 'dbdetail', title: 'Database detail', src: 'Largest tables and indexes, dead rows, long queries and transactions' },
  { id: 'push', title: 'Push and Inbox', src: 'Notifications waiting, push failures and tokens' },
  { id: 'worker', title: 'App Worker', src: 'Requests by route, time taken and refusals, last 24 h' },
  { id: 'integrations', title: 'Integrations', src: 'Access tokens, device grants, webhooks, review links, the agent API' },
  { id: 'storage', title: 'Storage and backups', src: 'Supabase backups, R2, files lost on phones, the nightly R2 check' },
  { id: 'people', title: 'People and organizations', src: 'Counted, never named: accounts, activity, organizations, joining', wide: true },
  { id: 'support', title: 'Support queue', src: 'Content reports, suspensions, account deletions, open feedback' },
  { id: 'security', title: 'Security and limits', src: 'Global Viewers, limits hit, new credentials' },
  { id: 'expiry', title: 'Expiry dates', src: 'Tokens, Apple certificates and profiles, and dates kept in apps/admin/expiry.json' },
  { id: 'capacity', title: 'Capacity and cost', src: 'Database and R2 growth against the plan, Cloudflare usage this month' },
  { id: 'videos', title: 'Tutorial video lists', src: 'diag.ops_tutorial_films, ops_tutorial_feedback and ops_tutorials; status-<language>.json in the tutorials release; the filming run and NIGHTLY_LANGUAGES on GitHub (decisions.md 186)' },
  { id: 'tutorials', title: 'Tutorial videos', src: 'ops.youtube_channels and ops.tutorial_videos (decisions.md 180)' },
  { id: 'videofeedback', title: 'Feedback on the videos', src: 'ops.tutorial_inputs and ops.tutorial_suggestions: comments, code changes and notes, and what Claude suggests each night (decisions.md 186)' },
  { id: 'userissues', title: 'User issues', src: 'ops.user_issues: what the watch filed in Linear, closed there, or found already fixed, with the pull request (decisions.md 202)' },
  { id: 'nightly', title: 'Nightly tests', src: 'GitHub: the line each nightly suite leaves on its latest scheduled run on main (decisions.md 209)' }
] as const;

export const OPS_SCRIPT = String.raw`
const orgLink = (id, name) => '<button class="link" data-org="' + esc(id) + '">' + esc(name || String(id).slice(0, 8)) + '</button>';
const installLink = (id) => id ? '<button class="link" data-q="' + esc(id) + '"><code>' + esc(String(id).slice(0, 8)) + '</code></button>' : '–';
const share = (a, b) => b ? ((a / b) * 100).toFixed(1) + '%' : '–';
const hours = (msv) => msv === null || msv === undefined ? '–' : ms(Number(msv));
const ageOf = (iso) => iso ? ago(iso) : '–';
/** An app language's name in English ('zh-Hans', Simplified Chinese), from the browser. */
const languageName = (code) => { try { return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code; } catch { return code; } };

Object.assign(RENDER, {
  safety(d) {
    const today = d.rejected[d.rejected.length - 1] || {};
    const arr = d.arrivals[d.arrivals.length - 1] || {};
    const p = d.pipeline;
    let h = '<div class="stats">' + stat(num(today.rejected || 0), 'events refused, latest day', today.rejected ? 'warn' : '') +
      stat(num(today.invalid || 0), 'refused as invalid', today.invalid ? 'bad' : '', today.day ? 'on ' + day(today.day) : 'latest day') +
      stat(hours(arr.p95Ms), 'p95 upload delay', '', arr.day ? 'on ' + day(arr.day) : 'not sampled yet') +
      stat(num(arr.futureStamped || 0), 'stamped ahead of the clock', arr.futureStamped ? 'warn' : '', arr.day ? 'on ' + day(arr.day) : 'not sampled yet') +
      (p ? stat(num(p.lagging), 'languages behind the pass', p.lagging ? 'warn' : '', NOW) + stat(num(p.snapshots.overdue), 'snapshots overdue', p.snapshots.overdue ? 'warn' : '', NOW) : '') + '</div>';
    h += '<h3>Refused work, by reason</h3>' + table([
      { h: 'Day', v: (r) => esc(r.day) }, { h: 'Events', n: true, v: (r) => num(r.rejected) }, { h: 'Installs', n: true, v: (r) => num(r.installs) },
      { h: 'Invalid', n: true, v: (r) => '<span class="' + (r.invalid ? 'bad' : '') + '">' + num(r.invalid) + '</span>' },
      { h: 'Not member', n: true, v: (r) => num(r.notMember) }, { h: 'Not allowed', n: true, v: (r) => num(r.notAllowed) },
      { h: 'Clock ahead', n: true, v: (r) => num(r.clockAhead) }, { h: 'Other', n: true, v: (r) => num(r.other) + num(r.notListed) }
    ], d.rejected.slice().reverse());
    h += '<h3>What arrived (the projection pass\'s sample)</h3>' + table([
      { h: 'Day', v: (r) => esc(r.day) }, { h: 'New events', n: true, v: (r) => num(r.newEvents) }, { h: 'Sampled', n: true, v: (r) => num(r.sampled) },
      { h: 'Delay p50', n: true, v: (r) => hours(r.p50Ms) }, { h: 'p95', n: true, v: (r) => hours(r.p95Ms) }, { h: 'Longest', n: true, v: (r) => hours(r.maxMs) },
      { h: 'Ahead of clock', n: true, v: (r) => num(r.futureStamped) + (r.futureInstalls ? ' <small>(' + num(r.futureInstalls) + ' installs)</small>' : '') }
    ], d.arrivals.slice().reverse());
    h += '<h3>Fold canary (nightly)</h3>' + table([
      { h: 'When', v: (c) => when(c.at) }, { h: 'Outcome', v: (c) => '<span class="' + (c.outcome === 'error' ? 'bad' : c.outcome === 'partial' ? 'warn' : 'good') + '">' + esc(c.outcome) + '</span>' },
      { h: 'Languages', n: true, v: (c) => num(c.languages) }, { h: 'Mismatched', n: true, v: (c) => '<span class="' + (c.mismatched ? 'bad' : '') + '">' + num(c.mismatched) + '</span>' },
      { h: 'First mismatch', v: (c) => c.stream ? short(c.stream) + ' in ' + (c.org ? orgLink(c.org) : '?') : '–' }
    ], d.canary);
    if (!p) return h + '<p class="muted">Projection lag and snapshots need migration 20261023100000_ops_dashboard.sql.</p>';
    h += '<h3>Furthest behind the projection pass</h3>' + table([
      { h: 'Language', v: (l) => esc(l.name || l.languageId) + ' <small>' + orgLink(l.orgId, 'org') + '</small>' },
      { h: 'Behind', n: true, v: (l) => num(l.behind) }, { h: 'Head', n: true, v: (l) => num(l.head) }, { h: 'Projected', v: (l) => when(l.projectedAt) }
    ], p.lag);
    h += '<h3>Snapshots</h3><p>' + num(p.snapshots.overdue) + ' overdue (decision 88) · ' + num(p.snapshots.oldReducer) + ' on an older reducer · ' + num(p.snapshots.noCut) + ' not cut by passage yet</p>' +
      table([{ h: 'Language', v: (l) => esc(l.name || l.languageId) + ' <small>' + orgLink(l.orgId, 'org') + '</small>' }, { h: 'Events past it', n: true, v: (l) => num(l.behind) }, { h: 'Age', n: true, v: (l) => l.ageMinutes === null ? '–' : ms(l.ageMinutes * 60000) }], p.snapshots.worst);
    if (d.copies) {
      h += '<h3>Snapshot copies</h3><p>' + num(d.copies.total.snapshots) + ' copies of ' + num(d.copies.total.languages) + ' languages on ' + num(d.copies.total.versions) + ' reducer versions, ' + num(d.copies.total.pieces) + ' pieces, ' + bytes(d.copies.total.chars) + ' before compression</p>' + table([
        { h: 'Reducer', v: (v) => esc(String(v.reducer)) }, { h: 'Languages', n: true, v: (v) => num(v.languages) }, { h: 'Copies', n: true, v: (v) => num(v.snapshots) },
        { h: 'Pieces', n: true, v: (v) => num(v.pieces) }, { h: 'Size', n: true, v: (v) => bytes(v.chars) }, { h: 'Newest', v: (v) => when(v.newestAt) }, { h: 'Oldest', v: (v) => when(v.oldestAt) }
      ], d.copies.byVersion) +
      '<h3>Languages with the most copies</h3>' + table([
        { h: 'Language', v: (l) => esc(l.name || l.languageId) + ' <small>' + orgLink(l.orgId, 'org') + '</small>' }, { h: 'Copies', n: true, v: (l) => num(l.snapshots) },
        { h: 'Per reducer', v: (l) => l.perVersion.map((p) => esc(String(p.reducer)) + ': ' + num(p.snapshots)).join(' · ') }, { h: 'Size', n: true, v: (l) => bytes(l.chars) }
      ], d.copies.languages);
    }
    h += '<h3>Largest languages</h3>' + table([
      { h: 'Language', v: (l) => esc(l.name || l.languageId) + ' <small>' + orgLink(l.orgId, 'org') + '</small>' }, { h: 'Events', n: true, v: (l) => num(l.events) }, { h: 'Snapshot', n: true, v: (l) => bytes(l.snapshotBytes) }
    ], p.largest);
    return h;
  },
  fleet(d) {
    let h = '<h3>Phones by build</h3>' + table([
      { h: 'Platform', v: (b) => esc(b.platform) }, { h: 'Version', v: (b) => '<code>' + esc(b.version) + '</code>' }, { h: 'Reducer', v: (b) => esc(b.reducers || '–') },
      { h: 'Last day', n: true, v: (b) => num(b.day) }, { h: 'Last 7 days', n: true, v: (b) => num(b.week) }, { h: 'Last 14 days', n: true, v: (b) => num(b.fortnight) }
    ], d.builds || []);
    h += '<h3>Updates in the field, 14 days</h3>' + table([
      { h: 'Update', v: (u) => '<code>' + esc(u.update) + '</code>' }, { h: 'Channel', v: (u) => esc(u.channel || '–') }, { h: 'Runtime', v: (u) => '<small>' + esc(u.runtime || '–') + '</small>' },
      { h: 'Installs', n: true, v: (u) => num(u.installs) }, { h: 'Crashed', n: true, v: (u) => '<span class="' + (u.crashed ? 'warn' : '') + '">' + num(u.crashed) + '</span>' },
      { h: 'Crash-free', n: true, v: (u) => share(u.installs - u.crashed, u.installs) }, { h: 'First seen', v: (u) => when(u.firstSeen) }
    ], d.updates);
    h += '<h3>Reducer and protocol, installs this week</h3>' + table([{ h: 'Reducer', v: (v) => esc(v.reducer || '?') }, { h: 'Protocol', v: (v) => esc(v.protocol || '?') }, { h: 'Installs', n: true, v: (v) => num(v.installs) }], d.versions);
    h += '<h3>Browsers by web commit, this week</h3>' + table([{ h: 'Commit', v: (w) => '<code>' + esc(String(w.commit || '?').slice(0, 8)) + '</code>' }, { h: 'Installs', n: true, v: (w) => num(w.installs) }], d.web);
    h += '<h3>Time to a usable Map</h3><p class="muted">open: a language\'s first full download; fill: a big language, until its Map shows.</p>' + table([
      { h: 'Day', v: (r) => esc(r.day) }, { h: 'Kind', v: (r) => esc(r.kind) }, { h: 'Count', n: true, v: (r) => num(r.count) }, { h: 'p50', n: true, v: (r) => hours(r.p50Ms) }, { h: 'p95', n: true, v: (r) => hours(r.p95Ms) }
    ], d.toMap.slice().reverse().slice(0, 14));
    h += '<h3>First downloads that fell back or started over</h3>' + table([
      { h: 'Day', v: (r) => esc(r.day) },
      { h: 'What went wrong', v: (r) => (r.what === 'fallback' ? 'Took the whole snapshot' : r.what === 'restart' ? 'Started over' : 'No snapshot for reducer') + ' <code>' + esc(r.reason) + '</code>' },
      { h: 'Count', n: true, v: (r) => num(r.count) }, { h: 'Installs', n: true, v: (r) => num(r.installs) }
    ], (d.firstDownloads || []).slice(0, 20));
    h += '<h3>Stuck phones</h3>' + table([
      { h: 'Install', v: (s) => installLink(s.install) }, { h: 'Unsent for', n: true, v: (s) => s.unsentMin ? ms(s.unsentMin * 60000) : '–' },
      { h: 'Download stuck', n: true, v: (s) => s.stuckMin ? ms(s.stuckMin * 60000) : '–' }, { h: 'Free', n: true, v: (s) => s.freeMb === null ? '–' : num(s.freeMb) + ' MB' },
      { h: 'Lost', n: true, v: (s) => '<span class="' + (s.lostRecordings ? 'bad' : '') + '">' + num(s.lostFiles || 0) + (s.lostRecordings ? ' (' + num(s.lostRecordings) + ' rec.)' : '') + '</span>' },
      { h: 'Reported', v: (s) => when(s.at) }
    ], d.stuck);
    h += '<h3>Silent phones</h3><p>' + num(d.silent.count) + ' quiet for 3 days while another device of the same person reports.</p>' +
      (d.silent.installs.length ? '<p>' + d.silent.installs.map((s) => installLink(s.install) + ' <small>' + ageOf(s.lastSeen) + '</small>').join(' · ') + '</p>' : '');
    return h;
  },
  pipeline(d) {
    // Each store build sits in the stage it is in now, an arrow to the next; inside it, the over-the-air updates it takes.
    const PHONES = { ios: 'iPhones', android: 'Android phones' };
    // A pull request shows in each build that has it: from main in the newer build, and as a copy in an older
    // build through its release branch (decisions.md 155), first as a copy that waits, then as the update it sent.
    // A copy that catches a build up on several shows each, the first few, then how many more.
    const CAUGHT_UP = 3;
    const update = (u, platform) => {
      const phones = u.phones ? ' · ' + num(u.phones.on) + ' of ' + num(u.phones.of) + ' ' + PHONES[platform] + ' run it' : '';
      const how = u.waiting ? 'PR open, not merged yet: copy PR ' + u.copy + ' ' + u.waiting + ' · ' : u.copy ? 'copied by PR ' + u.copy + ' · ' : '';
      const small = esc(how) + esc(ago(u.at)) + esc(phones);
      const cls = 'pu' + (u.waiting ? ' pend' : '') + (u.needsPerson ? ' stuck' : '') + (u.copy ? ' cp' : '');
      const link = (n, name, body) => '<a class="' + cls + '" href="https://github.com/' + esc(d.repo) + '/pull/' + encodeURIComponent(n) + '" target="_blank" rel="noopener" title="' + esc(name) + '">' + body + '</a>';
      if (u.rollBack || (!u.pr && !u.copy)) {
        const name = u.rollBack ? 'Back to the build\'s own code' : 'Update ' + u.id.slice(0, 8);
        return '<div class="' + cls + '" title="' + esc(name) + '"><b>' + esc(name) + '</b><small>' + small + '</small></div>';
      }
      if (!u.pr) { const name = 'Copy PR ' + u.copy + (u.title ? ' · ' + u.title : ''); return link(u.copy, name, '<b>' + esc(name) + '</b><small>' + small + '</small>'); }
      const prs = [{ pr: u.pr, title: u.title }].concat(u.also || []);
      const shown = prs.slice(0, prs.length > CAUGHT_UP + 1 ? CAUGHT_UP : prs.length);
      const more = prs.length - shown.length + (u.more || 0);
      return shown.map((p) => { const name = 'PR ' + p.pr + (p.title ? ' · ' + p.title : ''); return link(p.pr, name, '<b>' + esc(name) + '</b><small>' + small + '</small>'); }).join('') +
        (more ? link(u.copy, num(more) + ' more PRs in copy PR ' + u.copy, '<b>' + esc(num(more) + ' more PRs in copy PR ' + u.copy) + '</b><small>' + small + '</small>') : '');
    };
    const card = (c, platform) => '<div class="pc ' + esc(c.tone) + '"><b>' + esc(c.title) + '</b>' + (c.version ? ' <small>' + esc(c.version) + '</small>' : '') +
      '<span>' + esc(c.state) + '</span>' + (c.at ? '<small>' + when(c.at) + '</small>' : '') +
      (c.updates.length ? '<div class="pus"><div class="puh">Over-the-air updates</div>' + c.updates.map((u) => update(u, platform)).join('') + '</div>' : '') + '</div>';
    const arrow = '<div class="pa" aria-hidden="true"></div>';
    const lane = (l) => '<div class="lane"><h3>' + esc(l.title) + '</h3><div class="flow">' + l.stages.map((s, i) => (i ? arrow : '') +
      '<div class="stage"><div class="st" data-help-key="' + esc(s.title) + '">' + esc(s.title) + '</div>' +
      (s.cards.length ? s.cards.map((c) => card(c, l.id)).join('') : '<div class="pc none">' + esc(s.unseen || 'none') + '</div>') + '</div>').join('') + '</div>' +
      l.notes.map((n) => '<p class="muted">' + esc(n) + '</p>').join('') + '</div>';
    return '<div class="legend"><span class="pc busy">on its way</span><span class="pc wait">waiting</span><span class="pc bad">needs a person</span><span class="pc live">what people get</span></div>' +
      d.lanes.map(lane).join('') +
      '<p class="muted"><small>Phones: active in the last ' + num(d.activeDays) + ' days, with diagnostics on.</small></p>';
  },
  adoption(d) {
    // Each row: one channel, platform and runtime the phones run. Newest is what EAS published last for exactly that.
    const cell = (n, of, tone) => num(n) + (of ? ' <small class="' + (tone || '') + '">' + share(n, of) + '</small>' : '');
    return table([
      { h: 'Channel', v: (r) => esc(r.channel) + ' <small>' + esc(r.platform) + '</small>' },
      { h: 'Runtime', v: (r) => '<code title="' + esc(r.runtime) + '">' + esc(String(r.runtime).slice(0, 8)) + '</code>' },
      { h: 'Newest update', v: (r) => r.newest ? '<code title="' + esc(r.newest.id) + '">' + esc(r.newest.id.slice(0, 8)) + '</code>' + (r.newest.rollBackToEmbedded ? ' <small>roll back to embedded</small>' : '') + '<br><small>' + when(r.newest.at) + '</small>' : '<span class="muted">none published</span>' },
      { h: 'Installs', n: true, v: (r) => num(r.installs) },
      { h: 'On newest', n: true, v: (r) => cell(r.onNewest, r.installs, r.newest && r.onNewest < r.installs / 2 ? 'warn' : 'good') },
      { h: 'Older update', n: true, v: (r) => cell(r.older, r.installs) },
      { h: 'Embedded', n: true, v: (r) => cell(r.embedded, r.installs) }
    ], d.rows) + '<p class="muted">Installs that reported in the last ' + num(d.activeDays) + ' days, by what they ran then; phones with diagnostics off are not counted, and browsers have no updates. A phone takes an update on its next launch after it downloads.</p>';
  },
  releases(d) {
    const m = d.migrations;
    let h = '<div class="stats">' + d.hosts.slice(1).map((x) => stat('<code>' + esc(x.build ? String(x.build).slice(0, 8) : '?') + '</code>', x.url.replace('https://', ''), x.error ? 'bad' : '')).join('') +
      stat(m.behind === null ? '?' : num(m.behind), 'migrations behind main', m.behind ? 'bad' : '', NOW) + '</div>';
    if (m.error) h += '<p class="muted">' + esc(m.error) + '</p>';
    h += '<h3>Errors phones reported</h3>' + table([{ h: 'Day', v: (r) => esc(r.day) }, { h: 'Errors', n: true, v: (r) => num(r.errors) }, { h: 'Crashes', n: true, v: (r) => '<span class="' + (r.crashes ? 'warn' : '') + '">' + num(r.crashes) + '</span>' }, { h: 'Installs', n: true, v: (r) => num(r.installs) }], d.errorsByDay.slice().reverse());
    h += '<h3>What shipped, 14 days</h3>' + table([{ h: 'When', v: (e) => when(e.at) }, { h: 'What', v: (e) => '<span class="tag">' + esc(e.kind) + '</span> ' + esc(e.text) }], d.timeline.slice(0, 40));
    for (const n of d.notes || []) h += '<p class="muted">' + esc(n) + '</p>';
    return h;
  },
  cron(d) {
    return table([
      { h: 'Job', v: (j) => '<b>' + esc(j.jobname) + '</b><br><small>' + esc(j.schedule) + (j.active ? '' : ' · off') + '</small>' },
      { h: 'Last run', v: (j) => when(j.lastRunAt) + '<br><small class="' + (j.lastStatus === 'failed' ? 'bad' : '') + '">' + esc(j.lastStatus || '–') + '</small>' },
      { h: 'Runs 24 h', n: true, v: (j) => num(j.runs24h) }, { h: 'Failed', n: true, v: (j) => '<span class="' + (j.failures24h ? 'bad' : '') + '">' + num(j.failures24h) + '</span>' }
    ], d.jobs);
  },
  dbdetail(d) {
    // Whose each one is (role, client, kind), never its text; background work that always runs is left out of both.
    const who = (a, extra) => a ? [a.role || '?', a.client, a.kind !== 'client backend' ? a.kind : null, extra].filter(Boolean).join(' · ') : '';
    const q = d.longestQuery, x = d.oldestXact;
    const bg = (d.background || []).map((b) => esc(b.kind) + ' ' + num(b.n) + (b.seconds === null ? '' : ', ' + ms(b.seconds * 1000)));
    return '<div class="stats">' +
      stat(d.longestQueryS === null ? '–' : ms(d.longestQueryS * 1000), 'longest query', q && q.waitingOn === 'Lock' ? 'warn' : '', 'running now' + (q ? ' · ' + who(q, q.waitingOn ? 'waiting on ' + q.waitingOn : null) : '')) +
      stat(d.oldestXactS === null ? '–' : ms(d.oldestXactS * 1000), 'oldest transaction', '', 'open now' + (x ? ' · ' + who(x, x.state && x.state !== 'active' ? x.state : null) : '')) + '</div>' +
      (bg.length ? '<p class="muted">Left out as background work that always runs: ' + bg.join(' · ') + '.</p>' : '') +
      '<h3>Largest tables</h3>' + table([{ h: 'Table', v: (t) => '<code>' + esc(t.name) + '</code>' }, { h: 'Size', n: true, v: (t) => bytes(t.bytes) }, { h: 'Rows', n: true, v: (t) => num(t.rows) }, { h: 'Dead', n: true, v: (t) => t.deadRatio === null ? '–' : '<span class="' + (t.deadRatio >= 0.3 ? 'warn' : '') + '">' + (t.deadRatio * 100).toFixed(0) + '%</span>' }], d.tables) +
      '<h3>Largest indexes</h3>' + table([{ h: 'Index', v: (i) => '<code>' + esc(i.name) + '</code>' }, { h: 'Table', v: (i) => '<small>' + esc(i.table) + '</small>' }, { h: 'Size', n: true, v: (i) => bytes(i.bytes) }], d.indexes);
  },
  push(d) {
    const r = d.runs || {};
    return '<div class="stats">' + stat(num(d.pending), 'waiting', d.pending ? 'warn' : '', oldest(d.oldestPendingAt)) + (d.inboxOnly === undefined ? '' : stat(num(d.inboxOnly), 'Inbox only, no push token', '', NOW)) +
      stat(num(d.tokens), 'push tokens', '', NOW) + stat(num(d.membersWithoutToken), 'members without a token', '', NOW) + '</div>' +
      '<p class="muted">Push delivery, last 24 h: ' + esc(Object.entries(r).map(([k, v]) => k + ' ' + num(v)).join(' · ') || 'no runs') + '</p>' +
      '<h3>Failures, last 24 h</h3>' + table([{ h: 'Code', v: (e) => '<code>' + esc(e.code) + '</code>' }, { h: 'Count', n: true, v: (e) => num(e.n) }], d.errors24h);
  },
  worker(d) {
    return table([
      { h: 'Route', v: (r) => '<code>' + esc(r.route) + '</code>' }, { h: 'Requests', n: true, v: (r) => num(r.requests) },
      { h: '5xx', n: true, v: (r) => '<span class="' + (r.s5xx ? 'bad' : '') + '">' + num(r.s5xx) + '</span>' }, { h: '429', n: true, v: (r) => '<span class="' + (r.s429 ? 'warn' : '') + '">' + num(r.s429) + '</span>' },
      { h: '<100 ms', n: true, v: (r) => num(r.lt100ms) }, { h: '<1 s', n: true, v: (r) => num(r.lt1s) }, { h: '<10 s', n: true, v: (r) => num(r.lt10s) }, { h: '10 s+', n: true, v: (r) => '<span class="' + (r.over10s ? 'warn' : '') + '">' + num(r.over10s) + '</span>' }
    ], d.routes) + '<p class="muted">Counted by the app Worker\'s isolates (requestTally.ts), each flushing at most once a minute.</p>';
  },
  integrations(d) {
    return '<div class="stats">' + stat(num(d.tokens.total), 'access tokens', '', 'live now') + stat(num(d.deviceGrants.pending), 'device grants waiting', '', NOW) + stat(num(d.webhooks.active), 'webhooks on', '', NOW) +
      stat(num(d.reviewLinks.active), 'review links live', '', NOW) + stat(num(d.api.agentApi + d.api.mcp), 'API calls, 24 h') + '</div>' +
      '<h3>Tokens by scope</h3>' + table([{ h: 'Scope', v: (s) => '<code>' + esc(s.scope) + '</code>' }, { h: 'Tokens', n: true, v: (s) => num(s.n) }], d.tokens.byScope) +
      '<h3>Webhooks switched off</h3>' + table([{ h: 'Why', v: (w) => esc(w.reason || '–') }, { h: 'Count', n: true, v: (w) => num(w.n) }], d.webhooks.disabled) +
      '<p class="muted">Deliveries, last 24 h: ' + esc(Object.entries(d.dispatch || {}).map(([k, v]) => k + ' ' + num(v)).join(' · ') || 'none') + ' · new this week: ' + num(d.tokens.createdWeek) + ' tokens, ' + num(d.deviceGrants.createdWeek) + ' device grants asked (' + num(d.deviceGrants.approvedWeek) + ' approved), ' + num(d.reviewLinks.createdWeek) + ' review links</p>';
  },
  storage(d) {
    const b = d.backups, r = d.r2;
    let h = '<div class="stats">' +
      (b ? stat(b.error ? '?' : b.pitr ? 'on' : 'off', 'point-in-time recovery', b.pitr ? '' : 'warn', NOW) + stat(b.error ? '?' : ageOf(b.latest), 'latest backup') : stat('–', 'backups (needs ADMIN_SUPABASE_TOKEN)')) +
      (r ? stat(r.error ? '?' : num(r.objects), 'R2 objects', '', 'latest daily count') : stat('–', 'R2 (needs ADMIN_CLOUDFLARE_TOKEN)')) + '</div>';
    if (b && b.error) h += '<p class="bad">' + esc(b.error) + '</p>';
    if (r && r.error) h += '<p class="bad">' + esc(r.error) + '</p>';
    h += '<p class="notice">R2 holds the only copy of recordings: there is no second copy yet.</p>';
    h += '<h3>Nightly R2 check</h3>' + (d.reconcile ? '<p>' + when(d.reconcile.at) + ' · ' + esc(d.reconcile.outcome) + ' · ' + esc(Object.entries(d.reconcile.n).map(([k, v]) => k + ' ' + num(v)).join(' · ')) + '</p>' : '<p class="muted">Not run yet.</p>');
    h += '<h3>Files lost on phones (decision 92)</h3>' + table([{ h: 'Day', v: (x) => esc(x.day) }, { h: 'Installs', n: true, v: (x) => num(x.installs) }, { h: 'Files', n: true, v: (x) => num(x.files) }], d.lostFiles.slice().reverse());
    return h;
  },
  people(d) {
    let h = '<div class="stats">' + stat(num(d.accounts.total), 'accounts', '', ALL_TIME) + stat(num(d.activeProfiles.day), 'active today', '', LAST_DAY) + stat(num(d.activeProfiles.week), 'active this week', '', LAST_WEEK) +
      stat(num(d.orgs.total), 'organizations', '', ALL_TIME) + stat(num(d.languages.total), 'languages', '', ALL_TIME) +
      stat(num(d.joining.pendingRequests), 'join requests waiting', d.joining.pendingRequests ? 'warn' : '', oldest(d.joining.oldestRequestAt)) +
      stat(num(d.accounts.suspended), 'suspended', '', NOW) + stat(num(d.accounts.managed), 'looked after', '', NOW) + '</div>';
    h += '<h3>Most recently active organizations</h3>' + table([
      { h: 'Organization', v: (o) => orgLink(o.orgId, o.name) }, { h: 'Members', n: true, v: (o) => num(o.members) }, { h: 'Languages', n: true, v: (o) => num(o.languages) },
      { h: 'Events', n: true, v: (o) => num(o.events) }, { h: 'Requests', n: true, v: (o) => num(o.pendingRequests) }, { h: 'Last projected', v: (o) => when(o.lastProjectedAt) }
    ], d.orgs.top || []);
    h += '<h3>By day</h3>' + table([
      { h: 'Day', v: (x) => esc(x.day) }, { h: 'New accounts', n: true, v: (x) => num(x.n) },
      { h: 'Invites issued', n: true, v: (x) => num((d.joining.invitesByDay.find((i) => i.day === x.day) || {}).issued || 0) },
      { h: 'Redeemed', n: true, v: (x) => num((d.joining.invitesByDay.find((i) => i.day === x.day) || {}).redeemed || 0) },
      // A day before the projection pass counted arrivals has no entry: unknown, not none.
      { h: 'Events', n: true, v: (x) => { const e = (d.eventsByDay || []).find((y) => y.day === x.day); return e ? num(e.events) : '–'; } }
    ], d.accounts.newByDay.slice().reverse());
    return h;
  },
  support(d) {
    const fb = d.feedbackOpen;
    return '<div class="stats">' + stat(num(d.reports.open), 'open reports', d.reports.open ? 'warn' : '', oldest(d.reports.oldestAt, 'none open')) +
      stat(num(d.reports.staffOnly), 'only staff can act on', d.reports.staffOnly ? 'warn' : '', NOW) + stat(num(d.reports.resolvedWeek), 'resolved this week', '', LAST_WEEK) +
      stat(num(d.suspended.total), 'suspended', '', NOW) +
      stat(fb ? num(fb.open) : '–', 'feedback not done', '', fb ? oldest(fb.oldestAt, 'none open') : 'could not read') + '</div>' +
      '<p class="muted">Act on reports with npm run moderation -- --hosted (decision 48).</p>' +
      // Blue checks (decisions.md 173): an admin confirmed an address at the domain; staff check the domain is this organization.
      '<h3>Blue check requests</h3>' + (d.verifications === null ? '<p class="muted">Could not read them (the database lacks diag.org_verification_requests).</p>'
        : '<p class="muted">An admin of each confirmed an email address at the domain. Open the website first: is it this organization? npm run org-verification -- list --hosted shows the address.</p>' +
        table([
          { h: 'Organization', v: (v) => esc(v.orgName || v.orgId) + '<br><small>' + short(v.orgId) + '</small>' },
          { h: 'Website', v: (v) => '<a href="https://' + esc(v.domain) + '" target="_blank" rel="noopener noreferrer">' + esc(v.domain) + '</a>' + (v.emailDomain !== v.domain ? '<br><small>address at ' + esc(v.emailDomain) + '</small>' : '') },
          { h: 'Asked', v: (v) => when(v.createdAt) },
          { h: 'Status', v: (v) => '<span class="' + (v.status === 'waiting' ? 'warn' : v.status === 'granted' ? 'good' : 'bad') + '">' + esc(v.status) + '</span>' + (v.decidedAt ? '<br><small>' + when(v.decidedAt) + '</small>' : '') },
          { h: '', v: (v) => v.status === 'waiting' ? '<button data-ver="' + esc(v.id) + '" data-decision="grant">Grant</button> <button data-ver="' + esc(v.id) + '" data-decision="decline">Decline</button>' : '' }
        ], d.verifications)) +
      '<h3>Accounts deleted, by week</h3>' + table([{ h: 'Week of', v: (w) => esc(w.week) }, { h: 'Deleted', n: true, v: (w) => num(w.n) }], d.deletions.slice().reverse()) +
      '<h3>Done from this page</h3>' + table([{ h: 'When', v: (a) => when(a.at) }, { h: 'Who', v: (a) => short(a.profileId) }, { h: 'What', v: (a) => esc(a.action) + ' <code>' + esc(String(a.target).slice(0, 12)) + '</code>' },
        { h: 'Result', v: (a) => '<span class="' + (a.result === 'ok' ? 'good' : a.result === 'error' ? 'bad' : 'warn') + '">' + esc(a.result) + (a.detail ? ' · ' + esc(a.detail) : '') + '</span>' }], d.actions || []);
  },
  security(d) {
    const g = d.globalViewers || {}, l = d.limits;
    return '<div class="stats">' + stat(num(g.active || 0), 'Global Viewers', '', NOW) + stat(num(g.signedInAal2 || 0), 'signed in with a code', '', 'last 12 h') + stat(num(g.revoked || 0), 'revoked', '', ALL_TIME) + '</div>' +
      '<h3>Limits hit</h3>' + table([{ h: 'Limit', v: (x) => esc(x[0]) }, { h: 'Count', n: true, v: (x) => num(x[1]) }], [
        ['Device-code refusals, 24 h', l.deviceRefused], ['Review-link refusals, 24 h', l.linksRefused], ['Failed v2 sign-ins, 24 h', l.v2SignInFailures24h], ['Installs at the diagnostics cap today', l.installsAtDiagCap]
      ]);
  },
  expiry(d) {
    const left = (iso) => iso ? Math.ceil((Date.parse(iso) - Date.now()) / 86400000) : null;
    return table([
      { h: 'What', v: (i) => esc(i.what) + (i.note ? '<br><small>' + esc(i.note) + '</small>' : '') }, { h: 'Source', v: (i) => '<small>' + esc(i.source) + '</small>' },
      { h: 'Expires', v: (i) => i.expires ? esc(i.expires.slice(0, 10)) : '<span class="muted">no date</span>' },
      { h: 'Days', n: true, v: (i) => { const n = left(i.expires); return n === null ? '–' : '<span class="' + (n <= 7 ? 'bad' : n <= 30 ? 'warn' : '') + '">' + n + '</span>'; } }
    ], d.items) + (d.notes || []).map((n) => '<p class="muted">' + esc(n) + '</p>').join('');
  },
  capacity(d) {
    const u = d.usage;
    // Growth is over the nightly sizes the fold canary kept (60 days at most) and R2's last 8 daily counts; it needs a week of them.
    const firstSize = (d.history || [])[0];
    let h = '<div class="stats">' + stat(d.now ? bytes(d.now.dbBytes) : '–', 'database of ' + bytes(d.limitBytes), d.now && d.now.dbBytes >= d.limitBytes * 0.9 ? 'warn' : '', d.limitFrom === 'setting' ? 'disk size from the setting: Supabase did not say' : NOW) +
      stat(d.dbGrowthPerDay === null ? '–' : bytes(d.dbGrowthPerDay * 7), 'database growth a week', '', d.dbGrowthPerDay === null ? 'needs a week of nightly sizes' : since(firstSize && firstSize.at)) +
      stat(d.weeksLeft === null ? '–' : Math.round(d.weeksLeft), 'weeks left at that rate', d.weeksLeft !== null && d.weeksLeft < 12 ? 'warn' : '') +
      (d.now ? stat(bytes(d.now.eventsBytes), 'event log (' + num(d.now.eventsRows) + ' rows)', '', NOW) : '') +
      (d.r2 ? stat(bytes(d.r2.bytes), 'R2', '', 'latest daily count') + stat(d.r2.growthPerDay === null ? '–' : bytes(d.r2.growthPerDay * 7), 'R2 growth a week', '', LAST_WEEK) : '') + '</div>';
    if (u) {
      h += u.error ? '<p class="bad">' + esc(u.error) + '</p>' : '<h3>Cloudflare this month, against the plan</h3>' + (u.since ? '<p class="muted">Counted ' + esc(since(u.since)) + ', the start of the billing month (UTC).</p>' : '') + table([{ h: 'What', v: (x) => esc(x[0]) }, { h: 'Used', n: true, v: (x) => num(x[1]) }, { h: 'Included', n: true, v: (x) => num(x[2]) }, { h: 'Share', n: true, v: (x) => '<span class="' + (x[1] > x[2] ? 'warn' : '') + '">' + share(x[1], x[2]) + '</span>' },
        { h: 'Extra cost', n: true, v: (x) => x[3] === undefined || x[1] <= x[2] ? '–' : '$' + (Math.max(0, x[1] - x[2]) * x[3]).toFixed(2) }], [
        ['Workers requests', u.workersRequests, u.allowance.workersRequests, u.price && u.price.workersRequests], ['Durable Object requests', u.doRequests, u.allowance.doRequests, u.price && u.price.doRequests],
        ['R2 class A operations', u.r2ClassA, u.allowance.r2ClassA, u.price && u.price.r2ClassA], ['R2 class B operations', u.r2ClassB, u.allowance.r2ClassB, u.price && u.price.r2ClassB]
      ]) + '<p class="muted">Container time is not in the analytics this page reads: see the Cloudflare dashboard.</p>';
    }
    return h;
  },
  // The tutorial videos as three lists (sources/videos.ts): what an admin must do, what the workers do, and each video with its states and timeline.
  videos(d) {
    VIDEOS = d;
    const item = (x, level) => '<div class="vi ' + level + '"><p><b>' + esc(x.title) + '</b>' + (x.at ? ' <small>' + when(x.at) + '</small>' : '') + '</p>' +
      (x.detail ? '<p class="setup">' + esc(x.detail) + '</p>' : '') + (x.link ? '<p>' + cardLink(x) + '</p>' : '') + '</div>';
    const now = d.worker.filter((w) => w.when === 'now');
    // The cards of one video are on its row, behind the mark at the right; here, only what is not one video's.
    const general = d.admin.filter((a) => !a.tutorial);
    const needYou = d.languages.reduce((n, l) => n + l.issues, 0);
    let h = '<div class="stats">' + stat(num(needYou), needYou === 1 ? 'video waits on an admin' : 'videos wait on an admin', needYou ? 'warn' : '', 'every language') +
      stat(num(now.length), 'worker jobs running', '', NOW) + stat(num(d.worker.length - now.length), 'worker jobs waiting', '', 'now or tonight') +
      stat(num(d.videos.filter((v) => v.language === 'en' && v.states[0].key === 'current').length) + ' of ' + num(d.videos.filter((v) => v.language === 'en').length), 'English videos up to date', '', NOW) + '</div>';
    if (d.missing.length) h += '<p class="muted">Not read: ' + esc(d.missing.join('; ')) + '. The lists leave those out.</p>';
    h += '<div class="vl"><div><h3>For an admin</h3>' +
      (needYou ? '<p>' + num(needYou) + (needYou === 1 ? ' video waits' : ' videos wait') + ' on you. Each has a <span class="warnmk you">!</span> at the right of its row, under By video.</p>' : '') +
      (general.length ? general.map(adminCard).join('') : needYou ? '' : '<p class="muted">Nothing.</p>') + '</div>' +
      '<div><h3>Workers, now and tonight</h3>' + (d.worker.length ? d.worker.map((w) => item(w, w.when === 'now' ? 'info' : '')).join('') : '<p class="muted">Nothing queued.</p>') + '</div></div>';
    setTimeout(() => layoutTimelines(), 0);
    return h + '<h3>By video</h3><div id="video-rows">' + videoRows() + '</div>';
  },
  tutorials(d) {
    const connected = d.channels.filter((c) => c.connectedAt).length;
    const ready = d.waiting.filter((w) => !w.chosenAt);
    const up = d.channels.reduce((n, c) => n + c.videos, 0);
    let h = '<div class="stats">' + stat(connected + ' of ' + d.channels.length, 'channels connected', connected < d.channels.length ? 'warn' : '', NOW) +
      stat(num(ready.length), 'ready to publish', ready.length ? 'warn' : '', NOW) + stat(num(d.waiting.length - ready.length), 'chosen, going up', '', 'YouTube takes 100 a day') +
      stat(num(up), 'videos on YouTube', '', ALL_TIME) + '</div>';
    h += '<h3>Channels</h3><p class="muted">Connect opens Google\'s page: sign in with the account that owns the channels and choose that language\'s channel.</p>' + table([
      { h: 'Language', v: (c) => esc(languageName(c.language)) },
      { h: 'Channel', v: (c) => '<a href="https://www.youtube.com/channel/' + esc(c.channelId) + '" target="_blank" rel="noopener noreferrer">' + esc(c.title || 'Open on YouTube') + '</a>' },
      { h: 'Connected', v: (c) => c.connectedAt ? when(c.connectedAt) + (c.section && c.section !== 'made' && c.section !== 'updated' ? '<br><small class="warn">Other channels list: ' + esc(c.section) + '</small>' : '') : '<span class="muted">not yet</span>' },
      { h: 'Description and banner', v: (c) => c.branded ? 'on' + (c.brandFailed ? '<br><small class="warn">Last change: ' + esc(c.brandFailed) + '</small>' : '') : c.brandFailed ? '<span class="warn">' + esc(c.brandFailed) + '</span>' : c.connectedAt ? '<span class="muted">at the next publish run</span>' : '' },
      { h: 'Videos up', n: true, v: (c) => num(c.videos) },
      { h: 'Held comments', n: true, v: (c) => c.held ? '<a class="warn" href="https://studio.youtube.com/channel/' + esc(c.channelId) + '/comments/inbox" target="_blank" rel="noopener noreferrer">' + num(c.held) + '</a>' : c.held === 0 ? '0' : '' },
      { h: '', v: (c) => '<button data-yt-connect="' + esc(c.language) + '">' + (c.connectedAt ? 'Connect again' : 'Connect') + '</button>' }
    ], d.channels);
    h += '<h3>Not on YouTube yet</h3>';
    if (ready.length) h += '<p><label><input type="checkbox" data-yt-all> All ' + num(ready.length) + ' ready</label> <button data-yt-publish disabled>Publish</button></p>';
    h += table([
      { h: '', v: (w) => w.chosenAt ? '' : '<input type="checkbox" data-yt-item data-t="' + esc(w.tutorial) + '" data-l="' + esc(w.language) + '" data-s="' + esc(w.sha256) + '" aria-label="Choose ' + esc(w.title) + '">' },
      { h: 'Language', v: (w) => esc(languageName(w.language)) },
      { h: 'Video', v: (w) => esc(w.title) + '<br><small>' + esc(w.playlist) + (w.replaces ? ' · replaces <a href="https://youtu.be/' + esc(w.replaces) + '" target="_blank" rel="noopener noreferrer">' + esc(w.replaces) + '</a>' : '') + '</small>' },
      { h: 'Length', n: true, v: (w) => Math.floor(w.seconds / 60) + ':' + String(w.seconds % 60).padStart(2, '0') },
      { h: 'Made', v: (w) => when(w.madeAt) },
      { h: 'State', v: (w) => !w.chosenAt ? '<span class="warn">ready</span>' : w.failed ? '<span class="bad">' + esc(w.failed) + '</span><br><small>' + when(w.failedAt) + '</small>' : 'chosen ' + when(w.chosenAt) },
      { h: '', v: (w) => '<a href="/api/tutorials/' + esc(w.language) + '/' + esc(w.tutorial) + '/' + esc(w.sha256) + '.mp4" target="_blank" rel="noopener">Watch</a>' }
    ], d.waiting);
    return h;
  },
  // What came in about the videos and what Claude's nightly look suggests (decisions.md 186): a person accepts, edits or rejects each.
  videofeedback(d) {
    const out = (href, text) => '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
    const titles = new Map(d.videos.map((v) => [v.tutorial, v.title]));
    const video = (t) => t ? esc(titles.get(t) || t) : '';
    // server/tutorialFeedback.ts inputLink
    const link = (i) => i.kind === 'comment' ? (i.youtubeId && i.ref ? 'https://www.youtube.com/watch?v=' + i.youtubeId + '&lc=' + i.ref : 'https://studio.youtube.com')
      : i.kind === 'code' ? (i.pr ? 'https://github.com/genesis-ai-dev/langquest-next/pull/' + i.pr : i.ref ? 'https://github.com/genesis-ai-dev/langquest-next/commit/' + i.ref : null) : null;
    const where = (i) => i.kind === 'comment' ? 'Comment' + (i.language ? ', ' + esc(languageName(i.language)) : '') : i.kind === 'code' ? 'Code change' + (i.pr ? ' #' + i.pr : '') : 'Note';
    const said = (i) => esc(i.english || i.text) + (i.kind === 'comment' && i.english && i.language !== 'en' ? '<details><summary>As written</summary>' + esc(i.text) + '</details>' : '');
    let h = '<div class="stats">' + stat(num(d.open), 'suggestions waiting', d.open ? 'warn' : '', NOW) + stat(num(d.waiting), 'not looked at yet', '', 'Claude looks at 10:00 UTC') +
      stat(num(d.unfiled), 'not in Linear yet', d.unfiled ? 'warn' : '', NOW) +
      stat(d.last ? when(d.last.at) : 'never', 'last look', '', d.last ? num(d.last.looked) + ' looked at, ' + num(d.last.suggested) + ' suggested' : '') + '</div>';
    if (d.last) h += '<p class="muted">' + out(d.last.runUrl, 'The last look\'s run on GitHub') + ', up to ' + out('https://github.com/genesis-ai-dev/langquest-next/commit/' + d.last.sha, '<code>' + esc(d.last.sha.slice(0, 8)) + '</code>') + '.</p>';
    h += '<p class="muted">Suggestions waiting for a yes or no are under For an admin, above.</p>';
    h += '<h3>What came in</h3>' + table([
      { h: 'When', v: (i) => when(i.at) },
      { h: 'Kind', v: (i) => where(i) },
      { h: 'Video', v: (i) => video(i.tutorial) },
      { h: 'What it says', v: (i) => said(i) },
      { h: 'Reply suggested', v: (i) => i.reply ? esc(i.replyEnglish || i.reply) + (i.language !== 'en' ? '<details><summary>In ' + esc(languageName(i.language)) + '</summary>' + esc(i.reply) + '</details>' : '') : '' },
      { h: 'Claude\'s answer', v: (i) => i.lookedAt ? esc(i.outcome || '') : '<span class="muted">at the next look</span>' },
      { h: '', v: (i) => link(i) ? out(link(i), i.kind === 'comment' ? 'Reply on YouTube' : 'Open') : '' }
    ], d.inputs);
    h += '<h3>Add a note</h3><label for="note-video">Video</label><select id="note-video"><option value="">None: a new video, or all of them</option>' +
      d.videos.map((v) => '<option value="' + esc(v.tutorial) + '">' + esc(v.title) + '</option>').join('') + '</select>' +
      '<label for="note-text">Note</label><textarea id="note-text" maxlength="2000" rows="3"></textarea><p><button type="button" data-note>Add note</button></p>';
    return h;
  },
  // What the watch for user issues filed, closed or found already fixed, with the pull request (decisions.md 202).
  userissues(d) {
    const out = (href, text) => '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + text + '</a>';
    const h = '<div class="stats">' + stat(num(d.open), 'open in Linear', d.open ? 'warn' : '', NOW) + stat(num(d.closed), 'closed in Linear', '', '90 days') +
      stat(num(d.fixed), 'already fixed when seen', '', '90 days') + stat(num(d.noiseWeek), 'judged noise', '', LAST_WEEK) +
      stat(d.last ? when(d.last.at) : 'never', 'last look', d.last && d.last.outcome !== 'ok' ? 'bad' : '', d.last ? d.last.outcome : '') + '</div>';
    return h + table([
      { h: 'Issue', v: (r) => r.issue ? out(r.issueUrl, esc(r.issue)) : '<span class="muted">not filed</span>' },
      { h: 'What people hit', v: (r) => esc(r.title || r.keys[0]) + '<br><small>' + r.keys.slice(0, 3).map((k) => '<code>' + esc(k) + '</code>').join(' · ') + (r.keys.length > 3 ? ' …' : '') + '</small>' },
      { h: 'In Linear', v: (r) => r.issue ? '<span class="' + (r.closedAt ? 'good' : 'warn') + '">' + esc(r.state || (r.closedAt ? 'closed' : 'open')) + '</span>' : '' },
      { h: 'Fixed by', v: (r) => r.fixedBy ? out('https://github.com/genesis-ai-dev/langquest-next/pull/' + r.fixedBy, 'PR ' + esc(r.fixedBy)) + '<br><small>' + when(r.fixedAt) + '</small>' : r.closedAt ? '<span class="muted">no PR named</span>' : '' },
      { h: 'Found', v: (r) => when(r.firstAt) }
    ], d.issues);
  },
  // Last night's tests, every suite together (sources/nightly.ts, decisions.md 209): counts and Linear issues; the detail is in Linear.
  nightly(d) {
    const issue = (i) => /^https:\/\/linear\.app\//.test(String(i.url || '')) ? '<a href="' + esc(i.url) + '" target="_blank" rel="noopener noreferrer">' + esc(i.id) + '</a>' : esc(i.id);
    const result = (s) => s.broke ? '<span class="bad">broke: ' + esc(s.broke) + '</span>'
      : '<span class="' + (s.failed ? 'warn' : 'good') + '">' + (s.ran !== null ? num(s.passed) + ' of ' + num(s.ran) + ' passed' : s.failed ? 'failed' : 'passed') + '</span>';
    const rows = d.runs.flatMap((r) => r.run ? r.suites.map((s) => ({ r, s })) : [{ r, s: null }]);
    return table([
      { h: 'Suite', v: (x) => x.s ? esc(x.s.suite) + '<br><small>' + esc(x.r.title) + '</small>' : esc(x.r.title) },
      { h: 'Last night', v: (x) => x.r.run ? '<a href="' + esc(x.r.run.url) + '" target="_blank" rel="noopener">' + when(x.r.run.at) + '</a><br><small><code>' + esc(x.r.run.sha) + '</code></small>' : '<span class="muted">no scheduled run on main yet</span>' },
      { h: 'Result', v: (x) => x.s ? result(x.s) : '' },
      { h: 'Linear', v: (x) => x.s ? x.s.issues.map(issue).join(', ') : '' }
    ], rows) + '<p class="muted">Each failure, with its error and screen, is in its Linear issue.</p>';
  }
});

// ---- the few actions (decisions.md 162): the app Worker checks the person again and records each ----
async function post(action) {
  const t = await token();
  if (!t) { showSignIn(); throw new Error('Signed out'); }
  const res = await fetch('/ops/api/actions', { method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify(action) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
  return body;
}
const SUGGESTION_KINDS = { script: 'Script', screen: 'Screens', voice: 'Voice', code: 'App code', new: 'New video' };
const DECIDED = { accepted: 'Accepted.', 'accepted:waiting': 'Accepted. The comments job puts it in Linear tonight.', rejected: 'Rejected.', edited: 'Saved.' };
const PUBLISHED = {
  started: 'Going up on YouTube now, 100 a day.', running: 'A run is going; it takes them too, or the next daily run does.',
  disabled: 'Chosen, but publishing is off here (no YouTube client).'
};
async function perform(action, button) {
  if (button) button.disabled = true;
  try {
    const body = await post(action);
    say(action.kind === 'run' ? (body.result === 'started' ? 'Started ' + action.key + '.' : action.key + ' was ' + body.result + '; nothing started.')
      : action.kind === 'verification' ? 'Blue check ' + body.result + '.'
      : action.kind === 'tutorials-publish' ? num(action.items.length) + ' chosen. ' + (PUBLISHED[body.result] || body.result)
      : action.kind === 'tutorial-note' ? (body.result === 'instructed' ? 'Sent. Claude starts the fix at its next fix run (:20 and :50 each hour).' : 'Sent. Claude reads it at its next look (10:00 UTC).')
      : action.kind === 'tutorial-suggestion' ? (DECIDED[body.result] || (body.result.startsWith('accepted:') ? 'Accepted, and filed in Linear as ' + body.result.slice(9) + '.' : body.result))
      : 'Feedback marked ' + body.result + '.');
    load(false);
  } catch (err) { if (err.message !== 'Signed out') say(err.message, 'red'); if (button) button.disabled = false; }
}

// ---- tutorial videos (decisions.md 180): Connect goes to Google and back; Publish chooses what goes up ----
async function connectYouTube(button) {
  button.disabled = true;
  try { location.assign((await post({ kind: 'youtube-start' })).result); }
  catch (err) { if (err.message !== 'Signed out') say(err.message, 'red'); button.disabled = false; }
}
/** Back from Google's page: the callback put its answer after the #, which never reaches a server; hand it on with this person's token. */
async function finishYouTube() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has('youtube-code') && !h.has('youtube-error')) return;
  history.replaceState(history.state, '', location.pathname + location.search);
  if (!h.has('youtube-code')) { say('Google did not connect the channel (' + h.get('youtube-error') + ').', 'red'); return; }
  say('Connecting the channel…');
  try { say('Connected the ' + (await post({ kind: 'youtube-connect', code: h.get('youtube-code'), state: h.get('youtube-state') || '' })).result + ' channel.'); }
  catch (err) { if (err.message !== 'Signed out') say(err.message, 'red'); }
}
const chosenVideos = () => [...document.querySelectorAll('[data-yt-item]:checked')].map((b) => [b.dataset.t, b.dataset.l, b.dataset.s]);
function countChosen() {
  const n = chosenVideos().length;
  const b = document.querySelector('[data-yt-publish]');
  if (b) { b.disabled = n === 0; b.textContent = n ? 'Publish ' + num(n) : 'Publish'; }
}
document.addEventListener('change', (e) => {
  if (e.target.matches && e.target.matches('[data-yt-all]')) for (const b of document.querySelectorAll('[data-yt-item]')) b.checked = e.target.checked;
  if (e.target.matches && e.target.matches('[data-yt-all], [data-yt-item]')) countChosen();
});
document.addEventListener('click', (e) => {
  const c = e.target.closest && e.target.closest('[data-yt-connect]');
  if (c) connectYouTube(c);
  const p = e.target.closest && e.target.closest('[data-yt-publish]');
  const items = p ? chosenVideos() : [];
  if (items.length && confirm('Publish ' + items.length + (items.length === 1 ? ' video' : ' videos') + ' on YouTube? Each goes up public; YouTube takes 100 a day.')) perform({ kind: 'tutorials-publish', items }, p);
});
document.addEventListener('click', (e) => {
  const run = e.target.closest && e.target.closest('[data-run]');
  if (run && confirm('Run ' + run.dataset.run + ' now?')) perform({ kind: 'run', key: run.dataset.run }, run);
  const fb = e.target.closest && e.target.closest('[data-fb]');
  if (fb) perform({ kind: 'feedback', id: fb.dataset.fb, status: fb.dataset.status }, fb);
  const ver = e.target.closest && e.target.closest('[data-ver]');
  if (ver && confirm((ver.dataset.decision === 'grant' ? 'Grant' : 'Decline') + ' this blue check?')) perform({ kind: 'verification', id: ver.dataset.ver, decision: ver.dataset.decision }, ver);
});

// ---- feedback on the tutorial videos (decisions.md 186): a yes, a no with why, or the suggestion edited; a note for the next look ----
document.addEventListener('click', (e) => {
  const sg = e.target.closest && e.target.closest('[data-sg]');
  if (sg) {
    const id = sg.dataset.sg, d = sg.dataset.decision;
    if (d === 'accept' && confirm('Accept this suggestion?' + (sg.dataset.kind === 'code' ? ' It goes to Linear.' : sg.dataset.kind === 'new' ? '' : ' Claude writes it as a draft pull request for you to merge.'))) perform({ kind: 'tutorial-suggestion', id, decision: 'accept', detail: null, reason: null }, sg);
    if (d === 'reject') {
      const reason = prompt('Why not? Claude reads this before suggesting it again. (You may leave it empty.)', '');
      if (reason !== null) perform({ kind: 'tutorial-suggestion', id, decision: 'reject', detail: null, reason: reason.slice(0, 500) }, sg);
    }
    if (d === 'edit') {
      const detail = (document.getElementById('sg-' + id) || {}).value || '';
      if (detail.trim()) perform({ kind: 'tutorial-suggestion', id, decision: 'edit', detail, reason: null }, sg);
      else say('Write what to change before saving.', 'red');
    }
  }
  const note = e.target.closest && e.target.closest('[data-note]');
  if (note) {
    const text = ($('note-text') || {}).value || '';
    if (text.trim()) perform({ kind: 'tutorial-note', tutorial: ($('note-video') || {}).value || null, text }, note);
    else say('Write the note first.', 'red');
  }
});

// ---- the tutorial video lists (sources/videos.ts): a language and a span chosen here, and Accept, Edit and Reject on a suggestion ----
let VIDEOS = null;
// The timeline shows 60 days; its zoom is how wide a day is. A pinch on a touchpad (or Ctrl and the scroll wheel) zooms it; it opens at the last 14 days.
let videoLanguage = 'en', dayWidth = 0, shownMarks = [], onlyMine = false, openCards = null;
/** The mark at the right of a video's row: ! when something waits on an admin, i when Claude acts next and an admin may still say what to do. */
function warnMark(cards, r) {
  if (!cards.length) return '<span></span>';
  const mine = cards.filter((a) => a.who === 'you').length;
  const t = mine ? mine + (mine === 1 ? ' thing waits' : ' things wait') + ' on you' : 'Claude acts next; you may tell Claude what to do';
  return '<button type="button" class="warnmk ' + (mine ? 'you' : 'claude') + '" data-cards="' + r + '" title="' + esc(t) + '" aria-label="' + esc(t) + '">' + (mine ? '!' + (mine > 1 ? ' ' + mine : '') : 'i') + '</button>';
}
const TIMELINE_DAYS = 60;
const ADMIN_LEVEL = { fails: 'bad', held: 'bad', fixFailed: 'bad', merge: 'warn', approve: 'warn', reply: 'warn', connect: 'warn', publish: 'warn', paused: '' };
const cardLink = (x) => x.link ? '<a href="' + esc(x.link) + '"' + (x.link.startsWith('#') ? '' : ' target="_blank" rel="noopener noreferrer"') + '>' + esc(ADMIN_LINKS[x.kind] || WORKER_LINKS[x.kind] || 'Open') + '</a>' : '';
const FIX_STATE = { working: 'Claude writes the fix now.', open: 'Claude\'s fix waits for your merge.', merged: 'The fix is merged. The next night films the video again.', closed: 'The fix PR was closed without a merge.', failed: 'Claude could not write the fix.' };
/** One thing for an admin: the problem, who acts next, what happens next, and where it applies, the box to tell Claude what to do. */
function adminCard(a) {
  const ins = a.instructed;
  return '<div class="vi ' + (a.who === 'you' ? ADMIN_LEVEL[a.kind] || 'warn' : 'info') + '">' +
    '<p><span class="tag ' + (a.who === 'you' ? 'warn' : 'info') + '">' + (a.who === 'you' ? 'Waits on you' : 'Claude acts next') + '</span>' + (a.at ? '<small>' + when(a.at) + '</small>' : '') + '</p>' +
    '<p><b>' + esc(a.title) + '</b></p>' + (a.detail ? '<p class="setup">' + esc(a.detail) + '</p>' : '') +
    (ins ? '' : '<p class="setup"><small><b>Next:</b> ' + esc(a.next) + '</small></p>') + (a.link ? '<p>' + cardLink(a) + '</p>' : '') +
    (a.suggestion ? suggestionButtons(a.suggestion) : '') +
    (ins ? '<p class="setup"><small><b>Your instruction</b> (' + when(ins.at) + '):</small><br>' + esc(ins.text) + '</p>' +
      '<p class="setup"><small><b>Next:</b> ' + esc(ins.fix ? FIX_STATE[ins.fix.state] || ins.fix.state : ins.looked ? 'Claude starts the fix at its next fix run (:20 and :50 each hour), as a pull request for your merge.' : 'Claude reads it at its next run.') + '</small></p>' : '') +
    (a.instruct ? '<details' + (a.who === 'you' && !ins ? ' open' : '') + '><summary>' + (ins ? 'Send another instruction' : 'Tell Claude what to do') + '</summary>' +
      '<label for="ins-' + esc(cardId(a)) + '">What Claude must do</label><textarea id="ins-' + esc(cardId(a)) + '" maxlength="2000" rows="3" placeholder="For example: the button is now called On this device. Change step 4 to tap it."></textarea>' +
      '<p><button type="button" class="primary" data-instruct="' + esc(cardId(a)) + '">Send to Claude</button></p></details>' : '') + '</div>';
}
const cardId = (a) => (a.kind + '-' + (a.tutorial || '') + '-' + (a.language || '')).replace(/[^a-zA-Z0-9-]/g, '');
// "Tell Claude what to do": an instruction on the video for Claude's next fix run, with the problem it answers and the inputs the card shows.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-instruct]');
  if (!b || !VIDEOS) return;
  const a = VIDEOS.admin.find((x) => cardId(x) === b.dataset.instruct);
  const text = (($('ins-' + b.dataset.instruct) || {}).value || '').trim();
  if (!a) return;
  if (!text) { say('Write what Claude must do first.', 'red'); return; }
  perform({ kind: 'tutorial-note', tutorial: a.tutorial, text: text.slice(0, 2000), instruct: true, problem: a.instruct.slice(0, 200),
    language: a.language || 'en', inputs: (a.inputIds || []).slice(0, 20) }, b);
});
const WORKER_LINKS = { filming: 'Open the filming run', fixing: 'Open the run' };
const ADMIN_LINKS = { fails: 'Open the filming log', held: 'Open the filming log', fixFailed: 'Open the run', merge: 'Open the PR', reply: 'Reply on YouTube', comment: 'Open the comment', screen: 'See what changed', publish: 'Go to Publish', connect: 'Go to the channels', paused: 'Open tutorials.yml' };
const MARKS = { film: 'New film', up: 'On YouTube', comment: 'Comment', suggested: 'Suggestion', decided: 'Accepted or rejected', fix: 'Fix PR', held: 'Held', failed: 'Film failed' };
const CAUSES = { app: 'app change', script: 'script change', tool: 'film tool change', new: 'first film', asked: 'asked by hand', unknown: 'cause not recorded' };
function suggestionButtons(s) {
  return (s.inputs.length ? '<ul>' + s.inputs.map((i) => '<li><small>' + esc(i.kind === 'comment' ? 'Comment' : i.kind === 'code' ? 'Code change' : 'Note') + ' · ' + when(i.at) + '</small><br>' + esc(i.english || i.text) + '</li>').join('') + '</ul>' : '') +
    '<p><button type="button" data-sg="' + esc(s.id) + '" data-decision="accept" data-kind="' + esc(s.kind) + '">Accept</button> ' +
    '<button type="button" data-sg="' + esc(s.id) + '" data-decision="reject">Reject</button></p>' +
    '<details><summary>Edit</summary><label for="sg-' + esc(s.id) + '">What to change</label><textarea id="sg-' + esc(s.id) + '" maxlength="4000" rows="6">' + esc(s.detail) + '</textarea>' +
    '<p><button type="button" data-sg="' + esc(s.id) + '" data-decision="edit">Save</button></p></details>';
}
const timelineStart = () => { const end = new Date(); end.setUTCHours(0, 0, 0, 0); return end.getTime() - (TIMELINE_DAYS - 1) * 86400000; };
function videoRows() {
  const d = VIDEOS;
  if (!d) return '';
  const first = timelineStart();
  shownMarks = [];
  const langs = d.languages.map((l) => '<option value="' + esc(l.language) + '"' + (l.language === videoLanguage ? ' selected' : '') + '>' + esc(languageName(l.language)) +
    (l.issues ? ' (' + num(l.issues) + ')' : '') + (l.nightly ? '' : ' (paused)') + '</option>').join('');
  let h = '<div class="vtools"><div><label for="video-lang">Language <small class="muted">(videos that wait on you)</small></label><select id="video-lang">' + langs + '</select></div>' +
    '<div><button type="button" data-vzoom="out" aria-label="Zoom out">−</button> <button type="button" data-vzoom="in" aria-label="Zoom in">+</button> ' +
    '<button type="button" data-vfit="14">Last 14 days</button> <button type="button" data-vfit="60">Last 60 days</button></div>' +
    '<div><label class="check"><input type="checkbox" id="video-mine"' + (onlyMine ? ' checked' : '') + '> Only videos that wait on you</label></div></div>';
  h += '<div class="vkey">' + ['app', 'script', 'tool', 'new'].map((c) => '<span><i class="mk film ' + c + '"></i>New film: ' + esc(CAUSES[c]) + '</span>').join('') +
    ['up', 'comment', 'suggested', 'fix', 'held'].map((k) => '<span><i class="mk ' + k + '"></i>' + esc(MARKS[k]) + '</span>').join('') + '<span>Click a mark for details. Pinch, or Ctrl and the scroll wheel, to zoom.</span></div>';
  const cardsOf = (v) => d.admin.filter((a) => a.tutorial === v.tutorial && a.language === v.language);
  const rows = d.videos.filter((v) => v.language === videoLanguage && (!onlyMine || cardsOf(v).some((a) => a.who === 'you')));
  if (!rows.length) return h + '<p class="muted">No videos in this language yet.</p>';
  const days = Array.from({ length: TIMELINE_DAYS }, (_, i) => new Date(first + i * 86400000));
  h += '<div class="vrow"><span></span><div class="tlw"><div class="tl days">' + days.map((x) => '<span data-day>' + esc(x.toLocaleDateString([], { month: 'short', day: 'numeric' })) + '</span>').join('') + '</div></div><span></span></div>';
  rows.forEach((v, r) => {
    const cells = days.map(() => []);
    for (const m of v.marks) { const i = Math.floor((Date.parse(m.at) - first) / 86400000); if (i >= 0 && i < TIMELINE_DAYS) cells[i].push(m); }
    const mark = (m) => {
      const t = MARKS[m.kind] + (m.kind === 'film' ? ' (' + (CAUSES[m.cause] || m.cause) + ')' : '') + ', ' + new Date(m.at).toLocaleString() + ': ' + m.text;
      shownMarks.push({ m, row: r });
      const at = new Date(m.at);
      return '<button type="button" class="mk ' + m.kind + (m.cause ? ' ' + m.cause : '') + '" data-mark="' + (shownMarks.length - 1) + '" data-h="' + ((at.getUTCHours() * 60 + at.getUTCMinutes()) / 1440).toFixed(4) + '" title="' + esc(t) + '" aria-label="' + esc(t) + '"></button>';
    };
    const chip = (s) => s.link ? '<a class="tag ' + s.level + '" href="' + esc(s.link) + '" target="_blank" rel="noopener noreferrer">' + esc(s.text) + '</a>' : '<span class="tag ' + s.level + '">' + esc(s.text) + '</span>';
    h += '<div class="vrow"><div><b>' + esc(v.title) + '</b><br>' + v.states.map(chip).join('') +
      (v.film ? '<br><small class="muted">Film ' + when(v.film.madeAt) + (v.film.why ? ': ' + esc(v.film.why) : '') + '</small>' : '') + '</div>' +
      '<div class="tlw"><div class="tl">' + cells.map((c, i) => '<span' + (days[i].getUTCDay() === 0 ? ' class="wk"' : '') + '>' + c.map(mark).join('') + '</span>').join('') + '</div></div>' + warnMark(cardsOf(v), r) + '</div>' +
      '<div class="vdet" id="vdet-' + r + '" hidden></div>' +
      (cardsOf(v).length ? '<div class="vcards" id="vcards-' + r + '"' + (openCards === v.tutorial + '/' + v.language ? '' : ' hidden') + ' data-key="' + esc(v.tutorial + '/' + v.language) + '">' + cardsOf(v).map(adminCard).join('') + '</div>' : '');
  });
  return h;
}
/** Each timeline's width from the zoom; when a day is wide enough, each mark sits at its time of day. */
function layoutTimelines(keepAt) {
  const box = $('video-rows');
  if (!box) return;
  const wraps = [...box.querySelectorAll('.tlw')];
  if (!wraps.length) return;
  const view = wraps[0].clientWidth || 600;
  if (!dayWidth) dayWidth = view / 14;
  dayWidth = Math.max(view / TIMELINE_DAYS, Math.min(2400, dayWidth));
  for (const tl of box.querySelectorAll('.tl')) tl.style.width = Math.round(dayWidth * TIMELINE_DAYS) + 'px';
  const timed = dayWidth >= 160;
  box.classList.toggle('timed', timed);
  for (const b of box.querySelectorAll('.mk[data-h]')) b.style.left = timed ? 'calc(' + (Number(b.dataset.h) * 100) + '% - 5px)' : '';
  const left = keepAt === undefined ? dayWidth * TIMELINE_DAYS - view : keepAt;
  for (const w of wraps) w.scrollLeft = left;
}
function redrawVideos() { const box = $('video-rows'); if (box) { box.innerHTML = videoRows(); annotate(box); layoutTimelines(); } }
/** Zoom by factor about the point x pixels into the timeline's view. */
function zoomTimelines(factor, x) {
  const w = document.querySelector('#video-rows .tlw');
  if (!w) return;
  const at = (w.scrollLeft + x) / dayWidth;
  dayWidth *= factor;
  layoutTimelines(0);
  const view = w.clientWidth;
  dayWidth = Math.max(view / TIMELINE_DAYS, Math.min(2400, dayWidth));
  layoutTimelines(Math.max(0, at * dayWidth - x));
}
let syncing = false;
document.addEventListener('scroll', (e) => {
  if (syncing || !e.target.classList || !e.target.classList.contains('tlw')) return;
  syncing = true;
  for (const w of document.querySelectorAll('#video-rows .tlw')) if (w !== e.target) w.scrollLeft = e.target.scrollLeft;
  syncing = false;
}, true);
document.addEventListener('wheel', (e) => {
  const w = e.target.closest && e.target.closest('#video-rows .tlw');
  if (!w || !e.ctrlKey) return;
  e.preventDefault();
  zoomTimelines(Math.exp(-e.deltaY / 200), e.clientX - w.getBoundingClientRect().left);
}, { passive: false });
// Safari's own pinch.
let gestureWidth = 0;
document.addEventListener('gesturestart', (e) => { if (e.target.closest && e.target.closest('#video-rows .tlw')) { e.preventDefault(); gestureWidth = dayWidth; } });
document.addEventListener('gesturechange', (e) => {
  const w = e.target.closest && e.target.closest('#video-rows .tlw');
  if (!w || !gestureWidth) return;
  e.preventDefault();
  zoomTimelines(gestureWidth * e.scale / dayWidth, e.clientX - w.getBoundingClientRect().left);
});
document.addEventListener('gestureend', () => { gestureWidth = 0; });
function markDetail(m) {
  const d = m.detail || { title: m.text, lines: [], links: [], films: [] };
  return '<div class="head"><b>' + esc(d.title) + '</b> <small class="muted">' + esc(new Date(m.at).toLocaleString()) + '</small><button type="button" data-vclose>Close</button></div>' +
    d.lines.map((l) => '<p class="setup">' + esc(l) + '</p>').join('') +
    (d.quote ? '<blockquote>' + esc(d.quote) + '</blockquote>' : '') +
    (d.links.length ? '<p>' + d.links.map((l) => '<a href="' + esc(l.href) + '" target="_blank" rel="noopener noreferrer">' + esc(l.text) + '</a>').join(' · ') + '</p>' : '') +
    (d.films.length ? '<div class="vfilms">' + d.films.map((f) => '<figure><figcaption>' + esc(f.label) + '</figcaption><video controls preload="metadata" src="' + esc(f.href) + '"></video></figure>').join('') + '</div>' : '');
}
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'video-lang') { videoLanguage = e.target.value; redrawVideos(); }
  if (e.target && e.target.id === 'video-mine') { onlyMine = e.target.checked; redrawVideos(); }
});
document.addEventListener('click', (e) => {
  const t = e.target.closest ? e.target : null;
  if (!t) return;
  const fit = t.closest('[data-vfit]');
  if (fit) { const w = document.querySelector('#video-rows .tlw'); dayWidth = (w ? w.clientWidth : 600) / Number(fit.dataset.vfit); layoutTimelines(); }
  const z = t.closest('[data-vzoom]');
  if (z) { const w = document.querySelector('#video-rows .tlw'); zoomTimelines(z.dataset.vzoom === 'in' ? 1.6 : 1 / 1.6, w ? w.clientWidth / 2 : 0); }
  const mk = t.closest('[data-mark]');
  if (mk) {
    const { m, row } = shownMarks[Number(mk.dataset.mark)] || {};
    const box = $('vdet-' + row);
    if (m && box) { for (const o of document.querySelectorAll('.vdet')) if (o !== box) o.hidden = true; box.innerHTML = markDetail(m); box.hidden = false; }
  }
  const wm = t.closest('[data-cards]');
  if (wm) { const box = $('vcards-' + wm.dataset.cards); if (box) { box.hidden = !box.hidden; openCards = box.hidden ? null : box.dataset.key; } }
  const close = t.closest('[data-vclose]');
  if (close) close.closest('.vdet').hidden = true;
});
window.addEventListener('resize', () => layoutTimelines());

// ---- one install's diagnostics, readable --------------------------------------------------
const pairs = (o) => Object.entries(o || {}).map(([k, v]) => '<span class="nowrap">' + esc(k === 'ms' ? 'took' : k) + ' <b>' + esc(typeof v === 'number' && /ms$/i.test(k) ? ms(v) : v) + '</b></span>').join(' · ');
function installView(result) {
  const c = result.context || {};
  const rows = result.timeline || [];
  const errors = rows.filter((x) => x.kind === 'error').length;
  const failedSyncs = rows.filter((x) => x.kind === 'sync' && x.t && x.t.outcome === 'error').length;
  const bad = (x) => x.kind === 'error' || (x.t && (x.t.outcome === 'error' || x.t.fatal === 'yes'));
  return '<p class="muted">' + esc([c.os, c.osVersion, c.model, c.appVersion && 'app ' + c.appVersion, c.channel, c.runtimeVersion && 'runtime ' + c.runtimeVersion].filter(Boolean).join(' · ')) + '</p>' +
    '<div class="stats">' + stat(num(rows.length), 'records, last 3 days') + stat(num(errors), 'errors', errors ? 'bad' : '', 'last 3 days') + stat(num(failedSyncs), 'syncs that failed', failedSyncs ? 'warn' : '', 'last 3 days') +
    stat(rows[0] ? ago(rows[0].at) : '–', 'last heard from') + '</div>' +
    '<h3>Last 3 days, newest first</h3>' + table([
      { h: 'When', v: (x) => '<span class="nowrap">' + esc(new Date(x.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })) + '</span>' },
      { h: 'Record', v: (x) => '<span class="tag' + (bad(x) ? ' bad' : '') + '">' + esc(x.kind) + '</span>' + (x.stream_id ? '<br><small>' + short(x.stream_id) + '</small>' : '') },
      { h: 'What happened', v: (x) => pairs(x.t) || '–' },
      { h: 'Measured', v: (x) => '<small>' + (pairs(x.n) || '–') + '</small>' }
    ], rows);
}

/** Under a feedback item: the diagnostics its phone sent in the last 3 days, opened and closed in place. */
async function toggleDiag(button) {
  const box = $('diag-' + button.dataset.fbId);
  if (!box.hidden) { box.hidden = true; button.textContent = "Show this phone's diagnostics"; return; }
  box.hidden = false; button.textContent = "Hide this phone's diagnostics";
  box.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const r = await api('/ops/api/lookup?q=' + encodeURIComponent(button.dataset.install));
    box.innerHTML = r.kind === 'install' ? installView(r.result)
      : '<p class="muted">This phone sent no diagnostics in the last 3 days: it may be offline, or have Send diagnostics turned off in Settings.</p>';
    annotate(box);
  } catch (err) { box.innerHTML = '<p class="bad">' + esc(err.message) + '</p>'; }
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-install]');
  if (b) toggleDiag(b);
});

function renderPerson(r) {
  if (!r) return '<p class="muted">No account has that email.</p>';
  return '<p>Profile <code>' + esc(r.profileId) + '</code></p>' + table([
    { h: 'Install', v: (i) => installLink(i.install) }, { h: 'Heard from', v: (i) => when(i.lastSeen) }, { h: 'Runs', v: (i) => '<small>' + esc([i.os, i.channel, i.runtime].filter(Boolean).join(' · ')) + '</small>' }
  ], r.installs || []);
}

// ---- one organization, at /ops-dashboard/org/<id> --------------------------------------------
async function openOrg(id, push) {
  if (push) history.pushState({ org: id }, '', '/ops-dashboard/org/' + encodeURIComponent(id));
  const box = $('org'); box.hidden = false;
  box.innerHTML = '<div class="head"><h2>Organization</h2><button type="button" id="org-close">Close</button></div><p class="muted">Loading…</p>';
  $('org-close').onclick = closeOrg;
  box.scrollIntoView({ block: 'start' });
  try {
    const s = await api('/ops/api/org/' + encodeURIComponent(id));
    let h = '<div class="head"><div><h2>' + esc((s.data && s.data.name) || id) + '</h2><div class="src"><code>' + esc(id) + '</code></div></div><button type="button" id="org-close">Close</button></div>';
    if (s.state !== 'ok') h += '<p class="' + (s.state === 'error' ? 'bad' : 'muted') + '">' + esc(s.error || s.setup) + '</p>';
    else {
      const o = s.data;
      h += '<div class="stats">' + stat(num(o.pendingRequests), 'join requests waiting', '', NOW) + stat(num(o.openReports), 'open reports', o.openReports ? 'warn' : '', NOW) + stat(num(o.syncErrors.length), 'installs with sync errors', '', LAST_WEEK) + '</div>' +
        '<h3>Members by role</h3>' + table([{ h: 'Role', v: (m) => esc(m.role) }, { h: 'Members', n: true, v: (m) => num(m.n) }], o.membersByRole) +
        '<h3>Languages</h3>' + table([{ h: 'Language', v: (l) => esc(l.name || l.languageId) }, { h: 'Events', n: true, v: (l) => num(l.events) }, { h: 'Projected', n: true, v: (l) => num(l.projectedSeq) + ' · ' + when(l.projectedAt) }, { h: 'Snapshot', n: true, v: (l) => num(l.snapshotSeq) + ' · ' + when(l.snapshotAt) }], o.languages) +
        '<h3>Installs whose syncs failed this week</h3>' + table([{ h: 'Install', v: (i) => installLink(i.install) }, { h: 'Failures', n: true, v: (i) => num(i.n) }, { h: 'Last', v: (i) => '<code>' + esc(i.lastCode) + '</code> ' + when(i.lastAt) }], o.syncErrors) +
        '<h3>Inbox</h3><pre>' + esc(JSON.stringify(o.inbox, null, 2)) + '</pre>' +
        '<p class="muted">Open it in the app as a Global Viewer to see its work.</p>';
    }
    box.innerHTML = h;
    annotate(box);
    $('org-close').onclick = closeOrg;
  } catch (err) { box.innerHTML = '<p class="bad">' + esc(err.message) + '</p>'; }
}
function closeOrg() {
  $('org').hidden = true;
  if (location.pathname !== '/ops-dashboard') history.pushState({}, '', '/ops-dashboard');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-org]');
  if (b) { e.preventDefault(); openOrg(b.dataset.org, true); }
});
window.addEventListener('popstate', () => {
  const m = /^\/ops-dashboard\/org\/([^/]+)$/.exec(location.pathname);
  if (m) openOrg(decodeURIComponent(m[1]), false); else $('org').hidden = true;
});
`;
