import type { UiLanguage } from '../../../mobile/src/i18n/languages';
import { languageChoices, pageWords } from '../i18n/pages';
import { SCOPES, type Scope } from './tokens';

/**
 * `/connect`: where a person approves an app's request (the device flow)
 * and makes, sees and revokes their own tokens. One page, no build step,
 * served by the Worker. It uses the web app's session when this browser has
 * a live one (same origin), else signs in with email and password; it never
 * refreshes the app's session, since that would rotate the app's refresh
 * token out from under it.
 */
export function connectPage(cfg: { supabaseUrl: string; anonKey: string }, language: UiLanguage = 'en'): Response {
  const w = pageWords(language, 'connect');
  const info = languageChoices().find((l) => l.code === language)!;
  const h = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const scopeKey: Record<Scope, keyof typeof w.scopes> = { 'read:published': 'readPublished', read: 'read', review: 'review', release: 'release', external_values: 'externalValues' };
  const scopeText = Object.fromEntries(SCOPES.map((s) => [s, w.scopes[scopeKey[s]]]));
  const config = JSON.stringify({ ...cfg, scopes: SCOPES, scopeText, words: w, english: language === 'en' }).replace(/</g, '\\u003c');
  const choices = languageChoices().map((l) => `<option value="${l.code}"${l.code === language ? ' selected' : ''}>${h(l.name)}</option>`).join('');
  const html = `<!doctype html>
<html lang="${info.locale}" dir="${info.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${h(w.pageTitle)}</title>
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
.pick { text-align: end; margin: 0; } .pick select { width: auto; min-height: 48px; border: 0; background: none; color: var(--muted); }
</style>
</head>
<body>
<main>
  <p class="pick"><label>🌐 <select id="ui-lang" aria-label="${h(w.language)}">${choices}</select></label></p>
  <h1>${h(w.title)}</h1>
  <p class="muted">${h(w.intro)}</p>
  <div id="out" role="status" aria-live="polite"></div>

  <section id="signin" hidden>
    <h2>${h(w.signIn)}</h2>
    <p class="muted">${h(w.signInSub)}</p>
    <form id="signin-form">
      <label for="email">${h(w.email)}</label><input id="email" type="email" autocomplete="email" required>
      <label for="password">${h(w.password)}</label><input id="password" type="password" autocomplete="current-password" required>
      <div class="row"><button class="primary" type="submit">${h(w.signIn)}</button></div>
    </form>
  </section>

  <section id="request" hidden>
    <h2>${h(w.requestTitle)}</h2>
    <form id="code-form" hidden>
      <label for="code">${h(w.codeLabel)}</label><input id="code" type="text" autocomplete="off" placeholder="BCDF-GHJK" required>
      <div class="row"><button class="primary" type="submit">${h(w.continue)}</button></div>
    </form>
    <div id="request-body"></div>
  </section>

  <section id="create" hidden>
    <h2>${h(w.makeTitle)}</h2>
    <p class="muted">${h(w.makeSub)}</p>
    <div id="create-body"></div>
  </section>

  <section id="tokens" hidden>
    <h2>${h(w.yourTokens)}</h2>
    <div id="tokens-body"></div>
  </section>
  <p class="muted" id="who"></p>
</main>
<script>
const CFG = ${config};
const W = CFG.words;
const T = (key, values) => String(W[key]).replace(/\\{\\{\\s*(\\w+)\\s*\\}\\}/g, (m, k) => (values && k in values ? values[k] : m));
$('ui-lang').addEventListener('change', (e) => { const u = new URL(location.href); u.searchParams.set('lang', e.target.value); location.replace(u); });
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
  if (res.status === 401) { jwt = null; sessionStorage.removeItem('lq-connect-session'); show(); throw new Error(T('signInAgain')); }
  if (!res.ok) throw new Error((CFG.english && body.error) || T('somethingWrong', { status: res.status }));
  return body;
}

$('signin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  say(T('signingIn'));
  try {
    const res = await fetch(CFG.supabaseUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { apikey: CFG.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value })
    });
    const s = await res.json();
    if (!res.ok || !s.access_token) throw new Error((CFG.english && (s.error_description || s.msg)) || T('wrongPassword'));
    sessionStorage.setItem('lq-connect-session', JSON.stringify({ access_token: s.access_token, expires_at: s.expires_at, user: s.user }));
    say('');
    await start();
  } catch (err) { say(err.message, 'red'); }
});

function scopeBoxes(name, allowed, checked) {
  return allowed.map((s) => '<label class="check"><input type="checkbox" name="' + name + '" value="' + esc(s) + '"' + (checked.includes(s) ? ' checked' : '') + '><span><b>' + esc(s) + '</b><br><small>' + esc(CFG.scopeText[s]) + '</small></span></label>').join('');
}

function orgSelect(id, selected) {
  return '<label for="' + id + '">' + esc(T('organization')) + '</label><select id="' + id + '">' + orgs.map((o) => '<option value="' + esc(o.orgId) + '"' + (o.orgId === selected ? ' selected' : '') + '>' + esc(o.name || o.orgId) + '</option>').join('') + '</select>';
}

function languageBoxes(prefix, orgId) {
  const org = orgs.find((o) => o.orgId === orgId);
  if (!org) return '';
  return '<label class="check"><input type="checkbox" id="' + prefix + '-all" checked><span><b>' + esc(T('everyLanguage')) + '</b><br><small>' + esc(T('includingLater')) + '</small></span></label>' +
    '<div id="' + prefix + '-langs" hidden>' + org.languages.map((l) => '<label class="check"><input type="checkbox" name="' + prefix + '-lang" value="' + esc(l.languageId) + '"><span>' + esc(l.name) + (l.mayReview ? '' : ' <small>' + esc(T('cannotReview')) + '</small>') + '</span></label>').join('') + '</div>';
}

function wireLanguages(prefix) {
  const all = $(prefix + '-all');
  if (all) all.addEventListener('change', () => { $(prefix + '-langs').hidden = all.checked; });
}

function expirySelect(id) {
  return '<label for="' + id + '">' + esc(T('expires')) + '</label><select id="' + id + '"><option value="">' + esc(T('never')) + '</option><option value="30">' + esc(T('in30')) + '</option><option value="90">' + esc(T('in90')) + '</option><option value="365">' + esc(T('inYear')) + '</option></select>';
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
  return '<p><b>' + esc(T('copyNow')) + '</b> ' + esc(T('notShownAgain')) + '</p><pre id="secret">' + esc(secret) + '</pre>' +
    '<div class="row"><button type="button" id="copy">' + esc(T('copyToken')) + '</button></div>' +
    '<p class="muted" style="margin-top:16px">' + esc(T('tryIt')) + '</p><pre>curl -H "Authorization: Bearer ' + esc(secret) + '" ' + esc(base) + '/languages</pre>' +
    '<p class="muted">' + esc(T('mcp')) + '</p><pre>' + esc(JSON.stringify({ mcpServers: { langquest: { type: 'http', url: base + '/mcp', headers: { Authorization: 'Bearer ' + secret } } } }, null, 2)) + '</pre>';
}

function renderCreate() {
  const first = orgs[0] ? orgs[0].orgId : '';
  $('create-body').innerHTML = '<form id="create-form"><label for="t-name">' + esc(T('name')) + '</label><input id="t-name" type="text" maxlength="120" required placeholder="' + esc(T('namePlaceholder')) + '">' +
    orgSelect('t-org', first) + '<label>' + esc(T('whatItMayDo')) + '</label>' + scopeBoxes('t-scope', CFG.scopes, ['read:published']) +
    '<label>' + esc(T('languages')) + '</label><div id="t-langs-wrap">' + languageBoxes('t', first) + '</div>' + expirySelect('t-exp') +
    '<div class="row"><button class="primary" type="submit">' + esc(T('makeToken')) + '</button></div></form><div id="create-result"></div>';
  wireLanguages('t');
  $('t-org').addEventListener('change', () => { $('t-langs-wrap').innerHTML = languageBoxes('t', $('t-org').value); wireLanguages('t'); });
  $('create-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const out = await api('/tokens', { method: 'POST', body: JSON.stringify({ name: $('t-name').value, ...readSpec('t', 't-org', 't-exp') }) });
      $('create-result').innerHTML = '<div class="notice green">' + esc(T('tokenMade')) + '</div>' + howToUse(out.token);
      $('copy').addEventListener('click', () => navigator.clipboard.writeText(out.token).then(() => say(T('copied'), 'green')));
      await renderTokens();
    } catch (err) { say(err.message, 'red'); }
  });
}

async function renderTokens() {
  const list = await api('/tokens');
  const orgName = (id) => (orgs.find((o) => o.orgId === id) || {}).name || id;
  const langName = (orgId, id) => ((orgs.find((o) => o.orgId === orgId) || { languages: [] }).languages.find((l) => l.languageId === id) || {}).name || id;
  const when = (t) => t ? new Date(t).toLocaleString(document.documentElement.lang) : T('neverUsed');
  $('tokens-body').innerHTML = list.length === 0 ? '<p class="muted">' + esc(T('noneYet')) + '</p>' : list.map((t) => {
    const state = t.revokedAt ? T('revokedAt', { when: when(t.revokedAt) }) : t.expiresAt && Date.parse(t.expiresAt) < Date.now() ? T('expired') : T('active');
    return '<div class="token"><b>' + esc(t.name) + '</b> <span class="tag">' + esc(state) + '</span>' + (t.clientName ? ' <span class="tag">' + esc(T('askedBy', { app: t.clientName })) + '</span>' : '') +
      '<p class="muted">' + esc(orgName(t.orgId)) + ' · ' + (t.languageIds ? t.languageIds.map((l) => esc(langName(t.orgId, l))).join(', ') : esc(T('everyLanguageShort'))) + '</p>' +
      '<p>' + t.scopes.map((s) => '<span class="tag">' + esc(s) + '</span>').join('') + '</p>' +
      '<small>' + esc(t.expiresAt ? T('madeExpires', { when: when(t.createdAt), used: when(t.lastUsedAt), expires: when(t.expiresAt) }) : T('made', { when: when(t.createdAt), used: when(t.lastUsedAt) })) + '</small>' +
      (t.revokedAt ? '' : '<div class="row"><button type="button" class="danger" data-revoke="' + esc(t.id) + '">' + esc(T('revoke')) + '</button></div>') + '</div>';
  }).join('');
  document.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(T('revokeConfirm'))) return;
    try { await api('/tokens/' + encodeURIComponent(b.dataset.revoke) + '/revoke', { method: 'POST' }); say(T('revoked'), 'green'); await renderTokens(); }
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
    $('request-body').innerHTML = '<p class="notice">' + esc(T(g.state === 'approved' ? 'stateApproved' : g.state === 'denied' ? 'stateDenied' : g.state === 'expired' ? 'stateExpired' : 'stateOther')) + '</p>';
    return;
  }
  const org = g.requestedOrgId && orgs.some((o) => o.orgId === g.requestedOrgId) ? g.requestedOrgId : (orgs[0] || {}).orgId;
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(g.createdAt)) / 60000));
  $('request-body').innerHTML = '<p class="code">' + esc(g.userCode) + '</p><p>' + esc(T('checkCode')) + ' ' + esc(mins < 1 ? T('askedJustNow') : T(new Intl.PluralRules(document.documentElement.lang).select(mins) === 'one' ? 'askedMinutes_one' : 'askedMinutes_other', { count: mins })) + '</p>' +
    '<p class="notice">' + esc(T('approveOnly')) + '</p>' +
    '<p><b>' + esc(g.clientName) + '</b> <span class="tag">' + esc(T('unverified')) + '</span></p><p class="muted">' + esc(T('selfNamed')) + '</p>' +
    '<form id="approve-form">' + orgSelect('d-org', org) + '<label>' + esc(T('itAsks')) + '</label>' + scopeBoxes('d-scope', g.requestedScopes, g.requestedScopes.filter((s) => s.startsWith('read'))) +
    '<p class="muted">' + esc(T('writesUnticked')) + '</p><label>' + esc(T('languages')) + '</label><div id="d-langs-wrap">' + languageBoxes('d', org) + '</div>' + expirySelect('d-exp') +
    '<div class="row"><button class="primary" type="submit">' + esc(T('approve')) + '</button><button type="button" id="deny">' + esc(T('deny')) + '</button></div></form>';
  wireLanguages('d');
  $('d-org').addEventListener('change', () => { $('d-langs-wrap').innerHTML = languageBoxes('d', $('d-org').value); wireLanguages('d'); });
  $('deny').addEventListener('click', async () => {
    try { await api('/device/' + encodeURIComponent(code), { method: 'POST', body: JSON.stringify({ decision: 'deny' }) }); $('request-body').innerHTML = '<p class="notice">' + esc(T('denied')) + '</p>'; }
    catch (err) { say(err.message, 'red'); }
  });
  $('approve-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/device/' + encodeURIComponent(code), { method: 'POST', body: JSON.stringify({ decision: 'approve', name: g.clientName, ...readSpec('d', 'd-org', 'd-exp') }) });
      $('request-body').innerHTML = '<p class="notice green">' + esc(T('approved', { app: g.clientName })) + '</p>';
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
  if (s.user && s.user.email) $('who').textContent = T('signedInAs', { email: s.user.email });
  try {
    orgs = await api('/orgs');
    if (orgs.length === 0) { say(T('noOrganization'), 'red'); return; }
    const code = new URLSearchParams(location.search).get('code');
    await renderRequest(code);
    renderCreate();
    await renderTokens();
  } catch (err) { say(err.message, 'red'); }
}

if (!CFG.anonKey) say(T('notConfigured'), 'red');
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
