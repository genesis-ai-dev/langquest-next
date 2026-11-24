import { AnsweredError, parseAnswered, type Answered, type CardQuestion } from '../../../server/cardQuestions';
import { CheckedError, parseChecked, type Checked, type DueResolve } from '../../../server/lineResolves';
import { REPOSITORY } from '../../../server/tutorialFeedback';
import type { GithubRun, OidcRule } from './githubOidc';

/**
 * The door the workflow that answers questions from the ops dashboard uses
 * (.github/workflows/card-questions.yml,
 * docs/decisions/2026-11-23-ask-claude-from-every-dashboard-card.md):
 * `GET /api/card-questions` is the questions that wait
 * (`ops_card_questions_waiting`), `POST` what the run did with them
 * (server/cardQuestions.ts `Answered`, checked, then `ops_card_questions_done`).
 * The same workflow has Claude check the resolved lines of the dashboard
 * (docs/decisions/2026-11-24-a-resolved-line-comes-back-with-its-problem.md):
 * `GET ?resolves=1` is the resolves to check, each with its line's words now
 * (server/lineResolves.ts `DueResolve`), and a `POST` with `resolves` is
 * Claude's verdicts (`Checked`, then `ops_line_resolves_checked`).
 *
 * Only that workflow, run from main, gets in, with the OpenID Connect token
 * GitHub gives the job (githubOidc.ts), as the watch for user issues' door
 * does (userIssues.ts). GitHub holds no key to production.
 */
export const CARD_QUESTIONS_PATH = '/api/card-questions';
export const CARD_QUESTIONS_RULE: OidcRule = {
  audience: 'https://next.langquest.org/api/card-questions',
  workflowRef: `${REPOSITORY}/.github/workflows/card-questions.yml@refs/heads/main`
};
/** Twenty answers of 8000 characters fit well under this. */
export const CARD_QUESTIONS_MAX_BYTES = 256 * 1024;

export interface CardQuestionsDeps {
  verify(token: string, rule: OidcRule): Promise<GithubRun | null>;
  waiting(): Promise<CardQuestion[]>;
  done(answered: Answered): Promise<{ taken: number; answered: number }>;
  /** Before the migration or the admin Worker's lines are there, the door says 503 and the workflow goes on. */
  dueResolves?(): Promise<DueResolve[]>;
  checked?(checked: Checked): Promise<{ checked: number }>;
}

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export async function handleCardQuestions(request: Request, deps: CardQuestionsDeps): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return json(405, { error: 'Only GET and POST are supported.' });
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const run = token ? await deps.verify(token, CARD_QUESTIONS_RULE).catch(() => null) : null;
  if (!run) return json(401, { error: `Only ${CARD_QUESTIONS_RULE.workflowRef} gets in, with its GitHub OIDC token.` });
  const resolves = new URL(request.url).searchParams.get('resolves') === '1';
  if (request.method === 'GET') {
    if (!resolves) return json(200, await deps.waiting());
    return deps.dueResolves ? json(200, await deps.dueResolves()) : json(503, { error: 'Resolved lines are not checked here.' });
  }

  const length = Number(request.headers.get('content-length') ?? NaN);
  const tooBig = `What a run sends back is at most ${CARD_QUESTIONS_MAX_BYTES / 1024} KB.`;
  if (Number.isFinite(length) && length > CARD_QUESTIONS_MAX_BYTES) return json(413, { error: tooBig });
  const text = await request.text();
  if (text.length > CARD_QUESTIONS_MAX_BYTES) return json(413, { error: tooBig });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'not JSON' });
  }
  if (typeof body === 'object' && body !== null && 'resolves' in body) {
    if (!deps.checked) return json(503, { error: 'Resolved lines are not checked here.' });
    let checked: Checked;
    try {
      checked = parseChecked(body);
    } catch (e) {
      return json(400, { error: e instanceof CheckedError ? e.message : 'not checked' });
    }
    if (!checked.runUrl.includes(`/actions/runs/${run.runId}`)) return json(400, { error: 'runUrl: this run\'s address' });
    return json(200, await deps.checked(checked));
  }
  let answered: Answered;
  try {
    answered = parseAnswered(body);
  } catch (e) {
    return json(400, { error: e instanceof AnsweredError ? e.message : 'not JSON' });
  }
  // The run the token names is the run the workflow says it is.
  if (!answered.runUrl.includes(`/actions/runs/${run.runId}`)) return json(400, { error: 'runUrl: this run\'s address' });
  return json(200, await deps.done(answered));
}
