import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/supabase', () => ({ supabase: {} }));
const { maySwitchPersona, PERSONAS, PERSONA_TESTERS } = await import('../src/dev');

describe('maySwitchPersona', () => {
  it('lets a persona account switch back, or a release build strands the tester in it', () => {
    for (const p of PERSONAS) expect(maySwitchPersona(p.email, false)).toBe(true);
  });

  it('keeps named testers and hides the switcher from everyone else in a release build', () => {
    expect(maySwitchPersona(PERSONA_TESTERS[0], false)).toBe(true);
    expect(maySwitchPersona('someone@example.org', false)).toBe(false);
    expect(maySwitchPersona(null, false)).toBe(false);
    expect(maySwitchPersona(null, true)).toBe(true);
  });
});
