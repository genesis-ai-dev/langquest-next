/**
 * A leaf module (no imports) so eventRegistry.ts can use the privilege ids
 * without an import cycle through org.ts. org.ts re-exports both names.
 */
/** The UX spec's privilege catalog (ROLE_PRIVILEGES), as stable ids. */
export const PRIVILEGES = [
  'manage_structure',
  'invite_members',
  'manage_roles',
  'manage_templates',
  'manage_reference',
  'manage_flows',
  'manage_teams',
  'assign_work',
  'translate',
  'fill_reference',
  'send_to_reviewers',
  'review',
  'view_status'
] as const;
export type Privilege = (typeof PRIVILEGES)[number];
