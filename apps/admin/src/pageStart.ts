/**
 * What the ops dashboard's first page decides (decisions.md 254,
 * docs/ops-dashboard-plan.md 5.0; pageOverview.ts draws it), each section's
 * own page with its numbers over a range of days, and the detail panel a
 * tapped bar opens. Plain
 * JavaScript run inside page.ts's script, after its helpers (esc, num, ms,
 * bytes, ago, api, short, results, SECTIONS, PART_TITLE, LEVEL, LEVELS,
 * setOpen, annotate), like pageOps.ts. Everything shown is escaped.
 *
 * Three views, by the address's hash: '' the Overview, '#g/<section>' one
 * section with its pictures and every table it had, '#all' every section on
 * one page as before. Nothing the page showed before goes away: a section's
 * own page and All hold every table.
 */

/** The start page's and the panel's look, inside page.ts's style element. */
export const START_CSS = String.raw`
form.look { display: flex; gap: 8px; margin: 0 0 16px; }
form.look input { flex: 1; }
svg.mini { display: block; width: 100%; height: auto; overflow: visible; }
svg.mini .b { fill: var(--primary); } svg.mini .b.z { fill: var(--line); } svg.mini .b.n { fill: none; }
svg.mini .ln { fill: none; stroke: var(--primary); stroke-width: 2; } svg.mini .ar { fill: var(--primary); opacity: .12; }
svg.mini .base { stroke: var(--line); stroke-width: 1; }
.hist { margin: 8px 0 4px; } .hist[hidden] { display: none; }
.ranges { display: flex; gap: 4px; flex-wrap: wrap; margin: 4px 0 8px; }
.ranges button { min-height: 40px; min-width: 56px; padding: 0 10px; }
.ranges button[aria-pressed="true"] { background: var(--primary); border-color: var(--primary); color: #fff; }
.charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)); gap: 12px; margin: 8px 0 12px; align-items: start; }
.chart { border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; min-width: 0; }
.chart .ct { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.chart .ct span { font-size: 13px; font-weight: 600; } .chart .ct b { font-size: 16px; white-space: nowrap; } .chart .ct b small { font-size: 12px; font-weight: 400; color: var(--muted); }
.chart svg { display: block; width: 100%; height: auto; margin: 6px 0 2px; cursor: pointer; touch-action: manipulation; }
.chart svg:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 4px; }
.chart svg .b { fill: var(--primary); } .chart svg .b.z { fill: var(--line); }
.chart svg .b.sel { fill: var(--amber); } .chart svg .ln { fill: none; stroke: var(--primary); stroke-width: 2; }
.chart svg .pt { fill: var(--primary); } .chart svg .pt.sel { fill: var(--amber); } .chart svg .gap { fill: var(--bg); }
.chart .ax { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); }
.chart .keys { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.chart .keys button { min-height: 32px; padding: 0 8px; font-size: 12px; font-weight: 400; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chart .keys button[aria-pressed="true"] { border-color: var(--primary); color: var(--primary); font-weight: 600; }
.chart.sqbox { grid-column: 1 / -1; }
.sqrows { display: grid; gap: 3px; margin: 8px 0 4px; width: fit-content; max-width: 100%; }
.sqrow { display: grid; grid-template-columns: minmax(0, 168px) minmax(0, 1fr); gap: 10px; align-items: center; }
.sqrow > span { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chart svg.sq { width: auto; max-width: 100%; height: auto; margin: 0; overflow: visible; }
svg.sq .q.ok { fill: var(--green); } svg.sq .q.part { fill: var(--amber); } svg.sq .q.fail { fill: var(--red); }
svg.sq .q.none { fill: none; stroke: var(--line); stroke-width: 1; } svg.sq .q.gap { fill: var(--bg); stroke: var(--line); stroke-dasharray: 2 2; }
svg.sq .q.sel { stroke: var(--primary); stroke-width: 2.5; }
svg.sq .mk { fill: none; stroke: var(--card); stroke-width: 1.6; stroke-linecap: round; pointer-events: none; } svg.sq .dt { fill: var(--card); pointer-events: none; }
.sqbox p.muted { font-size: 12px; margin: 2px 0; }
.sqleg { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11px; color: var(--muted); margin-top: 4px; }
.sqleg i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: -1px; margin-inline-end: 4px; }
.sqleg i.ok { background: var(--green); } .sqleg i.part { background: var(--amber); } .sqleg i.fail { background: var(--red); } .sqleg i.none { border: 1px solid var(--line); }
.pic .chart.sqbox { border: 0; padding: 0; } .sqbox.mini .ct { display: block; } .sqbox.mini .ct span, .sqbox.mini .ct b { display: block; font-size: 12px; }
.sqbox.mini .sqrow { grid-template-columns: minmax(0, 1fr); gap: 0; } .sqbox.mini .sqrow > span { font-size: 11px; color: var(--muted); }
#detail { position: fixed; z-index: 5; inset: 0 0 0 auto; width: min(480px, 100%); background: var(--card); border-inline-start: 1px solid var(--line); box-shadow: -8px 0 24px rgba(0,0,0,.15); overflow-y: auto; padding: 16px; }
#detail .head { position: sticky; top: -16px; background: var(--card); padding: 4px 0 8px; z-index: 1; display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; }
#detail .head h2 { flex: 1; min-width: 0; }
#detail h2 { font-size: 16px; } #detail .tools { flex-wrap: wrap; margin: 8px 0; }
#detail table { margin: 6px 0; } #detail td code { font-size: 11px; word-break: break-all; } #detail .when { white-space: nowrap; }
#detail details summary { cursor: pointer; color: var(--primary); }
@media (max-width: 640px) {
  .sqrow { grid-template-columns: minmax(0, 1fr); gap: 0; }
  #detail { inset: auto 0 0 0; width: 100%; max-height: 82vh; border-inline-start: 0; border-top: 1px solid var(--line); border-radius: 16px 16px 0 0; box-shadow: 0 -8px 24px rgba(0,0,0,.2); }
  #detail .keyed table { display: table; } #detail .keyed thead { display: table-header-group; } #detail .keyed tbody { display: table-row-group; }
  #detail .keyed tr { display: table-row; padding: 0; } #detail .keyed td, #detail .keyed td.n { display: table-cell; padding: 6px 8px; border-bottom: 1px solid var(--line); }
  #detail .keyed td.n { text-align: end; } #detail .keyed td::before { content: none; }
}
`;

