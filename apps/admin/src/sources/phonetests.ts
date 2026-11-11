import { hoursAgo, ok, type Alert, type Section } from '../section';
import type { GitHubEnv } from './github';

/**
 * The nightly phone tests (.github/workflows/phone-tests.yml, decision 206):
 * last night's phone flows on an Android emulator and an iPhone simulator,
 * as the run left them in the repository's public `phone-tests` release
 * (scripts/phone-tests.mjs publish): summary.json for the night, history.json
 * for the nights before it, and a picture of each failed screen, which this
 * Worker passes on (`phoneShot`) so the page keeps its own-origin images.
 * The pictures show the test server's made-up people only.
 */

export const PHONE_RELEASE = 'phone-tests';
/** The nightly runs at 08:30 UTC and takes about two hours: a night older than this means it stopped running. */
export const STALE_H = 36;
/** A picture's name, as phone-tests.mjs makes it: the night's day, the phone, the flow. */
export const SHOT_NAME = /^\d{8}-(android|ios)-[a-z0-9-]{1,80}\.png$/;
const WORKFLOW_URL = (repo: string) => `https://github.com/${repo}/actions/workflows/phone-tests.yml`;

export interface PhoneFlow {
  name: string;
  file: string | null;
  passed: boolean;
  seconds: number | null;
  error: string | null;
  /** The picture's name in the release, for a failed flow. */
  shot: string | null;
  /** Claude's sentence on what went wrong, and whether the app, the flow or the machine is to blame. */
  what?: string;
  cause?: 'app' | 'test' | 'machine';
  /** The Linear issue it is filed under (LAN-123), and its address. */
  issue?: string;
  issueUrl?: string;
}

export interface PhonePlatform {
  platform: 'android' | 'ios';
  label: string;
  device: string | null;
  os: string | null;
  status: string;
  broke: string | null;
  issue?: string;
  issueUrl?: string;
  ran: number;
  passed: number;
  failed: number;
  seconds: number | null;
  notRun: { flow: string; why: string }[];
  flows: PhoneFlow[];
}

export interface PhoneNight { at: string; sha: string; url: string; event: string | null; platforms: PhonePlatform[] }
export interface HistoryNight { at: string; sha: string; url: string; platforms: { platform: string; status: string; broke: boolean; ran: number; passed: number; failed: number }[] }

export interface PhoneTests {
  repo: string;
  workflow: string;
  night: PhoneNight | null;
  history: HistoryNight[];
}

interface Release { assets: { name: string; browser_download_url: string }[] }

const isNight = (v: unknown): v is PhoneNight => typeof v === 'object' && v !== null && typeof (v as PhoneNight).at === 'string' && Array.isArray((v as PhoneNight).platforms);

export function phoneAlerts(t: PhoneTests, now = Date.now()): Alert[] {
  if (!t.night) return [];
  const out: Alert[] = [];
  const age = hoursAgo(t.night.at, now);
  if (age !== null && age > STALE_H) {
    out.push({ level: 'watch', text: `The nightly phone tests last reported ${Math.round(age)} h ago: the workflow may have stopped running.`, link: t.workflow });
  }
  for (const p of t.night.platforms) {
    if (p.broke) out.push({ level: 'problem', text: `The ${p.label} phone tests broke: ${p.broke}`, link: t.night.url });
    else if (p.failed) {
      const names = p.flows.filter((f) => !f.passed).slice(0, 3).map((f) => f.name.split(' ')[0]).join(', ');
      out.push({ level: 'problem', text: `${p.failed} of ${p.ran} phone flows failed on the ${p.label} (${names}${p.failed > 3 ? ', …' : ''}).`, link: t.night.url });
    }
  }
  return out;
}

async function release(env: GitHubEnv, fetcher: typeof fetch): Promise<Release | null> {
  const r = await fetcher(`https://api.github.com/repos/${env.GITHUB_REPO}/releases/tags/${PHONE_RELEASE}`, {
    headers: {
      accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'langquest-next-admin',
      ...(env.ADMIN_GITHUB_TOKEN ? { authorization: `Bearer ${env.ADMIN_GITHUB_TOKEN}` } : {})
    },
    signal: AbortSignal.timeout(15_000)
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub phone-tests release: HTTP ${r.status}`);
  return (await r.json()) as Release;
}

const asset = (rel: Release, name: string) => rel.assets.find((a) => a.name === name)?.browser_download_url;

async function json(fetcher: typeof fetch, url: string | undefined): Promise<unknown> {
  if (!url) return null;
  const r = await fetcher(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`GitHub phone-tests file: HTTP ${r.status}`);
  return r.json();
}

export async function phoneTestsSection(env: GitHubEnv, fetcher: typeof fetch = fetch): Promise<Section<PhoneTests>> {
  const workflow = WORKFLOW_URL(env.GITHUB_REPO);
  const rel = await release(env, fetcher);
  if (!rel) return ok({ repo: env.GITHUB_REPO, workflow, night: null, history: [] });
  const [night, history] = await Promise.all([json(fetcher, asset(rel, 'summary.json')), json(fetcher, asset(rel, 'history.json'))]);
  const t: PhoneTests = {
    repo: env.GITHUB_REPO, workflow,
    night: isNight(night) ? night : null,
    history: Array.isArray(history) ? (history as HistoryNight[]).filter((h) => h && typeof h.at === 'string').slice(0, 30) : []
  };
  return ok(t, phoneAlerts(t));
}

/** A failed screen's picture from the release, passed on as PNG; anything else is refused. */
export async function phoneShot(env: GitHubEnv, name: string, fetcher: typeof fetch = fetch): Promise<{ status: number; body?: Uint8Array }> {
  if (!SHOT_NAME.test(name)) return { status: 400 };
  const rel = await release(env, fetcher);
  const url = rel ? asset(rel, name) : undefined;
  if (!url) return { status: 404 };
  const r = await fetcher(url, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) return { status: 502 };
  const body = new Uint8Array(await r.arrayBuffer());
  const png = body.length > 8 && body[0] === 0x89 && body[1] === 0x50 && body[2] === 0x4e && body[3] === 0x47;
  return png ? { status: 200, body } : { status: 415 };
}
