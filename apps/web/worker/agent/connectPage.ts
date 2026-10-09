import { SCOPE_TEXT, SCOPES } from './tokens';

/**
 * `/connect`: where a person approves an app's request (the device flow)
 * and makes, sees and revokes their own tokens. One page, no build step,
 * served by the Worker. It uses the web app's session when this browser has
 * a live one (same origin), else signs in with email and password; it never
 * refreshes the app's session, since that would rotate the app's refresh
 * token out from under it.
 */
export function connectPage(cfg: { supabaseUrl: string; anonKey: string }): Response {
  const config = JSON.stringify({ ...cfg, scopes: SCOPES, scopeText: SCOPE_TEXT }).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect an app · LangQuest</title>
<style>
:root { --primary:#6B48C8; --bg:#F4F2FA; --card:#fff; --ink:#1E1636; --muted:#6E629E; --line:#E3DEF3; --red:#B42318; --green:#1F7A4D; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --primary:#A48BF0; --bg:#14101F; --card:#1E1830; --ink:#F1EEFA; --muted:#B4A9D8; --line:#332A4D; --red:#FF8A80; --green:#7FD6A4; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 720px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 26px; margin: 8px 0 4px; } h2 { font-size: 19px; margin: 0 0 8px; }
p { margin: 6px 0; } .muted { color: var(--muted); } small { color: var(--muted); }
section { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; margin: 16px 0; }
label { display:block; font-weight:600; margin: 14px 0 6px; }
input[type=text], input[type=email], input[type=password], select { width:100%; min-height:48px; padding: 10px 12px; border:1px solid var(--line); border-radius:10px; background:var(--bg); color:var(--ink); font:inherit; }
.check { display:flex; gap:12px; align-items:flex-start; font-weight:400; min-height:48px; padding:8px 0; margin:0; }
.check input { width:22px; height:22px; margin-top:2px; flex:none; accent-color: var(--primary); }
button { min-height:48px; padding: 0 20px; border-radius: 12px; border: 1px solid var(--line); background: var(--card); color: var(--ink); font: inherit; font-weight: 600; cursor: pointer; }
button.primary { min-height:56px; background: var(--primary); border-color: var(--primary); color: #fff; }
button.danger { color: var(--red); }
.row { display:flex; gap:12px; flex-wrap:wrap; margin-top: 16px; }
.notice { padding: 12px 14px; border-radius: 10px; background: var(--bg); margin: 12px 0; }
.notice.red { color: var(--red); } .notice.green { color: var(--green); }
.tag { display:inline-block; font-size: 13px; padding: 2px 8px; border-radius: 999px; background: var(--bg); color: var(--muted); margin: 2px 4px 2px 0; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 14px; }
pre { white-space: pre-wrap; word-break: break-all; background: var(--bg); padding: 12px; border-radius: 10px; margin: 8px 0; }
.token { border-top: 1px solid var(--line); padding: 14px 0; } .token:first-of-type { border-top: 0; }
.code { font: 600 28px ui-monospace, Menlo, monospace; letter-spacing: 2px; }
[hidden] { display: none !important; }
</style>
</head>
<body>
<main>
  <h1>Connect an app</h1>
  <p class="muted">Give a listening app, a website or an AI agent access to your organization's translations. It can do only what you choose here, and never more than you can do yourself.</p>
  <div id="out" role="status" aria-live="polite"></div>

  <section id="signin" hidden>
    <h2>Sign in</h2>
    <p class="muted">With the account you use in the LangQuest app.</p>
    <form id="signin-form">
      <label for="email">Email</label><input id="email" type="email" autocomplete="email" required>
      <label for="password">Password</label><input id="password" type="password" autocomplete="current-password" required>
      <div class="row"><button class="primary" type="submit">Sign in</button></div>
    </form>
  </section>

  <section id="request" hidden>
    <h2>An app is asking for access</h2>
    <form id="code-form" hidden>
      <label for="code">Code the app showed you</label><input id="code" type="text" autocomplete="off" placeholder="BCDF-GHJK" required>
      <div class="row"><button class="primary" type="submit">Continue</button></div>
    </form>
    <div id="request-body"></div>
  </section>

  <section id="create" hidden>
    <h2>Make a token</h2>
    <p class="muted">For an app or agent you set up yourself. You see the token once, so copy it somewhere safe.</p>
    <div id="create-body"></div>
  </section>

  <section id="tokens" hidden>
    <h2>Your tokens</h2>
    <div id="tokens-body"></div>
  </section>
  <p class="muted" id="who"></p>
</main>
<script>
const CFG = ${config};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
let jwt = null, orgs = [];

function say(text, tone) { $('out').innerHTML = text ? '<p class="notice ' + (tone || '') + '">' + esc(text) + '</p>' : ''; }

function appSession() {
  try {
    const ref = new URL(CFG.supabaseUrl).hostname.split('.')[0];
    const raw = localStorage.getItem('sb-' + ref + '-auth-token') || sessionStorage.getItem('lq-connect-session');
    const s = raw ? JSON.parse(raw) : null;
    if (s && s.access_token && (s.expires_at || 0) * 1000 > Date.now() + 60000) return s;
  } catch {}
  return null;
}

async function api(path, init) {
  const res = await fetch('/api/v1/session' + path, { ...init, headers: { authorization: 'Bearer ' + jwt, 'content-type': 'application/json' } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) { jwt = null; sessionStorage.removeItem('lq-connect-session'); show(); throw new Error('Sign in again.'); }
  if (!res.ok) throw new Error(body.error || 'Something went wrong (' + res.status + ').');
  return body;
}

$('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  say('Signing in…');
  try {
    const res = await fetch(CFG.supabaseUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { apikey: CFG.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value })
    });
    const s = await res.json();
    if (!res.ok || !s.access_token) throw new Error(s.error_description || s.msg || 'That email and password did not match.');
    sessionStorage.setItem('lq-connect-session', JSON.stringify({ access_token: s.access_token, expires_at: s.expires_at, user: s.user }));
    say('');
    await start();
  } catch (err) { say(err.message, 'red'); }
});

function scopeBoxes(name, allowed, checked) {
  return allowed.map((s) => '<label class="check"><input type="checkbox" name="' + name + '" value="' + esc(s) + '"' + (checked.includes(s) ? ' checked' : '') + '><span><b>' + esc(s) + '</b><br><small>' + esc(CFG.scopeText[s]) + '</small></span></label>').join('');
}

function orgSelect(id, selected) {
  return '<label for="' + id + '">Organization</label><select id="' + id + '">' + orgs.map((o) => '<option value="' + esc(o.orgId) + '"' + (o.orgId === selected ? ' selected' : '') + '>' + esc(o.name || o.orgId) + '</option>').join('') + '</select>';
}

function languageBoxes(prefix, orgId) {
  const org = orgs.find((o) => o.orgId === orgId);
  if (!org) return '';
  return '<label class="check"><input type="checkbox" id="' + prefix + '-all" checked><span><b>Every language I can see</b><br><small>Including ones added later</small></span></label>' +
    '<div id="' + prefix + '-langs" hidden>' + org.languages.map((l) => '<label class="check"><input type="checkbox" name="' + prefix + '-lang" value="' + esc(l.languageId) + '"><span>' + esc(l.name) + (l.mayReview ? '' : ' <small>(you cannot review or translate here, so it cannot record reviews)</small>') + '</span></label>').join('') + '</div>';
}

function wireLanguages(prefix) {
  const all = $(prefix + '-all');
  if (all) all.addEventListener('change', () => { $(prefix + '-langs').hidden = all.checked; });
}

function expirySelect(id) {
  return '<label for="' + id + '">Expires</label><select id="' + id + '"><option value="">Never (revoke it here when done)</option><option value="30">In 30 days</option><option value="90">In 90 days</option><option value="365">In a year</option></select>';
}

function readSpec(prefix, orgSel, expSel) {
  const checked = (name) => [...document.querySelectorAll('input[name="' + name + '"]:checked')].map((i) => i.value);
  const all = $(prefix + '-all');
  return {
    orgId: $(orgSel).value, scopes: checked(prefix + '-scope'),
    languageIds: all && all.checked ? null : checked(prefix + '-lang'),
    expiresInDays: $(expSel).value ? Number($(expSel).value) : null
  };
}

function howToUse(secret) {
  const base = location.origin + '/api/v1';
  return '<p><b>Copy this token now.</b> It is not shown again.</p><pre id="secret">' + esc(secret) + '</pre>' +
    '<div class="row"><button type="button" id="copy">Copy token</button></div>' +
    '<p class="muted" style="margin-top:16px">Try it:</p><pre>curl -H "Authorization: Bearer ' + esc(secret) + '" ' + esc(base) + '/languages</pre>' +
    '<p class="muted">Or add LangQuest to an AI agent as an MCP server:</p><pre>' + esc(JSON.stringify({ mcpServers: { langquest: { type: 'http', url: base + '/mcp', headers: { Authorization: 'Bearer ' + secret } } } }, null, 2)) + '</pre>';
}

function renderCreate() {
  const first = orgs[0] ? orgs[0].orgId : '';
  $('create-body').innerHTML = '<form id="create-form"><label for="t-name">Name</label><input id="t-name" type="text" maxlength="120" required placeholder="Listening app, or my agent">' +
    orgSelect('t-org', first) + '<label>What it may do</label>' + scopeBoxes('t-scope', CFG.scopes, ['read:published']) +
    '<label>Languages</label><div id="t-langs-wrap">' + languageBoxes('t', first) + '</div>' + expirySelect('t-exp') +
    '<div class="row"><button class="primary" type="submit">Make token</button></div></form><div id="create-result"></div>';
  wireLanguages('t');
  $('t-org').addEventListener('change', () => { $('t-langs-wrap').innerHTML = languageBoxes('t', $('t-org').value); wireLanguages('t'); });
  $('create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const out = await api('/tokens', { method: 'POST', body: JSON.stringify({ name: $('t-name').value, ...readSpec('t', 't-org', 't-exp') }) });
      $('create-result').innerHTML = '<div class="notice green">Token made.</div>' + howToUse(out.token);
      $('copy').addEventListener('click', () => navigator.clipboard.writeText(out.token).then(() => say('Copied.', 'green')));
      await renderTokens();
    } catch (err) { say(err.message, 'red'); }
  });
}

