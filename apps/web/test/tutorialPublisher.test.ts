import { describe, expect, it } from 'vitest';
import { publishTutorials, type Channel, type Due, type PublishReport } from '../../../server/tutorialPublisher';
import { brandOf, channelAbout, CHANNELS } from '../../../server/youtube';

/** The publish job (server/tutorialPublisher.ts, decisions.md 180) against a YouTube that answers by address. */

const fresh = (): PublishReport => ({ branded: 0, brandFailed: 0, held: 0, due: 0, published: 0, replaced: 0, failed: 0, incomplete: 0, outOfQuota: false, channelsFull: 0, firstError: null });
const video = (tutorial: string, over: Partial<Due> = {}): Due => ({
  tutorial, language: 'es', sha256: 'a'.repeat(64), title: tutorial, description: 'd', playlist: 'Traductores', bytes: 5,
  channelId: CHANNELS.es, replaces: null, ...over
});

type Section = { id: string; snippet: { type: string; position: number; title?: string }; contentDetails: { channels?: string[]; playlists?: string[] } };

/**
 * `uploads`: how many the project may put up before YouTube's day is out; `perChannel`: how many each
 * channel may (its access token is its refresh token's); `brandRefused`: a language YouTube will not
 * take for a channel; `fieldRefused`: a setting of the channel's it will not take back, by its name;
 * `sections`: the rows on the channel's home page, kept from one run to the next.
 */
function youtube(options: { uploads?: number; perChannel?: number; tokenRefused?: string; channel?: string; brandRefused?: string; fieldRefused?: string; sections?: Section[] } = {}) {
  const sections = options.sections ?? [];
  const lists = [{ id: 'PLtrad', snippet: { title: 'Traductores' } }];
  const calls: string[] = [];
  const sent: Record<string, unknown>[] = [];
  /** Every JSON body sent, by call. */
  const bodies: { call: string; body: unknown }[] = [];
  let uploaded = 0;
  const byChannel = new Map<string, number>();
  const fetcher = async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = input.split('?')[0]!.replace('https://www.googleapis.com', '');
    calls.push(`${method} ${path}`);
    if (typeof init?.body === 'string' && init.body.startsWith('{')) bodies.push({ call: `${method} ${path}`, body: JSON.parse(init.body) });
    if (input === 'https://oauth2.googleapis.com/token') {
      const refresh = new URLSearchParams(String(init?.body)).get('refresh_token');
      return options.tokenRefused ? Response.json({ error: options.tokenRefused }, { status: 400 }) : Response.json({ access_token: `ya29 ${refresh}` });
    }
    if (path === '/upload/youtube/v3/videos') {
      const channel = new Headers(init?.headers).get('authorization') ?? '';
      if (uploaded >= (options.uploads ?? 100)) return Response.json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 });
      if ((byChannel.get(channel) ?? 0) >= (options.perChannel ?? 100)) return Response.json({ error: { errors: [{ reason: 'uploadLimitExceeded' }] } }, { status: 400 });
      byChannel.set(channel, (byChannel.get(channel) ?? 0) + 1);
      return new Response(null, { headers: { location: 'https://upload.example/session' } });
    }
    if (input === 'https://upload.example/session') return Response.json({ id: `video${String(++uploaded).padStart(6, '0')}` });
    if (path === '/youtube/v3/channels' && method === 'GET') {
      return Response.json({ items: [{ id: options.channel ?? CHANNELS.es, brandingSettings: { channel: { title: 'LangQuest Español', keywords: 'LangQuest', country: 'MX' } } }] });
    }
    if (path === '/upload/youtube/v3/channelBanners/insert') return Response.json({ url: 'https://yt3.example/banner' });
    if (path === '/youtube/v3/channels') {
      const body = JSON.parse(String(init?.body)) as { brandingSettings: { channel: Record<string, unknown> & { defaultLanguage?: string } } };
      sent.push(body);
      if (options.brandRefused && body.brandingSettings.channel.defaultLanguage === options.brandRefused) {
        return Response.json({ error: { errors: [{ reason: 'brandingValidationError' }] } }, { status: 400 });
      }
      if (options.fieldRefused && options.fieldRefused in body.brandingSettings.channel) {
        return Response.json({ error: { errors: [{ reason: 'brandingValidationError', location: `brandingSettings.channel.${options.fieldRefused}` }] } }, { status: 400 });
      }
      return Response.json({});
    }
    if (path === '/youtube/v3/channelSections') {
      if (method === 'GET') return Response.json({ items: sections });
      const body = JSON.parse(String(init?.body)) as Section;
      if (method === 'POST') sections.push({ ...body, id: `row${sections.length}` });
      else sections.splice(sections.findIndex((s) => s.id === body.id), 1, body);
      return Response.json(body);
    }
    if (path === '/youtube/v3/commentThreads') {
      const q = new URL(input).searchParams;
      if (q.get('moderationStatus') !== 'heldForReview') return Response.json({ items: [] });
      return Response.json(q.get('pageToken') ? { items: [{ id: 'c3' }] } : { items: [{ id: 'c1' }, { id: 'c2' }], nextPageToken: 'p2' });
    }
    if (path === '/youtube/v3/playlists' && method === 'GET') return Response.json({ items: lists });
    if (path === '/youtube/v3/playlists') {
      lists.push({ id: 'PLnew', snippet: { title: (JSON.parse(String(init?.body)) as { snippet: { title: string } }).snippet.title } });
      return Response.json({ id: 'PLnew' });
    }
    if (path === '/youtube/v3/playlistItems' && method === 'GET') return Response.json({ items: [{ id: 'old-item', snippet: { position: 3 } }] });
    if (path === '/youtube/v3/playlistItems') return method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: 'item' });
    if (path === '/youtube/v3/videos' && method === 'GET') return Response.json({ items: [{ id: 'oldvideo001', snippet: { title: 't', description: 'old' }, status: {} }] });
    if (path === '/youtube/v3/videos') return Response.json({ id: 'oldvideo001' });
    return new Response('{}', { status: 404 });
  };
  return { calls, sent, bodies, fetcher };
}

