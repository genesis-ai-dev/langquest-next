/**
 * Seed a clean demo project on the hosted database, so every persona in
 * apps/mobile/src/dev.ts has something real to see.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon> npm run seed:demo
 *
 * Every event goes through the real sync client and is signed in as the
 * persona that would do it in the field: the org admin builds the project,
 * the translator records and submits, the reviewer and the coordinator
 * review. So the log reads like a real week of work, and the server's actor
 * and privilege checks pass as they would for a person. Audio cards are
 * copied from an existing project (SOURCE_PROJECT) so reviewers can play them.
 *
 * The story on one lane of "Luke 1–2 (demo)":
 *   Luke 1:1-4    approved (community check and consultant approval done)
 *   Luke 1:5-25   submitted, waiting on the reviewer
 *   Luke 1:26-38  reviewer suggested changes, back with the translator
 *   Luke 1:39-56  translator started recording, not submitted
 *   Luke 1:57-80, 2:1-21  assigned to the translator, not started
 *   Luke 2:22-40, 2:41-52 not assigned (the coordinator assigns them live)
 *
 * It refuses to run twice against the same project id; pick a new
 * DEMO_PROJECT_ID to seed again.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MemoryStore, SupabaseTransport, SyncClient } from '@langquest-next/client';
import {
  applyOrgEvent, emptyOrgState, foldOrg, ORG_PARTITION, REDUCER_VERSION,
  type EventPayloads, type EventType, type OrgEventType, type OrgState
} from '@langquest-next/core';
import { randomUUID } from 'node:crypto';

const URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const PASSWORD = process.env.DEV_PASSWORD ?? process.env.EXPO_PUBLIC_DEV_PASSWORD ?? 'password123';
const ORG = process.env.DEMO_ORG_ID ?? 'org1';
const PROJECT = process.env.DEMO_PROJECT_ID ?? 'luke-demo';
const NAME = process.env.DEMO_PROJECT_NAME ?? 'Luke 1–2 (demo)';
const SOURCE_PROJECT = process.env.DEMO_AUDIO_FROM ?? 'luke-demo-4';
/** Real people who should also own the demo project (comma separated profile ids). */
const EXTRA_OWNERS = (process.env.DEMO_EXTRA_OWNERS ?? '88546f7b-62f3-4975-a4ac-3d9eefc6c994').split(',').filter(Boolean);
const LANE = 'L1';
const BUCKET = 'blobs';

if (!URL || !ANON) throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY (or the EXPO_PUBLIC_ variants).');

const email = (id: string) => `lq-${id}@example.test`;

const PASSAGES = [
  { unitId: 'luk-1-1', label: 'Luke 1:1-4', terms: 'Theophilus, eyewitnesses, servants of the word, orderly account' },
  { unitId: 'luk-1-5', label: 'Luke 1:5-25', terms: 'Zechariah, Elizabeth, temple, incense, angel Gabriel' },
  { unitId: 'luk-1-26', label: 'Luke 1:26-38', terms: 'Mary, Nazareth, virgin, Son of the Most High, Holy Spirit' },
  { unitId: 'luk-1-39', label: 'Luke 1:39-56', terms: 'Elizabeth, blessed, Magnificat, Savior, mercy' },
  { unitId: 'luk-1-57', label: 'Luke 1:57-80', terms: 'John, circumcision, prophet, salvation, covenant' },
  { unitId: 'luk-2-1', label: 'Luke 2:1-21', terms: 'Caesar Augustus, census, manger, shepherds, glory' },
  { unitId: 'luk-2-22', label: 'Luke 2:22-40', terms: 'purification, Simeon, Anna, consolation of Israel' },
  { unitId: 'luk-2-41', label: 'Luke 2:41-52', terms: 'Passover, teachers, my Father’s house, wisdom' }
];

/** Existing takes on SOURCE_PROJECT; copied, never moved. */
const AUDIO = {
  approved: [{ hash: '6e2cd8b4376b5b7428a7a72f83ab6a626da297300fab6095fc4da1dce020838c', durationMs: 1616 }],
  waiting: [{ hash: '5715862253ee0da7da009dba2cca54b80692723d9fb673962d4189a1434f1de1', durationMs: 1708 }],
  changes: [
    { hash: 'b0e673e5f9aaa0c86a11dfef073406649c80cf61b016e62059a7cd5f527b8dd7', durationMs: 2003 },
    { hash: '49e6759ce9ef5585a33c3d84f8fc5f72378fd84e46b6eb00ddf59befb4e88e7f', durationMs: 3496 }
  ],
  draft: [{ hash: '4c1d53a54372d561ce35bd9b88f3445b538723fd3b627c03045d9cf81c8c31fa', durationMs: 1886 }]
};

const STEPS = { community: 'community_check', approval: 'consultant_approval' };

interface Actor {
  id: string;
  sb: SupabaseClient;
  project: SyncClient;
  org: SyncClient<OrgState>;
}

