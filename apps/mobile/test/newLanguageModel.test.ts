import { describe, expect, it } from 'vitest';
import { addedToast, backTarget, draftPlan, startingSpecs, uniqueKinds } from '../src/org/newLanguageModel';
import { commands, DEFAULT_KINDS, emptyLanguageState, type LibraryDoc } from '@langquest-next/core';
import type { SharedItem } from '../src/library/model';
import type { GuideSet } from '../src/reference/guideSets';
import { fiaRank, newLanguageOffers, webRank, sharedKey } from '../src/org/newLanguageOffersModel';
import { grantableRoles, membersByLanguage, mayInviteAt, mayInviteAtAll } from '../src/org/permissionsModel';
import { memberEntries } from '../src/org/orgAdmin';
import { ORG } from './sessions';
import type { LanguageDraft } from '../src/checks/languageDraftModel';

const say = (key: string, params: Record<string, string | number>) => `${key}:${JSON.stringify(params)}`;
const draft = (from: string, specs: number, given: number) => ({ from, specs: new Array(specs).fill({}), given }) as unknown as LanguageDraft;

describe('new language wizard rules', () => {
  it('keeps a kind once, the first', () => {
    expect(uniqueKinds([{ id: 'a', n: 1 }, { id: 'b', n: 2 }, { id: 'a', n: 3 }])).toEqual([{ id: 'a', n: 1 }, { id: 'b', n: 2 }]);
  });
  it('opens the draft made from this flow, asks before dropping edits, else starts fresh', () => {
    expect(draftPlan(draft('x', 5, 2), 'x', false)).toBe('open');
    expect(draftPlan(draft('y', 5, 2), 'x', false)).toBe('ask');
    expect(draftPlan(draft('y', 5, 2), 'x', true)).toBe('fresh');
    expect(draftPlan(draft('y', 2, 2), 'x', false)).toBe('fresh');
    expect(draftPlan(null, 'x', false)).toBe('fresh');
  });
  it('starts a choosing draft from no steps, and a flow from its kinds once each', () => {
    const fresh = commands(emptyLanguageState());
    expect(startingSpecs({ commandId: 'c', flow: null })).toEqual(fresh.saveFlowSteps({ commandId: 'c', steps: [] }));
    const steps = [{ kindIds: ['peer'] }, { kindIds: ['final'] }];
    expect(startingSpecs({ commandId: 'c', flow: { name: 'Quick', kinds: [...DEFAULT_KINDS, DEFAULT_KINDS[0]!], steps } }))
      .toEqual(fresh.copyFlow({ commandId: 'c', name: 'Quick', kinds: DEFAULT_KINDS, steps }));
  });
  it('goes back one page of a step first, then a step', () => {
    expect(backTarget(3, { materialPage: 'material', flowPage: 'pick' })).toEqual({ materialPage: 'languages' });
    expect(backTarget(4, { materialPage: 'languages', flowPage: 'checks' })).toEqual({ flowPage: 'pick' });
    expect(backTarget(3, { materialPage: 'languages', flowPage: 'pick' })).toEqual({ step: 2 });
  });
  it('words the toast by how many and what was not offered', () => {
    const base = { count: 2, first: 'Dinka', org: 'O', cluster: 'C' };
    expect(addedToast({ ...base, many: false, notOffered: [] }, say)).toContain('org.newLanguage.added:');
    expect(addedToast({ ...base, many: false, notOffered: ['A', 'B'] }, say)).toContain('org.newLanguage.addedNotOffered');
    expect(addedToast({ ...base, many: true, notOffered: [] }, say)).toContain('clusters.newLanguage.added:');
    expect(addedToast({ ...base, many: true, notOffered: ['A'] }, say)).toContain('clusters.newLanguage.addedNotOffered');
  });
});

describe('offer ranking', () => {
  it('ranks FIA first, examples last, and the World English Bible first', () => {
    expect(['Examples', 'Other', 'FIA guides'].sort((a, b) => fiaRank(a) - fiaRank(b))).toEqual(['FIA guides', 'Other', 'Examples']);
    expect(webRank('World English Bible')).toBeLessThan(webRank('Berean'));
    expect(sharedKey({ org_id: 'o', item_id: 'i' })).toBe('o/i');
  });
});

const doc = (format: string, name: string, language: string, extra: object = {}) => ({ format, name, language, ...extra }) as unknown as LibraryDoc;
const shared = (item_id: string, name: string, org_name: string) => ({ org_id: 'langquest', item_id, name, org_name, latest_hash: `s-${item_id}` }) as unknown as SharedItem;

