/**
 * The page's script for the sections the ops dashboard plan added
 * (docs/ops-dashboard-plan.md section 5), kept apart from page.ts so that
 * file stays readable. Plain JavaScript run inside page.ts's script, after
 * its helpers (esc, num, ms, bytes, when, table, short, stat, api) and its
 * RENDER table, which this extends. Everything shown is escaped.
 */

/** Where each section sits on the page, by id, in page order; page.ts's SECTIONS gives each one's title. */
export const SECTION_ORDER = [
  'safety', 'clients', 'fleet', 'releases', 'jobs', 'container', 'cron', 'database', 'dbdetail', 'push', 'worker',
  'integrations', 'storage', 'people', 'support', 'feedback', 'security', 'expiry', 'capacity',
  'code', 'cloudflare', 'supabase', 'vercel', 'expo', 'googleplay', 'appstore', 'v2', 'lookup'
] as const;

/** Read as diag_reader in one call (/ops/api/ops). */
export const OPS_IDS = ['fleet', 'safety', 'people', 'cron', 'dbdetail', 'push', 'worker', 'integrations', 'support', 'security'] as const;

/** Each from its own call (/ops/api/<id>), like the providers. */
export const OWN_CALL_IDS = ['expiry', 'storage', 'capacity', 'releases', 'container'] as const;

