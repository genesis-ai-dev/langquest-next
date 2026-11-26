import type { LocalPerson } from '../session/localPersonModel';
import { afterCopy, afterGrant, seedsFor } from './joinOfflineModel';

/**
 * What the newcomer's phone keeps once the inviter's grant has checked, and when it sets the person
 * (docs/nearby-sync-plan.md 14.1, 3 to 5), with the stores passed in so the order is tested
 * without a phone: the record first (`filling`, with the two-link chain), then the chain where
 * signing reads it (`nearbyChain:<profileId>`), then the discovery key with no session, then what
 * the app reads at its first start as them. The person is set only once the copy is whole, since
 * `Shell` remounts on the actor id (section 7, phase 6).
 */

export interface GrantStores {
  keepLocalPerson(p: LocalPerson): Promise<boolean>;
  keepChains(profileId: string, chains: Record<string, unknown[]>): Promise<void>;
  keepFindKeys(profileId: string, raw: string): Promise<boolean>;
  seed(pairs: [string, string][]): Promise<void>;
  /**
   * The organizations the newcomer's phone takes as sharing while LangQuest is open
   * (`nearbyOpenOrgs:<profileId>`), from the inviter's word until the server's first answer
   * replaces it (Carl, 2026-11-24).
   */
  keepOpenOrgs?(profileId: string, orgIds: readonly string[]): Promise<void>;
  /**
   * Keep passages offline in the grant's language: those the inviter chose for the newcomer to work
   * on, so the join brings their recordings (docs/decisions/2026-11-25-text-goes-whole-and-recordings-go-by-want.md).
   */
  keepOffline?(orgId: string, languageId: string, unitIds: readonly string[]): Promise<void>;
  /** A key that could not be kept: the copy still comes, and Find waits for the next grant or first contact. */
  missed?(what: string): void;
}

export interface CheckedGrant {
  chain: unknown[];
  orgId: string;
  languageId: string;
  discovery: { key: string; gen: number; floor: number };
  /** The organization's nearby features, as the inviter's phone last heard them. */
  features?: readonly string[];
  /** The passages the inviter chose for the newcomer to work on (2026-11-25). */
  kept?: readonly string[];
}

/** Keep a checked grant. Throws when the record may not take it, so the session sends nothing more and no copy is asked for. */
export async function keepGrant(asked: LocalPerson, grant: CheckedGrant, stores: GrantStores): Promise<LocalPerson> {
  const next = afterGrant(asked, grant.chain);
  if (!next || !(await stores.keepLocalPerson(next))) throw new Error('the grant could not be kept');
  await stores.keepChains(next.profileId, { [grant.orgId]: grant.chain });
  // A key from a grant was not the server's own: never handed on (5.12, the hand-on), and `floor` as the grant says.
  const find = { [`${grant.orgId}/${grant.languageId}`]: { gen: grant.discovery.gen, key: grant.discovery.key, floor: grant.discovery.floor, direct: false } };
  // i18n-ignore: what was missed, for diagnostics
  if (!(await stores.keepFindKeys(next.profileId, JSON.stringify(find)))) stores.missed?.('discovery key');
  // A phone that joined offline has not heard the server say the organization shares while open: the inviter's phone has.
  if (grant.features?.includes('nearby_open')) await stores.keepOpenOrgs?.(next.profileId, [grant.orgId]);
  // What the inviter chose for them to work on, kept offline before the steps after the copy open the language (2026-11-25).
  if (grant.kept?.length) await stores.keepOffline?.(grant.orgId, grant.languageId, grant.kept);
  // Seeded before the copy, so a copy finished later from another teammate still opens this organization and language.
  await stores.seed(seedsFor({ profileId: next.profileId, orgId: grant.orgId, languageId: grant.languageId, name: next.name, names: {} }));
  return next;
}

/** Set the person once the copy is whole, and only then. Answers whether they were set. */
export async function setWhenWhole(person: LocalPerson | null, whole: boolean, keep: (p: LocalPerson) => Promise<boolean>): Promise<boolean> {
  const ready = person ? afterCopy(person, whole) : null;
  return !!ready && keep(ready);
}
