// Requests to join, as screens follow them (invites/invites.ts makes the calls).
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { noteExpected } from '../diagnostics/report';
import { requestOutcome, type RequestOutcome } from './requestOutcome';
import { myOrganizations } from '../server/account';
import * as server from '../server/invites';
import { requestListeners } from './invites';

/**
 * How many people are asking to join, for the Inbox badge (the tab, or My
 * Work's bell): read when the app comes forward, every minute (as often as
 * pushes go, decisions.md 68), and after someone decides; offline it keeps
 * the last count. A count only, no rows. Only org-wide Invite can read
 * requests (`join_requests_read`).
 */
export function usePendingRequestCount(orgId: string, enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) { setCount(0); return; }
    let active = true;
    const load = () => {
      void (async () => {
        const { count: open, error } = await server.joinRequestCount(orgId);
        if (error) throw new Error(error.message);
        if (active) setCount(open ?? 0);
      })().catch((e: unknown) => { noteExpected('pending request count', e); });
    };
    load();
    requestListeners.add(load);
    const app = AppState.addEventListener('change', (state) => { if (state === 'active') load(); });
    const timer = setInterval(load, 60_000);
    return () => { active = false; requestListeners.delete(load); app.remove(); clearInterval(timer); };
  }, [orgId, enabled]);
  return count;
}

/**
 * Watches a sent join request until it is decided (AUTH-5), so the person
 * who asked is taken in, or told no, without signing in again: asked when
 * the screen opens, when the app comes forward, and every minute until it
 * is decided. Offline it keeps waiting.
 */
export function useRequestOutcome(actorId: string, request: { id: string; orgId: string } | null): RequestOutcome {
  const [outcome, setOutcome] = useState<RequestOutcome>({ kind: 'waiting' });
  const requestId = request?.id;
  const orgId = request?.orgId;
  useEffect(() => {
    setOutcome({ kind: 'waiting' });
    if (!orgId) return;
    let active = true;
    const check = async () => {
      const [orgs, open] = await Promise.all([
        myOrganizations(),
        // Their own request, by organization: asking again keeps the first id.
        server.ownJoinRequest(orgId, actorId)
      ]);
      if (orgs.error) throw new Error(orgs.error.message);
      if (open.error) throw new Error(open.error.message);
      const memberOf = ((orgs.data ?? []) as { org_id: string }[]).map((o) => o.org_id);
      const next = requestOutcome(orgId, memberOf, (open.data ?? []).length > 0);
      if (!active) return;
      setOutcome(next);
      if (next.kind !== 'waiting') stop();
    };
    const load = () => { check().catch((e: unknown) => { noteExpected('join request outcome', e); }); };
    const app = AppState.addEventListener('change', (state) => { if (state === 'active') load(); });
    const timer = setInterval(load, 60_000);
    let stopped = false;
    function stop() {
      if (stopped) return;
      stopped = true;
      app.remove();
      clearInterval(timer);
    }
    load();
    return () => { active = false; stop(); };
  }, [actorId, requestId, orgId]);
  return outcome;
}
