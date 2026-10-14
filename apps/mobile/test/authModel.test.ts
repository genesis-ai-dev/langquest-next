import type { ListedOrganization } from '../src/accountData';
import { createAccountReady, matchOrganizations } from '../src/auth/model';

const org = (org_id: string, name: string, languages: string[] = []): ListedOrganization => ({ org_id, name, languages });
const listed = [org('a', 'Akobo Team', ['Nuer']), org('b', 'Bor Translators', ['Dinka'])];

describe('organizations Request Access lists (AUTH-5, decisions.md 66)', () => {
  it('nothing typed: the list on the phone', () => {
    expect(matchOrganizations(listed, '', { query: '', list: [] })).toBe(listed);
  });

  it("by an organization's name or a language it lists", () => {
    expect(matchOrganizations(listed, 'bor', { query: '', list: [] }).map((o) => o.org_id)).toEqual(['b']);
    expect(matchOrganizations(listed, 'nuer', { query: '', list: [] }).map((o) => o.org_id)).toEqual(['a']);
  });

  it("the server's finds for the same words join the phone's, once each, in name order", () => {
    const found = { query: 'team', list: [org('a', 'Akobo Team'), org('c', 'Aweil Team')] };
    expect(matchOrganizations(listed, 'team', found).map((o) => o.org_id)).toEqual(['a', 'c']);
  });

  it('finds for other words are not shown', () => {
    expect(matchOrganizations(listed, 'bor', { query: 'team', list: [org('c', 'Aweil Team')] }).map((o) => o.org_id)).toEqual(['b']);
  });
});

describe('Create Account is ready', () => {
  it('AUTH-020 needs an email, and a password of 6 or more typed twice alike', () => {
    expect(createAccountReady('someone', 'secret1', 'secret1')).toBe(false);
    expect(createAccountReady('someone@example.org', 'secret1', 'secret1')).toBe(true);
    expect(createAccountReady(' someone@example.org ', 'secret1', 'secret1')).toBe(true);
    expect(createAccountReady('someone@example.org', 'abc12', 'abc12')).toBe(false);
    expect(createAccountReady('someone@example.org', 'secret12', 'secret13')).toBe(false);
    expect(createAccountReady('someone@example.org', 'secret12', '')).toBe(false);
    expect(createAccountReady('', '', '')).toBe(false);
  });
});
