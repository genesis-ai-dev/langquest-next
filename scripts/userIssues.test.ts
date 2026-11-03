import { existsSync, readFileSync } from 'node:fs';
import {
  API, AUDIENCE, checkDecisions, factsOf, FAMILIES, grewComment, issueDescription, KEY, keysIn, LABEL, LIMITS, linearClient,
  lookedOf, PREFIX, redact, when
} from './user-issues.mjs';
import { USER_ISSUES_PATH, USER_ISSUES_RULE } from '../apps/web/worker/userIssues';
import * as model from '../server/userIssues';

/** The script around Claude in the watch for user issues (decisions.md 202). */

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const RUN = 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/7';

const kind = (key: string, over: Record<string, unknown> = {}) => ({
  key, family: key.split(':')[0], people: 3, peopleDay: 2, installs: 4, count: 9, orgs: 1,
  firstAt: '2026-11-01T10:00:00Z', lastAt: '2026-11-03T09:30:00Z', platforms: { android: 2, web: 1 },
  apps: [{ app: '2026.1030.1319', installs: 3 }], installIds: ['inst-1', 'inst-2'], stack: null, before: null, server: null, feedback: null, ...over
});
const ERR = kind('error:TypeError@record:-', { stack: 'at save (recorder.ts:10)' });
const FB = kind('feedback:0d000000-0000-4000-8000-000000000001', {
  people: 1, peopleDay: 1, installs: 1, count: 1,
  feedback: { id: '0d000000-0000-4000-8000-000000000001', at: '2026-11-03T09:00:00Z', body: 'My recording vanished.\nWrite to me at someone@example.com',
    screen: 'record', os: 'android', app: '2026.1030.1319', uiLanguage: 'fr', screenshot: true, picture: false, voiceMs: 12_400, installId: 'inst-1', installKeys: [ERR.key] }
});
const NOISE = kind('auth:sign_in:refused:invalid_credentials', { people: 1, count: 2 });
const watch = { asOf: '2026-11-03T10:00:00Z', active: 9, look: [ERR, FB, NOISE], grew: [] };

describe('user-issues.mjs', () => {
  it('asks for a token the Worker takes, at the Worker\'s door, from the workflow the Worker lets in', () => {
    expect(AUDIENCE).toBe(USER_ISSUES_RULE.audience);
    expect(new URL(API).pathname).toBe(USER_ISSUES_PATH);
    const file = USER_ISSUES_RULE.workflowRef.split('@')[0]!.split('/').slice(2).join('/');
    expect(file).toBe('.github/workflows/user-issues.yml');
    const yml = read(file);
    expect(yml).toContain('id-token: write');
    expect(yml).toContain('node scripts/user-issues.mjs fetch .user-issues');
    expect(yml).toContain('node scripts/user-issues.mjs file .user-issues');
    expect(existsSync(new URL('../.agents/skills/user-issues/SKILL.md', import.meta.url))).toBe(true);
  });

  it('gives Claude no Linear key, no network and no shell besides git, and keeps its output out of the public log', () => {
    const yml = read('.github/workflows/user-issues.yml');
    const steps = yml.split(/\n {6}- /);
    const claude = steps.find((s) => s.includes('anthropics/claude-code-action'))!;
    expect(claude).toContain('claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}');
    expect(claude).toContain('--allowedTools "Read,Glob,Grep,Write,Bash(git log:*),Bash(git show:*)"');
    expect(claude).not.toContain('LINEAR_API_KEY');
    expect(claude).not.toMatch(/show_full_output|display_report/);
    // Scheduled runs start as the merge queue, which the action refuses otherwise.
    expect(claude).toContain('allowed_bots: github-merge-queue');
    expect(steps.filter((s) => s.includes('LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}')).map((s) => /run: (.+)/.exec(s)?.[1])).toEqual([
      'node scripts/user-issues.mjs fetch .user-issues', 'node scripts/user-issues.mjs file .user-issues'
    ]);
  });

  it('names kinds as the Worker and the database do', () => {
    expect(FAMILIES).toEqual([...model.FAMILIES]);
    expect(KEY.source).toBe(model.KEY.source);
    expect(LABEL).toBe(model.ISSUE_LABEL);
    expect(PREFIX).toBe(model.ISSUE_PREFIX);
    const sql = read('supabase/migrations/20261103180000_user_issues.sql');
    // Postgres allows no repetition count over 255, so the table says the length on its own.
    expect(sql).toContain(`check (length(key) <= 300 and key ~ '^(${FAMILIES.join('|')}):[A-Za-z0-9 _.:()/#@-]+$')`);
    // A tag a record left out is a dash, which a key may hold; never a question mark.
    expect(sql).not.toMatch(/coalesce\([rn]\.t->>'\w+', '\?'\)/);
  });
});

