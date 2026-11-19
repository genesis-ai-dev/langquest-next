/**
 * One card format for what a person answers (docs/decisions/2026-11-18-ops-dashboard-menu-and-overview.md,
 * amended): a user issue on the User issues page, and a question about a
 * tutorial video on the Tutorial videos page. A card has, left to right: its
 * pictures (when it has them), its title with Context, Issue and Solution
 * lines, and at the right who acts next, its steps as dots, the talk with
 * Claude (the admin's words, then Claude's answer) and the box to tell Claude
 * what to do. Each word and dot comes from what a part answered: a card never
 * shows a step that nothing recorded. Plain JavaScript inside page.ts's
 * script, like pageStart.ts; everything shown is escaped.
 */

/** The cards' look, inside page.ts's style element. */
export const ISSUE_CSS = String.raw`
.itabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; margin: 12px 0; background: var(--soft); border-radius: 12px; width: fit-content; max-width: 100%; }
.itabs button { min-height: 40px; padding: 0 12px; border: 0; border-radius: 9px; background: none; color: var(--ink2); font-weight: 500; font-size: 13.5px; display: inline-flex; gap: 8px; align-items: center; }
.itabs button[aria-pressed="true"] { background: var(--raised); color: var(--ink); font-weight: 600; box-shadow: 0 1px 2px rgb(0 0 0 / .1); }
.itabs .count { font-size: 11.5px; font-weight: 600; padding: 1px 7px; border-radius: 999px; background: var(--line); color: var(--ink); font-variant-numeric: tabular-nums; }
.itabs button[aria-pressed="true"] .count { background: var(--ink); color: var(--card); }
.icards { container-type: inline-size; }
.icard { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 16px 24px; align-items: start; padding: 16px 18px; margin: 10px 0; background: var(--raised); border: 1px solid var(--line); border-radius: 14px; }
.icard.pics { grid-template-columns: minmax(200px, 300px) minmax(0, 1fr) 280px; }
.icard[hidden] { display: none; }
.ipics { min-width: 0; } .ipics .vpics { margin: 0; } .ipics .vpic, .ipics .vpic.zoom { max-width: 100%; }
.ibody { min-width: 0; }
.itags { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0 0 6px; font-size: 12px; color: var(--muted); }
.itags .tag { margin: 0; background: var(--soft); color: var(--ink2); } .itags .tag.bad { color: var(--red); background: var(--redbg); }
.itags a.lin { font-weight: 600; color: var(--ink); text-decoration: none; letter-spacing: .02em; } .itags a.lin:hover, .itags a.lin:focus-visible { color: var(--primary); text-decoration: underline; }
.icard a.pr, dl.kv a { color: var(--primary); font-weight: 600; }
dl.kv dd > small { display: block; font-size: 12px; line-height: 1.4; }
.icard h4 { font-size: 16px; line-height: 1.3; margin: 0 0 4px; overflow-wrap: anywhere; }
.imeta { font-size: 12.5px; color: var(--muted); margin: 0 0 10px; }
dl.kv { display: grid; grid-template-columns: 82px minmax(0, 1fr); gap: 8px 12px; margin: 10px 0 0; font-size: 13.5px; line-height: 1.45; }
dl.kv dt { font-size: 10.5px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); padding-top: 3px; }
dl.kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; } dl.kv dd p { margin: 0 0 4px; } dl.kv dd ul { margin: 4px 0 0; padding-inline-start: 18px; }
.iside { display: grid; gap: 8px; align-content: start; min-width: 0; }
.ipill { justify-self: start; font-size: 11.5px; font-weight: 600; padding: 2px 9px; border-radius: 999px; background: var(--soft); color: var(--ink2); }
.ipill.you { background: var(--amberbg); color: var(--amber); } .ipill.claude { color: var(--primary); } .ipill.done { background: var(--greenbg); color: var(--green); }
ol.steps { display: flex; list-style: none; margin: 6px 4px 0; padding: 0; }
ol.steps li { flex: 1; height: 8px; position: relative; }
ol.steps li:first-child { flex: 0 0 8px; }
ol.steps li::before { content: ''; position: absolute; left: 0; right: 8px; top: 3.5px; height: 1px; background: var(--line); }
ol.steps li:first-child::before { display: none; }
ol.steps li::after { content: ''; position: absolute; right: 0; top: 0; width: 8px; height: 8px; border-radius: 50%; background: var(--line); }
ol.steps li.done::before, ol.steps li.done::after, ol.steps li.now::before { background: var(--ink); }
ol.steps li.now::after { background: var(--primary); outline: 3px solid var(--soft); }
.istep { margin: 0; font-size: 12.5px; color: var(--muted); }
.iside a.button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none; font-size: 13.5px; }
.iside a.button.dark { background: var(--ink); border-color: var(--ink); color: var(--card); }
.iside .ibtns { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; }
.iside details > summary { cursor: pointer; min-height: 40px; display: flex; align-items: center; font-size: 13px; color: var(--primary); font-weight: 600; }
.talk { display: grid; gap: 4px; margin-top: 2px; }
.said { max-width: 94%; margin: 0; padding: 8px 12px; border-radius: 12px; font-size: 13px; line-height: 1.4; white-space: pre-line; overflow-wrap: anywhere; }
.said.you { justify-self: end; background: var(--ink); color: var(--card); border-end-end-radius: 4px; }
.said.claude { justify-self: start; background: var(--soft); color: var(--ink); border-end-start-radius: 4px; }
.talk small { font-size: 11.5px; color: var(--muted); margin-bottom: 4px; } .talk small.you { justify-self: end; }
.tell { display: grid; gap: 6px; } .tell textarea { min-height: 72px; background: var(--card); font-size: 13.5px; }
.tell small { font-size: 11.5px; color: var(--muted); } .tell button { justify-self: start; min-height: 40px; }
@container (max-width: 760px) {
  .icard, .icard.pics { grid-template-columns: minmax(0, 1fr); }
  dl.kv { grid-template-columns: minmax(0, 1fr); gap: 2px; } dl.kv dd { margin-bottom: 8px; }
}
`;

