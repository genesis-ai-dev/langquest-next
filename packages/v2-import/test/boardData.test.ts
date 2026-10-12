import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVERY_LANGUAGE_ORG, SKIP } from '../src/board';
import { boardData, parseRecommendations } from '../src/boardData';
import type { V2ProjectSummary } from '../src/reader';

const csv = fs.readFileSync(path.resolve(__dirname, '../../../docs/v2-project-languages.csv'), 'utf8');

const summary = (id: string, name: string): V2ProjectSummary => ({ id, name, active: true, private: false, created_at: '2025-01-01T00:00:00Z', creator_id: null, template: 'bible', assets: 10, lastActivity: null });

describe('the language recommendations', () => {
  it('reads every project in docs/v2-project-languages.csv, with a readable code', () => {
    const recs = parseRecommendations(csv);
    expect(recs.size).toBe(442);
    const tyap = [...recs.values()].find((r) => r.name === 'Tyap');
    expect(tyap).toMatchObject({ code: 'kcg', confidence: 'medium' });
    expect(tyap?.languoidId).toMatch(/^[0-9a-f-]{36}$/);
    expect([...recs.values()].filter((r) => r.decision)).toEqual([]);
  });
});

describe('boardData', () => {
  const memberships = [
    { profile_id: 'el', project_id: 'a', membership: 'member', active: true },
    { profile_id: 'nyibol', project_id: 'a', membership: 'owner', active: true },
    { profile_id: 'nyibol', project_id: 'b', membership: 'owner', active: true }
  ];
  const plan = { orgs: [], placements: [], passes: [] };

  it('starts Every Language from the platform account, found by email or named by id', () => {
    const byEmail = boardData({ projects: [summary('a', 'A'), summary('b', 'B')], memberships, people: [{ id: 'el', name: null, email: 'platform@everylanguage.com' }], recommendations: new Map(), plan });
    expect(byEmail.cards.map((c) => c.orgId)).toEqual([EVERY_LANGUAGE_ORG, 'org-v2-nyibol']);
    expect(byEmail.orgs.find((o) => o.org_id === EVERY_LANGUAGE_ORG)?.admins).toEqual(['el']);
    const byId = boardData({ projects: [summary('a', 'A')], memberships, people: [], recommendations: new Map(), plan, everyLanguageIds: ['el'] });
    expect(byId.cards[0]?.orgId).toBe(EVERY_LANGUAGE_ORG);
    const unknown = boardData({ projects: [summary('a', 'A')], memberships, people: [], recommendations: new Map(), plan });
    expect(unknown.everyLanguage).toEqual([]);
    expect(unknown.cards[0]?.orgId).toBe('org-v2-nyibol');
  });

  it('shows what the board saved over the starting rule, including not bringing a project over', () => {
    const saved = {
      orgs: [{ org_id: 'org-x', name: 'Team X', existing: false, admins: [] }],
      placements: [
        { project_id: 'a', org_id: 'org-x', languoid_id: null, code: 'kwa', confirmed_by: 'Caleb', confirmed_at: '2026-10-12T00:00:00Z' },
        { project_id: 'b', org_id: null, languoid_id: null, code: null, confirmed_by: null, confirmed_at: null }
      ],
      passes: []
    };
    const data = boardData({ projects: [summary('a', 'A'), summary('b', 'B')], memberships, people: [], recommendations: new Map(), plan: saved });
    expect(data.cards.map((c) => [c.orgId, c.why, c.code, c.confirmed?.by ?? null])).toEqual([['org-x', 'saved', 'kwa', 'Caleb'], [SKIP, 'saved', null, null]]);
    // An organization nothing is in any more stays only if the board saved it.
    expect(data.orgs.map((o) => o.org_id)).toEqual(['org-x']);
  });
});
