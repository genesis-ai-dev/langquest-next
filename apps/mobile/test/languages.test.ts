import { foldOrg, type AnyEvent } from '@langquest-next/core';
import { openLanguage } from '../src/languages';

let seq = 0;
const org = (events: [string, unknown][]) => foldOrg(events.map(([type, payload]) => ({
  id: `e${++seq}`, type, orgId: 'o', streamId: '_org', actorId: 'lead', deviceId: 'd', hlc: `${String(seq).padStart(15, '0')}:000000:d`, payload
}) as AnyEvent));

describe('the language a phone opens (decision 63)', () => {
  const o = org([
    ['v1.LanguageAdded', { languageId: 'L-nus', name: 'Nuer', code: 'nus', sourceCode: 'eng' }],
    ['v1.LanguageAdded', { languageId: 'L-din', name: 'Dinka', code: 'din', sourceCode: 'eng' }],
    ['v1.RoleDefined', { roleId: 'translator', name: 'Translator', privileges: ['translate'] }],
    ['v1.MemberAdded', { profileId: 'akol', roleId: 'translator', scope: { level: 'language', languageId: 'L-nus' } }]
  ]);

  it('opens the language a screen is about, then the last one opened, then your own, then the first by name', () => {
    expect(openLanguage(o, 'akol', { param: 'L-din', saved: 'L-nus' })).toBe('L-din');
    expect(openLanguage(o, 'akol', { saved: 'L-din' })).toBe('L-din');
    expect(openLanguage(o, 'akol', {})).toBe('L-nus');
    expect(openLanguage(o, 'lead', {})).toBe('L-din');
  });

  it('ignores a language the organization does not have, and opens none before it has any', () => {
    expect(openLanguage(o, 'lead', { param: 'L-gone', saved: 'L-other' })).toBe('L-din');
    expect(openLanguage(org([]), 'lead', {})).toBeNull();
  });
});
