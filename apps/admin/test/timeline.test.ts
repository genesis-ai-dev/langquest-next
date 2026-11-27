import { beforeEach, describe, expect, it } from 'vitest';
import {
  areaOf, areasOf, errorKinds, expoMade, forgetLine, inPhoneApp, issuesOf, lineMerge, peopleLines, placeOnPhones, timelineSection,
  updateKeyTime, versionTime, whoOf, type LineMerge, type PhoneRuns
} from '../src/sources/timeline';
import type { Query } from '../src/db';

const user = (name: string, login = name.toLowerCase()) => ({ __typename: 'User', login, name });
const bot = (login: string) => ({ __typename: 'Bot', login });

describe('what a merge changed', () => {
  it('puts each file in one area and part, by its path', () => {
    expect(areaOf('apps/mobile/src/sync/client.ts')).toEqual(['app', 'Sync and data']);
    expect(areaOf('packages/sync/src/outbox.ts')).toEqual(['app', 'Sync and data']);
    expect(areaOf('apps/mobile/src/screens/Home.tsx')).toEqual(['ui', 'Screens']);
    expect(areaOf('apps/mobile/src/ui/kit.tsx')).toEqual(['ui', 'Kit and theme']);
    expect(areaOf('apps/admin/src/pageReleaseLine.ts')).toEqual(['dashboard', 'Pages']);
    expect(areaOf('apps/admin/src/sources/timeline.ts')).toEqual(['dashboard', 'Dashboard data']);
    expect(areaOf('supabase/migrations/20261126233000_ops_release_line.sql')).toEqual(['backend', 'Database']);
    expect(areaOf('server/releaseLineSmoke.sql')).toEqual(['tests', 'Code tests']);
    expect(areaOf('apps/web/worker/opsActions.ts')).toEqual(['backend', 'Web server']);
    expect(areaOf('e2e/tutorials/record.ts')).toEqual(['videos', 'Video steps']);
    expect(areaOf('scripts/agent-team.mjs')).toEqual(['jobs', 'Agent team']);
    expect(areaOf('.github/workflows/ci.yml')).toEqual(['jobs', 'GitHub workflows']);
    expect(areaOf('apps/admin/test/releaseLine.test.ts')).toEqual(['tests', 'Code tests']);
    expect(areaOf('e2e/ui/11-global-viewer.spec.ts')).toEqual(['tests', 'Screen tests']);
    expect(areaOf('docs/decisions/2026-11-26-release-timeline-on-the-releases-page.md')).toEqual(['docs', 'Decisions']);
    expect(areaOf('apps/mobile/AGENTS.md')).toEqual(['docs', 'Guides and plans']);
  });

  it('lists the area with the most files first, tests and docs last', () => {
    expect(areasOf(['docs/a.md', 'docs/b.md', 'docs/c.md', 'apps/admin/src/page.ts', 'apps/admin/test/x.test.ts'])).toEqual([
      ['dashboard', ['Pages']], ['docs', ['Guides and plans']], ['tests', ['Code tests']]
    ]);
  });

  it('counts a file as the phone app’s when it goes into its bundle or build', () => {
    expect(inPhoneApp('apps/mobile/src/sync/client.ts')).toBe(true);
    expect(inPhoneApp('packages/core/src/fold.ts')).toBe(true);
    expect(inPhoneApp('apps/mobile/test/sync.test.ts')).toBe(false);
    expect(inPhoneApp('apps/admin/src/page.ts')).toBe(false);
    expect(inPhoneApp('apps/mobile/README.md')).toBe(false);
  });
});