export const OPS_SECTIONS = [
  { id: 'safety', title: 'Sync and data safety', src: 'Refused work, upload delay, clock skew, the fold canary, projection lag and snapshots', wide: true },
  { id: 'fleet', title: 'Builds and stuck phones', src: 'Updates in the field and their crash-free rate, versions, time to a usable Map, stuck and silent phones', wide: true },
  { id: 'releases', title: 'Release health', src: 'Merges, deploys and EAS updates over 14 days against errors; hosts; migrations against main' },
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
      stat(num(today.invalid || 0), 'refused as invalid', today.invalid ? 'bad' : '') +
      stat(hours(arr.p95Ms), 'p95 upload delay') + stat(num(arr.futureStamped || 0), 'stamped ahead of the clock', arr.futureStamped ? 'warn' : '') +
      (p ? stat(num(p.lagging), 'languages behind the pass', p.lagging ? 'warn' : '') + stat(num(p.snapshots.overdue), 'snapshots overdue', p.snapshots.overdue ? 'warn' : '') : '') + '</div>';
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
    h += '<h3>Silent phones</h3><p>' + num(d.silent.count) + ' quiet for 3 days while another phone of the same person reports.</p>' +
      (d.silent.installs.length ? '<p>' + d.silent.installs.map((s) => installLink(s.install) + ' <small>' + ageOf(s.lastSeen) + '</small>').join(' · ') + '</p>' : '');
    return h;
  },
  releases(d) {
    const m = d.migrations;
    let h = '<div class="stats">' + d.hosts.map((x) => stat('<code>' + esc(x.build ? String(x.build).slice(0, 8) : '?') + '</code>', x.url.replace('https://', ''), x.error ? 'bad' : '')).join('') +
      stat(m.behind === null ? '?' : num(m.behind), 'migrations behind main', m.behind ? 'bad' : '') + '</div>';
    if (m.error) h += '<p class="muted">' + esc(m.error) + '</p>';
    h += '<h3>Errors phones reported</h3>' + table([{ h: 'Day', v: (r) => esc(r.day) }, { h: 'Errors', n: true, v: (r) => num(r.errors) }, { h: 'Crashes', n: true, v: (r) => '<span class="' + (r.crashes ? 'warn' : '') + '">' + num(r.crashes) + '</span>' }, { h: 'Installs', n: true, v: (r) => num(r.installs) }], d.errorsByDay.slice().reverse());
    h += '<h3>What shipped, 14 days</h3>' + table([{ h: 'When', v: (e) => when(e.at) }, { h: 'What', v: (e) => '<span class="tag">' + esc(e.kind) + '</span> ' + esc(e.text) }], d.timeline.slice(0, 40));
    for (const n of d.notes || []) h += '<p class="muted">' + esc(n) + '</p>';
    return h;
  },
  container(d) {
    return table([
      { h: 'Job', v: (j) => '<b>' + esc(j.job) + '</b>' }, { h: 'Now', v: (j) => j.error ? '<span class="warn">' + esc(j.error) + '</span>' : j.running ? '<span class="good">running</span>' : 'idle' },
      { h: 'Since', v: (j) => j.startedAt ? when(j.startedAt) : '–' }, { h: 'Limit', n: true, v: (j) => ms(j.timeLimitMs) }, { h: 'Whole read', v: (j) => j.all ? 'yes' : '' },
      { h: '', v: (j) => j.running ? '' : '<button type="button" data-run="' + esc(j.key) + '">Run now</button>' }
    ], d.jobs) + '<p class="muted">Run now starts a job its schedule would start anyway; a job already running is left alone. Each is recorded (Support queue).</p>';
  },
  cron(d) {
    return table([
      { h: 'Job', v: (j) => '<b>' + esc(j.jobname) + '</b><br><small>' + esc(j.schedule) + (j.active ? '' : ' · off') + '</small>' },
      { h: 'Last run', v: (j) => when(j.lastRunAt) + '<br><small class="' + (j.lastStatus === 'failed' ? 'bad' : '') + '">' + esc(j.lastStatus || '–') + '</small>' },
      { h: 'Runs 24 h', n: true, v: (j) => num(j.runs24h) }, { h: 'Failed', n: true, v: (j) => '<span class="' + (j.failures24h ? 'bad' : '') + '">' + num(j.failures24h) + '</span>' }
    ], d.jobs);
  },
  dbdetail(d) {
    return '<div class="stats">' + stat(bytes(d.bytes), 'database') + stat(num(d.connections), 'connections') +
      stat(d.longestQueryS === null ? '–' : ms(d.longestQueryS * 1000), 'longest query') + stat(d.oldestXactS === null ? '–' : ms(d.oldestXactS * 1000), 'oldest transaction') + '</div>' +
      '<h3>Largest tables</h3>' + table([{ h: 'Table', v: (t) => '<code>' + esc(t.name) + '</code>' }, { h: 'Size', n: true, v: (t) => bytes(t.bytes) }, { h: 'Rows', n: true, v: (t) => num(t.rows) }, { h: 'Dead', n: true, v: (t) => t.deadRatio === null ? '–' : '<span class="' + (t.deadRatio >= 0.3 ? 'warn' : '') + '">' + (t.deadRatio * 100).toFixed(0) + '%</span>' }], d.tables) +
      '<h3>Largest indexes</h3>' + table([{ h: 'Index', v: (i) => '<code>' + esc(i.name) + '</code>' }, { h: 'Table', v: (i) => '<small>' + esc(i.table) + '</small>' }, { h: 'Size', n: true, v: (i) => bytes(i.bytes) }], d.indexes);
  },
  push(d) {
    const r = d.runs || {};
    return '<div class="stats">' + stat(num(d.pending), 'waiting', d.pending ? 'warn' : '') + stat(ageOf(d.oldestPendingAt), 'oldest waiting') + stat(num(d.tokens), 'push tokens') + stat(num(d.membersWithoutToken), 'members without a token') + '</div>' +
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
    return '<div class="stats">' + stat(num(d.tokens.total), 'access tokens') + stat(num(d.deviceGrants.pending), 'device grants waiting') + stat(num(d.webhooks.active), 'webhooks on') + stat(num(d.reviewLinks.active), 'review links live') + stat(num(d.api.agentApi + d.api.mcp), 'API calls, 24 h') + '</div>' +
      '<h3>Tokens by scope</h3>' + table([{ h: 'Scope', v: (s) => '<code>' + esc(s.scope) + '</code>' }, { h: 'Tokens', n: true, v: (s) => num(s.n) }], d.tokens.byScope) +
      '<h3>Webhooks switched off</h3>' + table([{ h: 'Why', v: (w) => esc(w.reason || '–') }, { h: 'Count', n: true, v: (w) => num(w.n) }], d.webhooks.disabled) +
      '<p class="muted">Deliveries, last 24 h: ' + esc(Object.entries(d.dispatch || {}).map(([k, v]) => k + ' ' + num(v)).join(' · ') || 'none') + ' · new this week: ' + num(d.tokens.createdWeek) + ' tokens, ' + num(d.reviewLinks.createdWeek) + ' review links</p>';
  },
  storage(d) {
    const b = d.backups, r = d.r2;
    let h = '<div class="stats">' +
      (b ? stat(b.error ? '?' : b.pitr ? 'on' : 'off', 'point-in-time recovery', b.pitr ? '' : 'warn') + stat(b.error ? '?' : ageOf(b.latest), 'latest backup') : stat('–', 'backups (needs ADMIN_SUPABASE_TOKEN)')) +
      (r ? stat(r.error ? '?' : bytes(r.bytes), 'in R2') + stat(r.error ? '?' : num(r.objects), 'R2 objects') : stat('–', 'R2 (needs ADMIN_CLOUDFLARE_TOKEN)')) + '</div>';
    if (b && b.error) h += '<p class="bad">' + esc(b.error) + '</p>';
    if (r && r.error) h += '<p class="bad">' + esc(r.error) + '</p>';
    if (r && r.weekGrowthBytes !== null) h += '<p class="muted">R2 grew ' + bytes(r.weekGrowthBytes) + ' in the last week.</p>';
    h += '<p class="notice">R2 holds the only copy of recordings: there is no second copy yet.</p>';
    h += '<h3>Nightly R2 check</h3>' + (d.reconcile ? '<p>' + when(d.reconcile.at) + ' · ' + esc(d.reconcile.outcome) + ' · ' + esc(Object.entries(d.reconcile.n).map(([k, v]) => k + ' ' + num(v)).join(' · ')) + '</p>' : '<p class="muted">Not run yet.</p>');
    h += '<h3>Files lost on phones (decision 92)</h3>' + table([{ h: 'Day', v: (x) => esc(x.day) }, { h: 'Installs', n: true, v: (x) => num(x.installs) }, { h: 'Files', n: true, v: (x) => num(x.files) }], d.lostFiles.slice().reverse());
    return h;
  },
  people(d) {
    let h = '<div class="stats">' + stat(num(d.accounts.total), 'accounts') + stat(num(d.activeProfiles.day), 'active today') + stat(num(d.activeProfiles.week), 'active this week') +
      stat(num(d.orgs.total), 'organizations') + stat(num(d.languages.total), 'languages') + stat(num(d.joining.pendingRequests), 'join requests waiting', d.joining.pendingRequests ? 'warn' : '') +
      stat(num(d.accounts.suspended), 'suspended') + stat(num(d.accounts.managed), 'looked after') + '</div>';
    h += '<h3>Most recently active organizations</h3>' + table([
      { h: 'Organization', v: (o) => orgLink(o.orgId, o.name) }, { h: 'Members', n: true, v: (o) => num(o.members) }, { h: 'Languages', n: true, v: (o) => num(o.languages) },
      { h: 'Events', n: true, v: (o) => num(o.events) }, { h: 'Requests', n: true, v: (o) => num(o.pendingRequests) }, { h: 'Last projected', v: (o) => when(o.lastProjectedAt) }
    ], d.orgs.top || []);
    h += '<h3>By day</h3>' + table([
      { h: 'Day', v: (x) => esc(x.day) }, { h: 'New accounts', n: true, v: (x) => num(x.n) },
      { h: 'Invites issued', n: true, v: (x) => num((d.joining.invitesByDay.find((i) => i.day === x.day) || {}).issued || 0) },
      { h: 'Redeemed', n: true, v: (x) => num((d.joining.invitesByDay.find((i) => i.day === x.day) || {}).redeemed || 0) },
      { h: 'Events', n: true, v: (x) => num(((d.eventsByDay || []).find((e) => e.day === x.day) || {}).events || 0) }
    ], d.accounts.newByDay.slice().reverse());
    return h;
  },
  support(d) {
    return '<div class="stats">' + stat(num(d.reports.open), 'open reports', d.reports.open ? 'warn' : '') + stat(ageOf(d.reports.oldestAt), 'oldest report') +
      stat(num(d.reports.staffOnly), 'only staff can act on', d.reports.staffOnly ? 'warn' : '') + stat(num(d.reports.resolvedWeek), 'resolved this week') +
      stat(num(d.suspended.total), 'suspended') + stat(d.feedbackOpen === null ? '–' : num(d.feedbackOpen), 'feedback not done') + '</div>' +
      '<p class="muted">Act on reports with npm run moderation -- --hosted (decision 48).</p>' +
      '<h3>Accounts deleted, by week</h3>' + table([{ h: 'Week of', v: (w) => esc(w.week) }, { h: 'Deleted', n: true, v: (w) => num(w.n) }], d.deletions.slice().reverse()) +
      '<h3>Done from this page</h3>' + table([{ h: 'When', v: (a) => when(a.at) }, { h: 'Who', v: (a) => short(a.profileId) }, { h: 'What', v: (a) => esc(a.action) + ' <code>' + esc(String(a.target).slice(0, 12)) + '</code>' },
        { h: 'Result', v: (a) => '<span class="' + (a.result === 'ok' ? 'good' : a.result === 'error' ? 'bad' : 'warn') + '">' + esc(a.result) + (a.detail ? ' · ' + esc(a.detail) : '') + '</span>' }], d.actions || []);
  },
  security(d) {
    const g = d.globalViewers || {}, l = d.limits, c = d.credentials;
    return '<div class="stats">' + stat(num(g.active || 0), 'Global Viewers') + stat(num(g.signedInAal2 || 0), 'signed in with a code') + stat(num(g.revoked || 0), 'revoked') + '</div>' +
      '<h3>Limits hit</h3>' + table([{ h: 'Limit', v: (x) => esc(x[0]) }, { h: 'Count', n: true, v: (x) => num(x[1]) }], [
        ['Device-code refusals, 24 h', l.deviceRefused], ['Review-link refusals, 24 h', l.linksRefused], ['Failed v2 sign-ins, 24 h', l.v2SignInFailures24h], ['Installs at the diagnostics cap today', l.installsAtDiagCap]
      ]) + (c ? '<h3>New this week</h3><p>' + num(c.tokensWeek) + ' access tokens · ' + num(c.deviceGrantsWeek) + ' device grants asked, ' + num(c.approvedWeek) + ' approved · ' + num(c.webhooksDisabled) + ' webhooks off</p>' : '');
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
    let h = '<div class="stats">' + stat(d.now ? bytes(d.now.dbBytes) : '–', 'database of ' + bytes(d.limitBytes)) +
      stat(d.dbGrowthPerDay === null ? '–' : bytes(d.dbGrowthPerDay * 7), 'database growth a week') +
      stat(d.weeksLeft === null ? '–' : Math.round(d.weeksLeft), 'weeks left at that rate', d.weeksLeft !== null && d.weeksLeft < 12 ? 'warn' : '') +
      (d.now ? stat(bytes(d.now.eventsBytes), 'event log (' + num(d.now.eventsRows) + ' rows)') : '') +
      (d.r2 ? stat(bytes(d.r2.bytes), 'R2') + stat(d.r2.growthPerDay === null ? '–' : bytes(d.r2.growthPerDay * 7), 'R2 growth a week') : '') + '</div>';
    if (u) {
      h += u.error ? '<p class="bad">' + esc(u.error) + '</p>' : '<h3>Cloudflare this month, against the plan</h3>' + table([{ h: 'What', v: (x) => esc(x[0]) }, { h: 'Used', n: true, v: (x) => num(x[1]) }, { h: 'Included', n: true, v: (x) => num(x[2]) }, { h: 'Share', n: true, v: (x) => '<span class="' + (x[1] > x[2] ? 'warn' : '') + '">' + share(x[1], x[2]) + '</span>' }], [
        ['Workers requests', u.workersRequests, u.allowance.workersRequests], ['Durable Object requests', u.doRequests, u.allowance.doRequests],
        ['R2 class A operations', u.r2ClassA, u.allowance.r2ClassA], ['R2 class B operations', u.r2ClassB, u.allowance.r2ClassB]
      ]) + '<p class="muted">Container time is not in the analytics this page reads: see the Cloudflare dashboard.</p>';
    }
    return h;
  }
});

// ---- the few actions (decisions.md 161): the app Worker checks the person again and records each ----
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
      h += '<div class="stats">' + stat(num(o.pendingRequests), 'join requests waiting') + stat(num(o.openReports), 'open reports', o.openReports ? 'warn' : '') + stat(num(o.syncErrors.length), 'installs with sync errors') + '</div>' +
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