describe('an issue in Linear', () => {
  const entry = { keys: [ERR.key, FB.key], title: 'Recordings vanish on Android', priority: 1, summary: 'Recordings disappear after saving. Mail x@y.org', cause: 'recorder.ts save() swallows the error.' };
  const description = issueDescription(entry, [ERR, FB], RUN);

  it('says what the watch saw, with the person\'s words, and never an address', () => {
    expect(description).toContain('Recordings disappear after saving.');
    expect(description).toContain('> My recording vanished.');
    expect(description).toContain('from the screen `record` · android · app 2026.1030.1319 · app language fr');
    expect(description).toContain('With a screenshot and a voice note (12 s)');
    expect(description).toContain('3 people in 7 days (2 in the last day) · 4 installs · 9 times');
    expect(description).toContain('android 2, web 1 · app 2026.1030.1319 (3)');
    expect(description).not.toMatch(/@example\.com|x@y\.org/);
    expect(redact('a b@c.de, e')).toBe('a [address], e');
  });

  it('says times in Pacific, as the team reads them', () => {
    expect(when('2026-11-03T09:30:00Z')).toBe('Nov 3, 1:30 AM PT');
    expect(description).toContain('from the screen `record`');
    expect(description).toContain('first Nov 1, 2:00 AM PT, last Nov 3, 1:30 AM PT');
    expect(when(null)).toBe('?');
  });

  it('keeps the kinds, phones, stack and cause in its agent notes, where a later run finds the kinds', () => {
    expect(description).toMatch(/\+\+\+ Agent notes[\s\S]*- `error:TypeError@record:-`\n- `feedback:0d000000-0000-4000-8000-000000000001`[\s\S]*- inst-1\n- inst-2[\s\S]*at save \(recorder\.ts:10\)[\s\S]*swallows the error[\s\S]*actions\/runs\/7[\s\S]*\+\+\+$/);
    expect(keysIn(description)).toEqual([ERR.key, FB.key]);
    expect(keysIn('- `not a key`\n- `job:projection:failing`')).toEqual(['job:projection:failing']);
  });

  it('says a server job in trouble and the Worker\'s errors in words', () => {
    const job = kind('job:projection:failing', { server: { job: 'projection', every: '00:05:00', streak: 4, lastAt: '2026-11-03T09:55:00Z', lastOutcome: 'error', lastErrorClass: '57014', lastOkAt: '2026-11-03T09:30:00Z', runsOn: 'Edge Function' } });
    expect(factsOf(job)).toContain('**The server job `projection` failed 4 times running** · runs every 00:05:00, on Edge Function');
    expect(factsOf(job)).toContain('(error, 57014)');
    expect(factsOf(kind('job:tutorial_review:stopped', { server: { job: 'tutorial_review', streak: 0 } }))).toContain('stopped running');
    expect(factsOf(kind('worker:blobs:5xx', { count: 7, server: { route: 'blobs', answers5xxLastDay: 7 } }))).toContain('answered 7 times with a server error');
  });

  it('says how many more people hit a filed problem, and that it was closed', () => {
    const g = { key: ERR.key, issue: 'LAN-220', issueUrl: 'u', people: 8, peopleBefore: 3, installs: 9, count: 30, platforms: { ios: 8 }, lastAt: '2026-11-03T09:00:00Z' };
    const text = grewComment([g], { name: 'Live', type: 'completed' }, RUN);
    expect(text).toContain('More people are hitting this although it is Live.');
    expect(text).toContain('8 people in 7 days (3 when last counted)');
    expect(grewComment([g], { name: 'Todo', type: 'unstarted' }, RUN)).toContain('**More people are hitting this.**');
  });
});

