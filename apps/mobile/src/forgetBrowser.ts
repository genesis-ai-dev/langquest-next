import { Platform } from 'react-native';
import { reportError } from './report';
import { deleteLocalDatabases } from './store';
import { clearAllWebFiles } from './webFiles';

/**
 * A browser may be a shared or library computer, so on the web signing out
 * (or deleting the account) leaves nothing behind: the databases, recordings
 * and library documents, and every saved key, then a fresh page (decisions.md
 * 11, amended 2026-10-03). It runs only once nothing is waiting to send
 * (decision 12), so no work is lost. A phone keeps its log: it may be shared
 * by a team, and others use what it holds.
 */
export const FORGETS_ON_SIGN_OUT = Platform.OS === 'web';

export async function forgetThisBrowser(): Promise<void> {
  if (!FORGETS_ON_SIGN_OUT) return;
  // Each step on its own, so one that fails does not keep the others from running.
  const steps: [string, () => Promise<void>][] = [
    ['databases', deleteLocalDatabases],
    ['files', () => clearAllWebFiles()],
    ['keys', async () => { localStorage.clear(); sessionStorage.clear(); }]
  ];
  for (const [what, step] of steps) {
    try {
      await step();
    } catch (e) {
      reportError(`forget this browser: ${what}`, e);
    }
  }
  window.location.reload();
}
