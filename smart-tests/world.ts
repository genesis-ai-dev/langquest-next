// A fresh, isolated world per journey, built through the real server: every
// seed event passes the same authorization and validation a phone's would,
// so a seed that drifts from the event catalog fails here, loudly.
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import {
  applyOrgEvent, CATALOG_VERSION, emptyOrgState, foldOrg, instantiateFlowV2, instantiateQuestionSet, ORG_PARTITION, QUESTION_TEMPLATES, questionSetMaterialId, REDUCER_VERSION, SEED_ROLES,
  type EventPayloads, type EventType, type OrgState
} from '@langquest-next/core';
import { MemoryStore, SupabaseTransport, SyncClient, type Materializer } from '@langquest-next/client';
import { VOICE_WAV } from './fixtures/voice';

const SUPABASE_URL = process.env['EXPO_PUBLIC_SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
const ANON = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] ?? '';

/** Same fold as apps/mobile/src/useOrg.ts (which imports Expo, so it cannot load here). */
const ORG_MATERIALIZER: Materializer<OrgState> = {
  empty: emptyOrgState, apply: applyOrgEvent, fold: foldOrg,
  compact: (s) => { s.appliedEventIds = {}; }, version: REDUCER_VERSION
};

/** Read from the app so a terms bump cannot silently put a terms screen in every journey. */
const TERMS_VERSION = /TERMS_VERSION = '([^']+)'/.exec(
  readFileSync(new URL('../apps/mobile/src/accountData.ts', import.meta.url), 'utf8'))![1]!;

export interface Person { id: string; email: string; sb: SupabaseClient; session: Session }
export interface World {
  orgId: string;
  partitionId: string;
  laneId: string;
  passages: { unitId: string; label: string }[];
  owner: Person;
  translator: Person;
  /** In the partition but assigned to nobody: a passage someone still has to be asked to record. */
  unassigned: { unitId: string; label: string };
  /** Present only when asked for (seedTranslatorWorld options). */
  reviewer?: Person;
  coordinator?: Person;
}

/** A translator's Version 1 of passages[0], submitted for the community step, with real audio on the server. */
export interface SubmittedWorld extends World {
  reviewer: Person;
  stepId: string;
  /** With `v2Flow`: the one kind the step holds. */
  kindId?: string;
  /** Required questions the reviewer must answer or skip, as `${materialId}#${fieldId}`. */
  requiredQuestionIds: string[];
  version1: { takeId: string; hash: string };
  /** With `secondVersion`: Version 1 of passages[1], same audio. */
  version1b?: { takeId: string };
}

async function person(role: string): Promise<Person> {
  if (!ANON) throw new Error('EXPO_PUBLIC_SUPABASE_ANON_KEY is not set (smart-tests/run.sh reads it from supabase status).');
  const sb = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `smart-${role}-${Date.now()}-${randomUUID().slice(0, 8)}@example.test`;
  const { data, error } = await sb.auth.signUp({ email, password: 'smart-test-password' });
  if (error || !data.user || !data.session) throw new Error(`sign-up for ${role} failed: ${error?.message ?? 'no session'}`);
  return { id: data.user.id, email, sb, session: data.session };
}

type Intent = { type: EventType; payload: EventPayloads[EventType] };
const intent = <T extends EventType>(type: T, payload: EventPayloads[T]): Intent => ({ type, payload });

async function commit<S>(client: SyncClient<S>, intents: Intent[], what: string) {
  await client.appendMany(intents);
  const result = await client.sync();
  if (result.offline || result.refused || result.rejected || result.pushed !== intents.length) {
    throw new Error(`seed ${what}: ${JSON.stringify(result)}`);
  }
}

/**
 * An org and partition exactly as CreateOrg (apps/mobile/src/screens/entry.tsx)
 * makes them, plus a translator with an org role, a partition membership and
 * every passage assigned — what DevMenu's "Seed demo team" gives one — and
 * one more passage nobody is asked to record. A reviewer or coordinator
 * joins (org role and partition membership) only when asked for.
 */
