// Undo for a language's checks (decision 91): put back the checks it had
// before a change (a check removed, moved or joined, or a ready-made flow
// copied in). Core `restoreFlow` puts back the language's own steps by
// their ids, but a step taken out is out for good (`FlowStepRemoved` is
// add-wins, decision 32), so a check Undo should bring back would stay
// gone. A step that has been taken out comes back as a new step of the
// same checks; reviews, departures and requests name the check's kind, so
// what the record says about it stays with it.
import { commands, CUSTOM_FLOW, type EventSpec, type FlowSelection, type LanguageState } from '@langquest-next/core';
import { indexesFor } from '../indexes';

export interface ChecksBefore {
  flow: FlowSelection | null;
  steps: readonly { id: string; kindIds: readonly string[]; checkpoint: boolean }[];
}

/** The events that put the language's checks back as `previous` had them. */
export function restoreChecks(state: LanguageState, previous: ChecksBefore, commandId: string): EventSpec[] {
  const c = commands(state, indexesFor(state));
  // A library flow it used: choosing it again is enough (its steps were never removed).
  if (previous.flow && previous.flow.flowId !== CUSTOM_FLOW) return c.restoreFlow({ commandId, previous: { flow: previous.flow, steps: previous.steps.map((s) => ({ ...s, kindIds: [...s.kindIds] })) } });
  return c.saveFlowSteps({
    commandId,
    steps: previous.steps.map((s) => ({ ...(state.removedSteps[s.id] ? {} : { stepId: s.id }), kindIds: [...s.kindIds], checkpoint: s.checkpoint }))
  });
}
