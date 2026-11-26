/**
 * The Overview, the ops dashboard's first page
 * (docs/decisions/2026-11-18-ops-dashboard-menu-and-overview.md,
 * docs/decisions/2026-11-21-ops-dashboard-summary-and-details.md): four
 * numbers of today against their usual range; the lines by who acts (Needs
 * you; This week, you decide; On its way; Watching), most urgent first
 * (decisions.md 254's cards, as rows); how much of the Frontier Claude plan
 * this week has used (a small monitor); a map of where problems can happen
 * (pageSysMap.ts), two charts of the last 14 days, what was merged lately,
 * and the eight numbers it had, behind More numbers.
 * Every number and dot comes from a part the page already loads; a part that
 * has not answered, is not connected or could not be read says so, never a
 * guess. Plain JavaScript run inside page.ts's script after pageStart.ts and
 * pageFixes.ts; everything shown is escaped.
 */

import { SYSMAP_HTML } from './pageSysMap';

/** The Overview's look, inside page.ts's style element. */
export const OVERVIEW_CSS = String.raw`
#start > section, #start > div, #start > details { margin-bottom: 22px; }
.ovpair { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr)); gap: 22px; align-items: start; }
.sblock .alerts { gap: 0; }
.sblock .alert { border: 0; border-top: 1px solid var(--line); border-inline-start: 4px solid var(--line); border-radius: 0; box-shadow: none; padding: 12px 14px; background: none; }
.sblock .alert:first-child { border-top: 0; }
.sblock .alert.urgent { border-inline-start-color: var(--red); box-shadow: none; } .sblock .alert.problem { border-inline-start-color: var(--red); }
.sblock .alert.watch { border-inline-start-color: var(--yellow); }
.sblock .alert.by-claude { border-inline-start-color: var(--primary); } .sblock .alert.by-check { border-inline-start-color: var(--green); }
.sblock .alert.by-store { border-inline-start-color: var(--grey); } .sblock .alert.by-dev { border-inline-start-color: var(--yellow); }
.waykey { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 12.5px; color: var(--ink2); margin: -4px 0 8px; }
.waykey i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-inline-end: 6px; }
.waykey i.by-claude, .who.by-claude { background: var(--primary); } .waykey i.by-check, .who.by-check { background: var(--green); }
.waykey i.by-store, .who.by-store { background: var(--grey); } .waykey i.by-dev, .who.by-dev { background: var(--yellow); }
.sblock .alert.wayrow { grid-template-columns: 104px minmax(0, 1fr) auto; }
.wayrow .when { font-weight: 650; font-size: 14px; line-height: 1.25; color: var(--ink); } .wayrow .when small { display: block; font-weight: 400; font-size: 12px; color: var(--muted); }
.wayrow .order { display: flex; flex-direction: column; gap: 2px; margin-top: 2px; } .wayrow .order > span { display: block; } .wayrow .order small { display: block; color: var(--muted); font-size: 12px; margin-left: 18px; }
.who { display: inline-block; font-size: 11px; font-weight: 700; line-height: 18px; padding: 0 7px; border-radius: 6px; color: #111; margin-inline-end: 6px; }
.alert p.why { margin: 4px 0 0; font-size: 13px; color: var(--ink2); } .sblock .alert.info { border-inline-start-color: var(--primary); } .sblock .alert.clear { border-inline-start-color: var(--green); }
.sblock .alert .text > b { font-weight: 600; font-size: 15px; }
.ovpair .alert { grid-template-columns: minmax(0, 1fr) auto; } .ovpair .alert .lvl, .ovpair .alert .pic { display: none; }
.wchips { display: flex; flex-wrap: wrap; gap: 8px; }
.wchips a.chip { text-decoration: none; min-height: 30px; white-space: normal; }
.wchips a.chip small { font-weight: 400; opacity: .85; } .wchips a.chip small::before { content: '· '; }
.wchips a.chip:hover, .wchips a.chip:focus-visible { box-shadow: 0 0 0 1px var(--amber); }
details.more > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: 8px; min-height: 40px; }
details.more > summary::-webkit-details-marker { display: none; }
details.more > summary h2 { font-size: 17px; margin: 0; }
details.more > summary::after { content: '▾'; color: var(--muted); transition: transform .15s; } details.more:not([open]) > summary::after { transform: rotate(-90deg); }
details.more[open] > summary { margin-bottom: 12px; }
h2.oh { font-size: 17px; font-weight: 650; letter-spacing: -.01em; color: var(--ink); margin: 0 0 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
h2.oh .said { text-transform: none; letter-spacing: 0; font-weight: 400; font-size: 13px; }
h2.oh a.more { margin-inline-start: auto; text-transform: none; letter-spacing: 0; font-weight: 600; font-size: 13px; color: var(--primary); text-decoration: none; display: inline-flex; gap: 4px; align-items: center; min-height: 32px; }
.alerts { display: grid; gap: 8px; }
.alert { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; gap: 4px 14px; align-items: start; padding: 12px 14px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); border-inline-start-width: 4px; }
.alert.urgent { border-inline-start-color: var(--red); box-shadow: 0 0 0 1px var(--red); } .alert.problem { border-inline-start-color: var(--orange); }
.alert.watch { border-inline-start-color: var(--yellow); } .alert.clear { border-inline-start-color: var(--green); } .alert.info { border-inline-start-color: var(--primary); }
.alert.fixing { border-style: dashed; border-inline-start-style: solid; box-shadow: none; }
.alert .text { min-width: 0; overflow-wrap: anywhere; } .alert .text > b { font-weight: 500; }
.alert .from { font-size: 12px; color: var(--muted); margin-top: 2px; } .alert .from a { color: var(--primary); }
.alert p.next { margin: 4px 0 0; font-size: 13.5px; }
.alert ul.also { margin: 4px 0 0; padding-inline-start: 18px; font-size: 13px; } .alert ul.also li { margin: 2px 0; }
.alert .pic { width: 200px; background: var(--bg); border-radius: 10px; padding: 8px; } .alert .pic:empty { display: none; }
.alert .pic small { display: block; font-size: 11px; margin-top: 4px; }
@media (max-width: 1180px) { .alert .pic { display: none; } }
.alert .gos { display: grid; gap: 2px; justify-items: end; }
.alert a.go { font-size: 13px; font-weight: 600; color: var(--primary); text-decoration: none; white-space: nowrap; display: inline-flex; gap: 4px; align-items: center; min-height: 32px; }
.lvl { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; line-height: 22px; text-transform: uppercase; letter-spacing: .07em; white-space: nowrap; min-width: 88px; }
.lvl.urgent, .lvl.problem { color: var(--red); } .lvl.watch { color: var(--amber); } .lvl.clear { color: var(--green); } .lvl.info { color: var(--primary); }
.tiles { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 200px), 1fr)); }
a.tile { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px 16px; text-decoration: none; color: inherit; display: grid; gap: 2px; align-content: start; min-width: 0; min-height: 104px; }
a.tile:hover, a.tile:focus-visible { border-color: var(--grey); }
.tile .l { color: var(--ink2); font-size: 13px; } .tile .v { font-size: 30px; font-weight: 500; line-height: 1.15; letter-spacing: -.01em; overflow-wrap: anywhere; }
.tile .v.sm { font-size: 19px; padding-top: 6px; } .tile .v.none { color: var(--muted); font-size: 16px; padding-top: 8px; }
.tile .s { color: var(--muted); font-size: 12.5px; } .tile svg.mini { margin-top: 6px; max-width: 120px; }
a.node { display: flex; gap: 10px; align-items: center; min-height: 52px; padding: 8px 12px; border-radius: 11px; border: 1px solid var(--line); background: var(--raised); text-decoration: none; color: inherit; min-width: 0; }
a.node:hover, a.node:focus-visible { border-color: var(--grey); }
.node .ic { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: var(--soft); color: var(--ink2); flex: none; }
.node .txt { display: grid; min-width: 0; flex: 1; } .node b { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node small { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dot.off { background: transparent; border: 1.5px solid var(--grey); } .dot.error { background: transparent; border: 2px solid var(--red); } .dot.wait { background: var(--line); }
.ovcharts { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); }
a.ovchart { display: block; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; color: inherit; text-decoration: none; min-width: 0; }
a.ovchart:hover, a.ovchart:focus-visible { border-color: var(--grey); }
.ovchart h3 { margin: 0; font-size: 15px; color: var(--ink); } .ovchart .keys { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; color: var(--ink2); margin: 4px 0 8px; }
.ovchart .keys i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-inline-end: 6px; vertical-align: -1px; }
.ovchart .keys i.a, svg.days .a { background: var(--blue); fill: var(--blue); } .ovchart .keys i.b, svg.days .b { background: var(--orange); fill: var(--orange); }
svg.days { display: block; width: 100%; height: auto; } svg.days .gl { stroke: var(--line); stroke-width: 1; } svg.days text { fill: var(--muted); font-size: 11px; }
.shipped { background: var(--card); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; box-shadow: var(--sh); }
.shipped a.node { border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: none; } .shipped a.node:last-child { border-bottom: 0; }
.shipped p { margin: 0; padding: 14px 16px; }
a.plan { display: grid; gap: 6px; max-width: 640px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px 16px; text-decoration: none; color: inherit; }
a.plan:hover, a.plan:focus-visible { border-color: var(--grey); }
.plan .ptop { display: flex; flex-wrap: wrap; gap: 2px 12px; align-items: baseline; font-size: 13px; color: var(--muted); } .plan .ptop b { color: var(--ink); font-weight: 600; font-size: 14px; margin-inline-end: auto; }
.plan .row { display: grid; grid-template-columns: 92px minmax(0, 1fr) 44px; gap: 10px; align-items: center; font-size: 13px; color: var(--ink2); }
.plan .row b { text-align: end; font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
.plan svg.bar { display: block; width: 100%; height: 10px; border-radius: 5px; overflow: hidden; } .plan .bar .bg { fill: var(--soft); }
.plan .bar .used { fill: var(--green); } .plan.watch .bar .used { fill: var(--amber); } .plan.problem .bar .used { fill: var(--red); }
.plan .bar .gone { fill: var(--grey); }
.plan p { margin: 0; font-size: 13px; } .plan.watch p b { color: var(--amber); } .plan.problem p b { color: var(--red); }
@media (max-width: 900px) {
  .alert { grid-template-columns: minmax(0, 1fr); } .alert .gos { justify-items: start; grid-auto-flow: column; justify-content: start; gap: 16px; } .alert a.go { min-height: 48px; }
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
`;

