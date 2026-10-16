// Saving a language's checks, with Undo (checks/LanguageChecks.tsx, screens/checks.tsx).
import { commands, deriveFlow, type EventSpec } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { indexesFor } from '../sync/indexes';
import { failureMessage } from '../diagnostics/report';
import { stepsOf, type CheckRow } from './model';
import { restoreChecks } from './undo';

/** Save the language's checks as `rows`, with Undo back to the steps it had. */
export async function saveRows(ctx: Ctx, rows: CheckRow[], message: string, before: EventSpec[] = []): Promise<boolean> {
  const state = ctx.language.state;
  if (!state) return false;
  const c = commands(state, indexesFor(state));
  const flow = deriveFlow(state);
  const previous = { flow: state.flow?.value ?? null, steps: flow.steps };
  let specs: EventSpec[];
  try {
    specs = [...before, ...c.saveFlowSteps({ commandId: Crypto.randomUUID(), steps: stepsOf(rows) })];
  } catch (e) {
    ctx.toast(t('common.notSaved', { reason: failureMessage('save checks', e) })); // i18n-ignore: log label
    return false;
  }
  const undo = () => {
    const s = ctx.language.state;
    return s ? restoreChecks(s, previous, Crypto.randomUUID()) : [];
  };
  try {
    await ctx.act(specs, message, undo);
    return true;
  } catch {
    return false;
  }
}
