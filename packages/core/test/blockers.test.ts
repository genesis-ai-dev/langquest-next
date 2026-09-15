import { deriveBlockers } from '../src/blockers';
import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import type { AnyEvent } from '../src/events';
import { buildFixture } from './fixtures';

/** The fixture is a healthy project; every case below breaks it one way. */
const base = buildFixture().filter((e) => e.parentEventId === undefined);
const at = (id: string, suffix: string) => ({ id: `${id}-${suffix}`, hlc: `999999999999${suffix.padStart(3, '0')}:000000:dZ` });

describe('blockers: reachable states nobody can leave', () => {
  it('a healthy project has none', () => {
    expect(deriveBlockers(fold(base, emptyState()))).toEqual([]);
  });

  it('flags a submitted take whose required step has no eligible reviewer', () => {
    // Why: after a month offline a coordinator may have removed every
    // reviewer. The take then waits forever with no screen showing why.
    // The status screen must say "assign a reviewer" instead of "waiting".
    const events: AnyEvent[] = [
      ...base.filter((e) => e.type !== 'v1.ReviewSubmitted'),
      { ...base[0]!, ...at('rm1', '1'), type: 'v1.MemberRemoved', actorId: 'lead', payload: { profileId: 'r1' } } as AnyEvent,
      { ...base[0]!, ...at('rm2', '2'), type: 'v1.MemberRemoved', actorId: 'lead', payload: { profileId: 'r2' } } as AnyEvent
    ];
    const blockers = deriveBlockers(fold(events, emptyState()));
    expect(blockers.map((b) => b.kind)).toContain('step_no_reviewers');
    const b = blockers.find((b) => b.kind === 'step_no_reviewers')!;
    expect(b.stepId).toBe('peer');
    expect(b.fix).toMatch(/reviewer/);
  });

  it('flags translation work assigned to a removed member', () => {
    const events: AnyEvent[] = [
      ...base,
      { ...base[0]!, ...at('as', '2'), type: 'v1.AssignmentMade', actorId: 'lead', payload: { unitId: 'luke1', laneId: 'L1', profileId: 't1', role: 'translator' } } as AnyEvent,
      { ...base[0]!, ...at('rm', '3'), type: 'v1.MemberRemoved', actorId: 'lead', payload: { profileId: 't1' } } as AnyEvent
    ];
    const blockers = deriveBlockers(fold(events, emptyState()));
    expect(blockers.some((b) => b.kind === 'assignee_removed' && b.profileId === 't1')).toBe(true);
  });

  it('flags a required workflow role nobody holds', () => {
    const events: AnyEvent[] = base.filter(
      (e) => !(e.type === 'v1.MemberAdded' && e.payload.role === 'reviewer')
    );
    const blockers = deriveBlockers(fold(events, emptyState()));
    expect(blockers.some((b) => b.kind === 'role_unfilled' && b.stepId === 'peer')).toBe(true);
  });
});
