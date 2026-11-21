/**
 * Each section's page leads with its summary, and keeps every detail it had
 * one tap away (docs/decisions/2026-11-21-ops-dashboard-summary-and-details.md).
 * The top line says the page's state in one sentence; then up to four numbers,
 * each with its usual range; the problems that need a person, as their cards
 * (pageCards.ts); what is on its way and what to watch, a row each that opens
 * its card; each number of the last 14 days as a row with its usual range, and
 * the numbers that stayed at zero as one line of chips. Under all of that, the
 * section's card as it was, closed, as "All the details": every table, chart,
 * source line and list. Plain JavaScript run inside page.ts's script after
 * pageCards.ts; everything shown is escaped.
 */

/** The look, inside page.ts's style element. */
export const SUMMARY_CSS = String.raw`
.top .tt { flex: 1; min-width: 200px; }
.top .tt h1 { flex: none; min-width: 0; }
p.verdict { display: flex; align-items: flex-start; gap: 9px; margin: 8px 0 0; font-size: 16px; line-height: 1.4; color: var(--ink2); font-weight: 500; max-width: 760px; }
p.verdict:empty { display: none; }
.vmark { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; flex: none; background: var(--grey); }
.vmark svg { width: 13px; height: 13px; stroke: #fff; stroke-width: 3; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.vmark.ok { background: var(--green); } .vmark.watch { background: var(--amber); } .vmark.need { background: var(--red); } .vmark.wait { background: var(--line); }
#sum { display: grid; gap: 22px; margin-bottom: 22px; }
#sum:empty { display: none; }
.sblock { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 18px 22px; box-shadow: var(--sh); min-width: 0; }
.sh { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; flex-wrap: wrap; }
.sh h2 { font-size: 17px; letter-spacing: -.01em; margin: 0; }
.sh .sp { flex: 1; }
.cnt { font-size: 12px; font-weight: 700; padding: 2px 9px; border-radius: 99px; background: var(--soft); color: var(--ink2); }
.cnt.need { background: var(--redbg); color: var(--red); } .cnt.watch { background: var(--amberbg); color: var(--amber); } .cnt.way { background: var(--soft); color: var(--primary); }
.stiles { display: grid; gap: 14px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr)); }
@media (max-width: 640px) { .stiles { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } .stile { padding: 12px; } .stile .v { font-size: 24px; } }
.stile { display: grid; align-content: start; gap: 2px; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 14px 18px 12px; box-shadow: var(--sh); min-width: 0; color: inherit; text-decoration: none; font: inherit; text-align: start; cursor: pointer; }
.stile:hover, .stile:focus-visible { border-color: var(--grey); }
.stile .lb { font-size: 12.5px; color: var(--muted); font-weight: 500; }
.stile .v { font-size: 30px; font-weight: 700; letter-spacing: -.02em; line-height: 1.15; overflow-wrap: anywhere; }
.stile .v small { font-size: 13px; color: var(--muted); font-weight: 500; margin-inline-start: 4px; letter-spacing: 0; }
.stile .v.none { font-size: 16px; color: var(--muted); font-weight: 500; padding-top: 8px; }
.stile svg.spk { margin-top: 6px; }
.stile .ft { font-size: 12px; color: var(--muted); margin-top: 4px; }
.said { font-weight: 650; } .said.ok { color: var(--green); } .said.warn { color: var(--amber); } .said.note { color: var(--ink2); } .said.none { color: var(--muted); font-weight: 500; }
svg.spk { display: block; width: 100%; height: auto; overflow: visible; color: var(--primary); }
svg.spk .band { fill: var(--green); opacity: .11; } svg.spk .ar { fill: currentColor; opacity: .08; }
svg.spk .ln { fill: none; stroke: currentColor; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
svg.spk .end { fill: currentColor; stroke: var(--card); stroke-width: 2; }
svg.spk.warn { color: var(--amber); } svg.spk.bad { color: var(--red); }
.hrows { display: grid; }
.hrow { all: unset; box-sizing: border-box; display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(90px, .6fr) minmax(0, 1.2fr) minmax(130px, .7fr); gap: 16px; align-items: center; padding: 11px 6px; border-top: 1px solid var(--line); cursor: pointer; border-radius: 8px; }
.hrow:first-child { border-top: 0; }
.hrow:hover { background: var(--soft); } .hrow:focus-visible { outline: 2px solid var(--primary); outline-offset: -2px; }
.hrow .nm { font-weight: 600; font-size: 14px; } .hrow .nm small { display: block; font-weight: 400; font-size: 12px; color: var(--muted); }
.hrow .big { font-size: 19px; font-weight: 700; letter-spacing: -.01em; white-space: nowrap; } .hrow .big small { display: block; font-size: 11.5px; font-weight: 400; color: var(--muted); letter-spacing: 0; }
.hrow .vd { text-align: end; font-size: 13px; } .hrow .vd small { display: block; color: var(--muted); font-size: 12px; }
.hrow svg.spk { max-height: 46px; }
.quiet { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12.5px; color: var(--muted); margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line); }
.quiet:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
.chip { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 99px; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px; background: var(--soft); color: var(--ink2); }
.chip.ok { background: var(--greenbg); color: var(--green); } .chip.watch { background: var(--amberbg); color: var(--amber); } .chip.need { background: var(--redbg); color: var(--red); } .chip.way { background: var(--soft); color: var(--primary); }
details.srow { border-top: 1px solid var(--line); }
details.srow:first-of-type { border-top: 0; }
details.srow > summary { list-style: none; display: grid; grid-template-columns: 5px minmax(0, 1fr) auto; gap: 0 14px; align-items: center; padding: 11px 0; cursor: pointer; min-height: 48px; }
details.srow > summary::-webkit-details-marker { display: none; }
details.srow > summary .bar { align-self: stretch; border-radius: 3px; background: var(--line); }
details.srow.watch > summary .bar { background: var(--yellow); } details.srow.way > summary .bar { background: var(--primary); } details.srow.need > summary .bar { background: var(--red); }
details.srow > summary b { font-weight: 600; font-size: 14.5px; display: block; }
details.srow > summary .m { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; font-size: 12.5px; color: var(--muted); margin-top: 2px; }
details.srow > summary .m .fx { font-size: 12.5px; }
details.srow > summary .open { font-size: 13px; font-weight: 600; color: var(--primary); white-space: nowrap; }
details.srow[open] > summary .open .o, details.srow:not([open]) > summary .open .c { display: none; }
details.srow > .icards { margin: 0 0 12px; }
ol.msteps { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 0; list-style: none; margin: 6px 0 0; padding: 0; font-size: 11.5px; font-weight: 560; color: var(--grey); }
ol.msteps li { display: inline-flex; align-items: center; gap: 5px; }
ol.msteps li + li::before { content: ''; width: 18px; height: 1.6px; background: var(--line); margin: 0 6px; }
ol.msteps li i { width: 9px; height: 9px; border-radius: 50%; border: 1.6px solid var(--grey); background: var(--card); flex: none; }
ol.msteps li.done { color: var(--ink2); } ol.msteps li.done i { background: var(--green); border-color: var(--green); } ol.msteps li.done + li::before { background: var(--green); }
ol.msteps li.now { color: var(--primary); } ol.msteps li.now i { border-color: var(--primary); border-style: dashed; }
ol.msteps li.fail { color: var(--red); } ol.msteps li.fail i { background: var(--red); border-color: var(--red); box-shadow: 0 0 0 3px var(--redbg); }
.sempty { margin: 0; color: var(--muted); }
button.chip { min-height: 28px; border: 0; padding: 3px 10px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; }
.chart.hit { box-shadow: 0 0 0 3px var(--primary); transition: box-shadow .3s; }
/* A section's own page: its card is All the details, closed until a tap. */
.card .head .gt { display: inline; } .card .head .dt { display: none; }
.view-group .card > .head h2 { display: block; } .view-group .card .head .gt { display: none; } .view-group .card .head .dt { display: inline; }
.view-group .card > .head .pill { display: none; } .view-group .card > .head { cursor: pointer; }
.view-group .card.collapsed .src { display: block; } .view-group .grid > .card { grid-column: 1 / -1; } .card.collapsed > .hist { display: none; }
@media (max-width: 900px) {
  .hrow { grid-template-columns: minmax(0, 1fr) auto; } .hrow svg.spk { grid-column: 1 / -1; grid-row: 2; } .hrow .vd { grid-column: 1 / -1; text-align: start; }
  .sblock { padding: 14px 14px; }
}
`;

