import { hasWelcome, isFromV2, lastWork, parseWelcome } from '../src/account/welcomeBack';

const lang = (languageId: string, orgId: string, lastAt: string | null) => ({
  languageId, orgId, orgName: `Org ${orgId}`, name: `Lang ${languageId}`, was: `Project ${languageId}`,
  recordings: 3, passages: 1, lastUnitId: lastAt ? `u-${languageId}` : null, lastAt
});

describe('Welcome back (demo ADR-043)', () => {
  it('reads the server answer, leaving out anything malformed', () => {
    const w = parseWelcome({
      here: [lang('a', 'o1', '001:000000:d'), { languageId: 'b' }, null, { ...lang('c', 'o1', null), recordings: 'many' }],
      onTheirWay: [{ id: 'p1', name: 'Nuer stories' }, { name: 'no id' }]
    });
    expect(w?.here.map((l) => l.languageId)).toEqual(['a', 'c']);
    expect(w?.here[1]).toMatchObject({ recordings: 0, lastUnitId: null, lastAt: null });
    expect(w?.onTheirWay).toEqual([{ id: 'p1', name: 'Nuer stories' }]);
    expect(parseWelcome(null)).toBeNull();
    expect(parseWelcome('nope')).toBeNull();
  });

  it('welcomes back only someone with work here or on its way', () => {
    expect(hasWelcome(null)).toBe(false);
    expect(hasWelcome({ here: [], onTheirWay: [] })).toBe(false);
    expect(hasWelcome({ here: [], onTheirWay: [{ id: 'p', name: 'P' }] })).toBe(true);
    expect(hasWelcome({ here: [lang('a', 'o', null)], onTheirWay: [] })).toBe(true);
  });

  it('keeps going in the language recorded in last, in the organization open', () => {
    const w = { here: [lang('a', 'o1', '001:000000:d'), lang('b', 'o1', '003:000000:d'), lang('c', 'o2', '009:000000:d'), lang('d', 'o1', null)], onTheirWay: [] };
    expect(lastWork(w, 'o1')?.languageId).toBe('b');
    expect(lastWork(w, 'o2')?.languageId).toBe('c');
    expect(lastWork(w, 'o3')).toBeUndefined();
  });

  it('knows an account v2 sign-in made', () => {
    expect(isFromV2({ user_metadata: { from_v2: true } })).toBe(true);
    expect(isFromV2({ user_metadata: { from_v2: 'true' } })).toBe(false);
    expect(isFromV2({ user_metadata: {} })).toBe(false);
    expect(isFromV2(null)).toBe(false);
  });
});
