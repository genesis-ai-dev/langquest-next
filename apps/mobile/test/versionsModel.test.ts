import { draftName, draftOf, startedFrom } from '../src/passage/versionsModel';

describe('what drafts are called (decisions.md 81)', () => {
  const d = (rootTakeId: string, takeId = rootTakeId, hlc = '1') => ({ rootTakeId, takeId, hlc });

  it('says Draft for one, numbers them in the order started for more, and New draft before a first save', () => {
    expect(draftName([d('r1')], 'r1')).toBe('Draft');
    expect(draftName([d('r1'), d('r2')], 'r2')).toBe('Draft 2');
    expect(draftName([d('r1')], null)).toBe('New draft');
  });

  it('finds the newest take of the draft a workspace has open', () => {
    expect(draftOf([d('r1', 't1', '1'), d('r1', 't2', '2'), d('r2')], 'r1')?.takeId).toBe('t2');
    expect(draftOf([d('r1')], null)).toBeUndefined();
  });

  it('names the version a draft started from', () => {
    expect(startedFrom([{ takeId: 'v1', n: 1 }, { takeId: 'v2', n: 2 }], 'v1')).toBe(1);
    expect(startedFrom([{ takeId: 'v1', n: 1 }], undefined)).toBeNull();
  });
});
