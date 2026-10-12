import { describe, expect, it } from 'vitest';
import { derivePassage, foldLanguage, foldOrg, ORG_EVENT_TYPES, ORG_STREAM, privilegeAllows, privilegeFor, privilegesFor, SEED_ROLES, validateEvent, type EventEnvelope } from '@langquest-next/core';
import { copyBlobs, mapOrgSeed, mapV2Project, type V2Rows } from '../src/v2import';

const OWNER = 'owner-1';
const TRANSLATOR = 'trans-1';
const REVIEWER = 'rev-1';

function rows(): V2Rows {
  return {
    project: { id: 'p1', name: 'Demo', description: null, created_at: '2025-06-01T00:00:00Z', creator_id: null },
    languages: [
      { language_type: 'source', languoid_id: 'lang-src', active: true },
      { language_type: 'target', languoid_id: 'lang-tgt', active: true }
    ],
    members: [
      { profile_id: OWNER, membership: 'owner', active: true, created_at: '2025-06-01T00:00:00Z' },
      { profile_id: TRANSLATOR, membership: 'member', active: true, created_at: '2025-06-02T00:00:00Z' },
      { profile_id: 'gone', membership: 'member', active: false, created_at: '2025-06-02T00:00:00Z' }
    ],
    quests: [
      { id: 'q1', name: 'Creation', created_at: '2025-06-03T00:00:00Z' },
      { id: 'q2', name: 'The Fall', created_at: '2025-06-04T00:00:00Z' }
    ],
    questAssets: [
      { quest_id: 'q1', asset_id: 'a1', order_index: 0 },
      { quest_id: 'q1', asset_id: 'a2', order_index: 1 },
      { quest_id: 'q2', asset_id: 'a3', order_index: 0 }
    ],
    assets: [
      {
        id: 'a1', name: 'Gen 1:1', source_asset_id: null, creator_id: null, created_at: '2025-06-03T01:00:00Z',
        content: [{ text: 'In the beginning', audio: ['content/gen1_1.m4a'] }]
      },
      { id: 'a2', name: 'Gen 1:2', source_asset_id: null, creator_id: null, created_at: '2025-06-03T02:00:00Z', content: [{ text: 'The earth', audio: null }] },
      { id: 'a3', name: 'Gen 3:1', source_asset_id: null, creator_id: null, created_at: '2025-06-04T01:00:00Z', content: [] },
      {
        id: 't1', name: null, source_asset_id: 'a1', creator_id: TRANSLATOR, created_at: '2025-07-01T00:00:00Z',
        content: [{ text: '', audio: ['rec-1.m4a', 'rec-2.m4a'] }]
      },
      { id: 't2', name: null, source_asset_id: 'a2', creator_id: TRANSLATOR, created_at: '2025-07-02T00:00:00Z', content: [{ text: 'text only', audio: [] }] },
      { id: 'orphan', name: 'No quest', source_asset_id: null, creator_id: null, created_at: '2025-07-03T00:00:00Z', content: [] }
    ],
    votes: [
      { id: 'v1', asset_id: 't1', polarity: 'up', comment: null, creator_id: REVIEWER, created_at: '2025-07-05T00:00:00Z' },
      { id: 'v2', asset_id: 't1', polarity: 'down', comment: 'again', creator_id: OWNER, created_at: '2025-07-06T00:00:00Z' },
      // A member who recorded and also voted: needs a role the server lets do both.
      { id: 'v3', asset_id: 't1', polarity: 'up', comment: null, creator_id: TRANSLATOR, created_at: '2025-07-07T00:00:00Z' }
    ]
  };
}

const blobs = new Map([
  ['content/gen1_1.m4a', { hash: 'h-src', durationMs: 1000 }],
  ['rec-1.m4a', { hash: 'h-1', durationMs: 2000 }],
  ['rec-2.m4a', { hash: 'h-2', durationMs: 3000 }]
]);

const opts = { orgId: 'org1', blobs };

