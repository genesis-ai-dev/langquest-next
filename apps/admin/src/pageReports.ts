/**
 * The User reports page (docs/decisions/2026-11-24-user-reports-have-their-own-page-and-go-first.md):
 * each report a person sent from help mode in the app in the last 90 days, a
 * problem or an idea, as a card in the User issues page's format (pageIssues.ts
 * issueCard): what the person said and from which screen, and its Linear
 * issue, with what goes wrong, what Claude found and what happens next. The
 * open problems lead, the most important first, as the fix team takes them.
 * Linear keeps each issue's state: the page only reads it. The box to tell
 * Claude what to do stays on the issue's card on User issues, so each issue
 * has one talk. Plain JavaScript inside page.ts's script, like pageIssues.ts;
 * everything shown is escaped.
 */

/** The page's look, inside page.ts's style element. */
export const REPORT_CSS = String.raw`
.rplead { margin: 0 0 14px; padding: 14px 18px; border-radius: 14px; background: var(--amberbg); color: var(--ink); font-size: 15px; line-height: 1.45; }
.rplead.calm { background: var(--greenbg); }
.rplead b { font-weight: 650; }
.rpsaid { margin: 0; padding: 10px 12px; border-radius: 12px; border-end-start-radius: 4px; background: var(--soft); font-size: 14.5px; line-height: 1.45; white-space: pre-line; overflow-wrap: anywhere; }
.rpshots { margin: 6px 0 0; display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 13px; }
.rpshots p { margin: 0; }
.rpnote { margin: 12px 0 0; font-size: 13px; color: var(--muted); }
`;

/** Pure: apps/admin/test/reports.test.ts runs these with new Function. */
export const REPORT_LOGIC = String.raw`
/** The tabs of the User reports page, in order. */
const REPORT_TABS = [['open', 'Open'], ['waiting', 'Not in Linear yet'], ['idea', 'Ideas'], ['closed', 'Fixed or closed'], ['noise', 'Not a problem'], ['all', 'All']];
/** Linear's priority names (scripts/user-issues.mjs PRIORITY_NAMES); 0 is none. */
const REPORT_PRIORITY = ['', 'Urgent', 'High', 'Medium', 'Low'];
/**
 * The tab of one report (sources/ops.ts UserReport). An idea never goes to Linear. A problem is open while
 * its Linear issue is open, closed once Linear closed it or the watch found it already fixed, not a problem
 * when the watch judged it noise, and not in Linear yet before the watch looked at it.
 */
function reportTab(r) {
  if (r.kind === 'idea') return 'idea';
  if (r.issue) return r.closedAt ? 'closed' : 'open';
  if (r.verdict === 'fixed') return 'closed';
  if (r.verdict === 'noise') return 'noise';
  return 'waiting';
}
/** How the fix team ranks an issue by Linear's priority: Urgent 1, High 2, Medium or none 3, Low 4 (ops_user_issue_order). */
const reportLevel = (r) => ({ 1: 1, 2: 2, 4: 4 })[Number(r.priority)] || 3;
/**
 * The reports in the page's order: the open problems first, the most important first and then the one that
 * waits longest, as the fix team takes them; then those the watch did not look at yet, the oldest first;
 * then the rest, the newest first.
 */
function reportOrder(reports) {
  const rank = { open: 0, waiting: 1 };
  return (reports || []).slice().sort((a, b) => {
    const ta = reportTab(a), tb = reportTab(b);
    const ra = ta in rank ? rank[ta] : 2, rb = tb in rank ? rank[tb] : 2;
    if (ra !== rb) return ra - rb;
    if (ra === 0 && reportLevel(a) !== reportLevel(b)) return reportLevel(a) - reportLevel(b);
    return ra < 2 ? Date.parse(a.at) - Date.parse(b.at) : Date.parse(b.at) - Date.parse(a.at);
  });
}
/** How many reports each tab holds, and the tab to open: the one chosen while it holds a report, else the first that does. */
function reportTabs(reports, chosen) {
  const count = { all: (reports || []).length };
  for (const t of REPORT_TABS) if (t[0] !== 'all') count[t[0]] = (reports || []).filter((r) => reportTab(r) === t[0]).length;
  const tab = chosen && count[chosen] ? chosen : (REPORT_TABS.find((t) => count[t[0]]) || ['all'])[0];
  return { count, tab };
}
/** A report's title: its Linear issue's, else the first line of what the person said, cut at a word. */
function reportTitle(r) {
  if (r.title) return String(r.title).replace(/^User issue: /, '');
  const first = String(r.says || '').trim().split(/\n/)[0];
  if (!first) return r.voiceMs ? 'A voice note' : 'A report with no words';
  return first.length <= 90 ? first : first.slice(0, 90).replace(/\s+\S*$/, '') + '…';
}
/** The open problems a person sent: the number on the menu line and the page's first line. */
function reportsOpen(reports) {
  return (reports || []).filter((r) => reportTab(r) === 'open' || reportTab(r) === 'waiting').length;
}
`;