/** Pure: apps/admin/test/issues.test.ts runs these with new Function. */
export const ISSUE_LOGIC = String.raw`
/** Where the watch found a user issue, from the family of its first key (scripts/user-issues.mjs FAMILIES). */
const ISSUE_SOURCES = { job: 'Server jobs', worker: 'Workers and traffic', feedback: 'A person sent it', ops: 'A line on this dashboard' };
const PHONE_FAMILIES = ['error', 'sync', 'transfer', 'auth', 'expected', 'audio', 'fill', 'device'];
function issueSource(keys) {
  const family = String((keys || [])[0] || '').split(':')[0];
  return ISSUE_SOURCES[family] || (PHONE_FAMILIES.includes(family) ? 'Phones and browsers' : '');
}

/**
 * A user issue's steps, each with the words for an issue that waits at it.
 * Linear's state Live is what the pipeline sets after the deploy (scripts/linear-sync.mjs).
 */
const ISSUE_STEPS = [['Found', ''], ['In Linear', 'not in Linear yet'], ['Fix written', 'no fix yet'], ['Merged', 'the fix waits on its merge'], ['Live', 'the fix is not live yet']];
/**
 * Where one user issue is: its tab, the words for who acts next, its step
 * ('at' is the step it waits at, counted from 1; one more than the last step
 * when all are done; 0 when the steps do not apply) and its pull request.
 * prs are the pull requests that name a Linear issue (sources/fixes.ts: open
 * ones and those merged in the last 14 days), or null before they are read:
 * then an open issue says only that it is open.
 */
function issueWay(r, prs, notes) {
  const naming = r.issue ? (prs || []).filter((p) => (p.issues || []).includes(r.issue)) : [];
  const open = naming.find((p) => p.state === 'open') || null;
  const merged = naming.filter((p) => p.state === 'merged' && p.mergedAt).sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt))[0] ||
    (r.fixedBy ? { number: r.fixedBy, url: '', mergedAt: r.fixedAt || null } : null);
  if (!r.issue) return { tab: 'closed', pill: 'Already fixed', level: 'done', at: 0, pr: merged };
  if (r.closedAt) {
    const dropped = /^(cancell?ed|duplicate)$/i.test(String(r.state || ''));
    return { tab: 'closed', pill: dropped ? r.state : 'Closed', level: dropped ? '' : 'done', at: dropped ? 0 : ISSUE_STEPS.length + 1, pr: merged };
  }
  // An instruction Claude has not answered: Claude acts next, in the tab the issue is in.
  const asked = (notes || []).some((n) => n.state === 'waiting' || n.state === 'working');
  const next = (way) => (asked ? { ...way, pill: 'Claude acts next', level: 'claude' } : way);
  if (open) return next({ tab: 'you', pill: 'Waits on you', level: 'you', at: 4, pr: open });
  if (merged) return next({ tab: 'merged', pill: 'Merged', level: 'claude', at: 5, pr: merged });
  if (!prs) return next({ tab: 'open', pill: 'Open', level: '', at: 3, pr: null });
  return next({ tab: 'nofix', pill: 'No fix yet', level: '', at: 3, pr: null });
}

/** What the card says under an admin's instruction on a user issue, by the note's state, when Claude wrote no words. */
const NOTE_STATE = {
  waiting: 'Claude reads it at the next run of the watch (each 15 minutes).',
  working: 'Claude works on it now.',
  stopped: 'Claude did not answer. The run stopped. Send the instruction again.',
  changed: 'Claude changed the draft fix.', answered: 'Claude changed nothing.', none: 'Claude wrote no answer.'
};
/** One instruction on a user issue as the talk shows it: Claude's words, or the state's. */
function noteSaid(n) {
  return n.state === 'answered' ? n.answer || NOTE_STATE[n.result] || NOTE_STATE.none : NOTE_STATE[n.state] || NOTE_STATE.waiting;
}

/** The tabs of the User issues page, in order; Open shows only while the pull requests are not read. */
const ISSUE_TABS = [['you', 'Waits on you'], ['nofix', 'No fix yet'], ['open', 'Open'], ['merged', 'Merged'], ['closed', 'Closed'], ['all', 'All']];
/** How many issues each tab holds, and the tab to open: the one chosen while it holds an issue, else the first that does. */
function issueTabs(ways, chosen) {
  const count = {};
  for (const t of ISSUE_TABS) count[t[0]] = t[0] === 'all' ? ways.length : ways.filter((w) => w.tab === t[0]).length;
  const tab = chosen && count[chosen] ? chosen : (ISSUE_TABS.find((t) => count[t[0]]) || ['all'])[0];
  return { count, tab };
}

/** The steps of a question about a tutorial video (sources/videos.ts AdminItem), as ISSUE_STEPS. */
const VIDEO_STEPS = [['Found', ''], ['Claude looks', 'waits on Claude\'s look'], ['You answer', 'waits on your answer'], ['Claude changes the video', 'Claude makes the change'], ['Merged', 'the change waits on its merge']];
/**
 * The step a video's card waits at ('at', as issueWay): Claude's look before
 * a person is asked, the person's answer, then the change Claude makes from
 * that answer and its merge. 0 for a card with nothing to tell Claude (Publish,
 * a channel to connect, a reply to post).
 */
function videoWay(a) {
  if (!a.instruct && !a.suggestion) return { at: 0 };
  const ins = a.instructed, fix = ins && ins.fix;
  if (fix) return { at: fix.state === 'merged' || fix.state === 'unneeded' ? VIDEO_STEPS.length + 1 : fix.state === 'open' ? 5 : fix.state === 'working' ? 4 : 3 };
  if (ins) return { at: 4 };
  return { at: a.who === 'you' ? 3 : 2 };
}
`;

