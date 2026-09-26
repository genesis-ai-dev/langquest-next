// A fresh, isolated world per journey, built through the real server: every
// seed event passes the same authorization and validation a phone's would,
// so a seed that drifts from the event catalog fails here, loudly.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import {
  applyOrgEvent, emptyOrgState, foldOrg, ORG_PARTITION, REDUCER_VERSION, SEED_ROLES,
  type EventPayloads, type EventType, type OrgState
} from '@langquest-next/core';
import { MemoryStore, SupabaseTransport, SyncClient, type Materializer } from '@langquest-next/client';

const SUPABASE_URL = process.env['EXPO_PUBLIC_SUPABASE_URL'] ?? 'http://127.0.0.1:54321';
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
  projectId: string;
  laneId: string;
  passages: { unitId: string; label: string }[];
  owner: Person;
  translator: Person;
}

async function person(role: string): Promise<Person> {
  if (!ANON) throw new Error('EXPO_PUBLIC_SUPABASE_ANON_KEY is not set (smart-tests/run.sh loads apps/mobile/.env).');
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
 * An org and project exactly as CreateOrg (apps/mobile/src/screens/entry.tsx)
 * makes them, plus a translator with an org role, a project membership and
 * every passage assigned — what DevMenu's "Seed demo team" gives one.
 */
export async function seedTranslatorWorld(): Promise<World> {
  const [owner, translator] = await Promise.all([person('owner'), person('translator')]);
  const orgId = randomUUID(), projectId = randomUUID(), laneId = 'L1';
  const passages = ['Luke 1:1-4', 'Luke 1:5-25'].map((label, i) => ({ unitId: `luke-${i}`, label }));
  const client = <S,>(partition: string, materializer?: Materializer<S>) => new SyncClient<S>({
    ...(materializer ? { materializer } : {}),
    orgId, projectId: partition, actorId: owner.id, deviceId: `seed-${owner.id}`,
    store: new MemoryStore(), transport: new SupabaseTransport(owner.sb), newId: () => randomUUID()
  });

  const org = client(ORG_PARTITION, ORG_MATERIALIZER);
  await org.load();
  await commit(org, [
    intent('v1.OrgCreated', { name: 'Smart test org' }),
    ...SEED_ROLES.map((r) => intent('v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges })),
    intent('v1.OrgMemberAdded', { profileId: owner.id, roleId: 'org_admin', scope: { level: 'org' }, displayName: 'owner' }),
    intent('v1.ProjectRegistered', { projectId, name: 'Luke' }),
    intent('v1.OrgMemberAdded', { profileId: translator.id, roleId: 'translator', scope: { level: 'org' }, displayName: 'translator' })
  ], 'org');

  const project = client(projectId);
  await project.load();
  await commit(project, [
    intent('v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' }),
    intent('v1.MemberAdded', { profileId: owner.id, role: 'owner' }),
    intent('v1.ProjectConfigChanged', { config: {
      unitKinds: [{ id: 'book', label: 'Book', childKinds: ['passage'] }, { id: 'passage', label: 'Passage', childKinds: [] }],
      workflow: [{ id: 'community', role: 'reviewer', required: true, rule: 'any' }]
    } }),
    intent('v1.LaneAdded', { laneId, languoidId: 'und' }),
    intent('v1.UnitAdded', { unitId: 'luke', parentUnitId: null, kind: 'book', label: 'Luke', order: 'a' }),
    ...passages.map((p, i) => intent('v1.UnitAdded', { unitId: p.unitId, parentUnitId: 'luke', kind: 'passage', label: p.label, order: `a${i}` })),
    intent('v1.MemberAdded', { profileId: translator.id, role: 'translator' }),
    ...passages.map((p) => intent('v1.AssignmentMade', { unitId: p.unitId, laneId, profileId: translator.id, role: 'translator' }))
  ], 'project');

  // First-run screens are recorded on the server, with the app's own ids (accountData.ts).
  for (const [type, payload, key] of [['v1.TermsAccepted', { version: TERMS_VERSION }, TERMS_VERSION], ['v1.VisionSeen', {}, '1']] as const) {
    const { error } = await translator.sb.rpc('record_user_event', { p_id: `${translator.id}:${type}:${key}`, p_type: type, p_payload: payload });
    if (error) throw new Error(`seed ${type}: ${error.message}`);
  }
  return { orgId, projectId, laneId, passages, owner, translator };
}

/** Open the app signed in as `who`, on the seeded project, and wait for the device log. */
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

/** localStorage the app reads at startup: the signed-in session and the open project. */
export function browserStateFor(world: World, who: Person): Record<string, string> {
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  return {
    [`sb-${ref}-auth-token`]: JSON.stringify(who.session),
    [`selection:${who.id}`]: JSON.stringify({ orgId: world.orgId, projectId: world.projectId })
  };
}
