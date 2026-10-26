import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteAccount } from './accountDeletion';
import { recordAuth, recordAuthFailure, since } from '../diagnostics/authDiag';
import { signOutAndForget } from '../web/forgetBrowser';
import { deleteMyAccount } from '../server/account';
import { signOutLocally } from '../server/auth';
import { forgetKeptSession } from '../server/handOver';
import { forgetLock } from '../server/lock';

/** Delete the signed-in account (decisions.md 46): on the server, then what this device keeps for it, then sign out here. */
export async function deleteThisAccount(actorId: string): Promise<void> {
  const started = Date.now();
  try {
    await deleteAccount(actorId, {
      deleteOnServer: deleteMyAccount,
      storage: AsyncStorage,
      signOutHere: async () => {
        await forgetKeptSession(actorId, false).catch(() => {});
        await forgetLock(actorId).catch(() => {});
        await signOutAndForget(signOutLocally);
      }
    });
  } catch (e) {
    recordAuthFailure('delete', e, { ms: since(started) });
    throw e;
  }
  recordAuth('delete', 'ok', { n: { ms: since(started) } });
}
