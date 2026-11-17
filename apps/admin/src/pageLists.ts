/**
 * The pictures for fixed lists (docs/ops-dashboard-plan.md 5c2): a square
 * for each nightly suite, EAS build, v2 project, user issue, feedback item,
 * YouTube channel, video and suggestion, drawn from the data each part has
 * already read, on its card on the start page and at the top of its part. A
 * tap on a square opens that item's detail. A row that grows with people
 * (feedback, issues, v2 projects) turns into 100 squares of 1% each past 200
 * items, so the picture keeps its size. The nightly R2 check is the
 * blob_reconcile row of the job squares (pageStart.ts), one square a night.
 */

/** Pure helpers, no page state: apps/admin/test/lists.test.ts runs them with new Function. */
export const LISTS_LOGIC = String.raw`
/** A list's states, worst first: failed, waits, runs, done, nothing to do, not started. */
const LIST_ORDER = ['fail', 'part', 'run', 'ok', 'off', 'none'];
const rankOf = (s) => LIST_ORDER.indexOf(s);
const byState = (a, b) => rankOf(a.s) - rankOf(b.s);
const fieldsOf = (pairs) => pairs.filter((p) => p[1] !== null && p[1] !== undefined && p[1] !== '');
const PR_URL = 'https://github.com/genesis-ai-dev/langquest-next/pull/';

/** Past this many items in a row, each square is 1% of the row (plan 5.0). */
const SHARE_PAST = 200;

/**
 * A part's list as rows of items, each with a state (LIST_ORDER), a name,
 * when, the fields its detail shows and a link; null for a part without one.
 */
function listRows(part, d) {
  if (!d) return null;
  if (part === 'nightly') {
    return (d.runs || []).map((r) => ({ label: r.title, items: (r.suites || []).map((s) => ({
      s: s.broke ? 'fail' : s.failed ? 'part' : 'ok', name: s.suite, at: r.run ? r.run.at : null,
      fields: fieldsOf([['Night', r.run ? r.run.at : null], ['Run', r.run ? '#' + r.run.number + ' on ' + r.run.sha : null],
        ['Tests', s.ran === null || s.ran === undefined ? null : s.passed + ' of ' + s.ran + ' passed'], ['Broke', s.broke],
        ['Linear', (s.issues || []).map((i) => i.id).join(', ')]]),
      link: ((s.issues || []).find((i) => i.url) || {}).url || (r.run ? r.run.url : null)
    })).sort(byState) })).filter((r) => r.items.length);
  }
  if (part === 'expo') {
    const eas = (st) => st === 'ERRORED' ? 'fail' : st === 'FINISHED' ? 'ok' : st === 'CANCELED' ? 'off' : 'run';
    // Newest on the right, as time runs.
    return [
      { label: 'Builds', items: (d.builds || []).map((b) => ({ s: eas(b.status), name: b.platform + ' · ' + (b.profile || '?') + (b.appVersion ? ' · ' + b.appVersion : ''), at: b.at,
        fields: fieldsOf([['Status', b.status], ['Started', b.at], ['Version', b.appVersion], ['Runtime', b.runtime]]) })).reverse() },
      { label: 'Store submissions', items: (d.submissions || []).map((x) => ({ s: eas(x.status), name: x.platform + (x.version ? ' · ' + x.version : ''), at: x.at,
        fields: fieldsOf([['Status', x.status], ['Sent', x.at], ['Version', x.version], ['Error', x.error]]) })).reverse() },
      { label: 'Updates', items: (d.updates || []).map((u) => ({ s: 'ok', name: u.branch + (u.platform ? ' · ' + u.platform : ''), at: u.at,
        fields: fieldsOf([['Branch', u.branch], ['Published', u.at], ['Platforms', u.platform], ['Runtime', u.runtime], ['Group', u.group]]) })).reverse() }
    ].filter((r) => r.items.length);
  }
  if (part === 'v2') {
    const v2 = { error: 'fail', cut_off: 'part', running: 'run', done: 'ok' };
    const read = (d.projects || []).map((p) => ({ s: v2[p.state] || 'none', name: 'Project ' + String(p.project_id).slice(0, 8), at: p.started_at,
      fields: fieldsOf([['Project', p.project_id], ['State', p.state], ['Step', p.step], ['Progress', p.total ? p.done + ' of ' + p.total : null],
        ['Started', p.started_at], ['Finished', p.finished_at], ['Failed passes, 7 days', p.failed_7d || null]]) }));
    // The page reads every project that is not done and the 5 latest done; the rest are counted.
    const unread = Math.max(0, Number((d.states || {}).done || 0) - read.filter((x) => x.s === 'ok').length);
    const rest = Array.from({ length: unread }, () => ({ s: 'ok', name: 'A project that is done', at: null, fields: [['Detail', 'The page reads only the 5 latest projects that are done.']] }));
    const items = read.concat(rest).sort(byState);
    return items.length ? [{ label: 'Projects', items }] : [];
  }
  if (part === 'userissues') {
    const items = (d.issues || []).map((r) => {
      const what = r.title || (r.keys || [])[0] || '';
      return { s: r.verdict === 'fixed' ? 'off' : r.closedAt ? 'ok' : 'part', name: (r.issue ? r.issue + ': ' : '') + what, at: r.firstAt,
        fields: fieldsOf([['Issue', r.issue], ['In Linear', r.issue ? r.state || (r.closedAt ? 'closed' : 'open') : null], ['People', r.people], ['Found', r.firstAt],
          ['Closed', r.closedAt], ['Fixed by', r.fixedBy ? 'PR ' + r.fixedBy : null], ['Keys', (r.keys || []).slice(0, 5).join(', ')]]),
        link: r.issueUrl || (r.fixedBy ? PR_URL + r.fixedBy : null) };
    }).sort(byState);
    return items.length ? [{ label: 'Issues, 90 days', items }] : [];
  }
  if (part === 'feedback') {
    const items = (d.items || []).map((f) => {
      const c = f.context || {};
      return { s: f.status === 'done' ? 'ok' : f.status === 'seen' ? 'run' : 'part', name: (f.kind === 'bug' ? 'Bug' : 'Idea') + (c.screen ? ' · ' + c.screen : ''), at: f.created_at,
        fields: fieldsOf([['Kind', f.kind], ['Status', f.status || 'new'], ['Sent', f.created_at], ['Screen', c.screen], ['Phone', [c.os, c.appVersion, c.channel].filter(Boolean).join(' ')],
          ['Says', f.body ? String(f.body).slice(0, 280) : f.voice_format ? '(a voice note)' : null], ['Install', f.install_id]]) };
    }).sort(byState);
    return items.length ? [{ label: 'Feedback, 30 days', items }] : [];
  }
  if (part === 'tutorials') {
    // In the order of the app's languages: a fixed list of 16.
    const items = (d.channels || []).map((c) => {
      const waits = (d.waiting || []).filter((w) => w.language === c.language);
      const ready = waits.filter((w) => !w.chosenAt).length;
      const failed = c.brandFailed || (waits.find((w) => w.chosenAt && w.failed) || {}).failed || null;
      return { s: failed ? 'fail' : !c.connectedAt ? 'none' : ready || c.held ? 'part' : 'ok', name: c.language, lang: true, at: c.latestAt,
        fields: fieldsOf([['Channel', c.title], ['Connected', c.connectedAt || 'no'], ['Videos on YouTube', c.videos], ['Latest up', c.latestAt],
          ['Ready to publish', ready || null], ['Chosen, going up', waits.length - ready || null], ['Comments held', c.held || null], ['Failed', failed]]),
        link: 'https://www.youtube.com/channel/' + c.channelId };
    });
    return items.length ? [{ label: 'Channels', items }] : [];
  }
  if (part === 'videofeedback') {
    const fixState = (x) => x.decision === null || x.decision === undefined ? 'part' : x.decision === 'rejected' ? 'off'
      : !x.fix ? 'ok' : x.fix.state === 'failed' ? 'fail' : x.fix.state === 'working' || x.fix.state === 'open' ? 'run' : x.fix.state === 'closed' ? 'off' : 'ok';
    const kindOf = (k) => k === 'comment' ? 'Comment' : k === 'code' ? 'Code change' : 'Note';
    return [
      { label: 'Suggestions', items: (d.suggestions || []).map((x) => ({ s: fixState(x), name: x.title, at: x.madeAt,
        fields: fieldsOf([['Kind', x.kind], ['Video', x.tutorial], ['Made', x.madeAt], ['Decision', x.decision ? x.decision + (x.clear ? ', a clear fix Claude accepted' : '') : 'waits for you'],
          ['Why', x.reason], ['Fix', x.fix ? x.fix.state + (x.fix.pr ? ', PR ' + x.fix.pr : '') : null], ['Note', x.fix ? x.fix.note : null], ['Linear', x.issue]]),
        link: x.fix && x.fix.pr ? PR_URL + x.fix.pr : x.issueUrl || null })).sort(byState) },
      { label: 'What came in', items: (d.inputs || []).map((i) => ({ s: i.lookedAt ? 'off' : 'none', name: kindOf(i.kind) + (i.tutorial ? ' · ' + i.tutorial : ''), at: i.at,
        fields: fieldsOf([['Kind', kindOf(i.kind)], ['Video', i.tutorial], ['Language', i.language], ['Came in', i.at], ['Says', String(i.english || i.text || '').slice(0, 280)],
          ['Looked at', i.lookedAt], ['Claude\'s answer', i.outcome]]),
        link: i.kind === 'code' && i.pr ? PR_URL + i.pr : null })).sort(byState) }
    ].filter((r) => r.items.length);
  }
  if (part === 'videos') {
    const lv = { bad: 'fail', warn: 'part', info: 'run', good: 'ok' };
    // A row for each app language, the videos in the same order in each, so a column is one video.
    return (d.languages || []).map((l) => ({ label: l.language, lang: true, items: (d.videos || []).filter((v) => v.language === l.language).map((v) => {
      const st = (v.states || [])[0] || { key: 'new', level: 'info', text: '' };
      return { s: st.key === 'paused' ? 'off' : lv[st.level] || 'none', name: v.title, at: v.film ? v.film.madeAt : null,
        fields: fieldsOf([['Language', v.language], ['Video', v.tutorial], ['State', (v.states || []).map((x) => x.text).filter(Boolean).join(' · ')],
          ['Filmed', v.film ? v.film.madeAt : null], ['Why filmed', v.film ? v.film.why : null], ['On YouTube', v.film ? (v.film.up ? 'yes' : 'no') : null]]),
        link: st.link || null };
    }) })).filter((r) => r.items.length);
  }
  return null;
}

/**
 * A long row as n squares, each a share of it, worst first (largest
 * remainder). A state with any item keeps a square, so one failure among
 * thousands still shows.
 */
function shareCells(items, n) {
  const total = items.length;
  if (!total) return [];
  const c = LIST_ORDER.map((s) => ({ s, k: items.filter((x) => x.s === s).length })).filter((x) => x.k)
    .map((x) => ({ s: x.s, q: (x.k * n) / total, n: Math.floor((x.k * n) / total) }));
  let left = n - c.reduce((a, x) => a + x.n, 0);
  for (const x of c.slice().sort((a, b) => (b.q - b.n) - (a.q - a.n))) if (left > 0) { x.n += 1; left -= 1; }
  for (const x of c) if (!x.n) { const big = c.reduce((a, b) => b.n > a.n ? b : a); big.n -= 1; x.n = 1; }
  return c.flatMap((x) => Array.from({ length: x.n }, () => x.s));
}
`;