describe('mapV2Project', () => {
  it('produces valid events that fold into the expected language', () => {
    const { events, report, language } = mapV2Project(rows(), opts);
    for (const e of events) expect(validateEvent(e), e.type).toBeNull();
    // One v2 project is one language: its stream id is the project id, and
    // nothing in it belongs to the organization stream.
    expect(new Set(events.map((e) => `${e.orgId}/${e.streamId}`))).toEqual(new Set(['org1/p1']));
    expect(events.filter((e) => (ORG_EVENT_TYPES as readonly string[]).includes(e.type))).toEqual([]);
    expect(language).toMatchObject({ languageId: 'p1', name: 'Demo', code: 'lang-tgt', sourceCode: 'lang-src' });

    const state = foldLanguage(events);
    expect(Object.keys(state.invalidEvents)).toHaveLength(0);
    const units = Object.values(state.units);
    expect(units.filter((u) => u.kind === 'book').map((u) => u.label)).toEqual(['Creation', 'The Fall']);
    expect(units.filter((u) => u.kind === 'passage')).toHaveLength(3);
    // The orphan asset has no quest: it is reported, not silently dropped.
    expect(report.unlinkedAssets).toBe(1);
    // Source text and audio become one source material per passage, a field each.
    expect(Object.keys(state.materials).sort()).toEqual(['v2src:a1', 'v2src:a2']);
    const a1 = state.materials['v2src:a1']!;
    expect(a1).toMatchObject({ kind: 'source', scope: { unitId: 'a1' } });
    expect(a1.fields['0:text']?.value.text).toBe('In the beginning');
    expect(a1.fields['0:audio:0']?.value.blobHash).toBe('h-src');
    expect(state.materials['v2src:a2']?.fields['0:text']?.value.text).toBe('The earth');
    expect(report.references).toBe(3);
    // The audio translation is a take with one card per v2 audio file, submitted.
    const takes = Object.entries(state.takes);
    expect(takes).toHaveLength(1);
    expect(takes[0]?.[1].cardHashes).toEqual(['h-1', 'h-2']);
    expect(Object.keys(state.submissions)).toHaveLength(1);
    // Text-only translations have no place in an oral log: counted, not dropped silently.
    expect(report.textOnlyTranslations).toBe(1);
    // Votes are community reviews in a one-step custom flow; down votes carry the comment.
    const passage = derivePassage(state, 'a1');
    expect(passage.flow.steps.map((st) => st.kindIds)).toEqual([['community']]);
    const byActor = new Map(passage.reviews.map((r) => [r.by, r]));
    expect(byActor.get(REVIEWER)).toMatchObject({ kindId: 'community', outcome: 'looks_good' });
    expect(byActor.get(OWNER)).toMatchObject({ outcome: 'needs_changes', comment: 'again' });
    expect(byActor.get(TRANSLATOR)?.outcome).toBe('looks_good');
    expect(passage.versions).toHaveLength(1);
    // Roles follow what people did: owner stays owner, a member who recorded
    // and voted becomes coordinator (may do both), a voter-only is a reviewer.
    expect(Object.fromEntries(language.roles)).toEqual({ [OWNER]: 'owner', [TRANSLATOR]: 'coordinator', [REVIEWER]: 'reviewer' });
  });

  it('is deterministic: the same rows map to the same event ids and clocks', () => {
    const a = mapV2Project(rows(), opts).events;
    const b = mapV2Project(rows(), opts).events;
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
    expect(a.map((e) => e.hlc)).toEqual(b.map((e) => e.hlc));
    expect(new Set(a.map((e) => e.id)).size).toBe(a.length);
  });

  it('refuses a project with two active target languages', () => {
    // Why: a language here is one target language (decision 63). Splitting
    // one v2 project's work between two would have to guess whose take is
    // whose; v2 never did this in practice, so the import stops instead.
    const two = rows();
    two.languages.push({ language_type: 'target', languoid_id: 'lang-tgt2', active: true });
    expect(() => mapV2Project(two, opts)).toThrow(/2 target languages/);
    // An inactive second target is not a second language.
    const inactive = rows();
    inactive.languages.push({ language_type: 'target', languoid_id: 'lang-tgt2', active: false });
    expect(mapV2Project(inactive, opts).language.code).toBe('lang-tgt');
  });

  it('grants extra members so a demo account can open the language', () => {
    const { language } = mapV2Project(rows(), { ...opts, grant: [{ profileId: 'demo', role: 'coordinator' }] });
    expect(language.roles.get('demo')).toBe('coordinator');
    const org = foldOrg(mapOrgSeed('org1', 'Demo org', OWNER, [language], '2025-06-01T00:00:00Z'));
    expect(privilegesFor(org, 'demo', 'p1').has('assign_work')).toBe(true);
  });

  it('skips audio the blob step could not provide and reports it', () => {
    const partial = new Map(blobs);
    partial.delete('rec-2.m4a');
    const { events, report } = mapV2Project(rows(), { ...opts, blobs: partial });
    const state = foldLanguage(events);
    expect(Object.values(state.takes)[0]?.cardHashes).toEqual(['h-1']);
    expect(report.missingAudio).toEqual(['rec-2.m4a']);
  });
});

