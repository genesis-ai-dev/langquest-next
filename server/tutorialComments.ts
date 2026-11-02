/**
 * The comments on the tutorial videos, kept for Claude's nightly look
 * (docs/tutorial-videos.md "Feedback", decisions.md 186):
 * server/tutorialCommentsModel.ts run by the job container each day at 23:50
 * UTC, after the publish job (apps/web/worker/jobsModel.ts;
 * scripts/build-jobs.mjs bundles this file). It reads each channel's refresh
 * token from Vault, keeps each new comment as written, files in Linear the
 * accepted code changes still waiting when it has LINEAR_API_KEY, and
 * records a `tutorial_comments` job run: `channels`, `read`, `filed`,
 * `file_failed` and `unfiled`, `partial` when any failed. The log prints
 * counts, never a comment.
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... YOUTUBE_CLIENT_ID=... YOUTUBE_CLIENT_SECRET=... [LINEAR_API_KEY=...] npx tsx server/tutorialComments.ts
 * Run by hand it leaves no job run.
 */
import { createClient } from '@supabase/supabase-js';
import { UI_LANGUAGES } from '@langquest-next/core';
import { errorClassOf, jobRunSink, noJobRuns } from './jobRuns';
import { linearIssues } from './linear';
import { commentsCode, freshReport, tendComments } from './tutorialCommentsModel';
import type { Suggestion } from './tutorialFeedback';
import type { Channel } from './tutorialPublisher';

const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const clientId = process.env['YOUTUBE_CLIENT_ID'];
const clientSecret = process.env['YOUTUBE_CLIENT_SECRET'];
const linear = process.env['LINEAR_API_KEY'];
if (!key || !clientId || !clientSecret) {
  console.error('SUPABASE_SERVICE_ROLE_KEY, YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are required');
  process.exit(1);
}
const record = process.env['LANGQUEST_JOB'] === 'tutorial-comments' ? jobRunSink(url, key) : noJobRuns;
const service = createClient(url, key, { auth: { persistSession: false } });

const started = Date.now();
let stopping = false;
process.once('SIGTERM', () => {
  stopping = true;
  console.error('SIGTERM: finishing the channel in hand');
});
// Counted as it goes, so a run cut short still reports what it did.
const report = freshReport();

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await service.rpc(name, args);
  if (error) throw Object.assign(new Error(`${name}: ${error.message}`), { code: error.code });
  return data as T;
}

const fetcher = (input: string, init?: RequestInit) => fetch(input, init);
const issues = linear ? linearIssues(fetcher, linear) : null;
const languageName = (code: string) => UI_LANGUAGES.find((l) => l.code === code)?.english ?? code;

let error: unknown;
try {
  await tendComments({
    fetcher,
    client: { clientId, clientSecret },
    channels: () => rpc<Channel[]>('ops_youtube_channels', {}),
    refreshToken: (channelId) => rpc<string | null>('ops_youtube_refresh', { p_channel: channelId }),
    known: async (ids) => new Set(ids.length ? await rpc<string[]>('ops_comments_known', { p_ids: ids }) : []),
    read: (channel, comments) => rpc<number>('ops_comments_read', { p_language: channel.language, p_channel: channel.channelId, p_comments: comments }),
    toFile: (limit) => rpc<Suggestion[]>('ops_suggestions_to_file', { p_limit: limit }),
    file: issues ? (title, description) => issues.create(title, description) : null,
    filed: (id, identifier, issueUrl) => rpc<void>('ops_suggestion_filed', { p_id: id, p_issue: identifier, p_url: issueUrl }),
    stopping: () => stopping
  }, report, languageName);
} catch (e) {
  error = e;
}
const errorClass = error !== undefined ? errorClassOf(error) : report.firstError ?? (stopping ? 'sigterm' : null);
await record({
  job: 'tutorial_comments', startedAt: started, ms: Date.now() - started,
  outcome: error !== undefined && report.read + report.filed === 0 ? 'error'
    : error !== undefined || stopping || report.firstError !== null ? 'partial' : 'ok',
  n: { channels: report.channels, read: report.read, filed: report.filed, file_failed: report.fileFailed, unfiled: report.unfiled },
  ...(errorClass ? { errorClass } : {})
});
console.log(`comments: ${report.read} new on ${report.channels} channels, ${report.filed} code changes filed in Linear (${report.fileFailed} failed${linear ? '' : `, ${report.unfiled} waiting for LINEAR_API_KEY`}), ${Math.round((Date.now() - started) / 1000)} s`);
if (error !== undefined) {
  console.error(`failed: ${commentsCode(error)}`);
  process.exit(1);
}
if (stopping) process.exit(75);
