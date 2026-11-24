import { describe, expect, it } from 'vitest';
import { BLOCKS_LOGIC, WIDTH_CSS } from '../src/pageBlocks';
import { OPS_SCRIPT } from '../src/pageOps';

const logic = new Function(`${BLOCKS_LOGIC}; return { laneTracks, releaseSay, againstLine, appleState, platformShares, andWords, nightlyView, nightlySay, supportWaits, supportSay, jobWords, jobRows, capacityView, expiryRows, daysWords, pctWords, nearbyView, nearbyTotals };`)() as {
  laneTracks: (p: unknown) => { id: string; name: string; stages: { id: string; tone: string; cards: { title: string }[] }[] }[];
  releaseSay: (p: unknown, web: { s: string } | null) => string;
  againstLine: (v: number | null, line: number) => { at: number; tone: string } | null;
  appleState: (s: string) => [string, string];
  platformShares: (p: { os: string; installs: number }[]) => { total: number; rows: { id: string; name: string; n: number; share: number }[] };
  andWords: (a: string[]) => string;
  nightlyView: (d: unknown, now: number) => { total: number; passed: number; failed: string[]; broke: string[]; stale: string[]; runs: { total: number; passed: number; stale: boolean }[] };
  nightlySay: (v: unknown) => string | null;
  supportWaits: (s: unknown, now: number) => { reports: number; late: boolean; feedback: number | null; blue: number | null; read: boolean } | null;
  supportSay: (w: unknown) => string | null;
  jobWords: (job: string) => string;
  jobRows: (jobs: unknown[], now: Record<string, unknown>) => { name: string; state: [string, string] }[];
  capacityView: (c: unknown) => { id: string; share: number; tone: string }[] | null;
  expiryRows: (items: unknown[], now: number) => { what: string; left: number; tone: string }[];
  daysWords: (left: number) => string;
  pctWords: (x: number) => string;
  nearbyView: (d: unknown) => { n: number; label: string; warn?: boolean }[] | null;
  nearbyTotals: (d: unknown) => { finished: number; notFinished: number; screenSynced: number | null; openSynced: number | null };
};
const card = (title: string, tone: string) => ({ title, tone, at: null, state: '', build: null, version: null, updates: [] });
const pipeline = { lanes: [
  { id: 'ios', title: 'iPhone store builds', notes: [], stages: [{ id: 'eas', title: 'Building on EAS', cards: [] }, { id: 'review', title: 'App Review', cards: [card('build 60', 'wait')] }, { id: 'live', title: 'On the App Store', cards: [card('build 45', 'live')] }] },
  { id: 'android', title: 'Android store builds', notes: [], stages: [{ id: 'eas', title: 'Building on EAS', cards: [card('build 61', 'bad'), card('build 62', 'busy')] }, { id: 'live', title: 'On Google Play', cards: [card('build 55', 'live')] }] }
] };

describe('the Releases page', () => {
  it('gives each stage the tone of its most pressing build', () => {
    const lanes = logic.laneTracks(pipeline);
    expect(lanes.map((l) => l.name)).toEqual(['iPhone', 'Android']);
    expect(lanes[1]!.stages.map((s) => s.tone)).toEqual(['bad', 'live']);
    expect(lanes[0]!.stages[0]!.tone).toBe('');
  });
  it('says each build in review or failed, then the web app', () => {
    expect(logic.releaseSay(pipeline, { s: 'ok' })).toBe('Apple reviews iPhone build 60. Android build 61 failed. The web app runs the newest merge.');
    expect(logic.releaseSay(null, { s: 'fail' })).toBe('The web app does not run the newest merge.');
    expect(logic.releaseSay(null, null)).toBe('');
  });
});

describe('the App stores page', () => {
  it('puts a rate against Google’s line: green under half, amber under it, red past it', () => {
    expect(logic.againstLine(0.002, 0.0109)).toMatchObject({ tone: 'ok' });
    expect(logic.againstLine(0.006, 0.0109)).toMatchObject({ tone: 'warn' });
    expect(logic.againstLine(0.02, 0.0109)).toMatchObject({ tone: 'bad' });
    expect(logic.againstLine(0.05, 0.0109)!.at).toBe(1);
    expect(logic.againstLine(null, 0.0109)).toBeNull();
  });
  it('says an App Store state in words', () => {
    expect(logic.appleState('WAITING_FOR_REVIEW')).toEqual(['Waits for Apple', 'warn']);
    expect(logic.appleState('REJECTED')[1]).toBe('bad');
    expect(logic.appleState('SOME_NEW_STATE')[0]).toBe('some new state');
  });
});