describe('mapOrgSeed', () => {
  const seeded = () => {
    const mapped = mapV2Project(rows(), opts);
    const org = mapOrgSeed('org1', 'Demo org', mapped.owner, [mapped.language], '2025-06-01T00:00:00Z');
    return { ...mapped, org };
  };

  it('bootstraps in an order the server accepts: the organization, its roles, then the owner', () => {
    const { org, owner } = seeded();
    expect(owner).toBe(OWNER);
    for (const e of org) expect(validateEvent(e), e.type).toBeNull();
    expect(new Set(org.map((e) => `${e.orgId}/${e.streamId}/${e.actorId}`))).toEqual(new Set([`org1/${ORG_STREAM}/${OWNER}`]));
    expect(org[0]?.type).toBe('v1.OrgCreated');
    expect(org.slice(1, 1 + SEED_ROLES.length).map((e) => e.type)).toEqual(SEED_ROLES.map(() => 'v1.RoleDefined'));
    expect(org[1 + SEED_ROLES.length]).toMatchObject({
      type: 'v1.MemberAdded', payload: { profileId: OWNER, roleId: 'org_admin', scope: { level: 'org' } }
    });
    expect(new Set(org.map((e) => e.id)).size).toBe(org.length);
  });

  it('lists the language and grants language-scope memberships to the people who worked in it', () => {
    const { org } = seeded();
    const added = org.findIndex((e) => e.type === 'v1.LanguageAdded');
    expect(org[added]?.payload).toEqual({ languageId: 'p1', name: 'Demo', code: 'lang-tgt', sourceCode: 'lang-src' });
    const grants = org.filter((e): e is EventEnvelope<'v1.MemberAdded'> => e.type === 'v1.MemberAdded' && e.payload.scope.level === 'language');
    expect(grants.map((e) => e.payload).sort((a, b) => (a.profileId < b.profileId ? -1 : 1))).toEqual([
      { profileId: REVIEWER, roleId: 'reviewer', scope: { level: 'language', languageId: 'p1' } },
      { profileId: TRANSLATOR, roleId: 'coordinator', scope: { level: 'language', languageId: 'p1' } }
    ]);
    // The language is listed before anyone is granted a role in it.
    for (const g of grants) expect(org.indexOf(g)).toBeGreaterThan(added);

    const state = foldOrg(org);
    expect(state.languages['p1']?.added?.name).toBe('Demo');
    // Language scope covers that language only; the owner's org scope covers every one.
    expect(privilegesFor(state, TRANSLATOR, 'p1').has('translate')).toBe(true);
    expect(privilegesFor(state, TRANSLATOR).size).toBe(0);
    expect(privilegesFor(state, TRANSLATOR, 'elsewhere').size).toBe(0);
    expect(privilegesFor(state, OWNER, 'elsewhere').has('manage_structure')).toBe(true);
    expect(state.members['gone']).toBeUndefined();
  });

  it('gives every author of a language event the privilege that event needs there', () => {
    // Why: the server checks each event against the actor's privileges for
    // the language; an import that writes something its author may not
    // would be refused halfway.
    const { events, org } = seeded();
    const state = foldOrg(org);
    for (const e of events) {
      expect(privilegeAllows(privilegeFor(e), privilegesFor(state, e.actorId, 'p1')), `${e.type} by ${e.actorId}`).toBe(true);
    }
  });

  it('is deterministic, so a re-run appends nothing new', () => {
    const a = seeded().org;
    const b = seeded().org;
    expect(a.map((e) => [e.id, e.hlc])).toEqual(b.map((e) => [e.id, e.hlc]));
  });
});

describe('copyBlobs', () => {
  const deps = (download: (name: string) => Promise<Uint8Array | null>, uploaded: string[] = []) => ({
    download,
    digest: async (b: Uint8Array) => `h${b[0]}`,
    durationMs: async () => 1000,
    upload: async (_o: string, _p: string, hash: string) => void uploaded.push(hash),
    backoff: async () => {},
    uploaded
  });

  it('retries a flaky transfer and keeps the blob', async () => {
    let calls = 0;
    const d = deps(async () => {
      calls += 1;
      if (calls < 3) throw new Error('ECONNRESET');
      return new Uint8Array([7]);
    });
    const { blobs, failed } = await copyBlobs(['a.m4a'], 'o', 'p', d);
    expect(failed).toEqual([]);
    expect(blobs.get('a.m4a')?.hash).toBe('h7');
    expect(calls).toBe(3);
  });

  it('gives up after the attempt limit and says how many it made', async () => {
    const d = deps(async () => {
      throw new Error('ECONNRESET');
    });
    const { blobs, failed } = await copyBlobs(['a.m4a'], 'o', 'p', { ...d, attempts: 2 });
    expect(blobs.size).toBe(0);
    expect(failed[0]?.reason).toContain('after 2 attempts');
  });

  it('does not retry an object v2 does not have', async () => {
    let calls = 0;
    const d = deps(async () => {
      calls += 1;
      return null;
    });
    const { failed } = await copyBlobs(['gone.m4a'], 'o', 'p', d);
    expect(calls).toBe(1);
    expect(failed[0]?.reason).toBe('not found in v2 bucket');
  });

  it('skips uploading a hash the target log already confirms', async () => {
    const uploaded: string[] = [];
    const d = deps(async () => new Uint8Array([7]), uploaded);
    await copyBlobs(['a.m4a'], 'o', 'p', { ...d, alreadyStored: new Set(['h7']) });
    expect(uploaded).toEqual([]);
  });
});
