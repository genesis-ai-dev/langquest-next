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
.icard { display: grid; gap: 16px; padding: 20px 22px; margin: 14px 0; background: var(--raised); border: 1px solid var(--line); border-radius: 16px; box-shadow: 0 1px 2px rgb(0 0 0 / .04), 0 4px 16px rgb(0 0 0 / .03); }
.icard[hidden] { display: none; }
.ihead { display: flex; gap: 12px 20px; align-items: flex-start; justify-content: space-between; }
.ihl { min-width: 0; }
.iprog { padding: 12px 14px 10px; background: var(--bg); border-radius: 12px; }
.igrid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 20px 28px; align-items: start; }
.imain { min-width: 0; display: grid; gap: 14px; align-content: start; }
.italk { border-top: 1px solid var(--line); padding-top: 14px; display: grid; gap: 10px; }
.italk > h5, .iside > h5 { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); }
.ipics { min-width: 0; } .ipics .vpics { margin: 0; } .ipics .vpic, .ipics .vpic.zoom { max-width: 100%; }
.ipics > p { margin: 0 0 6px; } .ipics > img { display: block; max-width: 100%; margin: 0 0 10px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer; }
.idiagram { list-style: none; margin: 0; padding: 0; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 26px; }
.idiagram li { position: relative; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); font-size: 13px; line-height: 1.4; }
.idiagram li:not(:last-child)::after { content: "→"; position: absolute; right: -21px; top: 50%; transform: translateY(-50%); color: var(--muted); font-size: 16px; line-height: 20px; }
.idiagram li b { display: block; font-size: 10.5px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 0 0 3px; }
.idiagram li.wrong { border: 2px solid var(--red); background: var(--redbg); } .idiagram li.wrong b { color: var(--red); }
.ipics figure { margin: 0 0 10px; } .ipics figcaption { font-size: 12px; font-weight: 600; color: var(--ink2); margin: 0 0 4px; }
.ipics figure img { display: block; width: 100%; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); min-height: 60px; }
.iresearch { margin-top: 28px; } .iresearch h3 { margin: 0 0 4px; }
.ifix p { margin: 0 0 6px; } .ifix b { font-weight: 600; } .ifix details { margin-top: 2px; } .ifix details[open] > summary { margin-bottom: 4px; }
.ifixpics { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0 0 10px; }
.ifixpics figure { margin: 0; min-width: 0; } .ifixpics figcaption { font-size: 12px; font-weight: 600; color: var(--ink2); margin: 0 0 4px; }
.ifixpics img { display: block; width: 100%; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); min-height: 60px; }
.ibody { min-width: 0; }
dl.three { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 10px 14px; margin: 0; font-size: 15px; line-height: 1.45; }
dl.three dt { font-size: 11px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); padding-top: 3px; }
dl.three dd { margin: 0; min-width: 0; overflow-wrap: anywhere; } dl.three dd p { margin: 0; } dl.three dd small { display: block; font-size: 12.5px; margin-top: 2px; }
.ibar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.ibar > a.button { display: inline-flex; align-items: center; text-decoration: none; font-size: 14px; min-height: 44px; }
.ibar a.button.dark { background: var(--ink); border-color: var(--ink); color: var(--card); }
.imore { flex-basis: 100%; } .imore > summary { cursor: pointer; min-height: 40px; display: inline-flex; align-items: center; font-size: 13.5px; color: var(--primary); font-weight: 600; }
.imore[open] > summary { margin-bottom: 8px; } .imore > div { display: grid; gap: 14px; } .imore h5.imh { margin: 0 0 3px; font-size: 11px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); } .imore p { margin: 0 0 4px; }
.ibar > a.button + .imore { flex-basis: auto; } .ibar:has(.imore[open]) .imore { flex-basis: 100%; } .ibar > ul, .ibar > p { flex-basis: 100%; margin: 0; }
.itags { display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center; margin: 0 0 6px; font-size: 12px; color: var(--muted); }
.itags .tag { margin: 0; background: var(--soft); color: var(--ink2); } .itags .tag.bad { color: var(--red); background: var(--redbg); } .itags .tag.good { color: var(--green); background: var(--greenbg); }
.itags a.lin { font-weight: 600; color: var(--ink); text-decoration: none; letter-spacing: .02em; } .itags a.lin:hover, .itags a.lin:focus-visible { color: var(--primary); text-decoration: underline; }
.icard a.pr, dl.kv a { color: var(--primary); font-weight: 600; }
dl.kv dd > small { display: block; font-size: 12.5px; line-height: 1.45; margin-top: 2px; }
.icard h4 { font-size: 18px; font-weight: 600; line-height: 1.3; margin: 0; overflow-wrap: anywhere; letter-spacing: -.005em; }
.imeta { font-size: 13px; color: var(--muted); margin: 4px 0 0; }
dl.kv { display: grid; gap: 14px; margin: 0; font-size: 14px; line-height: 1.5; }
dl.kv > div { min-width: 0; }
dl.kv dt { font-size: 11px; font-weight: 600; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); margin: 0 0 3px; }
dl.kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; } dl.kv dd p { margin: 0 0 4px; } dl.kv dd ul { margin: 4px 0 0; padding-inline-start: 18px; }
.iside { display: grid; gap: 12px; align-content: start; min-width: 0; padding: 14px 16px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); }
.ipill { flex: none; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 999px; background: var(--soft); color: var(--ink2); white-space: nowrap; }
.ipill.you { background: var(--amberbg); color: var(--amber); } .ipill.claude { background: var(--soft); color: var(--primary); } .ipill.done { background: var(--greenbg); color: var(--green); }
ol.steps { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); list-style: none; margin: 0; padding: 0; }
ol.steps li { position: relative; padding-top: 20px; font-size: 12px; line-height: 1.3; color: var(--muted); text-align: center; overflow-wrap: anywhere; }
ol.steps li::before { content: ''; position: absolute; top: 6px; left: 0; right: 0; height: 2px; background: var(--line); }
ol.steps li:first-child::before { left: 50%; } ol.steps li:last-child::before { right: 50%; }
ol.steps li::after { content: ''; position: absolute; top: 0; left: 50%; transform: translateX(-50%); width: 14px; height: 14px; border-radius: 50%; background: var(--card); border: 2px solid var(--line); box-sizing: border-box; }
ol.steps li.done { color: var(--ink2); } ol.steps li.done::before { background: var(--green); } ol.steps li.done::after { background: var(--green); border-color: var(--green); }
ol.steps li.now { color: var(--ink); font-weight: 600; } ol.steps li.now::before { background: linear-gradient(to right, var(--green) 50%, var(--line) 50%); }
ol.steps li.now:first-child::before { background: var(--line); }
ol.steps li.now::after { background: var(--primary); border-color: var(--primary); box-shadow: 0 0 0 4px var(--soft); }
.istep { margin: 8px 0 0; font-size: 13px; color: var(--ink2); text-align: center; }
.iside a.button { display: flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none; font-size: 14px; min-height: 44px; }
.iside a.button.dark { background: var(--ink); border-color: var(--ink); color: var(--card); }
.iside .ibtns { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; }
.iside details > summary, .ifix details > summary { cursor: pointer; min-height: 40px; display: flex; align-items: center; font-size: 13px; color: var(--primary); font-weight: 600; }
.talk { display: grid; gap: 4px; }
.said.you, .said.claude { max-width: min(560px, 88%); margin: 0; padding: 10px 14px; border-radius: 16px; font-size: 14px; line-height: 1.45; white-space: pre-line; overflow-wrap: anywhere; }
.said.you { justify-self: end; background: var(--primary); color: #fff; border-end-end-radius: 4px; }
.said.claude { justify-self: start; background: var(--soft); color: var(--ink); border-end-start-radius: 4px; }
.said.claude { white-space: normal; display: grid; gap: 8px; }
.said.claude > * { margin: 0; } .said.claude strong { font-weight: 650; }
.said.claude ol, .said.claude ul { padding-inline-start: 22px; display: grid; gap: 6px; } .said.claude li::marker { color: var(--muted); font-weight: 600; }
.said code { font: 12.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--bg); border: 1px solid var(--line); border-radius: 5px; padding: 1px 5px; overflow-wrap: anywhere; }
.said pre { position: relative; margin: 0; padding: 10px 64px 10px 12px; background: var(--bg); border: 1px solid var(--line); border-radius: 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.said pre code { background: none; border: 0; padding: 0; }
.said pre .copy { position: absolute; top: 6px; right: 6px; min-height: 30px; padding: 0 10px; font-size: 12px; border-radius: 7px; }
.talk small { font-size: 11.5px; color: var(--muted); margin-bottom: 6px; } .talk small.you { justify-self: end; }
.tell { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "t b" "s s"; gap: 6px 10px; align-items: end; }
.tell textarea { grid-area: t; min-height: 52px; background: var(--card); font-size: 14px; border-radius: 12px; resize: vertical; }
.tell small { grid-area: s; font-size: 12px; color: var(--muted); } .tell button { grid-area: b; min-height: 52px; padding: 0 18px; border-radius: 12px; }
.iside .tell, .iside details .tell { grid-template-columns: minmax(0, 1fr); grid-template-areas: "t" "s" "b"; } .iside .tell button { justify-self: start; min-height: 44px; }
@container (max-width: 760px) {
  .igrid { grid-template-columns: minmax(0, 1fr); }
  .idiagram { grid-auto-flow: row; gap: 22px; }
  .idiagram li:not(:last-child)::after { content: "↓"; right: auto; left: 50%; top: auto; bottom: -21px; transform: translateX(-50%); }
  .tell { grid-template-columns: minmax(0, 1fr); grid-template-areas: "t" "s" "b"; } .tell button { justify-self: start; }
  .ihead { flex-direction: column; }
}
`;

/** Pure: apps/admin/test/issues.test.ts runs these with new Function. */
export const ISSUE_LOGIC = String.raw`
/**
 * Where the watch found a user issue, from the family of its first key (scripts/user-issues.mjs FAMILIES).
 * A person who sent it wins over every other key: a report the watch added to an issue it filed for a
 * phone's records keeps "A person sent it", though its key does not come first.
 */
const ISSUE_SOURCES = { job: 'Server jobs', worker: 'Web traffic', feedback: 'A person sent it', ops: 'The ops dashboard' };
const PHONE_FAMILIES = ['error', 'sync', 'transfer', 'auth', 'expected', 'audio', 'fill', 'device', 'slow', 'snapshot'];
function issueSource(keys) {
  if ((keys || []).some((k) => String(k).startsWith('feedback:'))) return ISSUE_SOURCES.feedback;
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
 * then an open issue says only that it is open. fix is the agent team's
 * record of the issue (sources/ops.ts UserIssueFix), when it has one: 'claude'
 * is true for a fix that merges, or merged, without a person.
 */
function issueWay(r, prs, notes, fix) {
  const naming = r.issue ? (prs || []).filter((p) => (p.issues || []).includes(r.issue)) : [];
  const open = naming.find((p) => p.state === 'open') || null;
  const merged = naming.filter((p) => p.state === 'merged' && p.mergedAt).sort((a, b) => Date.parse(b.mergedAt) - Date.parse(a.mergedAt))[0] ||
    (r.fixedBy ? { number: r.fixedBy, url: '', mergedAt: r.fixedAt || null } : null);
  if (!r.issue) return { tab: 'closed', pill: 'Already fixed', level: 'done', at: 0, pr: merged };
  const byClaude = (pr) => !!fixFor(fix, pr) && fix.decision === 'merge';
  if (r.closedAt) {
    const dropped = /^(cancell?ed|duplicate)$/i.test(String(r.state || ''));
    return { tab: 'closed', pill: dropped ? r.state : 'Closed', level: dropped ? '' : 'done', at: dropped ? 0 : ISSUE_STEPS.length + 1, pr: merged, claude: !dropped && byClaude(merged) };
  }
  // An instruction Claude has not answered: Claude acts next, in the tab the issue is in.
  const asked = (notes || []).some((n) => n.state === 'waiting' || n.state === 'working');
  const next = (way) => (asked ? { ...way, pill: 'Claude acts next', level: 'claude' } : way);
  if (open && byClaude(open)) return next({ tab: 'claude', pill: 'Merges when checks pass', level: 'claude', at: 4, pr: open, claude: true });
  if (open) return next({ tab: 'you', pill: 'Waits on you', level: 'you', at: 4, pr: open });
  // Merged is what Linear says (docs/decisions/2026-11-24-a-merge-closes-the-issues-it-fixes.md): the fix merged and
  // waits on its deploy (Deploying, Verifying). A pull request merged so lately that the watch did not read Linear
  // since counts too. A merged pull request that names an issue Linear still has open was a part of the work.
  const linearMerged = MERGED_STATES.test(String(r.state || ''));
  if (linearMerged || (merged && merged.mergedAt && Date.now() - Date.parse(merged.mergedAt) < LINEAR_READ_MS)) {
    return next({ tab: 'merged', pill: merged && byClaude(merged) ? 'Merged by Claude' : 'Merged', level: 'claude', at: 5, pr: merged, claude: !!merged && byClaude(merged) });
  }
  const part = merged || null;
  if (!prs) return next({ tab: 'open', pill: 'Open', level: '', at: 3, pr: null, part });
  // The cause is not proven yet, and Claude carries out its plan to prove it: Claude acts next, not a developer.
  if (fixFor(fix, null) && fix.decision === 'none' && planGoing(fix)) return next({ tab: 'nofix', pill: 'Claude proves the cause', level: 'claude', at: 3, pr: null, part });
  // The team looked and changed nothing: a developer decides what happens next.
  if (fixFor(fix, null) && fix.decision === 'none') return next({ tab: 'you', pill: 'Waits on you', level: 'you', at: 3, pr: null, part });
  return next({ tab: 'nofix', pill: 'No fix yet', level: '', at: 3, pr: null, part });
}
/** The Linear states of a fix that merged and waits on its deploy (scripts/merge-issues.mjs MERGED_STATES). */
const MERGED_STATES = /^(deploying|verifying)$/i;
/** The watch reads Linear each 15 minutes: a merge younger than this may not show in Linear's state on the page yet. */
const LINEAR_READ_MS = 30 * 60000;

/**
 * The agent team's record, when it is about the pull request the card shows
 * (or about no pull request, on a card without one); else null, so a card
 * never puts Claude's reasons for one change under another.
 */
function fixFor(fix, pr) {
  if (!fix) return null;
  return (fix.pr ? !!pr && Number(pr.number) === Number(fix.pr) : !pr) ? fix : null;
}
/** After this many tries to prove the cause the watch hands an issue back once a day, not each 2 hours (scripts/agent-team.mjs PLAN_TRIES). */
const PLAN_TRIES = 10;
/** The record has a plan to prove the cause, which the watch carries out (docs/agent-team.md "When the cause is not proven yet"). */
function planGoing(fix) {
  return !!(fix && fix.plan && fix.plan.next);
}
/** When Claude goes on with the plan, in the viewer's clock: the time today, else the day and the time. */
function planWhen(iso, now) {
  const at = Date.parse(iso);
  if (!Number.isFinite(at) || at <= (now || Date.now()) + 60000) return 'at the next run of the watch';
  const d = new Date(at), today = new Date(now || Date.now()).toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return 'at about ' + (today ? time : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + time);
}
/** What Claude does next on an issue whose cause it did not prove yet, and when. After PLAN_TRIES tries, once a day. */
function planSaid(plan, now) {
  if (!plan || !plan.next) return null;
  const tries = Number(plan.tries) || 1;
  return { next: plan.next, when: 'Claude does it ' + planWhen(plan.nextAt, now) + ' · try ' + tries + (tries >= PLAN_TRIES ? ' · once a day from now on' : ' · each 2 hours or more'), steps: plan.steps || '' };
}
/**
 * What the card says when Claude changed nothing and has no plan: what Claude found, from its record, and
 * what the developer does with it. Never only "a developer decides" (docs/decisions/2026-11-22-an-issue-card-never-ends-at-no-fix.md).
 */
function noFixSaid(fix) {
  const why = fix && fix.why ? esc(fix.why) : '';
  if (fix && fix.reason === 'not_a_bug') return '<p class="inext"><b>Claude found no bug.</b> ' + why + '</p><small class="muted">Close the issue in Linear when you agree. Send an instruction when you do not.</small>';
  if (fix && fix.reason === 'decision') return '<p class="inext"><b>Claude needs your choice.</b> ' + why + '</p>';
  if (fix) return '<p class="inext"><b>' + esc(FIX_REASON[fix.reason] || 'Claude changed nothing') + '.</b> ' + why + '</p><small class="muted">Claude tries again at the next run of the watch.</small>';
  return '<span class="muted">Claude did not look at it yet. It takes it at a next run of the watch.</span>';
}
/** The plan as a line of the card: "Next:", what Claude does, when, and the whole plan behind one tap. */
function planLine(plan) {
  const p = planSaid(plan);
  if (!p) return '';
  return '<p class="inext"><b>Next:</b> ' + esc(p.next) + (p.when ? '<br><small class="muted">' + esc(p.when) + '</small>' : '') + '</p>' +
    (p.steps ? '<details><summary>Claude\'s plan</summary><p>' + esc(p.steps) + '</p></details>' : '');
}
/** Why a fix waits for a developer, by the gate's reason (scripts/agent-team.mjs REASONS). */
const FIX_REASON = {
  mode: 'The agent team asks before each merge', review: 'Claude asks you to read the change', decision: 'Your choice is needed', not_a_bug: 'Claude found no bug',
  unconfirmed: 'The cause is not proven yet', cause: 'No test proves the cause', paths: 'The change is in code that always waits', checks: 'A check failed',
  reviewer: 'The reviewer asks you to look', instruction: 'It follows your instruction', app: 'The job could not open a pull request that merges', stalled: 'It did not merge',
  claimed: 'Claude suggests this change to the developer who claimed the issue'
};
/**
 * What the team decided and why, as parts for the card: 'decision' is [bold words, the rest];
 * 'reasons' are [label, Claude's words], only those it wrote; 'manager' is the model and effort.
 */
function fixSaid(fix, merged) {
  const decision = fix.decision === 'merge'
    ? [merged ? 'Claude merged this fix without a person.' : 'This fix merges without a person when its checks pass.', '']
    : [(FIX_REASON[fix.reason] || 'It waits for a developer') + '.', fix.why || ''];
  const reasons = [['Change', fix.summary], ['Cause', fix.cause], [fix.beforeAfter ? 'Pictures' : 'Test', fix.proof], ['Reviewer', fix.review], ['Same mistake in other places', fix.twins]].filter((x) => x[1]);
  return { decision, reasons, manager: fix.model ? fix.model + (fix.effort ? ', ' + fix.effort + ' effort' : '') : '' };
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

/** One line of Claude's words: escaped, then \`code\` and **strong**. Nothing else becomes HTML. */
function saidInline(s) {
  return esc(s).replace(/\x60([^\x60]+)\x60/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
/**
 * An answer Claude wrote kept all on one line (before line breaks were kept): put each step of
 * "1) ... 2) ..." on its own line, only when the steps count 1, 2, 3 in order.
 */
function saidSteps(t) {
  if (/\n/.test(t)) return t;
  const at = [];
  const re = /(^|\s)(\d{1,2})[.)]\s/g;
  let m;
  while ((m = re.exec(t))) if (Number(m[2]) === at.length + 1) at.push(m.index + m[1].length);
  if (at.length < 2) return t;
  return at.reduce((out, p, i) => out + t.slice(i ? at[i - 1] : 0, p).trimEnd() + '\n', '').replace(/^\n/, '') + t.slice(at[at.length - 1]);
}
/**
 * Claude's answer as the talk shows it (the user-issues skill asks for this shape): the first
 * paragraph as the lead, a line that starts "1." or "1)" as a numbered step, "- " as a point,
 * a fenced block as code with a copy button. Every word is escaped first.
 */
function saidHtml(text) {
  const lines = saidSteps(String(text ?? '').trim()).split('\n');
  const out = [];
  let list = null, para = [], code = null;
  const pre = (c) => '<pre><code>' + esc(c.join('\n')) + '</code><button type="button" class="copy" data-copy-code aria-label="Copy">Copy</button></pre>';
  // The first sentence is the lead: in bold, the rest of its paragraph not.
  const lead = (t) => { const m = t.match(/^(.+?[.!?])\s+(\S.*)$/); return '<strong>' + saidInline(m ? m[1] : t) + '</strong>' + (m ? ' ' + saidInline(m[2]) : ''); };
  const endPara = () => { if (para.length) out.push('<p>' + para.map((x, i) => !out.length && !i ? lead(x) : saidInline(x)).join('<br>') + '</p>'); para = []; };
  const endList = () => { if (list) out.push('<' + list.tag + '>' + list.items.map((x) => '<li>' + x + '</li>').join('') + '</' + list.tag + '>'); list = null; };
  // A block of code inside a list goes under its step, so the steps after it keep their numbers.
  const endCode = () => { if (list) list.items[list.items.length - 1] += pre(code); else out.push(pre(code)); code = null; };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (code) { if (/^\s*\x60\x60\x60/.test(line)) endCode(); else code.push(raw); continue; }
    if (/^\s*\x60\x60\x60/.test(line)) { endPara(); code = []; continue; }
    const step = line.match(/^\s*\d{1,2}[.)]\s+(.*)$/), point = line.match(/^\s*[-*•]\s+(.*)$/);
    if (step || point) {
      endPara();
      const tag = step ? 'ol' : 'ul';
      if (list && list.tag !== tag) endList();
      if (!list) list = { tag, items: [] };
      list.items.push(saidInline((step || point)[1]));
    } else if (!line.trim()) endPara();
    else if (list && /^\s{2,}/.test(raw)) list.items[list.items.length - 1] += ' ' + saidInline(line.trim());
    else { endList(); para.push(line.trim()); }
  }
  if (code) endCode();
  endPara(); endList();
  return out.join('');
}

/** The tabs of the User issues page, in order; Open shows only while the pull requests are not read. */
const ISSUE_TABS = [['you', 'Waits on you'], ['nofix', 'No fix yet'], ['open', 'Open'], ['claude', 'Fixed by Claude'], ['merged', 'Merged'], ['closed', 'Closed'], ['all', 'All']];
/** Whether a card shows on a tab. Fixed by Claude holds each fix that merges, or merged, without a person, in whatever state its issue is. */
const onTab = (way, tab) => tab === 'all' || way.tab === tab || (tab === 'claude' && !!way.claude);
/** How many issues each tab holds, and the tab to open: the one chosen while it holds an issue, else the first that does. */
function issueTabs(ways, chosen) {
  const count = {};
  for (const t of ISSUE_TABS) count[t[0]] = ways.filter((w) => onTab(w, t[0])).length;
  const tab = chosen && count[chosen] ? chosen : (ISSUE_TABS.find((t) => count[t[0]]) || ['all'])[0];
  return { count, tab };
}

/** The steps of a question about a tutorial video (sources/videos.ts AdminItem), as ISSUE_STEPS. */
/** A fix in the app, from Fix it to the new film (docs/decisions/2026-11-21-fix-it-sends-a-video-suggestion-to-the-agent-team.md). */
const APP_STEPS = [['You asked', ''], ['Claude fixes the app', 'Claude\'s agent team changes the app'], ['Checks', 'the checks and a second Claude read the fix'],
  ['Merged', 'the fix waits on its merge'], ['Filmed again', 'the video is filmed again']];
/** The step each stage of a fix in the app waits at (sources/videos.ts AppStage), and its words when they are not the step's own. */
const APP_AT = { filing: [2, 'the fix goes to Linear, then to Claude\'s agent team'], queued: [2, 'Claude\'s agent team starts within 15 minutes'], writing: [2, ''],
  none: [2, 'Claude made no change: read its answer'], checks: [3, 'the fix merges by itself when its checks pass'], yours: [4, 'the fix waits on your yes'],
  merged: [5, 'Claude\'s next fix run films the video again'], filming: [5, ''], filmed: [6, ''] };
function appSteps(a) {
  const w = APP_AT[a.app.stage] || [2, ''];
  return [APP_STEPS.map((x, i) => (i === w[0] - 1 && w[1] ? [x[0], w[1]] : x)), w[0]];
}
const VIDEO_STEPS = [['Found', ''], ['Claude looks', 'waits on Claude\'s look'], ['You answer', 'waits on your answer'], ['Claude changes the video', 'Claude makes the change'], ['Merged', 'the change waits on its merge']];
/**
 * The step a video's card waits at ('at', as issueWay): Claude's look before
 * a person is asked, the person's answer, then the change Claude makes from
 * that answer and its merge. 0 for a card with nothing to tell Claude (Publish,
 * a channel to connect, a reply to post).
 */
function videoWay(a) {
  if (a.kind === 'fixed') return { at: VIDEO_STEPS.length + 1 };
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
    steps.map((step, i) => '<li' + (i + 1 < at ? ' class="done"' : i + 1 === at ? ' class="now"' : '') + ' title="' + esc(step[0]) + '">' + esc(step[0]) + '</li>').join('') + '</ol>' +
    '<p class="istep">' + esc(says) + '</p>';
}

/** A card's headings in plain words, by the name its maker gives each line. */
const KV_SAID = { Next: 'What happens next', Context: 'What happened', Issue: 'What goes wrong', Solution: 'The fix', Claude: 'What Claude did', Found: 'What Claude found', Why: 'Why it matters', Where: 'Where in the code', Watch: 'Watch the video' };
/** The lines that go in the panel at the right, with the buttons: what is done about it. */
const KV_SIDE = ['Next', 'Solution', 'Claude', 'Where'];
/**
 * One card: at the top its tags, title, who acts next and its steps as a
 * progress bar; then at the left what happened (the pictures, then the lines),
 * and at the right a panel with the fix and the buttons; then the talk with
 * Claude across the card. c.tags and c.pics are HTML; c.lines are [label, HTML]
 * and a line without words is left out; c.pill is [words, level]; c.steps is
 * [steps, at]; c.side is the HTML under the fix; c.talk the talk with Claude
 * and its box; c.tab hides the card on another tab; c.card is its id for a
 * link to it (pageCards.ts); c.record the card's record of who did what (pageSends.ts recordHtml).
 */
function issueCard(c) {
  if (c.short) return shortCard(c);
  const lines = (c.lines || []).filter((l) => l[1]);
  const kv = (ls) => ls.length ? '<dl class="kv">' + ls.map((l) => '<div><dt>' + esc(KV_SAID[l[0]] || l[0]) + '</dt><dd>' + l[1] + '</dd></div>').join('') + '</dl>' : '';
  const main = lines.filter((l) => !KV_SIDE.includes(l[0])), side = lines.filter((l) => KV_SIDE.includes(l[0]));
  const right = kv(side) + (c.side || '');
  return '<article class="icard' + (c.pics ? ' pics' : '') + (c.cls ? ' ' + esc(c.cls) : '') + '"' + (c.card ? ' data-card="' + esc(c.card) + '"' : '') + (c.tab ? ' data-tab="' + esc(c.tab) + '"' + (c.claude ? ' data-claude="1"' : '') + (c.hidden ? ' hidden' : '') : '') + '>' +
    '<header class="ihead"><div class="ihl">' + (c.tags ? '<p class="itags">' + c.tags + '</p>' : '') + '<h4>' + esc(c.title) + '</h4>' + (c.meta ? '<p class="imeta">' + c.meta + '</p>' : '') + '</div>' +
    (c.pill && c.pill[0] ? '<span class="ipill ' + esc(c.pill[1] || '') + '">' + esc(c.pill[0]) + '</span>' : '') + '</header>' +
    (c.steps && c.steps[1] ? '<div class="iprog">' + stepsHtml(c.steps[0], c.steps[1]) + '</div>' : '') +
    // With nothing to show at the left, the panel takes the whole width.
    (c.pics || main.length ? '<div class="igrid"><div class="imain">' + (c.pics ? '<div class="ipics">' + c.pics + '</div>' : '') + '<div class="ibody">' + kv(main) + '</div></div>' +
      (right ? '<div class="iside">' + right + '</div>' : '') + '</div>' : right ? '<div class="iside">' + right + '</div>' : '') +
    (c.talk ? '<div class="italk"><h5>Talk with Claude</h5>' + c.talk + '</div>' : '') + (c.record || '') + '</article>';
}
/**
 * A user issue's card, short (docs/decisions/2026-11-21-short-user-issue-cards.md): its tags, title, the
 * one line of where it is, who acts next; then Wrong, Known and Next, each one line; then its buttons and
 * one Details tap that holds the rest (the diagram or pictures, the steps, what happened, the keys and
 * Claude's reasons); then the talk with Claude. c.short is { lines: [label, HTML], bar: HTML, more: HTML }.
 */
function shortCard(c) {
  const lines = (c.short.lines || []).filter((l) => l[1]);
  const more = c.short.more || '';
  return '<article class="icard short' + (c.cls ? ' ' + esc(c.cls) : '') + '"' + (c.card ? ' data-card="' + esc(c.card) + '"' : '') + (c.tab ? ' data-tab="' + esc(c.tab) + '"' + (c.claude ? ' data-claude="1"' : '') + (c.hidden ? ' hidden' : '') : '') + '>' +
    '<header class="ihead"><div class="ihl">' + (c.tags ? '<p class="itags">' + c.tags + '</p>' : '') + '<h4>' + esc(c.title) + '</h4>' + (c.meta ? '<p class="imeta">' + c.meta + '</p>' : '') + '</div>' +
    (c.pill && c.pill[0] ? '<span class="ipill ' + esc(c.pill[1] || '') + '">' + esc(c.pill[0]) + '</span>' : '') + '</header>' +
    (lines.length ? '<dl class="three">' + lines.map((l) => '<dt>' + esc(l[0]) + '</dt><dd>' + l[1] + '</dd>').join('') + '</dl>' : '') +
    (c.short.bar || more ? '<div class="ibar">' + (c.short.bar || '') + (more ? '<details class="imore"><summary>Details</summary><div>' + more + '</div></details>' : '') + '</div>' : '') +
    (c.talk ? '<div class="italk"><h5>Talk with Claude</h5>' + c.talk + '</div>' : '') + (c.record || '') + '</article>';
}
/** Where an issue is, in the words of its step (ISSUE_STEPS): "No fix yet", or "" while there is nothing to say. */
function stepWords(steps, at) {
  if (!at) return '';
  if (at > steps.length) return 'Fix is live';
  const w = steps[at - 1][1];
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : '';
}
const outLink = (href, words, cls) => '<a' + (cls ? ' class="' + cls + '"' : '') + ' href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + words + '</a>';

// ---- the User issues page: tabs with counts, one card for each issue ----
let issueTab = null;
/** The agent team's record on a card: what was decided, Claude's reasons, and the manager with its run. */
function fixLine(fix, way) {
  if (!fix) return '';
  const f = fixSaid(fix, way.tab === 'merged' || way.tab === 'closed');
  // The decision leads; Claude's reasons wait behind one tap.
  return '<div class="ifix"><p><b>' + esc(f.decision[0]) + '</b>' + (f.decision[1] && f.decision[1] !== f.decision[0] ? ' ' + esc(f.decision[1]) : '') + '</p>' + planLine(fix.plan) +
    (f.reasons.length ? '<details><summary>Claude\'s reasons</summary>' + f.reasons.map((x) => '<p><b>' + esc(x[0]) + '.</b> ' + esc(x[1]) + '</p>').join('') + '</details>' : '') +
    '<small class="muted">' + [f.manager ? 'Issue manager: ' + esc(f.manager) : '', when(fix.at), safeLink(fix.runUrl) ? outLink(fix.runUrl, 'The run') : ''].filter(Boolean).join(' · ') + '</small></div>';
}
/** An issue's diagram: one box for each step, in order, the step that goes wrong in red. Drawn as text. */
function diagramHtml(steps) {
  if (!Array.isArray(steps) || steps.length < 2) return '';
  const says = steps.map((s, i) => (i + 1) + '. ' + (s.where ? s.where + ': ' : '') + s.text + (s.wrong ? ' (this goes wrong)' : '')).join(' ');
  return '<ol class="idiagram" aria-label="' + esc('The issue in ' + steps.length + ' steps. ' + says) + '">' +
    steps.map((s) => '<li' + (s.wrong ? ' class="wrong"' : '') + '>' + (s.where ? '<b>' + esc(s.where) + '</b>' : '') + esc(s.text) + '</li>').join('') + '</ol>';
}
/**
 * The image of an issue at the left of its card: the screen where the problem shows, as the picture job made
 * it (with the screen after the fix, for a display fix), or else the issue's diagram. Under it, a button for
 * each screenshot and picture that came with the problem from help mode, which loads it for a signed-in admin.
 */
function fixPictures(fix, issue, shown, steps) {
  // The pictures are only under the pull request they are of.
  const pair = shown && fix && fix.beforeAfter ? '<div class="ifixpics">' + [['before', 'Before the fix'], ['after', 'After the fix']].map((w) =>
    '<figure><figcaption>' + w[1] + '</figcaption><img alt="The screen ' + w[0] + ' the fix" data-fixpic="' + esc(issue) + '" data-what="' + w[0] + '"></figure>').join('') + '</div>'
    : shown && fix && fix.before ? '<figure><figcaption>The problem on the screen</figcaption><img alt="The screen where the problem shows" data-fixpic="' + esc(issue) + '" data-what="before"></figure>'
    : diagramHtml(steps);
  return pair + ((fix && fix.pictures) || []).map((p) =>
    (p.screenshot ? '<p><button type="button" class="link" data-shot="' + esc(p.id) + '" data-what="screenshot">Show screenshot</button></p>' : '') +
    (p.picture ? '<p><button type="button" class="link" data-shot="' + esc(p.id) + '" data-what="picture">Show picture</button></p>' : '')).join('');
}
function userIssueCard(r, way, tab, notes, fixes, diagrams) {
  const record = r.issue && fixes ? fixes[r.issue] || null : null;
  const source = issueSource(r.keys);
  const pr = way.pr;
  // A merged pull request that names the issue while Linear still has it open: a part of the work, not the fix.
  const partSaid = () => way.part ? prLink(way.part) + ' merged as a part of the work. ' + esc(r.issue) + ' is still ' + esc(r.state || 'open') + ' in Linear.' : '';
  const solution = {
    you: () => pr ? prLink(pr) + ' waits on its merge.' + (pr.title ? '<br><small class="muted">' + esc(pr.title) + '</small>' : '') + (record && record.plan && planGoing(record) ? '<br><small class="muted">After the merge: ' + esc(record.plan.next) + '</small>' : '') : noFixSaid(record),
    claude: () => prLink(pr) + ' merges without a person when its checks pass.' + (pr && pr.title ? '<br><small class="muted">' + esc(pr.title) + '</small>' : ''),
    merged: () => (pr ? 'Fixed in ' + prLink(pr) + (pr.mergedAt ? ', merged ' + when(pr.mergedAt) : '') + '.' : 'The fix merged.') + ' Linear says ' + esc(r.state || 'open') + '.',
    nofix: () => planGoing(record) ? 'Claude proves the cause first, then writes the fix. ' + esc(planSaid(record.plan).when) + '.' : way.part ? '' : 'No pull request names ' + esc(r.issue) + '. <small class="muted">The page reads open ones, and ones merged in the last 14 days.</small>',
    open: () => fixData && fixData.state === 'error' ? '<span class="bad">Could not read the pull requests: ' + esc(fixData.error) + '</span>' : '<span class="muted">Reading the pull requests…</span>',
    closed: () => !r.issue ? (pr && pr.number ? prLink(pr) + ' fixed it before the watch saw it' + (r.fixedAt ? ', ' + when(r.fixedAt) : '') + '.' : 'A change on main fixed it before the watch saw it.')
      : (pr && pr.number ? 'Fixed in ' + prLink(pr) + '. ' : 'No pull request named. ') + 'Closed ' + when(r.closedAt) + '.'
  }[way.tab]();
  const keys = (r.keys || []).slice(0, 3).map((k) => '<code>' + esc(k) + '</code>').join('<br>') + ((r.keys || []).length > 3 ? '<br><small class="muted">and ' + num(r.keys.length - 3) + ' more</small>' : '');
  const seen = [r.people ? num(r.people) + (Number(r.people) === 1 ? ' person' : ' people') : '', 'First seen ' + when(r.firstAt), esc(stepWords(ISSUE_STEPS, way.at))].filter(Boolean).join(' · ');
  // Next: the pull request when there is one, else what Claude says fixes it, else what the page knows.
  // With no pull request and a plan to prove the cause: what Claude does next, and when.
  const next = pr && pr.number ? solution : (way.part ? '<p class="inext">' + partSaid() + '</p>' : '') + (planGoing(record) ? planLine(record.plan) + (r.solution ? '<small class="muted">' + esc(r.solution) + '</small>' : '')
    : way.tab === 'you' ? solution + (r.solution ? '<small class="muted">' + esc(r.solution) + '</small>' : '') : r.solution ? esc(r.solution) : solution);
  const pics = fixPictures(record, r.issue, !!fixFor(record, way.pr), r.issue && diagrams ? diagrams[r.issue] : null);
  const fix = fixLine(fixFor(record, way.pr), way);
  const kv = (label, html) => html ? '<div><h5 class="imh">' + esc(label) + '</h5>' + html + '</div>' : '';
  return issueCard({
    card: r.issue || 'keys:' + ((r.keys || [])[0] || ''), tab: way.tab, claude: way.claude, hidden: !onTab(way, tab),
    tags: (r.issue ? (safeLink(r.issueUrl) ? outLink(r.issueUrl, esc(r.issue), 'lin') : '<b>' + esc(r.issue) + '</b>') : '') + (source ? '<span class="tag">' + esc(source) + '</span>' : '') + claimTag(r.issue),
    title: r.title || (r.keys || [])[0] || 'A problem with no name',
    meta: seen,
    pill: [way.pill, way.level],
    short: {
      lines: [
        ['Wrong', r.problem ? '<p>' + esc(r.problem) + '</p>' : keys],
        ['Known', r.known ? '<p>' + esc(r.known) + '</p>' : ''],
        ['Next', next]
      ],
      bar: claimButton(r.issue, !!r.closedAt) + (way.tab === 'you' && pr && pr.number ? outLink(safeLink(pr.url) || PR_URL + pr.number, 'Review pull request ' + esc(pr.number), 'button dark') : '') +
        (way.tab === 'claude' && pr && pr.number ? outLink(safeLink(pr.url) || PR_URL + pr.number, 'Open pull request ' + esc(pr.number), 'button') : '') +
        (r.issue && safeLink(r.issueUrl) ? outLink(r.issueUrl, 'Open ' + esc(r.issue) + ' in Linear', 'button') : ''),
      more: (pics ? '<div class="ipics">' + pics + '</div>' : '') + '<div class="iprog">' + stepsHtml(ISSUE_STEPS, way.at) + '</div>' +
        kv('What happened', r.context ? '<p>' + esc(r.context) + '</p>' : '') +
        kv('Records', (r.issue && r.state ? '<p>' + esc(r.state) + ' in Linear</p>' : '') + '<p>' + keys + '</p>') +
        kv('What Claude did', fix)
    },
    talk: issueTalk(r, notes),
    record: issueRecord(r.issue, r.firstAt ? { at: r.firstAt, who: 'The watch', said: 'found the problem' } : null, [way.pill, way.level])
  });
}
/** An issue's steps on its card (pageSteps.ts): what the watch and Claude did, who did what on the card, and Claude's answers. */
function issueRecord(issue, found, turn) {
  if (!issue) return '';
  const ud = userIssuesData();
  const talks = ud && ud.notes ? ud.notes[issue] : [];
  return timelineHtml(issueTimeline(ud && ud.steps ? ud.steps[issue] : [], cardRecord(ud ? ud.records : [], issue, SENDS, 'issue:' + issue, found), issue, talks), turn);
}
/**
 * The talk on a user issue's card: each instruction an admin sent with Claude's answer under it, then,
 * while the issue is open, the box to send one. Nothing before the database keeps instructions.
 * at names the box's place, so the same issue's box on a line's card (pageCards.ts) has its own id.
 */
function issueTalk(r, notes, at) {
  if (!r.issue || !notes) return '';
  const list = notes[r.issue] || [];
  // A message sent from this page that the server does not hold yet (pageSends.ts notesWithSends): sending, or refused.
  const talk = list.map((n) => {
    if (n.local && n.state === 'sending') return '<p class="said you sending">' + esc(n.text) + '</p><small class="you sending">Sending…</small>';
    if (n.local && n.state === 'refused') return '<p class="said you refused">' + esc(n.text) + '</p><small class="you">Not sent</small>' +
      '<div class="said claude refused" role="alert"><p>' + esc('Not sent: ' + n.error + ' Your words are back in the box. Send them again.') + '</p></div><small></small>';
    const where = n.pr ? ' · ' + outLink(PR_URL + n.pr, 'PR ' + esc(n.pr)) : n.state !== 'answered' && n.state !== 'waiting' && safeLink(n.runUrl) ? ' · ' + outLink(n.runUrl, 'The run') : '';
    const said = n.state === 'waiting' ? (n.local ? 'Sent. ' : '') + (startedFor('issue:' + r.issue, n) ? STARTS_SAID : 'Claude reads it at the next run of the watch, ' + watchSaid() + '.') : noteSaid(n);
    const ud = userIssuesData(), by = n.local ? 'You' : saidBy(ud && ud.records, 'user_issue_note', n.text);
    // The steps Claude took on it (pageSteps.ts), from the instruction to the answer.
    const steps = n.local ? [] : stepsBetween(ud && ud.steps ? ud.steps[r.issue] : [], r.issue, n.at, n.answeredAt);
    return '<p class="said you">' + esc(n.text) + '</p><small class="you">' + esc(by) + ' · ' + when(n.at) + '</small>' + (steps.length ? tlineHtml(steps) : '') +
      '<div class="said claude">' + saidHtml(said) + '</div><small>Claude' + (n.answeredAt ? ' · ' + when(n.answeredAt) : '') + where + '</small>';
  }).join('');
  const id = esc(r.issue), busy = list.some((n) => n.local && n.state === 'sending');
  return (talk ? '<div class="talk">' + talk + '</div>' : '') +
    (r.closedAt ? '' : '<div class="tell"><textarea id="uin-' + (at ? esc(at) + '-' : '') + id + '" maxlength="2000" rows="3" aria-label="What Claude must do"' + (busy ? ' readonly' : '') + ' placeholder="' + (list.length ? 'Send another instruction…' : 'Tell Claude what to do…') + '"></textarea>' +
      '<small>' + (startsNow() ? 'Claude starts on it when you send it.' : 'Claude reads it at the next run of the watch, ' + watchSaid() + '.') + '</small><button type="button" class="primary" data-uinote="' + id + '"' + (busy ? ' disabled aria-busy="true">Sending…' : '>Send to Claude') + '</button></div>');
}
/** A place in the code as a link to that file on main, at its line. */
function placeLink(place) {
  const m = /^([A-Za-z0-9_@.()[\]\/-]+?)(?::([0-9]+))?$/.exec(String(place));
  return m ? outLink('https://github.com/genesis-ai-dev/langquest-next/blob/main/' + m[1].split('/').map(encodeURIComponent).join('/') + (m[2] ? '#L' + m[2] : ''), '<code>' + esc(place) + '</code>') : '<code>' + esc(place) + '</code>';
}
/** The research team has its own page (pageResearch.ts): a line under the cards says so. */
const researchPointer = () => '<p class="iresearch muted">What the research team found, also the same mistake in other places, is on <a href="#g/research">Research</a>.</p>';
function userIssuesHtml(raw) {
  const d = { ...raw, notes: notesWithSends(raw.notes, SENDS) };
  const prs = fixData && fixData.state === 'ok' && fixData.data ? fixData.data.prs : null;
  const rows = (d.issues || []).map((r) => ({ r, way: issueWay(r, prs, r.issue && d.notes ? d.notes[r.issue] : null, r.issue && d.fixes ? d.fixes[r.issue] : null) }));
  const t = issueTabs(rows.map((x) => x.way), issueTab);
  const stats = '<div class="stats">' + stat(num(d.open), 'open in Linear', d.open ? 'warn' : '', NOW) + stat(num(d.closed), 'closed in Linear', '', '90 days') +
    stat(num(d.fixed), 'already fixed when seen', '', '90 days') + stat(num(d.noiseWeek), 'judged noise', '', LAST_WEEK) +
    stat(d.last ? when(d.last.at) : 'never', 'last look', d.last && d.last.outcome !== 'ok' ? 'bad' : '', d.last ? d.last.outcome : '') + '</div>';
  if (!rows.length) return stats + '<p class="muted">No issues in the last 90 days.</p>' + researchPointer();
  return stats + '<div class="issues"><div class="itabs" role="group" aria-label="Issues by state">' +
    ISSUE_TABS.filter((x) => x[0] !== 'open' || t.count.open).map((x) =>
      '<button type="button" data-itab="' + x[0] + '" aria-pressed="' + (x[0] === t.tab) + '">' + esc(x[1]) + '<span class="count">' + num(t.count[x[0]]) + '</span></button>').join('') + '</div>' +
    '<div class="icards">' + rows.map((x) => userIssueCard(x.r, x.way, t.tab, d.notes, d.fixes, d.diagrams)).join('') + '</div></div>' + researchPointer();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-itab]');
  const box = b && b.closest('.issues');
  if (!box) return;
  issueTab = b.dataset.itab;
  for (const x of box.querySelectorAll('[data-itab]')) x.setAttribute('aria-pressed', String(x === b));
  for (const c of box.querySelectorAll('.icard[data-tab]')) c.hidden = !onTab({ tab: c.dataset.tab, claude: c.dataset.claude }, issueTab);
});
// Copy on a block of code in Claude's answer: the command, as Claude wrote it.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-copy-code]');
  const code = b && b.parentElement.querySelector('code');
  if (!code || !navigator.clipboard) return;
  navigator.clipboard.writeText(code.textContent).then(() => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); }, () => say('The code was not copied. Select it and copy it.', 'red'));
});
// "Tell Claude what to do" on a user issue: an instruction for the watch's next run.
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-uinote]');
  if (!b) return;
  // The box next to the button: the same issue can have a box on its line's card too.
  const box = (b.closest('.tell') || document).querySelector('textarea');
  const text = String((box || {}).value || '').trim();
  if (!text) { say('Write what Claude must do first.', 'red'); sayAt(b, 'Write what Claude must do first.', 'red'); return; }
  perform({ kind: 'user-issue-note', issue: b.dataset.uinote, text: text.slice(0, 2000) }, b, { talk: { key: 'issue:' + b.dataset.uinote, text: text.slice(0, 2000), box: box && box.id } });
});

