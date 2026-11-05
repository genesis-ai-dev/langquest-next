import { describe, expect, it } from 'vitest';
import { handleUserIssues, USER_ISSUES_RULE, type UserIssuesDeps } from '../worker/userIssues';
import { handleApi, type ApiDeps } from '../worker/api';
import { evidenceAsked, KEY, LOOKED_MAX, LookedError, parseLooked, type Looked, type Media, type Phone, type Watch } from '../../../server/userIssues';
import type { JobRun } from '../../../server/jobRuns';

/** The watch for user issues (decisions.md 202): who gets in, and what it may send back. */

const NOW = Date.parse('2026-11-03T18:00:00Z');
const RUN = 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/123456';
const SHA = 'a'.repeat(40);

const looked = (over: Partial<Looked> & Record<string, unknown> = {}) => ({
  sha: SHA, runUrl: RUN,
  looked: [
    { key: 'error:TypeError@sign in:-', verdict: 'filed', issue: 'LAN-220', issueUrl: 'https://linear.app/frontierrandd/issue/LAN-220/x', people: 3, count: 9, note: null },
    { key: 'auth:sign_in:refused:invalid_credentials', verdict: 'noise', issue: null, issueUrl: null, people: 1, count: 2, note: 'One person typed a wrong password twice.' },
    { key: 'feedback:0d000000-0000-4000-8000-000000000001', verdict: 'known', issue: 'LAN-35', issueUrl: 'https://linear.app/frontierrandd/issue/LAN-35/y', people: 1, count: 1 }
  ],
  grew: [{ key: 'transfer:down:source:failOther', people: 6, count: 40 }],
  ...over
});

describe('a kind of problem', () => {
  it('is named by code-like tags under a family, never by free text', () => {
    for (const k of ['error:TypeError@sign in:-', 'sync:error:pull:57014:ServerError', 'transfer:down:source:failOther', 'job:projection:failing',
      'worker:blobs:5xx', 'feedback:0d000000-0000-4000-8000-000000000001', 'device:uploadWaitingOverADay', 'expected:sign in:AuthError:401']) {
      expect(KEY.test(k), k).toBe(true);
    }
    for (const k of ['error:', 'other:x', 'error:a\nb', `error:${'x'.repeat(291)}`, 'error:<script>', 'error:"quoted"']) expect(KEY.test(k), k).toBe(false);
  });
});

