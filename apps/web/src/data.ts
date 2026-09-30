import { MemoryStore, OfflineError, SupabaseTransport, SyncClient } from '@langquest-next/client';
import { REPORT_VERSION, type EventPayloads, type LaneReport, type Privilege } from '@langquest-next/core';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { LaneDay, LaneRow, Organization } from './types';

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
  /** Rows the server has not yet refolded at this app's report version. */
  pending: number;
}

/** Every language report this person may read in one organization. */
export async function fetchOrgReports(orgId: string): Promise<OrgReports> {
  const { data, error } = await supabase.from('lane_reports')
    .select('org_id,project_id,lane_id,report_version,updated_at,report')
    .eq('org_id', orgId);
  if (error) fail('Reports', error);
  const rows: LaneRow[] = [];
  let pending = 0;
  for (const r of (data ?? []) as { org_id: string; project_id: string; lane_id: string; report_version: number; updated_at: string; report: LaneReport }[]) {
    if (r.report_version !== REPORT_VERSION) { pending += 1; continue; }
    rows.push({ orgId: r.org_id, projectId: r.project_id, laneId: r.lane_id, updatedAt: r.updated_at, report: r.report });
  }
  return { rows, pending };
}

/** A language's daily points, oldest first, for the last year. */
export async function fetchLaneDays(orgId: string, projectId: string, laneId: string, now = Date.now()): Promise<LaneDay[]> {
  const since = new Date(now - 366 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase.from('lane_report_days')
    .select('day,total,recorded,done')
    .eq('org_id', orgId).eq('project_id', projectId).eq('lane_id', laneId)
    .gte('day', since)
    .order('day', { ascending: true });
  if (error) fail('Progress over time', error);
  return (data ?? []) as LaneDay[];
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

/** Load once per key; `reload` asks again. Stale answers from an earlier key are dropped. */
export function useLoad<T>(load: () => Promise<T>, key: string): Loaded<T> & { reload: () => void } {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
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