async function renderTokens() {
  const list = await api('/tokens');
  const orgName = (id) => (orgs.find((o) => o.orgId === id) || {}).name || id;
  const langName = (orgId, id) => ((orgs.find((o) => o.orgId === orgId) || { languages: [] }).languages.find((l) => l.languageId === id) || {}).name || id;
  const when = (t) => t ? new Date(t).toLocaleString() : 'never';
  $('tokens-body').innerHTML = list.length === 0 ? '<p class="muted">None yet.</p>' : list.map((t) => {
    const state = t.revokedAt ? 'Revoked ' + when(t.revokedAt) : t.expiresAt && Date.parse(t.expiresAt) < Date.now() ? 'Expired' : 'Active';
    return '<div class="token"><b>' + esc(t.name) + '</b> <span class="tag">' + esc(state) + '</span>' + (t.clientName ? ' <span class="tag">asked by ' + esc(t.clientName) + '</span>' : '') +
      '<p class="muted">' + esc(orgName(t.orgId)) + ' · ' + (t.languageIds ? t.languageIds.map((l) => esc(langName(t.orgId, l))).join(', ') : 'every language') + '</p>' +
      '<p>' + t.scopes.map((s) => '<span class="tag">' + esc(s) + '</span>').join('') + '</p>' +
      '<small>Made ' + esc(when(t.createdAt)) + ' · last used ' + esc(when(t.lastUsedAt)) + (t.expiresAt ? ' · expires ' + esc(when(t.expiresAt)) : '') + '</small>' +
      (t.revokedAt ? '' : '<div class="row"><button type="button" class="danger" data-revoke="' + esc(t.id) + '">Revoke</button></div>') + '</div>';
  }).join('');
  document.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Revoke this token? Anything using it stops working at once.')) return;
    try { await api('/tokens/' + encodeURIComponent(b.dataset.revoke) + '/revoke', { method: 'POST' }); say('Revoked.', 'green'); await renderTokens(); }
    catch (err) { say(err.message, 'red'); }
  }));
}

