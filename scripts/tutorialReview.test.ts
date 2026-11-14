import { existsSync, readFileSync } from 'node:fs';
import { AUDIENCE, API, changesOf, CHANGES_MAX, checkFix, checkResults, FIX_LIMITS, FIXABLE, fixBranch, fixPull, fixRefusal, prOf, prStateOf, problemsOf, runUrl, withRun } from './tutorial-review.mjs';
import { FIXES_PATH, FIXES_PER_RUN, REVIEW_PATH, REVIEW_RULE } from '../apps/web/worker/tutorialReview';
import { FIXABLE_KINDS } from '../server/tutorialFeedback';

/** The scripts around Claude's nightly look at the tutorial videos' feedback (decisions.md 186). */

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

describe('tutorial-review.mjs', () => {
  it('asks for a token the Worker takes, at the Worker\'s door, from the workflow the Worker lets in', () => {
    expect(AUDIENCE).toBe(REVIEW_RULE.audience);
    expect(new URL(API).pathname).toBe(REVIEW_PATH);
    const file = REVIEW_RULE.workflowRef.split('@')[0]!.split('/').slice(2).join('/');
    expect(file).toBe('.github/workflows/tutorial-review.yml');
    const yml = read(file);
    expect(yml).toContain('id-token: write');
    expect(yml).toContain('claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}');
    expect(yml).toContain('node scripts/tutorial-review.mjs fetch .tutorial-review');
    // After Claude, the script as checked out, from a copy made before Claude: Claude can write in the checkout.
    const copy = yml.indexOf('cp scripts/tutorial-review.mjs "$RUNNER_TEMP/look/scripts/"');
    expect(copy).toBeGreaterThan(0);
    expect(yml).toContain('cp server/tutorialFeedback.ts "$RUNNER_TEMP/look/server/"');
    expect(copy).toBeLessThan(yml.indexOf('anthropics/claude-code-action'));
    expect(yml).toContain('node "$RUNNER_TEMP/look/scripts/tutorial-review.mjs" check .tutorial-review');
    expect(yml).toContain('node "$RUNNER_TEMP/look/scripts/tutorial-review.mjs" send .tutorial-review');
    expect(yml).not.toContain('node scripts/tutorial-review.mjs send');
    // Claude mends a look the Worker would refuse once, before it is sent.
    expect(yml).toContain("if: steps.check.outputs.problems == 'yes'");
    expect(yml.indexOf('id: mend')).toBeLessThan(yml.indexOf('name: Send the look'));
    // Claude reads, searches, writes its look and reads git; it has no network and no shell besides. Both times.
    // Making an accepted change, it may edit files too, and nothing more.
    const tools = '--allowedTools "Read,Glob,Grep,Write,Bash(git log:*),Bash(git show:*),Bash(git diff:*)"';
    const making = '--allowedTools "Read,Glob,Grep,Edit,Write,Bash(git log:*),Bash(git show:*),Bash(git diff:*)"';
    expect(yml.split('claude_args:').slice(1).map((a) => a.split('\n')[0]!.trim())).toEqual([tools, tools, making]);
    expect(yml.split('allowed_bots: github-merge-queue')).toHaveLength(4);
    expect(existsSync(new URL('../.agents/skills/tutorial-review/SKILL.md', import.meta.url))).toBe(true);
  });

  it('finds a change\'s pull request in a squash or a merge subject', () => {
    expect(prOf('Say Done, not Save (#272)')).toBe(272);
    expect(prOf('Merge pull request #272 from genesis-ai-dev/done')).toBe(272);
    expect(prOf('A change pushed without one')).toBeNull();
    expect(prOf('Fix (#27) in the middle of a title')).toBeNull();
  });

  it('lists each change with its files, newest first, at most so many', () => {
    const log = ['a'.repeat(40), 'b'.repeat(40)].map((sha, n) => `${sha}\t2026-10-2${9 - n}T10:00:00Z\tChange ${n} (#${300 - n})`).join('\n') + '\n';
    expect(changesOf(log, (sha) => [`${sha.slice(0, 1)}.ts`])).toEqual([
      { sha: 'a'.repeat(40), at: '2026-10-29T10:00:00Z', subject: 'Change 0 (#300)', pr: 300, files: ['a.ts'] },
      { sha: 'b'.repeat(40), at: '2026-10-28T10:00:00Z', subject: 'Change 1 (#299)', pr: 299, files: ['b.ts'] }
    ]);
    const many = Array.from({ length: CHANGES_MAX + 5 }, (_, n) => `${String(n).padStart(40, '0')}\t2026-10-29T10:00:00Z\tc`).join('\n');
    expect(changesOf(many, () => [])).toHaveLength(CHANGES_MAX);
  });

  it('adds the commit and this run to what Claude wrote', () => {
    const env = { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'genesis-ai-dev/langquest-next', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
    expect(runUrl(env)).toBe('https://github.com/genesis-ai-dev/langquest-next/actions/runs/123');
    expect(runUrl({ ...env, GITHUB_RUN_ATTEMPT: '2' })).toBe('https://github.com/genesis-ai-dev/langquest-next/actions/runs/123/attempts/2');
    expect(withRun({ looked: [], sha: 'ignored' }, 'c'.repeat(40), env)).toEqual({ looked: [], sha: 'c'.repeat(40), runUrl: 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/123' });
  });

  describe('checking the look before it is sent', () => {
    const env = { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'genesis-ai-dev/langquest-next', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1' };
    const sha = 'c'.repeat(40);
    const comment = '11111111-2222-4333-8444-555555555555';
    const note = '66666666-7777-4888-8999-aaaaaaaaaaaa';
    const waiting = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    const state = {
      last: null,
      inputs: [{ id: comment, kind: 'comment', lookedAt: null }, { id: note, kind: 'note', lookedAt: null }],
      suggestions: [{ id: waiting, decision: null }]
    };
    const change = { sha: 'f40e52a0115f4fd50c461eed7bb4dbbed276161e', at: '2026-11-13T05:54:00Z', subject: 'Nearby sync (#403)', pr: 403, files: [] };
    const fine = {
      code: [{ key: 'pr-403-sync', sha: change.sha, tutorial: 'sync-nearby', pr: 403, title: 'Nearby sync', english: 'A new way to sync.', at: change.at }],
      comments: [{ id: comment, english: 'Thanks!', reply: '', replyEnglish: '' }],
      looked: [{ input: comment, outcome: 'Thanks only.' }],
      suggestions: [{ kind: 'new', tutorial: null, title: 'Show nearby sync', detail: 'A video of the new sync.', inputs: ['pr-403-sync'] }],
      attach: [{ suggestion: waiting, inputs: [note] }]
    };
    const problems = (review: unknown) => problemsOf(review, state, [change], sha, env);

    it('passes a look the Worker takes whole', async () => {
      expect(await problems(fine)).toEqual([]);
    });

    // Run 43406100298 (2026-11-13): looked[0] named a change, which the Worker refused, and the night was lost.
    it('says when a change that needs nothing was put in looked, by its commit or its pull request', async () => {
      for (const ref of [change.sha, change.sha.slice(0, 8), 403, 'pr-403', '#403']) {
        const found = await problems({ ...fine, looked: [{ input: ref, outcome: 'Nothing to change.' }, ...fine.looked] });
        expect(found[0]).toBe("The Worker would refuse the whole look: looked[0].input: an input's id or a code change's key.");
        expect(found[1]).toMatch(/^looked\[0\]\.input is .*: a change from changes\.json \(f40e52a0 "Nearby sync \(#403\)"\), not an input\. A change that needs nothing goes nowhere/);
        expect(found).toHaveLength(2);
      }
    });

    it('says how to write an entry that names no input, an id state.json does not have, a suggestion not waiting and an input left out', async () => {
      const other = '12345678-1234-4234-8234-123456789012';
      const found = await problems({ ...fine, looked: [{ id: comment, outcome: 'Thanks only.' }], attach: [{ suggestion: other, inputs: [other] }] });
      expect(found).toEqual([
        "The Worker would refuse the whole look: looked[0].input: an input's id or a code change's key.",
        'looked[0].input is missing: write each entry as { "input": "<an input\'s id>", "outcome": "<why nothing is suggested>" }.',
        `attach[0].inputs[0] is "${other}", which is no input's id in state.json. Name an input by its "id" from state.json's "inputs".`,
        `attach[0].suggestion is "${other}", which is no waiting suggestion's id in state.json.`,
        `Input ${comment} (a comment) is in no place: put it in a suggestion's inputs, in attach, or in looked with an outcome.`,
        `Input ${note} (a note) is in no place: put it in a suggestion's inputs, in attach, or in looked with an outcome.`
      ]);
    });

    it('says when a code change is in no place, and what the Worker would refuse besides', async () => {
      expect(await problems({ ...fine, suggestions: [], looked: [...fine.looked, { input: 'pr-9', outcome: 'x' }] })).toEqual([
        "The Worker would refuse the whole look: looked[1].input: an input's id or a code change's key.",
        'looked[1].input is "pr-9", which is no input\'s id in state.json and no key in code. Name an input by its "id" from state.json\'s "inputs", or a code change by its "key".',
        'code key "pr-403-sync" is in no place: name it in the suggestion it is for.'
      ]);
      expect(await problems({ ...fine, comments: [{ id: comment, english: 'Thanks!', reply: 'Use the calculator.', replyEnglish: '' }] }))
        .toEqual(["The Worker would refuse the whole look: comments[0].reply: never the phone's disguise (decisions.md 171)."]);
    });
  });

  describe('making an accepted change (decisions.md 186, amended 2026-11-13)', () => {
    const yml = read('.github/workflows/tutorial-review.yml');
    const jobs = Object.fromEntries(['look', 'queue', 'fix', 'check', 'open'].map((name) => {
      const start = yml.indexOf(`\n  ${name}:\n`);
      const next = yml.slice(start + 1).search(/\n  [a-z]+:\n/);
      return [name, next < 0 ? yml.slice(start) : yml.slice(start, start + 1 + next)];
    }));

    it('runs every 30 minutes, the look only at 10:00, at the Worker\'s door for fixes', () => {
      expect(yml).toContain("- cron: '0 10 * * *'");
      expect(yml).toContain("- cron: '20,50 * * * *'");
      expect(jobs.look).toContain("if: github.event_name != 'schedule' || github.event.schedule == '0 10 * * *'");
      expect(FIXES_PATH).toBe(`${REVIEW_PATH}/fixes`);
      expect(FIXES_PER_RUN).toBe(3);
      expect([...FIXABLE_KINDS]).toEqual(['script', 'screen', 'voice', 'instruction']);
      expect(FIXABLE).toEqual([...FIXABLE_KINDS]);
    });

    it('trusts each job less than the one before: Claude has no key, the check no key, the opener runs nothing of the patch', () => {
      expect(jobs.queue).toContain('node scripts/tutorial-review.mjs queue');
      expect(jobs.fix).not.toMatch(/id-token|contents: write|pull-requests|secrets\.(?!CLAUDE_CODE_OAUTH_TOKEN)/);
      expect(jobs.fix).toContain('persist-credentials: false');
      expect(jobs.fix.indexOf('cp scripts/tutorial-review.mjs')).toBeLessThan(jobs.fix.indexOf('anthropics/claude-code-action'));
      expect(jobs.fix).toContain('node "$RUNNER_TEMP/fix/tutorial-review.mjs" fix-patch .tutorial-fix');
      expect(jobs.fix).toContain('GIT_DIR: ${{ runner.temp }}/base.git');
      expect(jobs.check).not.toMatch(/secrets\.|id-token|contents: write|pull-requests/);
      expect(jobs.check.indexOf('fix-paths')).toBeLessThan(jobs.check.indexOf('git apply --index'));
      expect(jobs.check).toContain('package-manager-cache: false');
      expect(jobs.open).not.toMatch(/npm (ci|install)|npx /);
      expect(jobs.open).toContain('node scripts/tutorial-review.mjs fix-open .tutorial-fix');
      expect(yml).toContain('cp scripts/tutorial-review.mjs "$RUNNER_TEMP/fix/"');
    });

    it('says where a draft pull request is now', () => {
      expect(prStateOf({ state: 'closed', merged: true, merged_at: '2026-11-14T01:00:00Z' })).toBe('merged');
      expect(prStateOf({ state: 'closed', merged: false, merged_at: null })).toBe('closed');
      expect(prStateOf({ state: 'open', merged: false })).toBeNull();
      expect(fixBranch('0d000000-0000-4000-8000-000000000001')).toBe('tutorial-fix/0d000000');
    });

    it('lets a fix change only the video\'s own file and what other languages say', () => {
      expect(fixRefusal(['e2e/tutorials/record-a-passage.ts', 'e2e/tutorials/lines/fr.json', 'e2e/tutorials/lines/zh-Hans.json'], 2000, 'record-a-passage')).toBeNull();
      for (const [paths, why] of [
        [['e2e/tutorials/key-words.ts'], 'it changes e2e/tutorials/key-words.ts'],
        [['apps/mobile/src/i18n/en.json'], 'it changes apps/mobile/src/i18n/en.json'],
        [['e2e/tutorials/nightly.ts'], 'it changes e2e/tutorials/nightly.ts'],
        [['e2e/tutorials/lines/../../../.github/workflows/x.yml'], 'it changes e2e/tutorials/lines/../'],
        [['.github/workflows/tutorials.yml'], 'it changes .github/'],
        [[], 'it changes nothing']
      ] as const) expect(fixRefusal([...paths], 10, 'record-a-passage')).toMatch(new RegExp(`^${why.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      expect(fixRefusal(['e2e/tutorials/x.ts'], 10, '../x')).toBe('it names no video');
      expect(fixRefusal(['e2e/tutorials/record-a-passage.ts'], FIX_LIMITS.bytes + 1, 'record-a-passage')).toMatch(/KB, more than/);
    });

    it('takes Claude\'s summary or why there is none, and only the check\'s fixed words', () => {
      expect(checkFix({ summary: ' Step 9 says "Tap Done." ' })).toEqual({ summary: 'Step 9 says "Tap Done."', noFix: '' });
      expect(checkFix({ noFix: 'A code change.' })).toEqual({ summary: '', noFix: 'A code change.' });
      expect(checkFix(null).noFix).toBe('Claude wrote no summary of a change.');
      expect(checkFix({ summary: 'x'.repeat(5000) }).summary).toHaveLength(FIX_LIMITS.summary);
      expect(checkResults({ typecheck: 'passed', tests: 'all good, trust me' })).toEqual({ typecheck: 'passed', tests: 'not run' });
    });

    it('opens a pull request that says what was accepted, links what it answers and never quotes a commenter', () => {
      const suggestion = {
        id: '0d000000-0000-4000-8000-000000000001', kind: 'script', tutorial: 'choose-the-app-language', title: 'Say the whole word Language',
        detail: 'Step 2 cuts the G.\nSay it slowly.', inputs: [
          { kind: 'comment', language: 'en', at: '2026-11-12T08:00:00Z', ref: 'Ugabc123', youtubeId: 'dQw4w9WgXcQ', text: 'the G is cut off lol', english: 'The G is cut off', pr: null },
          { kind: 'code', at: '2026-11-11T08:00:00Z', ref: 'a'.repeat(40), pr: 389, text: 'x', english: 'y', language: null, youtubeId: null }
        ]
      };
      const { title, body } = fixPull(suggestion, { summary: 'Step 2 waits for the heading.', noFix: '' }, { typecheck: 'passed', tests: 'failed' }, 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/9');
      expect(title).toBe('Tutorial video choose-the-app-language: Say the whole word Language');
      expect(body).toContain('> Step 2 cuts the G.\n> Say it slowly.');
      expect(body).toContain('A comment on the YouTube channel in `en`, 2026-11-12 ([on YouTube](https://www.youtube.com/watch?v=dQw4w9WgXcQ&lc=Ugabc123))');
      expect(body).toContain('A change merged into main, 2026-11-11 (#389)');
      expect(body).toContain('typecheck passed; the videos\' tests **failed**');
      expect(body).not.toContain('the G is cut off');
      expect(body).not.toContain('The G is cut off');
    });

    it('opens an admin\'s instruction as the problem and what the admin said, never naming the disguise', () => {
      const instruction = {
        id: '0d000000-0000-4000-8000-000000000002', kind: 'instruction', tutorial: 'answer-feedback', language: 'en', title: 'Answer feedback (en): the film fails',
        detail: 'The button is now called On this device. Change the script.', inputs: []
      };
      const fix = { summary: 'Step 4 taps On this device.', noFix: '' };
      const { body } = fixPull(instruction, fix, { typecheck: 'passed', tests: 'passed' }, 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/9');
      expect(body).toContain('from an instruction an admin wrote on the ops dashboard');
      expect(body).toContain('**The problem** (en): Answer feedback (en): the film fails');
      expect(body).toContain('**The instruction:**\n\n> The button is now called On this device. Change the script.');
      const hidden = fixPull({ ...instruction, detail: 'Show the calculator instead.' }, fix, { typecheck: 'passed', tests: 'passed' }, 'https://x').body;
      expect(hidden).not.toMatch(/calculator/i);
    });

    it('gives Claude the film of the instruction\'s language: its pictures, log, failure screens, frame check and state', () => {
      expect(jobs.fix).toContain('-n "tutorials-$language"');
      expect(jobs.fix).toContain('const language = s.language ?? "en";');
      for (const part of ['.tutorial-fix/pictures', '.tutorial-fix/film/log.txt', '"$from"/failed-*', '"$from/check.json"', '.tutorial-fix/status.json', 'status-$language.json']) {
        expect(jobs.fix).toContain(part);
      }
    });
  });
});
