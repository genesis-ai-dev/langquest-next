import { describe, expect, it } from 'vitest';
import { ASK_HOLD_MS, parseHeldAsk } from '../src/invites/heldAskModel';

// A language a guest tapped on Explore waits while they sign in (UI audit, finding 33).
const NOW = Date.parse('2026-10-28T12:00:00Z');
const held = (heldAt: number) => JSON.stringify({ orgId: 'org-1', languageName: 'Tzotzil', heldAt });

describe('a held ask', () => {
  it('is kept for this sign-in, an hour at most', () => {
    expect(parseHeldAsk(held(NOW - 60_000), NOW)).toEqual({ orgId: 'org-1', languageName: 'Tzotzil', heldAt: NOW - 60_000 });
    // The next person on a shared phone is never sent to ask someone else's organization.
    expect(parseHeldAsk(held(NOW - ASK_HOLD_MS), NOW)).toBeNull();
    // A clock set back does not keep one for ever.
    expect(parseHeldAsk(held(NOW + 60_000), NOW)).toBeNull();
  });

  it('reads nothing, garbage or a torn write as none', () => {
    expect(parseHeldAsk(null, NOW)).toBeNull();
    expect(parseHeldAsk('', NOW)).toBeNull();
    expect(parseHeldAsk('{', NOW)).toBeNull();
    expect(parseHeldAsk('null', NOW)).toBeNull();
    expect(parseHeldAsk(JSON.stringify({ orgId: '', languageName: 'x', heldAt: NOW }), NOW)).toBeNull();
    expect(parseHeldAsk(JSON.stringify({ orgId: 'org-1', heldAt: NOW }), NOW)).toBeNull();
  });
});
