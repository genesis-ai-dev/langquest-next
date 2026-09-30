// A signed-in person is routed off Sign In once what decides their home has
// arrived. Someone who belongs to no organization never gets a language
// partition: the sync for it is refused, and waiting for it would leave a
// brand-new account on Sign In for ever. The server's own list of their
// organizations (empty) is the answer, so route on the org alone.
import { describe, expect, it } from 'vitest';
import { foldsSettled } from '../src/session';

describe('foldsSettled', () => {
  it('waits while the org has not arrived, even for someone with no organization', () => {
    expect(foldsSettled(false, false, false)).toBe(false);
    expect(foldsSettled(false, false, true)).toBe(false);
  });

  it('waits for the language partition while the person may still belong to an organization', () => {
    expect(foldsSettled(true, false, false)).toBe(false);
  });

  it('settles when both folds are in', () => {
    expect(foldsSettled(true, true, false)).toBe(true);
  });

  it('settles on the org alone when the server says the person belongs to no organization', () => {
    expect(foldsSettled(true, false, true)).toBe(true);
  });
});
