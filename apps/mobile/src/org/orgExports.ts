// The organization export's calls to the Worker (apps/web/worker/orgExports.ts, decisions.md 205): ask, look,
// and get a link to the zip. The Worker checks that the person is the organization's admin; nothing here does.
import { Platform } from 'react-native';
import { reportsServer } from '../reports/reportsServer';
import type { ExportItem } from './exportModel';

/** The export is a web feature first: a browser saves the zip; a phone has no Worker to ask. */
export const canExport = Platform.OS === 'web' && reportsServer !== null;

async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
  if (!reportsServer) throw new Error('no server');
  const token = await reportsServer.token();
  if (!token) throw new Error('signed out');
  return (reportsServer.fetch ?? fetch)(`${reportsServer.baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

export async function listExports(orgId: string): Promise<ExportItem[]> {
  const res = await call('GET', `/api/orgs/${encodeURIComponent(orgId)}/exports`);
  if (!res.ok) throw new Error(`exports ${res.status}`);
  return ((await res.json()) as { exports: ExportItem[] }).exports;
}

/** Ask for an export; `languageIds` null is every language. A request already being made is not an error: the list shows it. */
export async function startExport(orgId: string, languageIds: string[] | null): Promise<void> {
  const res = await call('POST', `/api/orgs/${encodeURIComponent(orgId)}/exports`, languageIds ? { languageIds } : {});
  if (!res.ok && res.status !== 409) throw new Error(`exports ${res.status}`);
}

/** The address that downloads the zip, good for an hour. */
export async function exportLink(orgId: string, id: string): Promise<string> {
  const res = await call('GET', `/api/orgs/${encodeURIComponent(orgId)}/exports/${id}/link`);
  if (!res.ok) throw new Error(`export link ${res.status}`);
  return `${reportsServer!.baseUrl}${((await res.json()) as { path: string }).path}`;
}
