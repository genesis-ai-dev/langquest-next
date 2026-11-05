import { canonicalJson, timingPublication, type LibraryDoc, type SourceDoc, type TimingResultRow } from '@langquest-next/core';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Verse timings for LangQuest's own sources (docs/reference-material.md,
 * "Timing jobs"). An organization following one of them may ask for the
 * timings it lacks; when fia-align's worker finishes such a job, this
 * publishes the passing chapters as the LangQuest item's next version, the
 * way an admin's app does for an organization's own source, so everyone
 * following it gets them. Runs on the Worker's schedule; safe to run again
 * (documents are named by their content, event ids by the job).
 */
export async function publishLangQuestTimings(sb: SupabaseClient): Promise<{ jobs: number; published: number }> {
  const { data: jobs, error } = await sb.rpc('timing_jobs_to_publish');
  if (error) throw new Error(`timing_jobs_to_publish: ${error.message}`);
  let published = 0;
  for (const job of (jobs ?? []) as { id: string; publish_org: string; publish_item: string }[]) {
    if (await publishJob(sb, job)) published++;
    const { error: e } = await sb.rpc('timing_job_published', { p_job: job.id });
    if (e) throw new Error(`timing_job_published: ${e.message}`);
  }
  return { jobs: (jobs ?? []).length, published };
}

async function docsOf(sb: SupabaseClient, org: string, item: string): Promise<{ current: string | null; docs: Map<string, LibraryDoc> }> {
  const { data, error } = await sb.rpc('library_docs_for_publisher', { p_org: org, p_item: item });
  if (error) throw new Error(`library_docs_for_publisher: ${error.message}`);
  const docs = new Map<string, LibraryDoc>();
  let current: string | null = null;
  for (const r of (data ?? []) as { hash: string; body: string; is_current: boolean }[]) {
    docs.set(r.hash, JSON.parse(r.body) as LibraryDoc);
    if (r.is_current) current = r.hash;
  }
  return { current, docs };
}

async function hashOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function publishJob(sb: SupabaseClient, job: { id: string; publish_org: string; publish_item: string }): Promise<boolean> {
  if (job.publish_org !== 'langquest') return false;
  const { current, docs } = await docsOf(sb, job.publish_org, job.publish_item);
  const source = current ? docs.get(current) : undefined;
  if (!current || source?.format !== 'source@1') return false;
  const { data: rows, error } = await sb.rpc('timing_job_results_for_publisher', { p_job: job.id });
  if (error) throw new Error(`timing_job_results_for_publisher: ${error.message}`);
  const codes = [...new Set(((rows ?? []) as TimingResultRow[]).map((r) => (r.body as { versification?: unknown })?.versification).filter((c): c is string => typeof c === 'string'))];
  const versifications: { code: string; hash: string }[] = [];
  for (const code of codes) {
    const v = await docsOf(sb, job.publish_org, `langquest.versification.${code}`);
    if (v.current) versifications.push({ code, hash: v.current });
  }
  // The source's own numbering first, whatever its code.
  const own = docs.get((source as SourceDoc).versification);
  if (own?.format === 'versification@1') versifications.unshift({ code: own.code, hash: (source as SourceDoc).versification });
  const pub = await timingPublication({
    source: source as SourceDoc, sourceHash: current, rows: (rows ?? []) as TimingResultRow[],
    get: (h) => (h ? docs.get(h) ?? null : null), versifications
  }, hashOf);
  if (!pub.source) return false;
  for (const d of pub.docs) {
    const text = d.text ?? canonicalJson(d.doc);
    const { data: stored, error: e } = await sb.rpc('library_seed_document', { p_org: job.publish_org, p_body: text });
    if (e) throw new Error(`library_seed_document: ${e.message}`);
    if (stored !== d.hash) throw new Error(`stored ${String(stored)} for ${d.hash}`);
  }
  const { error: e } = await sb.rpc('library_seed_events', { p_org: job.publish_org, p_events: [{
    id: `timings:${job.id}:${pub.source.hash.slice(0, 12)}`, type: 'v1.LibraryVersionPublished',
    payload: { itemId: job.publish_item, kind: 'material', docHash: pub.source.hash, note: `Verse timings for ${pub.placed.length} chapter${pub.placed.length === 1 ? '' : 's'}` }
  }] });
  if (e) throw new Error(`library_seed_events: ${e.message}`);
  return true;
}
