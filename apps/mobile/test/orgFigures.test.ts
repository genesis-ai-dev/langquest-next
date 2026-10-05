import type { LanguageProgress } from '@langquest-next/core';
import { laneFigures, oldestAsOf } from '../src/orgFigures';

// An overview's figures: this phone's fold for what it has, the dashboard's server for the rest (decisions.md 37, 44).

const p = (total: number, recorded = 0): LanguageProgress => ({ total, recorded, done: 0, steps: [], waiting: 0, feedback: 0 });
const asOf = '2026-10-03T12:00:00.000Z';

describe('laneFigures', () => {
  it('prefers the local fold, fills the rest from the server, and leaves out what neither knows', () => {
    const server = { asOf, rows: [
      { projectId: 'din', laneId: 'din', name: 'Dinka', progress: p(9, 9) },
      { projectId: 'nus', laneId: 'nus', name: 'Nuer', progress: p(5, 1) }
    ] };
    const out = laneFigures(['din', 'nus', 'shk'], new Map([['din', p(10, 2)]]), server);
    expect(out.get('din')).toEqual({ progress: p(10, 2), asOf: null });
    expect(out.get('nus')).toEqual({ progress: p(5, 1), asOf });
    expect(out.has('shk')).toBe(false);
    expect(oldestAsOf(out.values())).toBe(asOf);
  });

  it('without the server, knows only what it folds', () => {
    const out = laneFigures(['din', 'nus'], new Map([['din', p(10)]]), null);
    expect([...out.keys()]).toEqual(['din']);
    expect(oldestAsOf(out.values())).toBeNull();
  });
});
