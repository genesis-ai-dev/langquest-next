/**
 * Each line's Linear issue and fix on the start page, and the lines resolved
 * (docs/decisions/2026-11-17-each-ops-line-has-a-linear-issue.md). Every line
 * has a watch key (alertKinds.ts watchKeyOf); the watch for user issues ties
 * it to a Linear issue (User issues' `lines`, diag.ops_user_issues), and a
 * pull request that names that issue is its fix (/ops/api/fixes). From the
 * fix's merge and the line's check (alertKinds.ts Recheck) the page says when
 * the line should clear. Plain JavaScript inside page.ts's script, like
 * pageStart.ts; everything shown is escaped.
 */

/** The look, inside page.ts's style element. */
export const FIX_CSS = String.raw`
.fx { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; margin: 6px 0 2px; font-size: 13px; }
svg.ic { width: 14px; height: 14px; flex: none; }
.fx .lin { display: inline-flex; gap: 4px; align-items: center; font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--ink); text-decoration: none; min-height: 24px; }
.fx .lin:hover, .fx .lin:focus-visible { border-color: var(--primary); color: var(--primary); }
.fx .lin small { font-weight: 400; color: var(--muted); }
.fx a.pr { color: var(--primary); font-weight: 600; }
.fx .when { font-weight: 600; } .fx.s-stuck .say { color: var(--red); font-weight: 600; }
.fx svg.waitbar { width: 120px; height: 10px; flex: none; }
svg.waitbar .tr { fill: var(--line); } svg.waitbar .dn { fill: var(--primary); } svg.waitbar .end { fill: var(--card); stroke: var(--primary); stroke-width: 1.5; }
svg.ic .o { fill: none; stroke: var(--muted); stroke-width: 1.6; } svg.ic .f { fill: var(--primary); } svg.ic .h { stroke: var(--card); stroke-width: 1.6; fill: none; stroke-linecap: round; }
svg.ic.s-open .f, svg.ic.s-part .f { fill: var(--amber); } svg.ic.s-stuck .f { fill: var(--red); } svg.ic.s-done .f { fill: var(--green); } svg.ic.s-issue .o { stroke: var(--primary); }
svg.ic.s-person .o { stroke: var(--amber); }
ul.also li .fx { display: inline-flex; margin: 0 0 0 6px; font-size: 12px; }
.fx .each { flex-basis: 100%; display: grid; gap: 2px; margin: 2px 0 0 22px; }
.fx .each > span { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
.nc.fixing { border-style: dashed; box-shadow: none; }
.side .wl a.go { display: block; color: var(--ink); text-decoration: none; min-height: 40px; }
.side .wl a.go b { font-weight: 600; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.side .wl a.go:hover b, .side .wl a.go:focus-visible b { color: var(--primary); }
.side .wl .fx { margin: 4px 0 0; font-size: 12px; }
#attention li .fx { display: inline-flex; margin: 0 0 0 6px; font-size: 12px; }
details.resolved { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 4px 16px; margin: 20px 0 8px; }
details.resolved > summary { display: flex; gap: 8px; align-items: center; min-height: 48px; cursor: pointer; font-size: 15px; list-style: none; }
details.resolved > summary::-webkit-details-marker { display: none; }
details.resolved > summary::before { content: '▸'; color: var(--muted); } details.resolved[open] > summary::before { content: '▾'; }
.rsline { display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 10px; align-items: start; padding: 10px 0; border-top: 1px solid var(--line); }
.rsline b { display: block; font-size: 14px; } .rsline .fx { margin: 2px 0 0; }
`;

