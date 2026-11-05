/**
 * The benches' synthetic language: the Standard Bible Flow and, per passage,
 * a unit, two recordings and takes, two submissions, four reviews and two
 * notes, 40 passages to a book.
 */
import { instantiateFlow, type AnyEvent } from '@langquest-next/core';

export function syntheticLanguage(passages: number): AnyEvent[] {
  const events: AnyEvent[] = [];
  let n = 0;
  let wall = 1_700_000_000_000;
  const push = (type: string, payload: unknown, actorId = 't1', device = 'dA') => {
    wall += 7;
    n += 1;
    events.push({ id: `e${n}`, type, orgId: 'o', streamId: 'L1', actorId, deviceId: device, hlc: `${String(wall).padStart(15, '0')}:000000:${device}`, payload, serverSeq: n } as AnyEvent);
  };
  const flow = instantiateFlow('standard_bible');
  push('v1.FlowSelected', { flowId: 'standard_bible', name: 'Standard Bible Flow' }, 'lead');
  for (const s of flow) push('v1.FlowStepSet', s, 'lead');
  const kinds = [...new Set(flow.flatMap((s) => s.kindIds))];
  for (let b = 0; b * 40 < passages; b++) push('v1.UnitAdded', { unitId: `b${b}`, parentUnitId: null, kind: 'book', label: `Book ${b}`, order: `b${b}` }, 'lead');
  for (let p = 0; p < passages; p++) {
    const unitId = `b${Math.floor(p / 40)}/p${p}`;
    push('v1.UnitAdded', { unitId, parentUnitId: `b${Math.floor(p / 40)}`, kind: 'passage', label: `P ${p}`, order: `p${p}` }, 'lead');
    let parentTakeId: string | null = null;
    for (let t = 0; t < 2; t++) {
      const cards = [0, 1, 2].map((c) => ({ hash: `${p}-${t}-${c}`.padEnd(64, '0'), durationMs: 4000 }));
      const takeId = `k${p}-${t}`;
      push('v1.RecordingAdded', { recordingId: `r${p}-${t}`, unitId, kind: 'target', cards });
      push('v1.TakeComposed', { takeId, unitId, cardHashes: cards.map((c) => c.hash), parentTakeId });
      push('v1.TakeSubmitted', { takeId });
      for (const kindId of kinds.slice(0, 2)) push('v1.ReviewRecorded', { reviewId: `rv${p}-${t}-${kindId}`, takeId, kindId, outcome: t ? 'looks_good' : 'needs_changes', via: 'app' }, 'r1', 'dR');
      push('v1.NoteAdded', { noteId: `n${p}-${t}`, unitId, anchor: { kind: 'version', takeId }, text: 'A note about this version.' }, 'r1', 'dR');
      parentTakeId = takeId;
    }
  }
  return events;
}