describe('the Phones and browsers page', () => {
  it('shares what people use, largest first, with plain names', () => {
    const p = logic.platformShares([{ os: 'ios', installs: 12 }, { os: 'android', installs: 41 }, { os: 'web', installs: 18 }, { os: 'x', installs: 0 }]);
    expect(p.total).toBe(71);
    expect(p.rows.map((r) => r.name)).toEqual(['Android', 'Web', 'iPhone']);
  });
  it('has a width class for each step a meter can take', () => {
    for (const w of [0, 2, 50, 100]) expect(WIDTH_CSS).toContain(`.meter > i.w${w},`);
  });
});

describe('the pages that are a work list', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');
  const suite = (name: string, failed = false, broke: string | null = null) => ({ suite: name, ran: 10, passed: failed ? 9 : 10, failed, broke, issues: [] });
  const nightly = { repo: 'x', runs: [
    { workflow: 'guardrails.yml', title: 'Guardrails nightly', run: { number: 1, url: 'u', at: '2026-11-21T02:30:00Z', sha: 'a', conclusion: 'failure' }, suites: [suite('Web UI', true), suite('Fleet'), suite('Mutation', false, 'timed out')] },
    { workflow: 'phone-tests.yml', title: 'Phone tests', run: { number: 2, url: 'u', at: '2026-11-19T08:30:00Z', sha: 'b', conclusion: 'success' }, suites: [suite('Android')] }
  ] };
  it('says last night’s suites, the ones that broke or failed, and a nightly that stopped', () => {
    expect(logic.andWords(['a', 'b', 'c'])).toBe('a, b and c');
    const v = logic.nightlyView(nightly, now);
    expect(v).toMatchObject({ total: 4, passed: 2, failed: ['Web UI'], broke: ['Mutation'], stale: ['Phone tests'] });
    expect(v.runs.map((r) => [r.passed, r.total, r.stale])).toEqual([[1, 3, false], [1, 1, true]]);
    expect(logic.nightlySay(v)).toBe('Last night 2 of 4 test suites passed. Mutation broke. Tests failed in Web UI. Phone tests did not run in the last 36 hours.');
    expect(logic.nightlySay(logic.nightlyView({ runs: [] }, now))).toBeNull();
  });
  it('says what waits on staff, and says nothing waits only when every count was read', () => {
    const support = (open: number, oldestAt: string | null, feedback: number | null, verifications: { status: string }[] | null) =>
      ({ reports: { open, oldestAt, staffOnly: 0, resolvedWeek: 0 }, suspended: { total: 0, week: 0 }, deletions: [], feedbackOpen: feedback === null ? null : { open: feedback, oldestAt: null }, actions: [], verifications });
    expect(logic.supportSay(logic.supportWaits(support(2, '2026-11-20T00:00:00Z', 1, [{ status: 'waiting' }, { status: 'granted' }]), now)))
      .toBe('2 content reports are open, the oldest past the 24-hour promise. 1 feedback message waits.');
    expect(logic.supportSay(logic.supportWaits(support(0, null, 0, [{ status: 'waiting' }]), now))).toBe('No content report is open.');
    expect(logic.supportSay(logic.supportWaits(support(0, null, 0, []), now))).toBe('Nothing waits on staff.');
    expect(logic.supportSay(logic.supportWaits(support(0, null, null, []), now))).toBe('No content report is open.');
    expect(logic.supportWaits(null, now)).toBeNull();
  });
});