async function signIn(persona: string, create = false, member = true): Promise<Actor> {
  const sb = createClient(URL!, ANON!, { auth: { persistSession: false, autoRefreshToken: false } });
  let res = await sb.auth.signInWithPassword({ email: email(persona), password: PASSWORD });
  if (res.error && create) {
    const up = await sb.auth.signUp({ email: email(persona), password: PASSWORD });
    if (up.error) throw new Error(`${persona}: ${up.error.message}`);
    res = await sb.auth.signInWithPassword({ email: email(persona), password: PASSWORD });
  }
  if (res.error || !res.data.user) throw new Error(`${persona}: ${res.error?.message ?? 'no user'}`);
  const id = res.data.user.id;
  const transport = new SupabaseTransport(sb);
  const store = new MemoryStore();
  const common = { orgId: ORG, actorId: id, deviceId: `seed-${persona}`, store, transport, newId: () => randomUUID() };
  const org = new SyncClient<OrgState>({
    ...common, projectId: ORG_PARTITION,
    materializer: { empty: emptyOrgState, apply: applyOrgEvent, fold: foldOrg, compact: (s) => { s.appliedEventIds = {}; }, version: REDUCER_VERSION }
  });
  const project = new SyncClient({ ...common, projectId: PROJECT });
  await Promise.all([org.load(), project.load()]);
  if (member) {
    await drain(org);
    await drain(project);
  }
  console.log(`signed in as ${persona} (${id})`);
  return { id, sb, project, org };
}

async function drain(c: SyncClient<any>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const r = await c.sync();
    if (r.refused) throw new Error(`refused: ${r.refused}`);
    if (r.rejected) throw new Error(`server rejected ${r.rejected} event(s); see the rejected rows in the local store`);
    if (r.offline) throw new Error('server unreachable');
    if (!r.more && (await c.pendingCount()) === 0) return;
  }
  throw new Error('sync did not settle');
}

async function emit<T extends EventType>(a: Actor, type: T, payload: EventPayloads[T]): Promise<void> {
  await a.project.append(type, payload);
}

async function emitOrg<T extends OrgEventType>(a: Actor, type: T, payload: EventPayloads[T]): Promise<void> {
  await a.org.append(type, payload);
}

/** Copy a card from SOURCE_PROJECT into the demo project's prefix (the trigger confirms it). */
async function copyCard(a: Actor, hash: string): Promise<void> {
  const from = `${ORG}/${SOURCE_PROJECT}/${hash}.wav`;
  const to = `${ORG}/${PROJECT}/${hash}.wav`;
  const { data, error } = await a.sb.storage.from(BUCKET).download(from);
  if (error || !data) throw new Error(`download ${from}: ${error?.message ?? 'no data'}`);
  const up = await a.sb.storage.from(BUCKET).upload(to, data, { upsert: true, contentType: 'audio/wav' });
  if (up.error) throw new Error(`upload ${to}: ${up.error.message}`);
}

/** Record cards, compose a take, select it; optionally submit. Returns the take id. */
async function record(a: Actor, unitId: string, cards: { hash: string; durationMs: number }[], submit: boolean): Promise<string> {
  for (const c of cards) {
    await copyCard(a, c.hash);
    await emit(a, 'v1.RecordingAdded', { recordingId: randomUUID(), unitId, laneId: LANE, kind: 'target', cards: [{ ...c, format: 'wav' }] });
  }
  const takeId = `take:${randomUUID()}`;
  await emit(a, 'v1.TakeComposed', { takeId, unitId, laneId: LANE, cardHashes: cards.map((c) => c.hash), parentTakeId: null });
  await emit(a, 'v1.TakeSelected', { unitId, laneId: LANE, takeId });
  if (submit) await emit(a, 'v1.TakeSubmitted', { takeId });
  return takeId;
}

