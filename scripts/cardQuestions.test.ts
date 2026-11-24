import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ANSWER_MAX, askedFor, AUDIENCE, cleanAnswer, EMAIL, finalAnswers, finalVerdicts, linearFor, webAsks, WHY_MAX } from './card-questions.mjs';
import { WHY_MAX as SERVER_WHY_MAX } from '../server/lineResolves';
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

describe('the verdicts on resolved lines', () => {
  const resolves = [{ id: A }, { id: B }, { id: 'not-an-id' }];
  it('keep the Worker\'s limit', () => expect(WHY_MAX).toBe(SERVER_WHY_MAX));

  it('send Claude\'s verdict and reason, and none for a resolve without one, so it waits for the next check', () => {
    expect(finalVerdicts(resolves, [{ id: A, verdict: 'back', why: ' A new month. ' }])).toEqual([
      { id: A, verdict: 'back', why: 'A new month.' },
      { id: B, verdict: 'none' }
    ]);
    // No reason, an address, or a verdict off the list: none.
    expect(finalVerdicts(resolves, [{ id: A, verdict: 'same' }, { id: B, verdict: 'same', why: 'Ask a@b.co' }]).map((v) => v.verdict)).toEqual(['none', 'none']);
    expect(finalVerdicts(resolves, [{ id: A, verdict: 'maybe', why: 'x' }])[0]!.verdict).toBe('none');
    expect((finalVerdicts(resolves, [{ id: A, verdict: 'same', why: 'x'.repeat(WHY_MAX + 9) }])[0] as { why: string }).why).toHaveLength(WHY_MAX);
    // Claude wrote no file: each resolve waits.
    expect(finalVerdicts(resolves, null)).toEqual([{ id: A, verdict: 'none' }, { id: B, verdict: 'none' }]);
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
    const copy = yml.indexOf('cp scripts/card-questions.mjs scripts/prod-read.mjs scripts/linear-sync.mjs "$RUNNER_TEMP/ask/"');
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
    expect(yml.match(/claude_code_oauth_token: \$\{\{ secrets\.AGENT_TEAM_CLAUDE_TOKEN \}\}/g)).toHaveLength(3);
    expect(yml).not.toContain('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('gives the Linear key only to the step after both Claudes that sends the answers back', () => {
    const steps = yml.split('\n      - ');
    const keyed = steps.filter((s) => s.includes('secrets.LINEAR_API_KEY'));
    expect(keyed).toHaveLength(1);
    expect(keyed[0]).toMatch(/^name: Make the changes in Linear admins asked for, and send the answers back/);
    expect(keyed[0]).toContain('card-questions.mjs" report');
    expect(keyed[0]).not.toContain('claude-code-action');
  });

  it('gives the Claude that checks resolved lines the same shell as the first, and no web', () => {
    const check = yml.split('\n      - ').find((s) => s.startsWith('name: Claude decides whether each problem came back'))!;
    expect(check).toContain('--allowedTools "Read,Glob,Grep,Write,Bash(git log:*),Bash(git show:*),Bash(node /home/runner/work/_temp/ask/prod-read.mjs:*)"');
    expect(check).not.toMatch(/WebFetch|WebSearch/);
    expect(check).toContain('.resolves/verdicts.json');
    expect(read('.agents/skills/card-questions/SKILL.md')).toContain('.resolves/verdicts.json');
  });

  it('has its skill', () => {
    expect(existsSync(new URL('../.agents/skills/card-questions/SKILL.md', import.meta.url))).toBe(true);
    expect(read('.agents/skills/card-questions/SKILL.md')).toContain('.questions/answers.json');
  });
});

// An admin asks for a change in Linear from a card ("LAN-158 is fixed now")
// (docs/decisions/2026-11-24-dashboard-claude-changes-linear-from-any-card.md).
describe('changes in Linear an admin asks for', () => {
  const C = '0e000000-0000-4000-8000-000000000003';
  const q = { id: C, card: 'page:tests', page: 'tests', title: 'Nightly tests', context: 'LAN-158 failed 3 nights', text: 'The iPhone one is fixed now.', at: '', before: [] };
  const fake = () => {
    const issue = { id: 'u', identifier: 'LAN-158', state: 'Todo', states: { Todo: 'a', Live: 'b' }, comments: [] as string[] };
    return { issue, api: { getIssue: async (id: string) => (id === 'LAN-158' ? issue : null), setState: async (i: typeof issue, to: string) => { i.state = to; }, update: async () => {}, comment: async (_: string, b: string) => { issue.comments.push(b); } } };
  };

  it('takes only issues the card or the question names', () => {
    expect(askedFor(q, { id: C, linear: [{ issue: 'LAN-158', status: 'Live' }, { issue: 'LAN-9', status: 'Canceled' }] })).toEqual({ changes: [{ issue: 'LAN-158', status: 'Live' }], refused: ['LAN-9'] });
    expect(askedFor({ ...q, context: '', text: 'Close LAN-9 too.' }, { id: C, linear: [{ issue: 'LAN-9', status: 'Canceled' }] }).changes).toHaveLength(1);
    expect(askedFor(q, { id: C, linear: [{ issue: 'LAN-158', comment: 'Ask a@b.org' }] }).changes).toEqual([]);
    expect(askedFor(q, { id: C, answer: 'x' })).toEqual({ changes: [], refused: [] });
  });

  it('makes them and puts what Linear did first in the answer', async () => {
    const { issue, api } = fake();
    const answers = [{ id: C, answer: 'The suite passed the last 2 nights.', web: null, linear: [{ issue: 'LAN-158', status: 'Live' }] }];
    const said = await linearFor([q], answers, api, 'https://run');
    expect(issue.state).toBe('Live');
    expect(finalAnswers([q], answers, [], said)[0]).toEqual({ id: C, taken: false, result: 'answered', answer: 'I set LAN-158 to Live in Linear.\n\nThe suite passed the last 2 nights.' });
  });

  it('changes nothing for an issue no one named, or with no Linear key', async () => {
    const { issue, api } = fake();
    expect((await linearFor([q], [{ id: C, answer: '', linear: [{ issue: 'LAN-9', status: 'Canceled' }] }], api)).get(C)).toBe('I did not change LAN-9: neither this card nor your question names it.');
    expect((await linearFor([q], [{ id: C, answer: '', linear: [{ issue: 'LAN-158', status: 'Live' }] }], null)).get(C)).toMatch(/no Linear key/);
    expect(issue.state).toBe('Todo');
    expect(await linearFor([q], null, api)).toEqual(new Map());
  });
});
