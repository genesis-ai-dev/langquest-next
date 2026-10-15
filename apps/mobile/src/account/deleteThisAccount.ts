import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteAccount } from './accountDeletion';
import { recordAuth, recordAuthFailure, since } from '../auth/authDiag';
import { forgetThisBrowser } from '../web/forgetBrowser';
import { deleteMyAccount } from '../server/account';
import { signOutLocally } from '../server/auth';

/** Delete the signed-in account (decisions.md 46): on the server, then what this device keeps for it, then sign out here. */
export async function deleteThisAccount(actorId: string): Promise<void> {
  const started = Date.now();
  try {
    await deleteAccount(actorId, {
      deleteOnServer: deleteMyAccount,
      storage: AsyncStorage,
      signOutHere: async () => { await signOutLocally(); await forgetThisBrowser(); }
    });
  } catch (e) {
    recordAuthFailure('delete', e, { ms: since(started) });
    throw e;
  }
  recordAuth('delete', 'ok', { n: { ms: since(started) } });
}
