import { supabase } from './supabase';

/** Verse-timing jobs for an organization's sources. */
export function timingJobs(orgId: string) {
  return supabase.rpc('timing_jobs_for', { p_org: orgId });
}

/** Ask for verse timings for some books of one source's audio; asking again returns the open job. */
export function requestTimings(orgId: string, c: {
  itemId: string; bibleId: string; audioFileset: string; textFileset: string | null; books: string[]; versification: string;
  publishTo?: { org: string; item: string };
}) {
  return supabase.rpc('request_timings', {
    p_org: orgId, p_item: c.itemId, p_bible_id: c.bibleId, p_audio_fileset: c.audioFileset, p_text_fileset: c.textFileset,
    p_books: c.books, p_versification: c.versification,
    ...(c.publishTo ? { p_publish_org: c.publishTo.org, p_publish_item: c.publishTo.item } : {})
  });
}

export function timingJobResults(orgId: string, jobId: string) {
  return supabase.rpc('timing_job_results', { p_org: orgId, p_job: jobId });
}
