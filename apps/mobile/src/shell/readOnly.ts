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
