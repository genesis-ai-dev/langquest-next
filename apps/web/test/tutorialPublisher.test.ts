import { describe, expect, it } from 'vitest';
import { publishTutorials, type Channel, type Due, type PublishReport } from '../../../server/tutorialPublisher';
import { brandOf, channelAbout, CHANNELS } from '../../../server/youtube';

/** The publish job (server/tutorialPublisher.ts, decisions.md 180) against a YouTube that answers by address. */

const fresh = (): PublishReport => ({ branded: 0, brandFailed: 0, held: 0, due: 0, published: 0, replaced: 0, failed: 0, incomplete: 0, outOfQuota: false, firstError: null });
const video = (tutorial: string, over: Partial<Due> = {}): Due => ({
  tutorial, language: 'es', sha256: 'a'.repeat(64), title: tutorial, description: 'd', playlist: 'Traductores', bytes: 5,
  channelId: CHANNELS.es, replaces: null, ...over
});

function youtube(options: { uploads?: number; tokenRefused?: string; channel?: string } = {}) {
  const calls: string[] = [];
  const sent: Record<string, unknown>[] = [];
  let uploaded = 0;
  const fetcher = async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = input.split('?')[0]!.replace('https://www.googleapis.com', '');
    calls.push(`${method} ${path}`);
    if (input === 'https://oauth2.googleapis.com/token') {
      return options.tokenRefused ? Response.json({ error: options.tokenRefused }, { status: 400 }) : Response.json({ access_token: 'ya29' });
    }
    if (path === '/upload/youtube/v3/videos') {
      if (uploaded >= (options.uploads ?? 100)) return Response.json({ error: { errors: [{ reason: 'uploadLimitExceeded' }] } }, { status: 400 });
      return new Response(null, { headers: { location: 'https://upload.example/session' } });
    }
    if (input === 'https://upload.example/session') return Response.json({ id: `video${String(++uploaded).padStart(6, '0')}` });
    if (path === '/youtube/v3/channels' && method === 'GET') {
      return Response.json({ items: [{ id: options.channel ?? CHANNELS.es, brandingSettings: { channel: { title: 'LangQuest Español', keywords: 'LangQuest', country: 'MX' } } }] });
    }
    if (path === '/upload/youtube/v3/channelBanners/insert') return Response.json({ url: 'https://yt3.example/banner' });
    if (path === '/youtube/v3/channels') {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({});
    }
    if (path === '/youtube/v3/channelSections') return Response.json(method === 'GET' ? { items: [] } : {});
    if (path === '/youtube/v3/commentThreads') {
      const q = new URL(input).searchParams;
      if (q.get('moderationStatus') !== 'heldForReview') return Response.json({ items: [] });
      return Response.json(q.get('pageToken') ? { items: [{ id: 'c3' }] } : { items: [{ id: 'c1' }, { id: 'c2' }], nextPageToken: 'p2' });
    }
    if (path === '/youtube/v3/playlists' && method === 'GET') return Response.json({ items: [{ id: 'PLtrad', snippet: { title: 'Traductores' } }] });
    if (path === '/youtube/v3/playlists') return Response.json({ id: 'PLnew' });
    if (path === '/youtube/v3/playlistItems' && method === 'GET') return Response.json({ items: [{ id: 'old-item', snippet: { position: 3 } }] });
    if (path === '/youtube/v3/playlistItems') return method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json({ id: 'item' });
    if (path === '/youtube/v3/videos' && method === 'GET') return Response.json({ items: [{ id: 'oldvideo001', snippet: { title: 't', description: 'old' }, status: {} }] });
    if (path === '/youtube/v3/videos') return Response.json({ id: 'oldvideo001' });
    return new Response('{}', { status: 404 });
  };
  return { calls, sent, fetcher };
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

  it('puts a new version in the old one\'s place and unlists the old one', async () => {
    const yt = youtube();
    const d = deps([video('record-a-passage', { replaces: 'oldvideo001' })], yt);
    expect(await publishTutorials(d.deps, fresh())).toMatchObject({ published: 1, replaced: 1 });
    expect(yt.calls.slice(-5)).toEqual([
      'GET /youtube/v3/playlistItems', 'POST /youtube/v3/playlistItems', 'DELETE /youtube/v3/playlistItems', 'GET /youtube/v3/videos', 'PUT /youtube/v3/videos'
    ]);
  });

  it('stops at YouTube\'s day of uploads, keeping why, and leaves the rest for tomorrow', async () => {
    const yt = youtube({ uploads: 1 });
    const d = deps([video('a'), video('b'), video('c')], yt);
    expect(await publishTutorials(d.deps, fresh())).toMatchObject({ published: 1, failed: 1, outOfQuota: true, firstError: 'youtube_uploadLimitExceeded' });
    expect(d.marks).toEqual(['a video000001', 'b failed youtube_uploadLimitExceeded']);
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

  it('first puts each channel\'s description, language, banner and list of the others on, once, and counts its held comments', async () => {
    const yt = youtube();
    const es: Channel = { channelId: CHANNELS.es, language: 'es', branded: null };
    const d = deps([video('record-a-passage')], yt, undefined, [es]);
    expect(await publishTutorials(d.deps, fresh())).toMatchObject({ branded: 1, brandFailed: 0, held: 3, published: 1 });
    expect(yt.calls.slice(1, 6)).toEqual([
      'GET /youtube/v3/channels', 'POST /upload/youtube/v3/channelBanners/insert', 'PUT /youtube/v3/channels', 'GET /youtube/v3/channelSections', 'POST /youtube/v3/channelSections'
    ]);
    // Its other settings kept; its name, which only Google's account pages change, left out.
    expect(yt.sent[0]).toEqual({
      id: CHANNELS.es,
      brandingSettings: { channel: { keywords: 'LangQuest', country: 'MX', description: channelAbout('es'), defaultLanguage: 'es' }, image: { bannerExternalUrl: 'https://yt3.example/banner' } }
    });
    expect(d.marks).toEqual(['es branded', 'es held 3', 'record-a-passage video000001']);
    expect(es.branded).toBe(await brandOf('es', BANNER));

    // The next run changes nothing on the channel, and counts again.
    const again = youtube();
    await publishTutorials(deps([], again, undefined, [es]).deps, fresh());
    expect(again.calls).toEqual(['POST https://oauth2.googleapis.com/token', 'GET /youtube/v3/commentThreads', 'GET /youtube/v3/commentThreads']);
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