describe('what the workflow sends back', () => {
  it('takes new issues, known ones, noise and grown kinds', () => {
    const l = parseLooked(looked());
    expect(l.looked.map((x) => x.verdict)).toEqual(['filed', 'noise', 'known']);
    expect(l.looked[2]?.note).toBeNull();
    expect(l.grew).toEqual([{ key: 'transfer:down:source:failOther', people: 6, count: 40 }]);
    expect(parseLooked({ sha: SHA, runUrl: `${RUN}/attempts/2` })).toEqual({ sha: SHA, runUrl: `${RUN}/attempts/2`, looked: [], grew: [], states: [] });
  });

  it('takes a kind already fixed by a pull request, with or without the issue that closed, and issues that closed or opened again in Linear', () => {
    const fixed = { key: 'audio:playFail', verdict: 'fixed', issue: null, issueUrl: null, people: 0, count: 8, note: 'Fixed by PR 295.', title: 'Play all stops after a few parts', fixedBy: 295, fixedAt: '2026-10-30T22:50:22.000Z' };
    const closedKind = { ...fixed, key: 'transfer:down:source:failOther', issue: 'LAN-220', issueUrl: 'https://linear.app/frontierrandd/issue/LAN-220/x', people: 2, fixedBy: 312 };
    const states = [
      { issue: 'LAN-220', state: 'Live', closed: true, closedAt: '2026-11-03T21:00:00.000Z', fixedBy: 312, fixedAt: '2026-11-03T17:09:42.000Z', title: 'Play all stops' },
      { issue: 'LAN-221', state: 'Todo', closed: false, closedAt: null, fixedBy: null, fixedAt: null, title: null },
      { issue: 'LAN-222', state: 'Canceled', closed: true, closedAt: '2026-11-03T21:00:00.000Z', fixedBy: null, fixedAt: null, title: null }
    ];
    const l = parseLooked(looked({ looked: [fixed, closedKind] as Looked['looked'], grew: [], states }));
    expect(l.looked.map((x) => [x.verdict, x.issue, x.fixedBy, x.title])).toEqual([['fixed', null, 295, 'Play all stops after a few parts'], ['fixed', 'LAN-220', 312, 'Play all stops after a few parts']]);
    expect(l.states).toEqual(states);
  });

  it('says the first thing wrong', () => {
    const one = (over: Record<string, unknown>) => looked({ looked: [{ ...looked().looked[0], ...over }] as Looked['looked'] });
    const cases: [unknown, string][] = [
      [[], 'not an object'],
      [looked({ sha: 'main' }), 'sha: a commit on main'],
      [looked({ runUrl: 'https://github.com/someone/else/actions/runs/1' }), 'runUrl: a run of genesis-ai-dev/langquest-next'],
      [one({ key: 'nope' }), "looked[0].key: a kind's key"],
      [one({ verdict: 'maybe' }), 'looked[0].verdict: one of filed, known, noise, fixed'],
      [one({ issue: null, issueUrl: null }), 'looked[0].issue: its Linear issue (LAN-12) and address'],
      [one({ issueUrl: 'https://evil.example/LAN-220' }), 'looked[0].issue: its Linear issue (LAN-12) and address'],
      [one({ verdict: 'noise' }), 'looked[0].issue: none for noise'],
      [one({ verdict: 'fixed', fixedBy: 312, fixedAt: '2026-11-03T17:09:42Z', issueUrl: null }), 'looked[0].issue: its closed issue (LAN-12) and address, or none'],
      [one({ verdict: 'fixed', issue: null, issueUrl: null, fixedBy: 312 }), 'looked[0].fixedAt: when the fix merged, for fixed'],
      [one({ fixedBy: 312, fixedAt: '2026-11-03T17:09:42Z' }), 'looked[0].fixedAt: only for fixed'],
      [one({ verdict: 'fixed', issue: null, issueUrl: null, fixedBy: 0, fixedAt: '2026-11-03T17:09:42Z' }), "looked[0].fixedBy: a pull request's number"],
      [one({ verdict: 'fixed', issue: null, issueUrl: null, fixedAt: 'yesterday' }), 'looked[0].fixedAt: a time (ISO 8601)'],
      [one({ title: 'mail me@example.com' }), 'looked[0].title: at most 200 characters, no address'],
      [looked({ states: [{ issue: 'LAN-1', state: 'Live', closed: 'yes' }] as unknown as Looked['states'] }), 'states[0].closed: true or false'],
      [looked({ states: [{ issue: 'LAN-1', state: 'Todo', closed: false, closedAt: '2026-11-03T17:09:42Z' }] as unknown as Looked['states'] }), 'states[0]: an open issue has no closedAt or fix'],
      [looked({ states: [{ issue: 'LAN-1', state: 'Live', closed: true }, { issue: 'LAN-1', state: 'Live', closed: true }] as unknown as Looked['states'] }), 'states[1].issue: a Linear issue (LAN-12), once'],
      [looked({ states: [{ issue: 'LAN-1', state: '<b>', closed: true }] as unknown as Looked['states'] }), "states[0].state: a Linear state's name"],
      [looked({ states: [{ issue: 'LAN-1', state: 'Live', closed: true, title: 'Mail a@b.org' }] as unknown as Looked['states'] }), 'states[0].title: at most 200 characters, no address'],
      [one({ note: 'ask someone@example.com' }), 'looked[0].note: at most 500 characters, no address'],
      [one({ note: 'x'.repeat(501) }), 'looked[0].note: at most 500 characters, no address'],
      [one({ people: -1 }), 'looked[0].people: a whole number'],
      [one({ count: 1.5 }), 'looked[0].count: a whole number'],
      [looked({ looked: [looked().looked[0], looked().looked[0]] as Looked['looked'] }), 'looked[1].key: named twice'],
      [looked({ looked: Array.from({ length: LOOKED_MAX.looked + 1 }, () => looked().looked[1]) as Looked['looked'] }), 'looked: a list of at most 200'],
      [looked({ grew: [{ key: 'transfer:down:source:failOther', people: 'six', count: 1 }] as unknown as Looked['grew'] }), 'grew[0].people: a whole number']
    ];
    for (const [input, message] of cases) {
      expect(() => parseLooked(input), message).toThrow(LookedError);
      expect(() => parseLooked(input)).toThrow(message);
    }
  });
});

