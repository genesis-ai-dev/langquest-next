import { LinearError } from './linear';
import { issueOf, type Suggestion } from './tutorialFeedback';
import { accessToken, newComments, outOfQuota, YouTubeError, type Client, type Fetch, type VideoComment } from './youtube';
import type { Channel } from './tutorialPublisher';

/**
 * What the comments job does (server/tutorialComments.ts, decisions.md 186),
 * with the database and Linear given in so a test can play them: it reads
 * the comments left since its last run on each connected channel and keeps
 * them as written, for Claude's nightly look (tutorial-review.yml) to put
 * into English and answer with suggestions; and it files in Linear each
 * code change a person accepted on the ops dashboard that the app's Worker
 * could not file at the time (no key then, or Linear down). Replying and
 * moderating stay in YouTube Studio (184).
 *
 * A step that fails leaves its work for the next run.
 */

/** Most issues filed in Linear in a run. */
export const FILE_MAX = 20;
/** Comments are kept, and read, for this long (the migration's ops_comments_read takes out older ones). */
export const KEPT_DAYS = 365;

export interface CommentsDeps {
  fetcher: Fetch;
  client: Client;
  channels(): Promise<Channel[]>;
  refreshToken(channelId: string): Promise<string | null>;
  /** Which of these comments were read before. */
  known(ids: string[]): Promise<Set<string>>;
  /** Kept, with the channel's language; how many were new. */
  read(channel: Channel, comments: VideoComment[]): Promise<number>;
  /** Accepted code changes not yet in Linear, oldest first. */
  toFile(limit: number): Promise<Suggestion[]>;
  /** Linear, when the job has its key; without it accepted code changes wait, counted on the dashboard. */
  file: ((title: string, description: string) => Promise<{ identifier: string; url: string }>) | null;
  filed(id: string, identifier: string, url: string): Promise<void>;
  stopping(): boolean;
}

export interface CommentsReport {
  channels: number;
  read: number;
  filed: number;
  fileFailed: number;
  /** Accepted code changes waiting because the job has no Linear key. */
  unfiled: number;
  outOfQuota: boolean;
  firstError: string | null;
}

export const freshReport = (): CommentsReport => ({ channels: 0, read: 0, filed: 0, fileFailed: 0, unfiled: 0, outOfQuota: false, firstError: null });

/** A code that fits the job run's error class, from anything thrown. */
export const commentsCode = (e: unknown) =>
  e instanceof YouTubeError ? e.code
    : e instanceof LinearError ? `linear_${e.code}`
      : e instanceof Error ? e.name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 80) || 'Error' : 'unknown';

/** Linear refusing the key refuses every issue: the rest wait for the next run. */
export const linearRefused = (e: unknown) => e instanceof LinearError && /^(authentication|forbidden|401|403)/.test(e.code);

export async function tendComments(deps: CommentsDeps, report: CommentsReport, languageName: (code: string) => string): Promise<CommentsReport> {
  const fail = (e: unknown) => {
    report.firstError ??= commentsCode(e);
    report.outOfQuota ||= outOfQuota(e);
  };

  // 1. What came since the last run, on each channel.
  for (const channel of await deps.channels()) {
    if (deps.stopping() || report.outOfQuota) break;
    try {
      const refresh = await deps.refreshToken(channel.channelId);
      if (!refresh) throw new YouTubeError(401, 'not_connected');
      const token = await accessToken(deps.fetcher, deps.client, refresh);
      const since = new Date(Date.now() - KEPT_DAYS * 86_400_000).toISOString();
      const comments = await newComments(deps.fetcher, token, channel.channelId, deps.known, since);
      report.read += comments.length ? await deps.read(channel, comments) : 0;
      report.channels += 1;
    } catch (e) {
      fail(e);
    }
  }

  // 2. Accepted code changes the Worker could not file when they were accepted.
  if (deps.stopping()) return report;
  const toFile = await deps.toFile(FILE_MAX);
  if (!deps.file) {
    report.unfiled = toFile.length;
    return report;
  }
  for (const s of toFile) {
    if (deps.stopping()) break;
    try {
      const { title, description } = issueOf(s, languageName);
      const issue = await deps.file(title, description);
      await deps.filed(s.id, issue.identifier, issue.url);
      report.filed += 1;
    } catch (e) {
      report.fileFailed += 1;
      fail(e);
      if (linearRefused(e)) break;
    }
  }
  return report;
}
