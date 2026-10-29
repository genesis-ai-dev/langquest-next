import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  accessToken, bannerPath, channelAbout, channelFull, CHANNELS, consentUrl, exchangeCode, languageOfChannel, myChannel, outOfQuota, placeInPlaylist, playlistFor,
  readState, retire, setOtherChannels, signState, uploadVideo, WORDS, YouTubeError, type Fetch
} from '../../../server/youtube';

/** Tutorial videos on YouTube (server/youtube.ts, decisions.md 180), against a YouTube that answers by URL. */

const VIEWER = '0857d1bc-0000-4000-8000-000000000001';
const CLIENT = { clientId: 'client.apps.googleusercontent.com', clientSecret: 'shh' };

type Call = { method: string; url: string; body: unknown; headers: Record<string, string> };

/** A fetch whose answers are chosen by method and URL; every call is kept. */
function google(answers: (call: Call) => Response | undefined): Fetch & { calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (input: string, init: RequestInit = {}) => {
    const raw = init.body;
    const body = typeof raw === 'string' ? (raw.startsWith('{') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw))) : raw;
    const call = { method: init.method ?? 'GET', url: input, body, headers: (init.headers ?? {}) as Record<string, string> };
    calls.push(call);
    return answers(call) ?? Response.json({ error: { errors: [{ reason: 'notFound' }] } }, { status: 404 });
  }) as Fetch & { calls: Call[] };
  f.calls = calls;
  return f;
}

describe('the channels', () => {
  it('has one channel for each of the 15 app languages, and knows each one\'s language', () => {
    expect(Object.keys(CHANNELS)).toHaveLength(15);
    expect(new Set(Object.values(CHANNELS)).size).toBe(15);
    for (const id of Object.values(CHANNELS)) expect(id).toMatch(/^UC[A-Za-z0-9_-]{22}$/);
    expect(languageOfChannel(CHANNELS['zh-Hans'])).toBe('zh-Hans');
    expect(languageOfChannel('UCsomebodyElse000000000')).toBeNull();
    for (const words of Object.values(WORDS)) expect(Object.values(words).every((w) => w.length > 3 && !/[<>]/.test(w))).toBe(true);
  });
});

describe('Connect', () => {
  it('signs who pressed it into the state, and takes it back only unchanged and in time', async () => {
    const now = Date.UTC(2026, 9, 28, 8);
    const state = await signState(CLIENT.clientSecret, VIEWER, now);
    expect(await readState(CLIENT.clientSecret, state, now + 60_000)).toBe(VIEWER);
    expect(await readState(CLIENT.clientSecret, state, now + 16 * 60_000)).toBeNull();
    expect(await readState('another secret', state, now)).toBeNull();
    const other = '0857d1bc-0000-4000-8000-000000000002';
    expect(await readState(CLIENT.clientSecret, state.replace(VIEWER, other), now)).toBeNull();
    expect(await readState(CLIENT.clientSecret, 'garbled', now)).toBeNull();
  });

  it('asks Google for a refresh token, every time, with the upload and manage scopes', () => {
    const url = new URL(consentUrl(CLIENT, 'https://next.langquest.org/ops/api/youtube/callback', 'st'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: CLIENT.clientId, redirect_uri: 'https://next.langquest.org/ops/api/youtube/callback', access_type: 'offline', prompt: 'consent', state: 'st'
    });
    expect(url.searchParams.get('scope')!.split(' ')).toEqual(['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl']);
  });

  it('trades the code for a refresh token, refuses an answer without one, and finds the channel chosen', async () => {
    const f = google((c) => {
      if (c.url === 'https://oauth2.googleapis.com/token') {
        const b = c.body as Record<string, string>;
        if (b['grant_type'] === 'authorization_code') return Response.json(b['code'] === 'good' ? { access_token: 'at', refresh_token: 'rt' } : { access_token: 'at' });
        return Response.json(b['refresh_token'] === 'rt' ? { access_token: 'fresh' } : { error: 'invalid_grant' }, { status: b['refresh_token'] === 'rt' ? 200 : 400 });
      }
      if (c.url.endsWith('/channels?part=snippet&mine=true')) return Response.json({ items: [{ id: CHANNELS.es, snippet: { title: 'LangQuest - Español' } }] });
      return undefined;
    });
    expect(await exchangeCode(f, CLIENT, 'https://x/cb', 'good')).toEqual({ refreshToken: 'rt', accessToken: 'at' });
    await expect(exchangeCode(f, CLIENT, 'https://x/cb', 'no-refresh')).rejects.toMatchObject({ reason: 'no_refresh_token' });
    expect(await accessToken(f, CLIENT, 'rt')).toBe('fresh');
    await expect(accessToken(f, CLIENT, 'revoked')).rejects.toMatchObject({ status: 400, reason: 'invalid_grant', code: 'youtube_invalid_grant' });
    expect(await myChannel(f, 'at')).toEqual({ id: CHANNELS.es, title: 'LangQuest - Español' });
  });

  it('lists the other 14 channels on a channel\'s home page, in its language, and updates that list on the next Connect', async () => {
    let sections: { id: string; snippet: { type: string; title: string } }[] = [{ id: 's1', snippet: { type: 'singlePlaylist', title: 'x' } }];
    const f = google((c) => {
      if (c.url.includes('/channelSections?part=snippet&mine=true')) return Response.json({ items: sections });
      if (c.url.includes('/channelSections?part=snippet,contentDetails')) return Response.json({ id: 's2' });
      return undefined;
    });
    expect(await setOtherChannels(f, 'at', 'es')).toBe('made');
    const made = f.calls.at(-1)!;
    expect(made.method).toBe('POST');
    expect(made.body).toEqual({ snippet: { type: 'multipleChannels', title: 'Otros canales de LangQuest' }, contentDetails: { channels: expect.any(Array) } });
    const listed = (made.body as { contentDetails: { channels: string[] } }).contentDetails.channels;
    expect(listed).toHaveLength(14);
    expect(listed).not.toContain(CHANNELS.es);
    sections = [{ id: 's2', snippet: { type: 'multipleChannels', title: 'Otros canales de LangQuest' } }];
    expect(await setOtherChannels(f, 'at', 'es')).toBe('updated');
    expect(f.calls.at(-1)).toMatchObject({ method: 'PUT', body: { id: 's2' } });
  });
});

