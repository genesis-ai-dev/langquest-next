/**
 * Each line of the ops dashboard as a card on its section's page, and the way
 * from the Overview to it (docs/decisions/2026-11-21-each-overview-line-opens-its-card.md).
 * A tap on an Overview row opens `#g/<section>/<card id>`: the section's page
 * scrolls to that card and rings it. A line's card is the User issues card
 * format (pageIssues.ts issueCard): Claude's words for the problem, the fix and
 * its state, its steps as dots, and the talk with Claude with the box to tell
 * Claude what to do. The talk is keyed by the line's Linear issue, so the same
 * talk shows on the line's card and on the issue's card on User issues. Each
 * word and dot comes from what a part answered. A line with no Linear issue
 * has the box to ask Claude about it instead (pageAsk.ts). Plain JavaScript inside page.ts's script, after
 * pageIssues.ts; everything shown is escaped.
 */

/** The look, inside page.ts's style element. */
export const CARD_CSS = String.raw`
[data-card] { scroll-margin-top: 24px; }
.lcards { margin: 6px 0 14px; }
.icard.line { border-inline-start-width: 4px; margin: 8px 0; }
.icard.line.urgent, .icard.line.problem { border-inline-start-color: var(--red); } .icard.line.watch { border-inline-start-color: var(--yellow); }
.icard.line .itags .tag.urgent, .icard.line .itags .tag.problem { color: var(--red); background: var(--redbg); }
.icard.line .itags .tag.watch { color: var(--amber); background: var(--amberbg); }
.icard .nobox { margin: 0; font-size: 12.5px; color: var(--muted); }
.icard .inext { margin: 0; font-weight: 600; color: var(--ink); }
.icard .eachissue { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; font-size: 13px; }
.icard .eachissue a { color: var(--primary); font-weight: 600; }
.icard.hit, .pc.hit { box-shadow: 0 0 0 3px var(--primary); animation: cardhit 2.6s ease-out 1; }
/* The card a link opened (a reply in the bell's list) keeps its ring for 10 minutes, through each redraw (remark). */
.icard.marked, .pc.marked, .vcards.marked { box-shadow: 0 0 0 3px var(--primary); }
.vcards.marked { border-radius: 14px; }
[data-card] { scroll-margin-top: 16px; }
@keyframes cardhit { 0%, 30% { box-shadow: 0 0 0 6px var(--primary); } 100% { box-shadow: 0 0 0 3px var(--primary); } }
@media (prefers-reduced-motion: reduce) { .icard.hit, .pc.hit { animation: none; } }
.alert[data-href] { cursor: pointer; transition: border-color .15s, box-shadow .15s, transform .15s; }
.alert[data-href]:hover { border-color: var(--grey); box-shadow: 0 4px 16px rgb(0 0 0 / .06); transform: translateY(-1px); }
@media (prefers-reduced-motion: reduce) { .alert[data-href]:hover { transform: none; } }
.alert .gos a.go.open { padding: 0 14px; min-height: 40px; border-radius: 999px; background: var(--soft); color: var(--primary); }
.alert[data-href]:hover .gos a.go.open { background: var(--primary); color: #fff; }
.alert .text > b a.card, .alert ul.also a.card { color: inherit; text-decoration: none; }
.alert .text > b a.card:hover, .alert .text > b a.card:focus-visible, .alert ul.also a.card:hover, .alert ul.also a.card:focus-visible { color: var(--primary); text-decoration: underline; }
`;