describe("Claude's decisions", () => {
  const linear = { issues: [{ identifier: 'LAN-90', keys: ['sync:refused'] }] };

  it('takes one verdict per kind it was handed, and says what it left', () => {
    const plan = checkDecisions({
      file: [{ keys: [ERR.key, FB.key], title: 'User issue: Recordings\nvanish', priority: 1, summary: 's', cause: 'c' }],
      noise: [{ key: NOISE.key, note: 'A wrong password, once.' }]
    }, watch, linear);
    expect(plan.file).toEqual([{ keys: [ERR.key, FB.key], title: 'Recordings vanish', priority: 1, summary: 's', cause: 'c' }]);
    expect(plan.noise).toEqual([{ key: NOISE.key, note: 'A wrong password, once.' }]);
    expect(plan.dropped).toEqual([]);
    expect(plan.undecided).toEqual([]);
  });

  it('drops a kind it was not handed, one named twice, a bad issue id or a missing title, and leaves those kinds for next run', () => {
    const plan = checkDecisions({
      file: [{ keys: ['error:Made@up:-'], title: 't', summary: 's' }, { keys: [ERR.key], title: '', summary: 's' }],
      known: [{ keys: [ERR.key], issue: 'LAN-12' }, { keys: [ERR.key], issue: 'LAN-13' }, { keys: [FB.key], issue: 'OTHER-1' }],
      noise: ['x']
    }, watch, linear);
    expect(plan.known).toEqual([{ keys: [ERR.key], issue: 'LAN-12', comment: '' }]);
    expect(plan.dropped).toHaveLength(5);
    expect(plan.undecided).toEqual([FB.key, NOISE.key]);
    expect(checkDecisions(null, watch, linear).undecided).toHaveLength(3);
  });

  it('comments on the issue a kind is already on, in place of filing it twice', () => {
    const w = { ...watch, look: [kind('sync:refused')] };
    const plan = checkDecisions({ file: [{ keys: ['sync:refused'], title: 't', summary: 'seen again' }] }, w, linear);
    expect(plan.file).toEqual([]);
    expect(plan.known).toEqual([{ keys: ['sync:refused'], issue: 'LAN-90', comment: 'seen again' }]);
  });

  it('cuts what Claude wrote to size, priority Medium unless it says', () => {
    const plan = checkDecisions({ file: [{ keys: [ERR.key], title: 'x'.repeat(300), summary: 's', priority: 9 }], noise: [{ key: NOISE.key, note: 'y'.repeat(900) }] }, watch, linear);
    expect(plan.file[0]?.title).toHaveLength(LIMITS.title);
    expect(plan.file[0]?.priority).toBe(3);
    expect(plan.noise[0]?.note).toHaveLength(LIMITS.note);
  });

  it('tells the Worker the counts each kind was judged at', () => {
    expect(lookedOf(ERR, 'filed', { identifier: 'LAN-220', url: 'https://linear.app/x/issue/LAN-220' })).toEqual({
      key: ERR.key, verdict: 'filed', issue: 'LAN-220', issueUrl: 'https://linear.app/x/issue/LAN-220', people: 3, count: 9, note: null
    });
    expect(() => model.parseLooked({ sha: 'a'.repeat(40), runUrl: RUN, looked: [lookedOf(NOISE, 'noise', null, 'n'), lookedOf(FB, 'known', { identifier: 'LAN-35', url: 'https://linear.app/x/issue/LAN-35' })] })).not.toThrow();
  });
});

describe('Linear', () => {
  function fake(answers: Record<string, unknown>) {
    const calls: { query: string; variables: Record<string, unknown> }[] = [];
    const fetcher = async (_url: string, init: { body: string; headers: Record<string, string> }) => {
      const body = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
      calls.push(body);
      expect(init.headers.authorization).toBe('lin_key');
      const hit = Object.entries(answers).find(([part]) => body.query.includes(part));
      return Response.json(hit ? hit[1] : { errors: [{ message: 'Entity not found', extensions: { code: 'INVALID_INPUT' } }] });
    };
    return { api: linearClient('lin_key', fetcher as unknown as typeof fetch), calls };
  }

  it('finds the team and its User issue label, and makes the label when it is missing', async () => {
    const found = fake({ 'teams(': { data: { teams: { nodes: [{ id: 'team' }] }, issueLabels: { nodes: [{ id: 'other', team: { key: 'ENG' } }, { id: 'label', team: { key: 'LAN' } }] } } } });
    expect(await found.api.team()).toEqual({ teamId: 'team', labelId: 'label' });
    const made = fake({
      'teams(': { data: { teams: { nodes: [{ id: 'team' }] }, issueLabels: { nodes: [] } } },
      issueLabelCreate: { data: { issueLabelCreate: { issueLabel: { id: 'new' } } } }
    });
    expect(await made.api.team()).toEqual({ teamId: 'team', labelId: 'new' });
    expect(made.calls[1]?.variables).toMatchObject({ input: { teamId: 'team', name: 'User issue' } });
  });

  it('lists open and recent issues page by page, with the kinds each names', async () => {
    let page = 0;
    const node = (n: number) => ({ identifier: `LAN-${n}`, title: 't', url: 'u', description: `x\n- \`job:projection:failing\``, createdAt: 'c', state: { name: 'Todo', type: 'unstarted' }, labels: { nodes: [{ name: 'User issue' }] } });
    const fetcher = async (_u: string, init: { body: string }) => {
      const { variables } = JSON.parse(init.body) as { variables: { after: string | null } };
      page += 1;
      expect(variables.after).toBe(page === 1 ? null : 'c1');
      return Response.json({ data: { issues: { nodes: [node(page)], pageInfo: { hasNextPage: page === 1, endCursor: `c${page}` } } } });
    };
    const issues = await linearClient('lin_key', fetcher as unknown as typeof fetch).issues('2026-08-05T00:00:00Z');
    expect(issues.map((i) => [i.identifier, i.keys, i.labels])).toEqual([['LAN-1', ['job:projection:failing'], ['User issue']], ['LAN-2', ['job:projection:failing'], ['User issue']]]);
  });

  it('answers null for an issue Linear does not have, and says a refusal by its code alone', async () => {
    const { api } = fake({});
    expect(await api.issue('LAN-404')).toBeNull();
    const refused = linearClient('lin_key', (async () => Response.json({ errors: [{ message: 'Authentication required', extensions: { code: 'AUTHENTICATION_ERROR' } }] }, { status: 401 })) as unknown as typeof fetch);
    await expect(refused.issue('LAN-1')).rejects.toThrow('Linear AUTHENTICATION_ERROR: Authentication required');
  });
});