describe('/api/user-issues', () => {
  const watch: Watch = { asOf: '2026-11-03T18:00:00Z', active: 12, look: [], grew: [], issues: [] };
  const FEEDBACK = '0d000000-0000-4000-8000-000000000001';
  const INSTALL = 'eae9b9ed-7c59-41c5-9dc4-173b84a3860d';
  const media: Media = { screenshot: '/9j/4A==', picture: null };
  const phone: Phone = {
    installId: INSTALL, build: 'android update 01a1a398', phone: { os: 'android', model: 'moto e' }, firstSeen: '2026-10-20T00:00:00Z', lastSeen: '2026-11-04T04:30:00Z',
    from: '2026-11-01T04:29:00Z', to: '2026-11-04T05:29:00Z',
    records: [{ at: '2026-11-04T04:28:00Z', receivedAt: '2026-11-04T04:29:00Z', kind: 'transfer', about: 'language', n: { count: 3, ms: 41000 }, t: { dir: 'down', src: 'lang' } }]
  };
  function deps(over: Partial<UserIssuesDeps> = {}) {
    const runs: JobRun[] = [];
    const sent: Looked[] = [];
    const d: UserIssuesDeps = {
      verify: async (t, rule) => (t === 'good' && rule === USER_ISSUES_RULE ? { repository: 'genesis-ai-dev/langquest-next', workflowRef: USER_ISSUES_RULE.workflowRef, runId: '123456', runAttempt: '1', eventName: 'schedule' } : null),
      watch: async () => watch,
      media: async (id) => (id === FEEDBACK ? media : null),
      phone: async (install, at) => (install === INSTALL ? { ...phone, to: at ?? phone.to } : null),
      looked: async (l) => { sent.push(l); return { looked: l.looked.length, grew: l.grew.length }; },
      record: async (run) => { runs.push(run); },
      now: () => NOW,
      ...over
    };
    return { d, runs, sent };
  }
  const req = (method: string, auth: string | null, body?: unknown) =>
    new Request('https://next.langquest.org/api/user-issues', { method, headers: auth ? { authorization: `Bearer ${auth}` } : {}, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });

  it('is for user-issues.yml run from main, and nothing else', () => {
    expect(USER_ISSUES_RULE).toEqual({
      audience: 'https://next.langquest.org/api/user-issues',
      workflowRef: 'genesis-ai-dev/langquest-next/.github/workflows/user-issues.yml@refs/heads/main'
    });
  });

  it('lets in only the watch workflow\'s token', async () => {
    const { d, runs } = deps();
    expect((await handleUserIssues(req('GET', null), d)).status).toBe(401);
    expect((await handleUserIssues(req('GET', 'stolen'), d)).status).toBe(401);
    expect((await handleUserIssues(req('POST', 'stolen', looked()), d)).status).toBe(401);
    expect((await handleUserIssues(req('DELETE', 'good'), d)).status).toBe(405);
    expect(runs).toEqual([]);
  });

  it('answers what is new, recording each look as the watch\'s run, so a watch that stops shows', async () => {
    const { d, runs } = deps();
    const res = await handleUserIssues(req('GET', 'good'), d);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual(watch);
    expect(runs).toEqual([{ job: 'user_issue_watch', startedAt: NOW, ms: 0, outcome: 'ok', n: { active: 12, look: 0, grew: 0 } }]);
  });

  it('hands over a problem\'s screenshot and picture, and a phone\'s records around a time, without recording them as runs', async () => {
    const { d, runs } = deps();
    const at = (q: string) => new Request(`https://next.langquest.org/api/user-issues?${q}`, { headers: { authorization: 'Bearer good' } });
    const shot = await handleUserIssues(at(`media=${FEEDBACK}`), d);
    expect(shot.status).toBe(200);
    expect(shot.headers.get('cache-control')).toBe('private, no-store');
    expect(await shot.json()).toEqual(media);
    const records = await handleUserIssues(at(`phone=${INSTALL}&at=2026-11-04T04:29:00Z`), d);
    expect(await records.json()).toEqual({ ...phone, to: '2026-11-04T04:29:00Z' });
    expect((await handleUserIssues(at('media=0d000000-0000-4000-8000-0000000000ff'), d)).status).toBe(404);
    expect((await handleUserIssues(at('phone=ui-nobody'), d)).status).toBe(404);
    const bad = await handleUserIssues(at('phone=../../etc'), d);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "phone: an install's id" });
    const outside = new Request(`https://next.langquest.org/api/user-issues?media=${FEEDBACK}`, { headers: { authorization: 'Bearer stolen' } });
    expect((await handleUserIssues(outside, d)).status).toBe(401);
    expect(runs).toEqual([]);
  });

  it('reads what a GET asks for: the watch, a problem\'s pictures, or a phone, and says what is wrong', () => {
    const q = (s: string) => evidenceAsked(new URLSearchParams(s));
    expect(q('')).toBeNull();
    expect(q(`media=${FEEDBACK}`)).toEqual({ media: FEEDBACK });
    expect(q(`phone=${INSTALL}`)).toEqual({ phone: INSTALL, at: null });
    expect(q('phone=ui-a&at=2026-11-04T04:29:00.000Z')).toEqual({ phone: 'ui-a', at: '2026-11-04T04:29:00.000Z' });
    const wrong: [string, string][] = [
      [`media=${FEEDBACK}&phone=ui-a`, 'media or phone, not both'],
      ['media=LAN-224', 'media: the id of a problem sent from help mode'],
      ['media=0D000000-0000-4000-8000-000000000001', 'media: the id of a problem sent from help mode'],
      ['phone=', "phone: an install's id"],
      ['phone=a b', "phone: an install's id"],
      [`phone=${'x'.repeat(65)}`, "phone: an install's id"],
      ['phone=ui-a&at=yesterday', 'at: a time (ISO 8601)']
    ];
    for (const [s, message] of wrong) expect(() => q(s), s).toThrow(new LookedError(message));
  });

  it('records a watch the database could not answer as failed', async () => {
    const { d, runs } = deps({ watch: async () => { throw new Error('ops_user_issue_watch: timeout'); } });
    await expect(handleUserIssues(req('GET', 'good'), d)).rejects.toThrow('timeout');
    expect(runs).toEqual([{ job: 'user_issue_watch', startedAt: NOW, ms: 0, outcome: 'error', errorClass: 'watch_failed' }]);
  });

  it('takes what was done, with counts by verdict', async () => {
    const { d, runs, sent } = deps();
    const res = await handleUserIssues(req('POST', 'good', looked()), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ looked: 3, grew: 1 });
    expect(sent).toHaveLength(1);
    expect(runs).toEqual([{ job: 'user_issue_look', startedAt: NOW, ms: 0, outcome: 'ok', n: { looked: 3, filed: 1, known: 1, noise: 1, fixed: 0, grew: 1, closed: 0, reopened: 0 } }]);
  });

  it('refuses what is wrong, names another run or is too big, and records the wrong one', async () => {
    const { d, runs, sent } = deps();
    const bad = await handleUserIssues(req('POST', 'good', looked({ sha: 'x' })), d);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'sha: a commit on main' });
    expect((await handleUserIssues(req('POST', 'good', 'not json'), d)).status).toBe(400);
    expect((await handleUserIssues(req('POST', 'good', looked({ runUrl: 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/999' })), d)).status).toBe(400);
    expect((await handleUserIssues(req('POST', 'good', 'x'.repeat(600 * 1024)), d)).status).toBe(413);
    expect(sent).toEqual([]);
    expect(runs).toEqual([
      { job: 'user_issue_look', startedAt: NOW, ms: 0, outcome: 'error', errorClass: 'bad_looked' },
      { job: 'user_issue_look', startedAt: NOW, ms: 0, outcome: 'error', errorClass: 'bad_looked' }
    ]);
  });

  it('is routed by the app\'s API, which answers 503 without it', async () => {
    const base = { profileOf: async () => null, orgsOf: async () => [], reports: async () => null } as unknown as ApiDeps;
    const off = await handleApi(new Request('https://next.langquest.org/api/user-issues'), base);
    expect(off.status).toBe(503);
    const { d } = deps();
    const on = await handleApi(req('GET', 'good'), { ...base, userIssues: d });
    expect(on.status).toBe(200);
  });
});