/** Drawing the cards; uses the page's helpers (esc, when, num, safeLink, prLink, pictureStrip, detailParts) and its state (fixData, VIDEOS). */
export const ISSUE_SCRIPT = String.raw`
/** The steps as dots: done, the one it waits at, and those to come; then that in words. Each step is [name, the words while it waits there]. */
function stepsHtml(steps, at) {
  if (!at) return '';
  const n = steps.length;
  const says = at > n ? 'All ' + n + ' steps done' : 'Step ' + at + ' of ' + n + ': ' + steps[at - 1][1];
  return '<ol class="steps" role="img" aria-label="' + esc(says) + '">' +
    steps.map((step, i) => '<li' + (i + 1 < at ? ' class="done"' : i + 1 === at ? ' class="now"' : '') + ' title="' + esc(step[0]) + '"></li>').join('') + '</ol>' +
    '<p class="istep">' + esc(says) + '</p>';
}

/**
 * One card. c.tags and c.pics are HTML; c.lines are [label, HTML] and a line
 * without words is left out; c.pill is [words, level]; c.steps is [steps, at];
 * c.side is the HTML under the steps; c.tab hides the card on another tab.
 */
function issueCard(c) {
  const lines = (c.lines || []).filter((l) => l[1]);
  return '<article class="icard' + (c.pics ? ' pics' : '') + (c.cls ? ' ' + esc(c.cls) : '') + '"' + (c.tab ? ' data-tab="' + esc(c.tab) + '"' + (c.hidden ? ' hidden' : '') : '') + '>' +
    (c.pics ? '<div class="ipics">' + c.pics + '</div>' : '') +
    '<div class="ibody">' + (c.tags ? '<p class="itags">' + c.tags + '</p>' : '') + '<h4>' + esc(c.title) + '</h4>' + (c.meta ? '<p class="imeta">' + c.meta + '</p>' : '') +
    (lines.length ? '<dl class="kv">' + lines.map((l) => '<dt>' + esc(l[0]) + '</dt><dd>' + l[1] + '</dd>').join('') + '</dl>' : '') + '</div>' +
    '<div class="iside">' + (c.pill ? '<span class="ipill ' + esc(c.pill[1] || '') + '">' + esc(c.pill[0]) + '</span>' : '') +
    (c.steps ? stepsHtml(c.steps[0], c.steps[1]) : '') + (c.side || '') + '</div></article>';
}
const outLink = (href, words, cls) => '<a' + (cls ? ' class="' + cls + '"' : '') + ' href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + words + '</a>';

// ---- the User issues page: tabs with counts, one card for each issue ----
let issueTab = null;
function userIssueCard(r, way, tab, notes) {
  const source = issueSource(r.keys);
  const pr = way.pr;
  const solution = {
    you: () => prLink(pr) + ' waits on its merge.' + (pr && pr.title ? '<br><small class="muted">' + esc(pr.title) + '</small>' : ''),
    merged: () => 'Fixed in ' + prLink(pr) + (pr && pr.mergedAt ? ', merged ' + when(pr.mergedAt) : '') + '. Linear says ' + esc(r.state || 'open') + '.',
    nofix: () => 'No pull request names ' + esc(r.issue) + '. <small class="muted">The page reads open ones, and ones merged in the last 14 days.</small>',
    open: () => fixData && fixData.state === 'error' ? '<span class="bad">Could not read the pull requests: ' + esc(fixData.error) + '</span>' : '<span class="muted">Reading the pull requests…</span>',
    closed: () => !r.issue ? (pr && pr.number ? prLink(pr) + ' fixed it before the watch saw it' + (r.fixedAt ? ', ' + when(r.fixedAt) : '') + '.' : 'A change on main fixed it before the watch saw it.')
      : (pr && pr.number ? 'Fixed in ' + prLink(pr) + '. ' : 'No pull request named. ') + 'Closed ' + when(r.closedAt) + '.'
  }[way.tab]();
  const keys = (r.keys || []).slice(0, 3).map((k) => '<code>' + esc(k) + '</code>').join('<br>') + ((r.keys || []).length > 3 ? '<br><small class="muted">and ' + num(r.keys.length - 3) + ' more</small>' : '');
  // Claude's words for the issue, where the watch kept them; under each, what the records say.
  const said = (words, facts) => words ? '<p>' + esc(words) + '</p>' + (facts ? '<small class="muted">' + facts + '</small>' : '') : facts;
  const seen = [r.people ? num(r.people) + (Number(r.people) === 1 ? ' person' : ' people') : '', 'First seen ' + when(r.firstAt)].filter(Boolean).join(' · ');
  return issueCard({
    tab: way.tab, hidden: tab !== 'all' && tab !== way.tab,
    tags: (r.issue ? (safeLink(r.issueUrl) ? outLink(r.issueUrl, esc(r.issue), 'lin') : '<b>' + esc(r.issue) + '</b>') : '') + (source ? '<span class="tag">' + esc(source) + '</span>' : '') +
      (r.issue && r.state ? '<span>' + esc(r.state) + ' in Linear</span>' : ''),
    title: r.title || (r.keys || [])[0] || 'A problem with no name',
    lines: [
      ['Context', said(r.context, seen)],
      ['Issue', said(r.problem, keys)],
      ['Solution', said(r.solution, solution)]
    ],
    pill: [way.pill, way.level], steps: [ISSUE_STEPS, way.at],
    side: (way.tab === 'you' && pr && pr.number ? outLink(safeLink(pr.url) || PR_URL + pr.number, 'Review pull request ' + esc(pr.number), 'button dark') : '') +
      (r.issue && safeLink(r.issueUrl) ? outLink(r.issueUrl, 'Open ' + esc(r.issue) + ' in Linear', 'button') : '') +
      issueTalk(r, notes)
  });
}
/**
 * The talk on a user issue's card: each instruction an admin sent with Claude's answer under it, then,
 * while the issue is open, the box to send one. Nothing before the database keeps instructions.
 */
function issueTalk(r, notes) {
  if (!r.issue || !notes) return '';
  const list = notes[r.issue] || [];
  const talk = list.map((n) => {
    const where = n.pr ? ' · ' + outLink(PR_URL + n.pr, 'PR ' + esc(n.pr)) : n.state !== 'answered' && n.state !== 'waiting' && safeLink(n.runUrl) ? ' · ' + outLink(n.runUrl, 'The run') : '';
    return '<p class="said you">' + esc(n.text) + '</p><small class="you">You · ' + when(n.at) + '</small>' +
      '<p class="said claude">' + esc(noteSaid(n)) + '</p><small>Claude' + (n.answeredAt ? ' · ' + when(n.answeredAt) : '') + where + '</small>';
  }).join('');
  const id = esc(r.issue);
  return (talk ? '<div class="talk">' + talk + '</div>' : '') +
    (r.closedAt ? '' : '<div class="tell"><textarea id="uin-' + id + '" maxlength="2000" rows="3" aria-label="What Claude must do" placeholder="' + (list.length ? 'Send another instruction…' : 'Tell Claude what to do…') + '"></textarea>' +
      '<small>Claude starts at the next run of the watch (each 15 minutes).</small><button type="button" class="primary" data-uinote="' + id + '">Send to Claude</button></div>');
}
function userIssuesHtml(d) {
  const prs = fixData && fixData.state === 'ok' && fixData.data ? fixData.data.prs : null;
  const rows = (d.issues || []).map((r) => ({ r, way: issueWay(r, prs, r.issue && d.notes ? d.notes[r.issue] : null) }));
  const t = issueTabs(rows.map((x) => x.way), issueTab);
  const stats = '<div class="stats">' + stat(num(d.open), 'open in Linear', d.open ? 'warn' : '', NOW) + stat(num(d.closed), 'closed in Linear', '', '90 days') +
    stat(num(d.fixed), 'already fixed when seen', '', '90 days') + stat(num(d.noiseWeek), 'judged noise', '', LAST_WEEK) +
    stat(d.last ? when(d.last.at) : 'never', 'last look', d.last && d.last.outcome !== 'ok' ? 'bad' : '', d.last ? d.last.outcome : '') + '</div>';
  if (!rows.length) return stats + '<p class="muted">No issues in the last 90 days.</p>';
  return stats + '<div class="issues"><div class="itabs" role="group" aria-label="Issues by state">' +
    ISSUE_TABS.filter((x) => x[0] !== 'open' || t.count.open).map((x) =>
      '<button type="button" data-itab="' + x[0] + '" aria-pressed="' + (x[0] === t.tab) + '">' + esc(x[1]) + '<span class="count">' + num(t.count[x[0]]) + '</span></button>').join('') + '</div>' +
    '<div class="icards">' + rows.map((x) => userIssueCard(x.r, x.way, t.tab, d.notes)).join('') + '</div></div>';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-itab]');
  const box = b && b.closest('.issues');
  if (!box) return;
  issueTab = b.dataset.itab;
  for (const x of box.querySelectorAll('[data-itab]')) x.setAttribute('aria-pressed', String(x === b));
  for (const c of box.querySelectorAll('.icard[data-tab]')) c.hidden = issueTab !== 'all' && c.dataset.tab !== issueTab;
});
// "Tell Claude what to do" on a user issue: an instruction for the watch's next run.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-uinote]');
  if (!b) return;
  const text = ((document.getElementById('uin-' + b.dataset.uinote) || {}).value || '').trim();
  if (!text) { say('Write what Claude must do first.', 'red'); return; }
  perform({ kind: 'user-issue-note', issue: b.dataset.uinote, text: text.slice(0, 2000) }, b);
});

// ---- a question about a tutorial video (sources/videos.ts AdminItem), in the same card ----
const ADMIN_KIND = { approve: 'Suggestion', fixFailed: 'Change failed', held: 'Film held', fails: 'Film fails', reply: 'Reply to post', comment: 'New comment', screen: 'Screen changed', publish: 'Publish', connect: 'Channel', paused: 'Paused' };
/** Where each kind of card comes from. */
const ADMIN_FROM = { approve: 'Claude\'s look at 10:00 UTC', fixFailed: 'Claude\'s fix run', held: 'The frame check on the new film', fails: 'The nightly filming', reply: 'A comment on YouTube', comment: 'A comment on YouTube', screen: 'A change merged into main' };
const inputSaid = (i) => '<li><small>' + esc(i.kind === 'comment' ? 'Comment' : i.kind === 'code' ? 'Code change' : 'Note') + ' · ' + when(i.at) + '</small><br>' + esc(i.english || i.text) + '</li>';
/** The admin's words, then where Claude is with them: the state of its change, its note, and its pull request or run. */
function talkHtml(ins) {
  if (!ins) return '';
  const fix = ins.fix;
  const answer = fix ? FIX_STATE[fix.state] || fix.state
    : ins.looked ? 'Claude starts the change at its next fix run (:20 and :50 each hour), as a pull request that merges itself when its checks pass.' : 'Claude reads it at its next run.';
  const where = fix && fix.pr ? ' · ' + outLink(PR_URL + fix.pr, 'PR ' + esc(fix.pr)) : fix && safeLink(fix.run) ? ' · ' + outLink(fix.run, 'The run') : '';
  return '<div class="talk"><p class="said you">' + esc(ins.text) + '</p><small class="you">You · ' + when(ins.at) + '</small>' +
    '<p class="said claude">' + esc(answer) + (fix && fix.note ? '\n' + esc(fix.note) : '') + '</p><small>Claude' + (fix && fix.at ? ' · ' + when(fix.at) : '') + where + '</small></div>';
}
function suggestionSide(s) {
  return '<p class="ibtns"><button type="button" class="primary" data-sg="' + esc(s.id) + '" data-decision="accept" data-kind="' + esc(s.kind) + '">Accept</button>' +
    '<button type="button" data-sg="' + esc(s.id) + '" data-decision="reject">Reject</button></p>' +
    '<details><summary>Edit</summary><label for="sg-' + esc(s.id) + '">What to change</label><textarea id="sg-' + esc(s.id) + '" maxlength="4000" rows="6">' + esc(s.detail) + '</textarea>' +
    '<p><button type="button" data-sg="' + esc(s.id) + '" data-decision="edit">Save</button></p></details>';
}
/** A comment as its writer's words, in English, with the words as written folded under it and the way to it on YouTube. */
function commentSaid(a) {
  const r = a.reply;
  return '<p class="vsaidby">' + vicon('comment') + 'A viewer wrote' + (a.at ? ', ' + when(a.at) : '') + ' · <a href="' + esc(r.link) + '" target="_blank" rel="noopener noreferrer">See it on YouTube</a></p>' +
    '<blockquote class="vsaid">' + esc(r.comment) + (r.original ? '<details><summary>As written</summary>' + esc(r.original) + '</details>' : '') + '</blockquote>';
}
/**
 * The reply Claude suggests, for the admin to change, and the two steps: copy it and open the comment on YouTube (the
 * admin posts it there: nothing is posted from this page), then say what became of it. The card leaves when they do.
 */
function replyBox(a) {
  const r = a.reply, id = esc(r.id);
  return '<div class="vreply"><label for="rp-' + id + '">Your reply</label><textarea id="rp-' + id + '" maxlength="2000" rows="4">' + esc(r.text) + '</textarea>' +
    (r.english ? '<small>In English: ' + esc(r.english) + '</small>' : '') +
    '<div class="vsteps"><button type="button" class="primary" data-reply-copy="' + id + '" data-href="' + esc(r.link) + '"><span class="n">1</span>Copy the reply and open YouTube</button>' +
    '<div class="pair"><button type="button" data-reply-done="' + id + '" data-done="posted"><span class="n">2</span>Done</button>' +
    '<button type="button" data-reply-done="' + id + '" data-done="none">No reply needed</button></div></div></div>';
}
/** For a change Claude could not make: the same change again, as an instruction that names it in full. */
function retryButton(a) {
  return a.retry && a.instruct && !a.instructed ? '<button type="button" class="vretry primary" data-retry="' + esc(cardId(a)) + '">' + vicon('now') + 'Try again</button>' : '';
}
/** One thing for an admin: what it is and where it came from, who acts next, the talk so far, and where it applies, the box to tell Claude what to do. */
function adminCard(a) {
  const ins = a.instructed, id = esc(cardId(a));
  const [plain, technical] = detailParts(a.detail);
  const inputs = a.suggestion && a.suggestion.inputs.length ? '<ul>' + a.suggestion.inputs.map(inputSaid).join('') + '</ul>' : '';
  const from = ADMIN_FROM[a.kind] ? esc(ADMIN_FROM[a.kind]) + (a.at ? ' · ' + when(a.at) : '') : '';
  const retry = retryButton(a);
  const tell = a.instruct ? '<div class="tell"><textarea id="ins-' + id + '" maxlength="2000" rows="3" aria-label="What Claude must do" placeholder="' + (ins ? 'Send another instruction…' : 'Tell Claude what to do…') + '"></textarea>' +
    '<small>Claude starts at its next fix run (:20 and :50 each hour).</small><button type="button"' + (retry ? '' : ' class="primary"') + ' data-instruct="' + id + '">Send to Claude</button></div>' : '';
  return issueCard({
    pics: pictureStrip(a.pictures),
    tags: '<span class="tag ' + (ADMIN_LEVEL[a.kind] === 'bad' ? 'bad' : '') + '">' + esc(ADMIN_KIND[a.kind] || a.kind) + '</span>' +
      (a.tutorial && a.language ? '<span>' + esc(languageName(a.language)) + '</span>' : '') + (a.suggestion ? '<span>' + esc(SUGGESTION_KINDS[a.suggestion.kind] || a.suggestion.kind) + '</span>' : ''),
    title: a.title,
    cls: a.reply ? 'reply' : '',
    // A reply to post: the viewer's comment, then the reply and its two steps at the right.
    lines: a.reply ? [['Comment', commentSaid(a)]] : [
      ['Context', from + inputs],
      ['Issue', (plain ? '<p class="setup">' + esc(plain) + '</p>' : '') + (technical ? '<details class="vtech"><summary>Technical details for the fix</summary><p class="setup">' + esc(technical) + '</p></details>' : '')],
      [ins ? '' : 'Solution', ins ? '' : esc(a.next)]
    ],
    pill: a.who === 'you' ? ['Waits on you', 'you'] : ['Claude acts next', 'claude'],
    steps: [VIDEO_STEPS, videoWay(a).at],
    side: a.reply ? replyBox(a) : (a.suggestion ? suggestionSide(a.suggestion) : '') + talkHtml(ins) + (a.link ? cardLink(a).replace('<a ', '<a class="button" ') : '') +
      // A change Claude could not make: Try again is the main button, and the box is behind "instead".
      retry + (retry && tell ? '<details><summary>Tell Claude what to do instead</summary>' + tell + '</details>' : tell)
  });
}
`;
