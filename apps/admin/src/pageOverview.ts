/**
 * The Overview, the ops dashboard's first page
 * (docs/decisions/2026-11-18-ops-dashboard-menu-and-overview.md): one row for
 * each thing that needs a person, most urgent first (decisions.md 254's
 * cards, as rows), then eight numbers, a map of the parts with a dot for each
 * part's state, two charts of the last 14 days, and what was merged lately.
 * Every number and dot comes from a part the page already loads; a part that
 * has not answered, is not connected or could not be read says so, never a
 * guess. Plain JavaScript run inside page.ts's script after pageStart.ts and
 * pageFixes.ts; everything shown is escaped.
 */

/** The Overview's look, inside page.ts's style element. */
export const OVERVIEW_CSS = String.raw`
#start > section { margin-bottom: 30px; }
h2.oh { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .09em; color: var(--muted); margin: 0 0 12px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
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
.mapcard { background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.map { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px 56px; padding: 22px; }
.map svg.wires { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.map svg.wires path { fill: none; stroke: var(--grey); stroke-width: 1.5; opacity: .55; }
.map .col { display: grid; gap: 10px; align-content: center; position: relative; z-index: 1; }
.map .col > span { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .09em; color: var(--muted); margin-bottom: 2px; }
a.node { display: flex; gap: 10px; align-items: center; min-height: 52px; padding: 8px 12px; border-radius: 11px; border: 1px solid var(--line); background: var(--raised); text-decoration: none; color: inherit; min-width: 0; }
a.node:hover, a.node:focus-visible { border-color: var(--grey); }
.node .ic { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: var(--soft); color: var(--ink2); flex: none; }
.node .txt { display: grid; min-width: 0; flex: 1; } .node b { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node small { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node .dot { margin-top: 0; width: 8px; height: 8px; }
.node.urgent, .node.problem { border-color: var(--red); } .node.watch { border-color: var(--yellow); } .node.off { border-style: dashed; }
.dot.off { background: transparent; border: 1.5px solid var(--grey); } .dot.error { background: transparent; border: 2px solid var(--red); } .dot.wait { background: var(--line); }
.mapkey { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 0 22px 16px; font-size: 12px; color: var(--muted); }
.mapkey span { display: inline-flex; align-items: center; gap: 6px; } .mapkey .dot { margin-top: 0; width: 8px; height: 8px; }
.ovcharts { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); }
a.ovchart { display: block; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; color: inherit; text-decoration: none; min-width: 0; }
a.ovchart:hover, a.ovchart:focus-visible { border-color: var(--grey); }
.ovchart h3 { margin: 0; font-size: 15px; color: var(--ink); } .ovchart .keys { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; color: var(--ink2); margin: 4px 0 8px; }
.ovchart .keys i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-inline-end: 6px; vertical-align: -1px; }
.ovchart .keys i.a, svg.days .a { background: var(--blue); fill: var(--blue); } .ovchart .keys i.b, svg.days .b { background: var(--orange); fill: var(--orange); }
svg.days { display: block; width: 100%; height: auto; } svg.days .gl { stroke: var(--line); stroke-width: 1; } svg.days text { fill: var(--muted); font-size: 11px; }
.shipped { background: var(--card); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
.shipped a.node { border: 0; border-bottom: 1px solid var(--line); border-radius: 0; background: none; } .shipped a.node:last-child { border-bottom: 0; }
.shipped p { margin: 0; padding: 14px 16px; }
@media (max-width: 900px) {
  .map { grid-template-columns: minmax(0, 1fr); gap: 14px; padding: 16px; } .map svg.wires { display: none; }
  .alert { grid-template-columns: minmax(0, 1fr); } .alert .gos { justify-items: start; grid-auto-flow: column; justify-content: start; gap: 16px; } .alert a.go { min-height: 48px; }
  .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
`;

