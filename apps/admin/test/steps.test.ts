import { describe, expect, it } from 'vitest';
import { ISSUE_LOGIC, ISSUE_SCRIPT } from '../src/pageIssues';
import { SEND_LOGIC, SEND_SCRIPT } from '../src/pageSends';
import { STEPS_LOGIC } from '../src/pageSteps';

type Row = Record<string, unknown>;
interface Entry { at: string; who: string; said: string; sub: string; pr: number | null; run: string | null; look: string; person?: boolean }
const esc = `const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');`;
const logic = new Function(`${esc} const recordSaid = (r) => ({ who: r.who, said: r.what, words: r.words || '', bad: r.result !== 'ok' });
  ${STEPS_LOGIC}; return { readsSaid, stepSaid, issueTimeline, stepsBetween };`)() as {
  readsSaid: (r: Row | null) => string;
  stepSaid: (s: Row, issue: string) => Entry;
  issueTimeline: (steps: Row[], record: Row[], issue: string, talks?: Row[]) => Entry[];
  stepsBetween: (steps: Row[], issue: string, from: string, to: string | null) => Entry[];
};

/** The drawing code with the page's helpers as plain stand-ins (as in issues.test.ts). */
const draw = new Function(`
  ${esc}
  const when = (iso) => iso ? 'then' : 'never', num = String, stat = () => '', NOW = '', LAST_WEEK = '';
  const safeLink = (l) => String(l || '').startsWith('https://') ? l : '';
  const PR_URL = 'https://github.com/o/r/pull/', prLink = (p) => 'PR ' + p.number;
  const pictureStrip = () => '', detailParts = (t) => String(t || '').split('|'), cardId = (a) => a.kind, languageName = (c) => c;
  const cardLink = () => '', vicon = () => '', FIX_STATE = {}, ADMIN_LEVEL = {}, SUGGESTION_KINDS = {};
  const document = { addEventListener() {}, getElementById() { return null; } };
  let VIDEOS = null, results = {}, udata = null, fixData = null;
  const userIssuesData = () => udata;
  const claimTag = () => '', claimButton = () => '', closeButton = () => '';
  ${SEND_LOGIC}
  ${SEND_SCRIPT}
  ${ISSUE_LOGIC}
  ${ISSUE_SCRIPT}
  return { userIssuesHtml, data: (d) => { udata = d; } };
`)() as { userIssuesHtml: (d: Row) => string; data: (d: Row | null) => void };

const RUN = 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/1';
const step = (kind: string, at: string, detail: Row = {}, pr: number | null = null): Row => ({ at, kind, detail, pr, run: RUN });
/** An issue Claude's agent team took up alone: found, tried with reads of the diagnostics and the logs, a plan, a fix, a merge, closed. */
const alone = [
  step('filed', '2026-11-20T10:00:00Z', { family: 'transfer' }),
  step('handed', '2026-11-20T10:05:00Z'),
  step('plan', '2026-11-20T10:30:00Z', { next: 'Read the downloads of the 3 phones that hit it.', reads: { diag: 2, db: 0, logs: ['worker-logs'] } }),
  step('handed', '2026-11-20T12:30:00Z', { reads: { diag: 2, db: 0, logs: ['worker-logs'] } }),
  step('fix', '2026-11-20T13:00:00Z', { decision: 'merge', verdict: 'fix', model: 'opus', effort: 'high', cause: 'The retry dropped the language id.', reviewed: true }, 700),
  step('merged', '2026-11-20T14:00:00Z', {}, 700),
  step('closed', '2026-11-21T09:00:00Z', { state: 'Done' })
];

