import { CommandError, type EventSpec } from '@langquest-next/core';
import { useCallback, useRef } from 'react';
import { commandErrorText } from '../coreText';
import { t } from '../i18n';
import type { ToastSpec } from '../kit';
import { reportError } from '../report';
import type { LanguageHandle } from '../useLanguage';

/**
 * Saying what happened (CORE-5), and applying a command's events then
 * saying so, with Undo when it can be undone. Toasts live in their own
 * component, so showing one never re-renders the screens on the stack:
 * `toast` only hands the message to whatever `registerToast` was given.
 */
export function useActions(language: LanguageHandle) {
  const showToast = useRef<(spec: ToastSpec) => void>(() => {});
  const registerToast = useCallback((show: (spec: ToastSpec) => void) => { showToast.current = show; }, []);
  const toast = useCallback((message: string, undo?: () => void | Promise<void>) => {
    const spec: ToastSpec = { id: Date.now(), message, ...(undo ? { undo } : {}) };
    showToast.current(spec);
  }, []);
  const languageRef = useRef(language);
  languageRef.current = language;
  const act = useCallback(async (specs: EventSpec[], message: string, undo?: () => EventSpec[], undone?: string) => {
    try {
      await languageRef.current.run(specs);
    } catch (e) {
      // Core's refusal in words; anything else is a fault, with its code.
      toast(e instanceof CommandError ? t('shell.toast.notSaved', { reason: commandErrorText(e) }) : t('shell.toast.notSavedCode', { code: reportError('save change', e) }));
      throw e;
    }
    toast(message, undo ? async () => {
      try { await languageRef.current.run(undo()); toast(undone ?? t('common.undone')); } catch (e) {
        toast(e instanceof CommandError ? t('shell.toast.notUndone', { reason: commandErrorText(e) }) : t('shell.toast.notUndoneCode', { code: reportError('undo change', e) }));
      }
    } : undefined);
  }, [toast]);
  return { toast, act, registerToast };
}