/** The detail panel, inside page.ts's #board. */
export const START_HTML = String.raw`
    <aside id="detail" hidden role="dialog" aria-labelledby="detail-title"></aside>`;

/**
 * Pure helpers, no page state: apps/admin/test/start.test.ts runs them with
 * new Function, so what the start page decides is tested without a browser.
 */
export const START_LOGIC = String.raw`
/** An alert's first sentence says what is wrong; the rest, if any, what to do next. */
function splitAlert(text) {
  const t = String(text || '').trim();
  const m = /^(.+?[.!?])\s+(\S[\s\S]*)$/.exec(t);
  return m ? { title: m[1], next: m[2] } : { title: t, next: '' };
}

/**
 * Where each section lands on the start page. A part's alerts that need a
 * person (urgent, problem) make one card, led by its most urgent; its alerts
 * to watch make one line beside them. So a flood of alerts in one part (30
 * new error kinds) is still one card and one line, never 30. A section with
 * no alert is one OK line, or a line that waits while a part has not
 * answered. Every section with parts lands somewhere, so every part stays one
 * tap away.
 */
function startPlan(sections, results, levels) {
  const cards = [], ok = [], waiting = [];
  const rank = (l) => levels.indexOf(l);
  for (const g of sections) {
    if (!g.parts.length) continue;
    let any = false;
    for (const p of g.parts) {
      const s = results[p];
      if (!s) continue;
      const items = (s.alerts || []).map((a) => ({ level: levels.includes(a.level) ? a.level : 'watch', text: a.text, link: a.link, alert: a }));
      if (s.state === 'error') items.push({ level: 'watch', text: 'Could not read: ' + (s.error || 'unknown') + '.', alert: { key: 'unreadable', subject: p, level: 'watch' } });
      items.sort((a, b) => rank(a.level) - rank(b.level));
      for (const watch of [false, true]) {
        const these = items.filter((i) => (i.level === 'watch') === watch);
        if (!these.length) continue;
        any = true;
        cards.push({ level: these[0].level, group: g.id, part: p, text: these[0].text, link: these[0].link, more: these.slice(1).map((i) => i.text), alerts: these.map((i) => i.alert) });
      }
    }
    if (any) continue;
    if (g.parts.some((p) => !results[p])) waiting.push(g.id);
    else ok.push({ group: g.id, off: g.parts.filter((p) => results[p].state === 'off') });
  }
  cards.sort((a, b) => rank(a.level) - rank(b.level));
  return { cards, ok, waiting };
}

/** Builds in a store's review, from Where each build and update is (sources/pipeline.ts). */
function storeWaits(pipeline) {
  const out = [];
  for (const lane of (pipeline && pipeline.lanes) || []) {
    for (const st of lane.stages || []) {
      if (st.id !== 'review') continue;
      for (const c of st.cards || []) out.push({ lane: lane.id === 'ios' ? 'iPhone' : 'Android', title: c.title, stage: st.title, at: c.at, state: c.state });
    }
  }
  return out;
}

/** Problems the watch filed in Linear that are still open: Claude writes a draft fix for each new one (decisions.md 202). */
function claudeWork(userissues) {
  return ((userissues && userissues.issues) || []).filter((i) => i.verdict === 'filed' && !i.closedAt && !i.fixedAt);
}

/** A series' values as one number for the whole range: a count adds up, a level is its latest value. */
function rangeTotal(agg, values) {
  const v = (values || []).filter((x) => x !== null && x !== undefined).map(Number);
  if (!v.length) return null;
  return agg === 'max' ? v[v.length - 1] : v.reduce((a, b) => a + b, 0);
}

/**
 * A square for each bucket of each job (plan 5c): one row for each key of
 * the runs number, each square failed, did part of the work, ran, no run, or
 * not counted yet. A job count stays fixed as people grow, so one square each
 * stays small at any scale. Rows with a failure lead, then by name, Others last.
 */
function runSquares(hst, sq) {
  const of = (metric, key) => { const s = metric ? hst.series.find((x) => x.metric === metric && x.key === key) : null; return s ? s.values : []; };
  const rows = hst.series.filter((s) => s.metric === sq.runs && s.key !== '').map((s) => {
    const failed = of(sq.failed, s.key), partial = of(sq.partial, s.key);
    const cells = s.values.map((v, i) => hst.counted && hst.counted[i] === false ? 'gap'
      : Number(failed[i]) > 0 ? 'fail' : Number(partial[i]) > 0 ? 'part' : Number(v) > 0 ? 'ok' : 'none');
    return { key: s.key, cells, failed: cells.filter((c) => c === 'fail').length, partial: cells.filter((c) => c === 'part').length };
  });
  rows.sort((a, b) => Number(b.failed > 0) - Number(a.failed > 0) || Number(a.key === '_other') - Number(b.key === '_other') || a.key.localeCompare(b.key));
  return rows;
}

/**
 * The series one chart draws, from all of its number's series: the total and
 * its keys. A number counted only by key has no total (a first download's
 * time is counted for open and for fill, and the two never add up): its
 * chart then leads with its largest key, so the number still has a chart.
 */
function chartSeries(all, wanted) {
  const total = all.find((s) => s.key === '') || null;
  const size = (s) => (s.values || []).reduce((a, v) => a + (Number(v) || 0), 0);
  const lead = total || all.filter((s) => s.key !== '').sort((a, b) => size(b) - size(a))[0] || null;
  const shown = all.find((s) => s.key === (wanted || '')) || lead;
  // A key that counted nothing over the range has no button (ten buttons that say 0 hide the two that say something); the one shown keeps its own.
  const keys = all.filter((s) => s.key !== '' && (s === shown || (s.values || []).some((v) => Number(v) > 0)));
  return { total, keys, shown };
}

/**
 * What a chart's large number is of, said after it: a count's is the total of
 * the range ('in 14 days'); a level's is its newest bucket's ('today'), which
 * rangeTotal takes. at is the bucket that value is from and n how many buckets
 * there are: a level whose newest bucket has no value yet says nothing here,
 * and the page names the bucket it is from.
 */
function totalOf(agg, range, step, at, n) {
  if (agg !== 'max') return { '24h': 'in 24 h', '14d': 'in 14 days', '90d': 'in 90 days', '1y': 'in 1 year', all: 'in all time' }[range] || '';
  return at === n - 1 ? { hour: 'this hour', day: 'today', week: 'this week', month: 'this month' }[step] || '' : '';
}

/** A time of an hour or more in its two largest units ('16 h', '1 h 5 min', '3 days 4 h'): 960.0 min says little. */
function longTime(t) {
  const min = Math.round(t / 60000);
  if (min < 48 * 60) return Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + (min % 60) + ' min' : '');
  const h = Math.round(t / 3600000);
  return Math.floor(h / 24) + ' days' + (h % 24 ? ' ' + (h % 24) + ' h' : '');
}

/** A bucket's end: the next bucket's start, or one step after the last. */
function bucketEnd(buckets, i, step) {
  if (i + 1 < buckets.length) return buckets[i + 1];
  const d = new Date(buckets[i]);
  if (step === 'hour') d.setUTCHours(d.getUTCHours() + 1);
  else if (step === 'day') d.setUTCDate(d.getUTCDate() + 1);
  else if (step === 'week') d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString();
}
`;

