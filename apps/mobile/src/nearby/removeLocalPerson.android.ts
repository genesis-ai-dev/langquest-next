import { keepFindKeys } from '../server/lock';
import { forgetLocalPerson, readLocalPerson } from '../server/localPerson';
import { forgetInstallKey } from '../server/nearbyKey';
import { getStore } from '../storage/store';
import { forgetAllChains } from './nearbyPhone.android';

/**
 * "Remove me from this phone" (docs/nearby-sync-plan.md 14.1, 5 "Me"), in place of Sign out and
 * Delete account for someone let in offline, who has neither: their discovery keys, who was
 * nearby, every chain and pass (each named this install's key), the install key, then the
 * person. The record goes last, so a removal cut short can be done again, and once it goes
 * nobody holds the phone, so the app is back at Sign In. Their unsent work stays in the phone's
 * copy as anyone's does, and push sends only the signed-in person's own, so nothing goes as them.
 * Only for the person who holds the phone: a stale caller removes nobody.
 */
export async function removeLocalPerson(profileId: string): Promise<void> {
  const held = await readLocalPerson();
  if (!held || held.profileId !== profileId) return;
  await keepFindKeys(profileId, null);
  await (await getStore()).clearMeta('nearbyPeers:');
  await forgetAllChains();
  await forgetInstallKey();
  await forgetLocalPerson(profileId);
}
