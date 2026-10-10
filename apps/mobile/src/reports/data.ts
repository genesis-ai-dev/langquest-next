import { fetchOrgReports, ReportsError } from '@langquest-next/client';
import type { LanguageRow } from '@langquest-next/core';
import { useEffect, useSyncExternalStore } from 'react';
import { t } from '../i18n';
import { reportsServer } from '../useOrgSummary';

/**
 * An organization's reports for the Reports section (decision 44): every
 * language this person may see, from the dashboard's server, loaded once and
 * shared by the section and a language's page. Held in memory only: these
 * are read online, and a reopened section asks again with its ETag.
 */
type Loaded =
  | { status: 'loading' }
  | { status: 'ready'; rows: LanguageRow[]; asOf: string; refreshing: boolean }
  | { status: 'error'; message: string; offline: boolean };

interface Entry {
  state: Loaded;
  etag: string | null;
  listeners: Set<() => void>;
  inflight: Promise<void> | null;
}

const entries = new Map<string, Entry>();

function entry(orgId: string): Entry {
  let e = entries.get(orgId);
  if (!e) {
    e = { state: { status: 'loading' }, etag: null, listeners: new Set(), inflight: null };
    entries.set(orgId, e);
  }
  return e;
}

function set(e: Entry, state: Loaded) {
  e.state = state;
  for (const l of e.listeners) l();
}

/** Ask the server; `fresh` makes it catch up first (after a setting was saved). */
function loadReports(orgId: string, fresh = false): Promise<void> {
  const e = entry(orgId);
  if (e.inflight && !fresh) return e.inflight;
  if (!reportsServer) {
    set(e, { status: 'error', message: t('reports.errors.noServer'), offline: false });
    return Promise.resolve();
  }
  if (e.state.status === 'ready') set(e, { ...e.state, refreshing: true });
  const run = (async () => {
    try {
      const answer = await fetchOrgReports(reportsServer!, orgId, { fresh, etag: e.state.status === 'ready' ? e.etag : null });
      if (answer.status === 'changed') {
        e.etag = answer.etag;
        const { rows, asOf } = answer.body;
        set(e, { status: 'ready', asOf, refreshing: false, rows: rows.map((r) => ({ orgId, languageId: r.languageId, updatedAt: asOf, report: r.report })) });
      } else if (e.state.status === 'ready') {
        const asOf = answer.asOf;
        set(e, { ...e.state, asOf, refreshing: false, rows: e.state.rows.map((r) => ({ ...r, updatedAt: asOf })) });
      }
    } catch (err) {
      const offline = err instanceof ReportsError && err.offline;
      const message = offline ? t('reports.errors.offline') : failureText(err);
      // Keep what is showing; only a first load turns into an error.
      if (e.state.status === 'ready') set(e, { ...e.state, refreshing: false });
      else set(e, { status: 'error', message, offline });
    } finally {
      e.inflight = null;
    }
  })();
  e.inflight = run;
  return run;
}

/** Why the server's answer could not be read, by its status (its own message is English). */
function failureText(err: unknown): string {
  if (!(err instanceof ReportsError) || err.status === null) return t('reports.errors.couldNotRead');
  switch (err.status) {
    case 401: return t('reports.errors.signIn');
    case 403: return t('reports.errors.notMember');
    case 502: return t('reports.errors.busy');
    default: return t('reports.errors.serverAnswered', { status: err.status });
  }
}

/** The organization's reports, loading them on first use. */
export function useReports(orgId: string): Loaded & { reload: () => void; refresh: () => void } {
  const e = entry(orgId);
  const state = useSyncExternalStore(
    (l) => { e.listeners.add(l); return () => e.listeners.delete(l); },
    () => e.state
  );
  useEffect(() => { void loadReports(orgId); }, [orgId]);
  return { ...state, reload: () => void loadReports(orgId), refresh: () => void loadReports(orgId, true) };
}
