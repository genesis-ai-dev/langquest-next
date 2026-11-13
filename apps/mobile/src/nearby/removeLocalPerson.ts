import { forgetLocalPerson } from '../server/localPerson';

/**
 * "Remove me from this phone" (removeLocalPerson.android.ts). Joining offline is Android only, so
 * here there is never a local person, nor a key or chain of theirs.
 */
export async function removeLocalPerson(profileId: string): Promise<void> {
  await forgetLocalPerson(profileId);
}
