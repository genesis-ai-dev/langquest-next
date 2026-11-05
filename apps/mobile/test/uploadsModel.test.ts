import { barState, dayKind, sentDays, waitingCounts, waitingRows } from '../src/sync/uploadsModel';

const uploads = new Map([['u2', { waiting: 2, of: 9 }], ['u1', { waiting: 1, of: 1 }]]);

describe('what waits to upload', () => {
  it('counts recordings by passage and changes from both streams', () => {
    expect(waitingCounts({ uploads, pending: 3, orgPending: 1 })).toEqual({ recordings: 3, changes: 4 });
  });

  it('shows the bar while anything waits, "all uploaded" just after, then nothing', () => {
    expect(barState({ recordings: 0, changes: 2 }, true, false)).toEqual({ kind: 'waiting', counts: { recordings: 0, changes: 2 }, offline: true });
    expect(barState({ recordings: 0, changes: 0 }, false, true)).toEqual({ kind: 'done' });
    expect(barState({ recordings: 0, changes: 0 }, false, false)).toBeNull();
  });

  it('lists passages in the language order, with changes about no passage last', () => {
    const order = (id: string) => ({ u1: 'a', u2: 'b', u3: 'c' })[id] ?? id;
    const rows = waitingRows(uploads, ['u3', null, 'u2', 'u2'], order);
    expect(rows.map((r) => [r.unitId, r.recordings?.waiting ?? 0, r.changes])).toEqual([['u1', 1, 0], ['u2', 2, 2], ['u3', 0, 1], [null, 0, 1]]);
  });
});

describe('what went up', () => {
  it('groups the log by day, newest first, and names today and yesterday', () => {
    const now = new Date(2026, 9, 25, 15, 0).getTime();
    const at = (d: number, h: number) => new Date(2026, 9, d, h).getTime();
    const days = sentDays([
      { at: at(24, 9), unitId: 'u1', files: 2, changes: 0 },
      { at: at(25, 14), unitId: 'u2', files: 3, changes: 4 },
      { at: at(25, 10), unitId: 'u1', files: 1, changes: 0 },
      { at: at(20, 10), unitId: null, files: 0, changes: 2 }
    ], 10);
    expect(days.map((d) => [dayKind(d.start, now), d.entries.map((e) => e.unitId)])).toEqual([
      ['today', ['u2', 'u1']], ['yesterday', ['u1']], ['date', [null]]
    ]);
    expect(sentDays([{ at: now, unitId: 'u1', files: 1, changes: 0 }, { at: now - 1, unitId: 'u2', files: 1, changes: 0 }], 1)[0]!.entries).toHaveLength(1);
  });
});

describe('the bar and the card, as words and rules', () => {
  it('shows "done" only when the last of it just went up', async () => {
    const { emptiedStep } = await import('../src/sync/uploadsModel');
    expect(emptiedStep(3, 0)).toBe('show');
    expect(emptiedStep(0, 0)).toBe('keep');
    expect(emptiedStep(0, 2)).toBe('hide');
    expect(emptiedStep(2, 1)).toBe('hide');
  });

  it('is offline only when told so, not while unknown', async () => {
    const { isOffline } = await import('../src/sync/uploadsModel');
    expect([isOffline(false), isOffline(true), isOffline(null)]).toEqual([true, false, false]);
  });

  it('counts only the organization\'s other languages as elsewhere', async () => {
    const { elsewhereStreams } = await import('../src/sync/uploadsModel');
    const streams = [
      { orgId: 'o', streamId: 'open' }, { orgId: 'o', streamId: 'org' }, { orgId: 'o', streamId: 'other' }, { orgId: 'x', streamId: 'foreign' }
    ];
    expect(elsewhereStreams(streams, 'o', 'open', 'org')).toEqual(['other']);
  });

  it('summarizes: what waits, whether it is going up, or when the last went', async () => {
    const { uploadsSummary } = await import('../src/sync/uploadsModel');
    const now = new Date(2026, 9, 25, 15, 0).getTime();
    const waiting = uploadsSummary({ recordings: 2, changes: 1 }, true, 0, now);
    expect(waiting.waiting).toBe(true);
    expect(uploadsSummary({ recordings: 0, changes: 0 }, false, 0, now)).toMatchObject({ waiting: false, sub: null });
    expect(uploadsSummary({ recordings: 0, changes: 0 }, false, now - 1000, now).sub).not.toBeNull();
  });
});
