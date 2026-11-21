/**
 * The picture at the top of "The web app and automatic jobs" (part `code`,
 * Releases): whether app.langquest.org runs the newest merge, said in one
 * sentence under the two pull requests' titles, and a list of the
 * repository's automatic jobs (its GitHub workflows), the last run of each,
 * by a plain name with what the job does. Phone updates and store builds are
 * the part above it ("Where each build and update is"), and the page says so,
 * because "deploys" reads as store releases. Before 2026-11-21 this was two
 * dots named "main" and "web host" over commit ids, and a square for each
 * workflow named only under the pointer.
 */
import { DEPLOY_GRACE_H } from './sources/github';

/** Pure helpers, no page state: apps/admin/test/code.test.ts runs them with new Function. */
export const CODE_LOGIC = String.raw`
/** Each workflow file's plain name and what it does; one this list does not know keeps its GitHub name. */
const JOB_SAID = {
  'guardrails.yml': ['Checks on main', 'Tests each merge, and runs the nightly web tests'],
  'tutorials.yml': ['Tutorial videos', 'Films the tutorial videos each night'],
  'tutorial-review.yml': ['Tutorial video review', 'Reads video comments and changes each night'],
  'user-issues.yml': ['User issue watch', 'Looks for new problems every 15 minutes'],
  'phone-tests.yml': ['Nightly phone tests', 'Tests the app on an Android and an iPhone each night'],
  'release-branches.yml': ['Fixes to older store builds', 'Copies fixes to the builds in the stores'],
  'release-copy-conflict.yml': ['Copy conflicts', 'Asks for help when a fix does not copy'],
  'linear-sync.yml': ['Linear links', 'Moves the Linear issues that a merge names'],
  'bible-survey.yml': ['Bible numbering survey', 'Checks the Bible numbering survey']
};
const JOB_ORDER = ['fail', 'part', 'run', 'ok', 'off'];
const JOB_RESULT = { fail: 'Failed', part: 'Failed', run: 'Running', ok: 'Passed', off: 'Cancelled or skipped' };
const DEPLOY_GRACE_MS = ${DEPLOY_GRACE_H} * 3600000;

/** A run's state: failed, failed where Nightly tests says why (part), running, passed, or cancelled or skipped. */
function jobState(r) {
  if (r.status !== 'completed') return 'run';
  if (r.conclusion === 'success') return 'ok';
  if (r.conclusion === 'failure' || r.conclusion === 'timed_out') return r.nightly ? 'part' : 'fail';
  return 'off';
}

/**
 * What the part says: the web app (the newest merge, what the host runs, and
 * one sentence with a state) and each job, worst first, with a count of each state.
 */
function codeView(d, now) {
  d = d || {};
  now = now || Date.now();
  const main = d.main || {}, live = d.live || {};
  let host = String(live.url || '');
  try { host = new URL(host).host; } catch {}
  const same = !!live.build && String(main.sha || '').startsWith(live.build);
  const fresh = main.at ? now - Date.parse(main.at) <= DEPLOY_GRACE_MS : false;
  let s, text;
  if (!live.build) { s = 'fail'; text = host + ' did not answer' + (live.error ? ' (' + live.error + ')' : '') + '.'; }
  else if (same || d.behind === 0) { s = 'ok'; text = 'Up to date. ' + host + ' runs the newest merge.'; }
  else if (d.appChanged === false) { s = 'ok'; text = 'Up to date. The newer merges do not change the web app.'; }
  else if (fresh) { s = 'run'; text = 'Deploying. The newest merge gets to ' + host + ' in a few minutes.'; }
  else if (d.appChanged === null) { s = 'fail'; text = 'Maybe behind. ' + host + ' does not run the newest merge, and the page cannot see if the newer merges change the web app.'; }
  else { s = 'fail'; text = 'Behind. Newer merges change the web app, but ' + host + ' does not run them. The deploy failed: look at Workers Builds.'; }
  const repo = d.repo ? 'https://github.com/' + d.repo + '/commit/' : null;
  const newest = { title: main.title || String(main.sha || '').slice(0, 8), pr: main.pr || null, at: main.at || null, link: repo && main.sha ? repo + main.sha : null };
  const runs = same || !live.build ? newest
    : { title: live.title || String(live.build).slice(0, 8), pr: live.pr || null, at: live.at || null, link: repo ? repo + live.build : null };
  const needs = d.needsYou || [];
  const jobs = (d.runs || []).map((r) => {
    const said = JOB_SAID[String(r.path || '').replace('.github/workflows/', '')];
    const st = jobState(r);
    const need = needs.find((n) => n.workflow === r.workflow);
    return { s: st, name: said ? said[0] : r.workflow, does: said ? said[1] : '', result: JOB_RESULT[st], at: r.at || null, link: r.url || null,
      note: need ? 'Needs you: ' + need.what + '.' : st === 'part' ? 'Nightly tests says which tests failed, and why.' : '' };
  }).sort((a, b) => JOB_ORDER.indexOf(a.s) - JOB_ORDER.indexOf(b.s));
  const counts = Object.fromEntries(JOB_ORDER.map((k) => [k, jobs.filter((j) => j.s === k).length]));
  return { host, web: { s, text, newest, runs, same: runs === newest }, jobs, counts };
}
`;

