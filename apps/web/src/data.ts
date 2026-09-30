import { MemoryStore, OfflineError, SupabaseTransport, SyncClient } from '@langquest-next/client';
import type { EventPayloads, Privilege } from '@langquest-next/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import type { LaneRow, Organization, OrgReportsResponse } from './types';

/** A read failed in a way the person should hear about in words, not a stack. */
export class LoadError extends Error {
  override name = 'LoadError';
  constructor(message: string, readonly offline = false) {
    super(message);
  }
}

function fail(what: string, error: { message: string } | null | undefined): never {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    throw new LoadError(`No connection. ${what} will load when you are back online.`, true);
  }
  throw new LoadError(`Could not load ${what.toLowerCase()}: ${error?.message ?? 'unknown error'}.`);
}

/** Organizations this person belongs to, by name. */
export async function fetchOrganizations(): Promise<Organization[]> {
  const { data, error } = await supabase.rpc('my_organizations');
  if (error) fail('Your organizations', error);
  const byId = new Map<string, Organization>();
  for (const row of (data ?? []) as { org_id: string; name: string | null }[]) {
    if (!byId.has(row.org_id)) byId.set(row.org_id, { orgId: row.org_id, name: row.name ?? row.org_id });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export interface OrgReports {
  rows: LaneRow[];
  /** When the dashboard's server last caught up with the log, ISO. */
  asOf: string;
}

/**
 * Every language report this person may read in one organization, from the
 * dashboard's own server (decision 44), which answers with only those rows.
 * `fresh` makes it catch up first rather than answer from the last minute.
 */
export async function fetchOrgReports(orgId: string, fresh = false): Promise<OrgReports> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new LoadError('Your session has ended. Sign in again.');
  let res: Response;
  try {
    res = await fetch(`/api/orgs/${encodeURIComponent(orgId)}/reports${fresh ? '?fresh=1' : ''}`, { headers: { authorization: `Bearer ${token}` } });
  } catch (e) {
    fail('Reports', e instanceof Error ? e : null);
  }
  const body = await res.json().catch(() => null) as (OrgReportsResponse & { error?: string }) | null;
  if (!res.ok || !body?.rows) fail('Reports', { message: body?.error ?? `the server answered ${res.status}` });
  return {
    asOf: body.asOf,
    rows: body.rows.map((r) => ({ orgId, projectId: r.projectId, laneId: r.laneId, updatedAt: body.asOf, report: r.report }))
  };
}

/** This person's privileges over a partition (optionally one language), to decide which edits to offer. */
export async function fetchPrivileges(orgId: string, projectId: string, laneId?: string): Promise<Set<Privilege>> {
  const { data, error } = await supabase.rpc('my_privileges', { p_org: orgId, p_project: projectId, p_lane: laneId ?? null });
  if (error) fail('Your permissions', error);
  return new Set((data ?? []) as Privilege[]);
}

function deviceId(): string {
  const key = 'lq-web-device';
  let id = localStorage.getItem(key);
  if (!id) {
    id = `web-${crypto.randomUUID()}`;
    localStorage.setItem(key, id);
  }
  return id;
}

type LaneEventType = 'v1.LaneCountrySet' | 'v1.LaneTargetSet';

/**
 * Append one language setting and wait for the server's answer. The web
 * app keeps no outbox (it has no offline use), so it never says "saved"
 * before the server accepted: offline or refused, the form keeps its
 * values and says why.
 */
export async function saveLaneSetting<T extends LaneEventType>(
  c: { orgId: string; projectId: string; actorId: string }, type: T, payload: EventPayloads[T]
): Promise<void> {
  const client = new SyncClient({
    orgId: c.orgId, projectId: c.projectId, actorId: c.actorId, deviceId: deviceId(),
    store: new MemoryStore(), transport: new SupabaseTransport(supabase)
  });
  await client.load();
  await client.append(type, payload);
  try {
    // A clock-ahead refusal re-stamps and leaves the event queued; one more push sends it.
    for (let i = 0; i < 3 && (await client.pendingCount()) > 0; i++) await client.push();
  } catch (e) {
    if (e instanceof OfflineError) throw new LoadError('No connection. Nothing was saved; try again when you are back online.', true);
    throw new LoadError(`Not saved: ${e instanceof Error ? e.message : 'the server did not answer'}.`);
  }
  const refused = (await client.inspect()).rejected[0];
  if (refused) throw new LoadError(`Not saved: the server refused it (${refused.rejectReason ?? 'no reason given'}).`);
  if ((await client.pendingCount()) > 0) throw new LoadError('Not saved: the server did not confirm it. Try again.');
}

export type Loaded<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: LoadError };

/**
 * Load once per key; `reload` asks again. Stale answers from an earlier key
 * are dropped. A reload of the same key keeps showing what it has until the
 * new answer comes, so a page does not blank while it refreshes.
 */
export function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> & { reload: () => void } {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const loadedKey = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    const sameKey = loadedKey.current === key;
    loadedKey.current = key;
    setState((s) => (sameKey && s.status === 'ready' ? s : { status: 'loading' }));
    load().then(
      (data) => { if (active) setState({ status: 'ready', data }); },
      (e: unknown) => {
        if (!active) return;
        setState({ status: 'error', error: e instanceof LoadError ? e : new LoadError(e instanceof Error ? e.message : 'Something went wrong.') });
      }
    );
    return () => { active = false; };
    // `load` is a fresh closure every render; `key` names what it loads.
  }, [key, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload };
}
