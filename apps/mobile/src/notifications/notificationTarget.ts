// Where an Inbox row from the server leads (design principle 11, demo
// docs/design-principles.md: a to-do opens the task itself). Updates about a
// passage carry its language and unit (server/projectionWorker.ts), so they
// open that passage, in its language and organization; join requests and
// reports are the organization's, and open where those are decided.
import { joinRequestIdOf } from '../account/accountText';
import type { RemoteNotification } from './notifications';

export type NotificationTarget =
  | { kind: 'passage'; orgId: string; languageId: string; unitId: string }
  | { kind: 'join'; orgId: string; requestId: string | null }
  | { kind: 'report'; orgId: string }
  | { kind: 'organization'; orgId: string; languageId: string | null };

export function notificationTarget(row: Pick<RemoteNotification, 'id' | 'org_id' | 'language_id' | 'kind' | 'unit_id'>): NotificationTarget {
  if (row.kind === 'join_request') return { kind: 'join', orgId: row.org_id, requestId: joinRequestIdOf(row.id)?.requestId ?? null };
  if (row.kind === 'content_report') return { kind: 'report', orgId: row.org_id };
  if (row.language_id && row.unit_id) return { kind: 'passage', orgId: row.org_id, languageId: row.language_id, unitId: row.unit_id };
  return { kind: 'organization', orgId: row.org_id, languageId: row.language_id };
}

/** What opening another organization should open once it is in: the passage, or at least the language. */
export function openAfterSwitch(to: NotificationTarget): { languageId: string; unitId?: string } | undefined {
  if (to.kind === 'passage') return { languageId: to.languageId, unitId: to.unitId };
  if (to.kind === 'organization' && to.languageId) return { languageId: to.languageId };
  return undefined;
}