describe('Publish', () => {
  it('uploads a video public, not for kids, marked when its voice is a computer\'s, telling subscribers only of a first version', async () => {
    const f = google((c) => {
      if (c.url.startsWith('https://www.googleapis.com/upload/youtube/v3/videos?')) return new Response(null, { status: 200, headers: { location: 'https://upload.example/session/1' } });
      if (c.url === 'https://upload.example/session/1') return Response.json({ id: 'NEWvideo000' });
      return undefined;
    });
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await uploadVideo(f, 'at', { title: 'Grabar un pasaje', description: 'Cómo grabar.', language: 'es', file: { body: bytes, bytes: 3 }, replacing: true, synthetic: true })).toBe('NEWvideo000');
    const [start, put] = f.calls;
    expect(new URL(start!.url).searchParams.get('notifySubscribers')).toBe('false');
    expect(start!.headers['x-upload-content-length']).toBe('3');
    expect(start!.body).toEqual({
      snippet: { title: 'Grabar un pasaje', description: 'Cómo grabar.', categoryId: '27', defaultLanguage: 'es', defaultAudioLanguage: 'es' },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false, containsSyntheticMedia: true, embeddable: true, license: 'youtube' }
    });
    expect(put).toMatchObject({ method: 'PUT', body: bytes });
  });

  it('tells the project\'s day used up from a channel\'s', async () => {
    const f = google(() => Response.json({ error: { code: 400, errors: [{ reason: 'uploadLimitExceeded' }] } }, { status: 400 }));
    const e = await uploadVideo(f, 'at', { title: 't', description: 'd', language: 'en', file: { body: new Uint8Array(1), bytes: 1 }, replacing: false, synthetic: true }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(YouTubeError);
    expect((e as YouTubeError).code).toBe('youtube_uploadLimitExceeded');
    expect(channelFull(e)).toBe(true);
    expect(outOfQuota(e)).toBe(false);
    expect(outOfQuota(new YouTubeError(403, 'quotaExceeded'))).toBe(true);
    expect(channelFull(new YouTubeError(403, 'quotaExceeded'))).toBe(false);
    expect(outOfQuota(new YouTubeError(403, 'forbidden'))).toBe(false);
  });

  it('finds a playlist by its title across pages, and makes it when there is none', async () => {
    const f = google((c) => {
      if (c.url.includes('/playlists?part=snippet&mine=true') && !c.url.includes('pageToken')) return Response.json({ items: [{ id: 'P1', snippet: { title: 'Admins' } }], nextPageToken: 'n2' });
      if (c.url.includes('pageToken=n2')) return Response.json({ items: [{ id: 'P2', snippet: { title: 'Traductores' } }] });
      if (c.method === 'POST' && c.url.includes('/playlists?part=snippet,status')) return Response.json({ id: 'P3' });
      return undefined;
    });
    expect(await playlistFor(f, 'at', 'Traductores', 'es')).toBe('P2');
    expect(await playlistFor(f, 'at', 'Revisores', 'es')).toBe('P3');
    expect(f.calls.at(-1)!.body).toEqual({ snippet: { title: 'Revisores', defaultLanguage: 'es' }, status: { privacyStatus: 'public' } });
  });

  it('puts a new version in the old one\'s place in the playlist, a first version at the end, and the trailer first', async () => {
    const f = google((c) => {
      if (c.method === 'GET' && c.url.includes('/playlistItems?')) return Response.json({ items: [{ id: 'ITEMold', snippet: { position: 4 } }] });
      if (c.method === 'POST' && c.url.includes('/playlistItems?part=snippet')) return Response.json({ id: 'ITEMnew' });
      if (c.method === 'DELETE') return new Response(null, { status: 204 });
      return undefined;
    });
    await placeInPlaylist(f, 'at', 'P2', 'NEWvideo000', 'OLDvideo000');
    expect(f.calls.map((c) => c.method)).toEqual(['GET', 'POST', 'DELETE']);
    expect(f.calls[1]!.body).toEqual({ snippet: { playlistId: 'P2', resourceId: { kind: 'youtube#video', videoId: 'NEWvideo000' }, position: 4 } });
    expect(f.calls[2]!.url).toContain('id=ITEMold');
    f.calls.length = 0;
    await placeInPlaylist(f, 'at', 'P2', 'NEWvideo000');
    expect(f.calls.map((c) => c.method)).toEqual(['POST']);
    expect(f.calls[0]!.body).toEqual({ snippet: { playlistId: 'P2', resourceId: { kind: 'youtube#video', videoId: 'NEWvideo000' } } });
    // The trailer goes first.
    f.calls.length = 0;
    await placeInPlaylist(f, 'at', 'P2', 'NEWvideo000', undefined, true);
    expect(f.calls[0]!.body).toEqual({ snippet: { playlistId: 'P2', resourceId: { kind: 'youtube#video', videoId: 'NEWvideo000' }, position: 0 } });
  });

  it('unlists the old version with a first line to the new one, keeping the rest of it', async () => {
    const old = {
      id: 'OLDvideo000',
      snippet: { title: 'Grabar un pasaje', categoryId: '27', defaultLanguage: 'es', defaultAudioLanguage: 'es', description: 'Cómo grabar.' },
      status: { privacyStatus: 'public', embeddable: true, license: 'youtube', publicStatsViewable: true, selfDeclaredMadeForKids: false, containsSyntheticMedia: true }
    };
    const f = google((c) => {
      if (c.method === 'GET' && c.url.includes('/videos?part=snippet,status&id=OLDvideo000')) return Response.json({ items: [old] });
      if (c.method === 'PUT') return Response.json({ id: 'OLDvideo000' });
      if (c.method === 'GET') return Response.json({ items: [] });
      return undefined;
    });
    expect(await retire(f, 'at', 'OLDvideo000', 'NEWvideo000', 'es')).toBe('unlisted');
    expect(f.calls.at(-1)!.body).toEqual({
      id: 'OLDvideo000',
      snippet: { title: 'Grabar un pasaje', categoryId: '27', defaultLanguage: 'es', defaultAudioLanguage: 'es',
        description: 'Reemplazado por un video más nuevo: https://youtu.be/NEWvideo000\n\nCómo grabar.' },
      status: { privacyStatus: 'unlisted', embeddable: true, license: 'youtube', publicStatsViewable: true, selfDeclaredMadeForKids: false, containsSyntheticMedia: true }
    });
    expect(await retire(f, 'at', 'GONEvideo00', 'NEWvideo000', 'es')).toBe('gone');
  });
});

describe('how a channel looks', () => {
  it('has a description YouTube takes, in every language, naming the app', () => {
    for (const language of Object.keys(CHANNELS) as (keyof typeof CHANNELS)[]) {
      const about = channelAbout(language);
      expect([...about].length).toBeLessThanOrEqual(1000);
      expect(about).not.toMatch(/[<>]/);
      expect(about.endsWith('LangQuest: https://next.langquest.org')).toBe(true);
      // Where every video is, to play or download (decisions.md 187).
      expect(about).toContain(`${WORDS[language].allVideos} https://next.langquest.org/videos?lang=${language}\n`);
      expect(WORDS[language].tagline.length).toBeGreaterThan(0);
    }
  });

  it('has a banner of the size YouTube asks for, in the web app, for every language', () => {
    for (const language of Object.keys(CHANNELS) as (keyof typeof CHANNELS)[]) {
      const png = readFileSync(path.join(__dirname, '..', '..', 'mobile', 'public', ...bannerPath(language).split('/').filter(Boolean)));
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      // Width and height, from the PNG's header: 2560 × 1440, under YouTube's 6 MB.
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([2560, 1440]);
      expect(png.length).toBeLessThan(6 * 1024 * 1024);
    }
  });
});
