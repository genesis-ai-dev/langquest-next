import { diagConnection, isMissing, withDiag } from '../db';
import { failed, off, ok, type Alert, type Section } from '../section';
import type { Env } from '../env';

/**
 * The Roadmap page (docs/roadmap.md, pageRoadmap.ts): every item of the public roadmap with how important
 * people said it is and what they wrote, and the suggestions no admin has answered yet, from
 * diag.ops_roadmap() as diag_reader. The emails people left are here, for the team to write back; no public
 * page reads this.
 */

export type RoadmapItemState = 'progress' | 'planned' | 'considering' | 'done' | 'hidden';

export interface RoadmapNote {
  /** 0 not important, 1 nice to have, 2 important, 3 critical. */
  importance: number;
  words: string | null;
  email: string | null;
  language: string;
  at: string;
  /** It came as a suggestion, which an admin added to this item. */
  suggestion: boolean;
}

export interface RoadmapItem {
  id: string;
  state: RoadmapItemState;
  title: string;
  body: string;
  issue: string | null;
  /** The picture's version, or null when it has none. */
  picture: number | null;
  doneAt: string | null;
  at: string;
  updatedAt: string;
  /** How many people picked each importance, from not important (0) to critical (3). */
  counts: [number, number, number, number];
  /** What people wrote or left an email with, the newest first (at most 200). */
  notes: RoadmapNote[];
}

export interface RoadmapSuggestion { id: string; importance: number; words: string; email: string | null; language: string; at: string }

export interface Roadmap {
  items: RoadmapItem[];
  suggestions: RoadmapSuggestion[];
  /** Sends in the last 24 hours, and the most the page takes in a day. */
  day: number;
  dayMax: number;
}

export const ROADMAP_MIGRATION = 'Needs migration 20261127233000_ops_roadmap.sql on this database.';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The page's lines: suggestions that wait for an answer, and a day's sends at the cap. */
export function roadmapAlerts(r: Roadmap): Alert[] {
  const out: Alert[] = [];
  const waiting = r.suggestions.length;
  if (waiting) out.push({ level: 'watch', key: 'roadmap-suggestions', text: `${plural(waiting, 'roadmap suggestion')} ${waiting === 1 ? 'waits' : 'wait'} for an answer (Roadmap).` });
  if (r.dayMax > 0 && r.day >= r.dayMax) out.push({ level: 'problem', key: 'roadmap-full', text: `The public roadmap took its ${r.dayMax} sends of the day: it refuses more until a day has passed (Roadmap).` });
  return out;
}

export async function roadmapSection(env: Pick<Env, 'DIAG'>): Promise<Section> {
  try {
    return await withDiag(diagConnection(env), async (query) => {
      const r = await query<Roadmap>('select diag.ops_roadmap() as v');
      return ok(r, roadmapAlerts(r));
    });
  } catch (e) {
    return isMissing(e) ? off(ROADMAP_MIGRATION) : failed(e instanceof Error ? e.message : String(e));
  }
}
