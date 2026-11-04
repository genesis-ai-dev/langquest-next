import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  API, AUDIENCE, branchComment, checkDecisions, checkFix, checkResults, EVIDENCE_PHONES, evidencePlan, factsOf, FAMILIES, fetchEvidence, FIX_LIMITS, FIX_MAX,
  fixBody, fixBranch, fixComment, fixRefusal, grewComment, isClosed, issueDescription, KEY, keysIn, LABEL, leaks, LIMITS, linearClient, lookedOf, mergesOf,
  noFixComment, oldPathsOf, pathsOf, phoneFacts, PREFIX, privateOf, redact, statesToSend, when, withEvidence
} from './user-issues.mjs';
import { USER_ISSUES_PATH, USER_ISSUES_RULE } from '../apps/web/worker/userIssues';
import * as model from '../server/userIssues';

/** The script around Claude in the watch for user issues (decisions.md 202). */

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const RUN = 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/7';

const kind = (key: string, over: Record<string, unknown> = {}) => ({
  key, family: key.split(':')[0], people: 3, peopleDay: 2, installs: 4, count: 9, orgs: 1,
  firstAt: '2026-11-01T10:00:00Z', lastAt: '2026-11-03T09:30:00Z', platforms: { android: 2, web: 1 },
  apps: [{ app: 'android update 1a2b3c4d', installs: 3 }], installIds: ['inst-1', 'inst-2'], stack: null, before: null, peopleAfterFix: null, server: null, feedback: null, ...over
});
const ERR = kind('error:TypeError@record:-', { stack: 'at save (recorder.ts:10)' });
const FB = kind('feedback:0d000000-0000-4000-8000-000000000001', {
  people: 1, peopleDay: 1, installs: 1, count: 1,
  feedback: { id: '0d000000-0000-4000-8000-000000000001', at: '2026-11-03T09:00:00Z', body: 'My recording vanished.\nWrite to me at someone@example.com',
    screen: 'record', os: 'android', app: 'android update 1a2b3c4d', uiLanguage: 'fr', screenshot: true, picture: false, voiceMs: 12_400, installId: 'inst-1', installKeys: [ERR.key] }
});
const NOISE = kind('auth:sign_in:refused:invalid_credentials', { people: 1, count: 2 });
const watch = { asOf: '2026-11-03T10:00:00Z', active: 9, look: [ERR, FB, NOISE], grew: [], issues: [] };

const watchStepsOf = (job: string) => job.split(/\n {6}- /);

