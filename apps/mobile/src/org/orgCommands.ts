// Writes to the organization's stream that screens ask for by name: each
// builds its payload and appends it. Screens call these rather than
// `ctx.org.append('v1.…', {...})`, so the event's shape lives in one place.
import type { License } from '@langquest-next/core';
import type { OrgHandle } from '../sync/useOrg';
import type { OrgOp } from './orgAdmin';

type Org = Pick<OrgHandle, 'append'>;

/** Link a language to a language-list entry: its code and languoid. */
export function linkLanguageCode(org: Org, languageId: string, picked: { code: string; id: string }): Promise<void> {
  return org.append('v1.LanguageCodeSet', { languageId, code: picked.code, languoidId: picked.id });
}

/** Open the organization's license further. */
export function setOrgLicense(org: Org, license: License): Promise<void> {
  return org.append('v1.LicenseSet', { license });
}

export function renameOrg(org: Org, name: string): Promise<void> {
  return org.append('v1.OrgRenamed', { name });
}

export function renameLanguage(org: Org, languageId: string, name: string): Promise<void> {
  return org.append('v1.LanguageRenamed', { languageId, name });
}

/** Append membership operations in order (a change, or its undo). */
export async function appendOrgOps(org: Org, ops: readonly OrgOp[]): Promise<void> {
  for (const op of ops) await org.append(op.type, op.payload as never);
}