async function main() {
  const owner = await signIn('owner');
  if (owner.project.getState().project) {
    throw new Error(`${ORG}/${PROJECT} already exists. Set DEMO_PROJECT_ID to seed a fresh one.`);
  }
  const coordinator = await signIn('coordinator', true);
  const translator = await signIn('translator', true);
  const reviewer = await signIn('reviewer', true);
  const viewer = await signIn('viewer', true);
  // Exists so "No organization" can be walked through; no membership at all.
  await signIn('noorg', true, false);

  // --- Org partition: register the project; the coordinator is a project admin, not an org admin.
  const orgState = owner.org.getState();
  await emitOrg(owner, 'v1.ProjectRegistered', { projectId: PROJECT, name: NAME });
  const members = [
    { a: coordinator, roleId: 'project_coordinator', name: 'Cora (coordinator)', projectScoped: true },
    { a: translator, roleId: 'translator', name: 'Tomas (translator)', projectScoped: false },
    { a: reviewer, roleId: 'reviewer', name: 'Rhoda (reviewer)', projectScoped: false },
    { a: viewer, roleId: 'viewer', name: 'Victor (viewer)', projectScoped: false }
  ];
  for (const m of members) {
    const held = Object.values(orgState.members[m.a.id] ?? {}).filter((x) => !x.removed.value);
    if (m.projectScoped) {
      // An org-wide coordinator lands on the org home like the org admin does,
      // which hides the project admin's own home. Narrow it to this project.
      for (const x of held) if (x.scope.level === 'org') await emitOrg(owner, 'v1.OrgMemberRemoved', { profileId: m.a.id, scope: x.scope });
      await emitOrg(owner, 'v1.OrgMemberAdded', { profileId: m.a.id, roleId: m.roleId, scope: { level: 'project', projectId: PROJECT }, displayName: m.name });
    } else if (!held.some((x) => x.scope.level === 'org')) {
      await emitOrg(owner, 'v1.OrgMemberAdded', { profileId: m.a.id, roleId: m.roleId, scope: { level: 'org' }, displayName: m.name });
    }
  }
  await drain(owner.org);

  // --- Project partition: structure, people, work.
  await emit(owner, 'v1.ProjectCreated', { name: NAME, sourceLanguoidId: 'eng' });
  await emit(owner, 'v1.MemberAdded', { profileId: owner.id, role: 'owner' });
  for (const id of EXTRA_OWNERS) if (id !== owner.id) await emit(owner, 'v1.MemberAdded', { profileId: id, role: 'owner' });
  await emit(owner, 'v1.MemberAdded', { profileId: coordinator.id, role: 'coordinator' });
  await emit(owner, 'v1.MemberAdded', { profileId: translator.id, role: 'translator' });
  await emit(owner, 'v1.MemberAdded', { profileId: reviewer.id, role: 'reviewer' });
  await emit(owner, 'v1.MemberAdded', { profileId: viewer.id, role: 'viewer' });
  await emit(owner, 'v1.ProjectConfigChanged', {
    config: {
      unitKinds: [
        { id: 'book', label: 'Book', childKinds: ['passage'] },
        { id: 'passage', label: 'Passage', childKinds: [] }
      ],
      workflow: [
        { id: STEPS.community, label: 'Community check', role: 'reviewer', required: true, rule: 'any' },
        { id: STEPS.approval, label: 'Consultant approval', role: 'coordinator', required: true, rule: 'any' }
      ]
    }
  });
  await emit(owner, 'v1.LaneAdded', { laneId: LANE, languoidId: 'und' });
  await emit(owner, 'v1.UnitAdded', { unitId: 'luk', parentUnitId: null, kind: 'book', label: 'Luke', order: 'a' });
  for (const [i, p] of PASSAGES.entries()) {
    await emit(owner, 'v1.UnitAdded', { unitId: p.unitId, parentUnitId: 'luk', kind: 'passage', label: p.label, order: `a${i}` });
    await emit(owner, 'v1.ReferenceAttached', { unitId: p.unitId, refId: `${p.unitId}-terms`, kind: 'key_terms', text: p.terms });
  }
  await drain(owner.project);

  // The coordinator hands out the first six passages; the last two stay open.
  await drain(coordinator.project);
  const dueDates = ['Sep 26', 'Sep 26', 'Sep 29', 'Sep 30', 'Oct 3', 'Oct 6'];
  for (const [i, p] of PASSAGES.slice(0, 6).entries()) {
    await emit(coordinator, 'v1.AssignmentMade', { unitId: p.unitId, laneId: LANE, profileId: translator.id, role: 'translator', dueDate: dueDates[i]! });
    if (i < 4) await emit(coordinator, 'v1.AssignmentMade', { unitId: p.unitId, laneId: LANE, profileId: reviewer.id, role: 'reviewer' });
  }
  await drain(coordinator.project);

  // The translator's week.
  await drain(translator.project);
  const approvedTake = await record(translator, PASSAGES[0]!.unitId, AUDIO.approved, true);
  await record(translator, PASSAGES[1]!.unitId, AUDIO.waiting, true);
  const changesTake = await record(translator, PASSAGES[2]!.unitId, AUDIO.changes, true);
  await record(translator, PASSAGES[3]!.unitId, AUDIO.draft, false);
  await drain(translator.project);

  // The reviewer approves one and asks for changes on another.
  await drain(reviewer.project);
  await emit(reviewer, 'v1.ReviewSubmitted', { takeId: approvedTake, stepId: STEPS.community, decision: 'approve', comment: 'Clear and natural. Theophilus is pronounced well.' });
  await emit(reviewer, 'v1.ReviewSubmitted', { takeId: changesTake, stepId: STEPS.community, decision: 'suggest_changes', comment: 'Verse 35 goes too fast; please slow down at “the Holy Spirit will come upon you”.' });
  await drain(reviewer.project);

  // The coordinator gives consultant approval on the first passage.
  await drain(coordinator.project);
  await emit(coordinator, 'v1.ReviewSubmitted', { takeId: approvedTake, stepId: STEPS.approval, decision: 'approve' });
  await drain(coordinator.project);

  console.log(`\nSeeded ${ORG}/${PROJECT} "${NAME}".`);
  for (const [who, a] of [['owner', owner], ['coordinator', coordinator], ['translator', translator], ['reviewer', reviewer], ['viewer', viewer]] as const) {
    console.log(`  ${who.padEnd(12)} ${email(who)}  ${a.id}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
