// The role editor's rules: when Save is enabled, and what a save and its
// Undo append (ORG-3, ORG-4).
import { describe, expect, it } from 'vitest';
import { PRIVILEGES } from '@langquest-next/core';
import { privilegesOn, roleDefinition, roleDirty, roleSnapshot } from '../src/roles/model';
import { ORG } from './sessions';

const translator = ORG.roles['translator']!;

describe('roleDirty', () => {
  it('a new role needs a name, whatever its privileges', () => {
    expect(roleDirty(true, undefined, '', ['translate'])).toBe(false);
    expect(roleDirty(true, undefined, '   ', [])).toBe(false);
    expect(roleDirty(true, undefined, 'Checker', [])).toBe(true);
  });

  it('an existing role is dirty when its name or its set of privileges differs', () => {
    const name = translator.name.value, privileges = [...translator.privileges.value];
    expect(roleDirty(false, translator, name, privileges)).toBe(false);
    expect(roleDirty(false, translator, `  ${name} `, privileges)).toBe(false);
    expect(roleDirty(false, translator, `${name}s`, privileges)).toBe(true);
    expect(roleDirty(false, translator, name, [...privileges].reverse())).toBe(false);
    expect(roleDirty(false, translator, name, privileges.slice(1))).toBe(true);
    expect(roleDirty(false, translator, name, [...privileges, ...PRIVILEGES.filter((p) => !privileges.includes(p))])).toBe(true);
  });

  it('a role that is not there has nothing to save', () => {
    expect(roleDirty(false, undefined, 'Ghost', ['review'])).toBe(false);
  });
});

describe('what a save appends', () => {
  it('trims the name and orders privileges as the catalog does', () => {
    const def = roleDefinition('r1', '  Checker ', ['review', 'translate']);
    expect(def).toEqual({ roleId: 'r1', name: 'Checker', privileges: PRIVILEGES.filter((p) => p === 'translate' || p === 'review') });
  });

  it('snapshots the stored role for Undo, and has none for a new role', () => {
    const snap = roleSnapshot('translator', translator)!;
    expect(snap).toEqual({ roleId: 'translator', name: translator.name.value, privileges: translator.privileges.value });
    expect(snap.privileges).not.toBe(translator.privileges.value);
    expect(roleSnapshot('role-new', undefined)).toBeNull();
  });

  it('lists which privileges of a switch are on', () => {
    expect(privilegesOn(['translate', 'review', 'view_status'], ['review', 'assign_work', 'view_status'])).toEqual(['review', 'view_status']);
    expect(privilegesOn(['translate'], [])).toEqual([]);
  });
});
