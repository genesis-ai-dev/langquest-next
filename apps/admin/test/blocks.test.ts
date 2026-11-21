import { describe, expect, it } from 'vitest';
import { BLOCKS_LOGIC, WIDTH_CSS } from '../src/pageBlocks';

const logic = new Function(`${BLOCKS_LOGIC}; return { laneTracks, releaseSay, againstLine, appleState, platformShares, andWords, nightlyView, nightlySay, supportWaits, supportSay };`)() as {
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
