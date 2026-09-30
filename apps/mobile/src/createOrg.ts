import { SupabaseTransport, SyncClient, ensureDeviceId } from '@langquest-next/client';
import { DEFAULT_LICENSE, ORG_PARTITION, SEED_ROLES, type License, type OrgState } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { getStore } from './store';
import { supabase } from './supabase';
import { ORG_MATERIALIZER } from './useOrg';

/**
 * Start a new organization (ONB-6) in its own partition, never the one that
 * happens to be open: a fresh id, the org, the usual roles, its creator as
 * Organization Admin and the license its work is under (docs/licensing.md).
 * Its languages each get their own partition when they are added
 * (docs/decisions.md 37).
 *
 * The events go into this phone's log and sync from there, so it works
 * offline.
 */
export async function createOrganization(c: { actorId: string; name: string; displayName?: string; license?: License }): Promise<string> {
  const orgId = `org-${Crypto.randomUUID()}`;
  const store = await getStore();
  const deviceId = await ensureDeviceId(store, () => Crypto.randomUUID());
  const client = new SyncClient<OrgState>({
    materializer: ORG_MATERIALIZER,
    orgId,
    projectId: ORG_PARTITION,
    actorId: c.actorId,
    deviceId,
    store,
    transport: new SupabaseTransport(supabase),
    newId: () => Crypto.randomUUID()
  });
  await client.load();
  await client.append('v1.OrgCreated', { name: c.name });
  for (const r of SEED_ROLES) await client.append('v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
  await client.append('v1.OrgMemberAdded', {
    profileId: c.actorId, roleId: 'org_admin', scope: { level: 'org' },
    ...(c.displayName ? { displayName: c.displayName } : {})
  });
  // Recorded even when it is the default, so the log says what was chosen.
  // After the membership: the server lets only an Organization Admin set it.
  await client.append('v1.OrgLicenseSet', { license: c.license ?? DEFAULT_LICENSE });
  return orgId;
}
