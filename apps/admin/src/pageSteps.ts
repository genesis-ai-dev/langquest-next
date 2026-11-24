/**
 * The steps on a user issue's card, as a timeline
 * (docs/decisions/2026-11-24-each-issue-card-shows-its-steps.md): what the watch
 * and Claude's agent team did, with each try's reads of the field diagnostics,
 * the production database and the logs, the plan, the fix and its review, the
 * merge and Linear's state; and what admins did on the card. The work Claude
 * starts alone shows the same as the work an instruction starts. Under each
 * instruction, the steps from it to Claude's answer. The steps come from
 * diag.ops_user_issue_steps (ops.user_issue_steps), the taps and answers from
 * the card's record (pageSends.ts cardRecord).
 * Plain JavaScript inside page.ts's script, joined to pageSends.ts's chunks;
 * everything shown is escaped.
 */

/** The look, inside page.ts's style element. */
export const STEPS_CSS = String.raw`
.isteps { border-top: 1px solid var(--line); padding-top: 10px; display: grid; gap: 6px; }
.isteps > .shead { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; min-height: 32px; }
.isteps .rh { font-size: 11px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); flex: 1; }
.isteps .ipill { font-size: 12px; }
.isteps details > summary { min-height: 40px; display: flex; align-items: center; cursor: pointer; font-size: 13px; color: var(--primary); }
.tline { list-style: none; margin: 0; padding: 0; display: grid; }
.tline li { position: relative; display: grid; grid-template-columns: 132px minmax(0, 1fr); gap: 2px 10px; padding: 0 0 10px 22px; font-size: 13.5px; line-height: 1.45; }
.tline li::before { content: ''; position: absolute; left: 3px; top: 6px; width: 9px; height: 9px; border-radius: 50%; background: var(--primary); }
.tline li::after { content: ''; position: absolute; left: 7px; top: 17px; bottom: -1px; width: 1px; background: var(--line); }
.tline li:last-child::after { display: none; }
.tline li.person::before { background: var(--ink2); }
.tline li.done::before { background: var(--green); }
.tline li.bad::before { background: var(--red); }
.tline li.bad > span { color: var(--red); }
.tline time { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.tline small { display: block; color: var(--muted); font-size: 12.5px; }
.tline q { display: block; color: var(--ink2); font-style: italic; }
.tline a { white-space: nowrap; }
.talk .tline { margin: 6px 0 4px; justify-self: stretch; }
@media (max-width: 560px) { .tline li { grid-template-columns: minmax(0, 1fr); } }
`;