describe('newLanguageOffers', () => {
  const docs: Record<string, LibraryDoc> = {
    h1: doc('source@1', 'Berean', 'eng'), h2: doc('source@1', 'World English Bible', 'eng'), h3: doc('material@1', 'Notes', 'eng', { kind: 'note' }),
    h4: doc('study@1', 'FIA study guides (English)', 'eng'),
    's-web': doc('source@1', 'World English Bible', 'eng'), 's-guide': doc('study@1', 'Other guides', 'eng'), 's-fra': doc('source@1', 'Louis Segond', 'fra')
  };
  const own = [
    { itemId: 'bsb', name: 'Berean', current: 'h1' }, { itemId: 'web', name: 'World English Bible', current: 'h2' },
    { itemId: 'note', name: 'Notes', current: 'h3' }, { itemId: 'fiaOwn', name: 'FIA study guides (English)', current: 'h4' }
  ];
  const others = [shared('web', 'World English Bible', 'LangQuest'), shared('guide', 'Other guides', 'LangQuest'), shared('fra', 'Louis Segond', 'LangQuest')];
  const member = (itemId: string | null, name: string) => ({ itemId, shared: null, name, language: 'eng', passages: 10 });
  const sets: GuideSet[] = [
    { key: 'ex', pattern: 'ex', name: 'Example guides', members: [member(null, 'Example guides (English)')] },
    { key: 'fia', pattern: 'fia', name: 'FIA study guides', members: [member('fiaOwn', 'FIA study guides (English)')] }
  ];
  const result = newLanguageOffers({ own, others, doc: (h) => docs[h] ?? null, sets, readsAll: ['eng'] });

  it('lists Bibles (own before shared), then guide sets (FIA first), then the rest', () => {
    expect(result.items.map((x) => x.key)).toEqual(['bsb', 'web', 'langquest/web', 'set:fia', 'set:ex', 'note', 'langquest/guide']);
  });
  it('leaves a set member out of the single rows, and other languages out', () => {
    const keys = result.items.map((x) => x.key);
    expect(keys).not.toContain('fiaOwn');
    expect(keys).not.toContain('langquest/fra');
  });
  it('ticks the own World English Bible and FIA\'s set', () => {
    expect([...result.suggested].sort()).toEqual(['set:fia', 'web']);
  });
  it('falls back to the shared Bible when the organization has none, and to the first guide', () => {
    const r = newLanguageOffers({ own: [], others, doc: (h) => docs[h] ?? null, sets: [], readsAll: ['eng'] });
    expect([...r.suggested].sort()).toEqual(['langquest/guide', 'langquest/web']);
  });
  it('offers material in any of the languages the team reads', () => {
    const r = newLanguageOffers({ own: [], others, doc: (h) => docs[h] ?? null, sets: [], readsAll: ['eng', 'fra'] });
    expect(r.items.map((x) => x.key)).toContain('langquest/fra');
  });
});

describe('permission rules', () => {
  const sc = { level: 'org' } as const;
  it('needs the privilege held at the scope', () => {
    expect(mayInviteAt(true, ORG, 'coordinator', sc)).toBe(true);
    expect(mayInviteAt(false, ORG, 'coordinator', sc)).toBe(false);
    expect(mayInviteAt(true, ORG, 'translator', sc)).toBe(false);
    expect(mayInviteAt(true, ORG, 'akol', { level: 'language', languageId: 'din' })).toBe(false);
    expect(mayInviteAt(true, null, 'owner', sc)).toBe(false);
  });
  it('needs it at every scope', () => {
    const din = { level: 'language', languageId: 'din' } as const;
    expect(mayInviteAtAll(true, ORG, 'owner', [sc, din])).toBe(true);
    expect(mayInviteAtAll(true, ORG, 'akol', [sc, din])).toBe(false);
    expect(mayInviteAtAll(false, ORG, 'owner', [sc])).toBe(false);
  });
  it('offers only roles the person could grant, and the one held now', () => {
    const ids = (keep?: string) => grantableRoles(ORG, 'coordinator', sc, keep).map((r) => r.id);
    expect(ids()).toContain('viewer');
    expect(ids()).not.toContain('org_admin');
    expect(ids('org_admin')).toContain('org_admin');
    expect(grantableRoles(ORG, 'owner', sc).map((r) => r.id)).toContain('org_admin');
    expect(grantableRoles(ORG, 'owner', null).length).toBe(0);
    expect(grantableRoles(ORG, 'owner', null, 'viewer').map((r) => r.id)).toEqual(['viewer']);
  });
  it('groups language members by language', () => {
    const { groups, count } = membersByLanguage(memberEntries(ORG));
    expect([...groups.keys()]).toEqual(['din']);
    expect(groups.get('din')!.map((e) => e.profileId)).toEqual(['akol']);
    expect(count).toBe(1);
    expect(membersByLanguage([]).count).toBe(0);
  });
});
