import { CommandError } from '@langquest-next/core';
import { t } from '../i18n';
import type { LanguageHandle } from '../sync/useLanguage';
import type { OrgHandle } from '../sync/useOrg';

/**
 * The organization's and the language's handles with every way of writing
 * refused, for a read-only session (a Global Viewer looking in, decisions.md
 * 158). Every event a screen or a hook adds goes through these four, so one
 * guard covers every screen, including ones written later. Nothing reaches
 * the local log, so nothing waits there refused (PLAN.md invariant 1).
 */
const refuse = (): Promise<never> => Promise.reject(new CommandError(t('globalViewer.readOnly')));

export function readOnlyOrg(org: OrgHandle): OrgHandle {
  return { ...org, append: refuse };
}

export function readOnlyLanguage(language: LanguageHandle): LanguageHandle {
  return { ...language, append: refuse, appendMany: refuse, run: refuse };
}

/** Whether the open organization is read-only for this session, for messages outside it (failureMessage). */
let readOnlyNow = false;

export function setReadOnlySession(on: boolean): void {
  readOnlyNow = on;
}

/** Is the open organization read-only for this session? The recorder asks before it opens the microphone. */
export function isReadOnlySession(): boolean {
  return readOnlyNow;
}

/**
 * The words for a server's refusal of a write while read-only: a call the
 * screens make to the server directly (an invite, a listing) is refused as
 * not allowed (SQLSTATE 42501), which here is the session, not a fault.
 */
export function readOnlyRefusal(e: unknown): string | null {
  return readOnlyNow && (e as { code?: unknown } | null)?.code === '42501' ? t('globalViewer.readOnly') : null;
}