/** The words of each step, pure so the tests read them without a browser; uses the page's esc. */
export const STEPS_LOGIC = String.raw`
/** The logs a try reads (docs/production-reads.md "Logs"), in words. */
const LOG_SAID = { 'worker-logs': 'the Cloudflare Worker logs', 'worker-builds': 'the Cloudflare deploys', 'worker-build-log': 'a Cloudflare deploy log',
  'supabase-logs': 'the Supabase logs', 'eas-builds': 'the EAS builds', 'eas-build-log': 'an EAS build log', 'github-job-log': 'a GitHub job log' };
/** Words joined as a list: "a", "a and b", "a, b and c". */
const listSaid = (l) => l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1];
const timesSaid = (n, what) => what + ' (' + n + (n === 1 ? ' query)' : ' queries)');
/** A plan's reads (ops.user_issue_reads): how many of the field diagnostics and of the production database, and which logs. */
function readsSaid(r) {
  if (!r || typeof r !== 'object') return '';
  const parts = [];
  if (r.diag > 0) parts.push(timesSaid(Number(r.diag), 'the field diagnostics'));
  if (r.db > 0) parts.push(timesSaid(Number(r.db), 'the production database'));
  for (const l of Array.isArray(r.logs) ? r.logs : []) parts.push(LOG_SAID[l] || 'the ' + l + ' log');
  return listSaid(parts);
}
/** Where the watch found a kind of problem, by its family (server/userIssues.ts FAMILIES). */
const FAMILY_SAID = { feedback: 'A person sent it from help mode.', job: 'A server job reported it.', worker: 'The web traffic showed it.', ops: 'The ops dashboard showed it.' };
const MODEL_SAID = { opus: 'Opus', sonnet: 'Sonnet' };
/** What a fix record says the team did (ops.user_issue_fixes: decision, reason, verdict). */
function fixStepSaid(d) {
  if (d.decision === 'merge') return 'wrote the fix. It keeps the rules, so it merges by itself when its checks pass';
  if (d.decision === 'waits') return d.reason === 'instruction' ? 'wrote the fix. It waits for your yes, as you asked'
    : d.reason === 'claimed' ? 'wrote the fix as a suggestion for the developer who claimed the issue'
    : d.reason === 'stalled' ? 'tried 3 times to get the fix into main. It waits for a developer' : 'wrote the fix. A developer must read it first';
  return { not_a_bug: 'found that it is not a bug', unconfirmed: 'did not prove the cause yet', decision: 'found that a person must decide' }[d.verdict] || 'made no change';
}
/**
 * One step (ops.user_issue_steps) in words: who did it ('' when no one is named), what, a line under it,
 * the pull request, the run, and its look: 'done' (the work ended well), 'bad' or ''.
 */
function stepSaid(s, issue) {
  const d = s.detail || {};
  const x = { who: 'Claude', said: '', sub: '', pr: s.pr || null, run: s.run || null, look: '' };
  if (s.kind === 'filed') return { ...x, who: 'The watch', said: 'found the problem and filed it in Linear as ' + issue, sub: FAMILY_SAID[d.family] || 'Phones and browsers reported it.' };
  if (s.kind === 'known') return { ...x, who: 'The watch', said: 'found a new kind of this problem and added it to ' + issue, sub: FAMILY_SAID[d.family] || '' };
  if (s.kind === 'grew') return { ...x, who: 'The watch', said: 'saw more people hit it: ' + Number(d.people || 0) + ' in 7 days' };
  if (s.kind === 'taken') return { ...x, said: 'started on the instruction' };
  if (s.kind === 'handed') {
    const reads = readsSaid(d.reads);
    return { ...x, said: 'started a try to prove the cause and fix it', sub: reads ? 'Before it starts, it reads ' + reads + '.' : '' };
  }
  if (s.kind === 'plan') {
    const reads = readsSaid(d.reads);
    return { ...x, said: 'made a plan: ' + String(d.next || '').replace(/\.$/, ''),
      sub: [reads ? 'The next try reads ' + reads + '.' : '', d.probe ? 'A test of its own runs on main first.' : ''].filter(Boolean).join(' ') };
  }
  if (s.kind === 'fix') {
    const who = MODEL_SAID[d.model] ? 'Issue manager: ' + MODEL_SAID[d.model] + (d.effort ? ', ' + d.effort + ' effort' : '') + '.' : '';
    return { ...x, said: fixStepSaid(d), sub: [d.cause ? 'Cause: ' + d.cause : '', who].filter(Boolean).join(' '), look: d.decision === 'merge' ? 'done' : '' };
  }
  if (s.kind === 'merged') return { ...x, who: '', said: 'Pull request ' + (s.pr || '') + ' merged. It fixes ' + issue + '.', look: 'done' };
  if (s.kind === 'state') return { ...x, who: '', said: issue + ' is ' + (d.state || 'changed') + ' in Linear.' };
  if (s.kind === 'closed') return { ...x, who: '', said: issue + ' closed in Linear' + (d.state ? ' as ' + d.state : '') + '.', look: 'done' };
  if (s.kind === 'reopened') return { ...x, who: '', said: issue + ' is open again in Linear.', look: 'bad' };
  return { ...x, said: String(s.kind) };
}
/** A step's entries: a fix the reviewer read is two steps, the fix and then the review. */
function stepEntries(s, issue) {
  const one = { at: s.at, step: true, ...stepSaid(s, issue) };
  if (s.kind !== 'fix' || !(s.detail && s.detail.reviewed)) return [one];
  const at = new Date(Date.parse(s.at) + 1).toISOString();
  return [one, { at, step: true, who: 'A second Claude', said: 'checked the work as the reviewer', sub: '', pr: null, run: one.run, look: '' }];
}
/** The kinds of step that a run on an admin's instruction takes, which show under the instruction. */
const TALK_KINDS = ['taken', 'handed', 'plan', 'fix', 'merged', 'state', 'closed'];
/** Steps worth a line: Linear's state is left out when the issue closed in that state within 10 minutes (the close says it). */
function stepsWorthIt(steps) {
  const l = steps || [];
  return l.filter((s) => s.kind !== 'state' || !l.some((c) => c.kind === 'closed' && (c.detail || {}).state === (s.detail || {}).state &&
    Math.abs(Date.parse(c.at) - Date.parse(s.at)) <= 600000));
}
/** Whether a step shows under an instruction: one of its kinds, between the instruction and the answer (or now). */
const inTalk = (s, talks) => TALK_KINDS.includes(s.kind) && (talks || []).some((n) => !n.local && Date.parse(s.at) >= Date.parse(n.at) && (!n.answeredAt || Date.parse(s.at) <= Date.parse(n.answeredAt)));
/**
 * An issue's timeline, the oldest first: its steps, and the card's record (taps, answers and how it began).
 * The watch's "found" is left out when a step says it filed the issue, and so is each step that shows under
 * an instruction (talks: the card's instructions, stepsBetween).
 */
function issueTimeline(steps, record, issue, talks) {
  const out = stepsWorthIt(steps).filter((s) => !inTalk(s, talks)).flatMap((s) => stepEntries(s, issue));
  const filed = (steps || []).some((s) => s.kind === 'filed');
  for (const r of record || []) {
    if (r.what === 'found' && filed) continue;
    const x = r.what === 'found' ? { who: r.who, said: r.said, words: '', bad: false } : recordSaid(r);
    const said = r.local === 'sending' ? 'are sending an instruction to Claude…' : r.local === 'refused' ? 'tried to send an instruction to Claude. It was not sent: ' + (r.detail || 'no reason given') : x.said;
    out.push({ at: r.at, who: x.who, said, sub: '', words: x.words, pr: null, run: null, look: x.bad || r.local === 'refused' ? 'bad' : '', person: x.who !== 'Claude' && r.what !== 'found' });
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
/** The steps between an instruction and Claude's answer to it (or now, while Claude works on it), the oldest first. */
function stepsBetween(steps, issue, from, to) {
  const a = Date.parse(from), b = to ? Date.parse(to) : Infinity;
  return stepsWorthIt(steps).filter((s) => TALK_KINDS.includes(s.kind) && Date.parse(s.at) >= a && Date.parse(s.at) <= b)
    .flatMap((s) => stepEntries(s, issue)).sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
}
`;

