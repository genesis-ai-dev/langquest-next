import { CommandError, type EventSpec } from '@langquest-next/core';
import { useCallback, useRef } from 'react';
import { commandErrorText } from '../i18n/coreText';
import { t } from '../i18n';
import type { ToastSpec } from '../ui/kit';
import { reportError } from '../diagnostics/report';
import type { LanguageHandle } from '../sync/useLanguage';

/**
 * Saying what happened (CORE-5), and applying a command's events then
 * saying so. A toast never offers Undo (decision 134): it would run out with
 * the toast, so the way back stays on the screen, with the thing. Toasts
 * live in their own component, so showing one never re-renders the screens
 * on the stack: `toast` only hands the message to whatever `registerToast`
 * was given.
 */
export function useActions(language: LanguageHandle) {
  const showToast = useRef<(spec: ToastSpec) => void>(() => {});
  const registerToast = useCallback((show: (spec: ToastSpec) => void) => { showToast.current = show; }, []);
  const toast = useCallback((message: string) => {
    const spec: ToastSpec = { id: Date.now(), message };
    showToast.current(spec);
  }, []);
  const languageRef = useRef(language);
  languageRef.current = language;
  const act = useCallback(async (specs: EventSpec[], message: string) => {
    try {
      await languageRef.current.run(specs);
    } catch (e) {
      // Core's refusal in words; anything else is a fault, with its code.
      toast(e instanceof CommandError ? t('shell.toast.notSaved', { reason: commandErrorText(e) }) : t('shell.toast.notSavedCode', { code: reportError('save change', e) }));
      throw e;
    }
    toast(message);
  }, [toast]);
  return { toast, act, registerToast };
}
