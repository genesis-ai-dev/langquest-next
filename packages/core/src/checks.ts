import type { EventSpec } from './commands';
import type { LanguageState } from './state';

/**
 * A language's checks (decisions.md 90): each kind of review in its flow
 * carries its own people and helps. People are stored as review-team
 * records, one team per check (`checkTeamId`), so a request to "the Peer
 * check team" reaches all of them through the team requests already do
 * (`v1.RequestMade` with `teamId`). Teams made before this (ADR-029) still
 * count: one set to the kind, or to any kind, puts its people on the check
 * until someone edits that check's people, which moves them onto the
 * check's own team.
 */

/** The team that holds a check's people. */
export function checkTeamId(kindId: string): string {
  return `check:${kindId}`;
}

function members(state: LanguageState, teamId: string): string[] {
  return Object.entries(state.teams[teamId]?.members ?? {}).filter(([, r]) => r.value).map(([id]) => id).sort();
}

/** Teams whose people are on a check: its own, then older teams set to the kind, then older teams set to any kind. */
export function checkTeams(state: LanguageState, kindId: string): string[] {
  const own = checkTeamId(kindId);
  const ids = Object.keys(state.teams).filter((id) => id !== own).sort();
  const kindOf = (id: string) => state.teams[id]?.kindId?.value ?? null;
  return [
    ...(state.teams[own] ? [own] : []),
    ...ids.filter((id) => kindOf(id) === kindId),
    ...ids.filter((id) => kindOf(id) === null && !id.startsWith('check:'))
  ];
}

/** Everyone on a check, by profile id, sorted. */
export function checkPeople(state: LanguageState, kindId: string): string[] {
  return [...new Set(checkTeams(state, kindId).flatMap((id) => members(state, id)))].sort();
}

/**
 * The team a request for this check goes to: the first of its teams with
 * someone `eligible` other than `me`. Undefined when nobody is on the check.
 */
export function checkTeamFor(state: LanguageState, kindId: string, me: string, eligible: (profileId: string) => boolean = () => true): string | undefined {
  return checkTeams(state, kindId).find((id) => members(state, id).some((p) => p !== me && eligible(p)));
}

/** A check's helps, in the order their keys sort: library items and the language's own material. */
export type CheckHelp = { itemId: string } | { materialId: string };

export function checkHelps(state: LanguageState, kindId: string): CheckHelp[] {
  return Object.entries(state.checkHelps?.[kindId] ?? {})
    .filter(([, r]) => r.value)
    .map(([key]) => key)
    .sort()
    .map((key) => (key.startsWith('item:') ? { itemId: key.slice(5) } : { materialId: key.slice(9) }));
}

export function helpKey(h: CheckHelp): string {
  return 'itemId' in h ? `item:${h.itemId}` : `material:${h.materialId}`;
}

/** Link a help to a check, or unlink it; nothing when it already is. */
export function checkHelpSpecs(state: LanguageState, c: { commandId: string; kindId: string; help: CheckHelp; linked: boolean }): EventSpec[] {
  const now = state.checkHelps?.[c.kindId]?.[helpKey(c.help)]?.value ?? false;
  if (now === c.linked) return [];
  return [{ id: `${c.commandId}:help`, type: 'v1.CheckHelpSet', payload: { kindId: c.kindId, ...c.help, linked: c.linked } }];
}

/**
 * Set who is on a check. The check's own team gets exactly `people`; older
 * teams set to this kind give their people up to it; an older team set to
 * any kind first puts its people on every check in `kinds` (its own team
 * each), then empties. Only what changes is written. `undo` puts every
 * membership back as it was (teams made here stay, empty).
 */
export function checkPeopleSpecs(
  state: LanguageState,
  c: { commandId: string; kindId: string; people: readonly string[]; kinds: readonly string[]; nameOf: (kindId: string) => string }
): { specs: EventSpec[]; undo: () => EventSpec[] } {
  let n = 0;
  const next = () => `${c.commandId}:${n++}`;
  const specs: EventSpec[] = [];
  // teamId -> profileId -> membership wanted after this command.
  const want = new Map<string, Map<string, boolean>>();
  const was = (teamId: string, p: string) => state.teams[teamId]?.members[p]?.value ?? false;
  const put = (teamId: string, p: string, member: boolean) => {
    const m = want.get(teamId) ?? new Map<string, boolean>();
    m.set(p, member);
    want.set(teamId, m);
  };
  const ensure = (kindId: string) => {
    const teamId = checkTeamId(kindId);
    const team = state.teams[teamId];
    const name = c.nameOf(kindId);
    if (!team || team.name.value !== name) specs.push({ id: next(), type: 'v1.ReviewTeamDefined', payload: { teamId, name } });
    if (team?.kindId?.value !== kindId) specs.push({ id: next(), type: 'v1.ReviewTeamKindSet', payload: { teamId, kindId } });
    return teamId;
  };

  const kindOf = (id: string) => state.teams[id]?.kindId?.value ?? null;
  const older = Object.keys(state.teams).filter((id) => !id.startsWith('check:')).sort();
  const anyKind = older.filter((id) => kindOf(id) === null && members(state, id).length > 0);
  // An older team for any kind: its people go on every other check, then it empties.
  if (anyKind.length) {
    const theirs = [...new Set(anyKind.flatMap((id) => members(state, id)))].sort();
    for (const k of [...new Set(c.kinds)].filter((k) => k !== c.kindId).sort()) {
      const teamId = ensure(k);
      for (const p of theirs) if (!was(teamId, p)) put(teamId, p, true);
    }
    for (const id of anyKind) for (const p of members(state, id)) put(id, p, false);
  }
  // Older teams for this kind give their people up.
  for (const id of older.filter((id) => kindOf(id) === c.kindId)) for (const p of members(state, id)) put(id, p, false);
  // The check's own team: exactly `people`.
  const own = ensure(c.kindId);
  const chosen = new Set(c.people);
  for (const p of [...chosen].sort()) if (!was(own, p)) put(own, p, true);
  for (const p of members(state, own)) if (!chosen.has(p)) put(own, p, false);

  const changes: { teamId: string; profileId: string; member: boolean; before: boolean }[] = [];
  for (const [teamId, m] of [...want.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const [profileId, member] of [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (was(teamId, profileId) !== member) changes.push({ teamId, profileId, member, before: was(teamId, profileId) });
    }
  }
  for (const x of changes) specs.push({ id: next(), type: 'v1.ReviewTeamMemberSet', payload: { teamId: x.teamId, profileId: x.profileId, member: x.member } });
  return {
    specs,
    undo: () => changes.map((x, i) => ({ id: `${c.commandId}:undo:${i}`, type: 'v1.ReviewTeamMemberSet' as const, payload: { teamId: x.teamId, profileId: x.profileId, member: x.before } }))
  };
}
