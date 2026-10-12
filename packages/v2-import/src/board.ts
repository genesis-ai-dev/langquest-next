/**
 * Where each v2 project goes before anyone moves it (docs/v2-import.md
 * section 2). v2 has projects and no organizations, so the board starts
 * from a rule and the team moves cards from there:
 *
 * - a project with an active member whose v2 email is the Every Language
 *   platform account belongs to Every Language (Caleb, 2026-10-12);
 * - a project named like a test with nothing to say what language it is
 *   starts as "Don't bring over";
 * - every other project goes with its owner's other projects.
 *
 * Pure: the runner and the board page both call it with what they read.
 */

export const EVERY_LANGUAGE_EMAIL = 'platform@everylanguage.com';
export const EVERY_LANGUAGE_ORG = 'org-v2-everylanguage';
/** The board's column for projects that do not come over. */
export const SKIP = 'skip';

export type Confidence = 'keep' | 'high' | 'medium' | 'low' | 'review' | 'none';

export interface BoardProject {
  id: string;
  name: string;
  active: boolean;
  private: boolean;
  createdAt: string;
  creatorId: string | null;
  /** Active members, owners first, each once. */
  owners: string[];
  members: string[];
  /** From docs/v2-project-languages.csv; `none` for a project made after it. */
  confidence: Confidence;
}

export interface BoardPerson {
  id: string;
  name: string | null;
  email: string | null;
}

export interface BoardOrg {
  id: string;
  name: string;
  /** Made by the import, or an organization that already exists here (chosen on the board). */
  existing: boolean;
}

export type Why = 'everylanguage' | 'owner' | 'test' | 'nobody';

export interface Placement {
  projectId: string;
  /** An organization's id, or `SKIP`. */
  orgId: string;
  why: Why;
}

const TESTLIKE = /\b(test(s|ing)?|demo|dev|sample|trial|practi[cs]e|example|tutorial|sandbox|dummy|qa)\b/i;

export function looksLikeTest(p: Pick<BoardProject, 'name' | 'confidence'>): boolean {
  return (p.confidence === 'review' || p.confidence === 'none') && TESTLIKE.test(p.name);
}

export function ownerOrgId(profileId: string): string {
  return `org-v2-${profileId}`;
}

export function defaultBoard(projects: readonly BoardProject[], people: readonly BoardPerson[]): { orgs: BoardOrg[]; placements: Placement[] } {
  const byId = new Map(people.map((p) => [p.id, p]));
  const platform = new Set(people.filter((p) => p.email?.trim().toLowerCase() === EVERY_LANGUAGE_EMAIL).map((p) => p.id));
  const orgs = new Map<string, BoardOrg>();
  const placements: Placement[] = [];

  for (const p of [...projects].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    if ([...p.owners, ...p.members].some((id) => platform.has(id))) {
      orgs.set(EVERY_LANGUAGE_ORG, { id: EVERY_LANGUAGE_ORG, name: 'Every Language', existing: false });
      placements.push({ projectId: p.id, orgId: EVERY_LANGUAGE_ORG, why: 'everylanguage' });
      continue;
    }
    if (looksLikeTest(p)) {
      placements.push({ projectId: p.id, orgId: SKIP, why: 'test' });
      continue;
    }
    const owner = p.owners[0] ?? p.creatorId;
    if (!owner) {
      placements.push({ projectId: p.id, orgId: SKIP, why: 'nobody' });
      continue;
    }
    const id = ownerOrgId(owner);
    if (!orgs.has(id)) orgs.set(id, { id, name: orgNameFor(byId.get(owner), p.name), existing: false });
    placements.push({ projectId: p.id, orgId: id, why: 'owner' });
  }
  return { orgs: [...orgs.values()], placements };
}

/** The owner's name when it can be read; else their first project's, so the team can still tell organizations apart. */
function orgNameFor(person: BoardPerson | undefined, firstProject: string): string {
  const name = person?.name?.trim();
  return name ? `${name}'s organization` : `${firstProject.trim() || 'LangQuest'} organization`;
}
