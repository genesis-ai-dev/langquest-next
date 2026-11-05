// Who may grant what, and how members are grouped, as the member and invite
// screens ask it. Pure: the screens call these instead of computing them in
// the render body.
import { mayGrantRole, type OrgState, type Scope } from '@langquest-next/core';
import { liveRoles } from './model';
import { groupBelow, mayGrantAt, type MemberEntry } from './orgAdmin';

/** Holds Invite, and at this scope too (the server checks the same). */
export function mayInviteAt(canInvite: boolean, org: OrgState | null, actorId: string, scope: Scope): boolean {
  return canInvite && mayGrantAt(org, actorId, scope);
}

/** Holds Invite at every one of these scopes. */
export function mayInviteAtAll(canInvite: boolean, org: OrgState | null, actorId: string, scopes: readonly Scope[]): boolean {
  return canInvite && scopes.every((s) => mayGrantAt(org, actorId, s));
}

/** The roles this person may grant at `scope` (nobody invites to more than they hold), plus `keep`, the one held now. */
export function grantableRoles(org: OrgState | null, actorId: string, scope: Scope | null, keep?: string): ReturnType<typeof liveRoles> {
  return liveRoles(org?.roles).filter((r) => r.id === keep || (!!scope && mayGrantRole(org, actorId, r.id, scope)));
}

/** Members of languages, grouped by language, with how many there are in all. */
export function membersByLanguage(entries: MemberEntry[]): { groups: Map<string, MemberEntry[]>; count: number } {
  const groups = groupBelow(entries);
  return { groups, count: [...groups.values()].reduce((n, g) => n + g.length, 0) };
}
