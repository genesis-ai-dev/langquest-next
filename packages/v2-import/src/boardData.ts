import { defaultBoard, EVERY_LANGUAGE_EMAIL, EVERY_LANGUAGE_ORG, EVERY_LANGUAGE_V2_ID, SKIP, type BoardPerson, type Confidence, type Why } from './board';
import type { V2ProjectSummary } from './reader';
import type { Plan, PlanOrg } from './target';

/**
 * Everything the board shows, from v2, the language recommendations and
 * the saved plan (docs/v2-import.md section 2). A project with no saved
 * place shows where the starting rule puts it. Pure.
 */

export interface Recommendation {
  /** The languoid the CSV recommends, and its readable code. */
  languoidId: string | null;
  name: string | null;
  code: string | null;
  confidence: Confidence;
  reason: string;
  /** A person's decision written in the CSV, if any (a languoid id). */
  decision: string | null;
  /** What v2 said, as the CSV read it: its target and source, and the languages its recordings are tagged with. */
  v2Target?: string;
  v2Source?: string;
  tagged?: string;
}

export interface BoardCard {
  id: string;
  name: string;
  private: boolean;
  active: boolean;
  template: string | null;
  assets: number;
  lastActivity: string | null;
  owners: { id: string; name: string | null }[];
  members: number;
  recommendation: Recommendation;
  orgId: string;
  why: Why | 'saved';
  /** The language chosen on the board, or none yet. */
  languoidId: string | null;
  code: string | null;
  /** The language's name in Next, when the dashboard gave one other than the project's. */
  languageName: string | null;
  description: string | null;
  confirmed: { by: string; at: string } | null;
  lastPass: { at: string; report: unknown } | null;
}

export interface BoardData {
  cards: BoardCard[];
  orgs: (PlanOrg & { saved: boolean; adminNames: (string | null)[] })[];
  /** The Every Language platform account's v2 id, when it could be found. */
  everyLanguage: string[];
}

export function boardData(input: {
  projects: V2ProjectSummary[];
  memberships: { profile_id: string; project_id: string; membership: string; active: boolean }[];
  people: BoardPerson[];
  recommendations: ReadonlyMap<string, Recommendation>;
  plan: Plan;
  /** v2 ids of the platform account when names and emails cannot be read; its known id by default. */
  everyLanguageIds?: string[];
}): BoardData {
  // The platform account, known by id, counts as Every Language whatever the reader could see of it.
  const platform = new Set(input.everyLanguageIds ?? [EVERY_LANGUAGE_V2_ID]);
  const people = input.people.map((p) => (platform.has(p.id) ? { ...p, name: p.name ?? 'Every Language', email: EVERY_LANGUAGE_EMAIL } : p));
  for (const id of platform) if (!people.some((p) => p.id === id)) people.push({ id, name: 'Every Language', email: EVERY_LANGUAGE_EMAIL });
  const byId = new Map(people.map((p) => [p.id, p]));
  const members = new Map<string, { owners: string[]; members: string[] }>();
  for (const m of input.memberships) {
    if (!m.active) continue;
    const entry = members.get(m.project_id) ?? { owners: [], members: [] };
    (m.membership === 'owner' ? entry.owners : entry.members).push(m.profile_id);
    members.set(m.project_id, entry);
  }
  const none: Recommendation = { languoidId: null, name: null, code: null, confidence: 'none', reason: 'made in v2 after the recommendations were built', decision: null };
  const start = defaultBoard(input.projects.map((p) => ({
    id: p.id, name: p.name, active: p.active !== false, private: !!p.private, createdAt: p.created_at, creatorId: p.creator_id,
    owners: members.get(p.id)?.owners ?? [], members: members.get(p.id)?.members ?? [],
    confidence: input.recommendations.get(p.id)?.confidence ?? 'none'
  })), people);

  const saved = new Map(input.plan.placements.map((p) => [p.project_id, p]));
  const startAt = new Map(start.placements.map((p) => [p.projectId, p]));
  const passes = new Map(input.plan.passes.map((p) => [p.project_id, p]));
  const cards: BoardCard[] = input.projects.map((p) => {
    const s = saved.get(p.id);
    const d = startAt.get(p.id)!;
    const rec = input.recommendations.get(p.id) ?? none;
    const pass = passes.get(p.id);
    return {
      id: p.id, name: p.name, private: !!p.private, active: p.active !== false, template: p.template, assets: p.assets, lastActivity: p.lastActivity,
      owners: (members.get(p.id)?.owners ?? []).map((id) => ({ id, name: byId.get(id)?.name ?? null })),
      members: (members.get(p.id)?.members.length ?? 0) + (members.get(p.id)?.owners.length ?? 0),
      recommendation: rec,
      orgId: s ? s.org_id ?? SKIP : d.orgId,
      why: s ? 'saved' : d.why,
      languoidId: s?.languoid_id ?? null,
      code: s?.code ?? null,
      languageName: s?.name ?? null,
      description: p.description ?? null,
      confirmed: s?.confirmed_at && s.confirmed_by ? { by: s.confirmed_by, at: s.confirmed_at } : null,
      lastPass: pass ? { at: pass.finished_at, report: pass.report } : null
    };
  });

  const orgs = new Map<string, BoardData['orgs'][number]>();
  for (const o of input.plan.orgs) orgs.set(o.org_id, { ...o, saved: true, adminNames: o.admins.map((id) => byId.get(id)?.name ?? null) });
  for (const o of start.orgs) {
    if (orgs.has(o.id)) continue;
    // A new organization's admins start as the people the rule put it there for.
    const admins = o.id === EVERY_LANGUAGE_ORG
      ? people.filter((p) => p.email?.trim().toLowerCase() === EVERY_LANGUAGE_EMAIL).map((p) => p.id)
      : [o.id.replace(/^org-v2-/, '')];
    orgs.set(o.id, { org_id: o.id, name: o.name, existing: o.existing, admins, saved: false, adminNames: admins.map((id) => byId.get(id)?.name ?? null) });
  }
  // Only organizations something is in, or the board saved.
  const used = new Set(cards.map((c) => c.orgId));
  return {
    cards,
    orgs: [...orgs.values()].filter((o) => o.saved || used.has(o.org_id)),
    everyLanguage: people.filter((p) => p.email?.trim().toLowerCase() === EVERY_LANGUAGE_EMAIL).map((p) => p.id)
  };
}

/** docs/v2-project-languages.csv, by v2 project id. */
export function parseRecommendations(csv: string): Map<string, Recommendation> {
  const rows = parseCsv(csv);
  const head = rows.shift() ?? [];
  const col = (name: string) => head.indexOf(name);
  const out = new Map<string, Recommendation>();
  for (const r of rows) {
    const get = (name: string) => (r[col(name)] ?? '').trim();
    const name = get('recommended_target');
    const code = /\[([a-z]{3})\]\s*$/.exec(name)?.[1] ?? (get('recommended_target_glottocode') || null);
    const conf = get('confidence');
    out.set(get('v2_project_id'), {
      languoidId: get('recommended_target_id') || null,
      name: name && name !== '—' ? name.replace(/\s*\[[^\]]*\]\s*$/, '') : null,
      code,
      confidence: (['keep', 'high', 'medium', 'low', 'review'].includes(conf) ? conf : 'none') as Confidence,
      reason: get('reason'),
      decision: get('decision') || null,
      v2Target: get('current_target'),
      v2Source: get('current_source'),
      tagged: get('content_tagged')
    });
  }
  return out;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
