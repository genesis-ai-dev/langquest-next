import { instantiateFlow, type AnyEvent, type EventPayloads, type EventType } from '@langquest-next/core';
import type { Random } from '../random';

/** One thing a person does: the events a screen would append for it. */
export type Action = { type: EventType; payload: EventPayloads[EventType] }[];

/**
 * What a person does with the app. A persona decides from what is on its
 * own phone: the events it appended and the events it pulled (`observe`),
 * never from the server, so offline work is decided on stale knowledge the
 * way it is in the field. It keeps its own small model of that rather than
 * querying the fold, so the simulator's cost stays out of the measurements.
 */
export interface Persona {
  readonly role: 'coordinator' | 'translator' | 'reviewer';
  observe(event: AnyEvent): void;
  /** The next thing to do, or null when there is nothing to do yet. */
  next(phone?: PhoneView): Action | null;
  /** Passages this person keeps offline beyond what the app keeps by default (Keep offline). */
  wants?(): Iterable<string>;
}

/** What a person can tell from their phone besides the events they saw. */
export interface PhoneView {
  /** Can these audio files be played here now? */
  hasAudio(hashes: readonly string[]): boolean;
}

export const FLOW_ID = 'standard_bible';
const FLOW = instantiateFlow(FLOW_ID);
export const REVIEW_KINDS = [...new Set(FLOW.flatMap((s) => s.kindIds))];

const PASSAGES_PER_BOOK = 40;

export function passageId(n: number): string {
  return `b${Math.floor(n / PASSAGES_PER_BOOK)}/p${n}`;
}

/**
 * Sets the language up: the flow and every passage, the way a template
 * does, in one batch. As a moderator (`redactShare` above 0) it then takes
 * notes out of the record as it goes, one on that share of its turns, the
 * way acting on a report does (decision 48).
 */
export function coordinator(passages: number, o: { redactShare?: number; random?: Random } = {}): Persona {
  let done = false;
  const notes: string[] = [];
  return {
    role: 'coordinator',
    observe: (e) => {
      if (e.type === 'v1.NoteAdded') notes.push(e.id);
    },
    next: () => {
      if (done) {
        const share = o.redactShare ?? 0;
        if (share <= 0 || notes.length === 0 || !o.random?.chance(share)) return null;
        return [{ type: 'v1.Redacted', payload: { eventId: notes.shift()!, reason: 'reported' } }];
      }
      done = true;
      const action: Action = [{ type: 'v1.FlowSelected', payload: { flowId: FLOW_ID, name: 'Standard Bible Flow' } }];
      for (const step of FLOW) action.push({ type: 'v1.FlowStepSet', payload: step });
      for (let b = 0; b * PASSAGES_PER_BOOK < passages; b++) {
        action.push({ type: 'v1.UnitAdded', payload: { unitId: `b${b}`, parentUnitId: null, kind: 'book', label: `Book ${b + 1}`, order: `b${String(b).padStart(3, '0')}` } });
      }
      for (let n = 0; n < passages; n++) {
        action.push({ type: 'v1.UnitAdded', payload: { unitId: passageId(n), parentUnitId: `b${Math.floor(n / PASSAGES_PER_BOOK)}`, kind: 'passage', label: `Passage ${n + 1}`, order: `p${String(n).padStart(5, '0')}` } });
      }
      return action;
    }
  };
}

/**
 * Records the passages assigned to them (every `of`-th, from `index`) once
 * they are on the phone, and records again when the latest version is sent
 * back. Each version is a few cards, composed and submitted.
 */
export function translator(o: { actorId: string; index: number; of: number; random: Random }): Persona {
  const todo: string[] = [];
  const revise = new Set<string>();
  const latest = new Map<string, string>();
  const unitOf = new Map<string, string>();
  let takes = 0;
  return {
    role: 'translator',
    observe(e) {
      if (e.type === 'v1.UnitAdded' && e.payload.kind === 'passage') {
        const n = Number(e.payload.unitId.slice(e.payload.unitId.lastIndexOf('/p') + 2));
        if (n % o.of === o.index && !latest.has(e.payload.unitId) && !todo.includes(e.payload.unitId)) todo.push(e.payload.unitId);
      } else if (e.type === 'v1.ReviewRecorded' && e.payload.outcome === 'needs_changes') {
        const unit = unitOf.get(e.payload.takeId);
        if (unit && latest.get(unit) === e.payload.takeId) revise.add(unit);
      }
    },
    next() {
      const unit = revise.values().next().value ?? todo.shift();
      if (!unit) return null;
      revise.delete(unit);
      const takeId = `${o.actorId}-take${++takes}-${o.random.int(0, 1e9)}`;
      const cards = Array.from({ length: o.random.int(2, 4) }, () => ({ hash: o.random.hash(), durationMs: o.random.int(3_000, 12_000) }));
      const parentTakeId = latest.get(unit) ?? null;
      latest.set(unit, takeId);
      unitOf.set(takeId, unit);
      return [
        { type: 'v1.RecordingAdded', payload: { recordingId: `${takeId}-rec`, unitId: unit, kind: 'target', cards } },
        { type: 'v1.TakeComposed', payload: { takeId, unitId: unit, cardHashes: cards.map((c) => c.hash), parentTakeId } },
        { type: 'v1.TakeSubmitted', payload: { takeId } }
      ];
    }
  };
}

/**
 * Reviews submitted versions for one review kind as they reach the phone,
 * sending some back, and sometimes leaves a note on the version.
 */
export function reviewer(o: { actorId: string; kindId: string; random: Random; sendBackRate?: number; noteRate?: number }): Persona {
  const queue: string[] = [];
  const queued = new Set<string>();
  const unitOf = new Map<string, string>();
  const cardsOf = new Map<string, string[]>();
  let reviews = 0;
  return {
    role: 'reviewer',
    observe(e) {
      if (e.type === 'v1.TakeComposed') {
        unitOf.set(e.payload.takeId, e.payload.unitId);
        cardsOf.set(e.payload.takeId, e.payload.cardHashes);
      } else if (e.type === 'v1.TakeSubmitted' && e.actorId !== o.actorId && !queued.has(e.payload.takeId)) {
        queued.add(e.payload.takeId);
        queue.push(e.payload.takeId);
      }
    },
    // A version waiting for review is one to keep on the phone.
    wants: () => queue.map((takeId) => unitOf.get(takeId)).filter((u): u is string => !!u),
    next(phone) {
      // Nobody reviews what they cannot hear: the first waiting version whose audio is here.
      const i = queue.findIndex((takeId) => !phone || phone.hasAudio(cardsOf.get(takeId) ?? []));
      if (i < 0) return null;
      const takeId = queue.splice(i, 1)[0]!;
      const id = `${o.actorId}-review${++reviews}`;
      const outcome = o.random.chance(o.sendBackRate ?? 0.3) ? 'needs_changes' : 'looks_good';
      const action: Action = [{ type: 'v1.ReviewRecorded', payload: { reviewId: id, takeId, kindId: o.kindId, outcome, via: 'app' } }];
      const unitId = unitOf.get(takeId);
      if (unitId && o.random.chance(o.noteRate ?? 0.3)) {
        action.push({ type: 'v1.NoteAdded', payload: { noteId: `${id}-note`, unitId, anchor: { kind: 'version', takeId }, text: 'A note on this version.' } });
      }
      return action;
    }
  };
}
