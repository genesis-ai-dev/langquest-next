import { foldOrg, SEED_ROLES, type AnyEvent } from '@langquest-next/core';
import { deriveSession } from '../src/session';

/**
 * One organization with language 'din': a person per seed role at org scope,
 * named after the role ('owner', 'coordinator', ...), and 'akol' leading din
 * alone in a role with manage privileges.
 */
let seq = 0;
export const ORG = foldOrg(
  [
    { type: 'v1.LanguageAdded', payload: { languageId: 'din', name: 'Dinka', code: 'din', sourceCode: 'eng' } },
    ...SEED_ROLES.map((r) => ({ type: 'v1.RoleDefined', payload: { roleId: r.roleId, name: r.name, privileges: r.privileges } })),
    ...SEED_ROLES.map((r) => ({ type: 'v1.MemberAdded', payload: { profileId: r.fixed, roleId: r.roleId, scope: { level: 'org' } } })),
    { type: 'v1.RoleDefined', payload: { roleId: 'lang_lead', name: 'Team Leader', privileges: ['assign_work', 'manage_teams', 'translate', 'view_status'] } },
    { type: 'v1.MemberAdded', payload: { profileId: 'akol', roleId: 'lang_lead', scope: { level: 'language', languageId: 'din' } } }
  ].map((e) => ({ ...e, id: `o${++seq}`, orgId: 'org1', streamId: '_org', actorId: 'lead', deviceId: 'd', hlc: `${String(seq).padStart(15, '0')}:000000:d` }) as AnyEvent)
);

/** The session of the seed role's person in language din. */
export const roleSession = (role: string) => deriveSession(role, `${role}@x`, true, ORG, 'din');
