import type { AnyEvent } from '../src/events';
import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import { currentTake, deriveTakeStatus, takesFor } from '../src/workflow';
import { buildFixture } from './fixtures';

describe('derived approval status (PLAN.md invariant 5)', () => {
  const events = buildFixture();

  // Use the state before the final config change so the fixture's
  // majority + optional-consultant workflow is in force.
  const beforeFinalConfig = events.filter((e) => e.parentEventId === undefined);
  const state = fold(beforeFinalConfig, emptyState());

  it('majority of assigned reviewers approves the take', () => {
    // Why: r1 and r2 are assigned to this passage; r3 was promoted away from
    // reviewer; 'gone' was removed. Two of two approve -> majority passed.
    const status = deriveTakeStatus(state, 'take2');
    const peer = status.steps.find((s) => s.stepId === 'peer')!;
    expect(peer.eligible).toEqual(['r1', 'r2']);
    expect(peer.approved).toEqual(['r1', 'r2']);
    expect(peer.waitingOn).toEqual([]);
    expect(peer.outcome).toBe('passed');
  });

  it('optional step with nobody eligible does not block approval', () => {
    const status = deriveTakeStatus(state, 'take2');
    const consultant = status.steps.find((s) => s.stepId === 'consultant')!;
    expect(consultant.eligible).toEqual(['r3']);
    expect(consultant.outcome).toBe('pending');
    expect(status.outcome).toBe('approved');
  });

  it('a changed mind is the latest decision, and who is waiting is explicit', () => {
    // Why: coordinators need "who has not approved yet", not just a count.
    const withoutR2Approval = beforeFinalConfig.filter(
      (e) =>
        !(
          e.type === 'v1.ReviewSubmitted' &&
          e.actorId === 'r2' &&
          e.payload.decision === 'approve'
        )
    );
    const s = fold(withoutR2Approval, emptyState());
    const peer = deriveTakeStatus(s, 'take2').steps[0]!;
    expect(peer.rejected).toEqual(['r2']);
    expect(peer.outcome).toBe('pending');
    expect(deriveTakeStatus(s, 'take2').outcome).toBe('in_review');
  });

  it('a take is a draft until submitted, whatever reviewers say', () => {
    // Why: recordings save immediately (UX spec A30). Review only starts on
    // the explicit hand-off, so a half-finished take never shows up as work
    // for a reviewer.
    const unsubmitted = beforeFinalConfig.filter((e) => e.type !== 'v1.TakeSubmitted');
    const s = fold(unsubmitted, emptyState());
    expect(deriveTakeStatus(s, 'take2').outcome).toBe('draft');
  });

  it('unanimous rule fails on a single suggest-changes', () => {
    const full = fold(events, emptyState());
    const withReject: AnyEvent[] = [
      ...events,
      {
        ...events[0]!,
        id: 'late-reject',
        type: 'v1.ReviewSubmitted',
        actorId: 'r1',
        deviceId: 'dC',
        hlc: '999999999999999:000000:dC',
        payload: { takeId: 'take2', stepId: 'peer', decision: 'suggest_changes' }
      }
    ];
    expect(deriveTakeStatus(full, 'take2').outcome).toBe('approved');
    expect(deriveTakeStatus(fold(withReject, emptyState()), 'take2').outcome).toBe('changes_requested');
  });

  it('archived takes are hidden from the active list and current take', () => {
    expect(takesFor(state, 'luke1', 'L1')).toEqual(['take2']);
    expect(currentTake(state, 'luke1', 'L1')).toBe('take2');
    expect(deriveTakeStatus(state, 'take1').outcome).toBe('archived');
  });
});
