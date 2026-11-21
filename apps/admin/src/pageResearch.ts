/**
 * The Research page (docs/research-team.md, docs/decisions/2026-11-21-a-research-team-looks-ahead.md):
 * the research team's report of the day you pick, the team as a map with each
 * agent's model, the week (which subject runs on which day), what each scout
 * looked at, and one card for each thing the team found, in tabs. Cards use
 * the User issues page's card (pageIssues.ts issueCard) and its box to tell
 * Claude what to do. A choice the team asks of a developer shows as buttons:
 * a tap sends that choice to Claude as an instruction. Plain JavaScript inside
 * page.ts's script, like pageIssues.ts; everything shown is escaped.
 */

/** The page's look, inside page.ts's style element. */
export const RESEARCH_CSS = String.raw`
.rhead { display: grid; gap: 10px; padding: 18px 20px; margin: 0 0 14px; background: var(--raised); border: 1px solid var(--line); border-radius: 14px; }
.rhead .rdays { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; }
.rhead .rdays button { min-height: 36px; padding: 0 12px; border-radius: 999px; font-size: 13px; }
.rhead .rdays button[aria-pressed="true"] { background: var(--ink); color: var(--card); border-color: var(--ink); }
.rhead h3 { margin: 0; font-size: 19px; line-height: 1.35; color: var(--ink); }
.rhead ul { margin: 0; padding-inline-start: 20px; display: grid; gap: 4px; font-size: 14px; line-height: 1.45; }
.rhead small { color: var(--muted); }
.rmap { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0 26px; padding: 16px; margin: 0 0 14px; background: var(--raised); border: 1px solid var(--line); border-radius: 14px; }
.rmap .col { display: grid; gap: 8px; align-content: center; position: relative; }
.rmap .col:not(:last-child)::after { content: "→"; position: absolute; right: -20px; top: 50%; transform: translateY(-50%); color: var(--muted); font-size: 18px; }
.rmap .col > span { font-size: 10.5px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); }
.rnode { display: grid; gap: 1px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); font-size: 13px; line-height: 1.3; }
.rnode b { font-weight: 600; } .rnode small { color: var(--muted); font-size: 12px; }
.rnode.you { border-color: var(--amber); background: var(--amberbg); } .rnode.found { border-color: var(--primary); }
.rnode.failed { border-color: var(--red); background: var(--redbg); }
.rweek { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; list-style: none; margin: 0 0 6px; padding: 0; }
.rweek li { display: grid; gap: 4px; align-content: start; padding: 8px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); font-size: 12.5px; line-height: 1.3; min-height: 64px; }
.rweek li b { font-size: 12px; } .rweek li.today { outline: 2px solid var(--primary); outline-offset: 1px; }
.rdaily { margin: 0 0 14px; font-size: 13px; color: var(--ink2); }
.rbeats { list-style: none; margin: 0 0 14px; padding: 0; display: grid; gap: 6px; }
.rbeats li { display: grid; grid-template-columns: 200px 90px minmax(0, 1fr); gap: 10px; align-items: baseline; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--raised); font-size: 13.5px; line-height: 1.4; }
.rbeats li small { color: var(--muted); }
.rsev { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; padding: 1px 8px; border-radius: 999px; background: var(--soft); color: var(--ink2); }
.rsev.critical, .rsev.high { background: var(--redbg); color: var(--red); } .rsev.medium { background: var(--amberbg); color: var(--amber); }
.rlinks { display: flex; flex-wrap: wrap; gap: 6px 12px; }
.rchoices { display: grid; gap: 6px; } .rchoices p { margin: 0; font-size: 13px; }
.rchoices button { justify-content: flex-start; text-align: start; min-height: 44px; white-space: normal; }
.rchoices button small { display: block; font-weight: 400; font-size: 12px; color: inherit; opacity: .8; }
.rtime { font-size: 13px; color: var(--ink2); margin: 14px 0 0; }
@media (max-width: 900px) {
  .rmap { grid-template-columns: minmax(0, 1fr); gap: 22px; }
  .rmap .col:not(:last-child)::after { content: "↓"; right: auto; left: 50%; top: auto; bottom: -21px; transform: translateX(-50%); }
  .rweek { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .rbeats li { grid-template-columns: minmax(0, 1fr); gap: 2px; }
}
`;

