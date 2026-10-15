import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteAccount } from '../accountDeletion';
import { forgetThisBrowser } from '../forgetBrowser';
import { deleteMyAccount } from '../server/account';
import { signOutLocally } from '../server/auth';

/** Delete the signed-in account (decisions.md 46): on the server, then what this device keeps for it, then sign out here. */
export function deleteThisAccount(actorId: string): Promise<void> {
  return deleteAccount(actorId, {
    deleteOnServer: deleteMyAccount,
    storage: AsyncStorage,
    signOutHere: async () => { await signOutLocally(); await forgetThisBrowser(); }
  });
}
