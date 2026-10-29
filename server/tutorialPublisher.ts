import {
  accessToken, brandChannel, brandOf, heldComments, outOfQuota, placeInPlaylist, playlistFor, retire, uploadVideo, YouTubeError,
  type ChannelLanguage, type Client, type Fetch
} from './youtube';

/**
 * What the publish job does (server/tutorialPublish.ts, decisions.md 180),
 * with the database and the files given in so a test can play YouTube: each
 * video a Publish chose goes up on its language's channel, in the plan's
 * order, and the database is told which YouTube video it became as soon as
 * it is up, so a later failure never puts it up twice. A new version takes
 * the old one's place in its playlist, and the old one is unlisted with a
 * line pointing to the new one. Before any video, each channel that does not
 * yet look as it should (its description, language, banner and list of the
 * others: youtube.ts `brandChannel`) is brought up to date, and the comments
 * YouTube holds for review on each are counted for the dashboard.
 *
 * YouTube allows 100 uploads a day for the whole Google Cloud project, all
 * channels together, and 10,000 units for everything else (a video and its
 * playlist place cost about 100). Out of either, the run stops and the rest
 * wait for the next day's run.
 */

/** One version due, as `ops_tutorials_due` answers it. */
export interface Due {
  tutorial: string;
  language: ChannelLanguage;
  sha256: string;
  title: string;
  description: string;
  playlist: string;
  bytes: number;
  channelId: string;
  /** The YouTube video an older version became, which this one replaces. */
  replaces: string | null;
}

/** A connected channel, and the look last put on it (youtube.ts `brandOf`), as `ops_youtube_channels` answers it. */
export interface Channel {
  channelId: string;
  language: ChannelLanguage;
  branded: string | null;
}

export interface PublisherDeps {
  fetcher: Fetch;
  client: Client;
  channels(): Promise<Channel[]>;
  /** The channel's banner, as the web app serves it. */
  banner(language: ChannelLanguage): Promise<Uint8Array<ArrayBuffer>>;
  /** The look now on the channel, or the code of why it could not be put there. */
  branded(channel: Channel, brand: string | null, failed: string | null): Promise<void>;
  /** How many comments the channel holds for review. */
  held(channel: Channel, count: number): Promise<void>;
  due(limit: number): Promise<Due[]>;
  /** The channel's refresh token from Vault; null when it was never connected. */
  refreshToken(channelId: string): Promise<string | null>;
  /** The MP4 as the Worker serves it from R2. */
  file(video: Due): Promise<{ body: ReadableStream<Uint8Array>; bytes: number }>;
  /** Up as `youtubeId`, or not, with a code. */
  published(video: Due, youtubeId: string | null, failed: string | null): Promise<void>;
  /** The run was asked to stop (SIGTERM): finish nothing new. */
  stopping(): boolean;
}

export interface PublishReport {
  /** Channels brought up to date, and those that could not be. */
  branded: number;
  brandFailed: number;
  /** Comments held for review, on all channels. */
  held: number;
  due: number;
  published: number;
  replaced: number;
  failed: number;
  /** Up, but its playlist place or the old version's line did not work: counted in the job run, with its code if it was the first. */
  incomplete: number;
  /** Out of the day's uploads or units: the rest wait for tomorrow. */
  outOfQuota: boolean;
  /** The first failure's code, for the job run. */
  firstError: string | null;
}

/** Most a run takes on: YouTube's day of uploads. */
export const DAY_UPLOADS = 100;

/** A code that fits the database's columns, from anything thrown. */
export const failureCode = (e: unknown) => (e instanceof YouTubeError ? e.code : e instanceof Error ? e.name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 80) || 'Error' : 'unknown');

/**
 * Puts up what is due, then asks again, so videos chosen while it ran go up
 * in the same run; each version is tried once a run, and no more than a
 * day's uploads are tried.
 */
export async function publishTutorials(deps: PublisherDeps, report: PublishReport): Promise<PublishReport> {
  const tried = new Set<string>();
  const key = (v: Due) => `${v.tutorial}/${v.language}/${v.sha256}`;
  const run: Run = { tokens: new Map(), playlists: new Map() };
  await tendChannels(deps, run, report);
  while (!report.outOfQuota && !deps.stopping() && tried.size < DAY_UPLOADS) {
    const due = (await deps.due(DAY_UPLOADS)).filter((v) => !tried.has(key(v))).slice(0, DAY_UPLOADS - tried.size);
    if (!due.length) break;
    for (const v of due) tried.add(key(v));
    report.due += due.length;
    await publishSome(deps, run, due, report);
  }
  return report;
}

