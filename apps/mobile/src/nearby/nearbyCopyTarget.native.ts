import type { LanguageState, OrgState } from '@langquest-next/core';
import type { CopyNeed, SyncClient } from '@langquest-next/sync';
import type { StartingCopyTarget } from '@langquest-next/sync/nearby';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readLocalPerson } from '../server/localPerson';
import { localPersonIs, membershipOf } from '../session/localPersonModel';
import type { NearbyLanguage } from '../sync/useLanguage';
import { noteChainNames } from '../account/chainNames';
import { namesNotMembers } from '../account/chainNamesModel';
import { phoneDocs, phoneLabels } from './nearbyLibrary.native';
import { phoneSharedFor } from '../library/sharedTeammate.native';

/**
 * Where Share nearby and the quiet room take a starting copy for a person let in offline, once
 * they are set (2026-11-24, review items 6 and 26): their copy is missing, short, or lost to an
 * update with another reducer (`SyncClient.copyNeed`), and a person never goes back to the join
 * screen, whose Look was the only way to take one. Both rooms pass it to every session, and it
 * asks a teammate only while a copy is still wanted (`wanted`). A stream with anything from the
 * server counts as held, since a phone with that refuses a copy. Only an Android phone lets
 * anyone in offline, so on an iPhone there is never a local person, and never one of these.
 */

/** The first of the two streams' needs, the language's before the organization's: what Share nearby says. */
export function copyNeedOf(language: CopyNeed, org: CopyNeed): CopyNeed {
  return language ?? org;
}

/** Names the copy's members go by, added to those this person's phone already has, never over them. */
async function addNames(actorId: string, got: Record<string, string>): Promise<void> {
  const key = `profile-directory:${actorId}`;
  let here: Record<string, string> = {};
  try {
    const parsed = JSON.parse((await AsyncStorage.getItem(key)) ?? '{}') as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      here = Object.fromEntries(Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'));
    }
  } catch { /* a row that cannot be read is replaced */ }
  const names: Record<string, string> = {};
  for (const [id, name] of Object.entries(got)) if (typeof name === 'string' && name.trim() && name.length <= 200) names[id] = name;
  await AsyncStorage.setItem(key, JSON.stringify({ ...names, ...here }));
}

/** The target and what is needed, or null for anyone but the local person of this organization and language, or with nothing needed. */
export async function roomCopyTargetFor(o: { actorId: string; orgId: string; languageId: string; language: NearbyLanguage['client']; org: SyncClient<OrgState> | null }):
  Promise<{ target: Omit<StartingCopyTarget, 'sha256'>; need: CopyNeed } | null> {
  const { language, org } = o;
  const person = await readLocalPerson();
  const membership = membershipOf(person);
  if (!org || !localPersonIs(person, o.actorId) || membership?.orgId !== o.orgId || membership.languageId !== o.languageId) return null;
  const need = copyNeedOf(await language.copyNeed(), await org.copyNeed());
  if (need === null) return null;
  const keptOnDisk = language.keptRecords() !== null;
  return {
    need,
    target: {
      languageId: o.languageId,
      language: {
        holdsCopy: async () => { const n = await language.copyNeed(); return n === null || n === 'filling'; },
        adoptStartingCopy: (c) => language.adoptStartingCopy(c),
        ...(keptOnDisk ? { fillFromCopy: (rows: Parameters<typeof language.fillFromCopy>[0]) => language.fillFromCopy(rows), keptPassageLinks: () => language.keptPassageLinks() } : {}),
        dropCopy: () => language.dropStartingCopy(),
        keptOnDisk, state: () => language.getState()
      },
      org: { holdsCopy: async () => (await org.copyNeed()) === null, adoptStartingCopy: (c) => org.adoptStartingCopy(c), state: () => org.getState() },
      names: async (got) => {
        await addNames(o.actorId, got);
        // People let in offline the organization does not list yet: kept as chain names too, which a server read leaves (review item 12).
        await noteChainNames(o.actorId, namesNotMembers(got, org.getState().members ?? {}, o.actorId)).catch(() => undefined);
      },
      docs: phoneDocs,
      labels: phoneLabels,
      // The Bibles other organizations share that the team reads (review item 9).
      shared: phoneSharedFor({ orgId: o.orgId, languageId: o.languageId, org: () => org.getState(), state: () => language.getState() as LanguageState }),
      wanted: async () => copyNeedOf(await language.copyNeed(), await org.copyNeed()) !== null
    }
  };
}
