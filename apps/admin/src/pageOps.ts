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
  { id: 'safety', title: 'Sync and data safety', src: 'Refused work, upload delay, clock skew, the fold canary, projection lag and snapshots', wide: true, parts: ['safety'] },
  { id: 'phones', title: 'Phones and browsers', src: 'What installs report, the builds they run and how often each crashes, and phones that are stuck or quiet', wide: true, parts: ['clients', 'fleet'] },
  { id: 'releases', title: 'Releases', src: 'main and its CI, what each host serves, migrations, what shipped against errors, EAS builds and updates', wide: true, parts: ['code', 'releases', 'expo', 'adoption'] },
  { id: 'jobs', title: 'Server jobs', src: 'Each job\'s runs and whether it runs now, pg_cron, push delivery, and the v2 import', wide: true, parts: ['jobs', 'container', 'cron', 'push', 'v2'] },
  { id: 'database', title: 'Database', src: 'Connections, cache, slow calls, largest tables, long transactions, and the Supabase project', parts: ['database', 'dbdetail', 'supabase'] },
  { id: 'traffic', title: 'Workers and traffic', src: 'Each Cloudflare Worker\'s requests, errors and latest build, and the app Worker\'s routes', parts: ['cloudflare', 'worker'] },
  { id: 'storage', title: 'Storage and capacity', src: 'Backups, R2, files lost on phones, the nightly R2 check, growth against the plan and this month\'s usage', parts: ['storage', 'capacity'] },
  { id: 'people', title: 'People and organizations', src: 'Counted, never named: accounts, activity, organizations, joining', wide: true, parts: ['people'] },
  { id: 'support', title: 'Support', src: 'Content reports, suspensions, deletions, feedback, and what was done from this page', wide: true, parts: ['support', 'feedback'] },
  { id: 'access', title: 'Access and integrations', src: 'Global Viewers, limits hit, tokens, device grants, webhooks, review links, and what expires', parts: ['security', 'integrations', 'expiry'] },
  { id: 'stores', title: 'App stores', src: 'Google Play vitals and reviews, App Store review state, builds and reviews', parts: ['googleplay', 'appstore'] }
] as const;

/** Sub-headings where a source's own title would repeat its section's, or say too little inside it. */
export const PART_TITLES: Record<string, string> = {
  clients: 'What installs report', fleet: 'Builds in the field and stuck phones', code: 'Code and deploys', releases: 'What shipped',
  expo: 'EAS builds and updates', adoption: 'Update adoption', jobs: 'Jobs', cron: 'pg_cron', push: 'Push delivery and Inbox', v2: 'v2 import',
  database: 'Health', dbdetail: 'Where the space goes', supabase: 'Supabase project', cloudflare: 'Cloudflare Workers', worker: 'App Worker routes, last 24 h',
  storage: 'Storage and backups', capacity: 'Capacity and cost', support: 'Queue', feedback: 'Feedback', security: 'Global Viewers and limits',
  integrations: 'Integrations', expiry: 'Expiry dates', googleplay: 'Google Play', appstore: 'App Store'
};

/** Read as diag_reader in one call (/ops/api/ops). */
export const OPS_IDS = ['fleet', 'safety', 'people', 'cron', 'dbdetail', 'push', 'worker', 'integrations', 'support', 'security'] as const;

/** Each from its own call (/ops/api/<id>), like the providers. */
export const OWN_CALL_IDS = ['expiry', 'storage', 'capacity', 'releases', 'container', 'adoption'] as const;

export const OPS_SECTIONS = [
  { id: 'safety', title: 'Sync and data safety', src: 'Refused work, upload delay, clock skew, the fold canary, projection lag and snapshots', wide: true },
  { id: 'fleet', title: 'Builds and stuck phones', src: 'Updates in the field and their crash-free rate, versions, time to a usable Map, stuck and silent phones', wide: true },
  { id: 'releases', title: 'Release health', src: 'Merges, deploys and EAS updates over 14 days against errors; hosts; migrations against main' },
  { id: 'adoption', title: 'Update adoption', src: 'For each channel, platform and runtime: the newest EAS update and how many active installs run it' },
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
  { id: 'capacity', title: 'Capacity and cost', src: 'Database and R2 growth against the plan, Cloudflare usage this month' }
] as const;

