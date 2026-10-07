/**
 * Reporting and blocking (decisions.md 48), the parts with no I/O: what can
 * be reported, the reasons, how a block list is worked out from the server's
 * copy and the changes still waiting to send, and how an organization's
 * open reports read to whoever acts on them. Google Play's user-generated
 * content policy asks for both; the partner demo has neither, so the sheet
 * that offers them is app-only (`reportSheet.tsx`).
 */
import type { AccountAction } from './durableOutbox';

export type ReportKind = 'version' | 'review' | 'note' | 'request' | 'person';

/** One thing someone can report: a piece of the record, or a person. */
export interface ReportTarget {
  kind: ReportKind;
  /** takeId, reviewId, noteId, requestId, or the person's profile id. */
  id: string;
  /** Who made it; for a person, themselves. */
  profileId: string;
  orgId: string;
  /** The language whose record holds it; absent for a person, who belongs to the organization. */
  languageId?: string;
  unitId?: string;
}

export const REPORT_REASONS = [
  { id: 'offensive', label: 'Hateful or offensive', sub: 'Insults or attacks on a people, faith or group' },
  { id: 'harassment', label: 'Harassment or bullying', sub: 'Aimed at you or someone else' },
  { id: 'sexual', label: 'Sexual content', sub: 'Including anything involving a child' },
  { id: 'violence', label: 'Violence or threats', sub: 'Threatens or encourages harm' },
  { id: 'spam', label: 'Spam or unrelated', sub: 'Not part of the translation work' },
  { id: 'other', label: 'Something else', sub: 'Say what in the box below' }
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number]['id'];

export function reasonLabel(id: string): string {
  return REPORT_REASONS.find((r) => r.id === id)?.label ?? 'Something else';
}

/** "this version", "this note" — what the sheet offers to report. */
export function thingLabel(kind: Exclude<ReportKind, 'person'>): string {
  return { version: 'this version', review: 'this review', note: 'this note', request: 'this request' }[kind];
}

/** The person a target's report is about, as a target of its own. */
export function personTarget(t: ReportTarget): ReportTarget {
  return { kind: 'person', id: t.profileId, profileId: t.profileId, orgId: t.orgId };
}

/** What the outbox sends to `report_content`. */
export function reportPayload(t: ReportTarget, reason: ReportReason, details: string): Record<string, unknown> {
  const trimmed = details.trim().slice(0, 1000);
  return {
    orgId: t.orgId, languageId: t.languageId ?? null, kind: t.kind, targetId: t.id, profileId: t.profileId, reason,
    ...(trimmed ? { details: trimmed } : {}),
    ...(t.unitId ? { unitId: t.unitId } : {})
  };
}

/**
 * Who this account has blocked: the server's list, then every block or
 * unblock not yet acknowledged, in the order they were made. A change
 * the server refused for good is left out, so the phone agrees with it.
 */
export function blockedIds(server: readonly string[], actions: readonly AccountAction[]): string[] {
  const out = new Set(server);
  for (const a of actions) {
    if (a.kind !== 'block' || a.status === 'failed') continue;
    const id = String(a.payload.profileId);
    if (a.payload.blocked) out.add(id); else out.delete(id);
  }
  return [...out].sort();
}

/** One row of `org_content_reports`. Never who reported it. `language_id` is null for a person. */
export interface OpenReport {
  id: string;
  language_id: string | null;
  target_kind: ReportKind;
  target_id: string;
  unit_id: string | null;
  reported_profile: string;
  reason: string;
  details: string | null;
  created_at: string;
}

/** Every open report about one thing or one person, for a moderator to act on once. */
export interface ReportGroup {
  key: string;
  target: ReportTarget;
  /** Reason ids, most reported first. */
  reasons: string[];
  count: number;
  /** What reporters wrote, newest first, without who wrote it. */
  details: string[];
  latest: string;
}

export function groupReports(orgId: string, rows: readonly OpenReport[]): ReportGroup[] {
  const groups = new Map<string, { target: ReportTarget; reasons: Map<string, number>; details: { at: string; text: string }[]; count: number; latest: string }>();
  for (const r of rows) {
    const key = JSON.stringify([r.language_id, r.target_kind, r.target_id]);
    let g = groups.get(key);
    if (!g) {
      g = {
        target: {
          kind: r.target_kind, id: r.target_id, profileId: r.reported_profile, orgId,
          ...(r.language_id ? { languageId: r.language_id } : {}), ...(r.unit_id ? { unitId: r.unit_id } : {})
        },
        reasons: new Map(), details: [], count: 0, latest: r.created_at
      };
      groups.set(key, g);
    }
    g.count += 1;
    g.reasons.set(r.reason, (g.reasons.get(r.reason) ?? 0) + 1);
    if (r.details) g.details.push({ at: r.created_at, text: r.details });
    if (r.created_at > g.latest) g.latest = r.created_at;
    // The first report may not have said where it was; a later one may.
    if (!g.target.unitId && r.unit_id) g.target.unitId = r.unit_id;
  }
  return [...groups.entries()]
    .map(([key, g]) => ({
      key, target: g.target, count: g.count, latest: g.latest,
      reasons: [...g.reasons.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id),
      details: g.details.sort((a, b) => (a.at < b.at ? 1 : -1)).map((d) => d.text)
    }))
    .sort((a, b) => (a.latest < b.latest ? 1 : -1));
}

/** "A note was reported", "Teal Diamond was reported". */
export function reportTitle(t: ReportTarget, name: (id: string) => string): string {
  if (t.kind === 'person') return `${name(t.profileId)} was reported`;
  return `${{ version: 'A version', review: 'A review', note: 'A note', request: 'A request' }[t.kind]} was reported`;
}

/** "Hateful or offensive · 2 reports". */
export function reportSummary(g: ReportGroup): string {
  const reasons = g.reasons.map(reasonLabel).join(', ');
  return g.count > 1 ? `${reasons} · ${g.count} reports` : reasons;
}

/** What stands in for words, audio or photos from someone this person blocked. */
export const HIDDEN_TEXT = 'Hidden because you blocked them';