describe('the steps on a user issue (docs/decisions/2026-11-24-each-issue-card-shows-its-steps.md)', () => {
  it('names the reads of each try: the field diagnostics, the production database and the logs', () => {
    expect(logic.readsSaid({ diag: 2, db: 1, logs: ['worker-logs', 'supabase-logs'] }))
      .toBe('the field diagnostics (2 queries), the production database (1 query), the Cloudflare Worker logs and the Supabase logs');
    expect(logic.readsSaid({ diag: 0, db: 0, logs: [] })).toBe('');
    expect(logic.readsSaid(null)).toBe('');
  });

  it('shows the work Claude started alone, from the find to the close, the oldest first', () => {
    const t = logic.issueTimeline(alone, [{ at: '2026-11-20T10:00:00Z', who: 'The watch', what: 'found', said: 'found the problem' }], 'LAN-9');
    expect(t.map((e) => [e.who, e.said])).toEqual([
      ['The watch', 'found the problem and filed it in Linear as LAN-9'],
      ['Claude', 'started a try to prove the cause and fix it'],
      ['Claude', 'made a plan: Read the downloads of the 3 phones that hit it'],
      ['Claude', 'started a try to prove the cause and fix it'],
      ['Claude', 'wrote the fix. It keeps the rules, so it merges by itself when its checks pass'],
      ['A second Claude', 'checked the work as the reviewer'],
      ['', 'Pull request 700 merged. It fixes LAN-9.'],
      ['', 'LAN-9 closed in Linear as Done.']
    ]);
    expect(t[2]!.sub).toBe('The next try reads the field diagnostics (2 queries) and the Cloudflare Worker logs.');
    expect(t[3]!.sub).toBe('Before it starts, it reads the field diagnostics (2 queries) and the Cloudflare Worker logs.');
    expect(t[4]!.sub).toBe('Cause: The retry dropped the language id. Issue manager: Opus, high effort.');
    expect(t[4]!.look).toBe('done');
    expect(t.every((e) => e.run === RUN || e.who === '')).toBe(true);
  });

  it('keeps the watch\'s find when no step says it filed the issue, and an admin\'s tap as a person\'s step', () => {
    const t = logic.issueTimeline([alone[1]!], [
      { at: '2026-11-19T10:00:00Z', who: 'The watch', what: 'found', said: 'found the problem' },
      { at: '2026-11-20T11:00:00Z', who: 'Dana', what: 'issue_claim', result: 'ok' }
    ], 'LAN-9');
    expect(t.map((e) => e.who)).toEqual(['The watch', 'Claude', 'Dana']);
    expect(t[2]!.person).toBe(true);
  });

  it('says a close once: Linear\'s state is left out when the issue closed in it', () => {
    const t = logic.issueTimeline([step('state', '2026-11-21T09:00:00Z', { state: 'Done' }), step('closed', '2026-11-21T09:01:00Z', { state: 'Done' }),
      step('state', '2026-11-20T09:00:00Z', { state: 'Deploying' })], [], 'LAN-9');
    expect(t.map((e) => e.said)).toEqual(['LAN-9 is Deploying in Linear.', 'LAN-9 closed in Linear as Done.']);
  });

  it('puts under an instruction only the steps from it to the answer', () => {
    const steps = [step('taken', '2026-11-24T18:13:30Z'), step('fix', '2026-11-24T18:19:00Z', { decision: 'none', verdict: 'not_a_bug', reviewed: true }),
      step('state', '2026-11-24T18:20:00Z', { state: 'Canceled' }), step('grew', '2026-11-24T18:20:00Z', { people: 3 }), step('plan', '2026-11-24T19:00:00Z', { next: 'Later.' })];
    const t = logic.stepsBetween(steps, 'LAN-256', '2026-11-24T18:13:00Z', '2026-11-24T18:21:00Z');
    expect(t.map((e) => e.said)).toEqual(['started on the instruction', 'found that it is not a bug', 'checked the work as the reviewer', 'LAN-256 is Canceled in Linear.']);
    expect(logic.stepsBetween(steps, 'LAN-256', '2026-11-24T18:13:00Z', null)).toHaveLength(5);
  });

  it('draws the steps on the card, and the steps of an instruction under it', () => {
    const issue: Row = { issue: 'LAN-9', issueUrl: 'https://linear.app/t/issue/LAN-9', title: 'A thing fails', verdict: 'filed', state: 'Todo', closedAt: null,
      fixedBy: null, fixedAt: null, keys: ['transfer:down:x'], people: 2, firstAt: '2026-11-20T10:00:00Z', lookedAt: '2026-11-21T00:00:00Z' };
    const notes = { 'LAN-9': [{ at: '2026-11-20T12:00:00Z', text: 'Find the cause.', state: 'answered', answeredAt: '2026-11-20T13:30:00Z', result: 'changed', answer: 'I found it.', pr: 700 }] };
    draw.data({ notes, steps: { 'LAN-9': [...alone].reverse() }, records: [] });
    const card = draw.userIssuesHtml({ issues: [issue], open: 1, closed: 0, fixed: 0, noiseWeek: 0, last: null, notes });
    const steps = card.slice(card.indexOf('class="isteps"'));
    expect(steps).toContain('<span class="rh">Steps</span>');
    expect(steps).not.toContain('earlier steps');
    expect(steps).toContain('found the problem and filed it in Linear as LAN-9');
    expect(steps).toContain('closed in Linear as Done');
    expect(steps).toContain('href="' + RUN + '"');
    // The steps of the run on the instruction show under it, and not again in the card's steps.
    const talk = card.slice(card.indexOf('Find the cause.'), card.indexOf('I found it.'));
    expect(talk).toContain('class="tline"');
    expect(talk).toContain('started a try to prove the cause and fix it');
    expect(talk).toContain('<b>A second Claude</b> checked the work as the reviewer.');
    expect(talk).not.toContain('found the problem');
    expect(steps).not.toContain('checked the work as the reviewer');
    draw.data(null);
  });

  it('shows up to 10 steps, and with more the newest 8 and the rest behind one tap', () => {
    const many = Array.from({ length: 12 }, (_, i) => step('grew', new Date(Date.parse('2026-11-01T00:00:00Z') + i * 86400000).toISOString(), { people: i + 1 }));
    draw.data({ steps: { 'LAN-9': many }, records: [] });
    const issue: Row = { issue: 'LAN-9', issueUrl: 'https://linear.app/t/issue/LAN-9', title: 'A thing fails', verdict: 'filed', state: 'Todo', closedAt: null,
      fixedBy: null, fixedAt: null, keys: ['transfer:down:x'], people: 2, firstAt: '2026-11-01T00:00:00Z', lookedAt: '2026-11-21T00:00:00Z' };
    const card = draw.userIssuesHtml({ issues: [issue], open: 1, closed: 0, fixed: 0, noiseWeek: 0, last: null });
    expect(card).toContain('<summary>Show 5 earlier steps</summary>');
    draw.data(null);
  });
});