const BANNER = new Uint8Array([137, 80, 78, 71]);

function deps(due: Due[], yt: ReturnType<typeof youtube>, refresh: Record<string, string | null> = { [CHANNELS.es]: '1//es' }, channels: Channel[] = []) {
  const marks: string[] = [];
  return {
    marks,
    deps: {
      fetcher: yt.fetcher,
      client: { clientId: 'id', clientSecret: 'secret' },
      channels: async () => channels,
      banner: async () => BANNER,
      branded: async (c: Channel, brand: string | null, failed: string | null) => { marks.push(`${c.language} ${brand ? 'branded' : `failed ${failed}`}`); c.branded = brand ?? c.branded; },
      held: async (c: Channel, count: number) => { marks.push(`${c.language} held ${count}`); },
      due: async () => due,
      refreshToken: async (channelId: string) => refresh[channelId] ?? null,
      file: async () => ({ body: new Response('video').body!, bytes: 5 }),
      published: async (v: Due, id: string | null, failed: string | null) => { marks.push(`${v.tutorial} ${id ?? `failed ${failed}`}`); },
      stopping: () => false
    }
  };
}

describe('the publish job', () => {
  it('puts each video up and in its playlist, and says which YouTube video it became', async () => {
    const yt = youtube();
    const d = deps([video('record-a-passage'), video('check-a-passage')], yt);
    expect(await publishTutorials(d.deps, fresh())).toMatchObject({ due: 2, published: 2, failed: 0, incomplete: 0, outOfQuota: false });
    expect(d.marks).toEqual(['record-a-passage video000001', 'check-a-passage video000002']);
    // One token and one look for the playlist, kept for the second video.
    expect(yt.calls.filter((c) => c.includes('oauth2'))).toHaveLength(1);
    expect(yt.calls.filter((c) => c === 'GET /youtube/v3/playlists')).toHaveLength(1);
  });

  it('puts the trailer first in its playlist and makes it the channel\'s trailer, without a computer\'s voice', async () => {
    const yt = youtube();
    const d = deps([video('record-a-passage'), video('trailer', { playlist: 'Todos' })], yt);
    expect(await publishTutorials(d.deps, fresh())).toMatchObject({ published: 2, incomplete: 0 });
    const body = (call: string, n: number) => yt.bodies.filter((b) => b.call === call)[n]?.body;
    expect(body('POST /upload/youtube/v3/videos', 0)).toMatchObject({ status: { containsSyntheticMedia: true } });
    expect(body('POST /upload/youtube/v3/videos', 1)).toMatchObject({ status: { containsSyntheticMedia: false } });
    expect(body('POST /youtube/v3/playlistItems', 0)).toEqual({ snippet: { playlistId: 'PLtrad', resourceId: { kind: 'youtube#video', videoId: 'video000001' } } });
    expect(body('POST /youtube/v3/playlistItems', 1)).toEqual({ snippet: { playlistId: 'PLnew', resourceId: { kind: 'youtube#video', videoId: 'video000002' }, position: 0 } });
    // The channel's other settings and look stay as they were, with the trailer named.
    expect(yt.sent).toEqual([{
      id: CHANNELS.es,
      brandingSettings: {
        channel: { keywords: 'LangQuest', country: 'MX', description: channelAbout('es'), unsubscribedTrailer: 'video000002', defaultLanguage: 'es' },
        image: { bannerExternalUrl: 'https://yt3.example/banner' }
      }
    }]);
    // And the look put on the channel is the one with its trailer, so the next run leaves it.
    expect(d.marks).toEqual(['record-a-passage video000001', 'trailer video000002', 'es branded']);
  });

  it('makes a trailer that is up the channel\'s on the next run when that failed, and then leaves it', async () => {
    const yt = youtube();
    const es: Channel = { channelId: CHANNELS.es, language: 'es', branded: await brandOf('es', BANNER), trailer: 'video000009' };
    expect(await publishTutorials(deps([], yt, undefined, [es]).deps, fresh())).toMatchObject({ branded: 1, brandFailed: 0 });
    expect(yt.sent[0]).toMatchObject({ brandingSettings: { channel: { unsubscribedTrailer: 'video000009' } } });
    expect(es.branded).toBe(await brandOf('es', BANNER, 'video000009'));
    const again = youtube();
    await publishTutorials(deps([], again, undefined, [es]).deps, fresh());
    expect(again.sent).toEqual([]);
  });

  it('puts a new version in the old one\'s place and unlists the old one', async () => {
    const yt = youtube();
    const d = deps([video('record-a-passage', { replaces: 'oldvideo001' })], yt);
    expect(await publishTutorials(d.deps, fresh())).toMatchObject({ published: 1, replaced: 1 });
    expect(yt.calls.slice(-5)).toEqual([
      'GET /youtube/v3/playlistItems', 'POST /youtube/v3/playlistItems', 'DELETE /youtube/v3/playlistItems', 'GET /youtube/v3/videos', 'PUT /youtube/v3/videos'
    ]);
  });

  it('stops at YouTube\'s day for the project, keeping why, and leaves the rest for tomorrow', async () => {
    const yt = youtube({ uploads: 1 });
    const d = deps([video('a'), video('b'), video('c')], yt);
    expect(await publishTutorials(d.deps, fresh())).toMatchObject({ published: 1, failed: 1, outOfQuota: true, firstError: 'youtube_quotaExceeded' });
    expect(d.marks).toEqual(['a video000001', 'b failed youtube_quotaExceeded']);
  });

  it('leaves a channel at its own day\'s limit to wait, with its videos not failed, and goes on with the others', async () => {
    // Arabic's first morning: ten up, then YouTube took no more on that channel, and the run stopped for every language.
    const yt = youtube({ perChannel: 1 });
    const ar = (tutorial: string) => video(tutorial, { language: 'ar', channelId: CHANNELS.ar });
    const en = (tutorial: string) => video(tutorial, { language: 'en', channelId: CHANNELS.en });
    const d = deps([ar('a'), ar('b'), ar('c'), en('a'), en('b')], yt, { [CHANNELS.ar]: '1//ar', [CHANNELS.en]: '1//en' });
    expect(await publishTutorials(d.deps, fresh())).toMatchObject({
      due: 4, published: 2, failed: 0, channelsFull: 2, outOfQuota: false, firstError: 'youtube_uploadLimitExceeded'
    });
    // Each channel is tried until it is full, and its other videos are left for the next run.
    expect(d.marks).toEqual(['a video000001', 'a video000002']);
    expect(yt.calls.filter((c) => c === 'POST /upload/youtube/v3/videos')).toHaveLength(4);
  });

  it('fails a channel whose token Google took back, and goes on with the others', async () => {
    const yt = youtube({ tokenRefused: 'invalid_grant' });
    const d = deps([video('a'), video('b', { language: 'en', channelId: CHANNELS.en })], yt, { [CHANNELS.es]: '1//es' });
    expect(await publishTutorials(d.deps, fresh())).toMatchObject({ published: 0, failed: 2, outOfQuota: false });
    expect(d.marks).toEqual(['a failed youtube_invalid_grant', 'b failed youtube_not_connected']);
  });

  it('puts up videos chosen while it runs, and tries each version once a run', async () => {
    const yt = youtube();
    const answers = [[video('a')], [video('a'), video('b', { sha256: 'b'.repeat(64) })]];
    const d = deps([], yt);
    let asked = 0;
    d.deps.due = async () => answers[Math.min(asked++, answers.length - 1)]!;
    expect(await publishTutorials(d.deps, fresh())).toMatchObject({ due: 2, published: 2 });
    expect(d.marks).toEqual(['a video000001', 'b video000002']);
    expect(asked).toBe(3);
  });

  it('first puts each channel\'s description, language, banner and home page on, once, and counts its held comments', async () => {
    const rows: Section[] = [];
    const yt = youtube({ sections: rows });
    const es: Channel = { channelId: CHANNELS.es, language: 'es', branded: null };
    const d = deps([video('record-a-passage')], yt, undefined, [es]);
    expect(await publishTutorials(d.deps, fresh())).toMatchObject({ branded: 1, brandFailed: 0, held: 3, published: 1 });
    expect(yt.calls.slice(1, 8)).toEqual([
      'GET /youtube/v3/channels', 'POST /upload/youtube/v3/channelBanners/insert', 'PUT /youtube/v3/channels',
      'GET /youtube/v3/channelSections', 'GET /youtube/v3/playlists', 'POST /youtube/v3/channelSections', 'POST /youtube/v3/channelSections'
    ]);
    // The other channels, then its one playlist so far (decisions.md 191).
    expect(rows.map((r) => [r.snippet.type, r.snippet.position, r.contentDetails.playlists ?? r.contentDetails.channels!.length])).toEqual([
      ['multipleChannels', 0, 14], ['singlePlaylist', 1, ['PLtrad']]
    ]);
    // Its other settings kept; its name, which only Google's account pages change, left out.
    expect(yt.sent[0]).toEqual({
      id: CHANNELS.es,
      brandingSettings: { channel: { keywords: 'LangQuest', country: 'MX', description: channelAbout('es'), defaultLanguage: 'es' }, image: { bannerExternalUrl: 'https://yt3.example/banner' } }
    });
    expect(d.marks).toEqual(['es branded', 'es held 3', 'record-a-passage video000001']);
    expect(es.branded).toBe(await brandOf('es', BANNER));

    // The next run changes nothing on the channel, and counts again.
    const again = youtube({ sections: rows });
    await publishTutorials(deps([], again, undefined, [es]).deps, fresh());
    expect(again.calls).toEqual([
      'POST https://oauth2.googleapis.com/token', 'GET /youtube/v3/channelSections', 'GET /youtube/v3/playlists', 'GET /youtube/v3/commentThreads', 'GET /youtube/v3/commentThreads'
    ]);
  });

  it('gives a playlist the run made its row on the home page before the run ends (decision 192)', async () => {
    const rows: Section[] = [];
    const yt = youtube({ sections: rows });
    const es: Channel = { channelId: CHANNELS.es, language: 'es', branded: await brandOf('es', BANNER) };
    const d = deps([video('do-a-check', { playlist: 'Revisores y consultores' })], yt, undefined, [es]);
    expect(await publishTutorials(d.deps, fresh())).toMatchObject({ published: 1, incomplete: 0, firstError: null });
    expect(rows.map((r) => r.contentDetails.playlists ?? 'channels')).toEqual(['channels', ['PLtrad'], ['PLnew']]);
    // A run that made none looks at the home page once, before its videos.
    const again = youtube({ sections: rows });
    await publishTutorials(deps([video('record-a-passage')], again, undefined, [es]).deps, fresh());
    expect(again.calls.filter((c) => c === 'GET /youtube/v3/channelSections')).toHaveLength(1);
  });

  it('puts a channel\'s description and banner on without its language when YouTube refuses the language', async () => {
    const yt = youtube({ brandRefused: 'es' });
    const es: Channel = { channelId: CHANNELS.es, language: 'es', branded: null };
    const d = deps([], yt, undefined, [es]);
    expect(await publishTutorials(d.deps, fresh())).toMatchObject({ branded: 1, brandFailed: 0 });
    expect(yt.sent).toEqual([
      { id: CHANNELS.es, brandingSettings: { channel: { keywords: 'LangQuest', country: 'MX', description: channelAbout('es'), defaultLanguage: 'es' }, image: { bannerExternalUrl: 'https://yt3.example/banner' } } },
      { id: CHANNELS.es, brandingSettings: { channel: { keywords: 'LangQuest', country: 'MX', description: channelAbout('es') }, image: { bannerExternalUrl: 'https://yt3.example/banner' } } }
    ]);
  });

  it('puts them on without the channel\'s own settings when YouTube refuses one of those too, and says which field it refused', async () => {
    // Why: YouTube refused Hausa's channel with its language and without it (2026-10-29).
    const yt = youtube({ brandRefused: 'es', fieldRefused: 'keywords' });
    const es: Channel = { channelId: CHANNELS.es, language: 'es', branded: null };
    expect(await publishTutorials(deps([], yt, undefined, [es]).deps, fresh())).toMatchObject({ branded: 1, brandFailed: 0 });
    expect(yt.sent.map((b) => (b as { brandingSettings: { channel: object } }).brandingSettings.channel)).toEqual([
      { keywords: 'LangQuest', country: 'MX', description: channelAbout('es'), defaultLanguage: 'es' },
      { keywords: 'LangQuest', country: 'MX', description: channelAbout('es') },
      { description: channelAbout('es') }
    ]);
    const refused = youtube({ fieldRefused: 'description' });
    const d = deps([], refused, undefined, [{ ...es, branded: null }]);
    expect(await publishTutorials(d.deps, fresh())).toMatchObject({ branded: 0, brandFailed: 1, firstError: 'youtube_brandingValidationError' });
    expect(refused.sent).toHaveLength(3);
    expect(d.marks).toEqual(['es failed youtube_brandingValidationError:brandingSettings.channel.description']);
  });

  it('leaves a channel alone when its token is for another, and still puts the videos up', async () => {
    const yt = youtube({ channel: CHANNELS.pt });
    const d = deps([video('record-a-passage')], yt, undefined, [{ channelId: CHANNELS.es, language: 'es', branded: null }]);
    expect(await publishTutorials(d.deps, fresh())).toMatchObject({ branded: 0, brandFailed: 1, published: 1, firstError: 'youtube_wrong_channel' });
    expect(yt.sent).toEqual([]);
    expect(d.marks).toEqual(['es failed youtube_wrong_channel', 'record-a-passage video000001']);
  });

  it('leaves a channel Google no longer lets in, and says why', async () => {
    const d = deps([], youtube({ tokenRefused: 'invalid_grant' }), undefined, [{ channelId: CHANNELS.es, language: 'es', branded: 'f'.repeat(64) }]);
    expect(await publishTutorials(d.deps, fresh())).toMatchObject({ branded: 0, brandFailed: 1, held: 0, firstError: 'youtube_invalid_grant' });
    expect(d.marks).toEqual(['es failed youtube_invalid_grant']);
  });
});