/** Pure: apps/admin/test/cards.test.ts runs these with new Function. */
export const CARD_LOGIC = String.raw`
/** The id of a line's card: the same on the Overview's row and on the card (as alertKinds.ts alertId). */
function lineCardId(a) { return 'line:' + (a.subject ? a.key + ':' + a.subject : a.key); }
/** The address that opens a card on its section's page. */
function cardHref(group, id) { return '#g/' + group + '/' + encodeURIComponent(id); }
/** A view's address: a section, and the card in it to open when there is one. */
function viewOf(hash, sections) {
  const h = String(hash || '').replace(/^#/, '');
  if (h === 'all') return { name: 'all' };
  const g = /^g\/([a-z0-9_]+)(?:\/(.+))?$/.exec(h);
  if (g && sections.some((s) => s.id === g[1])) {
    let card = null;
    if (g[2]) { try { card = decodeURIComponent(g[2]); } catch { card = null; } }
    return card ? { name: 'group', id: g[1], card } : { name: 'group', id: g[1] };
  }
  return { name: 'start' };
}

/** A line's steps, as ISSUE_STEPS: the last is the line going from the page when its check runs after the merge. */
const LINE_STEPS = [['Found', ''], ['In Linear', 'the watch files it in Linear (each 15 minutes)'], ['Fix written', 'no fix yet'], ['Merged', 'the fix waits on its merge'], ['Gone', 'the line goes when its check runs']];
/**
 * Where a line is (f from pageFixes.ts lineFix): the pill [words, level], the
 * step it waits at (0 when the steps do not apply) and the steps' words.
 * byClaude: its open or merged fix merges without a person. asked: an
 * instruction to Claude waits for an answer, so Claude acts next.
 */
function lineWay(f, byClaude, asked) {
  const steps = LINE_STEPS;
  const way = {
    none: { pill: ['Not in Linear yet', ''], at: 2 },
    issue: { pill: ['No fix yet', ''], at: 3 },
    part: { pill: [f.fixed + ' of ' + ((f.each && f.each.length) || 0) + ' issues have a fix', ''], at: 3 },
    open: byClaude ? { pill: ['Merges when checks pass', 'claude'], at: 4 } : { pill: ['Waits on you', 'you'], at: 4 },
    merged: { pill: ['Fix merged', 'claude'], at: 5 },
    stuck: { pill: ['Still here after its fix', 'you'], at: 5, steps: steps.slice(0, 4).concat([['Gone', 'still here after its check']]) },
    noise: { pill: ['Claude found nothing to fix', ''], at: 0 },
    person: { pill: ['Waits on you', 'you'], at: 0 }
  }[f.state] || { pill: ['', ''], at: 0 };
  const out = { pill: way.pill, at: way.at, steps: way.steps || steps };
  return asked && f.issues && f.issues.length === 1 ? { ...out, pill: ['Claude acts next', 'claude'] } : out;
}

/**
 * What happens next on a line's card, in words: who acts, and what; '' when the pill and the steps
 * say it already. own: the line names its own Linear issue (a nightly test's: the nightly report
 * filed it, not the watch), so no agent writes a fix for it unless a person tells Claude to.
 * asked: an instruction to Claude waits for its answer.
 */
function nextSaid(state, own, asked) {
  if (asked) return 'Claude has your instruction. The answer shows under your words below, after the next run of the watch (each 15 minutes).';
  if (state === 'stuck') return own
    ? 'The test failed again after the fix merged. The cause can be a new one. No agent works on it now. To get a fix, tell Claude what to do below.'
    : 'The problem is still here after the fix merged. To get a new fix, tell Claude what to do below.';
  if (own && (state === 'issue' || state === 'part')) return 'The nightly report put this failure in Linear. No agent writes a fix for it on its own. To get a fix, tell Claude what to do below.';
  return '';
}

/** Why a line's card has no box to tell Claude what to do, by its state; '' when it has one. */
function noBoxSaid(state, read) {
  if (!read) return 'Reading the user issues…';
  return {
    none: 'Claude files this problem in Linear within 15 minutes. Then you can tell Claude what to do here.',
    noise: 'Claude looked and found nothing to fix.',
    person: 'You do this one yourself, in the list on this page.',
    unreadable: 'The page could not read this part. A refresh reads it again.',
    count: 'Each issue has its own card on User issues.'
  }[state] || '';
}
`;

