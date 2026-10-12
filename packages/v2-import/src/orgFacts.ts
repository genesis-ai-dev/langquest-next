import { ORG_STREAM, SEED_ROLES, subscriptionItemId } from '@langquest-next/core';
import type { Fact, Said } from './reconcile';

/**
 * An organization's own facts, for the organization the board says v2
 * projects go into (docs/v2-import.md section 2): its name and roles when
 * the import makes it, the people who run it, and LangQuest's Bible ways
 * its languages use. Built from the whole organization, never one project,
 * since anything left out is taken back. Pure.
 */

export const LIBRARY_ORG = { id: 'langquest', name: 'LangQuest' } as const;

export interface OrgPlan {
  orgId: string;
  name: string;
  /** People made it here; the import only adds to it. */
  existing: boolean;
  /** v2 profile ids who run it. */
  admins: string[];
  /** LangQuest library items its languages use, with the version each uses. */
  ways: { sourceItemId: string; name: string; docHash: string }[];
  /** When the board made it. */
  at: string;
}

export function orgFacts(o: OrgPlan): Fact[] {
  const actorId = o.admins[0] ?? 'v2import';
  const nothing = () => [] as Said[];
  const facts: Fact[] = [];
  if (!o.existing) {
    facts.push({
      key: 'org', streamId: ORG_STREAM, actorId, at: o.at, unsay: nothing,
      // The board renames it: the same register as its creation (decision 76).
      say: (s) => [s.lastSaid === null ? { type: 'v1.OrgCreated', payload: { name: o.name } } : { type: 'v1.OrgRenamed', payload: { name: o.name } }],
      value: o.name
    });
    for (const r of SEED_ROLES) {
      facts.push({
        key: `role:${r.roleId}`, streamId: ORG_STREAM, actorId, at: o.at, restate: false, unsay: nothing,
        say: () => [{ type: 'v1.RoleDefined', payload: { roleId: r.roleId, name: r.name, privileges: r.privileges } }]
      });
    }
  }
  for (const profileId of o.admins) {
    facts.push({
      key: `admin:${profileId}`, streamId: ORG_STREAM, actorId, at: o.at,
      say: () => [{ type: 'v1.MemberAdded', payload: { profileId, roleId: 'org_admin', scope: { level: 'org' } } }],
      unsay: () => [{ type: 'v1.MemberRemoved', payload: { profileId, scope: { level: 'org' } } }]
    });
  }
  for (const w of o.ways) {
    const itemId = subscriptionItemId(LIBRARY_ORG.id, w.sourceItemId);
    facts.push({
      key: `library:${w.sourceItemId}`, streamId: ORG_STREAM, actorId, at: o.at, unsay: nothing, value: itemId,
      say: () => [
        { type: 'v1.LibrarySubscribed', payload: { itemId, kind: 'template', sourceOrgId: LIBRARY_ORG.id, sourceOrgName: LIBRARY_ORG.name, sourceItemId: w.sourceItemId, name: w.name, autoUpdate: true, active: true } },
        { type: 'v1.LibraryPinned', payload: { itemId, kind: 'template', docHash: w.docHash } }
      ]
    });
  }
  return facts;
}
