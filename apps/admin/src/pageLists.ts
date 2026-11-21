/**
 * The pictures for fixed lists (docs/ops-dashboard-plan.md 5c2): a square
 * for each nightly suite, EAS build, v2 project, user issue, feedback item,
 * YouTube channel, video and suggestion, drawn from the data each part has
 * already read, on its card on the start page and at the top of its part. A
 * tap on a square opens that item's detail. A row that grows with people
 * (feedback, issues, v2 projects) turns into 100 squares of 1% each past 200
 * items, so the picture keeps its size. The nightly R2 check is the
 * blob_reconcile row of the job squares (pageStart.ts), one square a night.
 * A row can draw another shape instead (`draw`): a track, a line or an axis
 * (5c3), or a meter or a share (pageMeters.ts, 5c4).
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
  // ---- lanes and lines (plan 5c3): the same items, drawn on a track, a line or an axis of days ----
  if (part === 'pipeline') {
    const tone = { bad: 'fail', wait: 'part', busy: 'run', live: 'ok' };
    // A lane's stages in order on a track; a stage's mark is its most urgent build.
    return (d.lanes || []).map((l) => ({ label: l.title, draw: 'track', items: (l.stages || []).map((st) => {
      const cards = st.cards || [];
      const s = cards.map((c) => tone[c.tone] || 'none').sort((a, b) => rankOf(a) - rankOf(b))[0] || 'none';
      return { s, name: st.title, short: cards.length ? String(cards[0].build || cards[0].title).replace(/^build /, '') + (cards.length > 1 ? ' +' + (cards.length - 1) : '') : '',
        at: cards.length ? cards[0].at : null,
        fields: cards.length ? cards.flatMap((c) => fieldsOf([[c.title + (c.version ? ' (' + c.version + ')' : ''), c.state], ['Since', c.at],
          ['Updates it takes', c.updates && c.updates.length ? c.updates.length : null]])) : [['Builds', st.unseen || 'none']] };
    }) })).filter((r) => r.items.length);
  }
  if (part === 'releases') {
    // Errors a day as a line; under it, a tick for each day that shipped a merge, a deploy or an update.
    const items = (d.errorsByDay || []).slice().sort((a, b) => String(a.day).localeCompare(String(b.day))).map((e) => {
      const shipped = (d.timeline || []).filter((t) => String(t.at).slice(0, 10) === e.day);
      return { s: Number(e.crashes) ? 'fail' : shipped.length ? 'run' : 'ok', name: e.day, at: null, v: Number(e.errors) || 0, crashes: Number(e.crashes) || 0, shipped: shipped.length,
        fields: fieldsOf([['Errors', e.errors], ['Crashes', e.crashes], ['Installs', e.installs]]).concat(shipped.slice(0, 20).map((t) => [t.kind, t.text]),
          shipped.length > 20 ? [['More', (shipped.length - 20) + ' more shipped']] : []) };
    });
    return items.length ? [{ label: 'Errors a day', draw: 'line', items }] : [];
  }
  if (part === 'expiry') {
    const now = Date.now();
    const items = (d.items || []).map((x) => {
      const left = x.expires ? (Date.parse(x.expires) - now) / 86400000 : null;
      return { s: left === null ? 'none' : left <= 7 ? 'fail' : left <= 30 ? 'part' : 'ok', name: x.what, at: x.expires, days: left,
        fields: fieldsOf([['Expires', x.expires || 'no date'], ['Days left', left === null ? null : Math.ceil(left)], ['From', x.source], ['Note', x.note]]) };
    }).sort((a, b) => Number(a.days === null) - Number(b.days === null) || a.days - b.days);
    return items.length ? [{ label: 'Days left', draw: 'axis', items }] : [];
  }
  if (part === 'appstore') {
    const words = (st) => String(st || '').toLowerCase().replace(/_/g, ' ');
    const ver = (st) => /REJECTED|INVALID/.test(st) ? 'fail' : st === 'READY_FOR_SALE' || st === 'READY_FOR_DISTRIBUTION' ? 'ok' : st === 'IN_REVIEW' ? 'run'
      : /WAITING|PENDING/.test(st) ? 'part' : /REPLACED|REMOVED/.test(st) ? 'off' : 'none';
    const oldestFirst = (a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0);
    return [
      { label: 'Versions', items: (d.versions || []).map((v) => ({ s: ver(v.state), name: v.version + (v.platform ? ' · ' + v.platform : ''), at: v.at,
        fields: fieldsOf([['State', words(v.state)], ['Created', v.at], ['Platform', v.platform]]) })).sort(oldestFirst) },
      { label: 'Builds', items: (d.builds || []).map((b) => ({ s: b.expired ? 'off' : b.state === 'VALID' ? 'ok' : b.state === 'PROCESSING' ? 'run' : 'fail',
        name: (b.version || '?') + (b.build ? ' (' + b.build + ')' : ''), at: b.uploadedAt,
        fields: fieldsOf([['Processing', words(b.state)], ['Uploaded', b.uploadedAt], ['Expired', b.expired ? 'yes' : null]]) })).sort(oldestFirst) }
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
  // Meters and shares (pageMeters.ts) are rows of the same lists.
  return typeof meterRows === 'function' ? meterRows(part, d) : null;
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
  videos: { one: 'video', many: 'videos', fail: 'Failed or held', part: 'Waits on someone', run: 'A worker has it', ok: 'Up to date', off: 'Paused' },
  pipeline: { one: 'stage', many: 'stages', pic: 'a dot for each stage, its build above', fail: 'Needs a person', part: 'Waiting', run: 'On its way', ok: 'What people get', none: 'No build' },
  releases: { one: 'day', many: 'days', pic: 'errors and crashes each day, a tick on each day with a change', line: true },
  expiry: { one: 'key', many: 'keys', pic: 'a dot for each key on a line of days left', fail: 'Expired, or 7 days or less', part: '30 days or less', ok: 'More than 30 days', none: 'No date' },
  appstore: { one: 'version or build', many: 'versions and builds', fail: 'Rejected or not valid', part: 'Waits for Apple', run: 'In review or processing', ok: 'On the App Store, or valid', off: 'Replaced or expired', none: 'Not sent' }
};
const rowName = (r) => r.lang ? languageName(r.label) : r.label;
const itemName = (x) => x.lang ? languageName(x.name) : x.name;

/** The mark inside a square or a dot: an x for failed, a dot for waits, a ring for runs, so none rests on color alone. */
function markAt(c, cx, cy, k) {
  const a = 2 * k;
  if (c === 'fail') return '<path class="mk" d="M' + (cx - a) + ' ' + (cy - a) + 'L' + (cx + a) + ' ' + (cy + a) + 'M' + (cx + a) + ' ' + (cy - a) + 'L' + (cx - a) + ' ' + (cy + a) + '"/>';
  if (c === 'part') return '<circle class="dt" cx="' + cx + '" cy="' + cy + '" r="' + (1.8 * k) + '"/>';
  if (c === 'run') return '<circle class="rg" cx="' + cx + '" cy="' + cy + '" r="' + (2.4 * k) + '"/>';
  return '';
}