/** Drawing; uses the page's helpers (esc, when, tidy, safeLink, splitAlert, fixOf, fixHtml, fixLine, fixFor, fixPictures, issueCard, issueTalk, outLink, stepsHtml) and its state. */
export const CARD_SCRIPT = String.raw`
/** One line of a part as its card. group is the section the card is in. */
function lineCard(a, group) {
  const level = a.level in LEVEL ? a.level : 'watch';
  const t = splitAlert(tidy(a.text));
  const ud0 = userIssuesData(), ud = ud0 && { ...ud0, notes: notesWithSends(ud0.notes, SENDS) };
  const unread = a.key === 'unreadable';
  // "User issues open" counts Linear issues itself: its own cards are the issues on this page.
  const f = unread || a.key === 'user-issues-open' || a.key === 'user-issues-waiting' ? null : fixOf(a);
  const issue = f && f.issues.length === 1 ? f.issues[0] : null;
  const row = issue && ud ? (ud.issues || []).find((x) => x.issue === issue) || null : null;
  const record = issue && ud && ud.fixes ? ud.fixes[issue] || null : null;
  const notes = issue && ud && ud.notes ? ud.notes[issue] || [] : [];
  const pr = f && f.pr && f.pr.number ? f.pr : null;
  const shown = fixFor(record, pr);
  const byClaude = !!shown && record.decision === 'merge';
  const asked = notes.some((n) => n.state === 'waiting' || n.state === 'working');
  const way = f ? lineWay(f, byClaude, asked)
    : { pill: unread ? ['Could not read', ''] : ['Waits on you', 'you'], at: 0, steps: LINE_STEPS };
  const where = 'Found in ' + esc(PART_TITLE[a.part] || titleOf(group)) + (row && row.firstAt ? ' · first seen ' + when(row.firstAt) : '') + (row && row.people ? ' · ' + num(row.people) + (Number(row.people) === 1 ? ' person' : ' people') : '');
  const link = safeLink(a.link);
  const why = f && f.issues.length > 1 ? 'count' : !issue ? (unread ? 'unreadable' : f ? f.state : 'person') : '';
  const side = claimButton(issue, !!(row && row.closedAt)) + closeButton(issue, !!(row && row.closedAt)) + (way.pill[1] === 'you' && pr && f.state === 'open' ? outLink(safeLink(pr.url) || PR_URL + pr.number, 'Review pull request ' + esc(pr.number), 'button dark') : '') +
    (pr && f.state !== 'open' ? outLink(safeLink(pr.url) || PR_URL + pr.number, 'Open pull request ' + esc(pr.number), 'button') : '') +
    (link ? outLink(link, 'Open the page', 'button') : '') +
    (issue && row && safeLink(row.issueUrl) ? outLink(row.issueUrl, 'Open ' + esc(issue) + ' in Linear', 'button') : '') +
    (f && f.issues.length > 1 ? '<ul class="eachissue">' + f.issues.map((i) => '<li><a href="' + esc(cardHref('userissues', i)) + '">' + esc(i) + '</a>: tell Claude what to do</li>').join('') + '</ul>' : '') +
    (why ? '<p class="nobox">' + esc(noBoxSaid(why, unread || !!ud)) + '</p>' : '') +
    (unread ? '' : resolveButton([a], a.part, 'button'));
  return issueCard({
    card: lineCardId(a), cls: 'line ' + level,
    tags: '<span class="tag ' + level + '">' + esc(LEVEL[level].title) + '</span>' + backTag(a, 'tag back') +
      (issue ? (row && safeLink(row.issueUrl) ? outLink(row.issueUrl, esc(issue), 'lin') : '<b>' + esc(issue) + '</b>') + (row && row.state ? '<span>' + esc(row.state) + ' in Linear</span>' : '') + claimTag(issue) : ''),
    title: t.title, meta: where,
    // A line with one Linear issue: the box to tell Claude what to do with it. Any other line: the box to ask Claude about it (pageAsk.ts).
    talk: issue ? issueTalk({ issue, closedAt: row ? row.closedAt : null }, (ud && ud.notes) || {}, 'ln-' + lineCardId(a)) : askTalk(lineCardId(a), group, t.title),
    record: issue ? issueRecord(issue, row && row.firstAt ? { at: row.firstAt, who: 'The watch', said: 'found the problem' } : null, way.pill) : '',
    // Short, as a user issue's card (pageIssues.ts shortCard): Wrong, Known and Next, the rest behind Details.
    pill: way.pill,
    short: (() => {
      const n = issue && f ? nextSaid(f.state, !!(a.issues && a.issues.length), asked) : '';
      const fixed = f && !why ? fixHtml(a) : f && why === 'count' ? fixHtml(a) : !f && t.next ? esc(t.next) : '';
      const pics = issue ? fixPictures(record, issue, !!shown, ud && ud.diagrams ? ud.diagrams[issue] : null) : '';
      const claude = shown ? fixLine(shown, { tab: f.state === 'merged' || f.state === 'stuck' ? 'merged' : '' }) : '';
      const kv = (label, html) => html ? '<div><h5 class="imh">' + esc(label) + '</h5>' + html + '</div>' : '';
      const next = (record && !record.pr && planGoing(record) ? planLine(record.plan) : '') + (n ? '<p class="inext">' + esc(n) + '</p>' : '') + (fixed ? (n ? '<small class="muted">' + fixed + '</small>' : '<p>' + fixed + '</p>') : row && row.solution ? (n ? '<small class="muted">' : '<p>') + esc(row.solution) + (n ? '</small>' : '</p>') : '');
      // The issue's card in Claude's words (pageIssues.ts issueCardOf), as on the User issues page: it replaces Wrong and Known.
      const card = issue && ud && ud.cards ? issueCardOf(ud.cards[issue]) : null;
      if (card) return {
        lines: [
          ['Came back', a.backWhy ? '<p>' + esc(a.backWhy) + '</p>' : ''],
          ['About', '<p>' + esc(card.about) + '</p>'],
          ['Events', eventsHtml(card.events)],
          ['Known', card.known ? '<p>' + esc(card.known) + '</p>' : ''],
          way.pill[1] === 'you' && card.options.length ? ['Decide', choiceHtml(card, pr && f && f.state === 'open' ? pr : null)] : ['Next', next]
        ],
        bar: side,
        more: (pics ? '<div class="ipics">' + pics + '</div>' : '') + (way.at ? '<div class="iprog">' + stepsHtml(way.steps, way.at) + '</div>' : '') +
          kv('The fix', row && row.solution && fixed ? '<p>' + esc(row.solution) + '</p>' : '') + kv('What Claude did', claude)
      };
      return {
        lines: [
          // Claude found that the problem an admin resolved came back (pageResolve.ts).
          ['Came back', a.backWhy ? '<p>' + esc(a.backWhy) + '</p>' : ''],
          ['Wrong', row && row.problem ? '<p>' + esc(row.problem) + '</p>' : ''],
          ['Known', row && row.known ? '<p>' + esc(row.known) + '</p>' : ''],
          // The cause is not proven yet: what Claude does next, and when, leads (pageIssues.ts planLine).
          ['Next', next]
        ],
        bar: side,
        more: (pics ? '<div class="ipics">' + pics + '</div>' : '') + (way.at ? '<div class="iprog">' + stepsHtml(way.steps, way.at) + '</div>' : '') +
          kv('What happened', row && row.context ? '<p>' + esc(row.context) + '</p>' : '') +
          kv('The fix', row && row.solution && fixed ? '<p>' + esc(row.solution) + '</p>' : '') + kv('What Claude did', claude)
      };
    })()
  });
}

/** A part's lines as cards, above its picture and its numbers. */
function lineCards(alerts, group, part) {
  if (!alerts || !alerts.length) return '';
  return '<div class="icards lcards">' + alerts.map((a) => lineCard(Object.assign({ part }, a), group)).join('') + '</div>';
}

/** The lines' cards read the user issues and the pull requests: when those come, every section draws its cards again. */
function redrawLineCards() {
  for (const g of SECTIONS) {
    if (g.parts.includes('userissues')) continue;
    const p = g.parts.find((x) => results[x]);
    if (p) show(p, results[p]);
  }
}

// ---- opening a card from the Overview ----
let wantCard = null;
/** The card a link opened last, and when: it keeps its ring for 10 minutes, so the admin finds it again after the page draws again. */
let markedCard = null, markedAt = 0;
const MARK_MS = 10 * 60000;
/** Puts the ring back on the card a link opened, after a redraw, and takes it off every other card. */
function remark() {
  const on = markedCard && Date.now() - markedAt < MARK_MS ? markedCard : null;
  for (const x of document.querySelectorAll('.marked')) if (x.dataset.card !== on) x.classList.remove('marked');
  if (on) for (const x of document.querySelectorAll('[data-card]')) if (x.dataset.card === on) x.classList.add('marked');
}
/** Scrolls to the card the address names, opens its tab, and rings it; waits while its section loads. */
function focusCard() {
  remark();
  const v = view();
  if (!wantCard || v.name !== 'group') return;
  // The summary draws on the next frame, and looks for the card again then.
  if (sumQueued) return;
  // The card is in the page's summary (pageSummary.ts), or in All the details (a build in Where each build and update is).
  const box = $('card-' + v.id);
  const find = () => box && [...$('sum').querySelectorAll('[data-card]'), ...box.querySelectorAll('[data-card]')].find((x) => x.dataset.card === wantCard);
  let el = find();
  if (!el) {
    const g = SECTIONS.find((s) => s.id === v.id);
    // Every part answered and the card is not there: the line went (its check found it fixed).
    if (g && g.parts.every((p) => results[p]) && results.userissues) { say(resolvedCard(wantCard) ? 'That problem is resolved. It is in Resolved on the Overview.' : 'That problem is gone from this page. It is fixed.', ''); wantCard = null; }
    return;
  }
  const id = wantCard;
  // A tutorial video's cards are under its row's "waits on you" button (pageVideos.ts): open them.
  if (el.hidden && el.classList.contains('vcards')) {
    const b = document.querySelector('[aria-controls="' + el.id + '"]');
    if (b) { b.click(); el = find() || el; }
  }
  wantCard = null;
  if (el.hidden && el.dataset.tab) {
    const b = el.closest('.issues') && el.closest('.issues').querySelector('[data-itab="' + el.dataset.tab + '"]');
    if (b) b.click();
  }
  // A card behind "Show the numbers" (a build in Where each build and update is): open what holds it.
  for (let d = el.parentElement; d; d = d.parentElement) if (d.tagName === 'DETAILS' && !d.open) d.open = true;
  if (box.contains(el) && box.classList.contains('collapsed')) setOpen(v.id, true);
  el.classList.add('hit');
  markedCard = id; markedAt = Date.now();
  remark();
  el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  setTimeout(() => el.classList.remove('hit'), 4000);
}

// A tap anywhere on an Overview row opens its card; its links and buttons keep their own work.
document.addEventListener('click', (e) => {
  const row = e.target.closest && e.target.closest('.alert[data-href]');
  if (!row || e.target.closest('a, button, summary, input, textarea, select, svg.mini, .chart')) return;
  if (getSelection && String(getSelection())) return;
  location.hash = row.dataset.href.replace(/^#/, '');
});
`;
