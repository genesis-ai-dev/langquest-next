import { existsSync, readFileSync } from 'node:fs';
import { AUDIENCE, API, changesOf, CHANGES_MAX, prOf, runUrl, withRun } from './tutorial-review.mjs';
import { REVIEW_PATH, REVIEW_RULE } from '../apps/web/worker/tutorialReview';

/** The scripts around Claude's nightly look at the tutorial videos' feedback (decisions.md 185). */

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
    expect(yml).toContain('node scripts/tutorial-review.mjs send .tutorial-review');
    // Claude reads, searches, writes its look and reads git; it has no network and no shell besides.
    expect(yml).toContain('--allowedTools "Read,Glob,Grep,Write,Bash(git log:*),Bash(git show:*),Bash(git diff:*)"');
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
});