describe('who made and merged it', () => {
  it('names the team, the thread or the developer by first name, never a login', () => {
    expect(whoOf('user-issue/LAN-339', bot('claude'), null, '')).toEqual({ kind: 'agent', name: 'Issue fix team', sub: 'Claude wrote it and it merged itself' });
    expect(whoOf('tutorial-fix/abc', bot('claude'), user('Caleb Koster', 'ck'), '').sub).toBe('Claude wrote it; Caleb merged it');
    expect(whoOf('claude/project-thread-x', user('Caleb Koster'), user('Caleb Koster'), 'https://claude.ai/code/session_01AbC'))
      .toEqual({ kind: 'thread', name: 'Claude thread', sub: "Merged with Caleb's account", link: 'https://claude.ai/code/session_01AbC' });
    expect(whoOf('dependabot/npm/x', bot('dependabot'), user('Carl Smith'), '')).toEqual({ kind: 'bot', name: 'Dependabot', sub: 'Carl merged it' });
    expect(whoOf('claude/fix-x', user('Carl Smith'), user('Carl Smith'), '')).toEqual({ kind: 'dev', name: 'Carl', sub: 'Written with Claude Code' });
    expect(JSON.stringify(whoOf('feature/x', user('Carl Smith', 'carl-login'), user('Caleb Koster', 'caleb-login'), ''))).not.toContain('login');
  });
});

describe('the issues it names', () => {
  it('says which it fixes and which it is part of', () => {
    expect(issuesOf('Fix sync (LAN-339)', 'Fixes LAN-339. Part of LAN-148 and LAN-216.', 'claude/x')).toEqual([
      { id: 'LAN-339', r: 'f' }, { id: 'LAN-148', r: 'p' }, { id: 'LAN-216', r: 'p' }
    ]);
    expect(issuesOf('Agent fix', '', 'user-issue/lan-412')).toEqual([{ id: 'LAN-412', r: 'f' }]);
    expect(issuesOf('Docs', 'No issue here.', 'docs/x')).toEqual([]);
  });

  it('takes what people see from its section, else its summary, as plain lines', () => {
    expect(peopleLines('## Summary\nx\n\n## What people see\n1. Sync starts **again** by itself.\n2. A [link](https://x) stays.\n\n## Tests\n- y')).toEqual(['Sync starts again by itself.', 'A link stays.']);
    expect(peopleLines('')).toEqual([]);
  });
});

describe('versions and update times', () => {
  it('reads the merge time a store version names, and the time in an update id', () => {
    expect(versionTime('2026.1121.2103 (79)')).toBe(Date.parse('2026-11-21T21:03:00Z'));
    expect(versionTime('2026.105.905')).toBe(Date.parse('2026-01-05T09:05:00Z'));
    expect(versionTime('1.0.3')).toBeNull();
    const t = Date.parse('2026-11-26T20:00:00Z');
    expect(Math.abs(updateKeyTime(Math.floor(t / 65_536).toString(16).padStart(8, '0'))! - t)).toBeLessThan(65_536);
    expect(updateKeyTime('embedded')).toBeNull();
  });
});

const merge = (n: number, t: string, app = true): LineMerge => ({
  n, s: `sha${n}`.padEnd(40, '0'), t, ti: `Change ${n}`, w: { kind: 'dev', name: 'Carl', sub: '' }, ar: [['app', ['Sync and data']]], nf: 1, op: t, ws: t, ...(app ? { app: 1 as const } : {})
});

describe('where each merge reached', () => {
  it('marks the first iPhone and Android run of a bundle that holds the merge, and only runs after it', () => {
    const a = merge(1, '2026-11-24T10:00:00Z'), b = merge(2, '2026-11-24T12:00:00Z'), c = merge(3, '2026-11-24T13:00:00Z', false);
    const expo = { updates: [{ key: 'aaaaaaaa', os: 'ios', at: '2026-11-24T12:10:00Z', sha: b.s }, { key: 'bbbbbbbb', os: 'android', at: '2026-11-24T12:10:00Z', sha: b.s }], builds: [{ os: 'ios', at: '2026-11-24T10:30:00Z', build: '80', sha: a.s }] };
    const runs: PhoneRuns = {
      updates: [['aaaaaaaa', 'ios', '2026-11-24T12:40:00Z', 3], ['bbbbbbbb', 'android', '2026-11-24T13:20:00Z', 1]],
      builds: [['ios', '2026.1124.1000', '2026-11-24T11:00:00Z', 1]], hours: [], days: []
    };
    placeOnPhones([a, b, c], expo, runs);
    expect([a.i, a.a, a.sb]).toEqual(['2026-11-24T11:00:00.000Z', '2026-11-24T13:20:00.000Z', { ios: '80' }]);
    expect([b.i, b.a, b.up]).toEqual(['2026-11-24T12:40:00.000Z', '2026-11-24T13:20:00.000Z', { ios: '2026-11-24T12:10:00Z', android: '2026-11-24T12:10:00Z' }]);
    expect([c.i, c.a]).toEqual([undefined, undefined]);
  });

  it('dates an update Expo did not name by its id, 15 minutes before it was made', () => {
    const m = merge(4, '2026-11-24T10:00:00Z');
    const made = Date.parse('2026-11-24T10:20:00Z');
    placeOnPhones([m], null, { updates: [[Math.floor(made / 65_536).toString(16).padStart(8, '0'), 'ios', '2026-11-24T10:30:00Z', 1]], builds: [], hours: [], days: [] });
    expect(m.i).toBe('2026-11-24T10:30:00.000Z');
  });
});

