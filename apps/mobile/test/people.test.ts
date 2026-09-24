// A person's look is derived from their id alone, never synced: if two devices
// disagreed, "Teal Diamond approved this" would name different people on each.
import { describe, expect, it } from 'vitest';
import { initials, personLook, PERSON_COLORS, PERSON_SHAPES } from '../src/people';

const ids = Array.from({ length: 400 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

describe('person look', () => {
  it('is the same for an id every time, so every device agrees', () => {
    for (const id of ids.slice(0, 20)) expect(personLook(id)).toEqual(personLook(id));
  });

  it('spreads anonymous people across colours and shapes, so neighbours rarely match', () => {
    const looks = ids.map((id) => personLook(id));
    expect(new Set(looks.map((l) => l.color)).size).toBe(PERSON_COLORS.length);
    expect(new Set(looks.map((l) => l.shape)).size).toBe(PERSON_SHAPES.length);
    expect(new Set(looks.map((l) => l.name)).size).toBe(PERSON_COLORS.length * PERSON_SHAPES.length);
  });

  it('never shows a raw id: no name means a colour-and-shape label', () => {
    for (const name of [undefined, null, '', '   ']) {
      const look = personLook(ids[0]!, name);
      expect(look.anonymous).toBe(true);
      expect(look.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
      expect(look.name).not.toContain(ids[0]!.slice(0, 8));
      expect(look.initials).toBeUndefined();
    }
  });

  it('shows a set name with initials, keeping the id-derived colour', () => {
    const look = personLook(ids[3]!, '  Ryder Wishart ');
    expect(look).toMatchObject({ name: 'Ryder Wishart', anonymous: false, initials: 'Ry', shape: 'circle' });
    expect(look.color).toBe(personLook(ids[3]!).color);
  });

  it('takes initials by code point, so non-Latin names are not split mid-letter', () => {
    expect(initials('李小龙')).toBe('李小');
    expect(initials('𝒜lex')).toBe('𝒜l');
    expect(initials('a')).toBe('A');
  });
});
