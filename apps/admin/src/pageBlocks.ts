/**
 * The blocks of their own that some section pages show in their summary
 * (pageSummary.ts PAGE_BLOCKS and PAGE_SAY;
 * docs/decisions/2026-11-21-ops-dashboard-summary-and-details.md): what a
 * person looks for first on that page, drawn from what its parts already
 * answered. Releases: where each store build is, the web app, who has the
 * newest update and the automatic jobs. App stores: crashes and freezes
 * against Google's line, the App Store's versions and the reviews. People:
 * the totals and who waits to join. Phones and browsers: what people use.
 * Every figure is a part's own; a part that did not answer gives no block.
 * Plain JavaScript run inside page.ts's script after pageSummary.ts and
 * pageCode.ts; everything shown is escaped.
 */
import { ANR_LINE, CRASH_LINE } from './sources/googleplay';

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
@media (max-width: 900px) { .blane { grid-template-columns: minmax(0, 1fr); gap: 10px; } .mrow { grid-template-columns: minmax(0, 1fr) auto; } .mrow .meter { grid-column: 1 / -1; grid-row: 2; } }
`;

/** Pure: apps/admin/test/blocks.test.ts runs these with new Function. */
export const BLOCKS_LOGIC = String.raw`
const CRASH_LINE = ${CRASH_LINE}, ANR_LINE = ${ANR_LINE};
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
`;

/** The widths a meter takes, a class for each step of 2% (the page's policy allows no style attribute). */
export const WIDTH_CSS = Array.from({ length: 51 }, (_, i) => `.meter > i.w${i * 2}, .stack > i.w${i * 2} { width: ${i * 2}%; }`).join('\n') +
  '\n.stack > i { flex: none; }\n.meter > u.at50 { left: 50%; }\n' +
  Array.from({ length: 12 }, (_, i) => `.track.cols${i + 1} { grid-template-columns: repeat(${i + 1}, minmax(0, 1fr)); }`).join('\n');
