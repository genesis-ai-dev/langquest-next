import { latestRequest, requestOutcome } from '../src/requestOutcome';

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

describe('which join request "Join your team" is about', () => {
  const ask = (id: string, status: string, askedAt?: number) => ({ id, kind: 'join_request', status, payload: { orgId: 'o1', ...(askedAt ? { askedAt } : {}) } });
  it('is the newest, wherever the outbox keeps it', () => {
    // Why: unsent actions come first in the outbox, so after asking again the declined request came last and the screen kept saying no.
    expect(latestRequest([ask('new', 'queued', 2000), ask('old', 'sent', 1000)])?.id).toBe('new');
    expect(latestRequest([ask('new', 'sent', 2000), ask('old', 'sent', 1000)])?.id).toBe('new');
    expect(latestRequest([ask('old', 'sent', 1000), ask('new', 'sent', 2000)])?.id).toBe('new');
  });
  it('counts requests from before askedAt as oldest, and never a refused one', () => {
    expect(latestRequest([ask('older', 'sent'), ask('new', 'sent', 5)])?.id).toBe('new');
    expect(latestRequest([ask('a', 'sent'), ask('b', 'sent')])?.id).toBe('b');
    expect(latestRequest([ask('ok', 'sent', 1), ask('bad', 'failed', 9)])?.id).toBe('ok');
    expect(latestRequest([{ id: 'p', kind: 'profile', status: 'queued', payload: {} }])).toBeUndefined();
  });
});
