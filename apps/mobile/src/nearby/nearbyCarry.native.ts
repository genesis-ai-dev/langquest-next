import { LanguageFiles } from '@langquest-next/sync';
import { nearbyKeepOf } from '@langquest-next/sync/nearby';
import { installKey } from '../server/nearbyKey';
import { getStore } from '../storage/store';
import type { NearbyLanguage } from '../sync/useLanguage';
import { nearbyNamesOf } from './nearbyRun.native';
import { onlyOnThisPhone, wallOf, type CarryFacts } from './readyToCarryModel';

/**
 * What Ready to carry reads from the open language's store (docs/nearby-sync-plan.md 5.8): the
 * vector's signers, the holdings, the batches held with their authors and clocks, `nearbyNames`,
 * whether pulled rows wait for the Worker to vouch for them, and the clock of the newest row this
 * phone has from the server. Read only while Share nearby is open: on opening, after each session,
 * and at "Up to date". Nothing here is written.
 */
export type StoredCarryFacts = Pick<CarryFacts, 'myKey' | 'names' | 'vectorKeys' | 'holdings' | 'batches' | 'pulledUnshared' | 'lastOnlineMs' | 'onServer'>;

export async function carryFactsOf(language: NearbyLanguage, orgId: string, languageId: string): Promise<StoredCarryFacts> {
  const { client } = language;
  const store = await getStore();
  const keep = nearbyKeepOf(client, { orgId, streamId: languageId });
  const [key, names, holdings, have, batches, attested, inspection] = await Promise.all([
    installKey(), nearbyNamesOf(language, orgId), keep.holdings(), client.nearbyHave(), store.batchKeys(orgId, languageId),
    client.nearbyMeta(`nearbyAttested:${orgId}/${languageId}`), client.inspect()
  ]);
  const vouched = Math.max(Number(attested ?? 0) || 0, inspection.checkpointSeq ?? 0);
  // A holdings entry is what a phone last said; a file the server has stored since needs no carrying (5.6).
  const named = [...new Set([...holdings.values()].flatMap((e) => e.files))];
  const plan = named.length ? await new LanguageFiles(client, store, orgId, languageId).plan({ hashes: named }) : null;
  const onServer = plan ? named.filter((h) => plan.verdict(h)?.stored === true) : [];
  const [newest] = have.cursor > 0 ? await store.confirmedAfter(orgId, languageId, have.cursor - 1, 1) : [];
  return {
    myKey: key?.publicKey ?? null,
    names,
    vectorKeys: [...have.vector.keys()],
    holdings,
    batches,
    pulledUnshared: have.cursor > vouched,
    onServer: new Set(onServer),
    lastOnlineMs: wallOf(newest?.event.hlc ?? null)
  };
}

/**
 * Me's reminder on Sync and offline's row (docs/nearby-sync-plan.md 15.5): how many of this
 * person's recordings waiting to upload no other phone said it holds. Read only while offline,
 * from the holdings and the session's own unsent list; nothing is written and no radio runs.
 */
export async function onlyHereOf(language: NearbyLanguage, orgId: string, languageId: string, unsent: () => Promise<readonly { hash: string }[]>): Promise<number> {
  const keep = nearbyKeepOf(language.client, { orgId, streamId: languageId });
  const [key, holdings, mine] = await Promise.all([installKey(), keep.holdings(), unsent()]);
  return onlyOnThisPhone(mine.map((ref) => ref.hash), holdings, key?.publicKey ?? null);
}
