// Saving a language's checks (checks/LanguageChecks.tsx, screens/checks.tsx). The
// list of checks takes a save back with its own Undo (decision 134), not a toast's:
// each save is a step there while the list is open (checksHistory.ts).
import { commands, deriveFlow, type EventSpec } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { indexesFor } from '../sync/indexes';
import { failureMessage } from '../diagnostics/report';
import { stepsOf, type CheckRow } from './model';
import type { ChecksBefore } from './undo';
import { checksSaved } from './checksHistory';

/** Save the language's checks as `rows`. Saved, it gives the checks as they were, for Undo; null when not saved. */
export async function saveRows(ctx: Ctx, rows: CheckRow[], message: string, before: EventSpec[] = []): Promise<ChecksBefore | null> {
  const state = ctx.language.state;
  if (!state) return null;
  const c = commands(state, indexesFor(state));
  const flow = deriveFlow(state);
  const previous = { flow: state.flow?.value ?? null, steps: flow.steps };
  let specs: EventSpec[];
  try {
    specs = [...before, ...c.saveFlowSteps({ commandId: Crypto.randomUUID(), steps: stepsOf(rows) })];
  } catch (e) {
    ctx.toast(t('common.notSaved', { reason: failureMessage('save checks', e) })); // i18n-ignore: log label
    return null;
  }
  try {
    await ctx.act(specs, message);
    checksSaved(ctx.language.languageId, previous, message);
    return previous;
  } catch {
    return null;
  }
}