/** Pure: apps/admin/test/summary.test.ts runs these with new Function. */
export const SUMMARY_LOGIC = String.raw`
/**
 * The usual range of a number, from its days before the newest: the lowest
 * and the highest, less the one most far out at each end when there are ten
 * days or more, so one odd day does not stretch it. null with fewer than five
 * days counted.
 */
function usualOf(values) {
  const v = (values || []).filter((x) => x !== null && x !== undefined).map(Number);
  if (v.length < 5) return null;
  const s = v.slice().sort((a, b) => a - b);
  const cut = s.length >= 10 ? 1 : 0;
  return [s[cut], s[s.length - 1 - cut]];
}

/** A value against its usual range. */
function comparedTo(value, usual) {
  if (value === null || value === undefined || !usual) return 'none';
  return value > usual[1] ? 'high' : value < usual[0] ? 'low' : 'normal';
}

/** A number that is worse when it goes up: a failure, an error, a wait, a slow time, something lost or refused. */
const WORSE_UP = /fail|error|crash|refused|trouble|lost|slow|stamped|mismatch|wait|delay|_ms$|deletion|report|partial/;

/**
 * What a number of the last 14 days says. The newest bucket is today, not
 * over yet, so a count is read from the last full day, against the days
 * before it; a level (a size, a time) is its newest value. A size says how
 * much it grew a day. zero: it counted nothing in the whole range.
 */
function healthOf(series, metric, unit, counted) {
  const vals = (series && series.values || []).map((x) => x === null || x === undefined ? null : Number(x));
  const ok = (i) => vals[i] !== null && (!counted || counted[i] !== false);
  const n = vals.length;
  const level = series && series.agg === 'max';
  let at = level ? n - 1 : n - 2;
  while (at >= 0 && !ok(at)) at--;
  const zero = n > 0 && vals.every((x) => !x);
  if (at < 0) return { value: null, at: -1, usual: null, said: 'none', tone: 'none', zero, grow: null };
  const value = vals[at];
  const before = vals.slice(0, at).filter((x, i) => ok(i));
  if (unit === 'bytes') {
    const first = vals.findIndex((x, i) => ok(i));
    const grow = at > first && first >= 0 ? (value - vals[first]) / (at - first) : null;
    return { value, at, usual: null, said: 'grow', tone: 'note', zero, grow };
  }
  const usual = usualOf(before);
  const said = comparedTo(value, usual);
  const worse = WORSE_UP.test(metric);
  const tone = said === 'normal' ? 'ok' : said === 'none' ? 'none' : (said === 'high') === worse ? 'warn' : 'note';
  return { value, at, usual, said, tone, zero, grow: null };
}

/** The words for healthOf's said. */
const HEALTH_SAID = { normal: 'Normal', high: 'Higher than usual', low: 'Lower than usual', none: 'No usual range yet', grow: 'Grows' };

/**
 * Where a line belongs on a summary: 'need' (it needs a person: Act now or
 * Fix soon), 'decide' (a choice a person makes, at Watch), 'way' (its fix is
 * merged and waits for the check that clears it) or 'watch'.
 */
function lineBucket(level, fixState) {
  if (fixState === 'merged') return 'way';
  if (level === 'urgent' || level === 'problem') return 'need';
  return fixState === 'person' ? 'decide' : 'watch';
}

/**
 * The sentence under a page's title, from how many of its lines are in each
 * bucket and what its parts answered. It says only what is known: a page that
 * still loads says so, and "works" needs every part connected and read.
 */
function verdictOf(c) {
  const n = (k, one, many) => c[k] + ' ' + (c[k] === 1 ? one : many);
  const out = [];
  if (c.need) out.push(n('need', 'problem needs you.', 'problems need you.'));
  if (c.decide) out.push(n('decide', 'choice waits for you.', 'choices wait for you.'));
  if (c.way) out.push(n('way', 'fix is merged and waits for its check.', 'fixes are merged and wait for their check.'));
  if (c.watch) out.push(n('watch', 'thing to watch.', 'things to watch.'));
  if (c.unread) out.push(n('unread', 'part could not be read.', 'parts could not be read.'));
  if (!out.length) {
    if (c.loading) return { tone: 'wait', text: 'Checking…' };
    if (c.off && c.off === c.parts) return { tone: 'wait', text: 'Not connected.' };
    // Only what the checks found: no line is not proof that all works.
    out.push('Nothing needs you.' + (c.off ? ' ' + n('off', 'part is not connected.', 'parts are not connected.') : ''));
    return { tone: 'ok', text: out.join(' ') };
  }
  if (c.loading) out.push(n('loading', 'part still loads.', 'parts still load.'));
  return { tone: c.need ? 'need' : c.decide || c.watch || c.unread ? 'watch' : 'ok', text: out.join(' ') };
}

/**
 * The numbers a section's page shows in its tiles, at most four, by part and
 * number (sources/history.ts METRICS). The page's other numbers are rows.
 */
const PAGE_TILES = {
  phones: [['clients', 'installs'], ['clients', 'errors'], ['clients', 'crashes'], ['clients', 'sync_errors']],
  people: [['people', 'active_accounts'], ['people', 'new_accounts'], ['people', 'new_organizations'], ['people', 'invites_redeemed']],
  safety: [['safety', 'new_events'], ['safety', 'refused'], ['safety', 'upload_delay_p95_ms'], ['safety', 'canary_mismatched']],
  jobs: [['jobs', 'runs'], ['jobs', 'failed'], ['jobs', 'partial'], ['jobs', 'p95_ms']],
  traffic: [['worker', 'requests'], ['worker', 'server_errors'], ['worker', 'slow'], ['worker', 'refused']],
  storage: [['capacity', 'db_bytes'], ['capacity', 'events_bytes'], ['storage', 'lost_files_installs'], ['storage', 'lost_recordings_installs']],
  support: [['support', 'feedback'], ['support', 'content_reports'], ['support', 'account_deletions']],
  access: [['integrations', 'webhook_deliveries']],
  userissues: [['userissues', 'looked_at_first']]
};
`;