/** The Overview's markup, inside page.ts's #board. */
export const OVERVIEW_HTML = String.raw`
    <div id="start" hidden>
      <section class="stiles" id="start-tiles" aria-label="Today"></section>
      <section class="sblock" aria-labelledby="ov-attention">
        <div class="sh"><h2 id="ov-attention">Needs you</h2><span class="cnt need" id="ov-need-n" hidden></span><span class="sp"></span></div>
        <div class="alerts" id="start-you"></div>
        <details class="resolved" id="start-resolved" hidden></details>
      </section>
      <div class="ovpair">
        <section class="sblock" aria-labelledby="ov-decide"><div class="sh"><h2 id="ov-decide">This week, you decide</h2><span class="cnt watch" id="ov-decide-n" hidden></span><span class="sp"></span></div><div class="alerts" id="start-decide"></div></section>
        <section class="sblock" aria-labelledby="ov-way"><div class="sh"><h2 id="ov-way">On its way</h2><span class="cnt way" id="ov-way-n" hidden></span><span class="sp"></span></div><div class="waykey" aria-label="Who acts next"><span><i class="by-claude"></i>Claude does it</span><span><i class="by-check"></i>A check shows that the fix works</span><span><i class="by-dev"></i>A developer</span><span><i class="by-store"></i>Apple or Google</span></div><div class="alerts" id="start-way"></div></section>
      </div>
      <section class="sblock" aria-labelledby="ov-watch"><div class="sh"><h2 id="ov-watch">Watching</h2><span class="cnt" id="ov-watch-n" hidden></span><span class="sp"></span></div><div class="wchips" id="start-watch"></div></section>
      <div id="start-ask"></div>
      <section aria-label="Frontier Claude plan this week"><a class="plan" id="start-plan" href="#g/access"></a></section>
      ${SYSMAP_HTML}
      <section class="ovcharts" id="start-charts" aria-label="The last 14 days"></section>
      <section aria-labelledby="ov-shipped"><h2 class="oh" id="ov-shipped">Merged lately <a class="more" href="#g/releases">Releases <span aria-hidden="true">→</span></a></h2><div class="shipped" id="start-shipped"></div></section>
      <details class="sblock more" id="start-more-box"><summary><h2>More numbers</h2></summary><div class="tiles" id="start-more"></div></details>
    </div>`;