interface Run {
  /** Per channel: its access token (an hour's, asked again past 45 minutes) or why there is none. */
  tokens: Map<string, { token: string; at: number } | { failed: string }>;
  /** Per channel and title: the playlist's id. */
  playlists: Map<string, string>;
}

/** A channel's access token for this run: asked again past 45 minutes, and never again once Google refused it. */
async function tokenFor(deps: PublisherDeps, { tokens }: Run, channelId: string): Promise<string> {
  const kept = tokens.get(channelId);
  if (kept && 'failed' in kept) throw new YouTubeError(401, kept.failed);
  if (kept && Date.now() - kept.at < 45 * 60_000) return kept.token;
  const refresh = await deps.refreshToken(channelId);
  if (!refresh) {
    tokens.set(channelId, { failed: 'not_connected' });
    throw new YouTubeError(401, 'not_connected');
  }
  try {
    const fresh = await accessToken(deps.fetcher, deps.client, refresh);
    tokens.set(channelId, { token: fresh, at: Date.now() });
    return fresh;
  } catch (e) {
    // A token Google took back (invalid_grant) fails every video of that channel until it is connected again.
    if (e instanceof YouTubeError && e.status < 500) tokens.set(channelId, { failed: e.reason });
    throw e;
  }
}

/**
 * Each channel whose look is not the one it should have gets it, and its
 * held comments are counted; what fails waits for the next run.
 */
async function tendChannels(deps: PublisherDeps, run: Run, report: PublishReport): Promise<void> {
  for (const channel of await deps.channels()) {
    if (deps.stopping() || report.outOfQuota) return;
    let token: string;
    try {
      token = await tokenFor(deps, run, channel.channelId);
      const banner = await deps.banner(channel.language);
      const brand = await brandOf(channel.language, banner);
      if (brand !== channel.branded) {
        await brandChannel(deps.fetcher, token, channel.language, banner);
        await deps.branded(channel, brand, null);
        report.branded += 1;
      }
    } catch (e) {
      const code = failureCode(e);
      report.brandFailed += 1;
      report.firstError ??= code;
      report.outOfQuota ||= outOfQuota(e);
      await deps.branded(channel, null, code);
      continue;
    }
    try {
      const held = await heldComments(deps.fetcher, token, channel.channelId);
      await deps.held(channel, held);
      report.held += held;
    } catch (e) {
      report.firstError ??= failureCode(e);
      report.outOfQuota ||= outOfQuota(e);
    }
  }
}

async function publishSome(deps: PublisherDeps, run: Run, due: Due[], report: PublishReport): Promise<void> {
  const { playlists } = run;
  const token = (channelId: string) => tokenFor(deps, run, channelId);
  const fail = async (video: Due, e: unknown) => {
    const code = failureCode(e);
    report.failed += 1;
    report.firstError ??= code;
    await deps.published(video, null, code);
  };

  for (const video of due) {
    if (deps.stopping()) break;
    let youtubeId: string;
    let access: string;
    try {
      access = await token(video.channelId);
      const file = await deps.file(video);
      youtubeId = await uploadVideo(deps.fetcher, access, {
        title: video.title, description: video.description, language: video.language, file, replacing: video.replaces !== null
      });
    } catch (e) {
      await fail(video, e);
      if (outOfQuota(e)) {
        report.outOfQuota = true;
        break;
      }
      continue;
    }
    await deps.published(video, youtubeId, null);
    report.published += 1;
    try {
      const key = `${video.channelId}\n${video.playlist}`;
      let playlistId = playlists.get(key);
      if (!playlistId) playlists.set(key, (playlistId = await playlistFor(deps.fetcher, access, video.playlist, video.language)));
      await placeInPlaylist(deps.fetcher, access, playlistId, youtubeId, video.replaces ?? undefined);
      if (video.replaces) {
        await retire(deps.fetcher, access, video.replaces, youtubeId, video.language);
        report.replaced += 1;
      }
    } catch (e) {
      report.incomplete += 1;
      report.firstError ??= failureCode(e);
      if (outOfQuota(e)) {
        report.outOfQuota = true;
        break;
      }
    }
  }
}
