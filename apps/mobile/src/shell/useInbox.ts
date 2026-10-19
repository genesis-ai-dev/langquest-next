import AsyncStorage from '@react-native-async-storage/async-storage';
import { highlightsOf, type Update } from '@langquest-next/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePendingRequestCount } from '../invites/useInviteRequests';
import type { Blocks } from '../moderation/moderationData';
import { useOpenReportCount } from '../moderation/useModeration';
import type { Session } from './session';
import type { LanguageHandle } from '../sync/useLanguage';

/**
 * What is waiting and what happened (WORK-1, INBOX-1): the work for this
 * person, the record's updates and which of them this device has shown,
 * and, for whoever may act on them, open reports and people asking to join.
 * Both read off the passages' lines (decisions.md 140): the updates from
 * the passages whose line says they concern this person, read again only
 * when that line changes.
 */
export function useInbox(o: { language: Pick<LanguageHandle, 'state' | 'lines' | 'updatesFor'>; actorId: string; orgId: string; session: Session; blocks: Blocks; signedIn: boolean }) {
  const { language, actorId, orgId, session, blocks, signedIn } = o;
  const { state, lines, updatesFor } = language;
  const forYou = useMemo(() => state
    ? highlightsOf(lines, state, actorId, { canRecord: session.can('translate'), canReview: session.can('review') }).length
    : 0, [state, lines, actorId, session]);
  const [all, setAll] = useState<Update[]>([]);
  const open = state !== null;
  useEffect(() => {
    if (!open) { setAll([]); return; }
    let current = true;
    updatesFor(actorId).then((found) => { if (current) setAll(found); }).catch(() => { /* asked again when a line changes */ });
    return () => { current = false; };
  }, [open, lines, actorId, updatesFor]);
  // Nothing from someone this person blocked reaches their Inbox (decisions.md 48).
  const updates = useMemo(() => all.filter((u) => !blocks.has(u.by)), [all, blocks]);
  const readKey = `inbox-read:${actorId}:${orgId}`;
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => { AsyncStorage.getItem(readKey).then((v) => setReadIds(new Set(v ? JSON.parse(v) as string[] : []))).catch(() => {}); }, [readKey]);
  const markRead = useCallback((ids: string[]) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      AsyncStorage.setItem(readKey, JSON.stringify([...next].slice(-2000))).catch(() => {});
      return next;
    });
  }, [readKey]);
  const unread = updates.filter((u) => !readIds.has(u.id)).length;
  // Open reports count toward the Inbox badge (the tab, or My Work's bell) for whoever may act on them (decisions.md 48).
  const reportCount = useOpenReportCount(orgId, signedIn && (session.can('manage_structure') || session.can('invite_members')));
  // People asking to join count too, for whoever may admit them.
  const requestCount = usePendingRequestCount(orgId, signedIn && session.can('invite_members'));
  const isRead = useCallback((id: string) => readIds.has(id), [readIds]);
  return { forYou, updates, unread: unread + reportCount + requestCount, isRead, markRead };
}