// ---- a question about a tutorial video (sources/videos.ts AdminItem), in the same card ----
const ADMIN_KIND = { approve: 'Suggestion', appFix: 'App fix', fixFailed: 'Change failed', fixed: 'Fixed', held: 'Film held', fails: 'Film fails', reply: 'Reply to post', comment: 'New comment', screen: 'Screen changed', publish: 'Publish', connect: 'Channel', empty: 'No videos', paused: 'Paused' };
/** Where each kind of card comes from. */
const ADMIN_FROM = { approve: 'Claude\'s look at 10:00 UTC', appFix: 'You said Fix it', fixFailed: 'Claude\'s fix run', fixed: 'Claude\'s fix run', held: 'The frame check on the new film', fails: 'The nightly filming', reply: 'A comment on YouTube', comment: 'A comment on YouTube', screen: 'A change merged into main' };
/** What the start of each kind of card did, in the card's record after its source (ADMIN_FROM). */
const ADMIN_FOUND = { fixFailed: 'could not make the change', held: 'held it back', fails: 'could not film the video', reply: 'came in', comment: 'came in', screen: 'changed a screen in the video' };
const inputSaid = (i) => '<li><small>' + esc(i.kind === 'comment' ? 'Comment' : i.kind === 'code' ? 'Code change' : 'Note') + ' · ' + when(i.at) + '</small><br>' + esc(i.english || i.text) + '</li>';
/** The admin's words, then where Claude is with them: the state of its change, its note, and its pull request or run. */
function talkHtml(ins, send) {
  // A message sent from this card that the server does not hold yet: sending, or refused with the reason.
  if (send && send.state === 'sending') return '<div class="talk"><p class="said you sending">' + esc(send.text) + '</p><small class="you sending">Sending…</small></div>';
  if (send && send.state === 'refused') return '<div class="talk"><p class="said you refused">' + esc(send.text) + '</p><small class="you">Not sent</small>' +
    '<div class="said claude refused" role="alert"><p>' + esc('Not sent: ' + send.error + ' Your words are back in the box. Send them again.') + '</p></div></div>';
  if (!ins) return '';
  const fix = ins.fix;
  const answer = fix ? FIX_STATE[fix.state] || fix.state
    : ins.looked ? (send ? 'Sent. ' : '') + 'Claude starts the change at its next fix run, ' + fixRunSaid() + ', as a pull request that merges itself when its checks pass.' : 'Claude reads it at its next run.';
  const where = fix && fix.pr ? ' · ' + outLink(PR_URL + fix.pr, 'PR ' + esc(fix.pr)) : fix && safeLink(fix.run) ? ' · ' + outLink(fix.run, 'The run') : '';
  const by = send ? 'You' : saidBy(VIDEOS && VIDEOS.records, 'tutorial_note', ins.text);
  return '<div class="talk"><p class="said you">' + esc(ins.text) + '</p><small class="you">' + esc(by) + ' · ' + when(ins.at) + '</small>' +
    '<div class="said claude">' + saidHtml(answer + (fix && fix.note ? '\n\n' + fix.note : '')) + '</div><small>Claude' + (fix && fix.at ? ' · ' + when(fix.at) : '') + where + '</small></div>';
}
/** Fix it, and the box beside it: "Ask me before it merges" holds the fix for the admin's yes. */
function fixItButton(id, label, primary) {
  return '<span class="vfixapp"><button type="button"' + (primary ? ' class="primary"' : '') + ' data-fixapp="' + esc(id) + '">' + esc(label) + '</button>' +
    '<label class="vask"><input type="checkbox" data-askfirst="' + esc(id) + '"> Ask me before it merges</label></span>';
}
function suggestionSide(s, fixApp) {
  // A change in the app: Fix it (the agent team writes it, and it merges on the rules), or only an issue in Linear for a person.
  return '<p class="ibtns">' + (fixApp ? fixItButton(s.id, 'Fix it', true) +
      '<button type="button" data-sg="' + esc(s.id) + '" data-decision="accept" data-kind="' + esc(s.kind) + '">Only file in Linear</button>'
      : '<button type="button" class="primary" data-sg="' + esc(s.id) + '" data-decision="accept" data-kind="' + esc(s.kind) + '">Accept</button>') +
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
/**
 * A fix in the app (Fix it): what the agent team changed, the screen before and after when it kept them, its newest
 * answer, why it waits on the admin when it does, then Merge (the instruction "merge it" on its issue, as on a user
 * issue's card) only then, and the box to tell it more ("ask me first", "change the word to ..."). The chain itself
 * is in the card's steps and record.
 */
function appSide(a) {
  const x = a.app, issue = x.issue ? esc(x.issue) : '';
  const pics = !issue ? '' : x.after ? '<div class="ifixpics">' + [['before', 'Before the fix'], ['after', 'After the fix']].map((w) =>
      '<figure><figcaption>' + w[1] + '</figcaption><img alt="The screen ' + w[0] + ' the fix" data-fixpic="' + issue + '" data-what="' + w[0] + '"></figure>').join('') + '</div>'
    : x.before ? '<figure><figcaption>The problem on the screen</figcaption><img alt="The screen where the problem shows" data-fixpic="' + issue + '" data-what="before"></figure>' : '';
  const answer = x.answer ? '<div class="said claude">' + saidHtml(x.answer) + '</div><small>Claude\'s agent team</small>' : '';
  const see = x.pr ? '<a class="button" href="' + esc(PR_URL + x.pr) + '/files" target="_blank" rel="noopener noreferrer">See the change</a>' : '';
  const merge = x.stage === 'yours' && issue ? '<p class="ibtns"><button type="button" class="primary" data-appmerge="' + issue + '">Merge</button>' + see + '</p>' : see ? '<p class="ibtns">' + see + '</p>' : '';
  const ask = x.askFirst && x.stage !== 'yours' && x.stage !== 'merged' && x.stage !== 'filming' && x.stage !== 'filmed' ? '<small>You asked to see the change before it merges.</small>' : '';
  const tell = !issue || x.stage === 'filmed' ? '' : '<div class="tell"><textarea maxlength="2000" rows="3" aria-label="What Claude must do" placeholder="' +
      (x.stage === 'yours' ? 'Tell Claude what to change first…' : 'Tell Claude more, or say: ask me first…') + '"></textarea>' +
    '<small>Claude\'s agent team reads it at its next run (every 15 minutes).</small><button type="button"' + (x.stage === 'yours' ? '' : ' class="primary"') + ' data-uinote="' + issue + '">Send to Claude</button></div>';
  return pics + answer + ask + merge + (x.stage === 'yours' && tell ? '<details><summary>Tell Claude what to change first</summary>' + tell + '</details>' : tell);
}
/** "Fix it in the app", for a change to the video that failed because its cause is in the app. */
function fixAppButton(a) {
  return a.kind === 'fixFailed' && a.fixApp ? fixItButton(a.fixApp, 'Fix it in the app', false) : '';
}
/**
 * Where to watch the film a card is about (sources/videos.ts Watch): one row for each film, its name, then a link for
 * each time the card is about (the frame check's wrong stills), or one from the start. Each opens in a new tab.
 */
function watchHtml(w) {
  if (!Array.isArray(w) || !w.length) return '';
  const ok = (h) => /^(\/api\/tutorials\/|https:\/\/youtu\.be\/)/.test(String(h || ''));
  const rows = w.map((x) => {
    const links = (x.links || []).filter((l) => ok(l.href));
    return links.length ? '<li><span class="vwname">' + vicon(x.film === 'youtube' ? 'up' : 'film') + esc(x.label) + '</span>' +
      '<span class="vwlinks">' + links.map((l) => '<a class="vwat" href="' + esc(l.href) + '" target="_blank" rel="noopener noreferrer">' + esc(l.text) + '</a>').join('') + '</span></li>' : '';
  }).join('');
  return rows ? '<ul class="vwatch">' + rows + '</ul>' : '';
}
/** Whose turn it is on a video's card: the admin's, Claude's, or nobody's (a change that failed, which a pull request of its own fixed). */
const cardPill = (a) => a.who === 'you' ? ['Waits on you', 'you'] : a.who === 'done' ? ['Done', 'done'] : ['Claude acts next', 'claude'];
/** One thing for an admin: what it is and where it came from, who acts next, the talk so far, and where it applies, the box to tell Claude what to do. */
function adminCard(a) {
  const ins = a.instructed, id = esc(cardId(a));
  const [plain, technical] = detailParts(a.detail);
  const inputs = a.suggestion && a.suggestion.inputs.length ? '<ul>' + a.suggestion.inputs.map(inputSaid).join('') + '</ul>' : '';
  const from = ADMIN_FROM[a.kind] ? esc(ADMIN_FROM[a.kind]) + (a.at ? ' · ' + when(a.at) : '') : '';
  const retry = retryButton(a);
  const busy = a.send && a.send.state === 'sending';
  const tell = a.instruct ? '<div class="tell"><textarea id="ins-' + id + '" maxlength="2000" rows="3" aria-label="What Claude must do"' + (busy ? ' readonly' : '') + ' placeholder="' + (ins ? 'Send another instruction…' : 'Tell Claude what to do…') + '"></textarea>' +
    '<small>Claude starts at its next fix run, ' + fixRunSaid() + '.</small><button type="button"' + (retry ? '' : ' class="primary"') + ' data-instruct="' + id + '"' + (busy ? ' disabled aria-busy="true">Sending…' : '>Send to Claude') + '</button></div>' : '';
  return issueCard({
    pics: pictureStrip(a.pictures),
    tags: '<span class="tag ' + (ADMIN_LEVEL[a.kind] === 'bad' || ADMIN_LEVEL[a.kind] === 'good' ? ADMIN_LEVEL[a.kind] : '') + '">' + esc(ADMIN_KIND[a.kind] || a.kind) + '</span>' +
      (a.tutorial && a.language ? '<span>' + esc(languageName(a.language)) + '</span>' : '') + (a.suggestion ? '<span>' + esc(SUGGESTION_KINDS[a.suggestion.kind] || a.suggestion.kind) + '</span>' : ''),
    title: a.title,
    cls: a.reply ? 'reply' : '',
    // A reply to post: the viewer's comment, then the reply and its two steps at the right.
    lines: a.reply ? [['Comment', commentSaid(a)]] : [
      ['Context', from + inputs],
      ['Issue', (plain ? '<p class="setup">' + esc(plain) + '</p>' : '') + (technical ? '<details class="vtech"><summary>Technical details for the fix</summary><p class="setup">' + esc(technical) + '</p></details>' : '')],
      ['Watch', watchHtml(a.watch)],
      [ins ? '' : 'Solution', ins ? '' : esc(a.next)]
    ],
    pill: cardPill(a),
    steps: a.app ? appSteps(a) : [VIDEO_STEPS, videoWay(a).at],
    record: a.tutorial && a.language ? recordHtml(cardRecord(VIDEOS && VIDEOS.records, a.tutorial + '/' + a.language, SENDS, 'video:' + cardId(a),
      a.at && ADMIN_FOUND[a.kind] ? { at: a.at, who: ADMIN_FROM[a.kind], said: ADMIN_FOUND[a.kind] } : null), cardPill(a)) : '',
    side: a.reply ? replyBox(a) : a.app ? appSide(a) : (a.suggestion ? suggestionSide(a.suggestion, a.fixApp) : '') + (a.filming ? filmingSwitch(a.filming.language, a.filming.on, a.filming.videos) : '') + talkHtml(ins, a.send) + (a.link ? cardLink(a).replace('<a ', '<a class="button" ') : '') +
      // A change Claude could not make: Try again is the main button, Fix it in the app beside it, and the box is behind "instead".
      retry + fixAppButton(a) + (retry && tell ? '<details><summary>Tell Claude what to do instead</summary>' + tell + '</details>' : tell)
  });
}
`;