describe('failures each hour', () => {
  it('makes one series for each kind of failure, a day before diag.hourly’s days over its 24 hours, and a keyed total only once', () => {
    const h0 = Date.parse('2026-11-01T00:00:00Z');
    const kinds = errorKinds({ updates: [], builds: [], days: [['2026-11-01', 'jobs', 'failed', 'daily_snapshot', 3]],
      hours: [['2026-11-20T05:00:00+00:00', 'clients', 'shown_failures', 'sync:SyncError:E1', 4], ['2026-11-20T05:00:00+00:00', 'clients', 'shown_failures', '', 4], ['2026-11-20T06:00:00+00:00', 'worker', 'server_errors', 'blobs_get', 2]] }, h0);
    expect(kinds.map((k) => [k.id, k.label, k.total, k.s])).toEqual(expect.arrayContaining([
      ['jobs.failed.daily_snapshot', 'Daily snapshot', 3, [[0, 3, 24]]],
      ['clients.shown_failures.sync:SyncError:E1', 'sync · SyncError · E1', 4, [[461, 4, 1]]],
      ['worker.server_errors.blobs_get', 'File downloads', 2, [[462, 2, 1]]]
    ]));
    expect(kinds).toHaveLength(3);
  });
});

describe('the answer', () => {
  beforeEach(() => forgetLine());
  const now = Date.parse('2026-11-26T20:00:00Z');
  const pull = (n: number, mergedAt: string, files: string[], extra: Record<string, unknown> = {}) => ({
    number: n, title: `Change ${n}`, body: `Fixes LAN-${n}.`, createdAt: '2026-11-25T10:00:00Z', mergedAt, headRefName: `claude/x-${n}`, changedFiles: files.length,
    mergeCommit: { oid: `m${n}`.padEnd(40, '0') }, author: user('Carl Smith'), mergedBy: user('Carl Smith'),
    files: { nodes: files.map((path) => ({ path })) }, commits: { nodes: [{ commit: { authoredDate: '2026-11-25T08:00:00Z' } }] }, ...extra
  });
  const env = { GITHUB_REPO: 'genesis-ai-dev/langquest-next', ADMIN_GITHUB_TOKEN: 'gh', APP_URL: 'https://next.example', ADMIN_EXPO_TOKEN: 'ex', EXPO_PROJECT_ID: 'p' };

  it('needs the GitHub token, which GitHub’s search asks for', async () => {
    const s = await timelineSection({ ...env, ADMIN_GITHUB_TOKEN: undefined }, async () => new Response('{}'), now);
    expect(s.state).toBe('off');
  });

  it('reads the merges, where each reached and the failures, and says what it could not read', async () => {
    const searches: string[] = [];
    const fetcher = (async (url: string, init?: RequestInit) => {
      if (url === 'https://api.github.com/graphql') {
        const q = JSON.parse(String(init!.body)).variables.q as string;
        searches.push(q);
        const nodes = q.endsWith('2026-11-26') ? [pull(725, '2026-11-26T19:00:00Z', ['apps/admin/src/page.ts']), pull(716, '2026-11-26T15:00:00Z', ['packages/sync/src/client.ts'])] : [];
        return Response.json({ data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } });
      }
      if (url === 'https://api.expo.dev/graphql') return new Response('no', { status: 502 });
      if (url === 'https://next.example/version.json') return Response.json({ build: `m725`.padEnd(12, '0') });
      throw new Error(url);
    }) as typeof fetch;
    const diag = async <T>(fn: (q: Query) => Promise<T>) => fn((async () => ({ updates: [], builds: [['android', '2026.1126.1500', '2026-11-26T15:30:00Z', 2]], hours: [['2026-11-26T16:00:00+00:00', 'clients', 'errors', '', 9]], days: [] })) as Query);
    const s = await timelineSection(env, fetcher, now, diag);
    expect(s.state).toBe('ok');
    const d = s.data!;
    expect(d.merges.map((m) => m.n)).toEqual([716, 725]);
    expect(d.merges[0]).toMatchObject({ app: 1, a: '2026-11-26T15:30:00.000Z', is: [{ id: 'LAN-716', r: 'f' }], ws: '2026-11-25T08:00:00.000Z' });
    expect(d.merges[1]!.app).toBeUndefined();
    expect(d.web).toEqual({ sha: 'm72500000000', n: 725 });
    expect(d.errors).toHaveLength(1);
    expect(d.notes).toEqual(['Expo: Expo: HTTP 502']);
    // One search for each five days, side by side, over the last 30 and today.
    expect(searches).toHaveLength(7);
    expect(searches.at(-1)).toMatch(/merged:2026-11-26\.\.2026-11-26$/);
    expect(searches.every((q) => q.startsWith('repo:genesis-ai-dev/langquest-next is:pr is:merged base:main merged:'))).toBe(true);
  });

  it('keeps what GitHub said: within six hours it reads only the last day again', async () => {
    let calls = 0;
    const fetcher = (async (url: string) => {
      if (url === 'https://api.github.com/graphql') { calls++; return Response.json({ data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } }); }
      return new Response('no', { status: 404 });
    }) as typeof fetch;
    const diag = async <T>(fn: (q: Query) => Promise<T>) => fn((async () => null) as Query);
    await timelineSection(env, fetcher, now, diag);
    const first = calls;
    await timelineSection(env, fetcher, now + 60_000, diag);
    expect(first).toBe(7);
    expect(calls - first).toBe(1);
  });

  it('turns a pull request into a merge with short keys, and leaves out one that did not merge', () => {
    expect(lineMerge({ ...pull(1, '2026-11-26T10:00:00Z', []), mergeCommit: null })).toBeNull();
    const m = lineMerge(pull(2, '2026-11-26T10:00:00Z', ['apps/mobile/src/a.ts', 'supabase/migrations/20261126100000_x.sql']))!;
    expect(m).toMatchObject({ n: 2, mg: ['20261126100000'], app: 1, nf: 2, ar: [['app', ['Other app code']], ['backend', ['Database']]] });
  });

  it('keeps only production updates and finished production builds from Expo', () => {
    const made = expoMade({ data: { app: { byId: {
      updateBranches: [{ name: 'production', updateGroups: [[{ id: '0193abcd-x', platform: 'IOS', createdAt: 'a', gitCommitHash: 's1' }]] }, { name: 'preview', updateGroups: [[{ id: 'ffffffff-y', platform: 'IOS', createdAt: 'b' }]] }],
      builds: [{ platform: 'ANDROID', status: 'FINISHED', createdAt: 'c', appBuildVersion: '68', gitCommitHash: 's2', buildProfile: 'production' }, { platform: 'IOS', status: 'ERRORED', createdAt: 'd', appBuildVersion: '81', gitCommitHash: 's3', buildProfile: 'production' }]
    } } } });
    expect(made).toEqual({ updates: [{ key: '0193abcd', os: 'ios', at: 'a', sha: 's1' }], builds: [{ os: 'android', at: 'c', build: '68', sha: 's2' }] });
  });
});