/** The svg around a row's marks, with what a screen reader says and what the keys move over. */
function rowSvg(part, at, r, w, h, n, cols, body, how, k, hv) {
  const said = LIST_SAID[part];
  const counts = LIST_ORDER.filter((s) => said[s]).map((s) => [s, r.items.filter((x) => x.s === s).length]).filter((p) => p[1]);
  const label = rowName(r) + ': ' + counts.map((p) => num(p[1]) + ' ' + said[p[0]].toLowerCase()).join(', ') + (how ? ', ' + how : '') +
    '. Tap a mark, or use the arrow keys and Enter, for its detail.';
  return '<svg class="sq' + (r.draw ? ' ' + r.draw : '') + '" width="' + Math.round(w * (k || 1.25)) + '" height="' + Math.round(h * (k || 1.25)) + '" viewBox="0 0 ' + w + ' ' + h + '" tabindex="0" role="img" aria-label="' + esc(label) + '"' +
    ' data-part="' + esc(part) + '" data-row="' + at + '" data-n="' + n + '" data-cols="' + cols + '"' + (hv || '') + '>' + body + '</svg>';
}

/** A lane's stages: a dot on a track for each, what it holds above, its name below. */
function trackSvg(part, at, r, mini) {
  // On a card a lane must fit about 200 px at full size, so its stages close up and a long name takes two lines.
  const said = LIST_SAID[part], n = r.items.length, gap = mini && n > 2 ? 52 : 72, two = mini && n > 2, w = 48 + (n - 1) * gap, h = two ? 58 : 50, X = (i) => 24 + i * gap;
  const name = (x, cx) => {
    const t = String(x.name), sp = t.indexOf(' ');
    if (!two || t.length <= 9 || sp < 0) return '<text class="tx" x="' + cx + '" y="46" text-anchor="middle">' + esc(t.slice(0, 16)) + '</text>';
    return '<text class="tx" x="' + cx + '" y="45" text-anchor="middle">' + esc(t.slice(0, sp).slice(0, 10)) + '<tspan x="' + cx + '" dy="10">' + esc(t.slice(sp + 1).slice(0, 10)) + '</tspan></text>';
  };
  let body = '<path class="tk" d="M' + X(0) + ' 24H' + X(n - 1) + '"/>';
  r.items.forEach((x, i) => {
    const big = x.s !== 'none';
    body += '<circle class="q ' + x.s + '" data-i="' + i + '" cx="' + X(i) + '" cy="24" r="' + (big ? 7 : 4) + '" data-tip="' + esc(itemName(x) + ' · ' + (said[x.s] || x.s)) + '"/>' +
      markAt(x.s, X(i), 24, 1) +
      (x.short ? '<text class="tx b" x="' + X(i) + '" y="10" text-anchor="middle">' + esc(String(x.short).slice(0, 12)) + '</text>' : '') +
      name(x, X(i));
  });
  return rowSvg(part, at, r, w, h, n, n, body, '', mini ? 1 : 0);
}

