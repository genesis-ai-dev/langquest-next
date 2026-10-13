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
 * An organization is named after its one project, or "To be named" when it
 * has several, never after a person: organizations can be looked through
 * by anyone, and a translator's name or email there could put them in
 * danger (Caleb, 2026-10-13). An admin renames it in the app.
 *
 * Pure: the runner and the board page both call it with what they read.
 */

export const EVERY_LANGUAGE_EMAIL = 'platform@everylanguage.com';
/** That account's v2 id (Caleb, 2026-10-12), for readers that cannot see emails. */
export const EVERY_LANGUAGE_V2_ID = '03babbbd-0ff4-43ec-9b85-66d975c7e827';
export const EVERY_LANGUAGE_ORG = 'org-v2-everylanguage';
/** The board's column for projects that do not come over. */
export const SKIP = 'skip';
/** What an organization of several projects is called until its people name it. */
export const TO_BE_NAMED = 'To be named';

/** A name to show others, or null when it is an email address: v2 usernames and project names sometimes are. */
export function shownName(name: string | null | undefined): string | null {
  const n = name?.trim();
  return n && !n.includes('@') ? n : null;
}

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
    if (!orgs.has(id)) orgs.set(id, { id, name: TO_BE_NAMED, existing: false });
    placements.push({ projectId: p.id, orgId: id, why: 'owner' });
  }
  const names = new Map(projects.map((p) => [p.id, p.name]));
  for (const o of orgs.values()) {
    if (o.id === EVERY_LANGUAGE_ORG) continue;
    const mine = placements.filter((x) => x.orgId === o.id);
    o.name = mine.length === 1 ? shownName(names.get(mine[0]!.projectId)) ?? TO_BE_NAMED : TO_BE_NAMED;
  }
  return { orgs: [...orgs.values()], placements };
}
