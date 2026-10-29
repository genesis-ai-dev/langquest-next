/**
 * The tutorial videos a Publish on the ops dashboard chose, put up on YouTube
 * (docs/tutorial-videos.md, decisions.md 180): server/tutorialPublisher.ts
 * run by the job container, started by Publish and each day at 23:40 UTC
 * while chosen videos wait (apps/web/worker/jobsModel.ts; scripts/build-jobs.mjs
 * bundles this file). It reads each MP4 from the Worker (API_URL), each
 * channel's refresh token from Vault, and records a `tutorial_publish` job
 * run: `branded` and `brand_failed` (channels brought up to date first),
 * `held` (comments held for review, on all channels),
 * `due`, `published`, `replaced`, `failed` and `incomplete`, `channels_full`
 * (channels at their own day's limit), `partial` when any failed or
 * YouTube's day ran out, for the project or a channel. Each channel's banner is read from the
 * web app (API_URL) too. The log prints counts, never
 * titles or tokens.
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... API_URL=... YOUTUBE_CLIENT_ID=... YOUTUBE_CLIENT_SECRET=... npx tsx server/tutorialPublish.ts
 * Run by hand it leaves no job run.
 */
import { createClient } from '@supabase/supabase-js';
import { errorClassOf, jobRunSink, noJobRuns } from './jobRuns';
import { failureCode, publishTutorials, type Channel, type Due, type PublishReport } from './tutorialPublisher';
import { bannerPath } from './youtube';

const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
const apiUrl = process.env['API_URL'];
const clientId = process.env['YOUTUBE_CLIENT_ID'];
const clientSecret = process.env['YOUTUBE_CLIENT_SECRET'];
if (!key || !apiUrl || !clientId || !clientSecret) {
  console.error('SUPABASE_SERVICE_ROLE_KEY, API_URL, YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET are required');
  process.exit(1);
}
const record = process.env['LANGQUEST_JOB'] === 'tutorial-publish' ? jobRunSink(url, key) : noJobRuns;
const service = createClient(url, key, { auth: { persistSession: false } });

const started = Date.now();
let stopping = false;
process.once('SIGTERM', () => {
  stopping = true;
  console.error('SIGTERM: finishing the upload in hand');
});
// Counted as it goes, so a run cut short still reports what it did.
const report: PublishReport = { branded: 0, brandFailed: 0, held: 0, due: 0, published: 0, replaced: 0, failed: 0, incomplete: 0, outOfQuota: false, channelsFull: 0, firstError: null };

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await service.rpc(name, args);
  if (error) throw Object.assign(new Error(`${name}: ${error.message}`), { code: error.code });
  return data as T;
}

let error: unknown;
try {
  await publishTutorials({
    fetcher: (input, init) => fetch(input, init),
    client: { clientId, clientSecret },
    due: (limit) => rpc<Due[]>('ops_tutorials_due', { p_limit: limit }),
    channels: () => rpc<Channel[]>('ops_youtube_channels', {}),
    banner: async (language) => {
      const response = await fetch(`${apiUrl.replace(/\/+$/, '')}${bannerPath(language)}`);
      if (!response.ok) throw Object.assign(new Error('banner'), { name: `banner_${response.status}` });
      return new Uint8Array(await response.arrayBuffer());
    },
    branded: (channel, brand, failed) => rpc<void>('ops_youtube_branded', { p_channel: channel.channelId, p_branded: brand, p_failed: failed }),
    held: (channel, count) => rpc<void>('ops_youtube_held', { p_channel: channel.channelId, p_count: count }),
    refreshToken: (channelId) => rpc<string | null>('ops_youtube_refresh', { p_channel: channelId }),
    file: async (video) => {
      const response = await fetch(`${apiUrl.replace(/\/+$/, '')}/api/tutorials/${video.language}/${video.tutorial}/${video.sha256}.mp4`);
      if (!response.ok || !response.body) throw Object.assign(new Error('tutorial_file'), { name: `tutorial_file_${response.status}` });
      return { body: response.body, bytes: Number(response.headers.get('content-length') ?? video.bytes) };
    },
    published: (video, youtubeId, failed) => rpc<void>('ops_tutorial_published', {
      p_tutorial: video.tutorial, p_language: video.language, p_sha256: video.sha256, p_youtube_id: youtubeId, p_failed: failed
    }),
    stopping: () => stopping
  }, report);
} catch (e) {
  error = e;
}
const errorClass = error !== undefined ? errorClassOf(error) : report.firstError ?? (stopping ? 'sigterm' : null);
await record({
  job: 'tutorial_publish', startedAt: started, ms: Date.now() - started,
  outcome: error !== undefined && report.published === 0 ? 'error' : error !== undefined || stopping || report.failed > 0 || report.incomplete > 0 || report.brandFailed > 0 || report.outOfQuota || report.channelsFull > 0 ? 'partial' : 'ok',
  n: { branded: report.branded, brand_failed: report.brandFailed, held: report.held, due: report.due, published: report.published, replaced: report.replaced, failed: report.failed, incomplete: report.incomplete, out_of_quota: report.outOfQuota ? 1 : 0, channels_full: report.channelsFull },
  ...(errorClass ? { errorClass } : {})
});
console.log(`channels: ${report.branded} brought up to date, ${report.brandFailed} failed, ${report.held} comments held for review`);
console.log(`publish: ${report.published} of ${report.due} up (${report.replaced} replacing), ${report.failed} failed, ${report.incomplete} incomplete${report.outOfQuota ? ', out of YouTube\'s day' : ''}${report.channelsFull ? `, ${report.channelsFull} channels at their day's limit` : ''}, ${Math.round((Date.now() - started) / 1000)} s`);
if (error !== undefined) {
  console.error(`failed: ${failureCode(error)}`);
  process.exit(1);
}
if (stopping) process.exit(75);
