import { describe, expect, it } from 'vitest';
import { BLOCKS_LOGIC, WIDTH_CSS } from '../src/pageBlocks';

const logic = new Function(`${BLOCKS_LOGIC}; return { laneTracks, releaseSay, againstLine, appleState, platformShares };`)() as {
  laneTracks: (p: unknown) => { id: string; name: string; stages: { id: string; tone: string; cards: { title: string }[] }[] }[];
  releaseSay: (p: unknown, web: { s: string } | null) => string;
  againstLine: (v: number | null, line: number) => { at: number; tone: string } | null;
  appleState: (s: string) => [string, string];
  platformShares: (p: { os: string; installs: number }[]) => { total: number; rows: { id: string; name: string; n: number; share: number }[] };
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