describe('the pages behind the scenes', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');
  it('names each job in plain words, the worst first', () => {
    expect(logic.jobWords('push_delivery')).toBe('Send phone notifications');
    expect(logic.jobWords('new_thing')).toBe('New thing');
    const job = (job: string, extra: object = {}) => ({ job, runs_on: 'worker', last_at: null, last_outcome: 'ok', runs: 3, failures: 0, p95_ms: 1, stale: false, streak: 0, ...extra });
    const rows = logic.jobRows([job('push_delivery'), job('blob_reconcile', { last_outcome: 'partial' }), job('fold_canary', { stale: true }), job('projection')], { projection: { running: true } });
    expect(rows.map((r) => r.state[1])).toEqual(['Stopped', 'Did part of the work', 'Runs now', 'In order']);
  });
  it('puts the database and this month’s use against what the plan allows', () => {
    const rows = logic.capacityView({ now: { dbBytes: 90, eventsBytes: 1, eventsRows: 1, snapshotsBytes: 1 }, limitBytes: 100, dbGrowthPerDay: 1, weeksLeft: 2, history: [], r2: null,
      usage: { workersRequests: 5_000_000, doRequests: 0, r2ClassA: 2_000_000, r2ClassB: 0, allowance: { workersRequests: 10_000_000, doRequests: 1_000_000, r2ClassA: 1_000_000, r2ClassB: 10_000_000, r2Bytes: 1 } } })!;
    expect(rows.map((r) => [r.id, r.tone])).toEqual([['db', 'warn'], ['workers', 'ok'], ['do', 'ok'], ['r2a', 'warn'], ['r2b', 'ok']]);
    expect(logic.capacityView(null)).toBeNull();
  });
  it('says what expires next, soonest first, with the dashboard’s own lines', () => {
    const rows = logic.expiryRows([{ what: 'A', expires: '2027-06-01T00:00:00Z', source: 'x' }, { what: 'B', expires: '2026-11-25T00:00:00Z', source: 'x' }, { what: 'C', expires: null, source: 'x' }], now);
    expect(rows.map((r) => [r.what, r.tone])).toEqual([['B', 'bad'], ['A', 'ok']]);
    expect(logic.daysWords(rows[0]!.left)).toBe('in 4 days');
    expect(logic.daysWords(-2.5)).toBe('expired 3 days ago');
    expect(logic.pctWords(9 / 412300)).toBe('under 0.01%');
    expect(logic.pctWords(0.0123)).toBe('1.23%');
  });
});

// Nearby sync on Work safety's page (docs/ops-dashboard-plan.md 5.4): said only where an organization has it or a phone used it.
describe('nearby sync, last 7 days', () => {
  const week = {
    installs: 4, screen: { rooms: 4, met: 3, sessions: 5, done: 4 }, open: { runs: 10, met: 4, sessions: 12, done: 11 },
    refusals: { window: 2 }, deliver: { refused: 0 },
    orgs: [{ orgId: 'a', nearby: true, open: true }, { orgId: 'b', nearby: true, open: false }, { orgId: 'c', nearby: false, open: false }]
  };

  it('says nothing where no organization has it on and no phone used it', () => {
    expect(logic.nearbyView(null)).toBeNull();
    expect(logic.nearbyView({ installs: 0, orgs: [{ orgId: 'c', nearby: false }] })).toBeNull();
  });

  it('counts organizations, phones, how often Share nearby ran and synced with a teammate, and marks only what wants a look', () => {
    const v = logic.nearbyView(week)!;
    expect(v.map((f) => [f.n, f.label, Boolean(f.warn)])).toEqual([
      [2, 'organizations with nearby, 1 sharing while open', false], [4, 'phones used it', false],
      [4, 'times Share nearby ran, 75% synced with a teammate', false], [10, 'times it ran while open, 40% synced with a teammate', false],
      [2, 'sessions did not finish', false], [2, 'teammates turned away past the two weeks', true],
      [0, 'revoked phones turned away', false], [0, 'carried events refused', false]
    ]);
    // With no room or run, no share of them.
    expect(logic.nearbyView({ ...week, screen: {}, open: {} })![2]!.label).toBe('times Share nearby ran');
  });
});

// Found on the dashboard (2026-11-24): the details read "190 sessions finished, 181 did not" for 19 and 1, because the
// page's num() returns text and the sums were made of its results. The sums are numbers, whatever the answer holds.
describe('nearby sync\'s sums', () => {
  it('adds as numbers: 19 finished and 1 did not, not 190 and 181', () => {
    expect(logic.nearbyTotals({ screen: { sessions: 20, done: 19, rooms: 48, met: 13 }, open: { sessions: 0, done: 0, runs: 3, met: 0 } }))
      .toEqual({ finished: 19, notFinished: 1, screenSynced: 27, openSynced: 0 });
    // Numbers as the database may send them, as text, and fields missing.
    expect(logic.nearbyTotals({ screen: { sessions: '20', done: '19' }, open: {} })).toEqual({ finished: 19, notFinished: 1, screenSynced: null, openSynced: null });
    expect(logic.nearbyTotals(null)).toEqual({ finished: 0, notFinished: 0, screenSynced: null, openSynced: null });
  });

  it('the details use the sums, never the page\'s formatted numbers added together', () => {
    expect(OPS_SCRIPT).toContain('const t = nearbyTotals(d);');
    expect(OPS_SCRIPT).not.toMatch(/num\(num\(s\.done\)/);
  });
});