/** Pure: apps/admin/test/research.test.ts runs these with new Function. */
export const RESEARCH_LOGIC = String.raw`
/** The kinds of thing the team finds (scripts/research-team.mjs KINDS), in words. */
const RESEARCH_KINDS = { vulnerability: 'Security hole', upgrade: 'New version', replace: 'Better package', bug: 'Bug', risk: 'Risk', cost: 'Cost', deadline: 'Deadline', other: 'Other', twin: 'Same mistake' };
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const WEEK_DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
/** The tabs of the page's list, in order. */
const RESEARCH_TABS = [['you', 'Waits on you'], ['team', 'For the fix team'], ['fixed', 'Fixed'], ['watch', 'Watching'], ['reject', 'Rejected'], ['all', 'All']];

/**
 * Where one item is: its tab, its pill and whether it waits for a developer. fix is the agent team's record of
 * its Linear issue (sources/ops.ts UserIssueFix), when the fix team wrote one; notes are the instructions sent
 * from its card. An item asked of a developer that has an instruction goes to the fix team with it.
 */
function researchWay(item, fix, notes) {
  if (item.decision === 'reject') return { tab: 'reject', pill: ['Rejected', ''] };
  if (item.decision === 'watch') return { tab: 'watch', pill: ['Claude watches it', ''] };
  const told = (notes || []).some((n) => n.state === 'waiting' || n.state === 'working');
  if (told) return { tab: 'team', pill: ['Claude acts next', 'claude'] };
  if (fix && fix.decision === 'merge') return { tab: 'fixed', pill: ['Fixed by Claude', 'done'] };
  if (fix && fix.pr) return { tab: 'you', pill: ['Fix waits on you', 'you'] };
  if (item.action === 'ask') return { tab: 'you', pill: ['Your choice', 'you'] };
  return { tab: 'team', pill: [item.handedAt ? 'The fix team has it' : 'Waits on the fix team', ''] };
}
const onResearchTab = (way, tab) => tab === 'all' || way.tab === tab;
/** How many items each tab holds, and the tab to open: the one chosen while it holds an item, else the first that does. */
function researchTabs(ways, chosen) {
  const count = {};
  for (const t of RESEARCH_TABS) count[t[0]] = ways.filter((w) => onResearchTab(w, t[0])).length;
  const tab = chosen && count[chosen] ? chosen : (RESEARCH_TABS.find((t) => count[t[0]]) || ['all'])[0];
  return { count, tab };
}
/** Items in the order the page lists them: the worst first, then the newest. */
function researchOrder(items) {
  return (items || []).slice().sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5) || Date.parse(b.firstAt || 0) - Date.parse(a.firstAt || 0));
}
/**
 * The report of a day: the one you picked, else the newest. Of a day with more than one run (one started by hand),
 * the run with the most subjects.
 */
function researchReport(reports, day) {
  const list = reports || [];
  const of = (d) => list.filter((r) => r.day === d).sort((a, b) => (b.beats || []).length - (a.beats || []).length || Date.parse(b.at) - Date.parse(a.at))[0] || null;
  return (day && of(day)) || (list[0] ? of(list[0].day) : null);
}
/** The days that have a report, the newest first, at most 7. */
const researchDays = (reports) => [...new Set((reports || []).map((r) => r.day))].slice(0, 7);
/** What the team recommends, in words, the answer first: the upgrade, or Claude's own words. */
function researchSays(item) {
  if (item.decision === 'reject') return 'No change.';
  if (item.decision === 'watch') return 'Nothing now. The team looks again later.';
  if (item.package && item.to) return 'Upgrade ' + item.package + (item.from ? ' from ' + item.from : '') + ' to ' + item.to + '.';
  return '';
}
/** The instruction a choice button sends to Claude. */
const choiceText = (c) => 'I choose: ' + c.label + '.' + (c.then ? ' ' + c.then : '');
/** The beats of the week, for each day (daily ones are on every day, so the page lists them once, above). */
function weekOf(team) {
  return WEEK_DAYS.map(([d, name]) => ({ day: d, name, beats: (team || []).filter((b) => b.every === d || (d === 'sat' && String(b.every).startsWith('sat-'))) }));
}
`;

