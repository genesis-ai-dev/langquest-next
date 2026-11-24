import { describe, expect, it } from 'vitest';
import { CARD_QUESTIONS_RULE, handleCardQuestions, type CardQuestionsDeps } from '../worker/cardQuestions';
import { AnsweredError, CARD, parseAnswered, QUESTION_MAX, type Answered, type CardQuestion } from '../../../server/cardQuestions';

/** Questions from the ops dashboard's cards (docs/decisions/2026-11-23-ask-claude-from-every-dashboard-card.md): who gets in, and what it may send back. */

const RUN = 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/123456';
const ID = '0e000000-0000-4000-8000-000000000001';
const waiting: CardQuestion[] = [{
  id: ID, card: 'line:capacity-r2-class-a', page: 'storage', title: 'R2 class A operations are past the plan',
  context: 'Recording uploads this month 5,524,967 of 1,000,000 free', text: 'What does this cost?', at: '2026-11-23T23:40:00Z', before: []
}];

function deps() {
  const done: Answered[] = [];
  const d: CardQuestionsDeps = {
    verify: async (token, rule) => (token === 'good' && rule === CARD_QUESTIONS_RULE ? { runId: '123456', workflowRef: rule.workflowRef } as never : null),
    waiting: async () => waiting,
    done: async (a) => { done.push(a); return { taken: a.questions.filter((q) => q.taken).length, answered: a.questions.filter((q) => !q.taken).length }; }
  };
  return { d, done };
}
const req = (method: string, auth: string | null, body?: unknown) =>
  new Request('https://next.langquest.org/api/card-questions', { method, headers: auth ? { authorization: `Bearer ${auth}` } : {}, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });

describe('a card', () => {
  it('is a line\'s or a page\'s, with no control characters', () => {
    for (const c of ['line:capacity-r2-class-a', 'line:user-issues-open:LAN-12', 'page:storage', 'page:start', 'line:a "quoted" <subject>']) expect(CARD.test(c), c).toBe(true);
    for (const c of ['feedback:x', 'line:', 'page:a\nb', `line:${'x'.repeat(201)}`, 'LINE:x']) expect(CARD.test(c), c).toBe(false);
  });
});

describe('what the workflow sends back', () => {
  it('takes a question taken, an answer, or a run that ended without one', () => {
    expect(parseAnswered({ runUrl: RUN, questions: [{ id: ID, taken: true }] }).questions).toEqual([{ id: ID, taken: true }]);
    expect(parseAnswered({ runUrl: RUN, questions: [{ id: ID, taken: false, result: 'answered', answer: 'About $20 so far.' }] }).questions)
      .toEqual([{ id: ID, taken: false, result: 'answered', answer: 'About $20 so far.' }]);
    expect(parseAnswered({ runUrl: RUN, questions: [{ id: ID, taken: false, result: 'none' }] }).questions).toEqual([{ id: ID, taken: false, result: 'none', answer: null }]);
  });

  it('refuses an address, a long answer, an answer missing, a question twice and another repository\'s run', () => {
    const bad = (q: unknown, runUrl = RUN) => () => parseAnswered({ runUrl, questions: [q] });
    expect(bad({ id: ID, taken: false, result: 'answered', answer: 'Write to someone@example.org.' })).toThrow(AnsweredError);
    expect(bad({ id: ID, taken: false, result: 'answered', answer: 'x'.repeat(QUESTION_MAX.answer + 1) })).toThrow(AnsweredError);
    expect(bad({ id: ID, taken: false, result: 'answered' })).toThrow(AnsweredError);
    expect(bad({ id: ID, taken: false, result: 'none', answer: 'x' })).toThrow(AnsweredError);
    expect(bad({ id: 'not-an-id', taken: true })).toThrow(AnsweredError);
    expect(bad({ id: ID, taken: true }, 'https://github.com/someone/else/actions/runs/1')).toThrow(AnsweredError);
    expect(() => parseAnswered({ runUrl: RUN, questions: [{ id: ID, taken: true }, { id: ID, taken: true }] })).toThrow(AnsweredError);
  });
});

describe('the door', () => {
  it('is for card-questions.yml run from main, and nothing else', () => {
    expect(CARD_QUESTIONS_RULE).toEqual({
      audience: 'https://next.langquest.org/api/card-questions',
      workflowRef: 'genesis-ai-dev/langquest-next/.github/workflows/card-questions.yml@refs/heads/main'
    });
  });

  it('lets in only that workflow\'s token', async () => {
    const { d, done } = deps();
    expect((await handleCardQuestions(req('GET', null), d)).status).toBe(401);
    expect((await handleCardQuestions(req('GET', 'stolen'), d)).status).toBe(401);
    expect((await handleCardQuestions(req('POST', 'stolen', { runUrl: RUN, questions: [] }), d)).status).toBe(401);
    expect((await handleCardQuestions(req('DELETE', 'good'), d)).status).toBe(405);
    expect(done).toEqual([]);
  });

  it('hands over the questions that wait, never kept by a cache', async () => {
    const res = await handleCardQuestions(req('GET', 'good'), deps().d);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual(waiting);
  });

  it('takes what this run did, and refuses what another run says or what does not check', async () => {
    const { d, done } = deps();
    const ok = await handleCardQuestions(req('POST', 'good', { runUrl: RUN, questions: [{ id: ID, taken: false, result: 'answered', answer: 'About $20.' }] }), d);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ taken: 0, answered: 1 });
    expect((await handleCardQuestions(req('POST', 'good', { runUrl: 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/9', questions: [] }), d)).status).toBe(400);
    expect((await handleCardQuestions(req('POST', 'good', 'not json'), d)).status).toBe(400);
    expect((await handleCardQuestions(req('POST', 'good', { runUrl: RUN, questions: [{ id: ID, taken: false, result: 'answered', answer: 'a@b.co' }] }), d)).status).toBe(400);
    expect(done).toHaveLength(1);
  });
});
