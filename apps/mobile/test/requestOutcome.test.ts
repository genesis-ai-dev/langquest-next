import { requestOutcome } from '../src/requestOutcome';

describe('what became of a join request', () => {
  it('waits while the request is open and they belong nowhere', () => {
    expect(requestOutcome('o1', [], true)).toEqual({ kind: 'waiting' });
  });

  it('opens the organization once they are a member, at any scope', () => {
    // Why: they were left on "Waiting for …" until they signed in again.
    expect(requestOutcome('o1', ['o1'], false)).toEqual({ kind: 'joined', orgId: 'o1' });
    expect(requestOutcome('o1', ['o2', 'o1'], false)).toEqual({ kind: 'joined', orgId: 'o1' });
  });

  it('opens another organization they joined meanwhile', () => {
    expect(requestOutcome('o1', ['o2'], true)).toEqual({ kind: 'joined', orgId: 'o2' });
  });

  it('says they were turned away when the request is gone and they belong nowhere', () => {
    // Why: a declined request otherwise left them waiting for good.
    expect(requestOutcome('o1', [], false)).toEqual({ kind: 'declined' });
  });
});
