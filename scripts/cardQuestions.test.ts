import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ANSWER_MAX, AUDIENCE, cleanAnswer, EMAIL, finalAnswers, webAsks } from './card-questions.mjs';
import { QUESTION_MAX } from '../server/cardQuestions';
import { EMAIL as SERVER_EMAIL } from '../server/userIssues';
import { CARD_QUESTIONS_RULE } from '../apps/web/worker/cardQuestions';
import { READ_WORKFLOWS } from '../apps/admin/src/read';

/** The workflow that answers questions from the ops dashboard's cards (docs/decisions/2026-11-23-ask-claude-from-every-dashboard-card.md). */

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const A = '0e000000-0000-4000-8000-000000000001', B = '0e000000-0000-4000-8000-000000000002';
const questions = [
  { id: A, card: 'line:capacity-r2-class-a', page: 'storage', title: 'R2 class A', context: 'What people wrote can be here', text: 'What does it cost?', at: '', before: [] },
  { id: B, card: 'page:storage', page: 'storage', title: 'Storage and cost', context: '', text: 'Duplicates?', at: '', before: [] }
];

describe('the answers', () => {
  it('keep the Worker\'s limits', () => {
    expect(ANSWER_MAX).toBe(QUESTION_MAX.answer);
    expect(EMAIL.source).toBe(SERVER_EMAIL.source);
    expect(AUDIENCE).toBe(CARD_QUESTIONS_RULE.audience);
  });

  it('are cut to the limit, and dropped when they hold an address', () => {
    expect(cleanAnswer('  About $20.  ')).toBe('About $20.');
    expect(cleanAnswer('x'.repeat(ANSWER_MAX + 50))).toHaveLength(ANSWER_MAX);
    expect(cleanAnswer('Write to a@b.co')).toBeNull();
    expect(cleanAnswer('')).toBeNull();
    expect(cleanAnswer(7)).toBeNull();
  });

  it('give the web step the question and the draft, never the card\'s words', () => {
    const asks = webAsks(questions, [{ id: A, answer: 'Draft.', web: 'R2 prices today.' }, { id: B, answer: 'No.', web: null }]);
    expect(asks).toEqual([{ id: A, title: 'R2 class A', question: 'What does it cost?', lookUp: 'R2 prices today.', draft: 'Draft.' }]);
    expect(JSON.stringify(asks)).not.toContain('What people wrote');
    expect(webAsks(questions, null)).toEqual([]);
  });

  it('take the web step\'s answer first, else the first one, else none; and none at all when Claude wrote no file', () => {
    expect(finalAnswers(questions, [{ id: A, answer: 'Draft.' }], [{ id: A, answer: 'Whole answer.' }])).toEqual([
      { id: A, taken: false, result: 'answered', answer: 'Whole answer.' },
      { id: B, taken: false, result: 'none' }
    ]);
    expect(finalAnswers(questions, [{ id: A, answer: 'Draft.' }, { id: B, answer: 'Yes.' }], [{ id: A, answer: 'a@b.co' }])[0]).toEqual({ id: A, taken: false, result: 'answered', answer: 'Draft.' });
    expect(finalAnswers(questions, null, [])).toEqual([]);
  });
});

describe('the workflow', () => {
  const yml = read('.github/workflows/card-questions.yml');

  it('is let in by the Worker\'s door and the read gate, from main', () => {
    expect(CARD_QUESTIONS_RULE.workflowRef).toBe('genesis-ai-dev/langquest-next/.github/workflows/card-questions.yml@refs/heads/main');
    expect(READ_WORKFLOWS).toContain('card-questions.yml');
    expect(yml).toContain('id-token: write');
  });

  it('copies its scripts before Claude, and runs them from the copy after', () => {
    const copy = yml.indexOf('cp scripts/card-questions.mjs scripts/prod-read.mjs "$RUNNER_TEMP/ask/"');
    expect(copy).toBeGreaterThan(0);
    expect(copy).toBeLessThan(yml.indexOf('anthropics/claude-code-action'));
    expect(yml).not.toMatch(/run: node scripts\//);
  });

  it('gives the first Claude a shell for git and the read gate only, and the second the web and no shell', () => {
    const steps = yml.split('\n      - ');
    const first = steps.find((s) => s.startsWith('name: Claude answers'))!;
    const second = steps.find((s) => s.startsWith('name: Claude looks them up'))!;
    expect(first).toContain('--allowedTools "Read,Glob,Grep,Write,Bash(git log:*),Bash(git show:*),Bash(node /home/runner/work/_temp/ask/prod-read.mjs:*)"');
    expect(first).not.toMatch(/WebFetch|WebSearch/);
    expect(second).toContain('--allowedTools "Read,Write,WebFetch,WebSearch" --disallowedTools "Bash"');
    expect(second).toContain('.questions/web.json');
    expect(yml.match(/claude_code_oauth_token: \$\{\{ secrets\.AGENT_TEAM_CLAUDE_TOKEN \}\}/g)).toHaveLength(2);
    expect(yml).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('has its skill', () => {
    expect(existsSync(new URL('../.agents/skills/card-questions/SKILL.md', import.meta.url))).toBe(true);
    expect(read('.agents/skills/card-questions/SKILL.md')).toContain('.questions/answers.json');
  });
});
