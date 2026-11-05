// Undo and Redo on a language's list of checks (decision 134): each save of
// the list (a check added, moved, joined, locked or removed, here or on a
// check's own page opened from it, or a ready-made set used) is a step, kept
// until the list is left. Undo writes the checks
// back as they were (restoreChecks: a removed step comes back as a new step
// of the same checks), Redo as Undo found them; both are new events.
import * as Crypto from 'expo-crypto';
import { deriveFlow, type LanguageState } from '@langquest-next/core';
import { useCallback, useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { failureMessage } from '../diagnostics/report';
import { emptyHistory, redoStep, undoStep, type History } from '../ui/undoModel';
import type { UndoRedoProps } from '../ui/undoRedo';
import { restoreChecks, type ChecksBefore } from './undo';
import { hearChecksSaved } from './checksHistory';

const checksOf = (s: LanguageState): ChecksBefore => ({ flow: s.flow?.value ?? null, steps: deriveFlow(s).steps });

export function useChecksUndo(ctx: Ctx) {
  const [history, setHistory] = useState<History<ChecksBefore>>(emptyHistory);
  const [busy, setBusy] = useState(false);
  /**
   * A save made: the checks before it. What it made them is read when it is
   * undone (the checks as they are then), so Redo puts back exactly that.
   */
  const did = useCallback((before: ChecksBefore, what: string) =>
    setHistory((h) => ({ done: [...h.done, { before, after: before, what }], undone: [] })), []);
  const languageId = ctx.language.languageId;
  // Every save of these checks while the list is open, saveRows' included.
  useEffect(() => hearChecksSaved(languageId, did), [languageId, did]);
  async function travel(which: 'undo' | 'redo') {
    const s = ctx.language.state;
    const step = which === 'undo' ? undoStep(history) : redoStep(history);
    if (!s || !step || busy) return;
    const now = checksOf(s);
    setBusy(true);
    try {
      await ctx.language.run(restoreChecks(s, step.to, Crypto.randomUUID()));
      // The step moved to the other side remembers the checks it found, for the way back.
      const moved = which === 'undo' ? step.history.undone : step.history.done;
      const last = moved[moved.length - 1]!;
      const fixed = which === 'undo' ? { ...last, after: now } : { ...last, before: now };
      setHistory(which === 'undo' ? { ...step.history, undone: [...moved.slice(0, -1), fixed] } : { ...step.history, done: [...moved.slice(0, -1), fixed] });
      AccessibilityInfo.announceForAccessibility(step.what ? t(which === 'undo' ? 'common.undoneWhat' : 'common.redoneWhat', { what: step.what })
        : which === 'undo' ? t('common.undone') : t('translate.redone'));
    } catch (e) {
      ctx.toast(t(which === 'undo' ? 'common.notUndone' : 'common.notSaved', { reason: failureMessage(`checks: ${which}`, e) }), 'problem');
    } finally { setBusy(false); }
  }
  const lastDone = history.done[history.done.length - 1];
  const lastUndone = history.undone[history.undone.length - 1];
  const props: UndoRedoProps = {
    canUndo: !!lastDone && !busy, canRedo: !!lastUndone && !busy,
    ...(lastDone?.what ? { undoWhat: lastDone.what } : {}), ...(lastUndone?.what ? { redoWhat: lastUndone.what } : {}),
    onUndo: () => void travel('undo'), onRedo: () => void travel('redo')
  };
  return { did, props };
}
