/**
 * The blocks of their own that some section pages show in their summary
 * (pageSummary.ts PAGE_BLOCKS and PAGE_SAY;
 * docs/decisions/2026-11-21-ops-dashboard-summary-and-details.md): what a
 * person looks for first on that page, drawn from what its parts already
 * answered. Releases: where each store build is, the web app, who has the
 * newest update and the automatic jobs. App stores: crashes and freezes
 * against Google's line, the App Store's versions and the reviews. People:
 * the totals and who waits to join. Phones and browsers: what people use.
 * User issues, Research and Tutorial videos: where the work is, a box for
 * each tab of the list. Support: what waits on staff. Nightly tests: each
 * nightly's suites. Server jobs: each job in plain words. Database: what it
 * does now. Web traffic: each Worker. Storage and cost: the plan and this
 * month's use, and what keeps data safe. Keys and access: what expires next.
 * Every figure is a part's own; a part that did not answer gives no block.
 * Plain JavaScript run inside page.ts's script after pageSummary.ts and
 * pageCode.ts; everything shown is escaped.
 */
import { ANR_LINE, CRASH_LINE } from './sources/googleplay';
import { STALE_H } from './sources/nightly';
import { LONG_QUERY_S, LONG_XACT_S } from './sources/ops';
import { ALLOWANCE } from './sources/storage';
import { PROBLEM_DAYS, WARN_DAYS } from './sources/expiry';

export const BLOCKS_CSS = String.raw`
.lanes { display: grid; }
.blane { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 18px; align-items: start; padding: 16px 0; border-top: 1px solid var(--line); }
.blane:first-child { border-top: 0; padding-top: 4px; }
.blane > div:first-child b { display: block; font-size: 15px; } .blane > div:first-child small { color: var(--muted); font-size: 12px; }
.track { display: grid; position: relative; align-items: start; }
.track::before { content: ''; position: absolute; left: 8%; right: 8%; top: 9px; height: 2px; background: var(--line); }
.stg { display: flex; flex-direction: column; align-items: center; gap: 6px; position: relative; text-align: center; font-size: 12px; color: var(--muted); font-weight: 500; min-width: 0; }
.stg .dt { width: 20px; height: 20px; border-radius: 50%; background: var(--card); border: 2px solid var(--line); z-index: 1; }
.stg.live .dt { background: var(--green); border-color: var(--green); } .stg.wait .dt { background: var(--amber); border-color: var(--amber); box-shadow: 0 0 0 5px var(--amberbg); }
.stg.bad .dt { background: var(--red); border-color: var(--red); } .stg.busy .dt { background: var(--primary); border-color: var(--primary); }
a.bchip { font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 9px; background: var(--ink); color: #fff; white-space: nowrap; text-decoration: none; }
a.bchip small { font-weight: 500; opacity: .85; margin-inline-start: 4px; color: inherit; } a.bchip:hover, a.bchip:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
a.bchip.live { background: var(--green); } a.bchip.wait { background: var(--amber); } a.bchip.bad { background: var(--red); } a.bchip.busy { background: var(--primary); }
.webrow { display: flex; gap: 12px; align-items: flex-start; }
.webrow .mk { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; flex: none; color: #fff; font-weight: 700; font-size: 13px; background: var(--grey); }
.webrow .mk.ok { background: var(--green); } .webrow .mk.fail { background: var(--red); } .webrow .mk.run { background: var(--primary); }
.webrow b { display: block; } .webrow small { color: var(--muted); }
.bpair { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 22px; align-items: start; }
.mrows { display: grid; gap: 4px; }
.mrow { display: grid; grid-template-columns: minmax(110px, .8fr) minmax(0, 1.4fr) minmax(110px, auto); gap: 14px; align-items: center; padding: 9px 0; border-top: 1px solid var(--line); font-size: 14px; }
.mrow:first-child { border-top: 0; } .mrow > span:last-child { text-align: end; color: var(--muted); font-size: 13px; } .mrow > span:last-child b { color: var(--ink); }
.mrow a { color: var(--ink); font-weight: 600; text-decoration: none; } .mrow a:hover { text-decoration: underline; }
.mrow .sub { display: block; color: var(--muted); font-size: 12px; font-weight: 400; } .mrow .bad { color: var(--red); font-weight: 600; }
.gap { height: 12px; }
.jrows { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr)); gap: 0 28px; }
.jrow { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto; gap: 12px; align-items: center; padding: 10px 0; border-top: 1px solid var(--line); font-size: 14px; }
.jdot { width: 10px; height: 10px; border-radius: 50%; background: var(--green); } .jdot.warn { background: var(--amber); } .jdot.bad { background: var(--red); } .jdot.run { background: var(--primary); box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 20%, transparent); }
.jname b { display: block; font-weight: 600; } .jname small { font-size: 12.5px; }
.jnum { color: var(--muted); font-size: 13px; text-align: end; white-space: nowrap; } .jnum b { color: var(--ink); } .jnum .bad { color: var(--red); font-weight: 600; }
.mrow .warn { color: var(--amber); font-weight: 600; display: block; font-size: 12.5px; }
.meter { position: relative; height: 10px; border-radius: 99px; background: var(--soft); overflow: visible; display: flex; }
.meter > i { display: block; height: 100%; border-radius: 99px; background: var(--green); }
.meter > i.warn { background: var(--amber); } .meter > i.bad { background: var(--red); }
.meter > u { position: absolute; top: -4px; bottom: -4px; width: 2px; background: var(--ink); border-radius: 1px; }
.stack { display: flex; height: 26px; border-radius: 8px; overflow: hidden; gap: 2px; }
.stack > i { display: block; height: 100%; min-width: 4px; }
.stack .android { background: var(--green); } .stack .ios { background: var(--primary); } .stack .web { background: var(--grey); } .stack .other { background: var(--amber); }
.skey { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 12.5px; color: var(--ink2); margin-top: 10px; }
.skey span { display: inline-flex; gap: 6px; align-items: center; } .skey i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.skey i.android { background: var(--green); } .skey i.ios { background: var(--primary); } .skey i.web { background: var(--grey); } .skey i.other { background: var(--amber); }
.facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 160px), 1fr)); gap: 12px; }
.fact { background: var(--bg); border-radius: 12px; padding: 10px 14px; } .fact b { display: block; font-size: 22px; font-weight: 700; letter-spacing: -.01em; } .fact span { font-size: 12.5px; color: var(--muted); }
.fact.warn b { color: var(--amber); }
.stars { color: var(--amber); letter-spacing: 1px; }
.wstrip { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 1fr)); gap: 10px; }
button.wst { text-align: start; background: var(--bg); border: 1px solid var(--line); border-radius: 12px; padding: 10px 14px; cursor: pointer; font: inherit; color: inherit; }
button.wst b { display: block; font-size: 24px; font-weight: 700; letter-spacing: -.01em; } button.wst span { font-size: 12.5px; color: var(--muted); }
button.wst:hover, button.wst:focus-visible { border-color: var(--primary); outline: none; }
button.wst.you { border-color: var(--primary); box-shadow: inset 4px 0 0 var(--primary); } button.wst.you b { color: var(--primary); }
.lchip { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 600; padding: 4px 10px; border-radius: 99px; background: var(--soft); color: var(--ink2); }
.lchip.ok { background: var(--greenbg); color: var(--green); } .lchip.warn { background: var(--amberbg); color: var(--amber); } .lchip.off { color: var(--muted); }
@media (max-width: 900px) { .blane { grid-template-columns: minmax(0, 1fr); gap: 10px; } .mrow { grid-template-columns: minmax(0, 1fr) auto; } .mrow .meter { grid-column: 1 / -1; grid-row: 2; } }
`;

