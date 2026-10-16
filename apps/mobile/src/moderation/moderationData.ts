import { accountOutbox, queueAccountAction } from '../account/accountData';
import { reportPayload, type OpenReport, type ReportReason, type ReportTarget } from './model';
import * as server from '../server/moderation';
export { useBlocks, useOpenReportCount } from './useModeration';

// Reports and blocks reach the server through the account outbox, so they
// are saved offline and sent when connected, like a profile name. Acting on
// a report needs the server, and says so (decisions.md 48).

export interface Blocks {
  ids: string[];
  has: (profileId: string) => boolean;
  /** Takes effect on this phone at once, and is sent when connected. */
  set: (profileId: string, blocked: boolean) => Promise<void>;
}

/** Save a report to send; the reporter's name never reaches the organization. */
export function queueReport(actorId: string, target: ReportTarget, reason: ReportReason, details: string): Promise<string> {
  return queueAccountAction(actorId, 'report', reportPayload(target, reason, details));
}

/**
 * Save a report and try to send it now, waiting at most `waitMs`: true
 * when the server has it, so the toast can say so; otherwise it stays saved
 * and goes when connected (MOD-004, MOD-013).
 */
export async function sendReport(actorId: string, target: ReportTarget, reason: ReportReason, details: string, waitMs = 4000): Promise<boolean> {
  const id = await queueReport(actorId, target, reason, details);
  const outbox = accountOutbox(actorId);
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    outbox.flush().catch(() => false),
    new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs); })
  ]);
  clearTimeout(timer);
  return (await outbox.list()).find((a) => a.id === id)?.status === 'sent';
}

/** Open reports this person may act on, in this organization. Needs the server. */
export async function openReports(orgId: string): Promise<OpenReport[]> {
  const { data, error } = await server.orgContentReports(orgId);
  if (error) throw new Error(error.message);
  return (data ?? []) as OpenReport[];
}

export const reportListeners = new Set<() => void>();
/** A moderator acted on a report: counts read it again. */
export function reportsChanged(): void {
  for (const listener of reportListeners) listener();
}

/** Take something out of the record for everyone (`v1.Redacted`, appended by the server as the caller). */
export async function removeContent(t: ReportTarget, reason: string): Promise<number> {
  const { data, error } = await server.removeContent(t, reason);
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** Looked at it and leaving it: closes every open report about it. */
export async function dismissReports(t: ReportTarget): Promise<void> {
  const { error } = await server.dismissReports(t);
  if (error) throw new Error(error.message);
}
