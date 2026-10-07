// The organization's fixed vocabulary, kept apart from org.ts so that
// validate.ts can use it without importing the org reducer, which itself
// validates (a require cycle).

/**
 * The organization stream (docs/streams-and-languages.md, decision 63).
 *
 * Every organization has one, `streamId = ORG_STREAM`, beside one stream per
 * language. It holds what every member needs without pulling any language:
 * the organization, its roles (named privilege sets, UX spec A38), who holds
 * which role at which scope (the organization, or one language), its library
 * and recommendations, its license, and the list of its languages with what
 * defines each one (name, code, source code, country, target). Every device
 * pulls it whole; it is small.
 *
 * A language stream accepts events only once this stream lists the language
 * (`v1.LanguageAdded`), and who may write there comes from the memberships
 * here: an org-scope role covers every language, a language-scope role one.
 * The server runs the same rules.
 */
export const ORG_STREAM = '_org';

/** The org id under which each person's own stream lives (`streamId` = their profile id). */
export const PERSON_ORG = '_person';

/** The UX spec's privilege catalog (ROLE_PRIVILEGES), as stable ids. */
export const PRIVILEGES = [
  'manage_structure',
  'invite_members',
  'manage_roles',
  'manage_templates',
  'shape_templates',
  'manage_reference',
  'manage_flows',
  'manage_teams',
  'assign_work',
  'override_checkpoints',
  'translate',
  'fill_reference',
  'send_to_reviewers',
  'review',
  'view_status'
] as const;
export type Privilege = (typeof PRIVILEGES)[number];

/** Privileges that make a member an admin of their scope (spec MANAGE_PRIVILEGES). */
export const MANAGE_PRIVILEGES: readonly Privilege[] = [
  'manage_structure', 'invite_members', 'manage_roles', 'manage_templates',
  'manage_reference', 'manage_flows', 'manage_teams', 'assign_work', 'override_checkpoints'
];

/** A share of the canon a language plans to record. */
export type TargetScope = 'gospels' | 'nt' | 'ot' | 'bible';
export const TARGET_SCOPES: readonly TargetScope[] = ['gospels', 'nt', 'ot', 'bible'];