/** The page, inside page.ts's script after pageIssues.ts. */
export const REPORT_SCRIPT = String.raw`
let reportTabChosen = null;
/** A report's card: what the person said, then its Linear issue's Wrong, Known and Next, as a user issue's card. */
function reportCard(r, tab, ud, prs) {
  const at = reportTab(r);
  const row = r.issue && ud ? (ud.issues || []).find((x) => x.issue === r.issue) || null : null;
  const way = row && at === 'open' ? issueWay(row, prs, ud.notes ? ud.notes[r.issue] : null, ud.fixes ? ud.fixes[r.issue] : null) : null;
  const closed = /^(cancell?ed|duplicate)$/i.test(String(r.state || '')) ? r.state : r.fixedBy || /^live$/i.test(String(r.state || '')) ? 'Fixed' : 'Closed';
  const pill = {
    open: way ? [way.pill, way.level] : ['Open', 'you'],
    waiting: ['The watch looks next', 'claude'],
    idea: ['Idea', ''],
    closed: [closed, closed === 'Fixed' || closed === 'Closed' ? 'done' : ''],
    noise: ['Not a problem', '']
  }[at];
  const prio = REPORT_PRIORITY[Number(r.priority)] || '';
  const tags = (r.issue ? (safeLink(r.issueUrl) ? outLink(r.issueUrl, esc(r.issue), 'lin') : '<b>' + esc(r.issue) + '</b>') : '') +
    '<span class="tag">' + (r.kind === 'idea' ? 'Idea' : 'Problem') + '</span>' +
    (prio && at === 'open' ? '<span class="tag' + (Number(r.priority) <= 2 ? ' bad' : '') + '">' + esc(prio) + '</span>' : '') +
    (r.verdict === 'known' ? '<span class="tag">Added to an issue the team had</span>' : '');
  const shots = (r.screenshot ? '<p><button type="button" class="link" data-shot="' + esc(r.id) + '" data-what="screenshot">Show screenshot</button></p>' : '') +
    (r.picture ? '<p><button type="button" class="link" data-shot="' + esc(r.id) + '" data-what="picture">Show picture</button></p>' : '') +
    (r.voiceMs ? '<p>A voice note, ' + num(Math.max(1, Math.round(Number(r.voiceMs) / 1000))) + ' s: play it in <a href="#g/support">Support</a>.</p>' : '');
  const said = (r.says ? '<blockquote class="rpsaid">' + esc(r.says) + '</blockquote>' : '') + (shots ? '<div class="rpshots">' + shots + '</div>' : '');
  const fixedIn = r.fixedBy ? prLink({ number: r.fixedBy }) : '';
  // Next on an open issue says what its card on User issues says: the pull request, Claude's plan to prove the
  // cause, the choice Claude needs, or what Claude says fixes it (pageIssues.ts userIssueCard).
  const record = r.issue && ud && ud.fixes ? ud.fixes[r.issue] || null : null;
  const openNext = () => {
    if (way && way.pr && way.pr.number) return prLink(way.pr) + (way.tab === 'merged' ? ' merged. ' + esc(r.issue) + ' is ' + esc(r.state || 'open') + ' in Linear.' : way.claude ? ' merges without a person when its checks pass.' : ' waits on its merge.');
    if (fixFor(record, null) && record.decision === 'none') return planGoing(record) ? planLine(record.plan) : noFixSaid(record);
    return r.solution ? esc(r.solution) : way ? esc(stepWords(ISSUE_STEPS, way.at) || way.pill) + '.' : '';
  };
  const next = {
    open: openNext(),
    waiting: 'The watch for user issues looks at it at its next run, ' + watchSaid() + '. It files it in Linear or adds it to an issue the team has.',
    idea: 'Ideas do not go to Linear. Read it, and tell the team when you want it built.',
    closed: !r.issue ? (fixedIn ? fixedIn + ' fixed it before the watch looked.' : 'A change on main fixed it before the watch looked.')
      : (fixedIn ? 'Fixed in ' + fixedIn + '. ' : '') + esc(r.issue) + ' is ' + esc(r.state || 'closed') + ' in Linear' + (r.closedAt ? ', ' + when(r.closedAt) : '') + '.',
    noise: r.note ? esc(r.note) : 'The watch judged it not a problem.'
  }[at];
  return issueCard({
    card: 'report:' + r.id, tab: at, hidden: tab !== 'all' && at !== tab,
    tags, title: reportTitle(r),
    meta: ['Sent ' + when(r.at), r.screen ? 'from the screen ' + esc(r.screen) : '', r.os ? esc(r.os) : ''].filter(Boolean).join(' · '),
    pill,
    short: {
      lines: [
        ['Said', said],
        ['Wrong', r.problem && at !== 'noise' ? '<p>' + esc(r.problem) + '</p>' : ''],
        ['Known', r.known && at === 'open' ? '<p>' + esc(r.known) + '</p>' : ''],
        ['Next', next]
      ],
      bar: (r.issue && at === 'open' ? '<a class="button dark" href="' + esc(cardHref('userissues', r.issue)) + '">Tell Claude what to do</a>' : '') +
        (r.issue && safeLink(r.issueUrl) ? outLink(r.issueUrl, 'Open ' + esc(r.issue) + ' in Linear', 'button') : '')
    }
  });
}
function userReportsHtml(d) {
  const ud = userIssuesData();
  const prs = fixData && fixData.state === 'ok' && fixData.data ? fixData.data.prs : null;
  const reports = reportOrder(d.reports);
  const t = reportTabs(reports, reportTabChosen);
  const open = t.count.open, waiting = t.count.waiting;
  const lead = open || waiting
    ? '<p class="rplead"><b>' + (open ? countOf(open, 'problem that people sent is', 'problems that people sent are') + ' open in Linear.' : '') +
      (waiting ? ' ' + countOf(waiting, 'new report waits', 'new reports wait') + ' for the watch.' : '') + '</b> The fix team takes these before every other issue.</p>'
    : '<p class="rplead calm"><b>No problem that people sent is open.</b> The fix team takes a new one before every other issue.</p>';
  const stats = '<div class="stats">' + stat(num(open), 'open in Linear', open ? 'warn' : '', NOW) + stat(num(waiting), 'not in Linear yet', waiting ? 'warn' : '', NOW) +
    stat(num(t.count.closed), 'fixed or closed', '', '90 days') + stat(num(t.count.idea), 'ideas', '', '90 days') + stat(num(d.test || 0), 'from test accounts, not shown', '', '90 days') + '</div>';
  if (!reports.length) return lead + stats + '<p class="muted">Nobody sent a report in the last 90 days.</p>';
  return lead + stats + '<div class="rplist"><div class="itabs" role="group" aria-label="Reports by state">' +
    REPORT_TABS.filter((x) => x[0] === 'all' || x[0] === 'open' || t.count[x[0]]).map((x) =>
      '<button type="button" data-rptab="' + x[0] + '" aria-pressed="' + (x[0] === t.tab) + '">' + esc(x[1]) + '<span class="count">' + num(t.count[x[0]]) + '</span></button>').join('') + '</div>' +
    '<div class="icards">' + reports.map((r) => reportCard(r, t.tab, ud, prs)).join('') + '</div>' +
    '<p class="rpnote">Each problem is also a card on <a href="#g/userissues">User issues</a>, with the talk with Claude. Linear keeps each issue\'s state.</p></div>';
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-rptab]');
  const box = b && b.closest('.rplist');
  if (!box) return;
  reportTabChosen = b.dataset.rptab;
  for (const x of box.querySelectorAll('[data-rptab]')) x.setAttribute('aria-pressed', String(x === b));
  for (const c of box.querySelectorAll('.icard[data-tab]')) c.hidden = reportTabChosen !== 'all' && c.dataset.tab !== reportTabChosen;
});
`;