/** Drawing the squares, the detail of one, and where they go. */
export const LISTS_SCRIPT = String.raw`
// ---- a square for each item of a fixed list (plan 5c2) ----------------------------------------
const LIST_SAID = {
  nightly: { one: 'suite', many: 'suites', fail: 'Broke', part: 'Tests failed', ok: 'Passed' },
  expo: { one: 'build or update', many: 'builds and updates', fail: 'Failed', run: 'In progress', ok: 'Done', off: 'Cancelled' },
  v2: { one: 'project', many: 'projects', fail: 'Failed', part: 'Stopped part way', run: 'Running', ok: 'Done' },
  userissues: { one: 'issue', many: 'issues', part: 'Open in Linear', ok: 'Closed', off: 'Already fixed when seen' },
  feedback: { one: 'item', many: 'items', part: 'Not seen', run: 'Seen', ok: 'Done' },
  tutorials: { one: 'channel', many: 'channels', fail: 'Failed on YouTube', part: 'Videos or comments wait', ok: 'Connected', none: 'Not connected' },
  videofeedback: { one: 'thing that came in', many: 'things that came in', fail: 'Claude could not', part: 'Waits for you', run: 'Claude works on it', ok: 'Accepted', off: 'No change', none: 'Not looked at yet' },
  videos: { one: 'video', many: 'videos', fail: 'Failed or held', part: 'Waits on someone', run: 'A worker has it', ok: 'Up to date', off: 'Paused' }
};
const rowName = (r) => r.lang ? languageName(r.label) : r.label;
const itemName = (x) => x.lang ? languageName(x.name) : x.name;

/** One row's squares, wrapped; each has its name for a pointer, and a mark for failed, waits and runs, so none rests on color alone. */
function listSvg(part, at, r, wrap) {
  const said = LIST_SAID[part];
  const share = r.items.length > SHARE_PAST;
  const cells = share ? shareCells(r.items, 100) : r.items.map((x) => x.s);
  const size = 10, gap = 2, st = size + gap, n = cells.length, cols = Math.min(n, share ? 20 : wrap), lines = Math.ceil(n / cols);
  const w = cols * st - gap, h = lines * st - gap;
  let body = '';
  cells.forEach((c, i) => {
    const x = (i % cols) * st, y = Math.floor(i / cols) * st;
    const tip = share ? (said[c] || c) + ': 1% of ' + num(r.items.length) : itemName(r.items[i]) + ' · ' + (said[c] || c);
    body += '<rect class="q ' + c + '" data-i="' + i + '" x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" rx="2"><title>' + esc(tip) + '</title></rect>';
    if (c === 'fail') body += '<path class="mk" d="M' + (x + 3) + ' ' + (y + 3) + 'L' + (x + 7) + ' ' + (y + 7) + 'M' + (x + 7) + ' ' + (y + 3) + 'L' + (x + 3) + ' ' + (y + 7) + '"/>';
    else if (c === 'part') body += '<circle class="dt" cx="' + (x + 5) + '" cy="' + (y + 5) + '" r="1.8"/>';
    else if (c === 'run') body += '<circle class="rg" cx="' + (x + 5) + '" cy="' + (y + 5) + '" r="2.4"/>';
  });
  const counts = LIST_ORDER.filter((s) => said[s]).map((s) => [s, r.items.filter((x) => x.s === s).length]).filter((p) => p[1]);
  const label = rowName(r) + ': ' + counts.map((p) => num(p[1]) + ' ' + said[p[0]].toLowerCase()).join(', ') + (share ? ', one square for each 1%' : '') +
    '. Tap a square, or use the arrow keys and Enter, for its detail.';
  return '<svg class="sq" width="' + Math.round(w * 1.25) + '" height="' + Math.round(h * 1.25) + '" viewBox="0 0 ' + w + ' ' + h + '" tabindex="0" role="img" aria-label="' + esc(label) + '"' +
    ' data-part="' + esc(part) + '" data-row="' + at + '" data-n="' + n + '" data-cols="' + cols + '">' + body + '</svg>';
}

/** A part's list as squares; on a card (mini), the rows that need a look lead, 4 at most. */
function listBox(part, d, mini) {
  const said = LIST_SAID[part];
  const rows = said ? listRows(part, d) : null;
  if (!rows || !rows.length) return '';
  const all = rows.flatMap((r) => r.items);
  const order = rows.map((r, at) => ({ r, at, w: Math.min.apply(null, r.items.map((x) => rankOf(x.s))) }));
  const shown = mini ? order.slice().sort((a, b) => a.w - b.w || a.at - b.at).slice(0, 4) : order;
  // The videos keep one video in each column; other lists wrap, and on a phone every list wraps at 24 so a square stays big enough to tap.
  const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;
  const wrap = mini || narrow ? 24 : part === 'videos' ? Math.max.apply(null, rows.map((r) => r.items.length)) : 50;
  return '<div class="chart sqbox lstbox' + (mini ? ' mini' : '') + '" data-part="' + esc(part) + '">' +
    '<div class="ct"><span>' + esc(PART_TITLE[part] || part) + ', a square for each ' + esc(said.one) + '</span><b>' + num(all.length) + ' ' + esc(all.length === 1 ? said.one : said.many) + '</b></div>' +
    '<div class="sqrows">' + shown.map((o) => '<div class="sqrow"><span title="' + esc(rowName(o.r)) + '">' + esc(rowName(o.r)) + (o.r.items.length > SHARE_PAST ? ' (1% each)' : '') + '</span>' +
      listSvg(part, o.at, o.r, wrap) + '</div>').join('') + '</div>' +
    (shown.length < rows.length ? '<p class="muted">' + num(rows.length - shown.length) + ' more rows in ' + esc(PART_TITLE[part] || part) + '.</p>' : '') +
    '<div class="sqleg">' + LIST_ORDER.filter((s) => said[s]).map((s) => '<span><i class="' + s + '"></i>' + esc(said[s]) + ' <b>' + num(all.filter((x) => x.s === s).length) + '</b></span>').join('') + '</div></div>';
}

/** The nightly R2 check: blob_reconcile's row of the job squares, a square a night for 14 nights (the Jobs totals). */
let r2Nights;
function r2Pic(mini) {
  if (r2Nights === undefined) {
    r2Nights = null;
    loadHistory('jobs', '14d').then((h) => { r2Nights = h; }, () => { r2Nights = false; }).then(() => {
      if (results.storage) show('storage', results.storage);
      renderStart();
    });
  }
  if (r2Nights === null) return '<p class="muted">Loading the nightly R2 check…</p>';
  return r2Nights ? squaresBox('jobs', r2Nights, '14d', mini ? 1 : 0, null, { key: 'blob_reconcile', title: 'Nightly R2 check' }) : '';
}

/** The picture at the top of a part, in its section and on All sections. */
function listPicture(part, d) {
  if (part === 'storage') return r2Pic(false);
  return LIST_SAID[part] ? listBox(part, d, false) : '';
}
/** The picture on a part's card on the start page, or '' when it has none. */
function listCardPic(part) {
  const s = results[part];
  if (part === 'storage') return r2Pic(true);
  return LIST_SAID[part] && s && s.state === 'ok' ? listBox(part, s.data, true) : '';
}

// A field's time as a time; the rest as written.
const ISO_AT = /^\d{4}-\d\d-\d\dT\d\d:\d\d/;
const fieldValue = (v) => typeof v === 'string' && ISO_AT.test(v)
  ? esc(new Date(v).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' })) + ' UTC <small>(' + esc(ago(v)) + ')</small>'
  : esc(String(v));
const fieldsTable = (fields) => '<div class="keyed">' + table([{ h: 'What', v: (f) => esc(f[0]) }, { h: 'Value', v: (f) => fieldValue(f[1]) }], fields) + '</div>';
const openLink = (link) => String(link || '').startsWith('https://') ? '<a class="button" href="' + esc(link) + '" target="_blank" rel="noopener">Open the page</a>' : '';

/** The detail of one square: the item's fields and its page; for a 1% square, the items it stands for, 50 at a time. */
function openItem(svg, i) {
  const part = svg.dataset.part;
  const s = results[part];
  const rows = s && s.state === 'ok' ? listRows(part, s.data) : null;
  const r = rows && rows[Number(svg.dataset.row)];
  if (!r) return;
  markBucket(svg, i);
  const said = LIST_SAID[part];
  const share = r.items.length > SHARE_PAST;
  const state = share ? shareCells(r.items, 100)[i] : r.items[i].s;
  const items = share ? r.items.filter((x) => x.s === state) : [r.items[i]];
  shown = { svg, list: { part, items, page: 1 } };
  const where = (PART_TITLE[part] || part) + ' · ' + rowName(r) + ' · ' + (said[state] || state);
  const x = items[0];
  $('detail').innerHTML = '<div class="head"><h2 id="detail-title">' + (share ? esc(said[state] || state) + ': ' + num(items.length) + ' of ' + num(r.items.length) : esc(itemName(x))) + '</h2>' +
    '<button type="button" id="detail-close" aria-label="Close the details">Close</button></div>' +
    '<p class="muted">' + esc(where) + '</p>' +
    (share ? '<div id="detail-rows"></div>' : fieldsTable(x.fields) + '<p class="tools">' + openLink(x.link) + '<button type="button" id="detail-copy">Copy as JSON</button></p>');
  $('detail-close').addEventListener('click', closeDetail);
  if (share) drawShare();
  else $('detail-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(JSON.stringify({ part, name: x.name, state: x.s, fields: Object.fromEntries(x.fields), link: x.link || null }, null, 2)); $('detail-copy').textContent = 'Copied'; }
    catch { $('detail-copy').textContent = 'Could not copy'; }
  });
  $('detail').hidden = false;
  $('detail-close').focus();
}

/** The items a 1% square stands for, each opened in place. */
function drawShare() {
  const l = shown.list;
  const page = l.items.slice(0, l.page * 50);
  $('detail-rows').innerHTML = page.map((x) => '<details><summary>' + esc(itemName(x)) + (x.at ? ' <small>' + esc(ago(x.at)) + '</small>' : '') + '</summary>' +
    fieldsTable(x.fields) + (openLink(x.link) ? '<p>' + openLink(x.link) + '</p>' : '') + '</details>').join('') +
    (l.items.length > page.length ? '<p class="tools"><button type="button" id="detail-more">Show 50 more</button></p>' : '');
  if ($('detail-more')) $('detail-more').addEventListener('click', () => { l.page += 1; drawShare(); });
}

document.addEventListener('click', (e) => {
  const svg = e.target.closest && e.target.closest('.lstbox svg.sq');
  const cell = svg && e.target.closest('rect[data-i]');
  if (cell) openItem(svg, Number(cell.dataset.i));
});
document.addEventListener('keydown', (e) => {
  const svg = e.target.closest && e.target.closest('.lstbox svg.sq');
  if (!svg) return;
  const n = Number(svg.dataset.n), cols = Number(svg.dataset.cols);
  const at = Number(svg.dataset.sel || 0);
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
  if (step) { e.preventDefault(); markBucket(svg, Math.max(0, Math.min(n - 1, at + step))); }
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openItem(svg, at); }
});
`;

export const LISTS_CSS = String.raw`
svg.sq .q.run { fill: var(--primary); } svg.sq .q.off { fill: var(--grey); }
svg.sq .rg { fill: none; stroke: var(--card); stroke-width: 1.4; pointer-events: none; }
.lstbox svg.sq rect { cursor: pointer; }
.lstbox .sqleg b { color: var(--ink); font-weight: 600; }
.sqleg i.run { background: var(--primary); } .sqleg i.off { background: var(--grey); }
.part-pic { margin: 8px 0 12px; } .part-pic .lstbox { width: fit-content; min-width: min(420px, 100%); max-width: 100%; }
#detail details { border-bottom: 1px solid var(--line); padding: 6px 0; }
#detail .tools a.button { display: inline-flex; align-items: center; text-decoration: none; }
`;