/** Drawing the part: the web app's two boxes and its sentence, then the list of jobs; on a card, the sentence and the jobs that need a look. */
export const CODE_SCRIPT = String.raw`
const CODE_MARK = { fail: '✕', part: '●', run: '◌', ok: '✓', off: '–' };
const CODE_PILL = { fail: 'failed', part: 'see Nightly tests', run: 'running', ok: 'passed', off: 'cancelled or skipped' };
function codeCommit(label, c) {
  const title = c.link && c.link.startsWith('https://') ? '<a href="' + esc(c.link) + '" target="_blank" rel="noopener">' + esc(c.title) + '</a>' : esc(c.title);
  return '<div class="cdc"><small>' + esc(label) + '</small><b>' + title + '</b><small>' + (c.pr ? 'PR ' + esc(c.pr) + ' · ' : '') + (c.at ? when(c.at) : '') + '</small></div>';
}
function codeJob(j) {
  const name = j.link && j.link.startsWith('https://') ? '<a href="' + esc(j.link) + '" target="_blank" rel="noopener">' + esc(j.name) + '</a>' : esc(j.name);
  return '<li class="' + j.s + '"><i aria-hidden="true">' + CODE_MARK[j.s] + '</i><span>' + name + (j.note || j.does ? '<small>' + esc(j.note || j.does) + '</small>' : '') + '</span>' +
    '<em>' + esc(j.result) + (j.at ? ' ' + when(j.at) : '') + '</em></li>';
}
function codeBox(d, mini) {
  const v = codeView(d);
  const pills = JOB_ORDER.filter((k) => v.counts[k]).map((k) => '<span class="cdp ' + k + '">' + num(v.counts[k]) + ' ' + CODE_PILL[k] + '</span>').join('');
  const state = '<p class="cds ' + v.web.s + '">' + CODE_MARK[v.web.s] + ' ' + esc(v.web.text) + '</p>';
  const jobsHead = '<div class="ct"><span>Automatic jobs on GitHub, the last run of each</span><b>' + num(v.jobs.length) + (v.jobs.length === 1 ? ' job' : ' jobs') + pills + '</b></div>';
  if (mini) {
    // On a card: the sentence, and the jobs that need a look; the ones that passed are only counted.
    const look = v.jobs.filter((j) => j.s === 'fail' || j.s === 'part').slice(0, 4);
    return '<div class="chart codebox mini" data-part="code"><div class="ct"><span>The web app at ' + esc(v.host) + '</span></div>' + state +
      (look.length ? jobsHead + '<ul class="cdj">' + look.map(codeJob).join('') + '</ul>' : '') + '</div>';
  }
  return '<div class="codebox" data-part="code">' +
    '<p class="muted cdn">Phone updates and store builds are in "Where each build and update is", above.</p>' +
    '<div class="chart"><div class="ct"><span>The web app at ' + esc(v.host) + '</span></div>' +
    '<div class="cdf">' + codeCommit('Newest merge on GitHub', v.web.newest) + '<span class="cda" aria-hidden="true">→</span>' +
    codeCommit('What ' + v.host + ' runs now', v.web.runs) + '</div>' + state + '</div>' +
    (v.jobs.length ? '<div class="chart">' + jobsHead + '<ul class="cdj">' + v.jobs.map(codeJob).join('') + '</ul></div>' : '') + '</div>';
}
`;

export const CODE_CSS = String.raw`
.codebox .cdn { margin: 0 0 8px; } .codebox > .chart + .chart { margin-top: 10px; }
.codebox .ct { margin-bottom: 8px; flex-wrap: wrap; } .codebox .ct b { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 14px; }
.cdf { display: flex; align-items: stretch; gap: 8px; } .cda { align-self: center; color: var(--muted); font-size: 20px; }
.cdc { flex: 1; min-width: 0; background: var(--raised); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
.cdc small { display: block; color: var(--muted); font-size: 12px; } .cdc b { display: block; overflow-wrap: anywhere; }
.cds { margin: 10px 0 0; padding: 8px 10px; border-radius: 8px; font-weight: 600; }
.cds.ok { background: var(--greenbg); color: var(--green); } .cds.fail { background: var(--redbg); color: var(--red); } .cds.run { background: var(--soft); color: var(--primary); }
.cdp { font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 99px; background: var(--soft); color: var(--muted); }
.cdp.fail { background: var(--redbg); color: var(--red); } .cdp.part { background: var(--amberbg); color: var(--amber); } .cdp.ok { background: var(--greenbg); color: var(--green); } .cdp.run { color: var(--primary); }
.cdj { list-style: none; margin: 0; padding: 0; }
.cdj li { display: flex; gap: 10px; align-items: flex-start; min-height: 48px; padding: 6px 0; border-top: 1px solid var(--line); box-sizing: border-box; }
.cdj li > i { width: 18px; flex: none; font-style: normal; font-weight: 700; text-align: center; }
.cdj li > span { flex: 1; min-width: 0; } .cdj li small { display: block; color: var(--muted); font-size: 12.5px; }
.cdj li > em { font-style: normal; color: var(--muted); white-space: nowrap; font-size: 13px; }
.cdj li.fail > i { color: var(--red); } .cdj li.part > i { color: var(--amber); } .cdj li.run > i { color: var(--primary); } .cdj li.ok > i { color: var(--green); } .cdj li.off > i { color: var(--grey); }
.codebox.mini .cds { margin-bottom: 8px; }
@media (max-width: 640px) { .cdf { flex-direction: column; } .cda { transform: rotate(90deg); } .cdj li { flex-wrap: wrap; } .cdj li > em { flex-basis: 100%; padding-left: 28px; } }
`;