/** Pure: apps/admin/test/blocks.test.ts runs these with new Function. */
export const BLOCKS_LOGIC = String.raw`
const CRASH_LINE = ${CRASH_LINE}, ANR_LINE = ${ANR_LINE}, NIGHT_STALE_H = ${STALE_H};
const LONG_QUERY_S = ${LONG_QUERY_S}, LONG_XACT_S = ${LONG_XACT_S}, ALLOWANCE = ${JSON.stringify(ALLOWANCE)}, EXPIRY_PROBLEM_DAYS = ${PROBLEM_DAYS}, EXPIRY_WARN_DAYS = ${WARN_DAYS};
const TONE_RANK = ['bad', 'wait', 'busy', 'live'];
/** A store's name, and who reviews in it. */
const LANE_NAME = { ios: ['iPhone', 'App Store', 'Apple'], android: ['Android', 'Google Play', 'Google'] };

/**
 * Each store's builds as a track: every stage with the tone of its most
 * pressing build, and its builds. Where each build and update is
 * (sources/pipeline.ts) holds the same builds with their updates.
 */
function laneTracks(pipeline) {
  return ((pipeline && pipeline.lanes) || []).map((lane) => ({
    id: lane.id, name: (LANE_NAME[lane.id] || [lane.title])[0], store: (LANE_NAME[lane.id] || ['', ''])[1],
    stages: (lane.stages || []).map((st) => {
      const cards = st.cards || [];
      const tone = TONE_RANK.find((t) => cards.some((c) => c.tone === t)) || '';
      return { id: st.id, title: st.title, tone, unseen: st.unseen || '', cards: cards.map((c) => ({ title: c.title, tone: c.tone, at: c.at, state: c.state })) };
    })
  }));
}

/** What the Releases page says first: each store build in review or failed, and the web app. */
function releaseSay(pipeline, web) {
  const out = [];
  for (const lane of laneTracks(pipeline)) {
    const [name, , who] = LANE_NAME[lane.id] || [lane.name, '', 'The store'];
    for (const st of lane.stages) for (const c of st.cards) {
      if (c.tone === 'bad') out.push(name + ' ' + c.title + ' failed.');
      else if (st.id === 'review') out.push(who + ' reviews ' + name + ' ' + c.title + '.');
    }
  }
  if (web) out.push({ ok: 'The web app runs the newest merge.', run: 'The web app gets the newest merge in a few minutes.', fail: 'The web app does not run the newest merge.' }[web.s] || '');
  return out.filter(Boolean).join(' ');
}

/** A rate against its line, as a meter: share of the bar to the value and to the line, and a tone (under half the line, under it, past it). */
function againstLine(value, line) {
  if (value === null || value === undefined) return null;
  const max = line * 2;
  return { at: Math.min(1, value / max), line: 0.5, tone: value >= line ? 'bad' : value >= line / 2 ? 'warn' : 'ok' };
}

/** An App Store state in words, and its tone. */
function appleState(st) {
  const said = {
    READY_FOR_SALE: ['On the App Store', 'ok'], READY_FOR_DISTRIBUTION: ['On the App Store', 'ok'], WAITING_FOR_REVIEW: ['Waits for Apple', 'warn'],
    IN_REVIEW: ['Apple reviews it', 'warn'], PENDING_DEVELOPER_RELEASE: ['Approved, not out yet', 'warn'], PREPARE_FOR_SUBMISSION: ['Not sent yet', ''],
    REJECTED: ['Rejected', 'bad'], METADATA_REJECTED: ['Rejected', 'bad'], DEVELOPER_REJECTED: ['Taken back', ''], INVALID_BINARY: ['Not valid', 'bad'],
    REPLACED_WITH_NEW_VERSION: ['Replaced', ''], PROCESSING: ['Apple processes it', 'warn'], VALID: ['Ready', 'ok']
  }[st];
  return said || [String(st || '').toLowerCase().replace(/_/g, ' '), ''];
}

/** What people use, from the platforms phones and browsers report: a share each, largest first. */
function platformShares(platforms) {
  const name = { android: 'Android', ios: 'iPhone', web: 'Web' };
  const rows = (platforms || []).map((p) => ({ id: name[p.os] ? p.os : 'other', name: name[p.os] || String(p.os || 'Other'), n: Number(p.installs || 0) })).filter((r) => r.n > 0);
  const total = rows.reduce((a, r) => a + r.n, 0);
  return { total, rows: rows.sort((a, b) => b.n - a.n).map((r) => Object.assign(r, { share: total ? r.n / total : 0 })) };
}

/** Names as words: "a", "a and b", "a, b and c". */
function andWords(names) {
  const a = (names || []).map(String);
  return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
}
const countOf = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/** Last night's suites (sources/nightly.ts): how many passed, which failed or broke, and nightlies that stopped. */
function nightlyView(d, now) {
  const out = { total: 0, passed: 0, failed: [], broke: [], stale: [], runs: [] };
  for (const r of (d && d.runs) || []) {
    const age = r.run ? (now - Date.parse(r.run.at)) / 36e5 : null;
    const suites = r.suites || [];
    const passed = suites.filter((s) => !s.broke && !s.failed).length;
    if (age === null || age > NIGHT_STALE_H) out.stale.push(r.title);
    out.runs.push({ title: r.title, at: r.run ? r.run.at : null, url: r.run ? r.run.url : null, total: suites.length, passed, broke: suites.filter((s) => s.broke).length, stale: age === null || age > NIGHT_STALE_H });
    for (const s of suites) { out.total++; if (s.broke) out.broke.push(s.suite); else if (s.failed) out.failed.push(s.suite); else out.passed++; }
  }
  return out;
}
/** The sentence under Nightly tests: only what the runs said. */
function nightlySay(v) {
  if (!v.total && !v.stale.length) return null;
  const out = [];
  if (v.total) out.push('Last night ' + v.passed + ' of ' + countOf(v.total, 'test suite', 'test suites') + ' passed.');
  if (v.broke.length) out.push(andWords(v.broke) + ' broke.');
  if (v.failed.length) out.push('Tests failed in ' + andWords(v.failed) + '.');
  if (v.stale.length) out.push(andWords(v.stale) + ' did not run in the last ' + NIGHT_STALE_H + ' hours.');
  return out.join(' ');
}

/** What waits on staff (sources/ops.ts Support), and whether every count was read. The Terms promise action on a report within 24 hours. */
function supportWaits(s, now) {
  if (!s) return null;
  const late = Boolean(s.reports.open && s.reports.oldestAt && (now - Date.parse(s.reports.oldestAt)) / 36e5 > 24);
  const feedback = s.feedbackOpen ? s.feedbackOpen.open : null;
  const blue = s.verifications ? s.verifications.filter((v) => v.status === 'waiting').length : null;
  return { reports: s.reports.open, late, feedback, blue, read: feedback !== null && blue !== null };
}
function supportSay(w) {
  if (!w) return null;
  const out = [];
  if (w.reports) out.push(countOf(w.reports, 'content report is', 'content reports are') + ' open' + (w.late ? ', the oldest past the 24-hour promise' : '') + '.');
  if (w.feedback) out.push(countOf(w.feedback, 'feedback message waits', 'feedback messages wait') + '.');
  // A blue check to decide is a problem of its own on the page: the verdict after this says it.
  if (out.length) return out.join(' ');
  return w.read && !w.blue ? 'Nothing waits on staff.' : 'No content report is open.';
}

/** Each server job in plain words; its code name stays in its help and in All the details. */
const JOB_WORDS = {
  account_delete: 'Delete accounts people asked to delete', blob_reconcile: 'Nightly check of recordings against the log', daily_totals: 'Daily totals for the charts',
  fold_canary: 'Nightly check that saved copies are right', job_starts: 'Start the jobs on time', ops_counts: 'Count the numbers for this dashboard',
  projection: 'Bring each language up to date', projection_large: 'Bring the large languages up to date', push_delivery: 'Send phone notifications',
  snapshot: 'Make the downloads for each language', snapshot_purge: 'Remove old downloads', tutorial_comments: 'Read comments on the tutorial videos',
  tutorial_intake: 'Take in new tutorial films', tutorial_publish: 'Put tutorial videos on YouTube', tutorial_review: 'Claude’s look at the tutorial videos',
  user_issue_look: 'Claude’s look at user issues', user_issue_watch: 'Watch for user issues', webhook_dispatch: 'Send webhooks to partners',
  worker_cron: 'The web app’s timed jobs', worker_requests: 'Count the web app’s requests', v2_import: 'Import from LangQuest v2'
};
const jobWords = (job) => JOB_WORDS[job] || String(job || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
/** A job's state, worst first: stopped (no run on schedule), failing (3 in a row), failed or part of the work last time, running, or in order. */
function serverJobState(j, now) {
  if (j.stale) return ['bad', 'Stopped'];
  if (j.streak >= 3) return ['bad', 'Failing'];
  if (j.last_outcome === 'error') return ['bad', 'Last run failed'];
  if (j.last_outcome === 'partial') return ['warn', 'Did part of the work'];
  if (now && now.running) return ['run', 'Runs now'];
  return ['ok', 'In order'];
}
const STATE_RANK = { bad: 0, warn: 1, run: 2, ok: 3 };
function jobRows(jobs, now) {
  return (jobs || []).map((j) => ({ j, name: jobWords(j.job), state: serverJobState(j, (now || {})[j.job]) }))
    .sort((a, b) => STATE_RANK[a.state[0]] - STATE_RANK[b.state[0]] || a.name.localeCompare(b.name));
}

/** The database plan and this month's Cloudflare use, each as a share of what is allowed. */
function capacityView(c) {
  if (!c) return null;
  const rows = [];
  if (c.now && c.limitBytes) rows.push({ id: 'db', label: 'Database', used: c.now.dbBytes, of: c.limitBytes, unit: 'bytes', weeks: c.weeksLeft });
  const u = c.usage && !c.usage.error ? c.usage : null;
  if (u) {
    const a = u.allowance || ALLOWANCE;
    rows.push({ id: 'workers', label: 'Web requests this month', used: u.workersRequests, of: a.workersRequests, unit: 'n', free: true });
    rows.push({ id: 'do', label: 'Live connections this month', used: u.doRequests, of: a.doRequests, unit: 'n', free: true });
    rows.push({ id: 'r2a', label: 'Saves and lists in R2 this month', used: u.r2ClassA, of: a.r2ClassA, unit: 'n', free: true });
    rows.push({ id: 'r2b', label: 'Reads from R2 this month', used: u.r2ClassB, of: a.r2ClassB, unit: 'n', free: true });
  }
  if (c.r2) rows.push({ id: 'r2', label: 'Recordings kept (R2)', used: c.r2.bytes, of: (u && u.allowance && u.allowance.r2Bytes) || ALLOWANCE.r2Bytes, unit: 'bytes', free: true });
  // Past the plan's database size is a problem; past a free allowance costs money, so it is a note in amber, never red.
  for (const r of rows) { r.share = r.of ? r.used / r.of : 0; r.tone = r.free ? (r.share >= 1 ? 'warn' : 'ok') : r.share >= 1 ? 'bad' : r.share >= 0.8 ? 'warn' : 'ok'; }
  return rows;
}

/** What stops working on a date, soonest first, with the days left and its tone (sources/expiry.ts lines). */
function expiryRows(items, now) {
  return (items || []).filter((i) => i.expires).map((i) => {
    const left = (Date.parse(i.expires) - now) / 864e5;
    return { what: i.what, expires: i.expires, source: i.source, left, tone: left < 0 || left <= EXPIRY_PROBLEM_DAYS ? 'bad' : left <= EXPIRY_WARN_DAYS ? 'warn' : 'ok' };
  }).sort((a, b) => a.left - b.left);
}
/** A small share in words: never "0.00%" for a count above zero. */
const pctWords = (x) => x > 0 && x < 0.0001 ? 'under 0.01%' : (x * 100).toFixed(x >= 0.1 ? 0 : 2) + '%';
const daysWords = (left) => left < 0 ? 'expired ' + countOf(Math.ceil(-left), 'day', 'days') + ' ago' : left < 1 ? 'expires today' : 'in ' + countOf(Math.ceil(left), 'day', 'days');
`;

