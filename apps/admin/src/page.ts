/**
 * The page: one HTML document, no build step, like the app Worker's
 * /connect (apps/web/worker/agent/connectPage.ts). It signs in with
 * Supabase from the browser, keeps the session in this tab only
 * (sessionStorage), and loads each section from /api/* on its own, so a slow
 * or unconfigured source never holds up the rest. Everything it shows comes
 * from the API as data and is escaped before it reaches the page.
 */
export function page(cfg: { supabaseUrl: string; anonKey: string }, nonce: string): Response {
  const config = JSON.stringify(cfg).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>LangQuest operations</title>
<style nonce="${nonce}">
:root { --primary:#6B48C8; --bg:#F4F2FA; --card:#fff; --ink:#1E1636; --muted:#6E629E; --line:#E3DEF3; --red:#B42318; --redbg:#FDECEA; --amber:#9A5B00; --amberbg:#FFF4E0; --green:#1F7A4D; --greenbg:#E6F4EC; --grey:#8A82A8; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --primary:#A48BF0; --bg:#14101F; --card:#1E1830; --ink:#F1EEFA; --muted:#B4A9D8; --line:#332A4D; --red:#FF8A80; --redbg:#3A1C1F; --amber:#F5C26B; --amberbg:#352A14; --green:#7FD6A4; --greenbg:#15301F; --grey:#8F86AE; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { position: sticky; top: 0; z-index: 2; background: var(--bg); border-bottom: 1px solid var(--line); }
.bar { max-width: 1280px; margin: 0 auto; padding: 12px 16px; display:flex; gap:12px; align-items:center; flex-wrap: wrap; }
.bar h1 { font-size: 20px; margin: 0; flex: 1; min-width: 200px; }
.bar small { color: var(--muted); }
main { max-width: 1280px; margin: 0 auto; padding: 16px 16px 64px; }
h2 { font-size: 17px; margin: 0; } h3 { font-size: 14px; margin: 14px 0 6px; color: var(--muted); font-weight: 600; }
p { margin: 6px 0; } .muted { color: var(--muted); } small { color: var(--muted); }
section.card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; min-width: 0; }
.grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(min(520px, 100%), 1fr)); grid-auto-flow: dense; gap: 16px; align-items: start; }
.nowrap { white-space: nowrap; }
.head { display:flex; gap: 8px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.src { font-size: 12px; color: var(--muted); margin-top: 2px; }
.pill { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; white-space: nowrap; }
.pill.ok { color: var(--green); background: var(--greenbg); } .pill.problem { color: var(--red); background: var(--redbg); }
.pill.watch { color: var(--amber); background: var(--amberbg); } .pill.off, .pill.wait { color: var(--muted); background: var(--bg); }
.pill.error { color: var(--red); background: var(--redbg); }
#attention { margin-bottom: 16px; }
#attention ul { list-style: none; margin: 8px 0 0; padding: 0; }
#attention li { display:flex; gap: 10px; align-items: flex-start; padding: 8px 0; border-top: 1px solid var(--line); }
#attention li:first-child { border-top: 0; }
.dot { flex: none; width: 10px; height: 10px; border-radius: 50%; margin-top: 6px; background: var(--grey); }
.dot.problem { background: var(--red); } .dot.watch { background: var(--amber); } .dot.ok { background: var(--green); }
.where { font-size: 12px; color: var(--muted); white-space: nowrap; }
.stats { display:flex; gap: 8px; flex-wrap: wrap; margin: 10px 0 4px; }
.stat { flex: 1 1 90px; background: var(--bg); border-radius: 10px; padding: 8px 10px; }
.stat b { display:block; font-size: 20px; } .stat span { font-size: 12px; color: var(--muted); }
.stat.bad b { color: var(--red); } .stat.warn b { color: var(--amber); }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: start; font-weight: 600; color: var(--muted); padding: 4px 6px; border-bottom: 1px solid var(--line); }
td { padding: 5px 6px; border-bottom: 1px solid var(--line); vertical-align: top; overflow-wrap: anywhere; }
td.n, th.n { text-align: end; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
.scroll { overflow-x: auto; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.bad { color: var(--red); } .warn { color: var(--amber); } .good { color: var(--green); }
button, .button { min-height: 40px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--ink); font: inherit; font-weight: 600; cursor: pointer; }
button.primary { min-height: 48px; background: var(--primary); border-color: var(--primary); color: #fff; }
button.link { border: 0; background: none; color: var(--primary); padding: 0; min-height: 0; font-weight: 600; cursor: pointer; text-align: start; }
form.signin { max-width: 420px; margin: 48px auto; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 24px; }
label { display:block; font-weight:600; margin: 14px 0 6px; }
input[type=email], input[type=password], input[type=search] { width:100%; min-height:44px; padding: 8px 12px; border:1px solid var(--line); border-radius:10px; background:var(--bg); color:var(--ink); font:inherit; }
.notice { padding: 12px 14px; border-radius: 10px; background: var(--bg); margin: 12px 0; }
.notice.red { color: var(--red); background: var(--redbg); }
.setup { white-space: pre-line; }
pre { white-space: pre-wrap; word-break: break-word; background: var(--bg); padding: 10px; border-radius: 10px; font-size: 12px; max-height: 360px; overflow: auto; margin: 8px 0; }
.fb { border-top: 1px solid var(--line); padding: 10px 0; } .fb:first-child { border-top: 0; }
.fb img { max-width: 100%; max-height: 420px; border-radius: 8px; border: 1px solid var(--line); margin-top: 6px; display: block; }
.tag { display:inline-block; font-size: 12px; padding: 1px 8px; border-radius: 999px; background: var(--bg); color: var(--muted); margin-inline-end: 4px; }
.tag.bad { color: var(--red); background: var(--redbg); } .tag.good { color: var(--green); background: var(--greenbg); }
.wide { grid-column: 1 / -1; }
[hidden] { display: none !important; }
</style>
</head>
<body>
<header><div class="bar">
  <h1>LangQuest operations</h1>
  <small id="checked"></small>
  <button id="refresh" type="button" hidden>Refresh</button>
  <button id="signout" type="button" hidden>Sign out</button>
</div></header>
<main>
  <div id="out" role="status" aria-live="polite"></div>
  <form id="signin" class="signin" hidden>
    <h2>Sign in</h2>
    <p class="muted">With your LangQuest account. Only accounts on the admin list can see this page.</p>
    <label for="email">Email</label><input id="email" type="email" autocomplete="username" required>
    <label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required>
    <p><button class="primary" type="submit">Sign in</button></p>
  </form>
  <div id="board" hidden>
    <section class="card" id="attention">
      <div class="head"><h2>Needs attention</h2><span class="pill wait" id="attention-pill">Checking…</span></div>
      <ul id="attention-list"></ul>
    </section>
    <div class="grid" id="grid"></div>
  </div>
</main>
<script nonce="${nonce}">
const CFG = ${config};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const KEY = 'lq-admin-session';

// ---- formatting ----------------------------------------------------------------
const num = (n) => (n === null || n === undefined || n === '') ? '–' : Number(n).toLocaleString('en');
const pct = (x) => (x === null || x === undefined) ? '–' : (x * 100).toFixed(x < 0.01 ? 2 : 1) + '%';
const ms = (n) => n === null || n === undefined ? '–' : n >= 60000 ? (n / 60000).toFixed(1) + ' min' : n >= 1000 ? (n / 1000).toFixed(1) + ' s' : Math.round(n) + ' ms';
const bytes = (b) => { if (b === null || b === undefined) return '–'; const u = ['B','KB','MB','GB','TB']; let i = 0; let v = Number(b); while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; } return v.toFixed(v >= 10 || i === 0 ? 0 : 1) + ' ' + u[i]; };
function ago(iso) {
  if (!iso) return 'never';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 0) return 'just now';
  if (s < 90) return Math.round(s) + ' s ago';
  if (s < 5400) return Math.round(s / 60) + ' min ago';
  if (s < 172800) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' days ago';
}
const when = (iso) => iso ? '<span title="' + esc(new Date(iso).toLocaleString()) + '">' + esc(ago(iso)) + '</span>' : 'never';
const stat = (value, label, tone) => '<div class="stat ' + (tone || '') + '"><b>' + value + '</b><span>' + esc(label) + '</span></div>';
function table(cols, rows) {
  if (!rows.length) return '<p class="muted">Nothing here.</p>';
  return '<div class="scroll"><table><thead><tr>' + cols.map((c) => '<th' + (c.n ? ' class="n"' : '') + '>' + esc(c.h) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map((r) => '<tr>' + cols.map((c) => '<td' + (c.n ? ' class="n"' : '') + '>' + c.v(r) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
}
const short = (id) => id ? '<code title="' + esc(id) + '">' + esc(String(id).slice(0, 8)) + '</code>' : '–';

// ---- the session ----------------------------------------------------------------
function session() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } }
function keep(s) { sessionStorage.setItem(KEY, JSON.stringify({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at })); }
function say(text, tone) { $('out').innerHTML = text ? '<p class="notice ' + (tone || '') + '">' + esc(text) + '</p>' : ''; }

async function auth(grant, body) {
  const res = await fetch(CFG.supabaseUrl + '/auth/v1/token?grant_type=' + grant, {
    method: 'POST', headers: { apikey: CFG.anonKey, 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const s = await res.json().catch(() => ({}));
  if (!res.ok || !s.access_token) throw new Error(s.error_description || s.msg || 'Sign-in failed (' + res.status + ')');
  keep(s);
  return s;
}

/** A live access token, renewed with this tab's own refresh token when it is about to run out. */
async function token() {
  const s = session();
  if (!s) return null;
  if ((s.expires_at || 0) * 1000 > Date.now() + 60000) return s.access_token;
  try { return (await auth('refresh_token', { refresh_token: s.refresh_token })).access_token; }
  catch { sessionStorage.removeItem(KEY); return null; }
}

async function api(path) {
  const t = await token();
  if (!t) { showSignIn(); throw new Error('Signed out'); }
  const res = await fetch(path, { headers: { authorization: 'Bearer ' + t } });
  if (res.status === 401) { sessionStorage.removeItem(KEY); showSignIn('Your sign-in ended. Sign in again.'); throw new Error('Signed out'); }
  const body = await res.json().catch(() => ({}));
  if (res.status === 403) { denied(body); throw new Error('Not an admin'); }
  if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
  return body;
}

function showSignIn(message) {
  $('board').hidden = true; $('refresh').hidden = true; $('signout').hidden = true;
  $('signin').hidden = false; say(message || '', message ? 'red' : '');
}

function denied(body) {
  $('board').hidden = true; $('signin').hidden = true; $('refresh').hidden = true; $('signout').hidden = false;
  say((body.error || 'This account cannot open this page.') + (body.profileId ? ' Its profile id is ' + body.profileId + ': add it to ADMIN_PROFILE_IDS to let it in.' : ''), 'red');
}

$('signin').addEventListener('submit', async (e) => {
  e.preventDefault();
  say('Signing in…');
  try {
    await auth('password', { email: $('email').value.trim(), password: $('password').value });
    $('password').value = '';
    await start();
  } catch (err) { say(err.message, 'red'); }
});
$('signout').addEventListener('click', async () => {
  const t = (session() || {}).access_token;
  sessionStorage.removeItem(KEY);
  if (t) fetch(CFG.supabaseUrl + '/auth/v1/logout?scope=local', { method: 'POST', headers: { apikey: CFG.anonKey, authorization: 'Bearer ' + t } }).catch(() => {});
  showSignIn();
});
$('refresh').addEventListener('click', () => load(true));

// ---- the sections ----------------------------------------------------------------
const SECTIONS = [
  { id: 'jobs', title: 'Server jobs', src: 'diag.jobs: projections, push delivery, v2 import, the web Worker\\'s cron, webhooks, invite email' },
  { id: 'code', title: 'Code and deploys', src: 'GitHub main, its Actions runs, and what next.langquest.org serves' },
  { id: 'clients', title: 'Phones and browsers', src: 'Field diagnostics every install sends (docs/diagnostics.md)', wide: true },
  { id: 'cloudflare', title: 'Cloudflare', src: 'Workers requests, errors, deploys and builds, last 24 h' },
  { id: 'supabase', title: 'Supabase', src: 'Project health, Edge Functions and log counts, last 24 h' },
  { id: 'database', title: 'Database', src: 'Size, connections and RPC timings (pg_stat_statements)' },
  { id: 'vercel', title: 'Vercel', src: 'Latest production deploy of each FrontierRND project' },
  { id: 'expo', title: 'App builds and updates', src: 'EAS builds and over-the-air updates' },
  { id: 'v2', title: 'v2 import', src: 'diag.v2_import_status: the latest transfer of each v2 project' },
  { id: 'feedback', title: 'Feedback', src: 'What people sent from the help button, last 30 days', wide: true },
  { id: 'lookup', title: 'Look up', src: 'An error code someone read out (E-…), an install id, or an organization or language name' }
];
const results = {};

function layout() {
  $('grid').innerHTML = SECTIONS.map((s) => '<section class="card' + (s.wide ? ' wide' : '') + '" id="card-' + s.id + '"><div class="head"><div><h2>' + esc(s.title) +
    '</h2><div class="src">' + esc(s.src) + '</div></div><span class="pill wait" id="pill-' + s.id + '">' + (s.id === 'lookup' ? '' : 'Loading…') + '</span></div><div id="body-' + s.id + '"></div></section>').join('');
  $('pill-lookup').hidden = true;
  $('body-lookup').innerHTML = '<form id="lookup-form"><label for="q" hidden>Look up</label><input id="q" type="search" placeholder="E-7K2Q01, an install id, or a name" required>' +
    '<p><button type="submit">Look up</button></p></form><div id="lookup-out"></div>';
  $('lookup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('lookup-out').innerHTML = '<p class="muted">Looking…</p>';
    try { renderLookup(await api('/api/lookup?q=' + encodeURIComponent($('q').value.trim()))); }
    catch (err) { $('lookup-out').innerHTML = '<p class="bad">' + esc(err.message) + '</p>'; }
  });
}

function pill(s) {
  if (s.state === 'off') return ['off', 'Not connected'];
  if (s.state === 'error') return ['error', 'Could not read'];
  const p = s.alerts.filter((a) => a.level === 'problem').length, w = s.alerts.filter((a) => a.level === 'watch').length;
  if (p) return ['problem', p + (p === 1 ? ' problem' : ' problems')];
  if (w) return ['watch', w + ' to watch'];
  return ['ok', 'OK'];
}

function show(id, s) {
  results[id] = s;
  const [cls, text] = pill(s);
  const el = $('pill-' + id); el.className = 'pill ' + cls; el.textContent = text;
  let html = '';
  if (s.state === 'off') html = '<p class="setup muted">' + esc(s.setup) + '</p>';
  else if (s.state === 'error') html = '<p class="bad">' + esc(s.error) + '</p>';
  else {
    try { html = (RENDER[id] || ((d) => '<pre>' + esc(JSON.stringify(d, null, 2)) + '</pre>'))(s.data); }
    catch (err) { html = '<p class="bad">Could not show this: ' + esc(err.message) + '</p>'; }
  }
  $('body-' + id).innerHTML = html;
  if (id === 'feedback') wireScreenshots();
  attention();
}

function attention() {
  const items = [];
  for (const sec of SECTIONS) {
    const s = results[sec.id];
    if (!s) continue;
    for (const a of s.alerts || []) items.push({ level: a.level, text: a.text, where: sec.title });
    if (s.state === 'error') items.push({ level: 'watch', text: 'Could not read: ' + s.error, where: sec.title });
  }
  items.sort((a, b) => (a.level === b.level ? 0 : a.level === 'problem' ? -1 : 1));
  const loading = SECTIONS.filter((s) => s.id !== 'lookup' && !results[s.id]).length;
  const p = items.filter((i) => i.level === 'problem').length;
  const el = $('attention-pill');
  el.className = 'pill ' + (p ? 'problem' : items.length ? 'watch' : loading ? 'wait' : 'ok');
  el.textContent = p ? p + (p === 1 ? ' problem' : ' problems') + (items.length > p ? ', ' + (items.length - p) + ' to watch' : '') : items.length ? items.length + ' to watch' : loading ? 'Checking…' : 'All clear';
  $('attention-list').innerHTML = items.length
    ? items.map((i) => '<li><span class="dot ' + i.level + '"></span><span>' + esc(tidy(i.text)) + ' <span class="where">' + esc(i.where) + '</span></span></li>').join('')
    : (loading ? '' : '<li><span class="dot ok"></span><span>Nothing needs attention right now.</span></li>');
}

/** The CLI's alert wording names times as ISO and schedules as 00:10:00; this page says them as people do. */
function tidy(text) {
  return String(text)
    .replace(/\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})/g, (iso) => ago(iso))
    .replace(/every (\\d\\d):(\\d\\d):(\\d\\d)/g, (m, h, mi) => 'every ' + (Number(h) ? Number(h) + ' h' : Number(mi) + ' min'));
}

const RENDER = {
  jobs(d) {
    return table([
      { h: 'Job', v: (j) => '<b>' + esc(j.job) + '</b><br><small>' + esc(j.runs_on) + '</small>' },
      { h: 'Last run', v: (j) => when(j.last_at) + '<br><small class="' + (j.last_outcome === 'error' ? 'bad' : j.last_outcome === 'partial' ? 'warn' : '') + '">' + esc(j.last_outcome || '–') + (j.last_error_class ? ' · ' + esc(j.last_error_class) : '') + '</small>' },
      { h: 'Runs 2 d', n: true, v: (j) => num(j.runs) },
      { h: 'Failed', n: true, v: (j) => '<span class="' + (j.failures ? 'bad' : '') + '">' + num(j.failures) + '</span>' },
      { h: 'p95', n: true, v: (j) => ms(j.p95_ms) },
      { h: '', v: (j) => j.stale ? '<span class="bad nowrap">stopped</span>' : j.streak >= 3 ? '<span class="bad nowrap">failing</span>' : '' }
    ], d.jobs);
  },
  clients(c) {
    const sync = c.sync || {};
    const syncs = Object.values(sync).reduce((a, x) => a + x.records, 0);
    const errSync = (sync.error || { records: 0 }).records;
    const errorsDay = c.errors.reduce((a, e) => a + e.day, 0);
    const down = c.transfer.down || {}, up = c.transfer.up || {};
    const fails = (t) => ['failOffline','failHttp4xx','failHttp5xx','failHash','failDisk','failOther','failAuth','failNotFound','failTooLarge','failBadDigest','failGone'].reduce((a, k) => a + (t[k] || 0), 0);
    let h = '<div class="stats">' +
      stat(num(c.installs.day), 'installs reported, last day') + stat(num(c.installs.week), 'this week') +
      stat(num(syncs), 'syncs, last day') + stat(num(errSync), 'syncs ended in error', errSync ? 'warn' : '') +
      stat(num(errorsDay), 'errors, last day', errorsDay ? 'bad' : '') +
      stat(num(down.count) + ' / ' + num(fails(down)), 'downloads / failed', fails(down) ? 'warn' : '') +
      stat(num(up.count) + ' / ' + num(fails(up)), 'uploads / failed', fails(up) ? 'warn' : '') + '</div>';
    h += '<h3>Errors this week (newest first)</h3>' + table([
      { h: 'Error', v: (e) => '<b>' + esc(e.name || 'Error') + '</b>' + (e.fatal ? ' <span class="tag bad">crash</span>' : '') + '<br><small>' + esc(e.where || '') + (e.code ? ' · ' + esc(e.code) : '') + '</small>' },
      { h: 'Last', v: (e) => when(e.lastAt) },
      { h: 'Day', n: true, v: (e) => num(e.day) },
      { h: 'Week', n: true, v: (e) => num(e.records) },
      { h: 'Installs', n: true, v: (e) => num(e.installs) },
      { h: 'Latest code', v: (e) => e.errorId ? '<button class="link" data-q="' + esc(e.errorId) + '">' + esc(e.errorId) + '</button>' : '–' }
    ], c.errors);
    const outcomes = Object.entries(sync).sort((a, b) => b[1].records - a[1].records);
    h += '<h3>Sync outcomes, last day</h3>' + table([
      { h: 'Outcome', v: (r) => '<span class="' + (r[0] === 'ok' ? 'good' : r[0] === 'offline' ? '' : 'warn') + '">' + esc(r[0]) + '</span>' },
      { h: 'Syncs', n: true, v: (r) => num(r[1].records) },
      { h: 'Installs', n: true, v: (r) => num(r[1].installs) }
    ], outcomes);
    if (c.syncErrors.length) h += table([{ h: 'Sync error (phase:code)', v: (r) => '<code>' + esc(r.code) + '</code>' }, { h: 'Syncs', n: true, v: (r) => num(r.records) }, { h: 'Installs', n: true, v: (r) => num(r.installs) }], c.syncErrors);
    const d = c.device;
    h += '<h3>Phones (latest state of each, this week)</h3><div class="stats">' + stat(num(d.reporting), 'reporting') +
      stat(num(d.lostRecordings), 'lost recordings', d.lostRecordings ? 'bad' : '') + stat(num(d.unsentOverDay), 'recording unsent > 1 day', d.unsentOverDay ? 'warn' : '') +
      stat(num(d.downloadStuckOverDay), 'download stuck > 1 day', d.downloadStuckOverDay ? 'warn' : '') + stat(num(d.lowDisk), 'under 500 MB free', d.lowDisk ? 'warn' : '') + '</div>';
    if (c.auth.length) h += '<h3>Sign-in trouble this week</h3>' + table([
      { h: 'Step', v: (a) => esc(a.op || '?') }, { h: 'Ended', v: (a) => esc(a.outcome || '?') + (a.code ? ' <code>' + esc(a.code) + '</code>' : '') },
      { h: 'Times', n: true, v: (a) => num(a.records) }, { h: 'Installs', n: true, v: (a) => num(a.installs) }, { h: 'Last', v: (a) => when(a.lastAt) }
    ], c.auth);
    if (c.expected.length) h += '<h3>Failures already shown to people, this week</h3>' + table([
      { h: 'Where', v: (x) => esc(x.where || '?') + '<br><small>' + esc(x.name || '') + (x.code ? ' · ' + esc(x.code) : '') + '</small>' },
      { h: 'Times', n: true, v: (x) => num(x.count) }, { h: 'Installs', n: true, v: (x) => num(x.installs) }, { h: 'Last', v: (x) => when(x.lastAt) }
    ], c.expected);
    const a = c.audio || {};
    h += '<h3>Recording, last day</h3><div class="stats">' + stat(num(a.takes), 'takes') + stat(num((a.saveFail || 0) + (a.startFail || 0) + (a.stopFail || 0) + (a.encodeFail || 0)), 'failed', (a.saveFail || a.startFail || a.stopFail || a.encodeFail) ? 'warn' : '') +
      stat(num(a.micRefused), 'microphone refused') + stat(num(a.playFail), 'playback failed', a.playFail ? 'warn' : '') + '</div>';
    h += '<h3>Builds in the field (this week)</h3>' + table([
      { h: 'Runtime', v: (b) => '<code>' + esc(b.runtime || '?') + '</code>' }, { h: 'Channel', v: (b) => esc(b.channel || '?') },
      { h: 'Update', v: (b) => b.update ? '<code>' + esc(b.update) + '</code>' : (b.embedded === 'yes' ? 'embedded' : '–') },
      { h: 'Installs', n: true, v: (b) => num(b.installs) }, { h: 'Last seen', v: (b) => when(b.lastSeen) }
    ], c.builds);
    h += '<p class="muted">' + c.platforms.map((p) => esc(p.os) + ' ' + num(p.installs)).join(' · ') + ' · ' + num(c.installs.all) + ' installs known in all</p>';
    return h;
  },
  code(d) {
    const live = d.live.build ? '<code>' + esc(d.live.build.slice(0, 8)) + '</code>' : '<span class="bad">no answer</span>';
    const same = d.behind === 0;
    let h = '<div class="stats">' + stat('<code>' + esc(d.main.sha.slice(0, 8)) + '</code>', 'main, ' + ago(d.main.at)) +
      stat(live, new URL(d.live.url).host + ' serves', same ? '' : 'bad') +
      stat(d.behind === null ? '?' : num(d.behind), 'commits not deployed', d.behind ? 'bad' : '') + '</div>';
    h += '<p class="muted">' + esc(d.main.title) + '</p>';
    h += '<h3>Latest run of each workflow on main</h3>' + table([
      { h: 'Workflow', v: (r) => '<a href="' + esc(r.url) + '" target="_blank" rel="noopener">' + esc(r.workflow) + '</a><br><small>' + esc(r.event) + ' · <code>' + esc(r.sha) + '</code></small>' },
      { h: 'Result', v: (r) => '<span class="' + (r.conclusion === 'success' ? 'good' : r.conclusion === 'failure' ? 'bad' : 'warn') + '">' + esc(r.conclusion || r.status) + '</span>' },
      { h: 'When', v: (r) => when(r.at) }
    ], d.runs);
    return h;
  },
  cloudflare(d) {
    let h = table([
      { h: 'Worker', v: (w) => '<b>' + esc(w.name) + '</b>' },
      { h: 'Requests', n: true, v: (w) => num(w.requests) },
      { h: 'Errors', n: true, v: (w) => '<span class="' + (w.errors ? 'bad' : '') + '">' + num(w.errors) + '</span><br><small>' + pct(w.errorRate) + '</small>' },
      { h: 'CPU p99', n: true, v: (w) => w.cpuP99 === null ? '–' : ms(w.cpuP99 / 1000) },
      { h: 'Deployed', v: (w) => w.lastDeploy ? when(w.lastDeploy.at) + '<br><small>' + esc(w.lastDeploy.source || '') + '</small>' : '–' },
      { h: 'Last build', v: (w) => w.lastBuild ? '<span class="' + (w.lastBuild.outcome === 'success' ? 'good' : w.lastBuild.outcome === 'fail' || w.lastBuild.outcome === 'failure' ? 'bad' : 'warn') + '">' + esc(w.lastBuild.outcome || w.lastBuild.status || '?') + '</span><br><small>' + when(w.lastBuild.at) + (w.lastBuild.commit ? ' · <code>' + esc(w.lastBuild.commit.slice(0, 8)) + '</code>' : '') + '</small>' : '–' }
    ], d.workers);
    const statuses = d.workers.flatMap((w) => Object.entries(w.statuses || {}).filter(([s]) => s !== 'success').map(([s, n]) => esc(w.name) + ': ' + esc(s) + ' ' + num(n)));
    if (statuses.length) h += '<p class="muted">Not successful: ' + statuses.join(' · ') + '</p>';
    if (d.notes && d.notes.length) h += '<p class="muted">' + d.notes.map(esc).join('<br>') + '</p>';
    return h;
  },
  supabase(d) {
    return d.projects.map((p) => {
      let h = '<h3>' + esc(p.name) + ' <code>' + esc(p.ref) + '</code> · <span class="' + (p.status === 'ACTIVE_HEALTHY' ? 'good' : 'bad') + '">' + esc(p.status || '?') + '</span></h3>';
      if (p.error) return h + '<p class="bad">' + esc(p.error) + '</p>';
      if (p.health && p.health.length) h += '<p>' + p.health.map((s) => '<span class="tag ' + (s.healthy ? 'good' : 'bad') + '">' + esc(s.name) + ' ' + (s.healthy ? 'ok' : esc(s.status || 'unhealthy')) + '</span>').join('') + '</p>';
      if (p.logs) h += '<div class="stats">' + stat(num(p.logs.gatewayTotal), 'API requests') + stat(num(p.logs.gateway5xx), 'API 5xx', p.logs.gateway5xx ? 'warn' : '') +
        stat(num(p.logs.function5xx), 'Edge Function 5xx', p.logs.function5xx ? 'warn' : '') + stat(num(p.logs.postgresErrors), 'Postgres errors', p.logs.postgresErrors ? 'warn' : '') +
        stat(num(p.logs.authErrors), 'Auth errors', p.logs.authErrors ? 'warn' : '') + '</div>';
      if (p.logsError) h += '<p class="muted">Logs: ' + esc(p.logsError) + '</p>';
      if (p.functions && p.functions.length) h += table([
        { h: 'Edge Function', v: (f) => esc(f.slug) }, { h: 'Status', v: (f) => '<span class="' + (f.status === 'ACTIVE' ? 'good' : 'warn') + '">' + esc(f.status) + '</span>' },
        { h: 'Version', n: true, v: (f) => num(f.version) }, { h: 'Updated', v: (f) => when(f.updatedAt) }
      ], p.functions);
      return h;
    }).join('');
  },
  database(d) {
    const s = d.stats || {};
    let h = '<div class="stats">' + stat(bytes(d.sizeBytes), 'database size') +
      stat(num(d.connections) + ' / ' + num(d.maxConnections), 'connections', d.connections >= d.maxConnections * 0.8 ? 'warn' : '') +
      stat(s.hitRatio === null || s.hitRatio === undefined ? '–' : pct(s.hitRatio), 'cache hits') + stat(num(s.deadlocks), 'deadlocks', s.deadlocks ? 'warn' : '') + '</div>';
    h += '<h3>RPCs by total time' + (s.since ? ' since ' + esc(new Date(s.since).toLocaleDateString()) : '') + '</h3>' + table([
      { h: 'RPC', v: (r) => '<code>' + esc(r.rpc) + '</code>' }, { h: 'Calls', n: true, v: (r) => num(r.calls) },
      { h: 'Mean', n: true, v: (r) => '<span class="' + (r.mean_ms > 500 ? 'bad' : '') + '">' + ms(r.mean_ms) + '</span>' },
      { h: 'Max', n: true, v: (r) => ms(r.max_ms) }, { h: 'Total', n: true, v: (r) => num(r.total_s) + ' s' }
    ], d.rpc.slice(0, 12));
    return h;
  },
  vercel(d) {
    return table([
      { h: 'Project', v: (p) => '<b>' + esc(p.name) + '</b>' + (p.domain ? '<br><small>' + esc(p.domain) + '</small>' : '') },
      { h: 'Production', v: (p) => p.latest ? '<span class="' + (p.latest.state === 'READY' ? 'good' : p.latest.state === 'ERROR' ? 'bad' : 'warn') + '">' + esc(p.latest.state) + '</span><br><small>' + when(p.latest.at) + '</small>' : '–' },
      { h: 'Last failed', v: (p) => p.lastError ? when(p.lastError.at) : '–' }
    ], d.projects);
  },
  expo(d) {
    let h = '<h3>Latest builds</h3>' + table([
      { h: 'Build', v: (b) => esc(b.platform) + ' · ' + esc(b.profile || '?') + '<br><small>' + esc(b.appVersion || '') + (b.runtime ? ' · runtime ' + esc(b.runtime) : '') + '</small>' },
      { h: 'Status', v: (b) => '<span class="' + (b.status === 'FINISHED' ? 'good' : b.status === 'ERRORED' ? 'bad' : 'warn') + '">' + esc(b.status) + '</span>' },
      { h: 'When', v: (b) => when(b.at) }
    ], d.builds);
    h += '<h3>Latest updates</h3>' + table([
      { h: 'Branch', v: (u) => esc(u.branch) + '<br><small>' + esc(u.platform || '') + (u.runtime ? ' · runtime ' + esc(u.runtime) : '') + '</small>' },
      { h: 'Group', v: (u) => short(u.group) }, { h: 'When', v: (u) => when(u.at) }
    ], d.updates);
    return h;
  },
  v2(d) {
    const st = d.states || {};
    let h = '<div class="stats">' + stat(num(st.done || 0), 'done') + stat(num(st.running || 0), 'running') +
      stat(num(st.error || 0), 'failed', st.error ? 'warn' : '') + stat(num(st.cut_off || 0), 'stopped part way', st.cut_off ? 'warn' : '') + '</div>';
    h += table([
      { h: 'Project', v: (p) => short(p.project_id) }, { h: 'State', v: (p) => '<span class="' + (p.state === 'done' ? 'good' : p.state === 'running' ? '' : 'warn') + '">' + esc(p.state) + '</span>' + (p.step ? '<br><small>' + esc(p.step) + '</small>' : '') },
      { h: 'Progress', n: true, v: (p) => p.total ? num(p.done) + ' / ' + num(p.total) : '–' },
      { h: 'Started', v: (p) => when(p.started_at) }, { h: 'Failed 7 d', n: true, v: (p) => num(p.failed_7d) }
    ], d.projects);
    return h;
  },
  feedback(d) {
    if (!d.items.length) return '<p class="muted">No feedback in the last 30 days.</p>';
    return d.items.map((f) => '<div class="fb"><span class="tag ' + (f.kind === 'bug' ? 'bad' : 'good') + '">' + esc(f.kind) + '</span><span class="tag">' + esc(f.status || 'new') + '</span>' +
      '<small>' + when(f.created_at) + (f.context && f.context.screen ? ' · ' + esc(f.context.screen) : '') + (f.context ? ' · ' + esc([f.context.os, f.context.appVersion, f.context.channel].filter(Boolean).join(' ')) : '') + '</small>' +
      '<p>' + esc(f.body) + '</p>' +
      (f.shared_name || f.shared_email ? '<p><small>From ' + esc([f.shared_name, f.shared_email].filter(Boolean).join(', ')) + ' (shared by them)</small></p>' : '') +
      (f.install_id ? '<p><button class="link" data-q="' + esc(f.install_id) + '">This install\\'s diagnostics</button></p>' : '') +
      (f.has_screenshot ? '<p><button class="link" data-shot="' + esc(f.id) + '">Show screenshot</button></p>' : '') + '</div>').join('');
  }
};

function renderLookup(r) {
  let h = '';
  if (r.kind === 'error') {
    const list = r.result || [];
    if (!list.length) h = '<p class="muted">No error with that code.</p>';
    for (const e of list) {
      h += '<p><b>' + esc((e.t && e.t.name) || 'Error') + '</b> ' + esc((e.t && e.t.where) || '') + (e.t && e.t.code ? ' <code>' + esc(e.t.code) + '</code>' : '') + ' · ' + when(e.at) + ' · install ' +
        '<button class="link" data-q="' + esc(e.installId) + '">' + esc(String(e.installId).slice(0, 8)) + '</button></p>' +
        '<p class="muted">' + esc(e.context ? [e.context.os, e.context.osVersion, e.context.model, e.context.appVersion, e.context.channel, e.context.runtimeVersion].filter(Boolean).join(' · ') : '') + '</p>' +
        (e.stack ? '<pre>' + esc(e.stack) + '</pre>' : '') +
        (e.before && e.before.length ? '<h3>Just before</h3><pre>' + esc(e.before.map((b) => b.at + '  ' + b.kind + '  ' + JSON.stringify(b.t) + '  ' + JSON.stringify(b.n)).join('\\n')) + '</pre>' : '');
    }
  } else if (r.kind === 'install') {
    const c = r.result.context || {};
    h = '<p class="muted">' + esc([c.os, c.osVersion, c.model, c.appVersion, c.channel, c.runtimeVersion].filter(Boolean).join(' · ')) + '</p>' +
      '<h3>Last 3 days, newest first</h3><pre>' + esc(r.result.timeline.map((x) => x.at + '  ' + x.kind.padEnd(10) + ' ' + (x.stream_id || '').slice(0, 8).padEnd(8) + '  ' + JSON.stringify(x.t) + '  ' + JSON.stringify(x.n)).join('\\n')) + '</pre>';
  } else {
    const list = r.result || [];
    h = list.length ? table([
      { h: 'Kind', v: (f) => esc(f.kind) }, { h: 'Name', v: (f) => esc(f.name) }, { h: 'Organization', v: (f) => short(f.org_id) }, { h: 'Language', v: (f) => short(f.language_id) }
    ], list) + '<p class="muted">npm run diag -- report &lt;org&gt; &lt;language&gt; gives the full report.</p>' : '<p class="muted">Nothing matches.</p>';
  }
  $('lookup-out').innerHTML = h;
}

document.addEventListener('click', (e) => {
  const q = e.target.closest && e.target.closest('[data-q]');
  if (q) { $('q').value = q.dataset.q; $('lookup-form').requestSubmit(); $('card-lookup').scrollIntoView({ behavior: 'smooth' }); }
});

function wireScreenshots() {
  for (const b of document.querySelectorAll('[data-shot]')) {
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const t = await token();
        const res = await fetch('/api/feedback/' + encodeURIComponent(b.dataset.shot) + '/screenshot', { headers: { authorization: 'Bearer ' + t } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const img = document.createElement('img');
        img.alt = 'Screenshot sent with this feedback';
        img.src = URL.createObjectURL(await res.blob());
        b.replaceWith(img);
      } catch (err) { b.textContent = 'Could not load the screenshot (' + err.message + ')'; }
    }, { once: true });
  }
}

// ---- loading ----------------------------------------------------------------------
let loading = false;
async function load(fresh) {
  if (loading) return;
  loading = true;
  $('refresh').disabled = true;
  for (const k of Object.keys(results)) delete results[k];
  for (const s of SECTIONS) if (s.id !== 'lookup') { const p = $('pill-' + s.id); p.className = 'pill wait'; p.textContent = 'Loading…'; }
  attention();
  const q = fresh ? '?fresh=1' : '';
  const fail = (ids) => (err) => { if (err.message !== 'Signed out' && err.message !== 'Not an admin') for (const id of ids) show(id, { state: 'error', alerts: [], error: err.message }); };
  const jobs = [
    api('/api/diag' + q).then((d) => { for (const id of ['jobs', 'clients', 'database', 'v2', 'feedback']) show(id, d[id]); }).catch(fail(['jobs', 'clients', 'database', 'v2', 'feedback'])),
    ...['code', 'cloudflare', 'supabase', 'vercel', 'expo'].map((id) => api('/api/' + id + q).then((d) => show(id, d)).catch(fail([id])))
  ];
  await Promise.all(jobs);
  $('checked').textContent = 'Checked ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('refresh').disabled = false;
  loading = false;
}

async function start() {
  const me = await api('/api/me').catch(() => null);
  if (!me) return;
  $('signin').hidden = true; say('');
  $('board').hidden = false; $('refresh').hidden = false; $('signout').hidden = false;
  if (!$('grid').children.length) layout();
  await load(false);
}

// Every five minutes while the tab is in front.
setInterval(() => { if (document.visibilityState === 'visible' && !$('board').hidden) load(false); }, 300000);
if (session()) start(); else showSignIn();
</script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': csp(cfg.supabaseUrl, nonce),
      ...SECURITY_HEADERS
    }
  });
}

export const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()'
} as const;

/** Only this page's own script and style, its own API and Supabase Auth; nothing else loads or frames it. */
export function csp(supabaseUrl: string, nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "img-src 'self' blob:",
    `connect-src 'self' ${new URL(supabaseUrl).origin}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'"
  ].join('; ');
}
