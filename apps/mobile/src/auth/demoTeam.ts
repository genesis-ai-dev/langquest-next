// i18n-ignore-file: developer tools, shown only in development builds.
// The demo team for the developer menu (shell/DevMenu.tsx): seed the persona
// accounts with their roles and some work, and sign in as one. Personas exist
// only on a local Supabase (dev.ts `personasAvailable`).
import { commands, membershipsOf, selectFlowSpecs, type FlowDoc } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { maySeedDemoTeam, PERSONAS, type Persona } from './dev';
import { ensurePersonaAccount, joinAsPersona, switchToPersona } from '../server/personas';
import * as library from '../server/library';
import { issueInvite } from '../invites/invites';
import { indexesFor } from '../sync/indexes';
import { loadDocs } from '../library/docStore';
import { subscribeOps, type SharedItem } from '../library/model';
import type { OrgHandle } from '../sync/useOrg';
import type { LanguageHandle } from '../sync/useLanguage';

/** What the demo team is seeded into. */
export interface DemoTarget { org: OrgHandle; language: LanguageHandle; isDev: boolean }

/** Sign in as a persona (a real sign-in). */
export function signInAs(p: Persona): Promise<void> {
  return switchToPersona(p);
}

/**
 * The language follows LangQuest's Standard Bible Flow (docs/library.md):
 * the flow comes from the library now, so the local server must have been
 * seeded (`npm run library:seed`).
 */
export async function adoptStandardFlow(d: DemoTarget): Promise<void> {
  const orgId = d.language.orgId;
  const { data, error: failed } = await library.sharedItems('flow', 'Standard Bible Flow', 5);
  if (failed) throw new Error(failed.message);
  const shared = ((data ?? []) as SharedItem[]).find((r) => r.org_id === 'langquest');
  if (!shared) throw new Error('LangQuest\'s flows are not on this server yet: run npm run library:seed.');
  const { error: denied } = await library.adopt(orgId, shared.org_id, shared.item_id, shared.latest_hash);
  if (denied) throw new Error(denied.message);
  const { itemId, ops } = subscribeOps(shared, true);
  for (const op of ops) await d.org.append(op.type, op.payload as never);
  const doc = (await loadDocs(orgId, [shared.latest_hash])).get(shared.latest_hash) as FlowDoc | undefined;
  const state = d.language.state;
  if (!doc || !state) throw new Error('The flow could not be read.');
  await d.language.run(selectFlowSpecs(state, { commandId: `seed-flow:${Crypto.randomUUID()}`, itemId, docHash: shared.latest_hash, doc }));
}

/**
 * Owner-only: create every persona account and give it its role across
 * the organization, then ask the translator to record some of the open
 * language's work. The language gets the standard Bible flow, so the Map
 * and the passage record have steps to show.
 */
export async function seedDemoTeam(d: DemoTarget): Promise<void> {
  const { state, languageId } = d.language;
  if (!state || !maySeedDemoTeam(d.isDev)) return;
  // A handful of passages, in canon order: enough to show For you and the
  // Map without flooding a whole Bible with requests.
  const units = Object.entries(state.units).filter(([, u]) => u.parentUnitId !== null)
    .sort(([, a], [, b]) => (a.order < b.order ? -1 : 1)).slice(0, 5).map(([id]) => id);
  for (const p of PERSONAS) {
    if (!p.roleId) continue;
    const id = await ensurePersonaAccount(p);
    if (d.org.state && membershipsOf(d.org.state, id).length > 0) continue;
    // Nobody is added without joining (decisions.md 75): invite the persona, and it redeems as itself.
    const invite = await issueInvite(d.language.orgId, p.roleId, { level: 'org' }, { label: p.label, ttlDays: 1 });
    await joinAsPersona(p, invite.token);
    if (languageId && p.role === 'translator') {
      const c = commands(state, indexesFor(state));
      for (const unitId of units) await d.language.run(c.ask({ commandId: `seed-ask:${Crypto.randomUUID()}`, unitId, what: 'record', profileId: id }));
    }
  }
  if (languageId && !state.flow) await adoptStandardFlow(d);
  if (languageId) await d.language.sync();
  await d.org.sync();
}
