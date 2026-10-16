/**
 * The phone's own copies of one account's data: every per-account key names
 * the account id (inbox, read marks, profile directory, organizations,
 * terms, welcome), and the push token belongs to whoever registered it.
 * The event log and audio stay: they are the organization's work, and on a
 * shared phone (decision 11) other accounts use them.
 */
export function accountKeys(keys: readonly string[], actorId: string): string[] {
  return keys.filter((k) => k.includes(actorId) || k === 'push-token');
}

export interface DeletionDeps {
  /** `delete_my_account`; resolves with the server's refusal (its message and code), or null. */
  deleteOnServer: () => Promise<{ message: string; code?: string } | null>;
  storage: { getAllKeys: () => Promise<readonly string[]>; multiRemove: (keys: string[]) => Promise<void> };
  /** Ends the session on this phone only; the server no longer knows it. */
  signOutHere: () => Promise<void>;
}

/**
 * Deletes the account on the server (decisions.md 46), then forgets it
 * here. Nothing on the phone changes unless the server said yes, so a
 * failure leaves the person signed in to try again.
 */
export async function deleteAccount(actorId: string, deps: DeletionDeps): Promise<void> {
  const refused = await deps.deleteOnServer();
  // The code goes with the error, so the report of it says why (reportError reads `code`).
  if (refused) throw Object.assign(new Error(refused.message), refused.code ? { code: refused.code } : {});
  await deps.storage.multiRemove(accountKeys(await deps.storage.getAllKeys(), actorId));
  await deps.signOutHere();
}
