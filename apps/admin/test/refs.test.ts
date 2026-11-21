import { describe, expect, it, vi } from 'vitest';
import { page } from '../src/page';
import { REF_LOGIC } from '../src/pageRefs';
import { askedNumbers, forgetPrs, plainTitle, prInfo, prInfos, prSummary, PRS_MAX } from '../src/sources/prs';

// What "PR 596" and "LAN-316" are about, in a box over the number (pageRefs.ts, sources/prs.ts).

type Says = { kind: string; title: string; summary?: string; state?: { dot: string; text: string } | null; url: string };
const logic = new Function(`${REF_LOGIC}; return { refsIn, refAgo, refSays };`)() as {
  refsIn: (text: string) => { ref: string; start: number; end: number }[];
  refAgo: (iso: string, now: number) => string;
  refSays: (ref: string, prs: Record<number, unknown>, ud: unknown, fixes: unknown[], now: number) => Says;
};
const NOW = Date.parse('2026-11-21T01:00:00Z');
const pull = (o: object) => ({ number: 596, title: 't', body: null, state: 'closed', merged_at: '2026-11-21T00:00:00Z', closed_at: '2026-11-21T00:00:00Z', created_at: '2026-11-20T20:00:00Z', ...o });

describe('a pull request in plain words', () => {
  it('drops the branch, the numbers and the Linear ids from a title', () => {
    expect(plainTitle('release/ios: Choosing study guides no longer slows the app (LAN-316) (#596)')).toBe('Choosing study guides no longer slows the app');
    expect(plainTitle('LAN-232: New language starts on Whole Bible')).toBe('New language starts on Whole Bible');
    expect(plainTitle('Fix: the web app shows "could not open its storage"')).toBe('Fix: the web app shows "could not open its storage"');
  });

  it('takes the start of "What people see", without the attribution lines', () => {
    const body = '<!-- claude-projects-attribution: {} -->\n_Requested by **Caleb** · [project thread](https://x)_\n\n## What people see\n\n1. A person opens LangQuest in a **browser**.\n2. The page reloads.\n\n## Why\n\nStorage.';
    expect(prSummary(body)).toBe('1. A person opens LangQuest in a browser.\n2. The page reloads.');
  });

  it('prefers a "Plain words:" line, and leaves out the numbers a first paragraph starts with', () => {
    expect(prSummary('Some intro.\n\nPlain words: The app opens faster.')).toBe('The app opens faster.');
    expect(prSummary('Part of LAN-316. A follow-up to #591: the guide was slow.\n\n## Measured first\n\n| a |')).toBe('The guide was slow.');
    expect(prSummary(null)).toBeNull();
    expect(prSummary('```\ncode\n```')).toBeNull();
  });

  it('cuts a long text at a word', () => {
    const s = prSummary('## What people see\n\n' + 'word '.repeat(200))!;
    expect(s.length).toBeLessThanOrEqual(361);
    expect(s.endsWith('word…')).toBe(true);
  });

  it('knows a copy onto a release branch and the pull request on main it carries', () => {
    const info = prInfo(pull({ number: 597, title: 'release/ios: Study guides (#596)', body: 'Copies:\n\n- ' + 'a'.repeat(40) + ' #596 Study guides\n', state: 'open', merged_at: null, closed_at: null }));
    expect(info).toMatchObject({ number: 597, title: 'Study guides', summary: null, state: 'open', copyFor: 'ios', copyOf: 596 });
    expect(prInfo(pull({ state: 'closed', merged_at: null })).state).toBe('closed');
  });

  it('takes only whole numbers, each once, and at most PRS_MAX', () => {
    expect(askedNumbers('596, 592,596')).toEqual([596, 592]);
    expect(askedNumbers('596,x')).toBeNull();
    expect(askedNumbers('')).toBeNull();
    expect(askedNumbers(Array.from({ length: PRS_MAX + 1 }, (_, i) => i + 1).join(','))).toBeNull();
  });

  it('reads a merged one once, an open one again after 5 minutes, and says null for one GitHub does not know', async () => {
    forgetPrs();
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const n = Number(/pulls\/(\d+)$/.exec(String(url))![1]);
      if (n === 1) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(pull({ number: n, title: `T${n}`, state: n === 3 ? 'open' : 'closed', merged_at: n === 3 ? null : '2026-11-21T00:00:00Z' })), { status: 200 });
    });
    const env = { GITHUB_REPO: 'o/r' };
    const first = await prInfos(env, [1, 2, 3], fetcher as unknown as typeof fetch, NOW);
    expect(first[1]).toBeNull();
    expect(first[2]).toMatchObject({ title: 'T2', state: 'merged' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    await prInfos(env, [1, 2, 3], fetcher as unknown as typeof fetch, NOW + 60_000);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await prInfos(env, [1, 2, 3], fetcher as unknown as typeof fetch, NOW + 6 * 60_000);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('leaves out one that could not be read now, so the page asks again', async () => {
    forgetPrs();
    const fetcher = vi.fn(async () => new Response('{}', { status: 502 }));
    expect(await prInfos({ GITHUB_REPO: 'o/r' }, [9], fetcher as unknown as typeof fetch, NOW)).toEqual({});
  });
});

describe('the box over a number', () => {
  it('finds PR and LAN numbers in a text', () => {
    const text = 'Copy PR 597 sends PR #596 (LAN-316) and pull request 12.';
    expect(logic.refsIn(text).map((r) => [r.ref, text.slice(r.start, r.end)])).toEqual([
      ['pr:597', 'PR 597'], ['pr:596', 'PR #596'], ['lan:LAN-316', 'LAN-316'], ['pr:12', 'pull request 12']
    ]);
    expect(logic.refsIn('APR 5 and LAN-x')).toEqual([]);
  });

  it('says a pull request\'s title, its plain lines and whether it merged', () => {
    const prs = { 596: { number: 596, title: 'Study guides no longer slow the app', summary: 'The app is fast.', state: 'merged', at: '2026-11-20T22:00:00Z', copyFor: null, copyOf: null } };
    expect(logic.refSays('pr:596', prs, null, [], NOW)).toEqual({
      kind: 'Pull request 596', title: 'Study guides no longer slow the app', summary: 'The app is fast.',
      state: { dot: 'merged', text: 'Merged 3 h ago' }, url: 'https://github.com/genesis-ai-dev/langquest-next/pull/596'
    });
    expect(logic.refSays('pr:7', {}, null, [], NOW).title).toBe('Loading…');
    expect(logic.refSays('pr:7', { 7: null }, null, [], NOW).title).toBe('GitHub does not know this pull request.');
  });

  it('says what a copy is: the same change, sent to the store app as an update', () => {
    const prs = {
      596: { number: 596, title: 'Study guides', summary: 'The app is fast.', state: 'merged', at: null, copyFor: null, copyOf: null },
      597: { number: 597, title: 'Study guides', summary: null, state: 'open', at: null, copyFor: 'ios', copyOf: 596 }
    };
    const s = logic.refSays('pr:597', prs, null, [], NOW);
    expect(s.kind).toBe('Copy PR 597');
    expect(s.summary).toBe('The same change as PR 596, sent as an update to the iPhone app people have from the App Store.\nThe app is fast.');
    expect(s.state).toEqual({ dot: 'open', text: 'Open: not merged yet' });
  });

  it('says a Linear issue\'s title and words from the watch, and its fix', () => {
    const ud = { issues: [{ issue: 'LAN-316', title: 'Study guides slow the app (LAN-316)', state: 'In Progress', closedAt: null, problem: 'Opening a passage takes seconds.', solution: 'Look up fewer guides.' }] };
    const s = logic.refSays('lan:LAN-316', {}, ud, [{ number: 596, title: 'Study guides no longer slow the app (LAN-316)', state: 'merged', issues: ['LAN-316'] }], NOW);
    expect(s).toMatchObject({
      kind: 'Linear issue LAN-316', title: 'Study guides slow the app',
      summary: 'Opening a passage takes seconds.\nFix: Look up fewer guides.\nFixed in PR 596 "Study guides no longer slow the app"',
      state: { dot: 'open', text: 'Linear: In Progress' }, url: 'https://linear.app/frontierrandd/issue/LAN-316'
    });
  });

  it('takes a Linear issue\'s title from the pull request that names it when the watch has none', () => {
    const s = logic.refSays('lan:LAN-284', {}, null, [{ number: 509, title: 'iPhone flows wait for the passage (LAN-284, LAN-287)', state: 'open', issues: ['LAN-284', 'LAN-287'] }], NOW);
    expect([s.title, s.summary]).toEqual(['iPhone flows wait for the passage', 'Fix waits on merge: PR 509']);
    expect(logic.refSays('lan:LAN-1', {}, null, [], NOW).title).toBe('Open it in Linear for its title.');
  });

  it('is part of the page', async () => {
    const html = await page({ supabaseUrl: 'https://x.supabase.co', anonKey: 'k' }, 'n').text();
    expect(html).toContain('function refWrap(');
    expect(html).toContain('/ops/api/prs?n=');
  });
});