/** Errors a day as a line, an x on a day with a crash, a tick under a day that shipped; a tap on a day opens it. */
function lineSvg(part, at, r, mini) {
  const n = r.items.length, w = mini ? 210 : 300, h = 96, top = 8, base = h - 30, step = n > 1 ? (w - 20) / (n - 1) : w - 20;
  const max = Math.max.apply(null, [1].concat(r.items.map((x) => x.v)));
  const X = (i) => n > 1 ? 10 + i * step : w / 2, Y = (v) => base - (v / max) * (base - top);
  const line = r.items.map((x, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(x.v).toFixed(1)).join('');
  let body = '<path class="ar" d="' + line + 'L' + X(n - 1).toFixed(1) + ' ' + base + 'L' + X(0).toFixed(1) + ' ' + base + 'Z"/>' +
    '<path class="bl" d="M4 ' + base + 'H' + (w - 4) + '"/><path class="ln" d="' + line + '"/>';
  r.items.forEach((x, i) => {
    const cx = X(i);
    body += '<rect class="hit" data-i="' + i + '" x="' + (cx - step / 2).toFixed(1) + '" y="0" width="' + step.toFixed(1) + '" height="' + (base + 22) + '"/>';
    if (x.crashes) body += '<path class="cx" d="M' + (cx - 3.5) + ' ' + (base - 11.5) + 'l7 7M' + (cx + 3.5) + ' ' + (base - 11.5) + 'l-7 7"/>';
    if (x.shipped) body += '<rect class="tick" x="' + (cx - 2).toFixed(1) + '" y="' + (base + 5) + '" width="4" height="' + Math.min(14, 3 + x.shipped * 1.2).toFixed(1) + '" rx="1"/>';
  });
  body += '<text class="tx" x="' + X(0) + '" y="' + (h - 2) + '">' + esc(r.items[0].name.slice(5)) + '</text>' +
    '<text class="tx" x="' + X(n - 1) + '" y="' + (h - 2) + '" text-anchor="end">' + esc(r.items[n - 1].name.slice(5)) + ' UTC</text>';
  // For the pointer: each day's errors, crashes and what shipped (pageHover.ts).
  const hv = hvAttr(X(0) - step / 2, step, r.items.map((x) => bucketLabel(x.name + 'T00:00:00Z', 'day') + ' UTC'),
    [['', 'Errors', r.items.map((x) => num(x.v))], ['', 'Crashes', r.items.map((x) => num(x.crashes))], ['', 'Shipped', r.items.map((x) => num(x.shipped))]], 0, base + 20);
  return rowSvg(part, at, r, w, h, n, n, body, 'a day a step', mini ? 1 : 0, hv);
}

/** Each key as a dot on a line of days left, 0 to 120; the zones under 7 and 30 days are its alerts. */
function axisSvg(part, at, r, mini) {
  const said = LIST_SAID[part], n = r.items.length, w = mini ? 210 : 320, h = 70, L = 14, R = w - 14, MAXD = 120;
  const X = (d) => L + (Math.max(0, Math.min(MAXD, d)) / MAXD) * (R - L);
  let body = '<rect class="zf" x="' + L + '" y="4" width="' + (X(7) - L).toFixed(1) + '" height="44"/><rect class="zp" x="' + X(7).toFixed(1) + '" y="4" width="' + (X(30) - X(7)).toFixed(1) + '" height="44"/>' +
    '<path class="bl" d="M' + L + ' 48H' + R + '"/>' +
    // On a card, 0 and 7 would touch, so 7 stays, and the row's name says days.
    [[0, '0'], [7, '7'], [30, '30'], [60, '60'], [90, '90'], [MAXD, mini ? '120+' : '120+ days']].filter((t) => !mini || t[0]).map((t) => '<text class="tx" x="' + X(t[0]).toFixed(1) + '" y="62" text-anchor="' + (t[0] === MAXD ? 'end' : 'middle') + '">' + t[1] + '</text>').join('');
  const used = [];
  r.items.forEach((x, i) => {
    const cx = x.days === null ? R : X(x.days);
    // Dots on the same days stack, so each stays a tap of its own.
    let k = 0;
    while (used.some((u) => Math.abs(u[0] - cx) < 11 && u[1] === k)) k += 1;
    used.push([cx, k]);
    const cy = 38 - (k % 3) * 12;
    body += '<circle class="q ' + x.s + '" data-i="' + i + '" cx="' + cx.toFixed(1) + '" cy="' + cy + '" r="5" data-tip="' +
      esc(x.name + ' · ' + (x.days === null ? 'no date' : x.days < 0 ? 'expired' : Math.ceil(x.days) + ' days left')) + '"/>' + markAt(x.s, Number(cx.toFixed(1)), cy, 0.8);
  });
  return rowSvg(part, at, r, w, h, n, n, body, 'on a line of days left', mini ? 1 : 0);
}

/** One row's squares, wrapped; each has its name for a pointer (data-tip, pageHover.ts), and a mark for failed, waits and runs, so none rests on color alone. */
function listSvg(part, at, r, wrap, mini) {
  if (r.draw === 'track') return trackSvg(part, at, r, mini);
  if (r.draw === 'line') return lineSvg(part, at, r, mini);
  if (r.draw === 'axis') return axisSvg(part, at, r, mini);
  if (r.draw === 'meter') return meterSvg(part, at, r, mini);
  if (r.draw === 'share') return shareSvg(part, at, r, mini);
  const said = LIST_SAID[part];
  const share = r.items.length > SHARE_PAST;
  const cells = share ? shareCells(r.items, 100) : r.items.map((x) => x.s);
  const size = 10, gap = 2, st = size + gap, n = cells.length, cols = Math.min(n, share ? 20 : wrap), lines = Math.ceil(n / cols);
  const w = cols * st - gap, h = lines * st - gap;
  let body = '';
  cells.forEach((c, i) => {
    const x = (i % cols) * st, y = Math.floor(i / cols) * st;
    const tip = share ? (said[c] || c) + ': 1% of ' + num(r.items.length) : itemName(r.items[i]) + ' · ' + (said[c] || c);
    body += '<rect class="q ' + c + '" data-i="' + i + '" x="' + x + '" y="' + y + '" width="' + size + '" height="' + size + '" rx="2" data-tip="' + esc(tip) + '"/>' + markAt(c, x + 5, y + 5, 1);
  });
  return rowSvg(part, at, r, w, h, n, cols, body, share ? 'one square for each 1%' : '');
}

/** A part's list as squares; on a card (mini), the rows that need a look lead, 4 at most. */
function listBox(part, d, mini) {
  const said = LIST_SAID[part];
  const rows = said ? listRows(part, d) : null;
  if (!rows || !rows.length) return '';
  const all = rows.flatMap((r) => r.items);
  // The head counts the list's items; a row of context (count: false) is left out.
  const counted = rows.filter((r) => r.count !== false).flatMap((r) => r.items);
  // A share counts what it splits (syncs, requests, installs), not its parts.
  const weigh = (xs) => said.sum ? xs.reduce((a, x) => a + (Number(x.v) || 0), 0) : xs.length;
  const order = rows.map((r, at) => ({ r, at, w: Math.min.apply(null, r.items.map((x) => rankOf(x.s))) }));
  const shown = mini ? order.slice().sort((a, b) => a.w - b.w || a.at - b.at).slice(0, 4) : order;
  // The videos keep one video in each column; other lists wrap, and on a phone every list wraps at 24 so a square stays big enough to tap.
  const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;
  const wrap = mini || narrow ? 24 : part === 'videos' ? Math.max.apply(null, rows.map((r) => r.items.length)) : 50;
  return '<div class="chart sqbox lstbox' + (mini ? ' mini' : '') + '" data-part="' + esc(part) + '">' +
    '<div class="ct"><span>' + esc(PART_TITLE[part] || part) + ', ' + esc(said.pic || 'a square for each ' + said.one) + '</span><b>' + num(weigh(counted)) + ' ' + esc(weigh(counted) === 1 ? said.one : said.many) + '</b></div>' +
    '<div class="sqrows">' + shown.map((o) => '<div class="sqrow"><span title="' + esc(rowName(o.r)) + '">' + esc(rowName(o.r)) + (o.r.items.length > SHARE_PAST ? ' (1% each)' : '') + '</span>' +
      listSvg(part, o.at, o.r, wrap, mini) + '</div>').join('') + '</div>' +
    (shown.length < rows.length ? '<p class="muted">' + num(rows.length - shown.length) + ' more rows in ' + esc(PART_TITLE[part] || part) + '.</p>' : '') +
    (said.line ? '<div class="sqleg"><span><i class="ln"></i>Errors a day</span><span><i class="cx"></i>Crashes <b>' + num(all.reduce((a, x) => a + (x.crashes || 0), 0)) + '</b></span>' +
      '<span><i class="tick"></i>Shipped <b>' + num(all.reduce((a, x) => a + (x.shipped || 0), 0)) + '</b></span></div></div>'
      : '<div class="sqleg">' + LIST_ORDER.filter((s) => said[s] && (!mini || all.some((x) => x.s === s))).map((s) => '<span><i class="' + s + '"></i>' + esc(said[s]) + ' <b>' + num(weigh(all.filter((x) => x.s === s))) + '</b></span>').join('') + '</div></div>');
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
  if (part === 'code') return codeBox(d, false);
  return LIST_SAID[part] ? listBox(part, d, false) : '';
}
/** The picture on a part's card on the start page, or '' when it has none. */
function listCardPic(part) {
  const s = results[part];
  if (part === 'storage') return r2Pic(true);
  if (part === 'code') return s && s.state === 'ok' ? codeBox(s.data, true) : '';
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
  const share = !r.draw && r.items.length > SHARE_PAST;
  const state = share ? shareCells(r.items, 100)[i] : r.items[i].s;
  const items = share ? r.items.filter((x) => x.s === state) : [r.items[i]];
  shown = { svg, list: { part, items, page: 1 } };
  const where = (PART_TITLE[part] || part) + ' · ' + rowName(r) + (said[state] ? ' · ' + said[state] : '');
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
  const cell = svg && e.target.closest('[data-i]');
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

/**
 * The controls with which a person answers a queue: Grant or Deny, Accept, Reject or Edit, Send to
 * Claude, a video's cards, the Tutorial videos tabs (which open on what waits on the admin), a reply
 * copied or marked done, Try again, Add a note, Connect or Publish, Seen or Done, an issue tab. A part that
 * shows one keeps its body open under its picture, so an answer never waits behind "Show the numbers".
 */
export const QUEUE_CONTROLS = ['data-decision', 'data-sg', 'data-instruct', 'data-cards', 'data-note', 'data-yt-connect', 'data-yt-publish', 'data-yt-item', 'data-yt-all', 'data-fb', 'data-itab', 'data-uinote',
  'data-vtab', 'data-reply-copy', 'data-reply-done', 'data-retry'];
/**
 * The controls that may wait behind "Show the numbers": they open, look, move or zoom, or only quiet a
 * warning or start a job early (Not an issue, Run now). A new control goes in one list or the other
 * (`test/meters.test.ts`).
 */
export const FOLDED_CONTROLS = ['data-quiet', 'data-ok', 'data-run', 'data-org', 'data-q', 'data-install', 'data-fb-id', 'data-shot', 'data-what', 'data-status',
  'data-mark', 'data-vzoom', 'data-vfit', 'data-vclose', 'data-voice', 'data-goto', 'data-range', 'data-key', 'data-lookup', 'data-h', 'data-s', 'data-t', 'data-l',
  'data-kind', 'data-ver', 'data-done', 'data-href', 'data-help', 'data-help-key'];
/** Whether a part's body holds a queue control (above). */
export const QUEUE_SOURCE = String.raw`\s(?:` + QUEUE_CONTROLS.join('|') + String.raw`)(?=[\s=>])`;

export const LISTS_CSS = String.raw`
svg.sq .q.run { fill: var(--primary); } svg.sq .q.off { fill: var(--grey); }
svg.sq .rg { fill: none; stroke: var(--card); stroke-width: 1.4; pointer-events: none; }
.lstbox svg.sq .q { pointer-events: all; } .lstbox svg.sq circle.q.none { fill: var(--card); stroke: var(--muted); }
.lstbox svg.sq circle.q.sel { stroke: var(--ink); stroke-width: 2.5; }
svg.sq .tk, svg.sq .bl { fill: none; stroke: var(--line); stroke-width: 1.5; } svg.sq .tx { font-size: 9px; fill: var(--muted); } svg.sq .tx.b { fill: var(--ink); font-weight: 600; }
svg.sq .ln { fill: none; stroke: var(--primary); stroke-width: 2; stroke-linejoin: round; } svg.sq .ar { fill: var(--primary); opacity: .12; }
svg.sq .hit { fill: transparent; cursor: pointer; } svg.sq .hit.sel { fill: var(--primary); opacity: .15; }
svg.sq .cx { fill: none; stroke: var(--red); stroke-width: 2.2; stroke-linecap: round; pointer-events: none; } svg.sq .tick { fill: var(--ink); pointer-events: none; }
svg.sq .zf { fill: var(--redbg); } svg.sq .zp { fill: var(--amberbg); }
.sqleg i.ln { height: 2px; background: var(--primary); vertical-align: 3px; } .sqleg i.cx { background: var(--red); } .sqleg i.tick { width: 4px; background: var(--ink); }
.lstbox svg.sq rect { cursor: pointer; }
.lstbox .sqleg b { color: var(--ink); font-weight: 600; }
.sqleg i.run { background: var(--primary); } .sqleg i.off { background: var(--grey); }
details.numbers { margin: 4px 0 16px; } details.numbers > summary { display: inline-flex; align-items: center; min-height: 48px; padding: 0 16px; border: 1px solid var(--line); border-radius: 10px; cursor: pointer; font-weight: 600; color: var(--primary); list-style: none; }
details.numbers > summary::-webkit-details-marker { display: none; } details.numbers[open] > summary { margin-bottom: 8px; }
details.numbers[open] .sn, details.numbers:not([open]) .hn { display: none; }
.part-pic { margin: 8px 0 12px; } .part-pic .lstbox { width: fit-content; min-width: min(420px, 100%); max-width: 100%; }
#detail details { border-bottom: 1px solid var(--line); padding: 6px 0; }
#detail .tools a.button { display: inline-flex; align-items: center; text-decoration: none; }
`;