export async function seedTranslatorWorld(options: { reviewer?: boolean; coordinator?: boolean } = {}): Promise<World> {
  const [owner, translator, reviewer, coordinator] = await Promise.all([person('owner'), person('translator'),
    options.reviewer ? person('reviewer') : undefined, options.coordinator ? person('coordinator') : undefined]);
  const orgId = randomUUID(), partitionId = randomUUID(), laneId = 'L1';
  const passages = ['Luke 1:1-4', 'Luke 1:5-25'].map((label, i) => ({ unitId: `luke-${i}`, label }));
  const unassigned = { unitId: 'luke-2', label: 'Luke 2:1-7' };
  const client = <S,>(partition: string, materializer?: Materializer<S>) => clientFor(owner, orgId, partition, materializer);

  const org = client(ORG_PARTITION, ORG_MATERIALIZER);
  await org.load();
  await commit(org, [
    intent('v1.OrgCreated', { name: 'Smart test org' }),
    ...SEED_ROLES.map((r) => intent('v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges })),
    intent('v1.OrgMemberAdded', { profileId: owner.id, roleId: 'org_admin', scope: { level: 'org' }, displayName: 'owner' }),
    intent('v1.PartitionRegistered', { partitionId, name: 'Luke' }),
    intent('v1.OrgMemberAdded', { profileId: translator.id, roleId: 'translator', scope: { level: 'org' }, displayName: 'translator' }),
    ...(reviewer ? [intent('v1.OrgMemberAdded', { profileId: reviewer.id, roleId: 'reviewer', scope: { level: 'org' }, displayName: 'reviewer' })] : []),
    ...(coordinator ? [intent('v1.OrgMemberAdded', { profileId: coordinator.id, roleId: 'coordinator', scope: { level: 'org' }, displayName: 'coordinator' })] : [])
  ], 'org');

  const partition = client(partitionId);
  await partition.load();
  await commit(partition, [
    intent('v1.PartitionCreated', { name: 'Luke', sourceLanguoidId: 'eng' }),
    intent('v1.MemberAdded', { profileId: owner.id, role: 'owner' }),
    intent('v1.PartitionConfigChanged', { config: {
      unitKinds: [{ id: 'book', label: 'Book', childKinds: ['passage'] }, { id: 'passage', label: 'Passage', childKinds: [] }],
      workflow: [{ id: 'community', role: 'reviewer', required: true, rule: 'any' }]
    } }),
    intent('v1.LaneAdded', { laneId, languoidId: 'und' }),
    intent('v1.UnitAdded', { unitId: 'luke', parentUnitId: null, kind: 'book', label: 'Luke', order: 'a' }),
    ...[...passages, unassigned].map((p, i) => intent('v1.UnitAdded', { unitId: p.unitId, parentUnitId: 'luke', kind: 'passage', label: p.label, order: `a${i}` })),
    intent('v1.MemberAdded', { profileId: translator.id, role: 'translator' }),
    ...(reviewer ? [intent('v1.MemberAdded', { profileId: reviewer.id, role: 'reviewer' })] : []),
    ...(coordinator ? [intent('v1.MemberAdded', { profileId: coordinator.id, role: 'coordinator' })] : []),
    ...passages.map((p) => intent('v1.AssignmentMade', { unitId: p.unitId, laneId, profileId: translator.id, role: 'translator' }))
  ], 'partition');

  for (const p of [owner, translator, reviewer, coordinator]) if (p) await firstRunDone(p);
  return { orgId, partitionId, laneId, passages, owner, translator, unassigned,
    ...(reviewer ? { reviewer } : {}), ...(coordinator ? { coordinator } : {}) };
}

function clientFor<S>(who: Person, orgId: string, partition: string, materializer?: Materializer<S>): SyncClient<S> {
  return new SyncClient<S>({
    ...(materializer ? { materializer } : {}),
    orgId, partitionId: partition, actorId: who.id, deviceId: `seed-${who.id}`,
    store: new MemoryStore(), transport: new SupabaseTransport(who.sb), newId: () => randomUUID()
  });
}

/** First-run screens are recorded on the server, with the app's own ids (accountData.ts). */
async function firstRunDone(who: Person) {
  for (const [type, payload, key] of [['v1.TermsAccepted', { version: TERMS_VERSION }, TERMS_VERSION], ['v1.VisionSeen', {}, '1']] as const) {
    const { error } = await who.sb.rpc('record_user_event', { p_id: `${who.id}:${type}:${key}`, p_type: type, p_payload: payload });
    if (error) throw new Error(`seed ${type}: ${error.message}`);
  }
}

/**
 * The translator world plus a reviewer asked to review passages[0], the
 * catalog's community questions linked to the review step, and the
 * translator's Version 1 of that passage submitted with its audio uploaded
 * exactly as the app uploads it (so the storage trigger confirms it).
 * With `feedback`, the reviewer has already asked for changes on it.
 */
export async function seedSubmittedWorld(options: {
  feedback?: string; v2Flow?: boolean;
  /** A ready-made v2 flow other than "One check" (implies v2). */
  flowId?: string;
  /** Also submit Version 1 of passages[1] (a session covering two passages). */
  secondVersion?: boolean;
} = {}): Promise<SubmittedWorld> {
  const world = await seedTranslatorWorld({ reviewer: true });
  const reviewer = world.reviewer!;
  const { orgId, partitionId, laneId, owner, translator } = world;
  const unitId = world.passages[0]!.unitId;
  // v2Flow: the lane runs the ready-made "One check" flow (one v2 step, Peer Review).
  const flowId = options.flowId ?? (options.v2Flow ? 'one_check' : undefined);
  const flow = flowId ? instantiateFlowV2(flowId, laneId) : [];
  const stepId = flow[0]?.stepId ?? 'community';
  const kindId = flow[0]?.kindIds[0];
  const questions = instantiateQuestionSet('community_check', laneId);
  const materialId = questionSetMaterialId('community_check');
  const template = QUESTION_TEMPLATES.find((q) => q.id === 'community_check')!;

  const owners = clientFor(owner, orgId, partitionId);
  await owners.load();
  await commit(owners, [
    ...(flowId ? [intent('v1.LaneFlowSelected', { laneId, flowId, catalogVersion: CATALOG_VERSION }),
      ...flow.map((payload) => intent('v2.WorkflowStepSet', payload))] : []),
    ...questions.map((q) => intent(q.type, q.payload)),
    intent('v1.StepQuestionSetLinked', { stepId, materialId }),
    intent('v1.AssignmentMade', { unitId, laneId, profileId: reviewer.id, role: 'reviewer' })
  ], 'review setup');

  // The same bytes Chrome plays as the microphone, stored where the app stores a take.
  const bytes = readFileSync(VOICE_WAV);
  const hash = createHash('sha256').update(bytes).digest('hex');
  const { error: uploadError } = await translator.sb.storage.from('blobs')
    .upload(`${orgId}/${partitionId}/${hash}.wav`, bytes, { contentType: 'audio/wav', upsert: true });
  if (uploadError) throw new Error(`seed audio upload: ${uploadError.message}`);

  const takeId = `take:seed-${randomUUID()}`;
  const translators = clientFor(translator, orgId, partitionId);
  await translators.load();
  await commit(translators, [
    intent('v1.RecordingAdded', { recordingId: `rec:${randomUUID()}`, unitId, laneId, kind: 'target', cards: [{ hash, durationMs: 4000, format: 'wav' }] }),
    intent('v1.TakeComposed', { takeId, unitId, laneId, cardHashes: [hash], parentTakeId: null }),
    intent('v1.TakeSelected', { takeId, unitId, laneId }),
    intent('v1.TakeSubmitted', { takeId, questionSetIds: [] })
  ], 'version 1');
  let version1b: { takeId: string } | undefined;
  if (options.secondVersion) {
    const second = world.passages[1]!.unitId;
    version1b = { takeId: `take:seed-${randomUUID()}` };
    await commit(translators, [
      intent('v1.RecordingAdded', { recordingId: `rec:${randomUUID()}`, unitId: second, laneId, kind: 'target', cards: [{ hash, durationMs: 4000, format: 'wav' }] }),
      intent('v1.TakeComposed', { takeId: version1b.takeId, unitId: second, laneId, cardHashes: [hash], parentTakeId: null }),
      intent('v1.TakeSelected', { takeId: version1b.takeId, unitId: second, laneId }),
      intent('v1.TakeSubmitted', { takeId: version1b.takeId, questionSetIds: [] })
    ], 'version 1 of the second passage');
  }

  // Org template questions are never required here (core passage.ts), so feedback needs no answers.
  const requiredQuestionIds: string[] = [];
  if (options.feedback) {
    const reviewers = clientFor(reviewer, orgId, partitionId);
    await reviewers.load();
    await commit(reviewers, [intent('v1.ReviewSubmitted', { takeId, stepId, decision: 'suggest_changes', comment: options.feedback,
      answers: Object.fromEntries(requiredQuestionIds.map((id) => [id, '2'])) })], 'feedback');
  }
  return { ...world, reviewer, stepId, ...(kindId ? { kindId } : {}), requiredQuestionIds, version1: { takeId, hash },
    ...(version1b ? { version1b } : {}) };
}

/** A translator world whose lane has an FIA study with spoken guidance on "Setting the Stage". */
export interface StudyWorld extends World { studyMaterialId: string; stepId: 'stage'; audioHash: string }

/**
 * The translator world plus an FIA study for the lane with step audio on
 * "Setting the Stage" (the voice fixture, 4 s), stored where the app looks
 * for a study blob (m4a path; the bytes are WAV, which the browser sniffs).
 */
export async function seedStudyWorld(): Promise<StudyWorld> {
  const world = await seedTranslatorWorld();
  const { orgId, partitionId, laneId, owner } = world;
  const bytes = readFileSync(VOICE_WAV);
  const audioHash = createHash('sha256').update(bytes).digest('hex');
  const { error } = await owner.sb.storage.from('blobs')
    .upload(`${orgId}/${partitionId}/${audioHash}.m4a`, bytes, { contentType: 'audio/wav', upsert: true });
  if (error) throw new Error(`seed study audio upload: ${error.message}`);
  const studyMaterialId = `fia-study-seed-${randomUUID()}`;
  const owners = clientFor(owner, orgId, partitionId);
  await owners.load();
  await commit(owners, [
    intent('v1.MaterialDefined', { materialId: studyMaterialId, kind: 'fia_study', title: 'FIA guidance', scope: { laneId } }),
    intent('v1.MaterialFieldSet', { materialId: studyMaterialId, fieldId: 'stage', text: 'Where does this happen, and who is there?', blobHash: audioHash })
  ], 'study');
  return { ...world, studyMaterialId, stepId: 'stage', audioHash };
}

/** Open the app signed in as `who`, on the seeded partition, and wait for the device log. */
export async function openAs(page: Page, world: World, who: Person): Promise<void> {
  // Only on first load: the app refreshes the session itself afterwards.
  await page.addInitScript((entries) => {
    for (const [k, v] of Object.entries(entries)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
  }, browserStateFor(world, who));
  await page.goto('/');
  await waitForLog(page);
}

export async function waitForLog(page: Page): Promise<void> {
  await page.waitForFunction(() => !!(globalThis as { __langquestLog?: unknown }).__langquestLog, undefined, { timeout: 60_000 });
}

/** localStorage the app reads at startup: the signed-in session and the open partition. */
export function browserStateFor(world: World, who: Person): Record<string, string> {
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  return {
    [`sb-${ref}-auth-token`]: JSON.stringify(who.session),
    [`selection:${who.id}`]: JSON.stringify({ orgId: world.orgId, partitionId: world.partitionId })
  };
}