describe('user-issues.mjs', () => {
  it('asks for a token the Worker takes, at the Worker\'s door, from the workflow the Worker lets in', () => {
    expect(AUDIENCE).toBe(USER_ISSUES_RULE.audience);
    expect(new URL(API).pathname).toBe(USER_ISSUES_PATH);
    const file = USER_ISSUES_RULE.workflowRef.split('@')[0]!.split('/').slice(2).join('/');
    expect(file).toBe('.github/workflows/user-issues.yml');
    const yml = read(file);
    expect(yml).toContain('id-token: write');
    expect(yml).toContain('node scripts/user-issues.mjs fetch .user-issues');
    expect(yml).toContain('node "$RUNNER_TEMP/watch/user-issues.mjs" file .user-issues');
    expect(existsSync(new URL('../.agents/skills/user-issues/SKILL.md', import.meta.url))).toBe(true);
  });

  it('gives Claude no Linear key, no network and no shell besides git, and keeps its output out of the public log', () => {
    const yml = read('.github/workflows/user-issues.yml');
    const steps = yml.split(/\n {6}- /);
    const claude = steps.find((s) => s.includes('anthropics/claude-code-action'))!;
    expect(claude).toContain('claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}');
    expect(claude).toContain('--allowedTools "Read,Glob,Grep,Write,Bash(git log:*),Bash(git show:*),Bash(git merge-base:*)"');
    expect(claude).not.toContain('LINEAR_API_KEY');
    expect(claude).not.toMatch(/show_full_output|display_report/);
    // Scheduled runs start as the merge queue, which the action refuses otherwise.
    expect(claude).toContain('allowed_bots: github-merge-queue');
    // Before Claude, from the checkout; after Claude, from the copy made before it.
    expect(steps.filter((s) => s.includes('LINEAR_API_KEY: ${{ secrets.LINEAR_API_KEY }}')).map((s) => /run: (.+)/.exec(s)?.[1])).toEqual([
      'node scripts/user-issues.mjs fetch .user-issues', 'node "$RUNNER_TEMP/watch/user-issues.mjs" file .user-issues',
      'node scripts/user-issues.mjs fix-context .user-issues "$ISSUE"', 'node scripts/user-issues.mjs fix-open .user-issues "$ISSUE"'
    ]);
  });

  it('writes a draft fix in jobs that trust each other less: Claude with no key, the checks with none, the push running nothing of it', () => {
    const yml = read('.github/workflows/user-issues.yml');
    const jobs = Object.fromEntries(yml.slice(yml.search(/^jobs:$/m)).split(/^ {2}(?=[\w-]+:$)/m).slice(1).map((b) => [b.match(/^([\w-]+):/)![1], b]));
    expect(Object.keys(jobs)).toEqual(['watch', 'fix', 'check', 'open']);
    const perms = (job: string) => /^ {4}permissions:\n((?: {6}.+\n)+)/m.exec(jobs[job]!)?.[1]?.trim().split(/\n\s*/);
    expect(yml).toMatch(/^permissions:\n {2}contents: read\n\n/m);
    expect(perms('watch')).toEqual(['contents: read', 'id-token: write']);
    // The OpenID Connect token fetches what came with the issue, in the step before Claude, as in the watch job.
    expect(perms('fix')).toEqual(['contents: read', 'id-token: write']);
    expect(perms('check')).toEqual(['contents: read']);
    expect(perms('open')).toEqual(['contents: write', 'pull-requests: write']);
    // No checkout before Claude or the patch's code keeps a token on disk.
    for (const job of ['watch', 'fix', 'check']) expect(jobs[job]!.match(/actions\/checkout@/g)?.length, job).toBe(jobs[job]!.match(/persist-credentials: false/g)?.length);
    const fix = jobs['fix']!.split(/\n {6}- /);
    const claude = fix.find((s) => s.includes('anthropics/claude-code-action'))!;
    expect(claude).toContain('--allowedTools "Read,Glob,Grep,Edit,Write,Bash(git log:*),Bash(git show:*),Bash(git diff:*)"');
    expect(claude).not.toMatch(/LINEAR_API_KEY|show_full_output|display_report/);
    // The key reads the issue before Claude; the patch is taken with the scripts and repository copied before it.
    expect(fix.findIndex((s) => s.includes('LINEAR_API_KEY'))).toBeLessThan(fix.indexOf(claude));
    expect(fix.findIndex((s) => s.includes('cp -a .git "$RUNNER_TEMP/base.git"'))).toBeLessThan(fix.indexOf(claude));
    expect(jobs['fix']).toContain('GIT_DIR: ${{ runner.temp }}/base.git');
    // What was sent is kept outside the checkout before Claude, and the patch step keeps it out of the change.
    const context = fix.find((s) => s.includes('fix-context'))!;
    expect(fix.indexOf(context)).toBeLessThan(fix.indexOf(claude));
    expect(context).toContain('FIX_PRIVATE: ${{ runner.temp }}/private.json');
    expect(fix.find((s) => s.includes('fix-patch'))).toContain('FIX_PRIVATE: ${{ runner.temp }}/private.json');
    expect(claude).toContain('.user-issues/evidence');
    expect(watchStepsOf(jobs['watch']!).find((s) => s.includes('anthropics/claude-code-action'))).toContain('.user-issues/evidence');
    // Nothing that came with a problem leaves the runner: only the patch step's own output is uploaded.
    const uploads = yml.split(/\n {6}- /).filter((s) => s.includes('actions/upload-artifact')).map((s) => /path: (.+)/.exec(s)?.[1]);
    expect(uploads).toEqual(['${{ runner.temp }}/fix-out/', '${{ runner.temp }}/check/']);
    const watchSteps = jobs['watch']!.split(/\n {6}- /);
    const look = watchSteps.findIndex((s) => s.includes('anthropics/claude-code-action'));
    expect(watchSteps.findIndex((s) => s.includes('cp -a .git "$RUNNER_TEMP/base.git"'))).toBeLessThan(look);
    expect(watchSteps.find((s) => s.includes('file .user-issues'))).toContain('GIT_DIR: ${{ runner.temp }}/base.git');
    expect(jobs['fix']).toContain('run: node "$RUNNER_TEMP/watch/user-issues.mjs" fix-patch .user-issues');
    expect(jobs['fix']).toContain('max-parallel: 1');
    // The checks hold no secret; the paths are refused before anything of the patch runs.
    expect(jobs['check']).not.toMatch(/secrets\.|cache:/);
    expect(jobs['check']!.indexOf('fix-paths')).toBeLessThan(jobs['check']!.indexOf('npm ci'));
    // The push runs nothing of the patch.
    expect(jobs['open']).not.toMatch(/\bnpm\b|\bnpx\b|vitest|claude-code-action/);
    expect(jobs['open']).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
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
    expect(description).toContain('from the screen `record` · android update 1a2b3c4d · app language fr');
    expect(description).toContain('With a screenshot and a voice note (12 s)');
    expect(description).toContain('3 people in 7 days (2 in the last day) · 4 installs · 9 times');
    expect(description).toContain('android 2, web 1 · builds android update 1a2b3c4d (3)');
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

  it('says when people hit a fixed problem again after the fix, and that the builds shown are theirs', () => {
    const again = kind(ERR.key, {
      peopleAfterFix: 2, apps: [{ app: 'web 4df4afdeaf0f', installs: 2 }],
      before: { verdict: 'fixed', issue: 'LAN-220', issueUrl: 'u', people: 0, lookedAt: '2026-11-03T21:00:00Z', fixedBy: 312, fixedAt: '2026-11-03T17:09:42Z', closedAt: '2026-11-03T21:00:00Z', state: 'Live' }
    });
    const text = factsOf(again);
    expect(text).toContain('**Again after the fix** (PR 312, merged Nov 3, 9:09 AM PT): 2 people more than a day after it');
    expect(text).toContain('builds web 4df4afdeaf0f (2)');
    const closedOnly = kind(ERR.key, { peopleAfterFix: 3, before: { ...again.before, fixedBy: null, fixedAt: '2026-11-03T21:00:00Z' } });
    expect(factsOf(closedOnly)).toContain('**Again after the fix** (issue closed Nov 3, 1:00 PM PT): 3 people');
    expect(factsOf(ERR)).not.toContain('Again after the fix');
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

  it('takes what a merged pull request already fixed, by its number, and drops one without a number', () => {
    const plan = checkDecisions({
      fixed: [{ keys: [ERR.key, FB.key], pr: 295, title: 'User issue: Play all stops', note: 'Before PR 295.' }, { keys: [NOISE.key], pr: 'latest' }]
    }, watch, linear);
    expect(plan.fixed).toEqual([{ keys: [ERR.key, FB.key], pr: 295, title: 'Play all stops', note: 'Before PR 295.' }]);
    expect(plan.dropped).toEqual(['fixed[1]: needs keys and pr, the number of the pull request on main that fixed it']);
    expect(plan.undecided).toEqual([NOISE.key]);
  });

  it('tells the Worker the counts each kind was judged at', () => {
    expect(lookedOf(ERR, 'filed', { identifier: 'LAN-220', url: 'https://linear.app/x/issue/LAN-220' }, null, { title: 'Recordings vanish' })).toEqual({
      key: ERR.key, verdict: 'filed', issue: 'LAN-220', issueUrl: 'https://linear.app/x/issue/LAN-220', people: 3, count: 9, note: null,
      title: 'Recordings vanish', fixedBy: null, fixedAt: null
    });
    // Found fixed: counted from the fix, so it comes back only when people hit it after the fix.
    expect(lookedOf(ERR, 'fixed', null, 'n', { fixedBy: 312, fixedAt: '2026-11-03T17:09:42.000Z' })).toMatchObject({ people: 0, fixedBy: 312, issue: null });
    expect(lookedOf({ ...ERR, peopleAfterFix: 2 }, 'fixed', { identifier: 'LAN-220', url: 'https://linear.app/x/issue/LAN-220' }, null, { fixedBy: 312, fixedAt: '2026-11-03T17:09:42.000Z' }))
      .toMatchObject({ people: 2, issue: 'LAN-220' });
    expect(() => model.parseLooked({ sha: 'a'.repeat(40), runUrl: RUN, looked: [lookedOf(NOISE, 'noise', null, 'n'), lookedOf(FB, 'known', { identifier: 'LAN-35', url: 'https://linear.app/x/issue/LAN-35' })] })).not.toThrow();
  });
});

describe('closed in Linear, and the pull requests on main', () => {
  const log = [
    '2026-11-03T18:55:28+00:00\x1fMerge pull request #314 from genesis-ai-dev/a\x1fWatch for user issues\n\x1e',
    '2026-11-03T17:09:42+00:00\x1fMerge pull request #312 from genesis-ai-dev/b\x1fBrowsers keep reference audio (LAN-213)\n\x1e',
    '2026-11-03T16:38:05+00:00\x1fMerge main (PR 312)\x1f\x1e',
    '2026-10-30T22:50:22+00:00\x1fMerge pull request #295 from genesis-ai-dev/c\x1fPlay all on phone browsers (LAN-2130)\n\x1e'
  ].join('\n');
  const merges = mergesOf(log);
  const live = { name: 'Live', type: 'completed' };

  it('reads each pull request merged into main, when it merged, and the issue each names', () => {
    expect(merges.at(312)).toBe('2026-11-03T17:09:42.000Z');
    expect(merges.at(295)).toBe('2026-10-30T22:50:22.000Z');
    expect(merges.at(1)).toBeNull();
    expect(merges.naming('LAN-213')).toBe(312);
    expect(merges.naming('LAN-21')).toBeNull();
    expect(mergesOf('').at(312)).toBeNull();
  });

  it('closes on done, canceled or duplicate, but not Outage (a deploy that failed)', () => {
    expect(isClosed(live)).toBe(true);
    expect(isClosed({ name: 'Canceled', type: 'canceled' })).toBe(true);
    expect(isClosed({ name: 'Duplicate', type: 'duplicate' })).toBe(true);
    expect(isClosed({ name: 'Outage', type: 'canceled' })).toBe(false);
    expect(isClosed({ name: 'Deploying', type: 'started' })).toBe(false);
  });

  it('sends what changed: closed with the pull request Linear links, or the merge naming it, and open again', () => {
    const known = [
      { issue: 'LAN-220', state: 'Backlog', closed: false }, { issue: 'LAN-213', state: 'In Progress', closed: false },
      { issue: 'LAN-221', state: 'Live', closed: true }, { issue: 'LAN-222', state: 'Backlog', closed: false },
      { issue: 'LAN-223', state: 'Todo', closed: false }, { issue: 'LAN-404', state: 'Todo', closed: false }
    ];
    const pr = (n: number) => ({ url: `https://github.com/genesis-ai-dev/langquest-next/pull/${n}` });
    const issues = [
      { identifier: 'LAN-220', title: 'User issue: Play all stops, mail a@b.org', state: live, completedAt: '2026-11-03T21:00:00.000Z', canceledAt: null, attachments: [pr(295), pr(312), { url: 'https://github.com/other/repo/pull/999' }] },
      { identifier: 'LAN-213', state: live, completedAt: '2026-11-03T21:00:00.000Z', canceledAt: null, attachments: [] },
      { identifier: 'LAN-221', state: { name: 'Todo', type: 'unstarted' }, completedAt: null, canceledAt: null, attachments: [] },
      { identifier: 'LAN-222', state: { name: 'In Progress', type: 'started' }, completedAt: null, canceledAt: null, attachments: [] },
      { identifier: 'LAN-223', state: { name: 'Todo', type: 'unstarted' }, completedAt: null, canceledAt: null, attachments: [] }
    ];
    const states = statesToSend(known, issues, merges);
    expect(states).toEqual([
      { issue: 'LAN-220', state: 'Live', closed: true, closedAt: '2026-11-03T21:00:00.000Z', fixedBy: 312, fixedAt: '2026-11-03T17:09:42.000Z', title: 'Play all stops, mail [address]' },
      { issue: 'LAN-213', state: 'Live', closed: true, closedAt: '2026-11-03T21:00:00.000Z', fixedBy: 312, fixedAt: '2026-11-03T17:09:42.000Z', title: null },
      { issue: 'LAN-221', state: 'Todo', closed: false, closedAt: null, fixedBy: null, fixedAt: null, title: null },
      { issue: 'LAN-222', state: 'In Progress', closed: false, closedAt: null, fixedBy: null, fixedAt: null, title: null }
    ]);
    // Closed with no pull request named anywhere: from when it closed.
    expect(statesToSend([{ issue: 'LAN-9', state: 'Todo', closed: false }], [{ identifier: 'LAN-9', state: { name: 'Canceled', type: 'canceled' }, completedAt: null, canceledAt: '2026-11-02T00:00:00.000Z', attachments: [] }], merges))
      .toEqual([{ issue: 'LAN-9', state: 'Canceled', closed: true, closedAt: '2026-11-02T00:00:00.000Z', fixedBy: null, fixedAt: '2026-11-02T00:00:00.000Z', title: null }]);
    expect(() => model.parseLooked({ sha: 'a'.repeat(40), runUrl: RUN, states })).not.toThrow();
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

  it("reads the watch's issues by number, and reopens one in the team's first not-started state", async () => {
    const { api, calls } = fake({
      'number: { in': { data: { issues: { nodes: [{ identifier: 'LAN-220', title: 't', state: { name: 'Live', type: 'completed' }, completedAt: 'c', canceledAt: null, attachments: { nodes: [{ url: 'p' }] } }] } } },
      workflowStates: { data: { workflowStates: { nodes: [{ id: 'later', position: 2 }, { id: 'todo', position: 1 }] } } },
      issueUpdate: { data: { issueUpdate: { success: true } } }
    });
    expect(await api.states(['LAN-220', 'LAN-221'])).toEqual([{ identifier: 'LAN-220', title: 't', state: { name: 'Live', type: 'completed' }, completedAt: 'c', canceledAt: null, attachments: [{ url: 'p' }] }]);
    expect(calls[0]?.variables).toEqual({ key: 'LAN', numbers: [220, 221] });
    expect(await api.states([])).toEqual([]);
    await api.reopen('issue-id');
    expect(calls.at(-1)?.variables).toEqual({ id: 'issue-id', input: { stateId: 'todo' } });
  });

  it('answers null for an issue Linear does not have, and says a refusal by its code alone', async () => {
    const { api } = fake({});
    expect(await api.issue('LAN-404')).toBeNull();
    const refused = linearClient('lin_key', (async () => Response.json({ errors: [{ message: 'Authentication required', extensions: { code: 'AUTHENTICATION_ERROR' } }] }, { status: 401 })) as unknown as typeof fetch);
    await expect(refused.issue('LAN-1')).rejects.toThrow('Linear AUTHENTICATION_ERROR: Authentication required');
  });
});

describe('a draft fix for each new issue', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' });

  it('reads the paths git lists for a patch, both sides of a rename and binary files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fix-'));
    try {
      git(dir, 'init', '-q');
      writeFileSync(join(dir, 'a.ts'), 'export const a = 1;\n'.repeat(20));
      writeFileSync(join(dir, 'old name.ts'), 'export const b = 2;\n'.repeat(20));
      git(dir, 'add', '-A');
      git(dir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base');
      writeFileSync(join(dir, 'a.ts'), 'export const a = 3;\n'.repeat(20));
      git(dir, 'mv', 'old name.ts', 'new name.ts');
      writeFileSync(join(dir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
      git(dir, 'add', '-A');
      const patch = git(dir, 'diff', '--cached', '--binary', '-M');
      writeFileSync(join(dir, 'fix.patch'), patch);
      expect(pathsOf(git(dir, 'apply', '--numstat', '-z', 'fix.patch')).sort()).toEqual(['a.ts', 'new name.ts', 'pic.png']);
      // git lists only where a rename goes; where it came from is read from the patch.
      expect(oldPathsOf(patch).sort()).toEqual(['a.ts', 'old name.ts']);
      expect(oldPathsOf('diff --git a/x b/x\n--- "a/.github/\\tx"\n+++ b/x\n')).toEqual(['"a/.github/\\tx"']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a change to how the repository builds and deploys, its packages, secrets, agents or the watch, and one too big to review', () => {
    expect(fixRefusal(['apps/mobile/src/recording/recorder.ts', 'apps/mobile/test/recorder.test.ts'], 4000)).toBeNull();
    for (const p of ['.github/workflows/guardrails.yml', '.githooks/pre-commit', 'package.json', 'apps/mobile/package.json', 'package-lock.json', '.env.production',
      'apps/mobile/.env.preview', '.npmrc', '.agents/skills/user-issues/SKILL.md', '.claude/settings.json', 'AGENTS.md', 'CLAUDE.md', 'scripts/user-issues.mjs',
      'scripts/linear-sync.mjs', '.git/config', 'apps/.git/hooks/pre-commit', '../outside.ts', '/etc/passwd', '.user-issues/issue.json', '"a/.github/\\tx"',
      'apps/mobile/test/shot.jpg', 'apps/mobile/assets/x.PNG', 'apps/mobile/test/voice.m4a']) {
      expect(fixRefusal(['apps/mobile/src/a.ts', p], 100), p).toMatch(/which a draft fix may not$/);
    }
    expect(fixRefusal([], 0)).toBe('it changes nothing');
    expect(fixRefusal(Array.from({ length: FIX_LIMITS.files + 1 }, (_, i) => `apps/mobile/src/f${i}.ts`), 100)).toMatch(/more than 30$/);
    expect(fixRefusal(['apps/mobile/src/a.ts'], FIX_LIMITS.bytes + 1)).toMatch(/more than 300$/);
  });

  it('takes Claude\'s summary or its reason for none, cut and without addresses, and only fixed words from the checks', () => {
    expect(checkFix({ summary: 'Saves the part before closing. Ask a@b.org', tests: 'recorder.test.ts' })).toEqual({ summary: 'Saves the part before closing. Ask [address]', tests: 'recorder.test.ts', noFix: '' });
    expect(checkFix({ noFix: 'Needs a store build.' }).noFix).toBe('Needs a store build.');
    expect(checkFix({}).noFix).toBe('Claude wrote no summary of a change.');
    expect(checkFix(null).noFix).toBe('Claude wrote no summary of a change.');
    expect(checkFix({ summary: 'x'.repeat(5000) }).summary).toHaveLength(FIX_LIMITS.summary);
    expect(checkResults({ typecheck: 'passed', tests: 'none' })).toEqual({ typecheck: 'passed', tests: 'none' });
    expect(checkResults({ typecheck: 'passed **really**', tests: 1 })).toEqual({ typecheck: 'not run', tests: 'not run' });
    expect(FIX_MAX).toBe(3);
    expect(fixBranch('LAN-230')).toBe('user-issue/lan-230');
  });

  it('opens a pull request that links the issue, says what ran and that its checks wait for a person, and tells the issue', () => {
    const issue = { identifier: 'LAN-230', url: 'https://linear.app/frontierrandd/issue/LAN-230' };
    const body = fixBody(issue, { summary: 'Saves the part before closing.', tests: 'recorder.test.ts', noFix: '' }, { typecheck: 'passed', tests: 'failed' }, RUN);
    expect(body).toContain('A draft fix for [LAN-230](https://linear.app/frontierrandd/issue/LAN-230)');
    expect(body).toContain('Saves the part before closing.\n\n**Tests:** recorder.test.ts');
    expect(body).toContain(`**In the workflow:** typecheck passed; tests **failed** ([run](${RUN})).`);
    expect(body).toContain('CI runs when a person marks this pull request Ready for review.');
    expect(fixComment({ number: 330, url: 'https://github.com/genesis-ai-dev/langquest-next/pull/330' }, { typecheck: 'passed', tests: 'none' }))
      .toBe('**Claude wrote a draft fix:** [PR 330](https://github.com/genesis-ai-dev/langquest-next/pull/330).\n\nTypecheck passed; no tests near the change.\n\nReview it, then mark it Ready for review on GitHub to run CI and merge it.');
    expect(noFixComment('Needs a store build.', RUN)).toBe(`**Claude looked for a fix and wrote none.** Needs a store build.\n\nThe watch for user issues: ${RUN}`);
    expect(branchComment('user-issue/lan-230', RUN)).toContain('[Open it](https://github.com/genesis-ai-dev/langquest-next/compare/main...user-issue/lan-230?expand=1)');
  });
});

describe('what Claude looks at besides the counts', () => {
  const at = '2026-11-04T04:29:00Z';
  const rec = (minsBefore: number, kind: string, n: Record<string, number>, t: Record<string, string> = {}) => ({
    at: new Date(Date.parse(at) - minsBefore * 60_000).toISOString(), receivedAt: at, kind, n, t
  });
  const phone = {
    installId: 'inst-1', build: 'android update 01a1a398', phone: { os: 'android', osVersion: '11', model: 'moto e' },
    firstSeen: '2026-10-20T00:00:00Z', lastSeen: at, from: '2026-11-01T04:29:00Z', to: '2026-11-04T05:29:00Z',
    records: [
      rec(2, 'transfer', { count: 3, bytes: 3_145_728, ms: 36_000, maxMs: 21_000 }, { dir: 'down', src: 'lang' }),
      rec(5, 'transfer', { count: 2, bytes: 0, ms: 9000, maxMs: 6000, failOffline: 1, failOther: 1 }, { dir: 'down', src: 'source' }),
      rec(6, 'audio', { plays: 4, playFail: 1 }),
      rec(8, 'open', { ms: 14_000 }, { cold: 'no' }),
      rec(9, 'device', { freeDiskMb: 820, totalDiskMb: 16_000, blobsWanted: 12, dbMb: 40 }),
      rec(45, 'transfer', { count: 50, ms: 1000 }, { dir: 'down', src: 'lang' })
    ]
  };

  it('asks for each problem\'s pictures and phone first, then a few phones of every other kind, at most twelve', () => {
    const many = kind('transfer:down:lang:failOther', { installIds: Array.from({ length: 30 }, (_, i) => `inst-${i}`) });
    const plan = evidencePlan([ERR, many, FB, kind('feedback:0d000000-0000-4000-8000-000000000002', { feedback: { ...FB.feedback!, id: 'not-an-id', screenshot: true, installId: '../x' } })]);
    expect(plan.media).toEqual(['0d000000-0000-4000-8000-000000000001']);
    expect(plan.phones[0]).toEqual({ installId: 'inst-1', at: '2026-11-03T09:00:00Z' });
    expect(plan.phones.map((p) => p.installId)).toEqual(['inst-1', 'inst-2', 'inst-0']);
    const lots = evidencePlan(Array.from({ length: 10 }, (_, i) => kind(`error:E${i}@x:-`, { installIds: [`a-${i}`, `b-${i}`, `c-${i}`] })));
    expect(lots.phones).toHaveLength(EVIDENCE_PHONES);
    expect(lots.media).toEqual([]);
  });

  it('keeps the pictures as JPEG files and the records as JSON on the runner, and goes on without what it could not have', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'evidence-'));
    try {
      const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString('base64');
      const asked: string[] = [];
      const got = await fetchEvidence(dir, { media: ['0d000000-0000-4000-8000-000000000001', '0d000000-0000-4000-8000-000000000002'], phones: [{ installId: 'inst-1', at }, { installId: 'gone', at: null }] }, async (q: string) => {
        asked.push(q);
        if (q.includes('000000000002')) throw new Error('GET: HTTP 500');
        if (q.startsWith('?media=')) return { screenshot: jpeg, picture: Buffer.from('<svg>').toString('base64') };
        return q.includes('inst-1') ? phone : null;
      });
      expect(asked).toEqual(['?media=0d000000-0000-4000-8000-000000000001', '?media=0d000000-0000-4000-8000-000000000002', `?phone=inst-1&at=${encodeURIComponent(at)}`, '?phone=gone']);
      const shot = got.media['0d000000-0000-4000-8000-000000000001']!;
      expect(readFileSync(shot.screenshot!)).toEqual(Buffer.from(jpeg, 'base64'));
      expect(shot.picture).toBeNull();
      expect(got.media['0d000000-0000-4000-8000-000000000002']).toEqual({ screenshot: null, picture: null });
      expect(JSON.parse(readFileSync(got.phones['inst-1']!.path, 'utf8'))).toEqual(phone);
      expect(got.phones['gone']).toBeUndefined();
      expect(shot.screenshot!.startsWith(join(dir, 'evidence'))).toBe(true);

      const [err, fb] = withEvidence([ERR, FB], got);
      expect(fb!.evidence).toEqual({ screenshot: shot.screenshot, picture: null, phones: [got.phones['inst-1']!.path] });
      expect(fb!.phoneFacts).toEqual(phoneFacts(phone, FB.feedback!.at));
      expect(err!.evidence).toEqual({ screenshot: null, picture: null, phones: [got.phones['inst-1']!.path] });
      expect(err).not.toHaveProperty('phoneFacts');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('says what the phone did in the half hour before, from the records alone', () => {
    expect(phoneFacts(phone, at)).toEqual([
      'moto e, android 11 · android update 01a1a398',
      'Downloads (lang): 3 files, 3.0 MB, 12 s each on average, slowest 21 s',
      'Downloads (source): 2 files, 4.5 s each on average, slowest 6.0 s, 2 failed (failOffline 1, failOther 1)',
      'Audio: plays 4, playFail 1',
      'Open: 1 time, slowest 14 s',
      `Disk, ${when(phone.records[4]!.at)}: 820 MB free of 16000 MB, 12 files wanted, database 40 MB`
    ]);
    expect(phoneFacts({ ...phone, phone: {}, records: [] }, at)).toEqual(['phone ? · android update 01a1a398', 'No downloads, plays, opens, syncs or errors recorded in the half hour before it.']);
  });

  it('puts the phone\'s numbers under a problem sent from help mode', () => {
    const facts = factsOf({ ...FB, phoneFacts: phoneFacts(phone, at) });
    expect(facts).toContain('**That phone in the half hour before**');
    expect(facts).toContain('- Downloads (lang): 3 files, 3.0 MB, 12 s each on average, slowest 21 s');
    expect(factsOf(FB)).not.toContain('That phone');
  });

  it('knows the ids and words of what was sent, as Linear gives the issue back, and keeps them out of a public change', () => {
    const description = [
      'Playback is slow.', '', '**Sent from help mode** on Nov 3', '', '> Playback is super slow on this lower end phone. Just tried to play audio now.', '> ok', '',
      '+++ Agent notes', '', 'Kinds (the watch matches later records to this issue by these lines; keep them):', '',
      '* `feedback:a316558c-474c-46f1-8f48-672fc38ea87d`', '- `audio:playFail`', '',
      'Phones that hit it, for `npm run diag -- --hosted timeline <installId> --days 3`:', '', '* eae9b9ed-7c59-41c5-9dc4-173b84a3860d', '- inst-0001', '',
      'Not investigated in code.', '- not-a-phone-0001', '+++'
    ].join('\n');
    const priv = privateOf(description);
    expect(priv.feedback).toEqual(['a316558c-474c-46f1-8f48-672fc38ea87d']);
    expect(priv.installs).toEqual(['eae9b9ed-7c59-41c5-9dc4-173b84a3860d', 'inst-0001']);
    expect(priv.words).toEqual(['Playback is super slow on this lower end phone. Just tried to play audio now.']);
    expect(keysIn(description)).toEqual(['feedback:a316558c-474c-46f1-8f48-672fc38ea87d', 'audio:playFail']);

    expect(leaks('+ // Seen on eae9b9ed-7c59-41c5-9dc4-173b84a3860d', priv)).toBe(true);
    expect(leaks('const report = "a316558c-474c-46f1-8f48-672fC38EA87D";', priv)).toBe(true);
    expect(leaks("it('plays when playback is super slow on this lower end phone', ...)", priv)).toBe(true);
    expect(leaks("it('starts playing before the whole file is read')", priv)).toBe(false);
    expect(leaks('Playback on slow phones starts at once.', priv)).toBe(false);
  });
});