/** Pure: apps/admin/test/overview.test.ts runs these with new Function, so what the Overview says is tested without a browser. */
export const OVERVIEW_LOGIC = String.raw`
const nf = (n) => Number(n || 0).toLocaleString('en');
/** A part's data once it answered, else null. */
function okData(results, part) { const s = results[part]; return s && s.state === 'ok' && s.data ? s.data : null; }
/** Why a part has nothing to show, in the page's own words. */
function partSaid(results, part) { const s = results[part]; return !s ? 'Loading…' : s.state === 'off' ? 'Not connected' : s.state === 'error' ? 'Could not read' : ''; }

/** The build people download from each store now, from Where each build and update is (sources/pipeline.ts). */
function liveBuilds(pipeline) {
  const out = [];
  for (const lane of (pipeline && pipeline.lanes) || []) {
    const cards = (lane.stages || []).flatMap((st) => (st.cards || []).map((c) => ({ stage: st.id, card: c })));
    const live = cards.find((c) => c.stage === 'live');
    out.push({ id: lane.id, name: lane.id === 'ios' ? 'iPhone' : 'Android', live: live ? String(live.card.title || '').replace(/^build\s+/, '') : null,
      failed: cards.filter((c) => c.card.tone === 'bad').length, review: cards.filter((c) => c.stage === 'review').length });
  }
  return out;
}

/**
 * The eight numbers of At a glance. Each comes from one part; a part with no
 * answer gives no value and says why. 'spark' names the section whose 14-day
 * number (/ops/api/glance) is the same count over time.
 */
function tilesOf(results) {
  const tiles = [];
  const add = (part, group, label, make, spark) => {
    const d = okData(results, part);
    let t = null;
    if (d) { try { t = make(d); } catch { t = null; } }
    tiles.push(t ? { group, label, value: t[0], sub: t[1] || '', small: Boolean(t[2]), spark: spark || null }
      : { group, label, value: null, sub: partSaid(results, part) || 'No number', small: false, spark: null });
  };
  add('people', 'people', 'People active today', (d) => [nf(d.activeProfiles.day), nf(d.activeProfiles.week) + ' this week · ' + nf(d.orgs.total) + ' organizations'], 'people');
  add('clients', 'phones', 'Phones and browsers that reported today', (d) => [nf(d.installs.day), nf(d.installs.week) + ' this week']);
  add('clients', 'phones', 'Errors today', (d) => {
    const crashes = d.errors.filter((e) => e.fatal).reduce((a, e) => a + Number(e.day || 0), 0);
    return [nf(d.errors.reduce((a, e) => a + Number(e.day || 0), 0)), crashes === 1 ? '1 crash' : nf(crashes) + ' crashes'];
  }, 'phones');
  add('userissues', 'userissues', 'User issues open', (d) => [nf(d.open), nf(d.fixed) + ' fixed · ' + nf(d.closed) + ' closed in 90 days']);
  add('pipeline', 'releases', 'In the stores', (d) => {
    const lanes = liveBuilds(d).sort((a, b) => a.name.localeCompare(b.name));
    if (!lanes.some((l) => l.live)) return null;
    const review = lanes.reduce((a, l) => a + l.review, 0);
    return [lanes.map((l) => l.name + ' ' + (l.live || '–')).join(' · '), review ? review + ' in review' : 'what people download', true];
  });
  add('nightly', 'nightly', 'Nightly tests', (d) => {
    const suites = (d.runs || []).flatMap((r) => r.suites || []);
    if (!suites.length) return null;
    const bad = suites.filter((s) => s.failed || s.broke);
    return [(suites.length - bad.length) + ' of ' + suites.length, bad.length ? bad.map((s) => s.suite).slice(0, 3).join(', ') + (bad.length > 3 ? ' and ' + (bad.length - 3) + ' more' : '') + ' failed' : 'every suite passed'];
  });
  add('support', 'support', 'Feedback to read', (d) => d.feedbackOpen ? [nf(d.feedbackOpen.open), nf(d.reports.open) + (Number(d.reports.open) === 1 ? ' content report open' : ' content reports open')] : null, 'support');
  add('videofeedback', 'tutorials', 'Video suggestions that wait', (d) => [nf(d.open), nf(d.waiting) + ' not looked at yet']);
  return tiles;
}

const WEEK_MS = 7 * 864e5;
/** A reading older than this says how old it is: the reading runs every hour. */
const PLAN_OLD_H = 3;
/**
 * The Frontier Claude plan this week (sources/claudePlan.ts): the share used
 * against the share of the week gone. Used faster than the week by over 10
 * points is a watch, with when it runs out at that speed; 90% used is a
 * problem. No reading is never a zero: it says why.
 */
function planOf(results, now) {
  const s = results.claudeplan;
  const none = (said) => ({ used: null, gone: null, level: 'none', said, resetsAt: null, runsOut: null, readAt: null, old: false });
  if (!s || s.state !== 'ok' || !s.data) return none(partSaid(results, 'claudeplan') || 'No reading');
  const d = s.data, w = d.week;
  if (!w) return none(d.said || 'No reading yet');
  const end = Date.parse(w.resetsAt), start = end - WEEK_MS;
  // A reading from before the week started again is last week's.
  if (!(end > now)) return none('The week started again. The next reading comes within the hour.');
  const gone = Math.min(1, Math.max(0, (now - start) / WEEK_MS));
  const used = Math.max(0, Number(w.used));
  const read = d.readAt ? Date.parse(d.readAt) : NaN;
  const level = used >= 0.9 ? 'problem' : used - gone > 0.1 ? 'watch' : 'ok';
  // At the speed so far, when the plan is all used; only when that comes before the week starts again.
  const spent = (Number.isFinite(read) ? read : now) - start;
  const runsOutAt = used > 0 && used < 1 && spent > 0 ? start + spent / used : null;
  const runsOut = runsOutAt !== null && runsOutAt < end ? new Date(runsOutAt).toISOString() : null;
  const said = used >= 1 ? 'Used up. The automatic jobs stop until the week starts again.'
    : level === 'problem' ? 'Almost used up. The automatic jobs stop at 100%.'
    : level === 'watch' ? 'Used faster than the week goes.'
    : used > gone ? 'About even with the week.' : 'Less used than the week gone.';
  return { used, gone, level, said, resetsAt: w.resetsAt, runsOut, readAt: d.readAt || null, old: Number.isFinite(read) && (now - read) / 36e5 > PLAN_OLD_H };
}

/** The newest merges on main, newest first, from What shipped (sources/releases.ts). */
function shippedOf(releases, max) {
  return ((releases && releases.timeline) || []).filter((e) => e.kind === 'merge')
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, max)
    .map((e) => ({ at: e.at, pr: e.pr || null, title: e.title || String(e.text || '').replace(/^[0-9a-f]{7}\s+/, '') }));
}
`;

