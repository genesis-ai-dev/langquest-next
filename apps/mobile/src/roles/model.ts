// What the role editor decides and writes (ORG-3, ORG-4): whether the form
// differs from the stored role, and the role definitions a save and its Undo
// append. Pure: no React, so it is tested (test/rolesModel.test.ts).
import { PRIVILEGES, type OrgState, type Privilege } from '@langquest-next/core';

/** A role as the organization stores it. */
export type StoredRole = OrgState['roles'][string];

/** The payload of `v1.RoleDefined`. */
export interface RoleDefinition { roleId: string; name: string; privileges: Privilege[] }

/**
 * Whether Save has something to write: a new role needs a name; an existing
 * one needs its name or its set of privileges to differ (order does not count).
 */
export function roleDirty(isNew: boolean, existing: StoredRole | undefined, label: string, privileges: Privilege[]): boolean {
  if (isNew) return label.trim() !== '';
  if (!existing) return false;
  return label.trim() !== existing.name.value
    || privileges.length !== existing.privileges.value.length || privileges.some((p) => !existing.privileges.value.includes(p));
}

/** What Save appends: the trimmed name and the privileges in the catalog's order. */
export function roleDefinition(roleId: string, label: string, privileges: Privilege[]): RoleDefinition {
  return { roleId, name: label.trim(), privileges: PRIVILEGES.filter((p) => privileges.includes(p)) };
}

/** The role as stored, to put back on Undo; null for a new role, which has nothing to go back to. */
export function roleSnapshot(roleId: string, existing: StoredRole | undefined): RoleDefinition | null {
  return existing ? { roleId, name: existing.name.value, privileges: [...existing.privileges.value] } : null;
}

/** The privileges of a switch that are on, for a switch that is only partly on. */
export function privilegesOn(rowPrivileges: readonly Privilege[], privileges: readonly Privilege[]): Privilege[] {
  return rowPrivileges.filter((p) => privileges.includes(p));
}