/** The Overview's markup, inside page.ts's #board. */
export const OVERVIEW_HTML = String.raw`
    <div id="start" hidden>
      <section aria-labelledby="ov-attention">
        <h2 class="oh" id="ov-attention">Needs attention <span class="said" id="hero-line" role="status"></span></h2>
        <div class="alerts" id="start-you"></div>
        <details class="resolved" id="start-resolved" hidden></details>
      </section>
      <section aria-labelledby="ov-glance"><h2 class="oh" id="ov-glance">At a glance</h2><div class="tiles" id="start-tiles"></div></section>
      <section aria-labelledby="ov-map"><h2 class="oh" id="ov-map">How it fits together</h2>
        <div class="mapcard"><div class="map" id="map"></div>
          <div class="mapkey"><span><i class="dot ok"></i>Working</span><span><i class="dot watch"></i>Watch</span><span><i class="dot problem"></i>Fix soon</span><span><i class="dot off"></i>Not connected</span><span><i class="dot error"></i>Could not read</span></div></div>
      </section>
      <section class="ovcharts" id="start-charts" aria-label="The last 14 days"></section>
      <section aria-labelledby="ov-shipped"><h2 class="oh" id="ov-shipped">Merged lately <a class="more" href="#g/releases">Releases <span aria-hidden="true">→</span></a></h2><div class="shipped" id="start-shipped"></div></section>
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

/** The map: three columns of boxes. 'parts' give a box its state; 'lane' takes it from that store's builds instead. */
const MAP_COLS = [
  { title: 'People use', nodes: [
    { id: 'web', title: 'Web app', group: 'releases', icon: 'web', parts: ['code'] },
    { id: 'android', title: 'Android app', group: 'releases', icon: 'phones', parts: ['pipeline'], lane: 'android' },
    { id: 'ios', title: 'iPhone app', group: 'releases', icon: 'phones', parts: ['pipeline'], lane: 'ios' },
    { id: 'videos', title: 'Tutorial videos', group: 'tutorials', icon: 'tutorials', parts: ['videos', 'videofeedback'] }
  ] },
  { title: 'Runs on', nodes: [
    { id: 'workers', title: 'Cloudflare Workers', group: 'traffic', icon: 'traffic', parts: ['cloudflare', 'worker'] },
    { id: 'supabase', title: 'Supabase', group: 'database', icon: 'database', parts: ['database', 'dbdetail', 'supabase', 'cron'] },
    { id: 'eas', title: 'EAS', group: 'releases', icon: 'releases', parts: ['expo', 'adoption'] },
    { id: 'github', title: 'GitHub Actions', group: 'nightly', icon: 'merge', parts: ['nightly'] }
  ] },
  { title: 'Services', nodes: [
    { id: 'jobs', title: 'Server jobs', group: 'jobs', icon: 'jobs', parts: ['jobs', 'container', 'push', 'v2'] },
    { id: 'r2', title: 'Cloudflare R2', group: 'storage', icon: 'storage', parts: ['storage', 'capacity'] },
    { id: 'linear', title: 'Linear', group: 'userissues', icon: 'userissues', parts: ['userissues'] },
    { id: 'appstore', title: 'App Store Connect', group: 'stores', icon: 'stores', parts: ['appstore'] },
    { id: 'play', title: 'Google Play Console', group: 'stores', icon: 'stores', parts: ['googleplay'] },
    { id: 'youtube', title: 'YouTube', group: 'tutorials', icon: 'tutorials', parts: ['tutorials'] }
  ] }
];
const MAP_WIRES = [['web', 'workers'], ['web', 'supabase'], ['android', 'eas'], ['android', 'supabase'], ['ios', 'eas'], ['ios', 'supabase'], ['videos', 'github'],
  ['supabase', 'jobs'], ['workers', 'r2'], ['github', 'linear'], ['eas', 'appstore'], ['eas', 'play'], ['github', 'youtube']];

/** A box's state from its parts: its most urgent alert, else could not read, still loading, not connected, or working. */
function nodeState(results, parts, levels) {
  const got = parts.map((p) => results[p]);
  const alerts = got.filter(Boolean).flatMap((s) => s.alerts || []);
  const top = levels.find((l) => alerts.some((a) => (levels.includes(a.level) ? a.level : 'watch') === l));
  if (top) return top;
  if (got.some((s) => s && s.state === 'error')) return 'error';
  if (got.some((s) => !s)) return 'wait';
  if (got.every((s) => s.state === 'off')) return 'off';
  return 'ok';
}

/** One short fact under a box's name, from its own part; empty when that part has none to give. */
function nodeFact(id, results) {
  const d = (p) => okData(results, p);
  try {
    if (id === 'web' && d('code')) return new URL(d('code').live.url).host + (d('code').live.build ? ' serves ' + String(d('code').live.build).slice(0, 7) : ' does not answer');
    if (id === 'videos' && d('tutorials')) return nf(d('tutorials').waiting.length) + ' wait to publish';
    if (id === 'workers' && d('cloudflare')) return nf(d('cloudflare').workers.reduce((a, w) => a + Number(w.requests || 0), 0)) + ' requests in 24 h';
    if (id === 'supabase' && d('database')) return nf(d('database').connections) + ' of ' + nf(d('database').maxConnections) + ' connections';
    if (id === 'eas' && d('expo') && d('expo').builds[0]) return 'newest build: ' + String(d('expo').builds[0].platform).toLowerCase() + ', ' + String(d('expo').builds[0].status).toLowerCase();
    if (id === 'github' && d('nightly')) { const s = d('nightly').runs.flatMap((r) => r.suites || []); return s.length ? (s.length - s.filter((x) => x.failed || x.broke).length) + ' of ' + s.length + ' nightly suites passed' : ''; }
    if (id === 'jobs' && d('jobs')) { const bad = d('jobs').jobs.filter((j) => j.stale || j.streak >= 3).length; return nf(d('jobs').jobs.length) + ' jobs' + (bad ? ' · ' + bad + ' stopped or failing' : ''); }
    if (id === 'r2' && d('storage') && d('storage').r2 && !d('storage').r2.error) return nf(d('storage').r2.objects) + ' files';
    if (id === 'linear' && d('userissues')) return nf(d('userissues').open) + (Number(d('userissues').open) === 1 ? ' open issue' : ' open issues');
    if (id === 'appstore' && d('appstore') && d('appstore').versions[0]) return d('appstore').versions[0].version + ': ' + String(d('appstore').versions[0].state).toLowerCase().replace(/_/g, ' ');
    if (id === 'play' && d('googleplay') && d('googleplay').crash) return 'crashes ' + (d('googleplay').crash.userPerceived * 100).toFixed(2) + '%';
    if (id === 'youtube' && d('tutorials')) { const c = d('tutorials').channels; return c.filter((x) => x.connectedAt).length + ' of ' + c.length + ' channels connected'; }
  } catch { return ''; }
  return '';
}

const NODE_SAID = { urgent: 'Act now', problem: 'Fix soon', watch: 'Watch', error: 'Could not read', wait: 'Loading…', off: 'Not connected', ok: 'Working' };

/** Every box of the map with its state and the words under its name. */
function mapOf(results, levels) {
  const lanes = liveBuilds(okData(results, 'pipeline'));
  return MAP_COLS.map((col) => ({ title: col.title, nodes: col.nodes.map((n) => {
    let state = nodeState(results, n.parts, levels), fact = '';
    if (n.lane) {
      const lane = lanes.find((l) => l.id === n.lane);
      // A store's box follows that store's own builds: the other store's failed build is not its problem.
      if (okData(results, 'pipeline')) state = lane && lane.failed ? 'problem' : lane ? 'ok' : 'off';
      if (lane) fact = (lane.live ? 'build ' + lane.live + ' is live' : 'no live build seen') + (lane.failed ? ' · ' + lane.failed + ' failed' : lane.review ? ' · ' + lane.review + ' in review' : '');
    } else fact = nodeFact(n.id, results);
    return { id: n.id, title: n.title, group: n.group, icon: n.icon, state, said: NODE_SAID[state], sub: state === 'wait' || state === 'off' || state === 'error' ? NODE_SAID[state] : fact || NODE_SAID[state] };
  }) }));
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
const ALSO_SHOWN = 3;

/** Every card line is a merged fix that waits for its check. */
const fixing = (c) => Boolean(c.alerts && c.alerts.length) && waitingFixes(c.alerts) === c.alerts.length;

/** One row for a part's alerts of one kind: the most urgent leads, up to 3 more follow, the rest are counted. */
function alertRow(c) {
  const t = splitAlert(tidy(c.text));
  const link = safeLink(c.link);
  const lines = c.alerts || [];
  const also = c.more.slice(0, ALSO_SHOWN).map((x, i) => '<li>' + esc(splitAlert(tidy(x)).title) + fixHtml(lines[i + 1], true) + '</li>').join('');
  const rest = c.more.length - ALSO_SHOWN;
  // A row that needs a person has its part's own picture, on a wide screen: its runs or its list as squares, or its number over 14 days.
  const gl = c.level === 'watch' ? null : glanceOf(c.group);
  const pic = c.level === 'watch' ? '' : (SQUARES[c.part] ? squarePic(c.part, c.text) : listCardPic(c.part)) || (gl ? miniSvg(gl.s.values, gl.s.agg, 200, 48, gl.say) + '<small>' + esc(gl.said) + '</small>' : '');
  return '<div class="alert ' + c.level + (fixing(c) ? ' fixing' : '') + '">' + lvl(c.level, LEVEL[c.level].title) +
    '<div class="text"><b>' + esc(t.title) + '</b>' + fixHtml(lines[0]) +
    (also ? '<ul class="also">' + also + (rest > 0 ? '<li>' + num(rest) + ' more in ' + esc(titleOf(c.group)) + '</li>' : '') + '</ul>' : '') +
    (t.next ? '<p class="next"><b>Next:</b> ' + esc(t.next) + '</p>' : '') +
    '<div class="from">' + esc(whereOf(c)) + '</div></div><div class="pic">' + pic + '</div>' +
    '<div class="gos">' + goLink('#g/' + c.group, titleOf(c.group)) + (link ? goLink(link, 'Open the page', true) : '') + '</div></div>';
}

/** A row for work that waits on Claude or on a store, not on the person. */
function waitRow(who, title, from, group) {
  return '<div class="alert info">' + lvl('info', who) + '<div class="text"><b>' + esc(title) + '</b><div class="from">' + from + '</div></div><div class="pic"></div><div class="gos">' + goLink('#g/' + group, titleOf(group)) + '</div></div>';
}

let startQueued = false;
function renderStart() {
  if (startQueued) return;
  startQueued = true;
  requestAnimationFrame(() => { startQueued = false; drawNav(); drawStart(); });
}

function drawStart() {
  if ($('start').hidden) return;
  const plan = startPlan(SECTIONS, results, LEVELS);
  // A row whose every line waits for its check after a merged fix needs nobody now: it goes last, dashed.
  const needs = plan.cards.filter((c) => c.level !== 'watch').sort((a, b) => Number(fixing(a)) - Number(fixing(b)));
  const watch = plan.cards.filter((c) => c.level === 'watch');
  const count = (cs) => cs.reduce((n, c) => n + 1 + c.more.length, 0);
  const fixed = waitingFixes(needs.flatMap((c) => c.alerts || []));
  const needN = count(needs) - fixed, watchN = count(watch);
  const claude = claudeWork(userIssuesData());
  const store = storeWaits(results.pipeline && results.pipeline.state === 'ok' ? results.pipeline.data : null);
  const loading = plan.waiting.length;
  $('hero-line').textContent = [
    needN ? needN + (needN === 1 ? ' needs you.' : ' need you.') : loading ? 'Checking…' : 'Nothing needs you now.',
    fixed ? fixed + (fixed === 1 ? ' has a fix merged and waits' : ' have a fix merged and wait') + ' for a check.' : '',
    watchN ? watchN + ' to watch.' : '',
    loading ? loading + (loading === 1 ? ' section still loads.' : ' sections still load.') : ''
  ].filter(Boolean).join(' ');
  const rows = needs.map(alertRow).concat(watch.map(alertRow),
    claude.map((i) => waitRow(CLAUDE_WORK[i.state][0], i.title || i.issue || 'An issue',
      esc(CLAUDE_WORK[i.state][1]) + ' · ' + (i.pr ? '<a href="' + PR_URL + Number(i.pr) + '" target="_blank" rel="noopener">pull request ' + Number(i.pr) + '</a> · ' : '') + (safeLink(i.issueUrl) ? '<a href="' + esc(i.issueUrl) + '" target="_blank" rel="noopener">' + esc(i.issue || 'Linear') + '</a> · ' : '') +
      'filed ' + esc(ago(i.firstAt)) + (i.people ? ' · ' + num(i.people) + (i.people === 1 ? ' person' : ' people') : ''), 'userissues')),
    store.map((w) => waitRow('Store', w.lane + ' ' + (w.title || ''), 'Waits on Apple or Google · ' + esc(w.stage) + (w.at ? ' · ' + esc(ago(w.at)) : '') + (w.state ? ' · ' + esc(w.state) : ''), 'releases')));
  redraw($('start-you'), rows.join('') ||
    (loading ? '<p class="muted">Checking each section…</p>' : '<div class="alert clear">' + lvl('clear', 'All clear') + '<div class="text"><b>Nothing needs attention now.</b></div><div class="pic"></div><span></span></div>'));
  drawResolved();
  drawTiles();
  drawMap();
  drawOvCharts();
  drawShipped();
}

/** The lines the watch tied to Linear that this page no longer shows, under one closed heading. */
function drawResolved() {
  const ud = userIssuesData(), el = $('start-resolved');
  el.hidden = !ud || !ud.lines;
  if (el.hidden) return;
  const now = new Set(PARTS.flatMap((p) => ((results[p] && results[p].alerts) || []).map(watchKeyOf)));
  const answered = (part) => Boolean(results[part]) && results[part].state === 'ok';
  el.innerHTML = resolvedHtml(resolvedLines(ud, now, answered, KINDS, Date.now()));
}

function drawTiles() {
  redraw($('start-tiles'), tilesOf(results).map((t) => {
    const gl = t.spark ? glanceOf(t.spark) : null;
    return '<a class="tile" href="#g/' + esc(t.group) + '"><span class="l">' + esc(t.label) + '</span>' +
      '<span class="v' + (t.value === null ? ' none' : t.small ? ' sm' : '') + '">' + esc(t.value === null ? '–' : t.value) + '</span>' +
      '<span class="s">' + esc(t.sub) + '</span>' + (gl ? miniSvg(gl.s.values, gl.s.agg, 120, 24, gl.say) : '') + '</a>';
  }).join(''));
}

function drawMap() {
  const cols = mapOf(results, LEVELS);
  redraw($('map'), '<svg class="wires" aria-hidden="true"></svg>' + cols.map((col) => '<div class="col"><span>' + esc(col.title) + '</span>' +
    col.nodes.map((n) => '<a class="node ' + n.state + '" href="#g/' + esc(n.group) + '" data-node="' + n.id + '"><span class="ic">' + svgIcon(n.icon) + '</span>' +
      '<span class="txt"><b>' + esc(n.title) + '</b><small>' + esc(n.sub) + '</small></span><span class="dot ' + n.state + '" role="img" aria-label="' + esc(n.said) + '"></span></a>').join('') + '</div>').join(''));
  drawWires();
}

/** The lines between the boxes, from where the boxes are now; a phone stacks the boxes and hides them. */
function drawWires() {
  const map = $('map'), svg = map && map.querySelector('svg.wires');
  if (!svg || map.offsetParent === null || getComputedStyle(svg).display === 'none') return;
  const box = map.getBoundingClientRect();
  const at = (n) => { const el = map.querySelector('[data-node="' + n + '"]'); return el ? el.getBoundingClientRect() : null; };
  svg.innerHTML = MAP_WIRES.map(([a, b]) => {
    const p = at(a), q = at(b);
    if (!p || !q) return '';
    const x1 = p.right - box.left, y1 = p.top + p.height / 2 - box.top, x2 = q.left - box.left, y2 = q.top + q.height / 2 - box.top, m = (x1 + x2) / 2;
    return '<path d="M' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' C' + m.toFixed(1) + ',' + y1.toFixed(1) + ' ' + m.toFixed(1) + ',' + y2.toFixed(1) + ' ' + x2.toFixed(1) + ',' + y2.toFixed(1) + '"/>';
  }).join('');
}
let wireTimer = 0;
window.addEventListener('resize', () => { clearTimeout(wireTimer); wireTimer = setTimeout(drawWires, 150); });

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
  if (!days) { redraw($('start-charts'), '<p class="muted">' + esc(s ? (s.state === 'off' ? 'The charts are not connected.' : 'Could not read the charts.') : 'Loading the charts…') + '</p>'); return; }
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
