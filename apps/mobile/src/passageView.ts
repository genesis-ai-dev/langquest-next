// Shared reading of one passage for the screens under it (record, version,
// review, ask, review it, already happened, workspace, back translation,
// study). Screens take `unitId` and `laneId` from their params; this is the
// one place that turns them into the derived record and the words the demo
// uses for it.
import {
  decodeHlc, deriveKinds, derivePassage, kindOf, laneName, unitTitle,
  type KindDef, type PassageState, type ProjectState, type ReviewView
} from '@langquest-next/core';
import type { Ctx } from './ctx';
import { indexesFor } from './indexes';

export interface PassageView {
  state: ProjectState;
  unitId: string;
  laneId: string;
  /** "Luke 15:11-32" */
  title: string;
  /** "Dinka" */
  lane: string;
  p: PassageState;
  kinds: KindDef[];
  kind: (id: string) => KindDef;
}

/** The passage a screen is about, from its `unitId`/`laneId` params; null while loading or when unknown. */
export function usePassage(ctx: Ctx): PassageView | null {
  const state = ctx.project.state;
  const unitId = ctx.params['unitId'];
  const laneId = ctx.params['laneId'] ?? ctx.laneId ?? undefined;
  if (!state || !unitId || !laneId || !state.units[unitId]) return null;
  return passageView(state, unitId, laneId);
}

export function passageView(state: ProjectState, unitId: string, laneId: string): PassageView {
  const idx = indexesFor(state);
  const kinds = deriveKinds(state);
  return {
    state, unitId, laneId,
    title: unitTitle(state, unitId),
    lane: laneName(state, laneId),
    p: derivePassage(state, unitId, laneId, idx),
    kinds,
    kind: (id) => kinds.find((k) => k.id === id) ?? kindOf(state, id)
  };
}

/**
 * The trail above the title on every screen you read under a passage
 * (ADR-021): the passage, tappable back to its record however deep you are.
 */
export function passageCrumbs(ctx: Ctx, v: Pick<PassageView, 'unitId' | 'laneId' | 'title'>, current: string): { label: string; onPress?: () => void }[] {
  return [
    { label: v.title, onPress: () => ctx.go('passage_record', { unitId: v.unitId, laneId: v.laneId }) },
    { label: current }
  ];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** When something happened, as the demo says it: "Just now", "2 h ago", "Sep 2", "Sep 2, 2025". */
export function when(hlc: string, now = Date.now()): string {
  if (!hlc) return '';
  const ms = decodeHlc(hlc).wallMs;
  const ago = now - ms;
  if (ago < 60_000) return 'Just now';
  if (ago < 3_600_000) return `${Math.floor(ago / 60_000)} min ago`;
  if (ago < 86_400_000) return `${Math.floor(ago / 3_600_000)} h ago`;
  const d = new Date(ms);
  const day = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date(now).getFullYear() ? day : `${day}, ${d.getFullYear()}`;
}

/** A due date ("2026-10-01") as people say it: "Oct 1", "overdue since Sep 20". */
export function dueText(due: string, now = Date.now()): string {
  const d = new Date(`${due}T12:00:00`);
  if (Number.isNaN(d.getTime())) return due;
  const day = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getTime() < now - 86_400_000 ? `overdue since ${day}` : `due ${day}`;
}

/** "looks good" / "needs changes", or "recorded" for a kind that makes content (ADR-015). */
export function outcomeText(kind: KindDef | undefined, outcome: ReviewView['outcome']): string {
  if (kind?.produces || outcome === 'recorded') return 'recorded';
  return outcome === 'looks_good' ? 'looks good' : 'needs changes';
}

/**
 * Who the feedback came from, not who typed it in (CORE-6): a session logged
 * afterwards came from the listeners even though the translator entered it.
 */
export function feedbackSource(r: Pick<ReviewView, 'via' | 'by' | 'givenBy' | 'people' | 'place'>, name: Ctx['name']): string {
  if (r.via !== 'logged') return name(r.by);
  if (r.givenBy) return r.givenBy;
  if (r.people && r.people > 1) return `${r.people} listeners${r.place ? ` at ${r.place}` : ''}`;
  return r.place ? `Listeners at ${r.place}` : name(r.by);
}

/** "in the app" / "by link" / "recorded afterwards · logged by You". */
export function viaText(r: Pick<ReviewView, 'via' | 'by'>, name: Ctx['name']): string {
  if (r.via === 'link') return 'by link';
  if (r.via === 'logged') return `recorded afterwards · logged by ${name(r.by)}`;
  return 'in the app';
}

export function versionTitle(n: number): string {
  return `Version ${n}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}