/** Pure: apps/admin/test/fixes.test.ts runs these with new Function. */
export const FIX_LOGIC = String.raw`
/** How long a merge takes to reach what the line's check reads: the deploy on merge. */
const DEPLOY_MIN = 30;
const HOUR = 3600000, MIN = 60000;

/** As alertKinds.ts alertId and watchKeyOf. */
function lineId(a) { return a.subject ? a.key + ':' + a.subject : a.key; }
function watchKeyOf(a) { return a.watchKey || ('ops:' + lineId(a).replace(/[^A-Za-z0-9 _.:()\/#@-]/g, '-')).slice(0, 290); }

/** When the line's check next says what it found, starting at or after t (ms). */
function nextCheck(r, t) {
  r = r || {};
  let start = t;
  if (r.daily && r.daily.length) {
    start = Infinity;
    for (const hm of r.daily) {
      const p = String(hm).split(':').map(Number);
      const d = new Date(t); d.setUTCHours(p[0], p[1], 0, 0);
      let x = d.getTime();
      if (x < t) x += 24 * HOUR;
      start = Math.min(start, x);
    }
  } else if (r.everyMin) {
    const step = r.everyMin * MIN, last = r.last ? Date.parse(r.last) : NaN;
    start = Number.isNaN(last) ? t + step : last + Math.max(0, Math.ceil((t - last) / step)) * step;
  }
  return start + (r.takesMin || 0) * MIN;
}

/** When a fix merged at mergedMs should have cleared the line: deployed, past the check's window, and checked. */
function clearsAt(r, mergedMs) {
  r = r || {};
  const t0 = mergedMs + DEPLOY_MIN * MIN;
  let from = t0 + (r.windowH || 0) * HOUR;
  if (r.monthly) { const d = new Date(t0); from = Math.max(from, Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); }
  return nextCheck(r, from);
}

/** What the watch decided about a watch key: its own row, or the issue whose kinds hold it. */
function rowFor(key, ud) {
  if (!ud) return null;
  const line = (ud.lines || []).find((l) => l.key === key);
  if (line) return line;
  const i = (ud.issues || []).find((x) => (x.keys || []).includes(key));
  return i ? { key, verdict: i.verdict, issue: i.issue, issueUrl: i.issueUrl, title: i.title, state: i.state, closedAt: i.closedAt, fixedBy: i.fixedBy, fixedAt: i.fixedAt } : null;
}

/**
 * One line's state, from its Linear issue and the pull requests that name it:
 * 'merged' (a fix merged, the line waits for its check), 'stuck' (still there
 * after that check), 'open' (a fix waits on its merge), 'issue' (a Linear issue,
 * no fix yet), 'noise' (the watch found nothing to fix), 'person' (a person acts
 * on the page) or 'none' (no Linear issue yet). A line that names several
 * issues (a nightly suite's failed tests) has one fix for each issue: it is
 * 'merged' only when every issue has a merged fix, 'stuck' when one is still
 * there after its fix, 'part' when only some issues have a fix, and 'issue'
 * when none has. Its each holds every issue's own state.
 */
function lineFix(a, kinds, ud, prs, now) {
  const kind = kinds[a.key] || {};
  const r = Object.assign({}, kind.recheck || {}, a.recheck || {});
  const key = watchKeyOf(a);
  const row = a.issues && a.issues.length ? null : rowFor(key, ud);
  const issues = a.issues && a.issues.length ? a.issues.slice() : row && row.issue ? [row.issue] : [];
  const base = { key, row, issues, phones: Boolean(r.phones) };
  if (issues.length > 1) {
    const each = issues.map((i) => Object.assign(lineFix(Object.assign({}, a, { issues: [i] }), kinds, ud, prs, now), { issue: i }));
    const merged = each.filter((e) => e.state === 'merged');
    if (merged.length === each.length) {
      const last = merged.reduce((x, y) => (y.at > x.at || (y.at === x.at && y.from > x.from) ? y : x));
      return Object.assign(base, { state: 'merged', pr: last.pr, from: last.from, at: last.at, each });
    }
    const stuck = each.find((e) => e.state === 'stuck');
    if (stuck) return Object.assign(base, { state: 'stuck', pr: stuck.pr, at: stuck.at, each });
    const fixed = each.filter((e) => e.state === 'open' || e.state === 'merged').length;
    return Object.assign(base, { state: fixed ? 'part' : 'issue', fixed, each });
  }
  const naming = (prs || []).filter((p) => (p.issues || []).some((i) => issues.includes(i)));
  const merged = naming.filter((p) => p.state === 'merged' && p.mergedAt).map((p) => ({ number: p.number, url: p.url, title: p.title, at: Date.parse(p.mergedAt) }));
  // Linear closed it with the pull request that fixed it (the watch reads that every 15 minutes).
  if (row && row.fixedAt && !merged.some((m) => m.number === row.fixedBy)) merged.push({ number: row.fixedBy || null, url: '', title: '', at: Date.parse(row.fixedAt) });
  merged.sort((x, y) => y.at - x.at);
  const open = naming.filter((p) => p.state === 'open');
  if (merged.length) {
    const m = merged[0], at = clearsAt(r, m.at);
    if (now < at) return Object.assign(base, { state: 'merged', pr: m, from: m.at, at });
    if (open.length) return Object.assign(base, { state: 'open', pr: open[0], at: clearsAt(r, now), after: m });
    return Object.assign(base, { state: 'stuck', pr: m, at });
  }
  if (open.length) return Object.assign(base, { state: 'open', pr: open[0], at: clearsAt(r, now) });
  if (issues.length) return Object.assign(base, { state: 'issue' });
  if (row && row.verdict === 'noise') return Object.assign(base, { state: 'noise' });
  return Object.assign(base, { state: kind.person ? 'person' : 'none' });
}

/** The part and words for a watch key the dashboard names, or null for one it does not (a phone's own kind). */
function keyKind(key, kinds) {
  const k = String(key || '');
  let m = /^ops:([a-z0-9-]+)(?::(.*))?$/.exec(k);
  if (m && kinds[m[1]]) return { part: kinds[m[1]].part, title: kinds[m[1]].title, subject: m[2] || '' };
  m = /^job:([^:]+):(stopped|failing)$/.exec(k);
  if (m) return { part: 'jobs', title: kinds[m[2] === 'stopped' ? 'job-stopped' : 'job-failing'].title, subject: m[1] };
  m = /^worker:(.+):5xx$/.exec(k);
  if (m) return { part: 'worker', title: kinds['route-5xx'].title, subject: m[1] };
  return null;
}

/**
 * Lines the watch tied to a Linear issue in the last 14 days that the page no
 * longer shows, newest first: only where the part that would show it answered
 * (a part still loading or failing says nothing about its lines).
 */
function resolvedLines(ud, keysNow, answered, kinds, now) {
  const since = now - 14 * 24 * HOUR, out = [], seen = new Set();
  for (const l of (ud && ud.lines) || []) {
    if (!l.issue || seen.has(l.key) || keysNow.has(l.key)) continue;
    const at = Date.parse(l.closedAt || l.fixedAt || l.lookedAt || '');
    if (!(at >= since)) continue;
    const k = keyKind(l.key, kinds);
    if (!k || !answered(k.part)) continue;
    seen.add(l.key);
    out.push({ key: l.key, title: k.title, subject: k.subject, issue: l.issue, issueUrl: l.issueUrl, state: l.state, closed: Boolean(l.closedAt), fixedBy: l.fixedBy, at });
  }
  return out.sort((x, y) => y.at - x.at);
}
`;