export const OPS_SCRIPT = String.raw`
const orgLink = (id, name) => '<button class="link" data-org="' + esc(id) + '">' + esc(name || String(id).slice(0, 8)) + '</button>';
const installLink = (id) => id ? '<button class="link" data-q="' + esc(id) + '"><code>' + esc(String(id).slice(0, 8)) + '</code></button>' : '–';
const share = (a, b) => b ? ((a / b) * 100).toFixed(1) + '%' : '–';
const hours = (msv) => msv === null || msv === undefined ? '–' : ms(Number(msv));
const ageOf = (iso) => iso ? ago(iso) : '–';

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
    h += '<h3>Largest languages</h3>' + table([
      { h: 'Language', v: (l) => esc(l.name || l.languageId) + ' <small>' + orgLink(l.orgId, 'org') + '</small>' }, { h: 'Events', n: true, v: (l) => num(l.events) }, { h: 'Snapshot', n: true, v: (l) => bytes(l.snapshotBytes) }
    ], p.largest);
    return h;
  },
  fleet(d) {
    let h = '<h3>Updates in the field, 14 days</h3>' + table([
      { h: 'Update', v: (u) => '<code>' + esc(u.update) + '</code>' }, { h: 'Channel', v: (u) => esc(u.channel || '–') }, { h: 'Runtime', v: (u) => '<small>' + esc(u.runtime || '–') + '</small>' },
      { h: 'Installs', n: true, v: (u) => num(u.installs) }, { h: 'Crashed', n: true, v: (u) => '<span class="' + (u.crashed ? 'warn' : '') + '">' + num(u.crashed) + '</span>' },
      { h: 'Crash-free', n: true, v: (u) => share(u.installs - u.crashed, u.installs) }, { h: 'First seen', v: (u) => when(u.firstSeen) }
    ], d.updates);
    h += '<h3>Reducer and protocol, installs this week</h3>' + table([{ h: 'Reducer', v: (v) => esc(v.reducer || '?') }, { h: 'Protocol', v: (v) => esc(v.protocol || '?') }, { h: 'Installs', n: true, v: (v) => num(v.installs) }], d.versions);
    h += '<h3>Browsers by web commit, this week</h3>' + table([{ h: 'Commit', v: (w) => '<code>' + esc(String(w.commit || '?').slice(0, 8)) + '</code>' }, { h: 'Installs', n: true, v: (w) => num(w.installs) }], d.web);
    h += '<h3>Time to a usable Map</h3><p class="muted">open: a language\'s first full download; fill: a big language, until its Map shows.</p>' + table([
      { h: 'Day', v: (r) => esc(r.day) }, { h: 'Kind', v: (r) => esc(r.kind) }, { h: 'Count', n: true, v: (r) => num(r.count) }, { h: 'p50', n: true, v: (r) => hours(r.p50Ms) }, { h: 'p95', n: true, v: (r) => hours(r.p95Ms) }
    ], d.toMap.slice().reverse().slice(0, 14));
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
    return '<div class="stats">' +
      stat(d.longestQueryS === null ? '–' : ms(d.longestQueryS * 1000), 'longest query', '', 'running now') + stat(d.oldestXactS === null ? '–' : ms(d.oldestXactS * 1000), 'oldest transaction', '', 'open now') + '</div>' +
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
    let h = '<div class="stats">' + stat(d.now ? bytes(d.now.dbBytes) : '–', 'database of ' + bytes(d.limitBytes), d.now && d.now.dbBytes >= d.limitBytes * 0.9 ? 'warn' : '', NOW) +
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
  }
});

// ---- the few actions (decisions.md 162): the app Worker checks the person again and records each ----
async function perform(action, button) {
  const t = await token();
  if (!t) { showSignIn(); return; }
  if (button) button.disabled = true;
  try {
    const res = await fetch('/ops/api/actions', { method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: JSON.stringify(action) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
    say(action.kind === 'run' ? (body.result === 'started' ? 'Started ' + action.key + '.' : action.key + ' was ' + body.result + '; nothing started.') : 'Feedback marked ' + body.result + '.');
    load(false);
  } catch (err) { say(err.message, 'red'); if (button) button.disabled = false; }
}
document.addEventListener('click', (e) => {
  const run = e.target.closest && e.target.closest('[data-run]');
  if (run && confirm('Run ' + run.dataset.run + ' now?')) perform({ kind: 'run', key: run.dataset.run }, run);
  const fb = e.target.closest && e.target.closest('[data-fb]');
  if (fb) perform({ kind: 'feedback', id: fb.dataset.fb, status: fb.dataset.status }, fb);
});

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