/** Drawing the page; uses the page's helpers (esc, when, num, stat, safeLink, issueCard, issueTalk, fixLine, placeLink, outLink, fixPictures). */
export const RESEARCH_SCRIPT = String.raw`
let researchTab = null, researchDay = null;
const modelWord = (m) => ({ opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' })[String(m || '').toLowerCase()] || esc(m || '');
const sevPill = (s) => s ? '<span class="rsev ' + esc(s) + '">' + esc(s) + '</span>' : '';
const linkOut = (u) => { let host = u; try { host = new URL(u).host.replace(/^www\./, ''); } catch {} return outLink(u, esc(host)); };
/** The day's headline and summary, with the day picker. */
function researchHead(reports, rep) {
  const days = researchDays(reports);
  if (!rep) return '<div class="rhead"><h3>No report yet.</h3><small>The research team writes one each day at 13:23 UTC.</small></div>';
  return '<div class="rhead">' + (days.length > 1 ? '<p class="rdays" role="group" aria-label="The report of a day">' + days.map((d) =>
      '<button type="button" data-rday="' + esc(d) + '" aria-pressed="' + (d === rep.day) + '">' + esc(new Date(d + 'T12:00:00Z').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })) + '</button>').join('') + '</p>' : '') +
    '<h3>' + esc(rep.headline) + '</h3>' + ((rep.summary || []).length ? '<ul>' + rep.summary.map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul>' : '') +
    '<small>' + [rep.lead === 'failed' ? 'The lead did not finish: these are the scouts\' own notes, not checked a second time' : '', 'Written ' + when(rep.at), safeLink(rep.runUrl) ? outLink(rep.runUrl, 'The run') : ''].filter(Boolean).join(' · ') + '</small></div>';
}
/** The team as a map: facts, the lead plans, the scouts side by side, the lead checks, then the report, the fix team and you. */
function researchMap(rep, team, waiting) {
  const beats = rep ? (rep.beats || []) : (team || []).filter((b) => b.every === 'day');
  const node = (label, sub, cls) => '<div class="rnode ' + (cls || '') + '"><b>' + esc(label) + '</b><small>' + sub + '</small></div>';
  const c = rep && rep.counts;
  const f = rep && rep.facts;
  const cols = [
    ['1 · Facts', [node('Facts, no AI', f ? num(f.packages) + ' packages · ' + num(f.advisories) + ' known holes · ' + num(f.outdated) + ' with a new version' : 'known holes, versions, dates')]],
    ['2 · Plan', [node('Lead · Opus', 'reads the facts, gives each scout its focus')]],
    ['3 · Scouts, side by side', beats.map((b) => node(b.title || b.id, modelWord(b.model) + (b.result ? ' · ' + esc(b.result === 'found' ? 'found something' : b.result === 'clear' ? 'nothing found' : b.result) : ''), b.result === 'failed' ? 'failed' : b.result === 'found' ? 'found' : ''))],
    ['4 · Check', [node('Lead · Opus', 'opens each claim, keeps only what it can show')]],
    ['5 · Then', [
      node('This report', c ? num(c.found) + ' found today' : 'each day'),
      node('Fix team', c ? num(c.toFix) + ' to fix and test' : 'fixes and tests'),
      node('Your choice', num(waiting) + ' wait now', waiting ? 'you' : '')
    ]]
  ];
  return '<div class="rmap" role="img" aria-label="How the research team works, from the facts to this report">' + cols.map(([t, nodes]) => '<div class="col"><span>' + esc(t) + '</span>' + nodes.join('') + '</div>').join('') + '</div>';
}
/** The week: the daily subjects once, then each day's own subject. Today has a ring. */
function researchWeek(team) {
  const today = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getUTCDay()];
  const daily = (team || []).filter((b) => b.every === 'day');
  return '<p class="rdaily"><b>Each day:</b> ' + esc(daily.map((b) => b.title).join(', ')) + '</p><ol class="rweek">' + weekOf(team).map((d) =>
    '<li class="' + (d.day === today ? 'today' : '') + '"><b>' + esc(d.name) + '</b>' + (d.beats.length ? d.beats.map((b) => '<span>' + esc(b.title) + (String(b.every).startsWith('sat-') ? ' <small class="muted">' + (b.every === 'sat-even' ? 'even weeks' : 'odd weeks') + '</small>' : '') + '</span>').join('') : '<span class="muted">Only the daily ones</span>') + '</li>').join('') + '</ol>';
}
/** What each scout of the day looked at, with its result. */
function researchBeats(rep) {
  if (!rep || !(rep.beats || []).length) return '';
  const word = { found: ['Found something', 'warn'], clear: ['Nothing found', 'good'], failed: ['Failed', 'bad'], skipped: ['Did not run', ''] };
  return '<h3 class="part">What each scout looked at</h3><ul class="rbeats">' + rep.beats.map((b) => {
    const w = word[b.result] || [b.result, ''];
    return '<li><b>' + esc(b.title || b.id) + '<br><small>' + modelWord(b.model) + '</small></b><span class="tag ' + w[1] + '">' + esc(w[0]) + '</span><span>' + esc(b.checked || '') + (b.note ? '<br><small>' + esc(b.note) + '</small>' : '') + '</span></li>';
  }).join('') + '</ul>';
}
/** A choice the team asks of a developer: why, then one button for each choice, the team's pick first. */
function choicesHtml(item, notes) {
  const ask = item.ask;
  if (!ask || !item.issue || (notes || []).length) return '';
  return '<div class="rchoices"><p><b>Why you choose:</b> ' + esc(ask.why) + '</p>' + ask.choices.map((c, n) =>
    '<button type="button"' + (n === 0 ? ' class="primary"' : '') + ' data-rchoice="' + esc(item.issue) + '" data-text="' + esc(choiceText(c)) + '">' + esc(c.label) + (n === 0 ? ' (the team\'s pick)' : '') + (c.then ? '<small>' + esc(c.then) + '</small>' : '') + '</button>').join('') + '</div>';
}
function researchCard(item, way, tab, d) {
  const fix = item.issue && d.fixes ? d.fixes[item.issue] || null : null;
  const notes = item.issue && d.notes ? d.notes[item.issue] || [] : [];
  const says = researchSays(item);
  const where = (item.places || []).map(placeLink).concat((item.links || []).map(linkOut));
  return issueCard({
    tab: way.tab, hidden: !onResearchTab(way, tab),
    card: 'research:' + item.tag, pics: fixPictures(fix, item.issue, !!fix, item.steps),
    tags: sevPill(item.severity) + '<span class="tag">' + esc(RESEARCH_KINDS[item.kind] || 'Same mistake') + '</span>' +
      (item.issue ? (safeLink(item.issueUrl) ? outLink(item.issueUrl, esc(item.issue), 'lin') : '<b>' + esc(item.issue) + '</b>') : '') +
      (item.like ? '<span>Like ' + esc(item.like) + '</span>' : ''),
    title: item.title,
    meta: [item.beatTitle ? esc(item.beatTitle) : '', 'First found ' + when(item.firstAt)].filter(Boolean).join(' · '),
    lines: [
      [item.decision === 'recommend' ? 'We recommend' : item.decision === 'reject' ? 'We rejected it' : 'We watch it', says ? '<p>' + esc(says) + '</p>' : ''],
      ['Why', '<p>' + esc(item.why) + '</p>'],
      ['Found', '<p>' + esc(item.found) + '</p>'],
      ['Deadline', item.deadline ? '<b>' + esc(item.deadline) + '</b>' : ''],
      ['Where', where.length ? '<div class="rlinks">' + where.join('') + '</div>' : ''],
      ['Claude', fixLine(fix, { tab: '' })]
    ],
    pill: way.pill,
    side: choicesHtml(item, notes) +
      (fix && fix.pr ? outLink(PR_URL + fix.pr, 'Open pull request ' + esc(fix.pr), 'button dark') : '') +
      (item.issue && safeLink(item.issueUrl) ? outLink(item.issueUrl, 'Open ' + esc(item.issue) + ' in Linear', 'button') : ''),
    talk: item.decision === 'recommend' && item.issue ? issueTalk({ issue: item.issue, closedAt: null }, d.notes, 'research') : ''
  });
}
function researchHtml(d) {
  const team = d.team || RESEARCH_TEAM;
  const titles = Object.fromEntries(team.map((b) => [b.id, b.title]));
  const items = researchOrder(d.items).map((i) => ({ ...i, beatTitle: titles[i.beat] || (i.like ? 'Same mistake in other places' : '') }));
  const rows = items.map((item) => ({ item, way: researchWay(item, item.issue && d.fixes ? d.fixes[item.issue] : null, item.issue && d.notes ? d.notes[item.issue] : null) }));
  const t = researchTabs(rows.map((x) => x.way), researchTab);
  const rep = researchReport(d.reports, researchDay);
  const waiting = t.count.you;
  const fixed30 = rows.filter((x) => x.way.tab === 'fixed' && Date.now() - Date.parse(x.item.at) < 30 * 864e5).length;
  const stats = '<div class="stats">' +
    stat(rep && rep.counts ? num(rep.counts.found) : '–', 'found', '', rep ? 'the day\'s report' : '') +
    stat(num(rows.filter((x) => x.item.decision === 'recommend').length), 'recommended', '', '90 days') +
    stat(num(waiting), 'wait on you', waiting ? 'warn' : '', NOW) +
    stat(num(fixed30), 'fixed by Claude', '', '30 days') +
    stat(num(t.count.reject), 'rejected', '', '90 days') + '</div>';
  return researchHead(d.reports, rep) + stats + researchMap(rep, team, waiting) +
    '<h3 class="part">The week</h3>' + researchWeek(team) + researchBeats(rep) +
    '<h3 class="part">What the team found</h3>' +
    (rows.length ? '<div class="rlist"><div class="itabs" role="group" aria-label="What the team found, by state">' +
      RESEARCH_TABS.map((x) => '<button type="button" data-rtab="' + x[0] + '" aria-pressed="' + (x[0] === t.tab) + '">' + esc(x[1]) + '<span class="count">' + num(t.count[x[0]]) + '</span></button>').join('') + '</div>' +
      '<div class="icards">' + rows.map((x) => researchCard(x.item, x.way, t.tab, d)).join('') + '</div></div>' : '<p class="muted">Nothing found yet.</p>') +
    (rep && rep.minutes ? '<p class="rtime">The team took ' + num(Math.round(rep.minutes)) + ' minutes' + (rep.turns ? ' and ' + num(rep.turns) + ' turns' : '') + '. It stops at 50 minutes. It uses the agent team\'s own Claude account.</p>' : '');
}
document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest && e.target.closest('[data-rtab]');
  const box = tabBtn && tabBtn.closest('.rlist');
  if (box) {
    researchTab = tabBtn.dataset.rtab;
    for (const x of box.querySelectorAll('[data-rtab]')) x.setAttribute('aria-pressed', String(x === tabBtn));
    for (const c of box.querySelectorAll('.icard[data-tab]')) c.hidden = !onResearchTab({ tab: c.dataset.tab }, researchTab);
    return;
  }
  const dayBtn = e.target.closest && e.target.closest('[data-rday]');
  if (dayBtn && results.research && results.research.state === 'ok') {
    researchDay = dayBtn.dataset.rday;
    show('research', results.research);
    return;
  }
  // A choice the team asked: sent to Claude as an instruction on the item's Linear issue, as the box does.
  const choice = e.target.closest && e.target.closest('[data-rchoice]');
  if (choice) perform({ kind: 'user-issue-note', issue: choice.dataset.rchoice, text: String(choice.dataset.text || '').slice(0, 2000) }, choice);
});
`;