/** The drawing; uses the page's helpers (esc, outLink, safeLink, PR_URL, recordStamp). */
export const STEPS_SCRIPT = String.raw`
/** A card shows all its steps up to STEPS_ALL; with more, the newest STEPS_SHOWN, and the rest behind "Show earlier steps". */
const STEPS_ALL = 10, STEPS_SHOWN = 8;
function tlineHtml(list) {
  return '<ol class="tline">' + list.map((e) => {
    const links = [e.pr && e.said.indexOf('Pull request') !== 0 ? outLink(PR_URL + e.pr, 'PR ' + esc(e.pr)) : '', safeLink(e.run) ? outLink(e.run, 'The run') : ''].filter(Boolean).join(' · ');
    return '<li class="' + [e.look, e.person ? 'person' : ''].filter(Boolean).join(' ') + '"><time datetime="' + esc(e.at) + '">' + esc(recordStamp(e.at)) + '</time><span>' +
      (e.who ? '<b>' + esc(e.who) + '</b> ' : '') + esc(e.said) + (/[.…]$/.test(e.said) ? '' : '.') + (links ? ' ' + links : '') +
      (e.words ? '<q>' + esc(e.words.length > 160 ? e.words.slice(0, 159) + '…' : e.words) + '</q>' : '') +
      (e.sub ? '<small>' + esc(e.sub) + '</small>' : '') + '</span></li>';
  }).join('') + '</ol>';
}
/** An issue's steps on its card: the newest few at a glance, the earlier ones behind one tap, and whose turn it is now. */
function timelineHtml(entries, turn) {
  if (!entries.length) return '';
  const cut = entries.length > STEPS_ALL ? entries.length - STEPS_SHOWN : 0, early = entries.slice(0, cut), late = entries.slice(cut);
  return '<section class="isteps"><div class="shead"><span class="rh">Steps</span>' +
    (turn ? '<span class="ipill ' + esc(turn[1] || '') + '">Now: ' + esc(turn[0]) + '</span>' : '') + '</div>' +
    (early.length ? '<details><summary>Show ' + early.length + ' earlier step' + (early.length === 1 ? '' : 's') + '</summary>' + tlineHtml(early) + '</details>' : '') +
    tlineHtml(late) + '</section>';
}
`;