async function renderRequest(code) {
  $('request').hidden = false;
  if (!code) { $('code-form').hidden = false; $('request-body').innerHTML = ''; return; }
  $('code-form').hidden = true;
  let g;
  try { g = await api('/device/' + encodeURIComponent(code)); }
  catch (err) { $('request-body').innerHTML = '<p class="notice red">' + esc(err.message) + '</p>'; $('code-form').hidden = false; return; }
  if (g.state !== 'pending') {
    $('request-body').innerHTML = '<p class="notice">This request is ' + esc(g.state) + '.' + (g.state === 'approved' ? ' The app can carry on.' : '') + '</p>';
    return;
  }
  const org = g.requestedOrgId && orgs.some((o) => o.orgId === g.requestedOrgId) ? g.requestedOrgId : (orgs[0] || {}).orgId;
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(g.createdAt)) / 60000));
  $('request-body').innerHTML = '<p class="code">' + esc(g.userCode) + '</p><p>Check this matches the code the app shows. Asked ' + (mins < 1 ? 'just now' : mins + ' minute' + (mins === 1 ? '' : 's') + ' ago') + '.</p>' +
    '<p class="notice">Approve only if you started this yourself, in an app or agent in front of you. If someone sent you this link, deny it.</p>' +
    '<p><b>' + esc(g.clientName) + '</b> <span class="tag">unverified</span></p><p class="muted">That is what the app calls itself. LangQuest cannot check it, so approve only an app you just asked to connect.</p>' +
    '<form id="approve-form">' + orgSelect('d-org', org) + '<label>It asks to</label>' + scopeBoxes('d-scope', g.requestedScopes, g.requestedScopes.filter((s) => s.startsWith('read'))) +
    '<p class="muted">Anything that writes as you (reviews, releases, external values) starts unticked: tick it only if the app needs it.</p><label>Languages</label><div id="d-langs-wrap">' + languageBoxes('d', org) + '</div>' + expirySelect('d-exp') +
    '<div class="row"><button class="primary" type="submit">Approve</button><button type="button" id="deny">Deny</button></div></form>';
  wireLanguages('d');
  $('d-org').addEventListener('change', () => { $('d-langs-wrap').innerHTML = languageBoxes('d', $('d-org').value); wireLanguages('d'); });
  $('deny').addEventListener('click', async () => {
    try { await api('/device/' + encodeURIComponent(code), { method: 'POST', body: JSON.stringify({ decision: 'deny' }) }); $('request-body').innerHTML = '<p class="notice">Denied. The app gets nothing.</p>'; }
    catch (err) { say(err.message, 'red'); }
  });
  $('approve-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/device/' + encodeURIComponent(code), { method: 'POST', body: JSON.stringify({ decision: 'approve', name: g.clientName, ...readSpec('d', 'd-org', 'd-exp') }) });
      $('request-body').innerHTML = '<p class="notice green">Approved. ' + esc(g.clientName) + ' is connected; you can close this page. Revoke it below at any time.</p>';
      await renderTokens();
    } catch (err) { say(err.message, 'red'); }
  });
}

$('code-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('code').value.trim();
  history.replaceState(null, '', '/connect?code=' + encodeURIComponent(code));
  renderRequest(code);
});

function show() {
  const signedIn = !!jwt;
  $('signin').hidden = signedIn;
  for (const id of ['create', 'tokens']) $(id).hidden = !signedIn;
  if (!signedIn) $('request').hidden = true;
}

async function start() {
  const s = appSession();
  jwt = s ? s.access_token : null;
  show();
  if (!jwt) return;
  if (s.user && s.user.email) $('who').textContent = 'Signed in as ' + s.user.email + '.';
  try {
    orgs = await api('/orgs');
    if (orgs.length === 0) { say('You are not in an organization with languages yet, so there is nothing to connect.', 'red'); return; }
    const code = new URLSearchParams(location.search).get('code');
    await renderRequest(code);
    renderCreate();
    await renderTokens();
  } catch (err) { say(err.message, 'red'); }
}

if (!CFG.anonKey) say('This server has no sign-in configuration (SUPABASE_ANON_KEY).', 'red');
start();
</script>
</body>
</html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'content-security-policy': `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' ${new URL(cfg.supabaseUrl).origin}; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
    }
  });
}