/** Drawing; registers each page's blocks with pageSummary.ts. */
export const BLOCKS_SCRIPT = String.raw`
const pctW = (x) => (Math.max(0, Math.min(1, x)) * 100).toFixed(1) + '%';
/** A meter with no style attribute: its width is a step of 2% in a class (the page allows no inline style). */
const wcls = (x) => 'w' + Math.round(Math.max(0, Math.min(1, x)) * 50) * 2;
const shortAgo = (iso) => { if (!iso) return ''; const h = (Date.now() - Date.parse(iso)) / 36e5; return h < 1 ? Math.max(1, Math.round(h * 60)) + ' min' : h < 48 ? Math.round(h) + ' h' : Math.round(h / 24) + ' d'; };

// ---- Releases --------------------------------------------------------------------------------
function buildTracks(d) {
  const lanes = laneTracks(d);
  if (!lanes.length) return '';
  return block('Where each build is', 0, '', '<div class="lanes">' + lanes.map((l) => '<div class="blane"><div><b>' + esc(l.name) + '</b><small>' + esc(l.store) + '</small></div>' +
    '<div class="track cols' + l.stages.length + '">' + l.stages.map((st) => '<div class="stg ' + st.tone + '"><span class="dt"></span><span>' + esc(st.title) + '</span>' +
      st.cards.map((c) => '<a class="bchip ' + esc(c.tone) + '" href="' + esc(cardHref('releases', storeCardId(l.id, c.title))) + '" title="' + esc(c.state || '') + '">' + esc(String(c.title).replace(/^build /, 'Build ')) + (c.at ? '<small>' + esc(shortAgo(c.at)) + '</small>' : '') + '</a>').join('') +
      (st.unseen ? '<small>' + esc(st.unseen) + '</small>' : '') + '</div>').join('') + '</div></div>').join('') + '</div>');
}
function webRow(code) {
  const v = codeView(code);
  return '<div class="webrow"><span class="mk ' + v.web.s + '" aria-hidden="true">' + (v.web.s === 'ok' ? '✓' : v.web.s === 'run' ? '…' : '!') + '</span><span><b>' + esc(v.web.text) + '</b>' +
    '<small>Newest merge: ' + esc(v.web.newest.title) + (v.web.newest.at ? ' · ' + esc(ago(v.web.newest.at)) : '') + '</small></span></div>';
}
function adoptionRows(a) {
  const rows = ((a && a.rows) || []).filter((r) => r.installs > 0 && /production/.test(r.channel));
  if (!rows.length) return '';
  // A platform's store build with the most phones is its build; another is an older store build. Its code name is in its help.
  const top = {};
  for (const r of rows) if (!top[r.platform] || r.installs > top[r.platform].installs) top[r.platform] = r;
  const name = (r) => (r.platform === 'ios' ? 'iPhone' : r.platform === 'android' ? 'Android' : r.platform) + (top[r.platform] === r ? '' : ', older store build');
  return block('Who has the newest update', 0, '', '<div class="mrows">' + rows.map((r) => {
    const share = r.installs ? r.onNewest / r.installs : 0;
    return '<div class="mrow"><span data-help="' + esc('Runtime ' + r.runtime + ' on the ' + r.channel + ' channel.') + '">' + esc(name(r)) + '</span><span class="meter"><i class="' + wcls(share) + (r.newest ? '' : ' warn') + '"></i></span>' +
      '<span><b>' + num(r.onNewest) + ' of ' + num(r.installs) + '</b> phones' + (r.newest ? '' : '<span class="warn">No update for this build</span>') + '</span></div>';
  }).join('') + '</div>');
}
function jobsOnGitHub(code) {
  const v = codeView(code);
  if (!v.jobs.length) return '';
  const pills = JOB_ORDER.filter((k) => v.counts[k]).map((k) => '<span class="cdp ' + k + '">' + num(v.counts[k]) + ' ' + CODE_PILL[k] + '</span>').join(' ');
  return '<section class="sblock"><div class="sh"><h2>Automatic jobs on GitHub</h2>' + pills + '<span class="sp"></span></div><ul class="cdj">' + v.jobs.map(codeJob).join('') + '</ul></section>';
}
PAGE_BLOCKS.releases = () => {
  const pipe = okData(results, 'pipeline'), code = okData(results, 'code');
  return (pipe ? buildTracks(pipe) : '') +
    (code ? block('The web app', 0, '', webRow(code)) : '') +
    '<div class="bpair">' + (okData(results, 'adoption') ? adoptionRows(okData(results, 'adoption')) : '') + (code ? jobsOnGitHub(code) : '') + '</div>';
};
PAGE_SAY.releases = () => {
  const pipe = okData(results, 'pipeline'), code = okData(results, 'code');
  return pipe || code ? releaseSay(pipe, code ? codeView(code).web : null) || null : null;
};

// ---- App stores ------------------------------------------------------------------------------
function rateRow(label, value, line) {
  const m = againstLine(value, line);
  if (!m) return '';
  return '<div class="mrow"><span>' + esc(label) + '</span><span class="meter"><i class="' + wcls(m.at) + (m.tone === 'ok' ? '' : ' ' + m.tone) + '"></i><u class="at50"></u></span>' +
    '<span><b>' + esc((value * 100).toFixed(2)) + '%</b> of people · line ' + esc((line * 100).toFixed(2)) + '%</span></div>';
}
const starsOf = (avg) => avg === null || avg === undefined ? '' : '<span class="stars" aria-hidden="true">' + '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg)) + '</span> ';
PAGE_BLOCKS.stores = () => {
  const play = okData(results, 'googleplay'), apple = okData(results, 'appstore');
  let out = '';
  if (play && (play.crash || play.anr)) out += block('Android crashes and freezes against Google’s line', 0, '', '<div class="mrows">' +
    (play.crash ? rateRow('Crashes', play.crash.userPerceived, CRASH_LINE) : '') + (play.anr ? rateRow('Freezes', play.anr.userPerceived, ANR_LINE) : '') + '</div>');
  const versions = apple ? (apple.versions || []).slice(0, 4) : [];
  const appleBox = versions.length ? block('App Store versions', 0, '', '<div class="mrows">' + versions.map((v) => {
    const [said, tone] = appleState(v.state);
    return '<div class="mrow"><span><b>' + esc(v.version) + '</b></span><span class="said ' + (tone === 'bad' ? 'warn' : tone) + '">' + esc(said) + '</span><span>' + (v.at ? esc(ago(v.at)) : '') + '</span></div>';
  }).join('') + (apple.testflightCrashes ? '<p class="sempty">TestFlight crash reports in 7 days: ' + num(apple.testflightCrashes.week) + '</p>' : '') + '</div>') : '';
  const rev = (r, name) => r ? '<div class="fact' + (r.lowWeek ? ' warn' : '') + '"><b>' + starsOf(r.average) + (r.average === null ? '–' : esc(Number(r.average).toFixed(1))) + '</b><span>' + esc(name) + (r.count ? ', ' + num(r.count) + ' reviews' : '') + (r.lowWeek ? ' · ' + num(r.lowWeek) + ' low this week' : '') + '</span></div>' : '';
  const reviews = (play && play.reviews) || (apple && apple.reviews) ? block('Reviews', 0, '', '<div class="facts">' + rev(play && play.reviews, 'Google Play') + rev(apple && apple.reviews, 'App Store') + '</div>') : '';
  return out + '<div class="bpair">' + appleBox + reviews + '</div>';
};
PAGE_SAY.stores = () => {
  const play = okData(results, 'googleplay'), apple = okData(results, 'appstore');
  const out = [];
  if (play && play.crash) {
    const past = [play.crash.userPerceived >= CRASH_LINE ? 'crashes' : '', play.anr && play.anr.userPerceived >= ANR_LINE ? 'freezes' : ''].filter(Boolean);
    out.push(past.length ? 'Android ' + past.join(' and ') + ' are past Google’s line.' : 'Android crashes and freezes are under Google’s line.');
  }
  const v = apple && (apple.versions || [])[0];
  if (v) out.push('App Store version ' + v.version + ': ' + appleState(v.state)[0] + '.');
  return out.join(' ') || null;
};

// ---- People and organizations --------------------------------------------------------------
PAGE_BLOCKS.people = () => {
  const d = okData(results, 'people');
  if (!d) return '';
  const fact = (n, label, warn) => '<div class="fact' + (warn ? ' warn' : '') + '"><b>' + esc(num(n)) + '</b><span>' + esc(label) + '</span></div>';
  return block('All together', 0, '', '<div class="facts">' +
    fact(d.accounts.total, 'accounts') + fact(d.orgs.total, 'organizations') + fact(d.languages.total, 'languages') +
    fact(d.activeProfiles.week, 'active this week') + fact(d.joining.pendingRequests, d.joining.oldestRequestAt ? 'wait to join, oldest ' + ago(d.joining.oldestRequestAt) : 'wait to join', d.joining.pendingRequests > 0) +
    fact(d.globalViewers.active, 'Global Viewers') + (d.accounts.suspended ? fact(d.accounts.suspended, 'suspended accounts') : '') + '</div>');
};
PAGE_SAY.people = () => {
  const d = okData(results, 'people');
  return d ? num(d.activeProfiles.day) + ' people were active today, ' + num(d.activeProfiles.week) + ' this week.' : null;
};

// ---- Phones and browsers ---------------------------------------------------------------------
PAGE_BLOCKS.phones = () => {
  const d = okData(results, 'clients');
  const p = d ? platformShares(d.platforms) : null;
  if (!p || !p.total) return '';
  return block('What people use, last 7 days', 0, '', '<div class="stack" role="img" aria-label="' + esc(p.rows.map((r) => r.name + ' ' + r.n).join(', ')) + '">' +
    p.rows.map((r) => '<i class="' + r.id + ' ' + wcls(r.share) + '"></i>').join('') + '</div>' +
    '<div class="skey">' + p.rows.map((r) => '<span><i class="' + r.id + '"></i>' + esc(r.name) + ' · ' + num(r.n) + '</span>').join('') + '</div>');
};

// ---- The pages that are a work list: a strip of where the work is -------------------------------
/**
 * A box for each tab of the page's list, with its count. A tap opens All the details at that tab:
 * the strip says where the work is, the list under it is the work.
 */
function tabStrip(title, attr, tabs, count, you) {
  const shown = tabs.filter((t) => t[0] !== 'all' && (count[t[0]] || t[0] === 'you'));
  if (!shown.length) return '';
  return block(title, 0, '', '<div class="wstrip">' + shown.map((t) => '<button type="button" class="wst' + (t[0] === you && count[t[0]] ? ' you' : '') + '" data-tabgo="' + esc(attr + ':' + t[0]) + '">' +
    '<b>' + num(count[t[0]] || 0) + '</b><span>' + esc(t[1]) + '</span></button>').join('') + '</div>');
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('#sum [data-tabgo]');
  if (!b) return;
  const [attr, tab] = b.dataset.tabgo.split(':');
  const v = view();
  if (v.name !== 'group') return;
  setOpen(v.id, true);
  saveDetails(v.id, true);
  const go = () => {
    const t = document.querySelector('#card-' + v.id + ' [data-' + attr + '="' + tab + '"]');
    if (!t) return false;
    t.click();
    const again = document.querySelector('#card-' + v.id + ' [data-' + attr + '="' + tab + '"]') || t;
    again.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    again.focus({ preventScroll: true });
    return true;
  };
  if (!go()) setTimeout(go, 600);
});

// ---- User issues -----------------------------------------------------------------------------
function issueCounts() {
  const d = okData(results, 'userissues');
  if (!d) return null;
  const prs = fixData && fixData.state === 'ok' && fixData.data ? fixData.data.prs : null;
  const ways = (d.issues || []).map((r) => issueWay(r, prs, r.issue && d.notes ? d.notes[r.issue] : null, r.issue && d.fixes ? d.fixes[r.issue] : null));
  return { d, count: issueTabs(ways, null).count };
}
PAGE_BLOCKS.userissues = () => {
  const c = issueCounts();
  return c && c.d.issues && c.d.issues.length ? tabStrip('Where the issues are, 90 days', 'itab', ISSUE_TABS, c.count, 'you') : '';
};
// ---- User reports (pageReports.ts): the open problems people sent, before the counts ----------------
function reportsData() { return okData(results, 'userreports'); }
PAGE_SAY.userreports = () => {
  const d = reportsData();
  if (!d) return null;
  const n = reportsOpen(d.reports);
  return n ? countOf(n, 'problem that people sent waits', 'problems that people sent wait') + ' for a fix. The fix team takes them first.' : 'No problem that people sent is open.';
};
PAGE_TONE.userreports = () => { const d = reportsData(); return d && reportsOpen(d.reports) ? 'need' : null; };
PAGE_SAY.userissues = () => {
  const c = issueCounts();
  if (!c) return null;
  const you = c.count.you || 0;
  return (c.d.open ? countOf(c.d.open, 'problem is', 'problems are') + ' open in Linear.' : 'No problem is open in Linear.') +
    (you ? ' ' + countOf(you, 'waits', 'wait') + ' on you.' : '') + (c.d.last ? ' The watch last looked ' + ago(c.d.last.at) + '.' : '');
};

// ---- Research --------------------------------------------------------------------------------
function researchCounts() {
  const d = okData(results, 'research');
  if (!d) return null;
  const ways = (d.items || []).map((i) => researchWay(i, i.issue && d.fixes ? d.fixes[i.issue] : null, i.issue && d.notes ? d.notes[i.issue] : null));
  return { d, count: researchTabs(ways, null).count, rep: researchReport(d.reports, null) };
}
PAGE_BLOCKS.research = () => {
  const c = researchCounts();
  return c && c.d.items && c.d.items.length ? tabStrip('Where the findings are, 90 days', 'rtab', RESEARCH_TABS, c.count, 'you') : '';
};
PAGE_SAY.research = () => {
  const c = researchCounts();
  if (!c) return null;
  const rep = c.rep;
  // What waits on you is said by the page's problems (the verdict after this), so it is not said twice.
  return (rep && rep.counts ? 'The newest report, ' + ago(rep.at) + ', found ' + countOf(rep.counts.found, 'thing', 'things') + '.' : rep ? 'The newest report is from ' + ago(rep.at) + '.' : 'No report yet.') +
    (rep && rep.lead === 'failed' ? ' The lead’s check failed.' : '');
};

// ---- Support ---------------------------------------------------------------------------------
PAGE_BLOCKS.support = () => {
  const w = supportWaits(okData(results, 'support'), Date.now());
  if (!w) return '';
  const fact = (n, label, warn) => n === null ? '' : '<div class="fact' + (warn ? ' warn' : '') + '"><b>' + esc(num(n)) + '</b><span>' + esc(label) + '</span></div>';
  const s = okData(results, 'support');
  return block('Waits on staff', 0, '', '<div class="facts">' +
    fact(w.reports, w.late ? 'content reports open, past 24 hours' : 'content reports open', w.late) + fact(w.feedback, 'feedback messages wait', w.feedback > 0) +
    fact(w.blue, 'blue checks to decide', w.blue > 0) + fact(s.reports.resolvedWeek, 'reports closed this week') + fact(s.suspended.total, 'suspended accounts') + '</div>');
};
PAGE_SAY.support = () => supportSay(supportWaits(okData(results, 'support'), Date.now()));

// ---- Tutorial videos -------------------------------------------------------------------------
PAGE_BLOCKS.tutorials = () => {
  const d = okData(results, 'videos');
  if (!d) return '';
  const t = videoTabs(d, null);
  const langs = (d.languages || []).length ? block('Each language', 0, '', '<div class="wchips">' + d.languages.map((l) =>
    // A paused language with something that waits on you (Tagalog's empty channel) shows it, not only the pause.
    '<span class="lchip' + (l.issues ? ' warn' : !l.nightly ? ' off' : ' ok') + '" data-help="' + esc((!l.nightly ? 'Filming is paused.' + (l.issues ? ' ' : '') : '') + (l.issues ? countOf(l.issues, 'thing waits', 'things wait') + ' on you.' : l.nightly ? 'Every video is in order.' : '')) + '">' +
    esc(l.language) + (l.issues ? ' · ' + num(l.issues) : '') + '</span>').join('') + '</div>') : '';
  return tabStrip('Where the work is', 'vtab', VIDEO_TABS, t.count, 'you') + langs;
};
PAGE_SAY.tutorials = () => {
  const d = okData(results, 'videos'), ch = okData(results, 'tutorials');
  if (!d && !ch) return null;
  const out = [];
  if (d) {
    const t = videoTabs(d, null);
    // What waits on an admin is said by the page's problems (the verdict after this) and the strip.
    if (t.claude.length + d.worker.length) out.push('Claude and the jobs have ' + countOf(t.claude.length + d.worker.length, 'thing', 'things') + ' to do.');
  }
  if (ch && ch.channels) out.push(ch.channels.filter((c) => c.connectedAt).length + ' of ' + countOf(ch.channels.length, 'channel is', 'channels are') + ' connected.');
  return out.join(' ');
};

// ---- Nightly tests ---------------------------------------------------------------------------
PAGE_BLOCKS.nightly = () => {
  const d = okData(results, 'nightly');
  const v = d ? nightlyView(d, Date.now()) : null;
  if (!v || !v.runs.length) return '';
  return block('Last night', 0, '', '<div class="mrows">' + v.runs.map((r) => {
    const share = r.total ? r.passed / r.total : 0;
    return '<div class="mrow"><span>' + (r.url ? outLink(r.url, esc(r.title)) : esc(r.title)) + '</span><span class="meter"><i class="' + wcls(share) + (r.stale || r.broke ? ' bad' : r.passed < r.total ? ' warn' : '') + '"></i></span>' +
      '<span>' + (r.total ? '<b>' + num(r.passed) + ' of ' + num(r.total) + '</b> suites passed' : 'No suites') + (r.at ? ' · ' + esc(ago(r.at)) : '') + (r.stale ? '<span class="warn">Did not run in ' + NIGHT_STALE_H + ' hours</span>' : '') + '</span></div>';
  }).join('') + '</div>');
};
PAGE_SAY.nightly = () => {
  const d = okData(results, 'nightly');
  return d ? nightlySay(nightlyView(d, Date.now())) : null;
};

// ---- Server jobs -----------------------------------------------------------------------------
PAGE_BLOCKS.jobs = () => {
  const d = okData(results, 'jobs');
  if (!d || !(d.jobs || []).length) return '';
  const c = okData(results, 'container');
  const now = c ? Object.fromEntries((c.jobs || []).map((j) => [j.job, j])) : {};
  return block('Each job, last 2 days', 0, '', '<div class="jrows">' + jobRows(d.jobs, now).map((r) =>
    '<div class="jrow"><span class="jdot ' + r.state[0] + '" aria-hidden="true"></span><span class="jname"><b data-help="' + esc('Code name: ' + r.j.job + (r.j.runs_on ? ', runs on ' + r.j.runs_on : '') + '.') + '">' + esc(r.name) + '</b>' +
    '<small>' + esc(r.state[1]) + (r.j.last_at ? ' · last run ' + esc(ago(r.j.last_at)) : '') + '</small></span>' +
    '<span class="jnum"><b>' + num(r.j.runs) + '</b> runs' + (r.j.failures ? ' · <span class="bad">' + num(r.j.failures) + ' failed</span>' : '') + '</span></div>').join('') + '</div>');
};
PAGE_SAY.jobs = () => {
  const d = okData(results, 'jobs');
  if (!d) return null;
  const c = okData(results, 'container');
  const running = c ? (c.jobs || []).filter((j) => j.running).length : 0;
  return countOf((d.jobs || []).length, 'job', 'jobs') + ' ran in the last 2 days.' + (running ? ' ' + countOf(running, 'runs', 'run') + ' now.' : '');
};

// ---- Database --------------------------------------------------------------------------------
PAGE_BLOCKS.database = () => {
  const d = okData(results, 'database'), x = okData(results, 'dbdetail');
  if (!d && !x) return '';
  const fact = (v, label, warn) => '<div class="fact' + (warn ? ' warn' : '') + '"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>';
  const share = d && d.maxConnections ? d.connections / d.maxConnections : 0;
  const conn = d ? '<div class="mrows"><div class="mrow"><span>Connections in use</span><span class="meter"><i class="' + wcls(share) + (share >= 0.8 ? ' warn' : '') + '"></i></span><span><b>' + num(d.connections) + ' of ' + num(d.maxConnections) + '</b></span></div></div>' : '';
  const facts = '<div class="facts">' + (d ? fact(bytes(d.sizeBytes), 'size') : '') +
    (d && d.stats && d.stats.hitRatio !== null ? fact((d.stats.hitRatio * 100).toFixed(1) + '%', 'reads from memory', d.stats.hitRatio < 0.95) : '') +
    (x ? fact(x.longestQueryS === null ? '–' : ms(x.longestQueryS * 1000), 'longest query now', x.longestQueryS > LONG_QUERY_S) +
      fact(x.oldestXactS === null ? '–' : ms(x.oldestXactS * 1000), 'oldest transaction now', x.oldestXactS > LONG_XACT_S) : '') +
    (d && d.stats ? fact(num(d.stats.deadlocks), 'deadlocks', d.stats.deadlocks > 0) : '') + '</div>';
  return block('Now', 0, '', conn + (conn ? '<div class="gap"></div>' : '') + facts);
};
PAGE_SAY.database = () => {
  const d = okData(results, 'database');
  return d ? num(d.connections) + ' of ' + num(d.maxConnections) + ' connections are in use. The database is ' + bytes(d.sizeBytes) + '.' : null;
};

// ---- Web traffic -----------------------------------------------------------------------------
PAGE_BLOCKS.traffic = () => {
  const d = okData(results, 'cloudflare');
  const ws = d ? (d.workers || []).slice().sort((a, b) => b.requests - a.requests) : [];
  if (!ws.length) return '';
  const top = Math.max(1, ...ws.map((w) => w.requests));
  return block('Each Worker, last 24 hours', 0, '', '<div class="mrows">' + ws.map((w) => {
    const rate = w.requests ? w.errors / w.requests : 0;
    return '<div class="mrow"><span><b>' + esc(w.name) + '</b>' + (w.lastDeploy ? '<span class="sub">deployed ' + esc(ago(w.lastDeploy.at)) + '</span>' : '') + '</span>' +
      '<span class="meter"><i class="' + wcls(w.requests / top) + (rate >= 0.01 ? ' warn' : '') + '"></i></span>' +
      '<span><b>' + num(w.requests) + '</b> requests · ' + (w.errors ? '<span class="' + (rate >= 0.01 ? 'warn' : '') + '">' + num(w.errors) + ' errors (' + pctWords(rate) + ')</span>' : 'no errors') + '</span></div>';
  }).join('') + '</div>');
};
PAGE_SAY.traffic = () => {
  const d = okData(results, 'cloudflare');
  if (!d || !(d.workers || []).length) return null;
  const req = d.workers.reduce((a, w) => a + w.requests, 0), err = d.workers.reduce((a, w) => a + w.errors, 0);
  return 'The Workers answered ' + num(req) + ' requests in the last 24 hours' + (err ? ', ' + pctWords(req ? err / req : 0) + ' with an error.' : ' with no error.');
};

// ---- Storage and cost ------------------------------------------------------------------------
PAGE_BLOCKS.storage = () => {
  const rows = capacityView(okData(results, 'capacity'));
  const st = okData(results, 'storage');
  const fmt = (r, v) => r.unit === 'bytes' ? bytes(v) : num(v);
  const plan = rows && rows.length ? block('Against the plan and the free use', 0, '', '<div class="mrows">' + rows.map((r) =>
    '<div class="mrow"><span>' + esc(r.label) + '</span><span class="meter"><i class="' + wcls(r.share) + (r.tone === 'ok' ? '' : ' ' + r.tone) + '"></i></span>' +
    '<span><b>' + esc(fmt(r, r.used)) + '</b> of ' + esc(fmt(r, r.of)) + (r.free ? ' free' : '') + (r.free && r.share >= 1 ? '<span class="sub">the rest is paid</span>' : '') + (r.weeks !== undefined && r.weeks !== null ? '<span class="sub">about ' + countOf(Math.round(r.weeks), 'week', 'weeks') + ' left</span>' : '') + '</span></div>').join('') + '</div>') : '';
  const b = st && st.backups;
  const keep = st ? block('Kept safe', 0, '', '<div class="facts">' +
    (b && !b.error ? '<div class="fact' + (!b.latest || Date.now() - Date.parse(b.latest) > 36 * 36e5 ? ' warn' : '') + '"><b>' + esc(b.latest ? ago(b.latest) : 'none') + '</b><span>newest backup' + (b.pitr ? ', any moment can be restored' : '') + '</span></div>' : '') +
    (st.reconcile ? '<div class="fact' + (st.reconcile.outcome !== 'ok' ? ' warn' : '') + '"><b>' + esc(ago(st.reconcile.at)) + '</b><span>nightly check of recordings' + esc(({ ok: ', in order', partial: ', did part of the check', error: ', failed' })[st.reconcile.outcome] || ': ' + st.reconcile.outcome) + '</span></div>' : '') +
    (st.r2 && !st.r2.error ? '<div class="fact"><b>' + esc(num(st.r2.objects)) + '</b><span>recordings and files kept</span></div>' : '') + '</div>') : '';
  return plan + keep;
};
PAGE_SAY.storage = () => {
  const rows = capacityView(okData(results, 'capacity')) || [];
  const db = rows.find((r) => r.id === 'db');
  const st = okData(results, 'storage'), b = st && st.backups && !st.backups.error ? st.backups : null;
  const out = [];
  if (db) out.push('The database uses ' + Math.round(db.share * 100) + '% of its plan' + (db.weeks !== null && db.weeks !== undefined ? ', about ' + countOf(Math.round(db.weeks), 'week', 'weeks') + ' left' : '') + '.');
  if (b) out.push(b.latest ? 'The newest backup is from ' + ago(b.latest) + '.' : 'No backup is listed.');
  return out.join(' ') || null;
};

// ---- Keys and access -------------------------------------------------------------------------
PAGE_BLOCKS.access = () => {
  const e = okData(results, 'expiry');
  const rows = e ? expiryRows(e.items, Date.now()).slice(0, 6) : [];
  if (!rows.length) return '';
  return block('What expires next', 0, '', '<div class="mrows">' + rows.map((r) =>
    '<div class="mrow"><span><b>' + esc(r.what) + '</b><span class="sub">' + esc(r.source) + '</span></span><span class="meter"><i class="' + wcls(Math.max(0, Math.min(1, r.left / 365))) + (r.tone === 'ok' ? '' : ' ' + r.tone) + '"></i></span>' +
    '<span><b>' + esc(daysWords(r.left)) + '</b><span class="sub">' + esc(r.expires.slice(0, 10)) + '</span></span></div>').join('') + '</div><p class="sempty">The bar is a year: a short bar expires soon.</p>');
};
PAGE_SAY.access = () => {
  const e = okData(results, 'expiry');
  const r = e ? expiryRows(e.items, Date.now())[0] : null;
  return r ? 'The next thing to expire is ' + r.what + ', ' + daysWords(r.left) + '.' : null;
};
`;

/** The widths a meter takes, a class for each step of 2% (the page's policy allows no style attribute). */
export const WIDTH_CSS = Array.from({ length: 51 }, (_, i) => `.meter > i.w${i * 2}, .stack > i.w${i * 2} { width: ${i * 2}%; }`).join('\n') +
  '\n.stack > i { flex: none; }\n.meter > u.at50 { left: 50%; }\n' +
  Array.from({ length: 12 }, (_, i) => `.track.cols${i + 1} { grid-template-columns: repeat(${i + 1}, minmax(0, 1fr)); }`).join('\n');