/** Drawing the Overview. */
export const OVERVIEW_SCRIPT = String.raw`
const LVL_ICON = { urgent: 'alert', problem: 'alert', watch: 'look', info: 'look', clear: 'safety' };
const lvl = (level, title) => '<span class="lvl ' + level + '">' + svgIcon(LVL_ICON[level]) + esc(title) + '</span>';
const goLink = (href, text, out) => '<a class="go" href="' + esc(href) + '"' + (out ? ' target="_blank" rel="noopener"' : '') + '>' + esc(text) + ' ' + svgIcon('go') + '</a>';
/** The row's own button: it opens the row's card on its section's page (pageCards.ts). */
const rowOpenLink = (href) => '<a class="go open" href="' + esc(href) + '">Open ' + svgIcon('go') + '</a>';
const ALSO_SHOWN = 3;

/** Every card line is a merged fix (or an issue Linear closed) that waits for its check. */
const fixing = (c) => Boolean(c.alerts && c.alerts.length) && waitingFixes(c.alerts) === c.alerts.length;

/** One row for a part's alerts of one kind: the most urgent leads, up to 3 more follow, the rest are counted. */
function alertRow(c) {
  const t = splitAlert(tidy(c.text));
  const link = safeLink(c.link);
  const lines = c.alerts || [];
  // Each line opens its own card on its section's page (pageCards.ts).
  const href = (a) => cardHref(c.group, lineCardId(a || { key: 'unreadable', subject: c.part }));
  const also = c.more.slice(0, ALSO_SHOWN).map((x, i) => '<li><a class="card" href="' + esc(href(lines[i + 1])) + '">' + esc(splitAlert(tidy(x)).title) + '</a>' + fixHtml(lines[i + 1], true) + '</li>').join('');
  const rest = c.more.length - ALSO_SHOWN;
  // A row that needs a person has its part's own picture, on a wide screen: its runs or its list as squares, or its number over 14 days.
  const gl = c.level === 'watch' ? null : glanceOf(c.group);
  const pic = c.level === 'watch' ? '' : (SQUARES[c.part] ? squarePic(c.part, c.text) : listCardPic(c.part)) || (gl ? miniSvg(gl.s.values, gl.s.agg, 200, 48, gl.say) + '<small>' + esc(gl.said) + '</small>' : '');
  return '<div class="alert ' + c.level + (fixing(c) ? ' fixing' : '') + '" data-href="' + esc(href(lines[0])) + '">' + lvl(c.level, LEVEL[c.level].title) +
    '<div class="text"><b><a class="card" href="' + esc(href(lines[0])) + '">' + esc(t.title) + '</a>' + backTag(lines[0], 'backtag') + '</b>' + backWhy(lines[0]) + fixHtml(lines[0]) + (lines[0] && lines[0].key !== 'unreadable' && lines[0].key !== 'user-issues-open' ? miniSteps(fixOf(lines[0])) : '') +
    (also ? '<ul class="also">' + also + (rest > 0 ? '<li>' + num(rest) + ' more in ' + esc(titleOf(c.group)) + '</li>' : '') + '</ul>' : '') +
    (t.next ? '<p class="next"><b>Next:</b> ' + esc(t.next) + '</p>' : '') +
    '<div class="from">' + esc(whereOf(c)) + '</div></div><div class="pic">' + pic + '</div>' +
    '<div class="gos">' + rowOpenLink(href(lines[0])) + (link ? goLink(link, 'Open the page', true) : '') + resolveButton(lines, c.part, 'go') + '</div></div>';
}

/** Who acts next on a row of On its way, with the colour of its edge and its key. */
const WAY_WHO = { claude: ['by-claude', 'Claude'], check: ['by-check', 'Check'], dev: ['by-dev', 'Developer'], store: ['by-store', 'Store'] };
const issueLink = (i) => safeLink(i.issueUrl) ? '<a href="' + esc(i.issueUrl) + '" target="_blank" rel="noopener">' + esc(i.issue || 'Linear') + '</a>' : esc(i.issue || '');
const prOut = (n) => '<a href="' + PR_URL + Number(n) + '" target="_blank" rel="noopener">pull request ' + Number(n) + '</a>';
const filedSaid = (i) => [issueLink(i), i.firstAt ? 'filed ' + esc(ago(i.firstAt)) : '', i.people ? num(i.people) + (i.people === 1 ? ' person' : ' people') : ''].filter(Boolean).join(' · ');

/** A time as two lines for the first column: "5:10 PM" over "today", "tomorrow" or "Mon, Nov 23". */
function whenOf(ms, now) {
  const d = new Date(ms), day = (x) => x.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return [time, day(d) === day(new Date(now)) ? 'today' : day(d) === day(new Date(now + 864e5)) ? 'tomorrow' : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })];
}

/** One row of On its way: when it happens (the first column), who acts, what, and its card. */
function wayRow(x) {
  const who = WAY_WHO[x.who];
  return '<div class="alert wayrow ' + who[0] + '" data-href="' + esc(x.href) + '"><div class="when">' + esc(x.when[0]) + (x.when[1] ? '<small>' + esc(x.when[1]) + '</small>' : '') + '</div>' +
    '<div class="text"><b><a class="card" href="' + esc(x.href) + '">' + esc(x.title) + '</a></b><p class="next"><span class="who ' + who[0] + '">' + esc(who[1]) + '</span>' + x.said + '</p>' +
    (x.from ? '<div class="from">' + x.from + '</div>' : '') + '</div><div class="gos">' + rowOpenLink(x.href) + '</div></div>';
}

/**
 * What is on its way, in time order (docs/decisions/2026-11-21-on-its-way-says-what-happens-next.md):
 * what Claude works on now, the next run's issues, Claude's fixes that merge alone, each merged
 * fix by the time its check should clear its problem, what a developer has in Linear, then the
 * stores. A time shows only where the page knows it.
 */
function wayItems(plan, work, store, now) {
  const out = [];
  for (const i of work.filter((w) => w.state === 'working')) {
    out.push({ at: 0, who: 'claude', when: ['Now', i.startedAt ? 'since ' + new Date(i.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''], title: i.title || i.issue || 'An issue',
      said: esc(CLAUDE_WORK.working), from: filedSaid(i), href: i.issue ? cardHref('userissues', i.issue) : '#g/userissues' });
  }
  const line = claudeLine(userIssuesData(), work);
  const take = line.slice(0, FIX_ROOM), taken = new Set(take.map((i) => i.issue));
  if (line.length) {
    const next = nextRunAt(now), rest = line.length - take.length, ordered = take.some((i) => i.whyFirst);
    out.push({ at: next, who: 'claude', when: [whenOf(next, now)[0], 'next run, about'],
      title: 'Claude tries a fix for ' + (take.length === 1 ? '1 problem' : take.length + ' problems, ' + (ordered ? 'the most important first' : 'one after the other')),
      said: ordered ? '<span class="order">' + take.map((i) => '<span><b>' + i.place + '.</b> ' + issueLink(i) + (i.title ? ' ' + esc(i.title) : '') + '<small>' + esc(i.whyFirst) + '</small></span>').join('') + '</span>'
        : take.map(issueLink).join(' · ') + ', the oldest first. New problems the watch finds go first.',
      from: (rest > 0 ? num(rest) + ' more ' + (rest === 1 ? 'waits' : 'wait') + ' in line, ' + FIX_ROOM + ' in each run. ' : '') +
        (ordered ? 'Your instructions on a card go first. Then the order is: priority in Linear, people, kinds of failure, places with the same mistake, times, and the oldest.' : rest > 0 ? 'Claude has not tried ' + (rest === 1 ? 'it' : 'them') + ' yet.' : ''),
      href: take[0].issue ? cardHref('userissues', take[0].issue) : '#g/userissues' });
  }
  // The cause is not proven yet: Claude goes on with its plan at the time it chose (docs/agent-team.md "When the cause is not proven yet").
  // An issue the next run takes is in the row above.
  for (const i of work.filter((w) => w.state === 'proving' && !taken.has(w.issue))) {
    const at = Math.max(Date.parse(i.nextAt || '') || 0, nextRunAt(now));
    out.push({ at, who: 'claude', when: [whenOf(at, now)[0], 'Claude goes on, about'], title: i.title || i.issue || 'An issue',
      said: esc(CLAUDE_WORK.proving) + (i.why ? ' ' + esc(i.why) : ''), from: filedSaid(i), href: i.issue ? cardHref('userissues', i.issue) : '#g/userissues' });
  }
  for (const i of work.filter((w) => w.state === 'merging')) {
    out.push({ at: now + 1, who: 'check', when: ['Soon', 'when checks pass'], title: i.title || i.issue || 'An issue',
      said: esc(CLAUDE_WORK.merging) + ' ' + prOut(i.pr) + '.', from: filedSaid(i), href: i.issue ? cardHref('userissues', i.issue) : '#g/userissues' });
  }
  for (const r of plan.way) {
    for (const a of r.alerts) {
      const f = fixOf(a), t = splitAlert(tidy(a.text));
      const at = (f.state === 'merged' || f.state === 'closing') && Number.isFinite(f.at) ? f.at : null;
      const said = f.state === 'closing' ? 'Closed in Linear with no fix. The next check shows if the problem is gone.' : 'Fixed in ' + prLink(f.pr) + '. The next check shows if the fix works.';
      out.push({ at: at || now + 2, who: 'check', when: at ? whenOf(at, now) : ['Soon', ''],
        title: t.title.replace(/\.$/, ''), said, from: esc(titleOf(r.group)), href: cardHref(r.group, lineCardId(a)) });
    }
  }
  for (const i of work.filter((w) => w.state === 'person')) {
    out.push({ at: Infinity, who: 'dev', when: ['No time', 'in Linear'], title: i.title || i.issue || 'An issue', said: esc(CLAUDE_WORK.person) + (i.linear ? ' (' + esc(i.linear) + ')' : ''),
      from: filedSaid(i), href: i.issue ? cardHref('userissues', i.issue) : '#g/userissues' });
  }
  for (const w of store) {
    out.push({ at: Infinity, who: 'store', when: [w.lane === 'iPhone' ? 'Apple' : 'Google', 'decides'], title: w.lane + ' ' + (w.title || ''),
      said: 'Waits on ' + (w.lane === 'iPhone' ? 'Apple' : 'Google') + ' · ' + esc(w.stage), from: [w.at ? 'sent ' + esc(ago(w.at)) : '', w.state ? esc(w.state) : ''].filter(Boolean).join(' · '),
      href: cardHref('releases', storeCardId(w.laneId, w.title)) });
  }
  return out.sort((x, y) => x.at - y.at);
}

/** A row for an issue where Claude stopped or wrote a fix that waits: Claude's reason, and the way to answer. */
function decideRow(i) {
  const href = i.issue ? cardHref('userissues', i.issue) : '#g/userissues';
  const go = i.state === 'review' && i.pr ? goLink(PR_URL + Number(i.pr), 'Read the fix', true) : '';
  return '<div class="alert watch" data-href="' + esc(href) + '">' + lvl('watch', 'You decide') + '<div class="text"><b><a class="card" href="' + esc(href) + '">' + esc(i.title || i.issue || 'An issue') + '</a></b>' +
    '<p class="next">' + esc(CLAUDE_WORK[i.state]) + (i.state === 'review' && i.pr ? ' ' + prOut(i.pr) + '.' : '') + '</p>' +
    (i.why ? '<p class="why"><b>Claude says:</b> ' + esc(i.why.replace(/^The manager\b/, 'Claude')) + '</p>' : '') + '<div class="from">' + filedSaid(i) + '</div></div><div class="pic"></div>' +
    '<div class="gos">' + go + goLink(href, 'Tell Claude') + '</div></div>';
}

let startQueued = false;
function renderStart() {
  if (startQueued) return;
  startQueued = true;
  requestAnimationFrame(() => { startQueued = false; drawNav(); drawStart(); });
}

/**
 * The Overview's lines by bucket (pageSummary.ts lineBucket): one row for a
 * part's lines in one bucket, led by its most urgent, so a flood of lines in
 * one part (30 new error kinds) is still one row.
 */
function overviewPlan() {
  const out = { need: [], decide: [], way: [], watch: [] };
  const rank = (l) => LEVELS.indexOf(l);
  for (const g of SECTIONS) {
    if (!g.parts.length) continue;
    const rows = {};
    for (const l of groupLines(g)) {
      const k = l.a.part + '|' + l.bucket;
      (rows[k] = rows[k] || { group: g.id, part: l.a.part, bucket: l.bucket, lines: [] }).lines.push(l);
    }
    for (const r of Object.values(rows)) {
      const a = r.lines.map((l) => l.a);
      out[r.bucket].push({ level: r.lines[0].level, group: r.group, part: r.part, text: a[0].text, link: a[0].link, more: a.slice(1).map((x) => x.text), alerts: a, n: a.length });
    }
  }
  for (const k of Object.keys(out)) out[k].sort((x, y) => rank(x.level) - rank(y.level));
  return out;
}
const linesIn = (rows) => rows.reduce((n, r) => n + r.n, 0);
function setCount(id, n) { const el = $(id); el.hidden = !n; el.textContent = n ? num(n) : ''; }

function drawStart() {
  if ($('start').hidden) return;
  const plan = overviewPlan();
  const waiting = startPlan(SECTIONS, results, LEVELS).waiting.length;
  const now = Date.now();
  const work = claudeWork(userIssuesData(), now);
  const decideWork = work.filter((i) => CLAUDE_GROUP[i.state] === 'decide');
  const store = storeWaits(results.pipeline && results.pipeline.state === 'ok' ? results.pipeline.data : null);
  const way = wayItems(plan, work, store, now);
  // A row of the next run counts each issue in line; every other row counts one.
  const queued = claudeLine(userIssuesData(), work).length;
  const needN = linesIn(plan.need), decideN = linesIn(plan.decide) + decideWork.length, wayN = way.length + (queued ? queued - 1 : 0), watchN = linesIn(plan.watch);
  const say = [
    needN ? needN + (needN === 1 ? ' needs you now.' : ' need you now.') : '',
    decideN ? decideN + (decideN === 1 ? ' choice waits for you.' : ' choices wait for you.') : '',
    wayN ? wayN + (wayN === 1 ? ' is on its way.' : ' are on their way.') : '',
    watchN ? watchN + ' to watch.' : '',
    waiting ? waiting + (waiting === 1 ? ' page still loads.' : ' pages still load.') : ''
  ].filter(Boolean);
  // While a page still loads, "Nothing needs you" is not yet known: the mark turns and says so.
  if (view().name === 'start') sayVerdict({ tone: needN ? 'need' : decideN || watchN ? 'watch' : waiting ? 'wait' : 'ok', text: say.length ? (needN || waiting ? '' : 'Nothing needs you now. ') + say.join(' ') : waiting ? 'Checking…' : 'Nothing needs you now.' });
  setCount('ov-need-n', needN); setCount('ov-decide-n', decideN); setCount('ov-way-n', wayN); setCount('ov-watch-n', watchN);
  const none = (words) => waiting ? skel('lines') : '<p class="sempty">' + esc(words) + '</p>';
  const youHtml = plan.need.map(alertRow).join('') || (waiting ? skel('cards') : '<div class="alert clear">' + lvl('clear', 'All clear') + '<div class="text"><b>Nothing needs you now.</b></div><div class="pic"></div><span></span></div>');
  if (redraw($('start-you'), youHtml)) annotate($('start-you'));
  if (redraw($('start-decide'), plan.decide.map(alertRow).concat(decideWork.map(decideRow)).join('') || none('No choice waits for you.'))) annotate($('start-decide'));
  redraw($('start-way'), way.map(wayRow).join('') || none('Nothing is on its way.'));
  // What to watch: a chip for each line, each opening its card.
  redraw($('start-watch'), plan.watch.flatMap((r) => r.alerts.map((a) => '<a class="chip watch" href="' + esc(cardHref(r.group, lineCardId(a))) + '">' + esc(splitAlert(tidy(a.text)).title.replace(/\.$/, '')) + '<small>' + esc(titleOf(r.group)) + '</small></a>')).join('') || none('Nothing to watch.'));
  // Questions about the whole Overview, with what it shows (pageAsk.ts).
  redraw($('start-ask'), askBlock('page:start', 'start', 'Overview'));
  drawResolved();
  drawPlan();
  drawTiles();
  drawSysMap();
  drawOvCharts();
  drawShipped();
}

/**
 * Under one closed heading: the lines an admin resolved, which stay hidden until their problem comes
 * back (pageResolve.ts), then the lines the watch tied to Linear that this page no longer shows.
 */
function drawResolved() {
  const ud = userIssuesData(), el = $('start-resolved'), hand = handResolved();
  el.hidden = !hand.length && (!ud || !ud.lines);
  if (el.hidden) return;
  // A line hidden as resolved is still on the page: the watch's list says only what its check no longer finds.
  const now = new Set(PARTS.flatMap((p) => ((RAW[p] && RAW[p].alerts) || []).map(watchKeyOf)));
  const answered = (part) => Boolean(results[part]) && results[part].state === 'ok';
  redraw(el, resolvedHtml(ud && ud.lines ? resolvedLines(ud, now, answered, KINDS, Date.now()) : [], hand));
}

const planPct = (x) => Math.round(x * 100) + '%';
const weekTime = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
function drawPlan() {
  const p = planOf(results, Date.now());
  const el = $('start-plan');
  el.className = 'plan ' + p.level;
  const bar = (cls, label, x) => '<div class="row"><span>' + label + '</span><svg class="bar" viewBox="0 0 100 10" preserveAspectRatio="none" role="img" aria-label="' + esc(label + ' ' + planPct(x)) + '"><rect class="bg" width="100" height="10"/><rect class="' + cls + '" width="' + (Math.min(1, x) * 100).toFixed(1) + '" height="10"/></svg><b>' + planPct(x) + '</b></div>';
  redraw(el, '<div class="ptop"><b>Frontier Claude plan this week</b>' + (p.resetsAt ? '<span>Starts again ' + esc(weekTime(p.resetsAt)) + '</span>' : '') + '</div>' +
    (p.used === null ? (results.claudeplan ? '<p class="muted">' + esc(p.said) + '</p>' : skel('lines'))
      : bar('used', 'Used', p.used) + bar('gone', 'Week gone', p.gone) +
        '<p><b>' + esc(p.said) + '</b>' + (p.runsOut ? ' At this speed it runs out ' + esc(weekTime(p.runsOut)) + '.' : '') +
        (p.readAt ? ' <span class="muted">Read ' + esc(ago(p.readAt)) + (p.old ? ': the hourly reading is late.' : '.') + '</span>' : '') + '</p>'));
}

/**
 * The Overview's four numbers of today, each against its usual range: the
 * value is the part's own count of the last 24 hours, the line and the range
 * its days before today (pageSummary.ts).
 */
const OV_TILES = [
  { group: 'people', label: 'People active today', part: 'people', metric: 'active_accounts', value: (d) => d.activeProfiles.day, src: 'people' },
  { group: 'phones', label: 'Phones and browsers today', part: 'clients', metric: 'installs', value: (d) => d.installs.day, src: 'clients' },
  { group: 'phones', label: 'Errors today', part: 'clients', metric: 'errors', value: (d) => d.errors.reduce((a, e) => a + Number(e.day || 0), 0), src: 'clients' },
  { group: 'phones', label: 'Crashes today', part: 'clients', metric: 'crashes', value: (d) => d.errors.filter((e) => e.fatal).reduce((a, e) => a + Number(e.day || 0), 0), src: 'clients' }
];
function drawTiles() {
  redraw($('start-tiles'), OV_TILES.map((t) => {
    const d = okData(results, t.src);
    let value = null;
    if (d) { try { value = Number(t.value(d)); } catch { value = null; } }
    sumHistory(t.part);
    const got = seriesOf(t.part, t.metric);
    const days = got ? got.s.values.slice(0, -1) : null;
    const usual = days ? usualOf(days.filter((x, i) => got.hst.counted[i] !== false)) : null;
    const said = comparedTo(value, usual);
    const tone = said === 'normal' ? 'ok' : said === 'none' ? 'none' : (said === 'high') === WORSE_UP.test(t.metric) ? 'warn' : 'note';
    const words = healthWords({ said, usual, grow: null }, '');
    return '<a class="stile" href="#g/' + esc(t.group) + '"><span class="lb" data-help-key="metric:' + esc(t.part + '.' + t.metric) + '">' + esc(t.label) + '</span>' +
      (value === null && !results[t.src] ? '<span class="sk big w40"></span>' : '<span class="v' + (value === null ? ' none' : '') + '">' + esc(value === null ? partSaid(results, t.src) || 'No number' : num(value)) + '</span>') +
      (days ? sparkSvg(days.concat(value === null ? [] : [value]), usual, tone === 'warn' ? 'warn' : '', 240, 46) : '') +
      '<span class="ft"><span class="said ' + tone + '">' + esc(value === null ? '' : words.said) + '</span>' + (value !== null && words.more ? ' · ' + esc(words.more) : '') + '</span></a>';
  }).join(''));
  // The eight numbers the Overview had, behind one tap.
  redraw($('start-more'), tilesOf(results).map((t) => {
    const gl = t.spark ? glanceOf(t.spark) : null;
    return '<a class="tile" href="#g/' + esc(t.group) + '"><span class="l">' + esc(t.label) + '</span>' +
      '<span class="v' + (t.value === null ? ' none' : t.small ? ' sm' : '') + '">' + esc(t.value === null ? '–' : t.value) + '</span>' +
      '<span class="s">' + esc(t.sub) + '</span>' + (gl ? miniSvg(gl.s.values, gl.s.agg, 120, 24, gl.say) : '') + '</a>';
  }).join(''));
}

/** One bar for each day, the second number stacked on the first; the scale and the first and last day are written, and each day says its numbers under the pointer (pageHover.ts). */
function daysSvg(days, a, b, an, bn) {
  const w = 560, h = 190, left = 34, bottom = 22, top = 8;
  const max = Math.max(1, ...days.map((d) => a(d) + (b ? b(d) : 0)));
  const step = (w - left) / Math.max(1, days.length), bw = Math.max(2, step - 4), ph = h - bottom - top;
  const y = (v) => top + ph - (v / max) * ph;
  const hv = hvAttr(left, step, days.map((d) => day(d.day + 'T12:00:00Z') + ' UTC'),
    [['a', an, days.map((d) => num(a(d)))]].concat(b ? [['b', bn, days.map((d) => num(b(d)))]] : []), top, h - bottom);
  let s = '<svg class="days" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-hidden="true"' + hv + '>';
  for (const g of [0, max / 2, max]) s += '<line class="gl" x1="' + left + '" x2="' + w + '" y1="' + y(g).toFixed(1) + '" y2="' + y(g).toFixed(1) + '"/><text x="' + (left - 6) + '" y="' + (y(g) + 4).toFixed(1) + '" text-anchor="end">' + esc(num(Math.round(g))) + '</text>';
  days.forEach((d, i) => {
    const x = left + i * step + 2, va = a(d), vb = b ? b(d) : 0;
    if (va) s += '<rect class="a" x="' + x.toFixed(1) + '" y="' + y(va).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (y(0) - y(va)).toFixed(1) + '" rx="2"/>';
    if (vb) s += '<rect class="b" x="' + x.toFixed(1) + '" y="' + y(va + vb).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (y(va) - y(va + vb)).toFixed(1) + '" rx="2"/>';
  });
  const label = (i, anchor) => days[i] ? '<text x="' + (left + i * step + step / 2).toFixed(1) + '" y="' + (h - 6) + '" text-anchor="' + anchor + '">' + esc(day(days[i].day + 'T12:00:00Z')) + '</text>' : '';
  return s + label(0, 'start') + (days.length > 1 ? label(days.length - 1, 'end') : '') + '</svg>';
}

function drawOvCharts() {
  const s = results.releases;
  const days = s && s.state === 'ok' && s.data ? s.data.errorsByDay || [] : null;
  if (!days) { redraw($('start-charts'), !s ? skel('chart') + skel('chart') : s.state === 'off' ? '<p class="muted">The charts are not connected.</p>' : failed('Could not read the charts.', retryPart('releases'))); return; }
  const sum = (f) => days.reduce((n, d) => n + f(d), 0);
  const errs = (d) => Math.max(0, Number(d.errors || 0) - Number(d.crashes || 0)), crashes = (d) => Number(d.crashes || 0), installs = (d) => Number(d.installs || 0);
  redraw($('start-charts'),
    '<a class="ovchart" href="#g/phones"><h3>Errors and crashes</h3><div class="keys"><span><i class="a"></i>Errors <b>' + num(sum(errs)) + '</b></span><span><i class="b"></i>Crashes <b>' + num(sum(crashes)) + '</b></span></div>' + daysSvg(days, errs, crashes, 'Errors', 'Crashes') + '</a>' +
    '<a class="ovchart" href="#g/phones"><h3>Phones and browsers with an error</h3><div class="keys"><span><i class="a"></i>Phones and browsers, each day</span></div>' + daysSvg(days, installs, null, 'Phones and browsers') + '</a>');
}

function drawShipped() {
  const s = results.releases;
  if (!s || s.state !== 'ok') { redraw($('start-shipped'), '<p class="muted">' + esc(partSaid(results, 'releases')) + '</p>'); return; }
  const repo = (okData(results, 'pipeline') || okData(results, 'nightly') || {}).repo;
  const list = shippedOf(s.data, 5);
  redraw($('start-shipped'), list.map((e) => {
    const href = e.pr && repo ? 'https://github.com/' + repo + '/pull/' + e.pr : '#g/releases';
    return '<a class="node" href="' + esc(href) + '"' + (href.startsWith('https://') ? ' target="_blank" rel="noopener"' : '') + '><span class="ic">' + svgIcon('merge') + '</span>' +
      '<span class="txt"><b>' + (e.pr ? 'PR ' + esc(e.pr) + ' · ' : '') + esc(e.title) + '</b><small>Merged ' + esc(ago(e.at)) + '</small></span></a>';
  }).join('') || '<p class="muted">Nothing merged in the last 14 days.</p>');
}

$('start-look').addEventListener('submit', (e) => {
  e.preventDefault();
  lookUp($('start-q').value.trim());
});
/** Opens Look up with this text, from the top line or a detail row. */
function lookUp(text) {
  if (!text) return;
  closeDetail();
  location.hash = 'g/lookup';
  $('q').value = text;
  $('lookup-form').requestSubmit();
}
`;