/** The views, the start page, each section's numbers over a range, and the detail panel. */
export const START_SCRIPT = String.raw`
const RANGE_NAMES = { '24h': '24 h', '14d': '14 days', '90d': '90 days', '1y': '1 year', all: 'All' };
const RANGE_KEY = 'lq-ops-range';
let glanceData = null;
const histories = {};
function savedRange() { try { const r = localStorage.getItem(RANGE_KEY); return r && RANGE_NAMES[r] ? r : '14d'; } catch { return '14d'; } }
let range = savedRange();

// ---- the views -----------------------------------------------------------------------------
function view() {
  const h = location.hash.replace(/^#/, '');
  if (h === 'all') return { name: 'all' };
  const g = /^g\/([a-z0-9_]+)$/.exec(h);
  if (g && SECTIONS.some((s) => s.id === g[1])) return { name: 'group', id: g[1] };
  return { name: 'start' };
}
function route() {
  const v = view();
  $('start').hidden = v.name !== 'start';
  $('attention').hidden = v.name !== 'all';
  $('grid').hidden = v.name === 'start';
  $('expand-all').hidden = v.name !== 'all'; $('collapse-all').hidden = v.name !== 'all';
  drawNav();
  for (const s of SECTIONS) {
    const card = $('card-' + s.id);
    if (!card) continue;
    card.hidden = v.name === 'group' && s.id !== v.id;
    const hist = $('hist-' + s.id);
    if (hist) hist.hidden = v.name !== 'group';
    if (v.name === 'group' && s.id === v.id) setOpen(s.id, true);
    else if (v.name === 'all') applyOpen(s.id);
  }
  if (v.name === 'start') renderStart();
  if (v.name === 'group') { renderHist(v.id); window.scrollTo(0, 0); }
  if (v.name !== 'group') closeDetail();
}
window.addEventListener('hashchange', route);

// ---- the start page -------------------------------------------------------------------------
const titleOf = (id) => (SECTIONS.find((s) => s.id === id) || {}).title || id;
const safeLink = (l) => String(l || '').startsWith('https://') ? l : '';

/** A small picture of a section's number over the last 14 days: bars for a count, a line for a level. */
function miniSvg(values, agg, w, h) {
  const v = (values || []).map((x) => x === null || x === undefined ? null : Number(x));
  const max = Math.max(0, ...v.filter((x) => x !== null));
  if (!v.length) return '';
  const n = v.length, bw = w / n;
  if (agg === 'max') {
    const pts = v.map((x, i) => x === null ? null : [(i + 0.5) * bw, h - 2 - (max ? (x / max) * (h - 6) : 0)]).filter(Boolean);
    if (!pts.length) return '';
    const line = pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    return '<svg class="mini" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-hidden="true"><polygon class="ar" points="' + pts[0][0].toFixed(1) + ',' + h + ' ' + line + ' ' + pts[pts.length - 1][0].toFixed(1) + ',' + h + '"/><polyline class="ln" points="' + line + '"/></svg>';
  }
  return '<svg class="mini" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-hidden="true"><line class="base" x1="0" x2="' + w + '" y1="' + (h - 0.5) + '" y2="' + (h - 0.5) + '"/>' +
    v.map((x, i) => {
      const bh = x === null ? 0 : max ? Math.max(2, (x / max) * (h - 2)) : 2;
      return '<rect class="b' + (x === null ? ' n' : x === 0 ? ' z' : '') + '" x="' + (i * bw + 1).toFixed(1) + '" y="' + (h - bh).toFixed(1) + '" width="' + Math.max(1, bw - 2).toFixed(1) + '" height="' + bh.toFixed(1) + '"/>';
    }).join('') + '</svg>';
}

/** A section's 14-day picture and what it says, from /ops/api/glance. */
function glanceOf(groupId) {
  const want = GLANCE[groupId];
  if (!want || !glanceData) return null;
  const s = (glanceData.series || []).find((x) => x.part === want.part && x.metric === want.metric);
  if (!s) return null;
  const m = (METRIC[s.part] || {})[s.metric] || { label: s.metric };
  const total = rangeTotal(s.agg, s.values);
  const fmt = (x) => x === null ? '–' : m.unit === 'bytes' ? bytes(x) : m.unit === 'ms' ? ms(x) : num(x);
  const said = s.agg === 'max' ? m.label + ': ' + fmt(total) + ' today' : m.label + ': ' + fmt(total) + ' in 14 days';
  return { s, said };
}

const whereOf = (c) => titleOf(c.group) + (c.part && PART_TITLE[c.part] && c.part !== c.group ? ' · ' + PART_TITLE[c.part] : '');

// ---- a section's numbers over a range -------------------------------------------------------
const partsWithNumbers = (groupId) => (SECTIONS.find((s) => s.id === groupId) || { parts: [] }).parts.filter((p) => METRIC[p]);

function renderHist(groupId) {
  const el = $('hist-' + groupId);
  if (!el) return;
  const parts = partsWithNumbers(groupId);
  if (!parts.length) { el.innerHTML = ''; return; }
  el.innerHTML = '<div class="ranges" role="group" aria-label="Range of days">' + Object.keys(RANGE_NAMES).map((r) =>
    '<button type="button" data-range="' + r + '" aria-pressed="' + (r === range) + '">' + RANGE_NAMES[r] + '</button>').join('') + '</div>' +
    parts.map((p) => '<div id="charts-' + p + '"><h3 class="part">' + esc(chartTitle(p)) + '</h3><p class="muted">Loading…</p></div>').join('') +
    '<p class="muted">Tap a bar or a point for the records behind it.</p>';
  for (const p of parts) loadHistory(p, range).then((hst) => drawPart(p, hst)).catch((err) => {
    const box = $('charts-' + p);
    if (box) box.querySelector('p').outerHTML = '<p class="bad">Could not read: ' + esc(err.message) + '</p>';
  });
}

function loadHistory(part, r) {
  const k = part + '|' + r;
  if (!histories[k]) histories[k] = api('/ops/api/' + part + '?range=' + r).catch((err) => { delete histories[k]; throw err; });
  return histories[k];
}

/** A key as the page says it. A number can name its keys (keys in METRICS, as the kinds of a diagnostics record): part and m say which number. */
const keyName = (k, part, m) => k === '' ? 'All' : k === '_other' ? 'Others' : (((METRIC[part] || {})[m] || {}).keys || {})[k] || k;
/** A part's title over its charts. A title that names its own time gives it up there: the range says the time. */
function chartTitle(part) {
  const t = String(PART_TITLE[part] || part), own = ', ' + LAST_DAY;
  return (t.endsWith(own) ? t.slice(0, -own.length) : t) + ', ' + RANGE_NAMES[range];
}
/** The words after a chart's large number (totalOf): a level whose newest bucket has no value yet names the bucket its value is from. */
function totalSaid(s, hst) {
  let at = s.values.length - 1;
  while (at >= 0 && (s.values[at] === null || s.values[at] === undefined)) at--;
  if (at < 0) return '';
  return totalOf(s.agg, hst.range, hst.step, at, s.values.length) || (hst.step === 'hour' ? 'at ' : hst.step === 'day' ? 'on ' : 'in ') + bucketLabel(hst.buckets[at], hst.step);
}
const shownKey = {};

// ---- a square for each run (plan 5c) --------------------------------------------------------
const SQUARES = {
  jobs: { runs: 'runs', failed: 'failed', partial: 'partial', one: 'job', many: 'jobs' },
  cron: { runs: 'runs', failed: 'failed', one: 'database job', many: 'database jobs' }
};
const SQ_SAID = { ok: 'ran', part: 'did part of the work', fail: 'failed', none: 'no run', gap: 'not counted yet' };
const STEP_ONE = { hour: 'hour', day: 'day', week: 'week', month: 'month' };

/** One job's row: a square for each bucket. A failure has an x and part of the work a dot, so neither rests on color alone. */
function squareSvg(row, hst, r) {
  const n = row.cells.length, size = 10, gap = 2, s = size + gap, w = n * s - gap;
  let body = '';
  row.cells.forEach((c, i) => {
    const x = i * s;
    body += '<rect class="q ' + c + '" data-i="' + i + '" x="' + x + '" y="1" width="' + size + '" height="' + size + '" rx="2"/>';
    if (c === 'fail') body += '<path class="mk" d="M' + (x + 3) + ' 4L' + (x + 7) + ' 8M' + (x + 7) + ' 4L' + (x + 3) + ' 8"/>';
    else if (c === 'part') body += '<circle class="dt" cx="' + (x + 5) + '" cy="6" r="1.8"/>';
  });
  const said = [row.failed ? num(row.failed) + ' failed' : '', row.partial ? num(row.partial) + ' did part of the work' : ''].filter(Boolean).join(', ') || 'no failure';
  const label = keyName(row.key) + ', one square for each ' + STEP_ONE[hst.step] + ': ' + said + '. Tap a square, or use the arrow keys and Enter, for its runs.';
  return '<svg class="sq" width="' + (n * 15) + '" height="' + Math.round((size + 2) * 1.25) + '" viewBox="0 0 ' + w + ' ' + (size + 2) + '" tabindex="0" role="img" aria-label="' + esc(label) + '" data-key="' + esc(row.key) + '" data-n="' + n + '"' +
    (r ? ' data-range="' + esc(r) + '"' : '') + '>' + body + '</svg>';
}

/**
 * A part's runs as squares: a row for each job, rows with a failure first. max cuts the rows for a card; a job its alert names leads there.
 * only draws one job's row under its own title (the nightly R2 check is blob_reconcile's).
 */
function squaresBox(part, hst, r, max, alert, only) {
  const sq = SQUARES[part];
  const named = (row) => Boolean(alert) && row.key !== '_other' && String(alert).includes(row.key);
  const rows = runSquares(hst, sq).filter((row) => !only || row.key === only.key)
    .map((row, at) => ({ row, at })).sort((a, b) => Number(named(b.row)) - Number(named(a.row)) || a.at - b.at).map((x) => x.row);
  if (!rows.length) return '';
  const shown = max ? rows.slice(0, max) : rows;
  const bad = rows.filter((x) => x.failed).length;
  const step = STEP_ONE[hst.step];
  const head = only ? [rows[0].failed ? num(rows[0].failed) + ' failed' : '', rows[0].partial ? num(rows[0].partial) + ' did part of the work' : ''].filter(Boolean).join(' · ') || 'no failure'
    : num(rows.length) + ' ' + (rows.length === 1 ? sq.one : sq.many) + ' · ' + (bad ? num(bad) + ' with a failed run' : 'no failed run');
  const states = ['ok'].concat(sq.partial ? ['part'] : [], ['fail', 'none']);
  return '<div class="chart sqbox' + (max ? ' mini' : '') + '" data-part="' + esc(part) + '" data-metric="' + esc(sq.runs) + '">' +
    '<div class="ct"><span>' + esc(only ? only.title : PART_TITLE[part] || part) + ', a square for each ' + esc(step) + '</span><b>' + esc(head) + '</b></div>' +
    '<div class="sqrows">' + shown.map((row) => '<div class="sqrow"><span title="' + esc(keyName(row.key)) + '">' + esc(keyName(row.key)) + '</span>' + squareSvg(row, hst, r) + '</div>').join('') +
    '<div class="sqrow"><span></span><div class="ax"><span>' + esc(bucketLabel(hst.buckets[0], hst.step)) + '</span><span>' + esc(bucketLabel(hst.buckets[hst.buckets.length - 1], hst.step)) + ' UTC</span></div></div></div>' +
    (rows.length > shown.length ? '<p class="muted">' + num(rows.length - shown.length) + ' more ' + esc(sq.many) + ' in ' + esc(PART_TITLE[part] || part) + '.</p>' : '') +
    '<div class="sqleg">' + states.map((c) => '<span><i class="' + c + '"></i>' + esc(SQ_SAID[c].charAt(0).toUpperCase() + SQ_SAID[c].slice(1)) + '</span>').join('') + '</div></div>';
}

/** The last 24 hours of a part's runs as squares, for its card on the start page; '' when they cannot be read. */
const dayPics = {};
function squarePic(part, alert) {
  const hst = dayPics[part];
  if (hst === undefined) {
    dayPics[part] = null;
    loadHistory(part, '24h').then((h) => { dayPics[part] = h; renderStart(); }, () => { dayPics[part] = false; renderStart(); });
  }
  if (hst === null || hst === undefined) return '<p class="muted">Loading…</p>';
  return hst ? squaresBox(part, hst, '24h', 6, alert) : '';
}

function drawPart(part, hst) {
  const box = $('charts-' + part);
  if (!box || hst.range !== range) return;
  const metrics = Object.keys(METRIC[part]);
  const charts = metrics.map((m) => {
    const { total, keys, shown: s } = chartSeries(hst.series.filter((x) => x.metric === m), shownKey[part + '.' + m]);
    if (!s) return '';
    const unit = METRIC[part][m].unit;
    const fmt = (x) => x === null ? '–' : unit === 'bytes' ? bytes(x) : unit === 'ms' ? ms(x) : num(x);
    return '<div class="chart" data-part="' + esc(part) + '" data-metric="' + esc(m) + '"><div class="ct"><span data-help-key="metric:' + esc(part + '.' + m) + '">' + esc(METRIC[part][m].label) + '</span><b>' + esc(fmt(rangeTotal(s.agg, s.values))) + (totalSaid(s, hst) ? ' <small>' + esc(totalSaid(s, hst)) + '</small>' : '') + '</b></div>' +
      chartSvg(s, hst, part, m) +
      '<div class="ax"><span>' + esc(bucketLabel(hst.buckets[0], hst.step)) + '</span><span>' + esc(bucketLabel(hst.buckets[hst.buckets.length - 1], hst.step)) + '</span></div>' +
      (keys.length ? '<div class="keys">' + (total ? [total] : []).concat(keys).map((x) => '<button type="button" data-key="' + esc(x.key) + '" aria-pressed="' + (x.key === s.key) + '" title="' + esc(keyName(x.key, part, m)) + '">' +
        esc(keyName(x.key, part, m)) + ' · ' + esc(fmt(rangeTotal(x.agg, x.values))) + '</button>').join('') + '</div>' : '') +
      '</div>';
  }).join('');
  box.innerHTML = '<h3 class="part">' + esc(chartTitle(part)) + '</h3>' +
    (hst.counted.some((c) => !c) ? '<p class="muted">Some ' + (hst.step === 'hour' ? 'hours' : 'days') + ' are not counted yet: the job counts the last 90 days a few at a time.</p>' : '') +
    '<div class="charts">' + (SQUARES[part] ? squaresBox(part, hst, null, 0) : '') + (charts || '<p class="muted">Nothing counted yet.</p>') + '</div>';
}

function bucketLabel(iso, step) {
  if (!iso) return '';
  const d = new Date(iso);
  if (step === 'hour') return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
  if (step === 'month') return d.toLocaleDateString([], { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** One number over the range: a bar a bucket for a count, a line for a level; each bucket can be tapped. */
function chartSvg(s, hst, part, m) {
  const w = 300, h = 96, n = s.values.length, bw = w / n;
  const v = s.values.map((x) => x === null ? null : Number(x));
  const max = Math.max(0, ...v.filter((x) => x !== null));
  const label = METRIC[part][m].label + ', ' + RANGE_NAMES[range] + (s.key ? ', ' + keyName(s.key, part, m) : '');
  let body = '';
  hst.counted.forEach((c, i) => { if (!c) body += '<rect class="gap" x="' + (i * bw).toFixed(2) + '" y="0" width="' + bw.toFixed(2) + '" height="' + h + '"/>'; });
  if (s.agg === 'max') {
    const pts = v.map((x, i) => x === null ? null : [(i + 0.5) * bw, h - 4 - (max ? (x / max) * (h - 10) : 0), i]).filter(Boolean);
    body += '<polyline class="ln" points="' + pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '"/>';
    if (n <= 120) body += pts.map((p) => '<circle class="pt" data-i="' + p[2] + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3"/>').join('');
  } else {
    body += v.map((x, i) => {
      const bh = x === null ? 0 : max ? Math.max(1.5, (x / max) * (h - 4)) : 1.5;
      return x === null ? '' : '<rect class="b' + (x === 0 ? ' z' : '') + '" data-i="' + i + '" x="' + (i * bw + (bw > 4 ? 0.5 : 0)).toFixed(2) + '" y="' + (h - bh).toFixed(2) + '" width="' + Math.max(0.6, bw - (bw > 4 ? 1 : 0)).toFixed(2) + '" height="' + bh.toFixed(2) + '"/>';
    }).join('');
  }
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" tabindex="0" role="img" aria-label="' + esc(label) + '. Tap a bucket, or use the arrow keys and Enter, for its records." data-key="' + esc(s.key) + '" data-n="' + n + '">' + body + '</svg>';
}

/** Which bucket a tap or click is over, from where it is across the chart. */
function bucketAt(svg, clientX) {
  const r = svg.getBoundingClientRect();
  const n = Number(svg.dataset.n);
  return Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left) / r.width) * n)));
}

document.addEventListener('click', (e) => {
  const rb = e.target.closest && e.target.closest('.ranges button[data-range]');
  if (rb) {
    range = rb.dataset.range;
    try { localStorage.setItem(RANGE_KEY, range); } catch {}
    const v = view();
    if (v.name === 'group') renderHist(v.id);
    return;
  }
  const kb = e.target.closest && e.target.closest('.chart .keys button[data-key]');
  if (kb) {
    const chart = kb.closest('.chart');
    shownKey[chart.dataset.part + '.' + chart.dataset.metric] = kb.dataset.key;
    loadHistory(chart.dataset.part, range).then((hst) => drawPart(chart.dataset.part, hst));
    return;
  }
  // A list's squares (pageLists.ts) open their own detail.
  const svg = e.target.closest && e.target.closest('.chart:not(.lstbox) svg');
  if (svg) { openBucket(svg, bucketAt(svg, e.clientX)); return; }
  const lk = e.target.closest && e.target.closest('[data-lookup]');
  if (lk) { lookUp(lk.dataset.lookup); return; }
});
document.addEventListener('keydown', (e) => {
  const svg = e.target.closest && e.target.closest('.chart:not(.lstbox) svg');
  if (svg) {
    const n = Number(svg.dataset.n);
    const at = Number(svg.dataset.sel || n - 1);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); markBucket(svg, Math.max(0, Math.min(n - 1, at + (e.key === 'ArrowLeft' ? -1 : 1)))); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBucket(svg, at); }
  }
  if (e.key === 'Escape' && !$('detail').hidden) closeDetail();
});

function markBucket(svg, i) {
  svg.dataset.sel = String(i);
  for (const el of svg.querySelectorAll('.sel')) el.classList.remove('sel');
  const el = svg.querySelector('[data-i="' + i + '"]');
  if (el) el.classList.add('sel');
}

// ---- the detail panel -----------------------------------------------------------------------
let shown = null;
function closeDetail() {
  if ($('detail').hidden) return;
  $('detail').hidden = true;
  if (shown && shown.svg && document.contains(shown.svg)) shown.svg.focus();
  shown = null;
}

function openBucket(svg, i) {
  markBucket(svg, i);
  const chart = svg.closest('.chart');
  const part = chart.dataset.part, key = svg.dataset.key || '';
  // A failed square opens the failed runs, and one that did part of the work those runs; the rest open every run.
  const cell = svg.classList.contains('sq') ? svg.querySelector('rect[data-i="' + i + '"]') : null, sq = SQUARES[part];
  const metric = cell && sq && cell.classList.contains('fail') ? sq.failed : cell && sq && sq.partial && cell.classList.contains('part') ? sq.partial : chart.dataset.metric;
  // A card's squares show the last 24 hours, whatever range the section pages show.
  loadHistory(part, svg.dataset.range || range).then((hst) => {
    const from = hst.buckets[i], to = bucketEnd(hst.buckets, i, hst.step);
    shown = { svg, part, metric, key, from, to, step: hst.step, page: 0, rows: [], hst, i };
    drawDetail();
    $('detail').hidden = false;
    $('detail-close').focus();
    loadRows();
  });
}

function bucketValues(hst, metric, i) {
  return hst.series.filter((s) => s.metric === metric).map((s) => ({ key: s.key, value: s.values[i] }));
}

function drawDetail() {
  const d = shown;
  const m = METRIC[d.part][d.metric];
  const unit = m.unit;
  const fmt = (x) => x === null || x === undefined ? '–' : unit === 'bytes' ? bytes(x) : unit === 'ms' ? ms(x) : num(x);
  const when = (d.step === 'hour' ? bucketLabel(d.from, 'day') + ', ' + bucketLabel(d.from, 'hour') + ' to ' + bucketLabel(d.to, 'hour')
    : d.step === 'week' ? bucketLabel(d.from, 'day') + ' to ' + bucketLabel(new Date(new Date(d.to).getTime() - 1).toISOString(), 'day')
    : bucketLabel(d.from, d.step)) + ' (UTC)';
  const vals = bucketValues(d.hst, d.metric, d.i);
  $('detail').innerHTML = '<div class="head"><h2 id="detail-title">' + esc(m.label) + (d.key ? ' · ' + esc(keyName(d.key, d.part, d.metric)) : '') + '</h2>' +
    '<button type="button" id="detail-close" aria-label="Close the details">Close</button></div>' +
    '<p class="muted">' + esc(PART_TITLE[d.part] || d.part) + ' · ' + esc(when) + '</p>' +
    '<h3>In this ' + (d.step === 'hour' ? 'hour' : d.step === 'day' ? 'day' : d.step) + '</h3>' +
    '<div class="keyed">' + table([{ h: 'Which', v: (v) => esc(keyName(v.key, d.part, d.metric)) }, { h: 'Number', n: true, v: (v) => esc(fmt(v.value)) }], vals) + '</div>' +
    '<h3>Records behind it</h3><div id="detail-rows"><p class="muted">Loading…</p></div>';
  $('detail-close').addEventListener('click', closeDetail);
}

async function loadRows() {
  const d = shown;
  const q = '?metric=' + encodeURIComponent(d.metric) + '&key=' + encodeURIComponent(d.key) + '&from=' + encodeURIComponent(d.from) + '&to=' + encodeURIComponent(d.to) + '&page=' + d.page;
  try {
    const got = await api('/ops/api/' + d.part + '/detail' + q);
    if (shown !== d) return;
    d.rows = d.rows.concat(got.rows);
    d.more = got.more; d.note = got.note; d.source = got.source;
    drawRows();
  } catch (err) {
    if (shown === d) $('detail-rows').innerHTML = '<p class="bad">Could not read: ' + esc(err.message) + '</p>';
  }
}

/** One raw row as a table line: when, who (install or job), what, and the rest as compact JSON. */
function rowCells(r) {
  const at = r.received || r.started || r.created || r.looked;
  const who = r.install ? short(r.install) + ' <button type="button" class="link" data-lookup="' + esc(r.install) + '">Look up</button>'
    : r.job ? esc(r.job) : r.issue ? (safeLink(r.issueUrl) ? '<a href="' + esc(r.issueUrl) + '" target="_blank" rel="noopener">' + esc(r.issue) + '</a>' : esc(r.issue)) : r.id ? short(String(r.id)) : '–';
  const what = [r.kind, r.outcome, r.status, r.verdict, r.target, r.reason, r.update ? 'update ' + String(r.update).slice(0, 8) : '', r.ms !== undefined ? ms(r.ms) : '', r.error, r.title].filter(Boolean).map(String).join(' · ');
  const rest = {};
  for (const k of ['n', 't', 'message', 'org', 'stream', 'profile', 'at']) if (r[k] !== undefined) rest[k] = r[k];
  return [
    at ? '<span class="when" title="' + esc(ago(at)) + '">' + esc(new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZone: 'UTC' })) + '</span>' : '–',
    who,
    esc(what) + (Object.keys(rest).length ? '<br><code>' + esc(JSON.stringify(rest)) + '</code>' : '') + (r.stack ? '<details><summary>Stack</summary><pre>' + esc(r.stack) + '</pre></details>' : '')
  ];
}

function drawRows() {
  const d = shown;
  const box = $('detail-rows');
  box.innerHTML = (d.note ? '<p class="notice">' + esc(d.note) + '</p>' : '') +
    (d.rows.length ? table([{ h: 'When', v: (c) => c[0] }, { h: 'Who', v: (c) => c[1] }, { h: 'What', v: (c) => c[2] }], d.rows.map(rowCells)) : d.source === 'totals' ? '' : '<p class="muted">No records in this bucket.</p>') +
    '<p class="tools">' + (d.more ? '<button type="button" id="detail-more">Show 50 more</button>' : '') +
    (d.rows.length ? '<button type="button" id="detail-copy">Copy as JSON</button>' : '') + '</p>';
  annotate(box);
  if ($('detail-more')) $('detail-more').addEventListener('click', () => { d.page += 1; $('detail-more').disabled = true; loadRows(); });
  if ($('detail-copy')) $('detail-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(JSON.stringify({ part: d.part, metric: d.metric, key: d.key, from: d.from, to: d.to, rows: d.rows }, null, 2)); $('detail-copy').textContent = 'Copied'; }
    catch { $('detail-copy').textContent = 'Could not copy'; }
  });
}
`;
