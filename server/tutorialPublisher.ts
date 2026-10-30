import {
  accessToken, brandChannel, brandOf, channelFull, heldComments, outOfQuota, placeInPlaylist, playlistFor, retire, setHome, TRAILER, uploadVideo, YouTubeError,
  type ChannelLanguage, type Client, type Fetch
} from './youtube';

/**
 * What the publish job does (server/tutorialPublish.ts, decisions.md 180),
 * with the database and the files given in so a test can play YouTube: each
 * video a Publish chose goes up on its language's channel, in the plan's
 * order, and the database is told which YouTube video it became as soon as
 * it is up, so a later failure never puts it up twice. A new version takes
 * the old one's place in its playlist, and the old one is unlisted with a
 * line pointing to the new one. The trailer (decisions.md 189) goes first in
 * its playlist and becomes the channel's trailer, the video the channel
 * shows people who have not subscribed. Before any video, each channel that does not
 * yet look as it should (its description, language and banner: youtube.ts
 * `brandChannel`) is brought up to date, its home page gets a row for each
 * playlist it has and one of the other channels (`setHome`, decisions.md
 * 191), and the comments YouTube holds for review on each are counted for
 * the dashboard.
 *
 * YouTube allows 100 uploads a day for the whole Google Cloud project, all
 * channels together, and 10,000 units for everything else (a video and its
 * playlist place cost about 100). Out of either, the run stops and the rest
 * wait for the next day's run. Each channel has its own limit too, lower for
 * a new channel (Arabic's first morning stopped at 10): a channel that
 * reaches it waits, and the others go on.
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
  /** The YouTube video the language's newest trailer became, once one is up (decisions.md 189). */
  trailer?: string | null;
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
  /** Channels that reached their own day's limit: their videos wait, the others went on. */
  channelsFull: number;
  /** The first failure's code, for the job run. */
  firstError: string | null;
}

/** Most a run takes on: YouTube's day of uploads. */
export const DAY_UPLOADS = 100;
/** How many due versions are asked for at once: enough to reach every language past the channels that are full. */
const ASKED = 500;

/** A code that fits the database's columns, from anything thrown. */
export const failureCode = (e: unknown) => (e instanceof YouTubeError ? e.code : e instanceof Error ? e.name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 80) || 'Error' : 'unknown');

/**
 * Puts up what is due, then asks again, so videos chosen while it ran go up
 * in the same run; each version is tried once a run, and no more than a
 * day's uploads are tried.
 */
export async function publishTutorials(deps: PublisherDeps, report: PublishReport): Promise<PublishReport> {
  const run: Run = { tokens: new Map(), playlists: new Map(), tried: new Set(), full: new Set() };
  await tendChannels(deps, run, report);
  while (!report.outOfQuota && !deps.stopping() && run.tried.size < DAY_UPLOADS) {
    const due = (await deps.due(ASKED)).filter((v) => !run.tried.has(key(v)) && !run.full.has(v.channelId));
    if (!due.length) break;
    await publishSome(deps, run, due, report);
  }
  return report;
}

const key = (v: Due) => `${v.tutorial}/${v.language}/${v.sha256}`;

interface Run {
  /** Per channel: its access token (an hour's, asked again past 45 minutes) or why there is none. */
  tokens: Map<string, { token: string; at: number } | { failed: string }>;
  /** Per channel and title: the playlist's id. */
  playlists: Map<string, string>;
  /** The versions tried this run, each once. */
  tried: Set<string>;
  /** The channels at their own day's limit. */
  full: Set<string>;
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
 * Each channel whose look is not the one it should have gets it, its home
 * page's rows are brought up to date (a playlist made by yesterday's uploads
 * gets its row), and its held comments are counted; what fails waits for the
 * next run.
 */
async function tendChannels(deps: PublisherDeps, run: Run, report: PublishReport): Promise<void> {
  for (const channel of await deps.channels()) {
    if (deps.stopping() || report.outOfQuota) return;
    let token: string;
    try {
      token = await tokenFor(deps, run, channel.channelId);
      const banner = await deps.banner(channel.language);
      const brand = await brandOf(channel.language, banner, channel.trailer);
      if (brand !== channel.branded) {
        await brandChannel(deps.fetcher, token, channel.language, banner, channel.trailer ?? undefined);
        await deps.branded(channel, brand, null);
        report.branded += 1;
      }
    } catch (e) {
      const code = failureCode(e);
      report.brandFailed += 1;
      report.firstError ??= code;
      report.outOfQuota ||= outOfQuota(e);
      // The channel keeps which field YouTube refused, when it says, so the dashboard shows it.
      await deps.branded(channel, null, e instanceof YouTubeError ? e.codeWhere : code);
      continue;
    }
    try {
      await setHome(deps.fetcher, token, channel.language);
    } catch (e) {
      report.firstError ??= failureCode(e);
      report.outOfQuota ||= outOfQuota(e);
      if (report.outOfQuota) return;
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
    if (deps.stopping() || run.tried.size >= DAY_UPLOADS) break;
    if (run.full.has(video.channelId)) continue;
    run.tried.add(key(video));
    report.due += 1;
    const trailer = video.tutorial === TRAILER;
    let youtubeId: string;
    let access: string;
    try {
      access = await token(video.channelId);
      const file = await deps.file(video);
      youtubeId = await uploadVideo(deps.fetcher, access, {
        title: video.title, description: video.description, language: video.language, file, replacing: video.replaces !== null, synthetic: !trailer
      });
    } catch (e) {
      if (channelFull(e)) {
        // Not the video's failure: it goes up when the channel may upload again.
        run.full.add(video.channelId);
        report.channelsFull += 1;
        report.firstError ??= failureCode(e);
        continue;
      }
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
      await placeInPlaylist(deps.fetcher, access, playlistId, youtubeId, video.replaces ?? undefined, trailer);
      // The channel's trailer at once; when that fails, the next run's look of the channel includes it (tendChannels).
      if (trailer) {
        const banner = await deps.banner(video.language);
        await brandChannel(deps.fetcher, access, video.language, banner, youtubeId);
        await deps.branded({ channelId: video.channelId, language: video.language, branded: null }, await brandOf(video.language, banner, youtubeId), null);
      }
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
