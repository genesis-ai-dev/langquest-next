import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { HlcClock } from '../src/hlc';
import { commands } from '../src/commands';
import { foldLanguage } from '../src/reducer';
import { emptyLanguageState } from '../src/state';
import { flowTemplate, instantiateFlow } from '../src/record';
import { derivePassage } from '../src/passage';

/**
 * A fixture organization for the export's tests (packages/core and
 * apps/web): one language, two versions of a passage, and a review with a
 * voice comment. Events carry stream ids `_org` and `din`.
 */

export const NOW = Date.UTC(2026, 9, 1);
export const NAMES: Record<string, string> = { akol: 'Akol Deng', ayen: 'Ayen Mabior', lead: 'Lead' };

export function fixture() {
  const events: AnyEvent[] = [];
  let wall = Date.UTC(2026, 8, 1);
  let seq = 0;
  const clocks = new Map<string, HlcClock>();
  const emit = <T extends EventType>(actorId: string, type: T, payload: EventPayloads[T], stream = 'din') => {
    const clock = clocks.get(actorId) ?? new HlcClock(actorId, () => wall);
    clocks.set(actorId, clock);
    wall += 86_400_000;
    seq += 1;
    events.push({ id: `x${seq}`, type, orgId: 'o', streamId: stream, actorId, deviceId: actorId, hlc: clock.next(), payload } as AnyEvent);
  };
  const state = () => foldLanguage(events.filter((e) => e.streamId === 'din'), emptyLanguageState());
  const run = (actorId: string, build: (c: ReturnType<typeof commands>) => { type: EventType; payload: unknown }[]) => {
    for (const spec of build(commands(state()))) emit(actorId, spec.type, spec.payload as never);
  };
  emit('lead', 'v1.LanguageAdded', { languageId: 'din', name: 'Dinka', code: 'din', sourceCode: 'eng' } as never, '_org');
  emit('lead', 'v1.UnitAdded', { unitId: 'john', parentUnitId: null, kind: 'book', label: 'John', order: 'b' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john3', parentUnitId: 'john', kind: 'passage', label: 'John 3:1-21', order: 'b1' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john4', parentUnitId: 'john', kind: 'passage', label: 'John 4:1-42', order: 'b2' });
  for (const step of instantiateFlow('standard_bible')) emit('lead', 'v1.FlowStepSet', step);
  emit('lead', 'v1.FlowSelected', { flowId: 'standard_bible', name: flowTemplate('standard_bible')!.name });
  const a = 'a'.repeat(64), b = 'b'.repeat(64), c = 'c'.repeat(64), note = 'd'.repeat(64);
  emit('akol', 'v1.RecordingAdded', { recordingId: 'r1', unitId: 'john3', kind: 'target', cards: [{ hash: a, durationMs: 4000, format: 'm4a' }, { hash: b, durationMs: 2500, format: 'm4a' }] });
  run('akol', (k) => k.publishVersion({ commandId: 'v1', unitId: 'john3', cardHashes: [a, b] }));
  emit('akol', 'v1.RecordingAdded', { recordingId: 'r2', unitId: 'john3', kind: 'target', cards: [{ hash: c, durationMs: 3000, format: 'm4a' }] });
  run('akol', (k) => k.publishVersion({ commandId: 'v2', unitId: 'john3', cardHashes: [a, c], note: 'Fixed verse 3.' }));
  const take = derivePassage(state(), 'john3').latest!.takeId;
  emit('ayen', 'v1.ReviewRecorded', { reviewId: 'rv1', takeId: take, kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Verse 3 is unclear.', commentBlobHash: note });
  return { events, state: state(), take, hashes: { a, b, c, note } };
}

