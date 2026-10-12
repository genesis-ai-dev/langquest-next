import { describe, expect, it } from 'vitest';
import { defaultBoard, EVERY_LANGUAGE_ORG, looksLikeTest, ownerOrgId, SKIP, type BoardProject } from '../src/board';

const project = (id: string, over: Partial<BoardProject> = {}): BoardProject => ({
  id, name: `Project ${id}`, active: true, private: false, createdAt: `2025-01-0${id.length}T00:00:00Z`, creatorId: null,
  owners: [], members: [], confidence: 'keep', ...over
});

const people = [
  { id: 'el', name: 'Platform', email: 'Platform@EveryLanguage.com ' },
  { id: 'nyibol', name: 'Nyibol', email: 'nyibol@example.org' },
  { id: 'ana', name: null, email: null }
];

describe('defaultBoard', () => {
  it('puts every project the Every Language platform account is in into Every Language, owner or member', () => {
    const { orgs, placements } = defaultBoard([
      project('a', { owners: ['el'] }),
      project('b', { owners: ['nyibol'], members: ['el'] })
    ], people);
    expect(placements.map((p) => [p.projectId, p.orgId, p.why])).toEqual([
      ['a', EVERY_LANGUAGE_ORG, 'everylanguage'], ['b', EVERY_LANGUAGE_ORG, 'everylanguage']
    ]);
    expect(orgs).toEqual([{ id: EVERY_LANGUAGE_ORG, name: 'Every Language', existing: false }]);
  });

  it("keeps each owner's other projects together, falling back to the creator", () => {
    const { orgs, placements } = defaultBoard([
      project('a', { owners: ['nyibol'] }),
      project('bb', { creatorId: 'nyibol' }),
      project('ccc', { owners: ['ana'] })
    ], people);
    expect(placements.map((p) => p.orgId)).toEqual([ownerOrgId('nyibol'), ownerOrgId('nyibol'), ownerOrgId('ana')]);
    expect(orgs.map((o) => o.name)).toEqual(["Nyibol's organization", 'An organization from LangQuest']);
  });

  it('starts test projects with nothing to go on, and projects nobody owns, as not coming over', () => {
    const { placements } = defaultBoard([
      project('a', { name: 'Dev test 3', confidence: 'review', owners: ['nyibol'] }),
      project('bb', { name: 'Testament readings', confidence: 'review', owners: ['nyibol'] }),
      project('ccc', { name: 'Kwa test', confidence: 'keep', owners: ['nyibol'] }),
      project('dddd')
    ], people);
    expect(placements.map((p) => [p.projectId, p.orgId, p.why])).toEqual([
      ['a', SKIP, 'test'], ['bb', ownerOrgId('nyibol'), 'owner'], ['ccc', ownerOrgId('nyibol'), 'owner'], ['dddd', SKIP, 'nobody']
    ]);
  });

  it('reads a test name only as a whole word', () => {
    expect(looksLikeTest({ name: 'Testament', confidence: 'review' })).toBe(false);
    expect(looksLikeTest({ name: 'Matthew Test', confidence: 'review' })).toBe(true);
    expect(looksLikeTest({ name: 'Matthew Test', confidence: 'medium' })).toBe(false);
  });
});