/** Drawing; uses the page's helpers (esc, num, ms, bytes, day, redraw, annotate, lineCard, fixOf, fixHtml, lineWay, LINE_STEPS, loadHistory, METRIC, view, setOpen) and its state. */
export const SUMMARY_SCRIPT = String.raw`
const VI_SHAPE = { ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', need: '<path d="M12 6v7M12 17.5v.5"/>', watch: '<path d="M12 6v7M12 17.5v.5"/>', wait: '' };
/** The round mark before a verdict: a check when all works, ! when a person is needed or should look. */
const verdictMark = (tone) => '<span class="vmark ' + tone + '" aria-hidden="true"><svg viewBox="0 0 24 24">' + (VI_SHAPE[tone] || '') + '</svg></span>';
function sayVerdict(v) {
  const el = $('view-say');
  if (!el) return;
  const html = v ? verdictMark(v.tone) + '<span>' + esc(v.text) + '</span>' : '';
  if (el.dataset.said !== html) { el.innerHTML = html; el.dataset.said = html; }
}

/** A number in its unit. */
const fmtUnit = (unit) => (x) => x === null || x === undefined ? '–' : unit === 'bytes' ? bytes(x) : unit === 'ms' ? ms(x) : num(x);

/**
 * A small line of 14 days, with the usual range as a pale band behind it, so
 * a glance says whether the newest day is in it. The newest bucket, not over
 * yet, is left out of a count's line.
 */
function sparkSvg(values, usual, tone, w, h) {
  const v = (values || []).map((x) => x === null || x === undefined ? null : Number(x));
  const pts0 = v.map((x, i) => x === null ? null : [i, x]).filter(Boolean);
  if (pts0.length < 2) return '';
  const all = pts0.map((p) => p[1]).concat(usual || []);
  const hi = Math.max(...all), lo0 = Math.min(...all);
  // A level far from zero (a size) is drawn from near its lowest, so its change shows.
  const lo = lo0 > 0 && lo0 > hi * 0.3 ? lo0 - (hi - lo0) * 0.6 : 0;
  const span = (hi - lo) * 1.15 || 1;
  const n = v.length;
  const x = (i) => 4 + (i * (w - 8)) / Math.max(1, n - 1), y = (val) => h - 4 - ((val - lo) / span) * (h - 8);
  const pts = pts0.map((p) => x(p[0]).toFixed(1) + ',' + y(p[1]).toFixed(1)).join(' ');
  const last = pts0[pts0.length - 1];
  const band = usual ? '<rect class="band" x="0" y="' + y(usual[1]).toFixed(1) + '" width="' + w + '" height="' + Math.max(2, y(usual[0]) - y(usual[1])).toFixed(1) + '" rx="4"/>' : '';
  return '<svg class="spk ' + (tone || '') + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' + band +
    '<polygon class="ar" points="' + x(pts0[0][0]).toFixed(1) + ',' + (h - 4) + ' ' + pts + ' ' + x(last[0]).toFixed(1) + ',' + (h - 4) + '"/>' +
    '<polyline class="ln" points="' + pts + '"/><circle class="end" cx="' + x(last[0]).toFixed(1) + '" cy="' + y(last[1]).toFixed(1) + '" r="3.5"/></svg>';
}

/** What a number of the last 14 days says, in a few words: Normal · usual 40 to 65. */
function healthWords(h, unit) {
  const f = fmtUnit(unit);
  if (h.said === 'grow') return { said: h.grow === null ? 'No change counted' : h.grow > 0 ? 'Grows' : h.grow < 0 ? 'Shrinks' : 'Same size', more: h.grow ? 'about ' + f(Math.abs(h.grow)) + ' a day' : '' };
  return { said: HEALTH_SAID[h.said], more: !h.usual ? '' : h.usual[0] === h.usual[1] ? 'usual ' + f(h.usual[0]) : 'usual ' + f(h.usual[0]) + ' to ' + f(h.usual[1]) };
}

// ---- each part's 14 days, for the summary --------------------------------------------------
const sumHist = {};
const sumAsked = new Set();
/** A part's 14 days, read once and again on each refresh; the old answer stays on the page until the new one comes. */
function sumHistory(part, again) {
  if (sumAsked.has(part) && !again) return sumHist[part] || null;
  sumAsked.add(part);
  loadHistory(part, '14d').then((h) => { sumHist[part] = h; drawSummary(); renderStart(); }, (err) => { if (!sumHist[part]) sumHist[part] = { error: err.message }; drawSummary(); });
  return sumHist[part] || null;
}
/** One number's 14 days from its part's answer: its total, or its largest key when it has no total (chartSeries). */
function seriesOf(part, metric) {
  const hst = sumHist[part];
  if (!hst || hst.error || !hst.series) return null;
  const { shown } = chartSeries(hst.series.filter((s) => s.metric === metric), '');
  return shown ? { s: shown, hst } : null;
}
/** One number of the last 14 days, ready to draw: label, value, its day, what it says, and its line. */
function healthRow(part, metric) {
  const m = (METRIC[part] || {})[metric];
  const got = seriesOf(part, metric);
  if (!m || !got) return null;
  const h = healthOf(got.s, metric, m.unit, got.hst.counted);
  const words = healthWords(h, m.unit);
  const on = h.at < 0 ? '' : got.s.agg === 'max' && h.at === got.s.values.length - 1 ? 'now' : 'on ' + bucketLabel(got.hst.buckets[h.at], got.hst.step);
  const line = got.s.agg === 'max' ? got.s.values : got.s.values.slice(0, -1);
  return { part, metric, label: m.label, unit: m.unit, h, words, on, value: fmtUnit(m.unit)(h.value),
    spark: sparkSvg(line, h.usual, h.tone === 'warn' ? 'warn' : '', 240, 46), quiet: h.zero };
}

// ---- the lines of a page ---------------------------------------------------------------------
/** A section's lines, each with its part, its fix (pageFixes.ts) and its bucket (lineBucket). */
function groupLines(g) {
  const out = [];
  for (const p of g.parts) {
    const s = results[p];
    if (!s) continue;
    for (const a of s.alerts || []) {
      const line = Object.assign({ part: p }, a);
      const level = a.level in LEVEL ? a.level : 'watch';
      const f = a.key === 'user-issues-open' ? null : fixOf(line);
      out.push({ a: line, level, f, bucket: lineBucket(level, f ? f.state : '') });
    }
    if (s.state === 'error') out.push({ a: { part: p, level: 'watch', key: 'unreadable', subject: p, text: 'Could not read ' + (PART_TITLE[p] || p) + ': ' + (s.error || 'unknown') + '.' }, level: 'watch', f: null, bucket: 'watch' });
  }
  const rank = (l) => LEVELS.indexOf(l.level);
  return out.sort((x, y) => rank(x) - rank(y));
}

/** How many of a section's lines are in each bucket, and what its parts answered: what verdictOf reads. */
function groupCounts(g, lines) {
  const c = { need: 0, decide: 0, way: 0, watch: 0, unread: 0, loading: 0, off: 0, parts: g.parts.length };
  for (const l of lines) { if (l.a.key === 'unreadable') c.unread++; else c[l.bucket]++; }
  for (const p of g.parts) { const s = results[p]; if (!s) c.loading++; else if (s.state === 'off') c.off++; }
  return c;
}

/** A line's steps in small: Found, In Linear, Fix written, Merged, Gone; a fix that did not work says Still here. */
function miniSteps(f) {
  if (!f) return '';
  const way = lineWay(f, false, false);
  if (!way.at) return '';
  const stuck = f.state === 'stuck';
  return '<ol class="msteps" aria-label="' + esc('Step ' + way.at + ' of ' + way.steps.length) + '">' + way.steps.map((st, i) => {
    const cls = i + 1 < way.at ? 'done' : i + 1 === way.at ? (stuck ? 'fail' : 'now') : '';
    // The step it waits at is not done yet: it says Next, so a dot never says a step is done when it is not.
    return '<li' + (cls ? ' class="' + cls + '"' : '') + '><i></i>' + esc(stuck && i + 1 === way.at ? 'Still here' : (cls === 'now' ? 'Next: ' : '') + st[0]) + '</li>';
  }).join('') + '</ol>';
}

/** A line as one row that opens its card: what is wrong, where, its fix, its steps. */
function lineRow(l, g, cls) {
  const t = splitAlert(tidy(l.a.text));
  return '<details class="srow ' + cls + '" data-row="' + esc(lineCardId(l.a)) + '"><summary><span class="bar"></span><span><b>' + esc(t.title) + '</b>' +
    '<span class="m"><span>' + esc(PART_TITLE[l.a.part] || titleOf(g.id)) + '</span>' + fixHtml(l.a, true) + '</span>' + miniSteps(l.f) + '</span>' +
    '<span class="open"><span class="o">Open</span><span class="c">Close</span></span></summary>' +
    '<div class="icards lcards">' + lineCard(l.a, g.id) + '</div></details>';
}

/** A page's blocks of its own (PRs that follow add them: the Releases page's stages, a job list): id to a function of the section, '' for none. */
const PAGE_BLOCKS = {};
/** A page's own sentence, said before the counts (Releases: where each build is); null to say only the counts. */
const PAGE_SAY = {};

/** Whether a section's page has a summary of its own above All the details: numbers, or a block of its own. */
const hasSummary = (id) => Boolean(PAGE_TILES[id] || PAGE_BLOCKS[id] || partsWithNumbers(id).length);

/** The tile for one number: its value on its last full day, its line and its usual range. */
function healthTile(r, label) {
  if (!r) return '';
  return '<button type="button" class="stile" data-chart="' + esc(r.part + '.' + r.metric) + '"><span class="lb" data-help-key="metric:' + esc(r.part + '.' + r.metric) + '">' + esc(label || r.label) + '</span>' +
    '<span class="v">' + esc(r.value) + (r.on ? '<small>' + esc(r.on) + '</small>' : '') + '</span>' + r.spark +
    '<span class="ft"><span class="said ' + r.h.tone + '">' + esc(r.words.said) + '</span>' + (r.words.more ? ' · ' + esc(r.words.more) : '') + '</span></button>';
}

/** A number as a row: name, value, line, what it says. */
function healthLine(r) {
  return '<button type="button" class="hrow" data-chart="' + esc(r.part + '.' + r.metric) + '"><span class="nm"><span data-help-key="metric:' + esc(r.part + '.' + r.metric) + '">' + esc(r.label) + '</span><small>' + esc(PART_TITLE[r.part] || r.part) + '</small></span>' +
    '<span class="big">' + esc(r.value) + (r.on ? '<small>' + esc(r.on) + '</small>' : '') + '</span>' + r.spark +
    '<span class="vd"><span class="said ' + r.h.tone + '">' + esc(r.words.said) + '</span>' + (r.words.more ? '<small>' + esc(r.words.more) + '</small>' : '') + '</span></button>';
}

const block = (title, count, cls, body) => '<section class="sblock"><div class="sh"><h2>' + esc(title) + '</h2>' + (count ? '<span class="cnt ' + cls + '">' + num(count) + '</span>' : '') + '<span class="sp"></span></div>' + body + '</section>';

let sumQueued = false;
/** Draws the summary of the section the page shows, once a frame at most. */
function drawSummary() {
  if (sumQueued) return;
  sumQueued = true;
  requestAnimationFrame(() => { sumQueued = false; drawSummaryNow(); });
}
function drawSummaryNow() {
  const v = view();
  const el = $('sum');
  if (!el) return;
  if (v.name !== 'group') { if (v.name === 'all') sayVerdict(null); redraw(el, ''); return; }
  const g = SECTIONS.find((s) => s.id === v.id);
  if (!g || !g.parts.length) { sayVerdict(null); redraw(el, ''); return; }
  const lines = groupLines(g);
  const c = groupCounts(g, lines);
  const own = PAGE_SAY[g.id] ? PAGE_SAY[g.id](g) : null;
  const verdict = verdictOf(c);
  sayVerdict(own ? { tone: verdict.tone, text: own + (verdict.tone === 'ok' && !c.off ? '' : ' ' + verdict.text) } : verdict);
  const parts = [];
  // Tiles: the page's first numbers, each with its usual range.
  const nums = partsWithNumbers(g.id);
  for (const p of nums) sumHistory(p);
  const tileKeys = (PAGE_TILES[g.id] || []).filter(([p, m]) => METRIC[p] && METRIC[p][m]);
  const tiles = tileKeys.map(([p, m]) => healthTile(healthRow(p, m))).join('');
  if (tiles) parts.push('<div class="stiles">' + tiles + '</div>');
  else if (tileKeys.length) parts.push('<div class="stiles">' + tileKeys.map(([p, m]) => '<div class="stile"><span class="lb">' + esc(METRIC[p][m].label) + '</span><span class="v none">' + esc(sumHist[p] && sumHist[p].error ? 'Could not read' : 'Loading…') + '</span></div>').join('') + '</div>');
  // The problems that need a person, and the choices: each as its card, as on the page before.
  const need = lines.filter((l) => l.bucket === 'need' || l.bucket === 'decide');
  if (need.length) parts.push(block('Needs you', need.length, 'need', '<div class="icards lcards">' + need.map((l) => lineCard(l.a, g.id)).join('') + '</div>'));
  if (PAGE_BLOCKS[g.id]) { const own = PAGE_BLOCKS[g.id](g); if (own) parts.push(own); }
  const way = lines.filter((l) => l.bucket === 'way');
  if (way.length) parts.push(block('On its way', way.length, 'way', way.map((l) => lineRow(l, g, 'way')).join('')));
  const watch = lines.filter((l) => l.bucket === 'watch');
  if (watch.length) parts.push(block('Watching', watch.length, 'watch', watch.map((l) => lineRow(l, g, 'watch')).join('')));
  // Every number of the last 14 days as a row; those that stayed at zero as chips.
  const shownTiles = new Set(tileKeys.map(([p, m]) => p + '.' + m));
  const rows = [], quiet = [];
  let waiting = false;
  for (const p of nums) {
    if (!sumHist[p]) { waiting = true; continue; }
    for (const m of Object.keys(METRIC[p])) {
      if (shownTiles.has(p + '.' + m)) continue;
      const r = healthRow(p, m);
      if (!r) continue;
      if (r.quiet) quiet.push(r); else rows.push(r);
    }
  }
  const errs = nums.filter((p) => sumHist[p] && sumHist[p].error);
  if (rows.length || quiet.length || waiting || errs.length) {
    parts.push(block('Each number, last 14 days', 0, '',
      (rows.length ? '<div class="hrows">' + rows.map(healthLine).join('') + '</div>' : '') +
      (quiet.length ? '<div class="quiet"><span>Checked, all at zero:</span>' + quiet.map((r) => '<button type="button" class="chip ok" data-chart="' + esc(r.part + '.' + r.metric) + '">✓ ' + esc(r.label) + '</button>').join('') + '</div>' : '') +
      (waiting ? '<p class="sempty">Loading…</p>' : '') +
      errs.map((p) => '<p class="bad">Could not read ' + esc(PART_TITLE[p] || p) + ': ' + esc(sumHist[p].error) + '</p>').join('')));
  }
  if (redraw(el, parts.join(''))) annotate(el);
  focusCard();
}

/** Opens All the details at one number's chart: the range buttons, every key and each bucket's records. */
function openChart(key) {
  const [part, metric] = key.split('.');
  const v = view();
  if (v.name !== 'group') return;
  setOpen(v.id, true);
  saveDetails(v.id, true);
  const go = () => {
    const chart = document.querySelector('#charts-' + part + ' .chart[data-metric="' + metric + '"]') || $('charts-' + part);
    if (!chart) return false;
    chart.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    chart.classList.add('hit');
    setTimeout(() => chart.classList.remove('hit'), 2600);
    return true;
  };
  if (!go()) setTimeout(go, 600);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('#sum [data-chart]');
  if (b) openChart(b.dataset.chart);
});

// ---- All the details: closed on a page with a summary, until a tap; each page keeps its own choice ----
const DETAILS_KEY = 'lq-ops-details';
function savedDetails() { try { return JSON.parse(localStorage.getItem(DETAILS_KEY) || '{}') || {}; } catch { return {}; } }
function saveDetails(id, open) { try { const s = savedDetails(); s[id] = open; localStorage.setItem(DETAILS_KEY, JSON.stringify(s)); } catch {} }
/** Pages whose lists are where a person works (an issue's card, a queue's buttons, a video's state): their details stay open until a page of their own replaces them. */
const DETAILS_LEAD = new Set(['userissues', 'research', 'support', 'tutorials', 'nightly']);
function detailsOpen(id) { const s = savedDetails()[id]; return typeof s === 'boolean' ? s : !hasSummary(id) || DETAILS_LEAD.has(id); }
`;
