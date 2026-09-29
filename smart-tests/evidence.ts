// Evidence for the oracles, read independently of whatever the UI shows.
import type { Page } from '@playwright/test';
import type { DeviceRow, ServerRow } from './outcome';

/** The device's own event log (dev web builds expose a read-only probe; see apps/mobile/src/store.ts). */
export async function deviceLog(page: Page, orgId: string, projectId: string): Promise<DeviceRow[]> {
  const rows = await page.evaluate(async ([org, project]) => {
    const log = (globalThis as { __langquestLog?: { select(sql: string, p?: unknown[]): Promise<unknown[]> } }).__langquestLog;
    if (!log) throw new Error('No __langquestLog: not a dev web build, or the store never opened.');
    return log.select('select status, reject_reason, json from events where org_id = ? and project_id = ? order by hlc', [org, project]);
  }, [orgId, projectId] as const) as { status: DeviceRow['status']; reject_reason: string | null; json: string }[];
  return rows.map((r) => ({ status: r.status, rejectReason: r.reject_reason, event: JSON.parse(r.json) }));
}

/** Hashes with a trusted (non-staging) file in the device blob store. */
export async function deviceBlobs(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    let dir: FileSystemDirectoryHandle;
    try { dir = await root.getDirectoryHandle('blobs'); } catch { return []; }
    const out: string[] = [];
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) {
      if (!name.endsWith('.part')) out.push(name.split('.')[0]!);
    }
    return out;
  });
}

/** Server events for a project, read with the service role (never from the page). */
export async function serverEvents(projectId: string): Promise<ServerRow[]> {
  const url = process.env['EXPO_PUBLIC_SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set (smart-tests/run.sh reads it from supabase status).');
  const res = await fetch(`${url}/rest/v1/events?project_id=eq.${encodeURIComponent(projectId)}&select=id,type,actor_id,payload`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`server events: ${res.status} ${await res.text()}`);
  const rows = await res.json() as ServerRow[];
  // A reader that cannot see the seed would turn every run into a false product failure.
  if (!rows.some((r) => r.type === 'v1.ProjectCreated')) {
    throw new Error('The server reader cannot see this project (wrong SUPABASE_SERVICE_ROLE_KEY?). Not judging the product.');
  }
  return rows;
}

/** Poll `read` until `done` holds or the deadline passes; returns the last reading either way. */
export async function settle<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!done(value) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    value = await read();
  }
  return value;
}

/** The device-local Recent list My Work reads (apps/mobile/src/recent.ts; AsyncStorage is localStorage on web). */
export async function deviceRecent(page: Page, orgId: string, projectId: string, actorId: string): Promise<{ unitId: string; laneId: string }[]> {
  const raw = await page.evaluate((key) => localStorage.getItem(key), `recent:${orgId}:${projectId}:${actorId}`);
  return raw ? JSON.parse(raw) as { unitId: string; laneId: string }[] : [];
}
