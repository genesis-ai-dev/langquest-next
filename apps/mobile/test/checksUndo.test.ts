// Undo of a change to a language's checks (decision 91, checks/undo.ts):
// a check taken out comes back, against real folds of the event log.
import { describe, expect, it } from 'vitest';
import { commands, DEFAULT_KINDS, deriveFlow, foldLanguage, HlcClock, type AnyEvent, type EventSpec } from '@langquest-next/core';
import { restoreChecks } from '../src/checks/undo';
import { removeRow, rowsOf, stepsOf } from '../src/checks/model';
import { checksSaved, hearChecksSaved } from '../src/checks/checksHistory';

function language() {
  const log: AnyEvent[] = [];
  let wall = 1_700_000_000_000;
  const clock = new HlcClock('d', () => wall);
  const run = (specs: EventSpec[]) => {
    for (const s of specs) {
      wall += 1000;
      log.push({ id: s.id, type: s.type, orgId: 'o', streamId: 'L1', actorId: 'admin', deviceId: 'd', hlc: clock.next(), payload: s.payload, serverSeq: log.length + 1 } as AnyEvent);
    }
  };
  return { run, state: () => foldLanguage(log) };
}

const kindsOf = (state: ReturnType<typeof foldLanguage>) => deriveFlow(state).steps.map((s) => s.kindIds.join('+'));
const before = (state: ReturnType<typeof foldLanguage>) => ({ flow: state.flow?.value ?? null, steps: deriveFlow(state).steps });

describe('Undo of a change to the checks', () => {
  const standard = [{ kindIds: ['peer', 'bt'] }, { kindIds: ['community'] }, { kindIds: ['consultant'], checkpoint: true }, { kindIds: ['final'] }];

  it('brings back a check that was removed', () => {
    const l = language();
    l.run(commands(l.state()).copyFlow({ commandId: 'copy', name: 'Standard Bible Flow', kinds: DEFAULT_KINDS, steps: standard }));
    expect(kindsOf(l.state())).toEqual(['peer+bt', 'community', 'consultant', 'final']);
    const was = before(l.state());
    const rows = removeRow(rowsOf(deriveFlow(l.state()).steps), 2);
    l.run(commands(l.state()).saveFlowSteps({ commandId: 'remove', steps: stepsOf(rows) }));
    expect(kindsOf(l.state())).toEqual(['peer+bt', 'consultant', 'final']);
    l.run(restoreChecks(l.state(), was, 'undo'));
    expect(kindsOf(l.state())).toEqual(['peer+bt', 'community', 'consultant', 'final']);
    expect(deriveFlow(l.state()).steps.find((s) => s.kindIds[0] === 'consultant')?.checkpoint).toBe(true);
  });

  it('puts back the checks a ready-made flow replaced', () => {
    const l = language();
    l.run(commands(l.state()).copyFlow({ commandId: 'copy', name: 'Standard Bible Flow', kinds: DEFAULT_KINDS, steps: standard }));
    const was = before(l.state());
    l.run(commands(l.state()).copyFlow({ commandId: 'quick', name: 'Quick Check', kinds: DEFAULT_KINDS, steps: [{ kindIds: ['peer'] }, { kindIds: ['final'] }] }));
    expect(kindsOf(l.state())).toEqual(['peer', 'final']);
    l.run(restoreChecks(l.state(), was, 'undo'));
    expect(kindsOf(l.state())).toEqual(['peer+bt', 'community', 'consultant', 'final']);
  });

  it('keeps the ids of steps that were never taken out', () => {
    const l = language();
    l.run(commands(l.state()).copyFlow({ commandId: 'copy', name: 'Standard Bible Flow', kinds: DEFAULT_KINDS, steps: standard }));
    const was = before(l.state());
    const ids = was.steps.map((s) => s.id);
    const rows = rowsOf(deriveFlow(l.state()).steps).map((r, i) => (i === 3 ? { ...r, checkpoint: true } : r));
    l.run(commands(l.state()).saveFlowSteps({ commandId: 'lock', steps: stepsOf(rows) }));
    l.run(restoreChecks(l.state(), was, 'undo'));
    expect(deriveFlow(l.state()).steps.map((s) => s.id)).toEqual(ids);
  });
});

describe('a save on a check\'s own page reaches the open Checks list (decision 134)', () => {
  const was = { flow: null, steps: [] };
  it('goes to the list open for that language, and to nothing once it is left', () => {
    const heard: string[] = [];
    const stop = hearChecksSaved('L1', (_b, what) => heard.push(what));
    checksSaved('L2', was, 'Beta saved');
    checksSaved('L1', was, 'Community check removed');
    stop();
    checksSaved('L1', was, 'Alpha saved');
    expect(heard).toEqual(['Community check removed']);
  });
  it('a list left late does not stop the one opened after it', () => {
    const heard: string[] = [];
    const stopFirst = hearChecksSaved('L1', () => heard.push('first'));
    const stopSecond = hearChecksSaved('L1', () => heard.push('second'));
    stopFirst();
    checksSaved('L1', was, 'saved');
    stopSecond();
    expect(heard).toEqual(['second']);
  });
});
