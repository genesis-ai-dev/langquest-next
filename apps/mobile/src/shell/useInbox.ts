import AsyncStorage from '@react-native-async-storage/async-storage';
import { highlightsFor, updatesFor, type LanguageState } from '@langquest-next/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { indexesFor } from '../sync/indexes';
import { usePendingRequestCount } from '../invites/invites';
import { useOpenReportCount, type Blocks } from '../moderation/moderationData';
import type { Session } from './session';

/**
 * What is waiting and what happened (WORK-1, INBOX-1): the work for this
 * person, the record's updates and which of them this device has shown,
 * and, for whoever may act on them, open reports and people asking to join.
 */
export function useInbox(o: { state: LanguageState | null; actorId: string; orgId: string; session: Session; blocks: Blocks; signedIn: boolean }) {
  const { state, actorId, orgId, session, blocks, signedIn } = o;
  const forYou = useMemo(() => state
    ? highlightsFor(state, actorId, { canRecord: session.can('translate'), canReview: session.can('review') }, indexesFor(state)).length
    : 0, [state, actorId, session]);
  // Nothing from someone this person blocked reaches their Inbox (decisions.md 48).
  const updates = useMemo(() => state
    ? updatesFor(state, actorId, indexesFor(state)).filter((u) => !blocks.has(u.by))
    : [], [state, actorId, blocks]);
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
