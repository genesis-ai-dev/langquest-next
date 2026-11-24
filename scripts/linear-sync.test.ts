import {
  askedChanges,
  deploying,
  isRevert,
  issueIds,
  lanesFor,
  mayMove,
  progress,
  reportLane,
  makeAsked,
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

  it('is Live when a later push that holds the waited push ships the lane its own build never did', async () => {
    const issues = [issue('LAN-5')];
    const api = fakeLinear(issues);
    await deploying(api, commits, ['apps/mobile/src/a.ts']);
    await reportLane(api, { name: 'android', sha: SHA, status: 'ok' });
    const LATER = 'f'.repeat(40);
    // A checkout that cannot tell says no: still waiting.
    await reportLane(api, { name: 'ios', sha: LATER, status: 'ok' });
    expect(issues[0].state).toBe('Deploying');
    // A failure of the later push says nothing about the earlier one.
    await reportLane(api, { name: 'ios', sha: LATER, status: 'failed' }, () => true);
    expect(issues[0].state).toBe('Deploying');
    await reportLane(api, { name: 'ios', sha: LATER, status: 'ok' }, (earlier, later) => SHA.startsWith(earlier) && later === LATER);
    expect(issues[0].state).toBe('Live');
    expect(issues[0].comments.at(-1)).toBe(`Lane ios ok · ${SHA.slice(0, 7)} · in fffffff`);
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

// An admin tells Claude on the ops dashboard what to change in Linear
// (docs/decisions/2026-11-24-dashboard-claude-changes-linear-from-any-card.md).
// Claude reads the meaning and names the changes; these rules decide what is made.
describe('changes in Linear an admin asks for', () => {
  const STATES = { Backlog: 's1', Todo: 's2', Live: 's3', Canceled: 's4', Deploying: 's5' };
  const issue = () => ({ id: 'u1', identifier: 'LAN-256', state: 'Backlog', states: STATES, comments: [] as string[], fields: {} as Record<string, unknown> });
  const fake = (issues: ReturnType<typeof issue>[]) => ({
    getIssue: async (id: string) => issues.find((i) => i.identifier === id) ?? null,
    setState: async (i: ReturnType<typeof issue>, name: string) => { i.state = name; },
    update: async (id: string, input: Record<string, unknown>) => { Object.assign(issues.find((i) => i.id === id)!.fields, input); },
    comment: async (id: string, body: string) => { issues.find((i) => i.id === id)!.comments.push(body); }
  });

  it('keeps only one known change for each entry, never a deploy status', () => {
    expect(askedChanges([
      { issue: 'lan-256', status: 'canceled' },
      { issue: 'LAN-256', status: 'Deploying' },
      { issue: 'LAN-256', status: 'Outage' },
      { issue: 'LAN-256', priority: 2 },
      { issue: 'LAN-256', priority: 7 },
      { issue: 'OTHER-1', status: 'Live' },
      { issue: 'LAN-256', title: '  New   title ' },
      { issue: 'LAN-256', comment: 'x'.repeat(1200) },
      null
    ])).toEqual([
      { issue: 'LAN-256', status: 'canceled' },
      { issue: 'LAN-256', priority: 2 },
      { issue: 'LAN-256', title: 'New title' },
      { issue: 'LAN-256', comment: 'x'.repeat(999) + '…' }
    ]);
    expect(askedChanges(Array(9).fill({ issue: 'LAN-1', priority: 1 }))).toHaveLength(5);
    expect(askedChanges('close it')).toEqual([]);
  });

  it('sets the status by the team\'s name, with a comment that says an admin asked', async () => {
    const i = issue();
    const said = await makeAsked(fake([i]), [{ issue: 'LAN-256', status: 'canceled' }], 'https://run');
    expect(said).toEqual(['I set LAN-256 to Canceled in Linear.']);
    expect(i.state).toBe('Canceled');
    expect(i.comments).toEqual(['Set to Canceled by Claude, as an admin asked on the ops dashboard.\n\nhttps://run']);
  });

  it('sets the priority and title, and adds a comment', async () => {
    const i = issue();
    const said = await makeAsked(fake([i]), [{ issue: 'LAN-256', priority: 1 }, { issue: 'LAN-256', title: 'T' }, { issue: 'LAN-256', comment: 'C' }]);
    expect(said).toEqual(['I set the priority of LAN-256 to Urgent in Linear.', 'I renamed LAN-256 in Linear.', 'I added a comment to LAN-256 in Linear.']);
    expect(i.fields).toEqual({ priority: 1, title: 'T' });
    expect(i.comments).toEqual(['C']);
  });

  it('says what Linear did not do, and never throws', async () => {
    const i = { ...issue(), state: 'Canceled' };
    expect(await makeAsked(fake([i]), [{ issue: 'LAN-256', status: 'Canceled' }])).toEqual(['LAN-256 is Canceled in Linear already.']);
    expect(await makeAsked(fake([issue()]), [{ issue: 'LAN-256', status: 'Done' }])).toEqual(['I could not set LAN-256 to Done: the team has no status Done.']);
    expect(await makeAsked(fake([]), [{ issue: 'LAN-9', status: 'Live' }])).toEqual(['I could not set LAN-9 to Live: Linear has no LAN-9.']);
    const refusing = { ...fake([issue()]), setState: async () => { throw new Error('Linear: no'); } };
    expect(await makeAsked(refusing, [{ issue: 'LAN-256', status: 'Live' }])).toEqual(['I could not set LAN-256 to Live in Linear. Do it there yourself.']);
  });
});
