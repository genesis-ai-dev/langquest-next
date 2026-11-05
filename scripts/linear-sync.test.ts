import {
  deploying,
  isRevert,
  issueIds,
  lanesFor,
  mayMove,
  progress,
  reportLane,
  verdict
} from './linear-sync.mjs';

// The sync exists so an issue's status says where its change really is. These
// tests hold the rules that keep it honest: an issue is never Live before every
// lane it touched has shipped, a failed lane is never hidden, and a late or
// repeated report cannot reopen finished work.

type Issue = { id: string; identifier: string; state: string; comments: string[] };

function fakeLinear(issues: Issue[]) {
  const api = {
    moves: [] as string[],
    getIssue: async (id: string) => issues.find((i) => i.identifier === id) ?? null,
    listDeploying: async () => issues.filter((i) => i.state === 'Deploying'),
    comments: async (id: string) => issues.find((i) => i.id === id)!.comments,
    comment: async (id: string, body: string) => {
      issues.find((i) => i.id === id)!.comments.push(body);
    },
    setState: async (issue: Issue, name: string) => {
      issues.find((i) => i.id === issue.id)!.state = name;
      api.moves.push(`${issue.identifier}:${name}`);
    }
  };
  return api;
}
const issue = (identifier: string, state = 'In Progress'): Issue => ({
  id: identifier,
  identifier,
  state,
  comments: []
});
const SHA = 'abc1234def5678';

describe('issue ids in commit messages', () => {
  it('finds each team id once, in any case', () => {
    expect(issueIds('Fix sync (lan-3), refs LAN-12 and LAN-3')).toEqual(['LAN-3', 'LAN-12']);
  });

  it('ignores another team, so the older app’s LQ ids never move this board', () => {
    expect(issueIds('LQ-49 and LAN-7, also XLAN-9')).toEqual(['LAN-7']);
  });

  it('knows a revert, which must not read as shipped work', () => {
    expect(isRevert('Revert "Send a new account to no-org (LAN-4)"')).toBe(true);
    expect(isRevert('Send a new account to no-org (LAN-4)')).toBe(false);
  });
});

describe('lanes a push reaches', () => {
  it('ships nothing for docs alone', () => {
    expect(lanesFor(['docs/decisions.md', 'README.md', 'apps/mobile/README.md'])).toEqual([]);
  });

  it('reaches both stores for app code and the packages it builds from', () => {
    expect(lanesFor(['apps/mobile/src/screens/work.tsx'])).toEqual(['ios', 'android']);
    expect(lanesFor(['packages/core/src/reducer.ts'])).toEqual(['ios', 'android']);
  });

  it('does not rebuild the app for its own workflow file', () => {
    expect(lanesFor(['apps/mobile/.eas/workflows/deploy-to-testers.yml'])).toEqual([]);
  });

  it('does not track what Cloudflare or Supabase deploy on their own', () => {
    expect(lanesFor(['apps/invite-email/src/index.ts', 'apps/web/src/main.tsx', 'supabase/migrations/1.sql'])).toEqual([]);
  });
});

describe('transitions never go backward or reopen', () => {
  it('refuses to touch canceled or duplicate work', () => {
    expect(mayMove('Canceled', 'Deploying')).toBe(false);
    expect(mayMove('Duplicate', 'Live')).toBe(false);
  });

  it('allows Outage only for work that was shipping or shipped', () => {
    expect(mayMove('Deploying', 'Outage')).toBe(true);
    expect(mayMove('Live', 'Outage')).toBe(true);
    expect(mayMove('In Progress', 'Outage')).toBe(false);
  });

  it('lets a fix push take an Outage issue back to Deploying', () => {
    expect(mayMove('Outage', 'Deploying')).toBe(true);
  });
});

describe('a push, lane by lane', () => {
  const commits = [{ sha: SHA, message: 'Handle empty org (LAN-5)' }];

  it('moves a named issue to Deploying and lists the lanes it waits on', async () => {
    const api = fakeLinear([issue('LAN-5')]);
    await deploying(api, commits, ['apps/mobile/src/a.ts']);
    expect(api.moves).toEqual(['LAN-5:Deploying']);
    const [comment] = await api.comments('LAN-5');
    expect(progress([comment], SHA).lanes).toEqual(['ios', 'android']);
  });

  it('is Live only when every lane has reported ok', async () => {
    const issues = [issue('LAN-5')];
    const api = fakeLinear(issues);
    await deploying(api, commits, ['apps/mobile/src/a.ts']);

    await reportLane(api, { name: 'ios', sha: SHA, status: 'ok' });
    expect(issues[0].state).toBe('Deploying');

    await reportLane(api, { name: 'android', sha: SHA, status: 'ok' });
    expect(issues[0].state).toBe('Live');
  });

  it('goes to Outage on a failed lane without waiting for the others', async () => {
    const issues = [issue('LAN-5')];
    const api = fakeLinear(issues);
    await deploying(api, commits, ['apps/mobile/src/a.ts']);
    await reportLane(api, { name: 'ios', sha: SHA, status: 'failed', url: 'https://eas/run/1' });
    expect(issues[0].state).toBe('Outage');
    expect(issues[0].comments.join('\n')).toContain('https://eas/run/1');
  });

  it('goes to Outage when a gate that is not a lane fails, such as the checks', async () => {
    const issues = [issue('LAN-5')];
    const api = fakeLinear(issues);
    await deploying(api, commits, ['apps/mobile/src/a.ts']);
    await reportLane(api, { name: 'checks', sha: SHA, status: 'failed' });
    expect(issues[0].state).toBe('Outage');
  });

  it('ignores a report for a push the issue is not waiting on', async () => {
    const issues = [issue('LAN-5')];
    const api = fakeLinear(issues);
    await deploying(api, commits, ['apps/mobile/src/a.ts']);
    await reportLane(api, { name: 'ios', sha: 'ffff000aaaa', status: 'failed' });
    expect(issues[0].state).toBe('Deploying');
  });

  it('goes straight to Live when no lane was touched', async () => {
    const api = fakeLinear([issue('LAN-6')]);
    await deploying(api, [{ sha: SHA, message: 'Note the flags plan (LAN-6)' }], ['docs/decisions.md']);
    expect(api.moves).toEqual(['LAN-6:Live']);
  });

  it('puts a reverted issue in Outage and does not also mark it Deploying', async () => {
    const api = fakeLinear([issue('LAN-5', 'Live')]);
    await deploying(
      api,
      [{ sha: SHA, message: 'Revert "Handle empty org (LAN-5)"' }],
      ['apps/mobile/src/a.ts']
    );
    expect(api.moves).toEqual(['LAN-5:Outage']);
  });

  it('leaves a canceled issue alone even if a commit names it', async () => {
    const api = fakeLinear([issue('LAN-9', 'Canceled')]);
    await deploying(api, [{ sha: SHA, message: 'Oops (LAN-9)' }], ['apps/mobile/src/a.ts']);
    expect(api.moves).toEqual([]);
  });

  it('skips an id that is not an issue instead of failing the deploy', async () => {
    const api = fakeLinear([]);
    await expect(
      deploying(api, [{ sha: SHA, message: 'Typo (LAN-999)' }], ['apps/mobile/src/a.ts'])
    ).resolves.toEqual(['LAN-999 not found']);
  });
});

describe('verdict', () => {
  it('waits while a lane has not reported, and is unknown without a Deploying comment', () => {
    expect(verdict({ lanes: ['ios', 'android'], reported: { ios: 'ok' } })).toBe('waiting');
    expect(verdict({ lanes: null, reported: {} })).toBe('unknown');
  });
});
