import { describe, expect, it } from 'vitest';
import { deriveTakeStatus, fold, validateEvent } from '@langquest-next/core';
import { copyBlobs, mapV2Project, type V2Rows } from '../src/v2import';

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

describe('mapV2Project', () => {
  it('produces valid events that fold into the expected partition', () => {
    const { events, report } = mapV2Project(rows(), { orgId: 'org1', blobs });
    for (const e of events) expect(validateEvent(e), e.type).toBeNull();
    const state = fold(events);
    expect(Object.keys(state.invalidEvents)).toHaveLength(0);
    expect(state.partition?.value.name).toBe('Demo');
    expect(Object.keys(state.lanes)).toHaveLength(1);
    const laneId = Object.keys(state.lanes)[0]!;
    expect(state.lanes[laneId]?.languoidId).toBe('lang-tgt');
    const units = Object.values(state.units);
    expect(units.filter((u) => u.kind === 'book').map((u) => u.label)).toEqual(['Creation', 'The Fall']);
    expect(units.filter((u) => u.kind === 'passage')).toHaveLength(3);
    // The orphan asset has no quest: it is reported, not silently dropped.
    expect(report.unlinkedAssets).toBe(1);
    // Source text and audio become reference material on the passage.
    const refs = Object.values(state.references);
    expect(refs.map((r) => r.kind).sort()).toEqual(['source_audio', 'source_text', 'source_text']);
    expect(refs.find((r) => r.kind === 'source_audio')?.blobHash).toBe('h-src');
    // The audio translation is a take with one card per v2 audio file, submitted.
    const takes = Object.entries(state.takes);
    expect(takes).toHaveLength(1);
    expect(takes[0]?.[1].cardHashes).toEqual(['h-1', 'h-2']);
    expect(Object.keys(state.submissions)).toHaveLength(1);
    // Text-only translations have no place in an oral log: counted, not dropped silently.
    expect(report.textOnlyTranslations).toBe(1);
    // Votes are reviews on the community step; down votes carry the comment.
    const takeId = takes[0]![0];
    const byActor = state.reviews[takeId]?.['community'] ?? {};
    expect(byActor[REVIEWER]?.value.decision).toBe('approve');
    expect(byActor[OWNER]?.value).toMatchObject({ decision: 'suggest_changes', comment: 'again' });
    // Roles follow what people did: owner stays owner, a member who recorded
    // and voted becomes coordinator (may emit both), a voter-only is a reviewer.
    expect(state.members[OWNER]?.role.value).toBe('owner');
    expect(state.members[TRANSLATOR]?.role.value).toBe('coordinator');
    expect(byActor[TRANSLATOR]?.value.decision).toBe('approve');
    expect(state.members[REVIEWER]?.role.value).toBe('reviewer');
    expect(state.members['gone']).toBeUndefined();
    expect(deriveTakeStatus(state, takeId)).toBeDefined();
  });

  it('is deterministic: the same rows map to the same event ids and clocks', () => {
    const a = mapV2Project(rows(), { orgId: 'org1', blobs }).events;
    const b = mapV2Project(rows(), { orgId: 'org1', blobs }).events;
    expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
    expect(a.map((e) => e.hlc)).toEqual(b.map((e) => e.hlc));
    expect(new Set(a.map((e) => e.id)).size).toBe(a.length);
  });

  it('bootstraps in an order the server accepts: partition, then the owner, then everything else', () => {
    const { events } = mapV2Project(rows(), { orgId: 'org1', blobs });
    expect(events[0]?.type).toBe('v1.PartitionCreated');
    expect(events[1]).toMatchObject({ type: 'v1.MemberAdded', actorId: OWNER, payload: { profileId: OWNER, role: 'owner' } });
    const firstByOther = events.findIndex((e) => e.actorId !== OWNER);
    const memberAddedForThat = events.findIndex((e) => e.type === 'v1.MemberAdded' && (e.payload as { profileId: string }).profileId === events[firstByOther]!.actorId);
    expect(memberAddedForThat).toBeLessThan(firstByOther);
  });

  it('grants extra members so a demo account can open the partition', () => {
    const { events } = mapV2Project(rows(), { orgId: 'org1', blobs, grant: [{ profileId: 'demo', role: 'owner' }] });
    const state = fold(events);
    expect(state.members['demo']?.role.value).toBe('owner');
  });

  it('skips audio the blob step could not provide and reports it', () => {
    const partial = new Map(blobs);
    partial.delete('rec-2.m4a');
    const { events, report } = mapV2Project(rows(), { orgId: 'org1', blobs: partial });
    const state = fold(events);
    expect(Object.values(state.takes)[0]?.cardHashes).toEqual(['h-1']);
    expect(report.missingAudio).toEqual(['rec-2.m4a']);
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
