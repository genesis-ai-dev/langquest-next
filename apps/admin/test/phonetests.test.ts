import { describe, expect, it, vi } from 'vitest';
import { phoneAlerts, phoneShot, phoneTestsSection, type PhoneNight, type PhoneTests } from '../src/sources/phonetests';
import { handle } from '../src/index';
import type { Env } from '../src/env';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const hAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const env = { GITHUB_REPO: 'genesis-ai-dev/langquest-next' };
const RELEASE = 'https://api.github.com/repos/genesis-ai-dev/langquest-next/releases/tags/phone-tests';
const DL = 'https://github.com/genesis-ai-dev/langquest-next/releases/download/phone-tests/';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function night(over: Partial<PhoneNight['platforms'][number]> = {}, at = hAgo(3)): PhoneNight {
  return {
    at, sha: 'abc1234', url: 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/1', event: 'schedule',
    platforms: [{
      platform: 'android', label: 'Android emulator', device: 'pixel_6', os: 'Android 15', status: 'success', broke: null,
      ran: 2, passed: 2, failed: 0, seconds: 300, notRun: [], flows: [
        { name: 'AUTH-001 sign in', file: 'auth-001.yaml', passed: true, seconds: 40, error: null, shot: null },
        { name: 'REC-002 record a part', file: 'rec-002.yaml', passed: true, seconds: 60, error: null, shot: null }
      ],
      ...over
    }]
  };
}

const tests = (n: PhoneNight | null): PhoneTests => ({ repo: env.GITHUB_REPO, workflow: 'w', night: n, history: [] });

/** A fetch that answers the release, its JSON files and its pictures. */
function github(files: Record<string, unknown>, release: number = 200): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === RELEASE) {
      if (release !== 200) return new Response('{}', { status: release });
      return Response.json({ assets: Object.keys(files).map((name) => ({ name, browser_download_url: DL + name })) });
    }
    const name = url.startsWith(DL) ? url.slice(DL.length) : '';
    if (!(name in files)) return new Response('not found', { status: 404 });
    const body = files[name];
    return body instanceof Uint8Array ? new Response(body) : Response.json(body);
  }) as unknown as typeof fetch;
}

describe('phone test alerts', () => {
  it('says nothing for a green night, or before the first night', () => {
    expect(phoneAlerts(tests(night()), NOW)).toEqual([]);
    expect(phoneAlerts(tests(null), NOW)).toEqual([]);
  });

  it('names the first failed flows, linked to the run', () => {
    const n = night({ ran: 5, passed: 1, failed: 4, flows: ['A-1 a', 'B-2 b', 'C-3 c', 'D-4 d'].map((name) => ({ name, file: null, passed: false, seconds: 1, error: 'x', shot: null })) });
    expect(phoneAlerts(tests(n), NOW)).toEqual([{ level: 'problem', text: '4 of 5 phone flows failed on the Android emulator (A-1, B-2, C-3, …).', link: n.url }]);
  });

  it('says when the run itself broke, and when the nightly stopped reporting', () => {
    const texts = phoneAlerts(tests(night({ broke: 'The app did not build.' }, hAgo(50))), NOW).map((a) => `${a.level} ${a.text}`);
    expect(texts).toEqual([
      'watch The nightly phone tests last reported 50 h ago: the workflow may have stopped running.',
      'problem The Android emulator phone tests broke: The app did not build.'
    ]);
  });
});

describe('the phone tests section', () => {
  it('shows no night before the release exists', async () => {
    const s = await phoneTestsSection(env, github({}, 404));
    expect(s).toMatchObject({ state: 'ok', data: { night: null, history: [] } });
  });

  it('reads the night and the history from the release', async () => {
    const n = night({ failed: 1, passed: 1, flows: [{ name: 'REC-002 record a part', file: 'rec-002.yaml', passed: false, seconds: 9, error: 'not visible', shot: '20261112-android-rec-002-record-a-part.png' }] });
    const history = [{ at: n.at, sha: n.sha, url: n.url, platforms: [] }, { nonsense: true }];
    const s = await phoneTestsSection(env, github({ 'summary.json': n, 'history.json': history }));
    expect(s.data?.night?.platforms[0]?.flows[0]?.shot).toBe('20261112-android-rec-002-record-a-part.png');
    expect(s.data?.history).toHaveLength(1);
    expect(s.data?.workflow).toBe('https://github.com/genesis-ai-dev/langquest-next/actions/workflows/phone-tests.yml');
    expect(s.alerts[0]).toMatchObject({ level: 'problem', text: expect.stringContaining('1 of 2 phone flows failed') });
  });

  it('fails the section when GitHub fails, so the page says so', async () => {
    await expect(phoneTestsSection(env, github({}, 500))).rejects.toThrow('HTTP 500');
  });
});

describe('a failed screen', () => {
  const name = '20261112-ios-auth-001-sign-in.png';

  it('passes on a PNG from the release', async () => {
    expect(await phoneShot(env, name, github({ [name]: PNG }))).toEqual({ status: 200, body: PNG });
  });

  it('refuses names the nightly never makes, before asking GitHub', async () => {
    const fetcher = github({});
    for (const bad of ['../summary.json', 'summary.json', '20261112-web-x.png', '20261112-ios-X.png', '20261112-ios-a.png.exe']) {
      expect((await phoneShot(env, bad, fetcher)).status).toBe(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('answers 404 for a picture that is gone, and 415 for a file that is not a PNG', async () => {
    expect((await phoneShot(env, name, github({}))).status).toBe(404);
    expect((await phoneShot(env, name, github({ [name]: new TextEncoder().encode('<html>not a picture</html>') }))).status).toBe(415);
  });

  it('needs the sign-in, like every other part of the page', async () => {
    const e = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon', GITHUB_REPO: env.GITHUB_REPO } as unknown as Env;
    expect((await handle(new Request(`https://next.langquest.org/ops/api/phonetests/shot/${name}`), e)).status).toBe(401);
  });
});