/** Drawing the states; uses the page's helpers (esc, ago) and its state (results, fixData, KINDS). */
export const FIX_SCRIPT = String.raw`
let fixData = null;
/** The page's answers for the logic above. */
function userIssuesData() { return results.userissues && results.userissues.state === 'ok' ? results.userissues.data : null; }
const fixPrList = () => (fixData && fixData.state === 'ok' && fixData.data ? fixData.data.prs : []);
function fixOf(a) { return lineFix(a, KINDS, userIssuesData(), fixPrList(), Date.now()); }

/** A time in the viewer's clock: "9:35 PM today", "4:35 AM tomorrow", or the date. */
function clock(ms) {
  const d = new Date(ms), now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = (x) => x.toDateString();
  if (day(d) === day(now)) return time + ' today';
  if (day(d) === day(new Date(now.getTime() + 86400000))) return time + ' tomorrow';
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + time;
}

const ICONS = {
  none: '<circle class="o" cx="7" cy="7" r="5.5"/>',
  noise: '<circle class="o" cx="7" cy="7" r="5.5"/><path class="o" d="M3.2 10.8L10.8 3.2"/>',
  person: '<circle class="o" cx="7" cy="7" r="5.5"/><circle class="f" cx="7" cy="7" r="2"/>',
  issue: '<circle class="o" cx="7" cy="7" r="5.5"/><circle class="f" cx="7" cy="7" r="2.5"/>',
  open: '<circle class="o" cx="7" cy="7" r="5.5"/><path class="f" d="M7 1.5A5.5 5.5 0 0 1 7 12.5Z"/>',
  part: '<circle class="o" cx="7" cy="7" r="5.5"/><path class="f" d="M7 1.5A5.5 5.5 0 0 1 12.5 7H7Z"/>',
  merged: '<circle class="f" cx="7" cy="7" r="6"/><path class="h" d="M7 3.8V7L9.2 8.4"/>',
  stuck: '<circle class="f" cx="7" cy="7" r="6"/><path class="h" d="M4.8 4.8L9.2 9.2M9.2 4.8L4.8 9.2"/>',
  done: '<circle class="f" cx="7" cy="7" r="6"/><path class="h" d="M4.2 7.2L6.2 9.2L9.8 5"/>',
  claude: '<path class="f" d="M7 1L8.4 5.6L13 7L8.4 8.4L7 13L5.6 8.4L1 7L5.6 5.6Z"/>'
};
const icon = (s) => '<svg class="ic s-' + s + '" viewBox="0 0 14 14" aria-hidden="true">' + ICONS[s] + '</svg>';

/** The way from the merge to the check that should clear the line, with now marked. */
function waitBar(from, at) {
  const share = Math.max(0, Math.min(1, (Date.now() - from) / Math.max(1, at - from)));
  return '<svg class="waitbar" viewBox="0 0 120 10" aria-hidden="true"><rect class="tr" x="0" y="3" width="116" height="4" rx="2"/>' +
    '<rect class="dn" x="0" y="3" width="' + (116 * share).toFixed(1) + '" height="4" rx="2"/><circle class="end" cx="115" cy="5" r="4"/></svg>';
}

function linearChip(f) {
  if (!f.issues.length) return '';
  return f.issues.slice(0, 3).map((id) => {
    const url = f.row && f.row.issue === id && safeLink(f.row.issueUrl) ? f.row.issueUrl : 'https://linear.app/frontierrandd/issue/' + encodeURIComponent(id);
    const state = f.row && f.row.issue === id && f.row.state ? ' <small>' + esc(f.row.state) + '</small>' : '';
    return '<a class="lin" href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(id) + state + '</a>';
  }).join('') + (f.issues.length > 3 ? '<small class="muted">+' + (f.issues.length - 3) + '</small>' : '');
}
const prLink = (p) => p && p.number ? '<a class="pr" href="' + esc(safeLink(p.url) || PR_URL + p.number) + '" target="_blank" rel="noopener">PR ' + esc(p.number) + '</a>' : 'the fix';
const onPhones = (f) => f.phones ? ' on phones that update' : '';

/** A line's state in one row: what to read first is the picture and its few words. */
function fixHtml(a, compact) {
  // "Could not read" is about the page's own call; "user issues open" counts Linear issues itself.
  if (!a || !a.key || a.key === 'unreadable' || a.key === 'user-issues-open' || a.key === 'user-issues-waiting') return '';
  const f = fixOf(a);
  // A line with several issues lists each issue's own fix under its first row (not when compact).
  const each = f.each && !compact
    ? '<span class="each">' + f.each.map((e) => '<span>' + icon(e.state) + linearChip(e) + '<span>' + fixSays(e, true) + '</span></span>').join('') + '</span>'
    : '';
  return '<span class="fx s-' + f.state + '">' + icon(f.state) + (each ? '' : linearChip(f)) + '<span>' + fixSays(f, compact) + '</span>' +
    (f.state === 'merged' && !compact ? waitBar(f.from, f.at) : '') + each + '</span>';
}

/** The few words for a state. */
function fixSays(f, compact) {
  const says = {
    none: () => compact ? 'No Linear issue yet' : 'No Linear issue yet. The watch for user issues files one.',
    person: () => 'You act on this in the page',
    noise: () => 'Claude found nothing to fix',
    issue: () => f.each ? 'No fix yet for its ' + f.each.length + ' issues' : 'No fix yet',
    part: () => f.fixed + ' of ' + f.each.length + ' issues ' + (f.fixed === 1 ? 'has' : 'have') + ' a fix',
    open: () => prLink(f.pr) + ' waits on merge' + (compact ? '' : '. After the merge, it clears by <span class="when">' + esc(clock(f.at)) + '</span>' + onPhones(f)),
    merged: () => 'Fixed in ' + prLink(f.pr) + '. Clears by <span class="when">' + esc(clock(f.at)) + '</span>' + onPhones(f),
    stuck: () => '<span class="say">Still here after ' + prLink(f.pr) + '</span>' + (compact ? '' : '. It should have cleared by ' + esc(clock(f.at)) + '.')
  };
  return says[f.state]();
}

/** How many lines wait for their check after a merged fix: they need nobody now. */
function waitingFixes(alerts) { return alerts.filter((a) => fixOf(a).state === 'merged').length; }

/** hand: the lines an admin resolved that stay hidden now (pageResolve.ts handResolved), first. */
function resolvedHtml(list, hand) {
  hand = hand || [];
  const fixes = fixData && fixData.state === 'error' ? '<p class="bad">Could not read the pull requests: ' + esc(fixData.error) + '</p>' : '';
  const n = list.length + hand.length;
  return '<summary>' + icon('done') + '<b>Resolved</b><span class="muted">' + (n ? n + ' in the last 14 days' : 'none in the last 14 days') + '</span></summary>' + fixes + handResolvedHtml(hand) +
    list.map((l) => {
      const f = { issues: [l.issue], row: { issue: l.issue, issueUrl: l.issueUrl, state: l.state } };
      return '<div class="rsline">' + icon('done') + '<div><b>' + esc(l.title) + (l.subject ? ' · ' + esc(l.subject) : '') + '</b>' +
        '<span class="fx">' + linearChip(f) + (l.fixedBy ? '<span>Fixed in ' + prLink({ number: l.fixedBy }) + '.</span>' : '') +
        '<span class="muted">' + (l.closed ? 'Closed ' + esc(ago(new Date(l.at).toISOString())) + '.' : 'Gone from this page. Still open in Linear.') + '</span></span></div></div>';
    }).join('');
}
`;
