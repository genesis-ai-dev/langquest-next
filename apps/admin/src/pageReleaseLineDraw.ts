/**
 * Draws the line of merges at the top of the Releases page (pageReleaseLine.ts
 * has the look, the place and the pure parts). It reads /ops/api/timeline
 * when that page opens (sources/timeline.ts), each Linear issue's title and
 * report time through the app Worker (issue-info), and the page's own
 * Releases and Pipeline parts for migrations and store review.
 *
 * Everything is drawn in its own element, #rline, outside the parts the page
 * redraws, so a zoom, a scroll and a chosen change stay while the rest of the
 * page reads again. Plain JavaScript inside page.ts's script; everything shown
 * is escaped; places and sizes are set from here (data-box), as the page
 * allows no style attribute. Nothing shows on hover: a tap chooses a change.
 */

/** Uses the page's helpers ($, esc, num, api, post, redraw, view, results, okData, askTalk, outLink, safeLink). */
export const RLINE_SCRIPT = String.raw`
const RL_PR_URL = 'https://github.com/genesis-ai-dev/langquest-next/pull/';
const RL_LINEAR = 'https://linear.app/frontierrandd/issue/';
const RL_DAY = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const RL_SHORT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const RL_TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const RL_HOUR = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
const rlWhen = (t) => RL_SHORT.format(new Date(t)) + ', ' + RL_TIME.format(new Date(t));
const RL_SVG = {
  app: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4.2" y="1.5" width="7.6" height="13" rx="1.8"/><path d="M7 12.2h2"/></svg>',
  ui: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="1.8" y="2.5" width="12.4" height="11" rx="2"/><path d="M1.8 6h12.4M5 9h3M5 11h5"/></svg>',
  dashboard: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2.5 13.5v-4M6.2 13.5V6M9.8 13.5V8.5M13.5 13.5v-11"/></svg>',
  backend: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><ellipse cx="8" cy="3.8" rx="5.2" ry="2"/><path d="M2.8 3.8v8.4c0 1.1 2.3 2 5.2 2s5.2-.9 5.2-2V3.8M2.8 8c0 1.1 2.3 2 5.2 2s5.2-.9 5.2-2"/></svg>',
  videos: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.6v10.8c0 .6.6.9 1.1.6l8.3-5.4a.7.7 0 0 0 0-1.2L5.6 2c-.5-.3-1.1 0-1.1.6z"/></svg>',
  jobs: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="10" height="8" rx="2"/><path d="M8 2v3M6 9h.01M10 9h.01"/></svg>',
  tests: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9"><path d="m3 8.5 3 3 7-7"/></svg>',
  docs: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 1.8h5.5L12.5 5v9.2H4z"/><path d="M6.3 8h4M6.3 10.8h4"/></svg>',
  thread: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.5 9.3 6.7 14.5 8 9.3 9.3 8 14.5 6.7 9.3 1.5 8 6.7 6.7z"/></svg>',
  person: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="5.2" r="3"/><path d="M2.5 14c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6z"/></svg>'
};
const RL_AREAS = [['app', 'App'], ['ui', 'UI/UX'], ['dashboard', 'Dashboard'], ['backend', 'Backend'], ['videos', 'Videos'], ['jobs', 'Agents and jobs'], ['tests', 'Tests'], ['docs', 'Docs']];
const RL_AN = Object.fromEntries(RL_AREAS);
const RL_WHERE = { live: 'On phones', onway: 'On its way', none: 'No phone change' };
const rlIcon = (a, small) => '<span class="rl-ai rl-a-' + a + (small ? ' rl-small' : '') + '" aria-hidden="true">' + RL_SVG[a] + '</span>';
const rlWhoKey = (w) => (w.kind === 'thread' ? 'thread' : w.kind + ':' + w.name);
const rlSbLabel = (sb) => 'Build ' + [sb.ios, sb.android].filter(Boolean).join(' · ');
const rlIssueKind = (m) => (!m.is ? 'none' : m.is.some((s) => s.r === 'f') ? 'fixes' : 'part');

/** The answer, its merges oldest first (and by number), the failure kinds, and each Linear issue's title, report time and state. */
let RLD = null, RLM = [], RLK = [], RLI = {}, RLBYN = new Map(), rlDevs = [];
let rlNow = 0, rlT0 = 0, rlT1 = 0, rlSelN = null, rlPx = 0, rlErrOn = true;
let rlErrSel = new Set(), rlErrSeen = new Set(), rlErrMap = new Map(), rlErrMax = 1, rlKindFirst = new Map();
let rlVis = [], rlLanes = new Map(), rlLaneCount = 1, rlReadAt = 0, rlBusy = false, rlShown = false;
const rlAsked = new Set();
const RLF = { q: '', areas: new Set(), subs: new Set(), who: new Set(), where: new Set(), how: new Set(), issue: new Set(), db: false };

function rlAv(w) {
  const cls = w.kind === 'thread' ? 'thread' : w.kind === 'agent' ? 'agent' : w.kind === 'bot' ? 'bot' : rlDevs.indexOf(w.name) % 2 ? 'dev2' : '';
  return '<span class="rl-av ' + cls + '">' + RL_SVG[w.kind === 'thread' ? 'thread' : w.kind === 'dev' ? 'person' : 'jobs'] + '</span>';
}
/** Each element's place and size from its data-box ("left,top,width,height"; a blank leaves it). */
function rlBoxes(root) {
  for (const el of root.querySelectorAll('[data-box]')) {
    const b = el.dataset.box.split(',');
    if (b[0] !== '') el.style.left = b[0];
    if (b[1]) el.style.top = b[1] + 'px';
    if (b[2]) el.style.width = b[2] + 'px';
    if (b[3]) el.style.height = b[3] + 'px';
  }
}
const rlPxBox = (l, t, w, h) => ' data-box="' + l.toFixed(1) + 'px,' + (t === undefined ? '' : t) + ',' + (w || '') + ',' + (h || '') + '"';

// ---- reading -------------------------------------------------------------------------------------
/** The page's route: the line shows on the Releases page only, and reads its merges when it opens. */
function rlineRoute(v) {
  const on = v.name === 'group' && v.id === 'releases';
  $('rline').hidden = !on;
  rlPop(null);
  if (!on) return;
  if (!RLD || Date.now() - rlReadAt > 300000) rlineLoad(false);
  if (RLD && !rlShown) rlStart();
}
/** With the page's load: only while the Releases page shows; elsewhere a Refresh makes it read again when it opens. */
async function rlineLoad(fresh) {
  const v = view();
  if (v.name !== 'group' || v.id !== 'releases') { if (fresh) rlReadAt = 0; return; }
  if (rlBusy) return;
  rlBusy = true;
  try {
    const s = await api('/ops/api/timeline' + (fresh ? '?fresh=1' : ''));
    if (s && s.state === 'ok' && s.data) rlSet(s.data);
    else rlFail(s && s.state === 'off' ? s.setup : (s && s.error) || 'No answer.');
  } catch (err) {
    if (err.message !== 'Signed out' && err.message !== 'Not an admin') rlFail(err.message);
  } finally { rlBusy = false; }
}
function rlFail(why) {
  if (RLD) { $('rl-say').textContent = rlSaid() + ' The last read failed: ' + why; return; }
  $('rl-say').textContent = 'Could not read the merges.';
  $('rl-can').innerHTML = '<div class="rl-loading">' + esc('Could not read the merges: ' + why) + '</div>';
}
/** After the page's load: the tiles and the chosen change, which use the Releases and Pipeline parts. */
function rlineRedraw() { if (RLD && rlShown && !$('rline').hidden) { rlDrawTiles(); rlDrawDetail(); } }
/** Claude's answers came, or a question was sent: the chosen change's box shows them. */
function rlineAsk() { if (RLD && rlShown && !$('rline').hidden) rlDrawDetail(); }

function rlSet(d) {
  const keepLeft = RLD && rlShown && rlPx ? rlTX($('rl-view').scrollLeft) : null;
  RLD = d; rlReadAt = Date.now(); rlNow = Date.parse(d.now) || Date.now();
  RLM = (d.merges || []).filter((m) => m && m.n && m.t && m.w).sort((p, q) => Date.parse(p.t) - Date.parse(q.t));
  RLBYN = new Map(RLM.map((m) => [m.n, m]));
  rlDevs = [...new Set(RLM.filter((m) => m.w.kind === 'dev').map((m) => m.w.name))];
  RLM.forEach((m, k) => { m.k = k; m.tt = Date.parse(m.t); m.ar = (m.ar || []).filter((x) => RL_AN[x[0]]); m.a0 = m.ar.length ? m.ar[0][0] : 'docs'; m.rl = rlWhere(m); });
  rlIssuesIn();
  RLK = d.errors || [];
  for (const k of RLK) if (!rlErrSeen.has(k.id)) { rlErrSeen.add(k.id); rlErrSel.add(k.id); }
  const h0 = Date.parse(d.from);
  rlKindFirst = new Map(RLK.map((k) => [k.id, Math.min(...k.s.map((p) => h0 + p[0] * RL_H))]));
  const first = new Date(RLM.length ? RLM[0].tt : h0);
  first.setHours(0, 0, 0, 0);
  rlT0 = first.getTime(); rlT1 = rlNow + 4 * RL_H;
  if (rlSelN !== null && !RLBYN.has(rlSelN)) rlSelN = null;
  rlSumErr(); rlDrawHead(); rlDrawAreas(); rlDrawMore(); rlDrawErrPop();
  rlApply(false);
  if (!rlShown) rlStart();
  else { rlSetPx(rlPx, 0, keepLeft); rlDrawMini(); rlDrawDetail(); }
  rlAskIssues();
}
/** The first drawing, once the line is on screen (a hidden element has no width): one day, ending at the newest merge. */
function rlStart() {
  const v = $('rl-view');
  if (!RLD || $('rline').hidden || !v.clientWidth) return;
  rlShown = true;
  if (!RLM.length) { $('rl-can').innerHTML = '<div class="rl-loading">No merges in these days.</div>'; return; }
  if (rlSelN === null) rlSelN = RLM[RLM.length - 1].n;
  rlPreset(v.clientWidth < 600 ? '6' : '24', false);
  rlRender(); rlDrawMini();
  const last = RLM[RLM.length - 1];
  v.scrollLeft = Math.max(rlX(last.tt) - 16 + rlG().cw, rlX(rlNow)) + 30 - v.clientWidth;
  rlSync(); rlDrawTicks(); rlDrawDetail();
}
/** Each issue's title on its merges, and each merge's line, from what Linear said. */
function rlIssuesIn() {
  for (const m of RLM) {
    for (const s of m.is || []) if (RLI[s.id]) s.title = RLI[s.id].title;
    m.L = rlLife(m, RLI, rlNow);
  }
}
/** Each issue's title, report time and state, 100 at a time, once a page load; without them the line starts at the work. */
async function rlAskIssues() {
  const want = [...new Set(RLM.flatMap((m) => (m.is || []).map((s) => s.id)))].filter((id) => !rlAsked.has(id));
  if (!want.length) return;
  for (const id of want) rlAsked.add(id);
  let got = false;
  for (let j = 0; j < want.length; j += 100) {
    const part = want.slice(j, j + 100);
    try { const b = await post({ kind: 'issue-info', issues: part }); for (const x of b.issues || []) { RLI[x.issue] = x; got = true; } }
    catch { for (const id of part) rlAsked.delete(id); }
  }
  if (!got) return;
  rlIssuesIn(); rlApply(false);
  if (rlShown) { rlRender(); rlDrawDetail(); }
}

// ---- the head: what it says and where things are now ---------------------------------------------
function rlSaid() {
  if (!RLM.length) return 'No merges in these days.';
  const app = RLM.filter((m) => m.app).length, onway = RLM.filter((m) => m.rl === 'onway').length;
  return RLM.length + ' changes merged from ' + RL_SHORT.format(new Date(RLM[0].tt)) + ' to ' + RL_SHORT.format(new Date(RLM[RLM.length - 1].tt)) + '. ' + app +
    ' changed the phone app' + (onway ? '; ' + (onway === 1 ? 'one is' : onway + ' are') + ' on the way to phones.' : ', and a phone has run each of them.');
}
function rlDrawHead() {
  const notes = (RLD.notes || []).map((n) => String(n).slice(0, 160));
  $('rl-say').textContent = rlSaid() + (notes.length ? ' Not read: ' + notes.join('; ') + '.' : '');
  rlDrawTiles();
}
/** A build's place in its store, from the page's Pipeline part: null when it is not there. */
function rlStoreState(os, build) {
  const p = okData(results, 'pipeline'), lane = p && (p.lanes || []).find((l) => l.id === os);
  for (const st of (lane && lane.stages) || []) for (const c of st.cards || []) {
    if (String(c.build) !== String(build)) continue;
    return { live: st.id === 'live', text: st.id === 'live' ? (os === 'ios' ? 'Live in the App Store' : 'Live on Google Play') : String(c.state).charAt(0).toUpperCase() + String(c.state).slice(1) };
  }
  return null;
}
function rlDrawTiles() {
  if (!RLM.length) { $('rl-now').innerHTML = ''; return; }
  const tile = (n, pip, k, v, s, go) => '<button type="button" class="rl-tile" data-rl-go="' + n + '"><span class="rl-k"><span class="rl-pip ' + pip + '"></span>' + esc(k) + '</span><span class="rl-v">' + esc(v) + '</span><span class="rl-s' + (go ? ' rl-go' : '') + '">' + esc(s) + '</span></button>';
  const web = RLD.web, served = web && web.n ? RLBYN.get(web.n) : null;
  const newer = served ? RLM.filter((m) => m.tt > served.tt).length : 0;
  let h = served ? tile(served.n, 'live', 'Web app', 'PR ' + served.n, newer ? newer + ' newer merge' + (newer === 1 ? ' is' : 's are') + ' not on it yet' : 'The newest merge', newer > 0)
    : '<div class="rl-tile rl-grp"><span class="rl-k"><span class="rl-pip"></span>Web app</span><span class="rl-v">' + (web ? 'Commit ' + esc(web.sha.slice(0, 7)) : 'Not read') + '</span><span class="rl-s">' + (web ? 'Not a merge on this line' : 'It did not say its commit') + '</span></div>';
  const phone = [...RLM].reverse().find((m) => m.rl === 'live'), onway = [...RLM].reverse().find((m) => m.rl === 'onway');
  if (phone || onway) {
    h += '<div class="rl-tile rl-grp" role="group" aria-label="Phones"><span class="rl-k"><span class="rl-pip ' + (phone ? 'live' : 'onway') + '"></span>Phones</span>' +
      (phone ? '<button type="button" class="rl-tb rl-v" data-rl-go="' + phone.n + '">PR ' + phone.n + ' is the newest they run</button>' : '<span class="rl-v">None ran a change here yet</span>') +
      (onway ? '<button type="button" class="rl-tb rl-s rl-go" data-rl-go="' + onway.n + '">PR ' + onway.n + ' is on its way</button>' : '<span class="rl-s">Nothing on its way</span>') + '</div>';
  }
  const store = [...RLM].reverse().find((m) => m.sb);
  if (store) {
    const st = rlStoreState('ios', store.sb.ios) || rlStoreState('android', store.sb.android);
    h += tile(store.n, st && st.live ? 'live' : 'onway', 'Newest store build', rlSbLabel(store.sb), st ? st.text : 'From PR ' + store.n + ', ' + RL_SHORT.format(new Date(store.tt)));
  }
  $('rl-now').innerHTML = h;
}

// ---- filters ---------------------------------------------------------------------------------------
function rlApply(redrawIt) {
  rlVis = RLM.filter((m) => rlMatches(m, RLF, rlWhoKey));
  const packed = rlPack(rlVis.map((m) => ({ id: m.k, L: m.L })));
  rlLanes = packed.rows; rlLaneCount = packed.count;
  rlDrawSubs(); rlDrawSum();
  if (redrawIt === false || !rlShown) return;
  rlRender(); rlDrawMini(); rlZoomLab();
  // When nothing that matches is on screen, go to the newest change that matches.
  const v = $('rl-view'), a = rlTX(v.scrollLeft), b = rlTX(v.scrollLeft + v.clientWidth);
  if (rlVis.length && !rlVis.some((m) => m.tt >= a && m.tt <= b)) { v.scrollLeft = rlX(rlVis[rlVis.length - 1].tt) - v.clientWidth * 0.7; rlSync(); rlDrawTicks(); }
}
function rlDrawAreas() {
  $('rl-areas').innerHTML = RL_AREAS.map(([a, name]) => '<button type="button" class="rl-chip rl-a-' + a + '" data-rl-a="' + a + '" aria-pressed="' + RLF.areas.has(a) + '">' + rlIcon(a) + esc(name) +
    ' <small>' + RLM.filter((m) => m.ar.some((x) => x[0] === a)).length + '</small></button>').join('');
}
function rlDrawSubs() {
  const el = $('rl-subs');
  if (!RLF.areas.size) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  let h = '<span class="rl-lab">Parts:</span>';
  for (const [a] of RL_AREAS) {
    if (!RLF.areas.has(a)) continue;
    const counts = {};
    for (const m of RLM) for (const [aa, subs] of m.ar) if (aa === a) for (const s of subs) counts[s] = (counts[s] || 0) + 1;
    for (const [s, n] of Object.entries(counts).sort((x, y) => y[1] - x[1])) {
      const k = a + '/' + s;
      h += '<button type="button" class="rl-chip rl-sub rl-a-' + a + '" data-rl-s="' + esc(k) + '" aria-pressed="' + RLF.subs.has(k) + '">' + esc(s) + ' <small>' + n + '</small></button>';
    }
  }
  el.innerHTML = h;
}
function rlMoreGroups() {
  const who = new Map();
  for (const m of RLM) { const k = rlWhoKey(m.w); if (!who.has(k)) who.set(k, m.w.kind === 'thread' ? 'Claude threads' : m.w.name); }
  const order = (k) => (k === 'thread' ? 0 : k.startsWith('agent:') ? 1 : k.startsWith('dev:') ? 2 : 3);
  return [
    ['who', 'Who merged it', [...who].sort((p, q) => order(p[0]) - order(q[0]) || p[1].localeCompare(q[1]))],
    ['where', 'Where it is', [['live', 'On phones'], ['onway', 'On its way'], ['none', 'No phone change']]],
    ['how', 'How it reached phones', [['store', 'New store build'], ['ota', 'Update over the air']]],
    ['issue', 'Issue', [['fixes', 'Fixes a Linear issue'], ['part', 'Part of an issue'], ['none', 'No issue named']]]
  ];
}
function rlMoreCount(g, v) {
  return RLM.filter((m) => (g === 'who' ? rlWhoKey(m.w) === v : g === 'where' ? m.rl === v : g === 'how' ? m.app && (m.sb ? 'store' : 'ota') === v : rlIssueKind(m) === v)).length;
}
function rlDrawMore() {
  let h = '';
  for (const [g, title, opts] of rlMoreGroups()) h += '<h4>' + esc(title) + '</h4><div class="rl-chips">' + opts.map(([v, l]) => '<button type="button" class="rl-chip rl-plain" data-rl-g="' + g + '" data-rl-v="' + esc(v) + '" aria-pressed="' + RLF[g].has(v) + '">' + esc(l) + ' <small>' + rlMoreCount(g, v) + '</small></button>').join('') + '</div>';
  h += '<h4>Database</h4><div class="rl-chips"><button type="button" class="rl-chip rl-plain" data-rl-g="db" aria-pressed="' + RLF.db + '">Changes the database <small>' + RLM.filter((m) => m.mg).length + '</small></button></div>';
  $('rl-more').innerHTML = h;
  const n = ['who', 'where', 'how', 'issue'].reduce((s, g) => s + RLF[g].size, 0) + (RLF.db ? 1 : 0);
  $('rl-morebtn').innerHTML = 'More filters' + (n ? ' <span class="rl-badge">' + n + '</span>' : '');
}
function rlDrawSum() {
  const any = RLF.q || RLF.areas.size || RLF.subs.size || RLF.db || ['who', 'where', 'how', 'issue'].some((g) => RLF[g].size);
  $('rl-sum').innerHTML = any ? '<span>Showing ' + rlVis.length + ' of ' + RLM.length + ' changes</span><button type="button" data-rl-clear="1">Clear filters</button>'
    : '<span>' + RLM.length + ' changes. Choose an area to see only its changes.</span>';
}
/** Opens one popover under its button (or closes them all), inside the window. */
function rlPop(btn, el) {
  const open = !!(el && el.hidden);
  for (const p of [$('rl-more'), $('rl-errpop')]) p.hidden = true;
  for (const b of [$('rl-morebtn'), $('rl-errbtn')]) b.setAttribute('aria-expanded', 'false');
  if (!open) return;
  el.hidden = false; btn.setAttribute('aria-expanded', 'true');
  rlPopPlace(btn, el);
}
/** Keeps an open popover at its button while the page scrolls; it closes once its button leaves the window. */
function rlPopPlace(btn, el) {
  const r = btn.getBoundingClientRect(), w = el.offsetWidth, h = el.offsetHeight;
  if (r.bottom < 0 || r.top > innerHeight) { rlPop(null); return; }
  el.style.left = Math.max(16, Math.min(r.left, document.documentElement.clientWidth - w - 16)) + 'px';
  el.style.top = (r.bottom + 6 + h > innerHeight - 8 && r.top - 6 - h > 8 ? r.top - 6 - h : r.bottom + 6) + 'px';
}

// ---- failures ----------------------------------------------------------------------------------------
function rlSumErr() {
  rlErrMap = rlErrHours(RLK, rlErrSel, Date.parse(RLD.from));
  rlErrMax = Math.max(1, ...rlErrMap.values());
  const total = Math.round([...rlErrMap.values()].reduce((p, q) => p + q, 0)), chosen = RLK.filter((k) => rlErrSel.has(k.id)).length;
  $('rl-errlab').textContent = !RLK.length ? 'No failures in these days' : chosen === RLK.length ? 'Failures each hour (' + num(total) + ')' : chosen + ' of ' + RLK.length + ' kinds of failure (' + num(total) + ')';
}
function rlDrawErrPop() {
  if (!RLK.length) { $('rl-errpop').innerHTML = '<p class="rl-note">No failures in these days.</p>'; return; }
  const top = Math.max(...RLK.map((k) => k.total));
  let h = '<h4>Failures on the line <span><button type="button" data-rl-all="1">All</button><button type="button" data-rl-all="0">None</button></span></h4>';
  for (const g of [...new Set(RLK.map((k) => k.group))]) {
    h += '<h4>' + esc(g) + ' <span><button type="button" data-rl-ga="' + esc(g) + '" data-rl-on="1">All</button><button type="button" data-rl-ga="' + esc(g) + '" data-rl-on="0">None</button></span></h4>';
    for (const k of RLK.filter((x) => x.group === g)) h += '<label class="rl-ek"><input type="checkbox" data-rl-k="' + esc(k.id) + '"' + (rlErrSel.has(k.id) ? ' checked' : '') + '><span>' + esc(k.label) + '</span><i' + rlPxBox(0, undefined, Math.max(3, Math.round((k.total / top) * 56))).replace('0.0px', '') + '></i><b>' + num(Math.round(k.total)) + '</b></label>';
  }
  $('rl-errpop').innerHTML = h;
  rlBoxes($('rl-errpop'));
}
const rlErrIn = (a, b) => { let s = 0; for (const [t, v] of rlErrMap) if (t >= a && t < b) s += v; return Math.round(s); };
function rlErrChanged() { rlSumErr(); rlRender(); rlDrawMini(); rlDrawDetail(); }

// ---- zoom --------------------------------------------------------------------------------------------
const rlX = (t) => 24 + ((t - rlT0) / RL_H) * rlPx;
const rlTX = (x) => rlT0 + ((x - 24) / rlPx) * RL_H;
/** Sizes by zoom: full cards from 30 pixels an hour, small ones from 9, below that only dots and "Zoom in". */
function rlG() {
  const narrow = $('rl-view').clientWidth < 600, tier = rlPx >= 30 ? 'full' : rlPx >= 9 ? 'compact' : 'none';
  const g = tier === 'compact' ? { cw: narrow ? 190 : 220, ch: 70, rows: 4, pitch: 78 } : { cw: narrow ? 260 : 316, ch: 158, rows: 2, pitch: 168 };
  return Object.assign(g, { tier, top: 30, axis: 398, laneTop: 416, laneH: 196, h: 630, padR: tier === 'none' ? 30 : g.cw + 40 });
}
const rlMinPx = () => ($('rl-view').clientWidth - 60) / ((rlT1 - rlT0) / RL_H);
const rlMaxPx = () => rlMaxZoom(rlVis.map((m) => m.tt), $('rl-view').clientWidth < 600 ? 260 : 316, (rlT1 - rlT0) / RL_H);
/** Zooms to v pixels an hour; the time at ax (pixels from the view's left; its middle when not given) stays there, or comes there (at). */
function rlSetPx(v, ax, at) {
  const view = $('rl-view');
  v = Math.max(rlMinPx(), Math.min(rlMaxPx(), v));
  const x = ax === undefined ? view.clientWidth / 2 : ax;
  const t = at !== undefined && at !== null ? at : rlPx ? rlTX(view.scrollLeft + x) : rlNow;
  rlPx = v;
  rlRender();
  view.scrollLeft = rlX(t) - x;
  rlZoomLab(); rlSync(); rlDrawTicks();
}
function rlPreset(h, keep) {
  const view = $('rl-view'), hours = h === 'all' ? (rlT1 - rlT0) / RL_H : +h;
  if (!keep) { rlPx = Math.max(rlMinPx(), Math.min(rlMaxPx(), (view.clientWidth - 40) / hours)); rlZoomLab(); return; }
  rlSetPx((view.clientWidth - 40) / hours);
  const m = RLBYN.get(rlSelN);
  if (h === 'all') view.scrollLeft = 0;
  else if (m) view.scrollLeft = rlX(m.tt) - view.clientWidth * 0.45;
  rlSync(); rlDrawTicks();
}
/** Zooms around the chosen change: it stays where it is, or comes near the middle. */
function rlZoomTo(v) {
  const view = $('rl-view'), m = RLBYN.get(rlSelN), sx = m ? rlX(m.tt) - view.scrollLeft : -1;
  if (m && sx > 0 && sx < view.clientWidth) { rlSetPx(v, sx); return; }
  rlSetPx(v);
  if (m) { view.scrollLeft = rlX(m.tt) - view.clientWidth * 0.6; rlSync(); rlDrawTicks(); }
}
function rlZoomLab() {
  const w = $('rl-view').clientWidth, hrs = w / rlPx, all = (rlT1 - rlT0) / RL_H;
  const d = Math.round(hrs / 24), mins = Math.max(1, Math.round(hrs * 60));
  $('rl-zlab').textContent = hrs >= 30 ? 'About ' + d + ' day' + (d === 1 ? '' : 's') + ' on screen' : hrs >= 1.5 ? 'About ' + Math.round(hrs) + ' hours on screen' : 'About ' + mins + ' minute' + (mins > 1 ? 's' : '') + ' on screen';
  $('rl-in').disabled = rlPx >= rlMaxPx() * 0.999;
  $('rl-out').disabled = rlPx <= rlMinPx() * 1.001;
  for (const b of $('rl-presets').children) {
    const hh = b.dataset.rlH === 'all' ? all : +b.dataset.rlH;
    b.setAttribute('aria-pressed', String(Math.abs(hrs - hh) / hh < 0.12 || (b.dataset.rlH === 'all' && hrs >= all * 0.95)));
  }
}

// ---- the line ----------------------------------------------------------------------------------------
function rlRender() {
  const g = rlG(), c = $('rl-can'), W = Math.ceil(rlX(rlT1)) + g.padR;
  c.style.width = W + 'px'; c.style.height = g.h + 'px';
  const vis = new Set(rlVis.map((m) => m.k));
  let s = '', html = '';
  // Days: a line at each midnight, and its name where there is room for it.
  const every = Math.max(1, Math.ceil(110 / (24 * rlPx)));
  for (let d = new Date(rlT0), j = 0; d.getTime() < rlT1; j++) {
    const a = d.getTime(), next = new Date(d); next.setDate(next.getDate() + 1);
    const x = rlX(a);
    s += '<line class="rl-dg" x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="0" y2="' + g.h + '"/>';
    if (j % every === 0) {
      const n = rlVis.filter((m) => m.tt >= a && m.tt < next.getTime()).length;
      html += '<div class="rl-day"' + rlPxBox(x) + '><b>' + esc(RL_DAY.format(d)) + '</b>' + (rlPx >= 7 ? ' · ' + n + ' merged' : '') + '</div>';
    }
    d = next;
  }
  // Failures, behind the lines.
  if (rlErrOn && rlErrMap.size) {
    const bucket = rlPx >= 10 ? 1 : rlPx >= 3 ? 3 : 6, bm = new Map();
    for (const [t, v] of rlErrMap) { const b = rlT0 + Math.floor((t - rlT0) / (bucket * RL_H)) * bucket * RL_H; bm.set(b, (bm.get(b) || 0) + v); }
    const max = Math.max(1, ...bm.values()), base = g.h - 10, sc = (base - (g.laneTop - 6)) / max;
    let p = '';
    for (const b of [...bm.keys()].sort((x, y) => x - y)) {
      const x1 = rlX(b).toFixed(1), x2 = rlX(b + bucket * RL_H).toFixed(1), y = (base - bm.get(b) * sc).toFixed(1);
      p += 'M' + x1 + ',' + base + 'L' + x1 + ',' + y + 'L' + x2 + ',' + y + 'L' + x2 + ',' + base + 'Z';
    }
    s += '<path class="rl-err" d="' + p + '"/>';
  }
  // The center line and now.
  const nx = rlX(rlNow).toFixed(1);
  s += '<line class="rl-ax" x1="0" x2="' + W + '" y1="' + g.axis + '" y2="' + g.axis + '"/><line class="rl-nowl" x1="' + nx + '" x2="' + nx + '" y1="' + (g.top - 4) + '" y2="' + (g.h - 6) + '"/><text class="rl-nowt" x="' + (+nx + 6) + '" y="' + (g.axis - 8) + '">Now</text>';
  // Each change's own line under the center line.
  const pitch = Math.max(3, Math.min(9, g.laneH / rlLaneCount)), sw = Math.max(1.8, Math.min(4, pitch * 0.5)), mr = Math.max(2.2, sw * 0.9);
  let spans = '', stems = '';
  for (const m of rlVis) {
    const k = rlLanes.get(m.k);
    if (k === undefined) continue;
    const L = m.L, y = (g.laneTop + 6 + k * pitch).toFixed(1), hot = m.n === rlSelN ? ' rl-hot' : '';
    const fx = (t) => Math.max(rlX(t), -10).toFixed(1);
    const seg = (cls, a, b, width) => (b > a ? '<path class="rl-sp ' + cls + '" d="M' + fx(a) + ',' + y + 'H' + rlX(b).toFixed(1) + '" stroke-width="' + (width || sw).toFixed(2) + '"/>' : '');
    const w = L.w !== null ? L.w : L.m;
    let p = '';
    if (L.r && L.r < w) p += seg('wait', L.r, w, Math.max(1.2, sw * 0.6));
    p += seg('work', w, L.m);
    if (m.app) {
      const ph = [L.i, L.a].filter(Boolean).sort((x1, x2) => x1 - x2);
      if (!ph.length) p += seg('go open', L.m, rlNow);
      else p += seg('go', L.m, ph[0]) + (ph.length === 2 ? seg('one', ph[0], ph[1]) : seg('one open', ph[0], rlNow));
    }
    if (L.r && L.r < w) p += '<circle class="rl-mk r" cx="' + fx(L.r) + '" cy="' + y + '" r="' + mr.toFixed(1) + '"/>';
    p += '<circle class="rl-mk m" cx="' + rlX(L.m).toFixed(1) + '" cy="' + y + '" r="' + (mr + 0.6).toFixed(1) + '"/>';
    if (L.i) p += '<circle class="rl-mk i" cx="' + rlX(L.i).toFixed(1) + '" cy="' + y + '" r="' + (mr + 0.8).toFixed(1) + '"/>';
    if (L.a) p += '<rect class="rl-mk a" x="' + (rlX(L.a) - mr - 0.6).toFixed(1) + '" y="' + (+y - mr - 0.6).toFixed(1) + '" width="' + (2 * mr + 1.2).toFixed(1) + '" height="' + (2 * mr + 1.2).toFixed(1) + '" rx="1.2"/>';
    p += '<path class="rl-hit" d="M' + fx(L.start) + ',' + y + 'H' + rlX(L.end).toFixed(1) + '" stroke-width="' + Math.max(pitch, 6).toFixed(1) + '" data-rl-l="' + m.k + '"/>';
    spans += '<g class="rl-lane' + hot + '" data-rl-lane="' + m.k + '">' + p + '</g>';
    stems += '<line class="rl-stem' + hot + '" data-rl-st="' + m.k + '" x1="' + rlX(m.tt).toFixed(1) + '" x2="' + rlX(m.tt).toFixed(1) + '" y1="' + (g.axis + 7) + '" y2="' + y + '"/>';
  }
  s += stems + spans;
  // Cards: the most telling changes get one first, near their dot; the rest go into a "+N" that zooms in.
  let placed = new Map(), hidden = rlVis.slice();
  if (g.tier !== 'none') {
    const score = (m) => (m.n === rlSelN ? 1000 : 0) + (m.app ? 4 : 0) + (m.sb ? 3 : 0) + (m.is ? 3 : 0) + (m.w.kind === 'agent' ? 3 : 0) + (m.a0 === 'tests' || m.a0 === 'docs' ? -2 : 0) + m.tt / 1e14;
    const r = rlPlace(rlVis, new Map(rlVis.map((m) => [m, rlX(m.tt)])), g.rows, g.cw, score);
    placed = r.placed; hidden = r.hidden.sort((p1, p2) => p1.tt - p2.tt);
  }
  const rowY = (r) => g.axis - 40 - g.ch - r * g.pitch;
  let leads = '';
  for (const m of rlVis) {
    const p = placed.get(m);
    if (!p) continue;
    const x = rlX(m.tt), y = rowY(p.r), cb = y + g.ch, hot = m.n === rlSelN ? ' rl-hot' : '';
    const inside = x >= p.left + 10 && x <= p.left + g.cw - 10;
    leads += '<path class="rl-ld' + hot + '" data-rl-ld="' + m.k + '" d="M' + x.toFixed(1) + ',' + (g.axis - 8) + 'V' + (inside ? cb : cb + 10 + 'L' + (x < p.left ? p.left + 14 : p.left + g.cw - 14).toFixed(1) + ',' + cb) + '"/>';
    html += rlCard(m, g, p.left, y);
  }
  if (g.tier !== 'none') {
    let grp = [];
    const flush = () => {
      if (!grp.length) return;
      const a = grp[0].tt, b = grp[grp.length - 1].tt;
      html += '<button type="button" class="rl-more"' + rlPxBox((rlX(a) + rlX(b)) / 2, g.axis - 35) + ' data-rl-zoom="' + (a + b) / 2 + '" data-rl-za="' + a + '" data-rl-zb="' + b + '" aria-label="' + grp.length + ' more changes: zoom in">+' + grp.length + '</button>';
      grp = [];
    };
    for (const m of hidden) { if (grp.length && rlX(m.tt) - rlX(grp[grp.length - 1].tt) > 40) flush(); grp.push(m); }
    flush();
  }
  $('rl-hint').hidden = g.tier !== 'none' || !rlVis.length;
  // Dots on the center line; a change the filters leave out is faint.
  let dots = '';
  for (const m of RLM) {
    const x = rlX(m.tt), on = vis.has(m.k), cls = 'rl-dot ' + m.rl + (on ? '' : ' rl-fade') + (m.n === rlSelN ? ' rl-on' : '');
    if (m.sb) dots += '<rect class="' + cls + '" data-rl-d="' + m.k + '" x="' + (x - 6.5).toFixed(1) + '" y="' + (g.axis - 6.5) + '" width="13" height="13" rx="2.5" transform="rotate(45 ' + x.toFixed(1) + ' ' + g.axis + ')"/>';
    else dots += '<circle class="' + cls + '" data-rl-d="' + m.k + '" cx="' + x.toFixed(1) + '" cy="' + g.axis + '" r="' + (m.rl === 'none' ? 5 : 6.5) + '"/>';
    if (m.rl === 'onway' && on) dots += '<circle class="rl-ping" cx="' + x.toFixed(1) + '" cy="' + g.axis + '" r="9"/>';
  }
  c.innerHTML = '<svg width="' + W + '" height="' + g.h + '" aria-hidden="true">' + leads + s + dots + '<g id="rl-tks"></g></svg><div class="rl-lay">' + html + '<div class="rl-day rl-stick" id="rl-stick" hidden></div></div>';
  rlBoxes(c);
  rlDrawTicks();
}
function rlCard(m, g, left, y) {
  const head = '<span class="rl-h"><span class="rl-ars">' + rlIcon(m.a0, true) + '<span class="rl-an">' + esc(RL_AN[m.a0]) + '</span>' + m.ar.slice(1, g.cw < 300 ? 2 : 3).map((x) => rlIcon(x[0], true)).join('') +
    '</span><span><b>PR ' + m.n + '</b> · ' + esc(RL_TIME.format(new Date(m.tt))) + '</span></span>';
  const open = '<button type="button" class="rl-it rl-a-' + m.a0 + (g.tier === 'compact' ? ' rl-c' : '') + (m.n === rlSelN ? ' rl-on' : '') + '" data-rl-i="' + m.k + '"' + rlPxBox(left, y, g.cw, g.ch) +
    ' aria-label="' + esc('PR ' + m.n + ': ' + m.ti) + '" tabindex="-1">';
  if (g.tier === 'compact') return open + head + '<span class="rl-ti">' + esc(m.ti) + '</span></button>';
  const is = (m.is || [])[0];
  const iss = is ? '<span class="rl-iss"><span class="rl-lan">' + esc(is.id) + '</span><span>' + esc(is.title || (is.r === 'p' ? 'Part of this issue' : 'Fixes this issue')) + '</span></span>'
    : (m.pe || [])[0] ? '<span class="rl-pe">' + esc(m.pe[0]) + '</span>' : '';
  const st = '<span class="rl-st ' + m.rl + '">' + esc(m.sb ? rlSbLabel(m.sb) : RL_WHERE[m.rl]) + '</span>';
  return open + head + '<span class="rl-ti">' + esc(m.ti) + '</span>' + iss + '<span class="rl-f"><span class="rl-who">' + rlAv(m.w) + '<span class="rl-nm">' + esc(m.w.name) + '</span></span>' + st + '</span></button>';
}

// ---- the chosen change -------------------------------------------------------------------------------
/** A tap on a card, a dot or a line lights that change and its line and dims the rest; a tap on empty space ends it. */
function rlMark(n, on) {
  const m = RLBYN.get(n), c = $('rl-can');
  if (!m) return false;
  const card = c.querySelector('.rl-it[data-rl-i="' + m.k + '"]');
  if (card) card.classList.toggle('rl-on', on);
  const dot = c.querySelector('[data-rl-d="' + m.k + '"]');
  if (dot) dot.classList.toggle('rl-on', on);
  for (const q of ['[data-rl-ld="' + m.k + '"]', '[data-rl-st="' + m.k + '"]', '[data-rl-lane="' + m.k + '"]']) { const el = c.querySelector(q); if (el) el.classList.toggle('rl-hot', on); }
  return !!card;
}
const rlFocus = (on) => $('rl-can').classList.toggle('rl-focus', on);
function rlSelect(n, scroll) {
  const m = RLBYN.get(n);
  if (!m) return;
  if (rlSelN !== null) rlMark(rlSelN, false);
  rlSelN = n;
  // A change in a "+N" has no card: it gets one first.
  if (!rlMark(n, true) && rlG().tier !== 'none' && rlVis.includes(m)) rlRender();
  if (scroll) {
    const v = $('rl-view'), x = rlX(m.tt);
    if (x < v.scrollLeft + 140 || x > v.scrollLeft + v.clientWidth - 140) v.scrollTo({ left: x - v.clientWidth / 2, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  rlDrawDetail();
}
function rlLineSteps(m) {
  const L = m.L, w = L.w !== null ? L.w : L.m, steps = [];
  if (L.r && L.r < L.m) steps.push({ k: 'Reported', t: L.r, nd: '', bar: L.r < w ? 'wait' : 'none', du: L.r < w ? w - L.r : null });
  steps.push({ k: 'Work started', t: w, nd: '', bar: 'work', du: L.m - w });
  if (!m.app) steps.push({ k: 'Merged', t: L.m, nd: '', bar: 'none', sub: 'No phone change' });
  else {
    const ph = [[L.i, 'First iPhone', ''], [L.a, 'First Android phone', 'sq']], got = ph.filter((p) => p[0]).sort((p, q) => p[0] - q[0]), first = got.length ? got[0][0] : null;
    steps.push({ k: 'Merged', t: L.m, nd: '', bar: first ? 'go' : 'open', du: first ? first - L.m : null });
    for (const [t, k, sq] of got.concat(ph.filter((p) => !p[0]))) {
      const one = t && t === first && got.length === 2;
      steps.push({ k, t, nd: (t ? 'green ' : 'todo ') + sq, bar: one ? 'one' : 'none', du: one ? got[1][0] - t : null, sub: t ? null : 'Not yet' });
    }
  }
  return '<div class="rl-steps">' + steps.map((s) => '<div class="rl-ls"><span class="rl-nd ' + s.nd + '"></span><div class="rl-lbar ' + s.bar + '"></div>' + (s.du !== null && s.du !== undefined ? '<span class="rl-du">' + esc(rlDur(s.du)) + '</span>' : '') +
    '<b>' + esc(s.k) + '</b><small>' + esc(s.t ? rlWhen(s.t) : s.sub || '') + '</small></div>').join('') + '</div>';
}
function rlErrBox(m) {
  if (!RLK.length) return '<p class="rl-note">No failures were counted in these days.</p>';
  if (!RLK.some((k) => rlErrSel.has(k.id))) return '<p class="rl-note">No failures are chosen.</p>';
  const L = m.L, t = m.app ? Math.min(...[L.i, L.a].filter(Boolean), Infinity) : L.m;
  if (!isFinite(t)) return '<p class="rl-note">No phone has run this change yet, so there is nothing to compare.</p>';
  const before = rlErrIn(t - 24 * RL_H, t), after = rlErrIn(t, Math.min(t + 24 * RL_H, rlNow));
  const fresh = RLK.filter((k) => rlErrSel.has(k.id)).filter((k) => { const f = rlKindFirst.get(k.id); return f >= t && f < t + 48 * RL_H; });
  const what = m.app ? 'the first phone ran it' : 'it merged';
  return '<div class="rl-errs"><div class="rl-row2"><div class="rl-n"><b>' + num(before) + '</b><small>in the 24 hours before ' + what + '</small></div><div class="rl-n' + (after > before * 1.5 && after - before > 20 ? ' rl-up' : '') + '"><b>' + num(after) + '</b><small>in the 24 hours after' + (t + 24 * RL_H > rlNow ? ' (so far)' : '') + '</small></div></div>' +
    (fresh.length ? '<div><h4>New kinds of failure in the 48 hours after</h4><ul>' + fresh.map((k) => '<li>' + esc(k.label) + ': first ' + esc(rlWhen(rlKindFirst.get(k.id))) + ', ' + num(Math.round(k.total)) + ' in all</li>').join('') + '</ul></div>' : '<p class="rl-note">No new kind of failure started in the 48 hours after.</p>') +
    '<p class="rl-note">Other changes reach phones at the same time. A rise does not prove that this change caused it.</p></div>';
}
function rlPlaces(m) {
  const st = (cls, text) => '<span class="rl-tr' + (cls ? ' ' + cls : '') + '">' + esc(text) + '</span>';
  const row = (name, parts) => '<div class="rl-place"><b>' + esc(name) + '</b><div class="rl-trail">' + parts.join('<span class="rl-sep"></span>') + '</div></div>';
  const rows = [], noExpo = (RLD.notes || []).some((n) => /^Expo/.test(n));
  if (m.app) {
    for (const [os, key, name] of [['ios', 'i', 'iPhone'], ['android', 'a', 'Android']]) {
      const p = [st('', 'Merged')], build = m.sb && m.sb[os], first = m[key];
      if (build) { p.push(st('', 'Store build ' + build)); const s = rlStoreState(os, build); if (s) p.push(st(s.live ? '' : 'go', s.text)); }
      else if (m.up && m.up[os]) p.push(st('', 'Update published ' + rlWhen(Date.parse(m.up[os]))));
      else p.push(st('no', noExpo ? 'Expo could not be read' : first ? 'A later update or build carries it' : 'No update or build from this commit yet'));
      p.push(first ? st('', 'First phone ran it ' + rlWhen(Date.parse(first))) : st('go', 'No phone has run it yet'));
      rows.push(row(name, p));
    }
  } else rows.push(row('Phones', [st('no', 'No phone change')]));
  const web = RLD.web, served = web && web.n ? RLBYN.get(web.n) : null;
  rows.push(row('Web app', [st('', 'Merged'), !web ? st('no', 'Could not read what the web app runs') : !served ? st('no', 'The web app runs commit ' + web.sha.slice(0, 7)) : m.n === served.n ? st('', 'The web app runs it') : m.tt < served.tt ? st('', 'Deployed; a newer merge runs now') : st('go', 'Not on the web app yet')]));
  if (m.mg) {
    const rel = okData(results, 'releases'), applied = rel && rel.migrations && rel.migrations.applied, newest = m.mg.slice().sort().pop();
    rows.push(row('Database', [st('', m.mg.length + ' migration' + (m.mg.length === 1 ? '' : 's')), !applied ? st('no', 'Could not read the hosted database') : applied >= newest ? st('', 'Applied on the hosted database') : st('go', 'Not applied yet')]));
  }
  return rows.join('');
}
function rlDetailHtml(m) {
  const sibs = (id) => RLM.filter((x) => x !== m && (x.is || []).some((s) => s.id === id));
  const why = m.is ? m.is.map((s) => {
    const x = RLI[s.id], others = sibs(s.id);
    return '<div class="rl-issue"><div class="rl-r1"><span class="rl-lan">' + esc(s.id) + '</span>' + (x ? '<span class="rl-state' + (x.closed ? ' done' : '') + '">' + esc(x.state) + '</span>' : '') + '<span>' + (s.r === 'f' ? 'This change fixes it' : 'This change is part of it') + '</span></div>' +
      (x ? '<div class="rl-t">' + esc(x.title) + '</div>' : '') + '<div class="rl-links">' + outLink(RL_LINEAR + encodeURIComponent(s.id), 'Open in Linear ↗') + '</div>' +
      (others.length ? '<div class="rl-sib">Other changes for ' + esc(s.id) + ': ' + others.map((o) => '<button type="button" class="rl-link" data-rl-goto="' + o.n + '">PR ' + o.n + '</button>').join(', ') + '</div>' : '') + '</div>';
  }).join('') : '<p class="rl-note">' + (m.w.kind === 'thread' ? 'A Claude thread made it. The pull request names no Linear issue.' : 'The pull request names no Linear issue.') + '</p>';
  const w = m.w, link = safeLink(w.link);
  const areas = '<div class="rl-dareas">' + m.ar.map(([a, subs]) => '<span class="rl-a-' + a + '">' + rlIcon(a, true) + '<b>' + esc(RL_AN[a]) + '</b>' + esc(subs.join(', ')) + '</span>').join('') + '</div>';
  const card = 'page:releases/pr-' + m.n;
  return '<div class="rl-dcard" data-card="' + esc(card) + '"><div class="rl-dinfo">' +
    '<div class="rl-dhead"><div><div class="rl-meta"><b>PR ' + m.n + '</b><span>' + esc(RL_DAY.format(new Date(m.tt)) + ', ' + RL_TIME.format(new Date(m.tt))) + '</span><code>' + esc(m.s.slice(0, 7)) + '</code><span>' + num(m.nf) + ' file' + (m.nf === 1 ? '' : 's') + '</span></div><h2>' + esc(m.ti) + '</h2>' + areas + '</div>' +
    '<div class="rl-acts">' + outLink(RL_PR_URL + m.n, 'Open on GitHub ↗', 'rl-btn') + (link ? outLink(link, 'Open the Claude Code session ↗', 'rl-btn') : '') + '</div></div>' +
    '<div class="rl-box"><h3>Its line</h3>' + rlLineSteps(m) + '</div>' +
    '<div class="rl-dgrid"><div class="rl-dcol"><div class="rl-box"><h3>Why it was made</h3>' + why + '</div>' +
    (m.pe ? '<div class="rl-box"><h3>What people see</h3><ol class="rl-people">' + m.pe.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ol></div>' : '') +
    '<div class="rl-box"><h3>Failures around it</h3>' + rlErrBox(m) + '</div></div>' +
    '<div class="rl-dcol"><div class="rl-box"><h3>Where it is now</h3>' + rlPlaces(m) + '</div>' +
    '<div class="rl-box"><h3>Who merged it</h3><div class="rl-whobig">' + rlAv(w) + '<div><b>' + esc(w.name) + '</b><small>' + esc(w.sub || 'Merged') + '</small></div></div></div></div></div></div>' +
    '<div class="italk rl-dask"><h5>Ask Claude about this change</h5>' + askTalk(card, 'releases', 'PR ' + m.n + ': ' + m.ti) + '</div></div>';
}
function rlDrawDetail() {
  const m = RLBYN.get(rlSelN);
  redraw($('rl-detail'), m ? rlDetailHtml(m) : '');
}

// ---- time marks on the center line, only for what is on screen -----------------------------------------
const RL_STEPS = [1, 2, 5, 10, 15, 30, 60, 180, 360].map((m) => m * 60000);
function rlDrawTicks() {
  const tk = $('rl-tks'), stick = $('rl-stick');
  if (!tk || !rlPx) return;
  const g = rlG(), v = $('rl-view'), step = RL_STEPS.find((st) => (st / RL_H) * rlPx >= 96);
  if (!step || rlPx < 22) { tk.innerHTML = ''; stick.hidden = true; return; }
  const a = rlTX(v.scrollLeft - 200), b = rlTX(v.scrollLeft + v.clientWidth + 200), off = new Date(a).getTimezoneOffset() * 60000, fmt = step >= RL_H ? RL_HOUR : RL_TIME;
  let p = '';
  for (let t = Math.ceil((a - off) / step) * step + off; t < b; t += step) {
    const d = new Date(t);
    if (!d.getHours() && !d.getMinutes()) continue;
    const x = rlX(t).toFixed(1);
    p += '<line class="rl-hr" x1="' + x + '" x2="' + x + '" y1="' + (g.axis - 5) + '" y2="' + (g.axis + 5) + '"/><text class="rl-hrl" x="' + (+x + 4) + '" y="' + (g.axis + 16) + '">' + esc(fmt.format(d)) + '</text>';
  }
  tk.innerHTML = p;
  // The day stays named at the left edge when its own name has scrolled away, until the next day's name comes near.
  const day = new Date(rlTX(v.scrollLeft));
  day.setHours(0, 0, 0, 0);
  const next = new Date(day);
  next.setDate(next.getDate() + 1);
  stick.hidden = rlX(day.getTime()) > v.scrollLeft - 4 || rlX(next.getTime()) - v.scrollLeft < 170;
  if (!stick.hidden) { stick.style.left = v.scrollLeft + 'px'; stick.innerHTML = '<b>' + esc(RL_DAY.format(day)) + '</b>'; }
}

// ---- the overview above the line: every change, the failures, and the part on screen -------------------
function rlDrawMini() {
  const W = 1000, Hh = 40, span = rlT1 - rlT0, pct = (t) => ((t - rlT0) / span) * W, vis = new Set(rlVis.map((m) => m.k));
  let s = '';
  if (rlErrOn && rlErrMap.size) {
    let p = '';
    for (const [t, v] of rlErrMap) { const x = pct(t); if (x >= 0) p += 'M' + x.toFixed(1) + ',' + Hh + 'V' + (Hh - (v / rlErrMax) * (Hh - 4)).toFixed(1) + 'H' + (x + W / (span / RL_H)).toFixed(1) + 'V' + Hh + 'Z'; }
    s += '<path class="rl-merr" d="' + p + '"/>';
  }
  for (const m of RLM) s += '<rect class="rl-mm ' + m.rl + '" x="' + (pct(m.tt) - 1).toFixed(1) + '" y="' + (m.app ? 9 : 21) + '" width="2.2" height="10" rx="1"' + (vis.has(m.k) ? '' : ' opacity=".18"') + '/>';
  $('rl-mplot').innerHTML = '<svg viewBox="0 0 ' + W + ' ' + Hh + '" preserveAspectRatio="none">' + s + '</svg><div class="rl-win" id="rl-win"></div>';
  let dl = '';
  for (let d = new Date(rlT0), n = 0; d.getTime() < rlT1; n++) {
    const mid = (pct(d.getTime() + 12 * RL_H) / W) * 100;
    if (mid < 100) dl += '<span class="' + (n % 2 ? 'rl-odd' : '') + '" data-box="' + mid.toFixed(2) + '%,,,">' + esc(RL_SHORT.format(d)) + '</span>';
    d.setDate(d.getDate() + 1);
  }
  $('rl-mdays').innerHTML = dl;
  rlBoxes($('rl-mdays'));
  rlSync();
}
function rlSync() {
  const v = $('rl-view'), win = $('rl-win');
  if (!win || !rlPx) return;
  const span = rlT1 - rlT0, a = rlTX(v.scrollLeft), b = rlTX(v.scrollLeft + v.clientWidth);
  const l = Math.max(0, ((a - rlT0) / span) * 100), r = Math.min(100, ((b - rlT0) / span) * 100);
  win.style.left = l + '%'; win.style.width = Math.max(0.8, r - l) + '%';
}

// ---- taps, keys, wheel and fingers -----------------------------------------------------------------------
$('rl-areas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rl-a]');
  if (!b) return;
  const a = b.dataset.rlA;
  if (RLF.areas.has(a)) { RLF.areas.delete(a); for (const s of [...RLF.subs]) if (s.startsWith(a + '/')) RLF.subs.delete(s); } else RLF.areas.add(a);
  rlDrawAreas(); rlApply();
});
$('rl-subs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rl-s]');
  if (!b) return;
  const k = b.dataset.rlS;
  if (RLF.subs.has(k)) RLF.subs.delete(k); else RLF.subs.add(k);
  rlApply();
});
let rlQTimer;
$('rl-q').addEventListener('input', (e) => { clearTimeout(rlQTimer); rlQTimer = setTimeout(() => { RLF.q = e.target.value.trim(); rlApply(); }, 150); });
$('rl-more').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rl-g]');
  if (!b) return;
  const g = b.dataset.rlG;
  if (g === 'db') RLF.db = !RLF.db; else { const v = b.dataset.rlV; if (RLF[g].has(v)) RLF[g].delete(v); else RLF[g].add(v); }
  rlDrawMore(); rlApply();
});
$('rl-sum').addEventListener('click', (e) => {
  if (!e.target.closest('[data-rl-clear]')) return;
  RLF.q = ''; $('rl-q').value = ''; RLF.areas.clear(); RLF.subs.clear(); RLF.db = false;
  for (const g of ['who', 'where', 'how', 'issue']) RLF[g].clear();
  rlDrawAreas(); rlDrawMore(); rlApply();
});
$('rl-morebtn').addEventListener('click', () => rlPop($('rl-morebtn'), $('rl-more')));
$('rl-errbtn').addEventListener('click', () => rlPop($('rl-errbtn'), $('rl-errpop')));
// A tap outside a popover closes it; the path is read as the tap found it, before a chip drew the popover again.
document.addEventListener('click', (e) => {
  const path = e.composedPath();
  if (!path.some((n) => n.classList && (n.classList.contains('rl-pop') || n.id === 'rl-morebtn' || n.id === 'rl-errbtn'))) rlPop(null);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { rlPop(null); rlFocus(false); } });
window.addEventListener('scroll', () => { if (!$('rl-more').hidden) rlPopPlace($('rl-morebtn'), $('rl-more')); if (!$('rl-errpop').hidden) rlPopPlace($('rl-errbtn'), $('rl-errpop')); }, { passive: true });
$('rl-errpop').addEventListener('change', (e) => {
  const k = e.target.dataset.rlK;
  if (!k) return;
  if (e.target.checked) rlErrSel.add(k); else rlErrSel.delete(k);
  rlErrChanged();
});
$('rl-errpop').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.rlAll) rlErrSel = b.dataset.rlAll === '1' ? new Set(RLK.map((k) => k.id)) : new Set();
  else if (b.dataset.rlGa) for (const k of RLK) if (k.group === b.dataset.rlGa) { if (b.dataset.rlOn === '1') rlErrSel.add(k.id); else rlErrSel.delete(k.id); }
  rlDrawErrPop(); rlErrChanged();
});
$('rl-errsw').addEventListener('click', () => { rlErrOn = !rlErrOn; $('rl-errsw').setAttribute('aria-checked', String(rlErrOn)); if (RLD && rlShown) { rlRender(); rlDrawMini(); } });
$('rl-presets').addEventListener('click', (e) => { const b = e.target.closest('[data-rl-h]'); if (b && rlShown) rlPreset(b.dataset.rlH, true); });
$('rl-in').addEventListener('click', () => { if (rlShown) rlZoomTo(rlPx * 1.6); });
$('rl-out').addEventListener('click', () => { if (rlShown) rlZoomTo(rlPx / 1.6); });
$('rl-newest').addEventListener('click', () => { const m = rlVis[rlVis.length - 1] || RLM[RLM.length - 1]; if (m && rlShown) rlSelect(m.n, true); });
$('rl-now').addEventListener('click', (e) => { const b = e.target.closest('[data-rl-go]'); if (b && rlShown) { rlSelect(+b.dataset.rlGo, true); rlFocus(true); } });
$('rl-detail').addEventListener('click', (e) => { const b = e.target.closest('[data-rl-goto]'); if (b) { rlSelect(+b.dataset.rlGoto, true); rlFocus(true); } });
$('rl-can').addEventListener('click', (e) => {
  const z = e.target.closest('[data-rl-zoom]');
  if (z) {
    // Zoom until this group's cards fit: any three of its changes (and their neighbours) in a row get a card width each.
    const t = +z.dataset.rlZoom, a = +z.dataset.rlZa, b = +z.dataset.rlZb, v = $('rl-view');
    const ts = rlVis.map((m) => m.tt);
    const i0 = Math.max(0, ts.findIndex((x) => x >= a) - 2), i1 = Math.min(ts.length - 1, ts.findLastIndex((x) => x <= b) + 2);
    let gap = Infinity;
    for (let k = i0; k + 2 <= i1; k++) gap = Math.min(gap, ts[k + 2] - ts[k]);
    rlSetPx(Math.max(rlPx * 1.6, gap === Infinity ? rlPx * 2.6 : ((rlG().cw + 12) / Math.max(gap / RL_H, 1 / 3600)) * 1.05));
    v.scrollLeft = rlX(t) - v.clientWidth / 2; rlSync(); rlDrawTicks();
    return;
  }
  const hit = e.target.closest('[data-rl-i], [data-rl-d], [data-rl-l]');
  const m = hit ? RLM[+(hit.dataset.rlI || hit.dataset.rlD || hit.dataset.rlL)] : null;
  if (!m) { rlFocus(false); return; }
  if (m.n === rlSelN && $('rl-can').classList.contains('rl-focus')) { rlFocus(false); return; }
  rlSelect(m.n, true); rlFocus(true);
});
$('rl-view').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  const k = rlVis.findIndex((m) => m.n === rlSelN), n = rlVis[k < 0 ? rlVis.length - 1 : k + (e.key === 'ArrowLeft' ? -1 : 1)];
  if (n) { rlSelect(n.n, true); rlFocus(true); }
});
$('rl-view').addEventListener('scroll', () => requestAnimationFrame(() => { rlSync(); rlDrawTicks(); }), { passive: true });
$('rl-view').addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey) || !rlShown) return;
  e.preventDefault();
  rlSetPx(rlPx * Math.exp(-e.deltaY * 0.0025), e.clientX - $('rl-view').getBoundingClientRect().left);
}, { passive: false });
// Two fingers pinch to zoom.
const rlPts = new Map();
let rlPinch = null;
$('rl-view').addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  rlPts.set(e.pointerId, e.clientX);
  if (rlPts.size === 2) { const [a, b] = [...rlPts.values()]; rlPinch = { d: Math.abs(a - b), p: rlPx, mid: (a + b) / 2 - $('rl-view').getBoundingClientRect().left }; }
});
$('rl-view').addEventListener('pointermove', (e) => {
  if (!rlPts.has(e.pointerId)) return;
  rlPts.set(e.pointerId, e.clientX);
  if (rlPinch && rlPts.size === 2 && rlPinch.d > 20) { const [a, b] = [...rlPts.values()]; rlSetPx((rlPinch.p * Math.abs(a - b)) / rlPinch.d, rlPinch.mid); }
});
for (const ev of ['pointerup', 'pointercancel']) $('rl-view').addEventListener(ev, (e) => { rlPts.delete(e.pointerId); if (rlPts.size < 2) rlPinch = null; });
{
  const plot = $('rl-mplot');
  let down = false;
  const go = (e) => { if (!rlShown) return; const r = plot.getBoundingClientRect(), v = $('rl-view'); v.scrollLeft = rlX(rlT0 + ((e.clientX - r.left) / r.width) * (rlT1 - rlT0)) - v.clientWidth / 2; };
  plot.addEventListener('pointerdown', (e) => { down = true; plot.setPointerCapture(e.pointerId); go(e); });
  plot.addEventListener('pointermove', (e) => { if (down) go(e); });
  plot.addEventListener('pointerup', () => { down = false; });
}
let rlResize;
window.addEventListener('resize', () => {
  clearTimeout(rlResize);
  rlResize = setTimeout(() => { if (!RLD || $('rline').hidden) return; if (!rlShown) rlStart(); else { rlSetPx(rlPx); rlDrawMini(); } }, 120);
});
`;
