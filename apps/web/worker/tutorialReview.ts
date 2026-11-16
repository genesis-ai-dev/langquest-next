import { parseFixUpdates, parseReview, REPOSITORY, ReviewError, type FixUpdate, type Review } from '../../../server/tutorialFeedback';
import type { JobRun } from '../../../server/jobRuns';
import type { GithubRun, OidcRule } from './githubOidc';

/**
 * The door Claude's nightly look at the tutorial videos' feedback uses
 * (.github/workflows/tutorial-review.yml, docs/tutorial-videos.md
 * "Feedback", decisions.md 186): `GET /api/tutorial-review` is what is open
 * (`ops_tutorial_review_state`), `POST` what the look made
 * (server/tutorialFeedback.ts `Review`, checked, then `ops_tutorial_reviewed`).
 * The same workflow's fix jobs (decisions.md 186, amended 2026-11-13) use
 * `GET /api/tutorial-review/fixes`, the accepted changes that wait for Claude
 * and the draft pull requests that wait for a person (`ops_tutorial_fixes`),
 * and `POST` there, where each fix is now (`FixUpdate`, `ops_tutorial_fixed`).
 *
 * Only that workflow, run from main, gets in: it sends the OpenID Connect
 * token GitHub gives the job, which names the workflow and its branch
 * (githubOidc.ts). GitHub holds no key to production; a branch, a fork or
 * another workflow is refused. Each look is recorded as a
 * `tutorial_review` job run, so a night without one shows on the ops
 * dashboard.
 */
export const REVIEW_PATH = '/api/tutorial-review';
export const FIXES_PATH = '/api/tutorial-review/fixes';
/** At most this many accepted changes are handed to one fix run. */
export const FIXES_PER_RUN = 3;
export const REVIEW_RULE: OidcRule = {
  audience: 'https://next.langquest.org/api/tutorial-review',
  workflowRef: `${REPOSITORY}/.github/workflows/tutorial-review.yml@refs/heads/main`
};
/** A night's look is a few hundred kilobytes at most. */
export const REVIEW_MAX_BYTES = 4 * 1024 * 1024;

export interface ReviewDeps {
  verify(token: string, rule: OidcRule): Promise<GithubRun | null>;
  state(): Promise<unknown>;
  reviewed(review: Review): Promise<{ review: number; code: number; looked: number; suggested: number; skipped: number }>;
  record(run: JobRun): Promise<void>;
  /** `ops_tutorial_fixes`: the accepted changes that wait for Claude, and the draft pull requests that wait for a person. */
  fixes(limit: number): Promise<unknown>;
  /** `ops_tutorial_fixed`: 'ok', 'not_found' or 'refused'. */
  fixed(update: FixUpdate, runUrl: string): Promise<string>;
  now(): number;
}

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export async function handleTutorialReview(request: Request, deps: ReviewDeps): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return json(405, { error: 'Only GET and POST are supported.' });
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const run = token ? await deps.verify(token, REVIEW_RULE).catch(() => null) : null;
  if (!run) return json(401, { error: `Only ${REVIEW_RULE.workflowRef} gets in, with its GitHub OIDC token.` });
  if (new URL(request.url).pathname === FIXES_PATH) return fixes(request, deps, run);
  if (request.method === 'GET') return json(200, await deps.state());

  const started = deps.now();
  const length = Number(request.headers.get('content-length') ?? NaN);
  if (Number.isFinite(length) && length > REVIEW_MAX_BYTES) return json(413, { error: `A look is at most ${REVIEW_MAX_BYTES / 1024 / 1024} MB.` });
  const text = await request.text();
  if (text.length > REVIEW_MAX_BYTES) return json(413, { error: `A look is at most ${REVIEW_MAX_BYTES / 1024 / 1024} MB.` });
  let review: Review;
  try {
    review = parseReview(JSON.parse(text));
  } catch (e) {
    const error = e instanceof ReviewError ? e.message : 'not JSON';
    await deps.record({ job: 'tutorial_review', startedAt: started, ms: deps.now() - started, outcome: 'error', errorClass: 'bad_review' });
    return json(400, { error });
  }
  // The run the token names is the run the look says it is.
  if (!review.runUrl.includes(`/actions/runs/${run.runId}`)) return json(400, { error: 'runUrl: this run\'s address' });
  const done = await deps.reviewed(review);
  await deps.record({
    job: 'tutorial_review', startedAt: started, ms: deps.now() - started, outcome: done.skipped ? 'partial' : 'ok',
    n: { code: done.code, looked: done.looked, suggested: done.suggested, skipped: done.skipped },
    ...(done.skipped ? { errorClass: 'unknown_ids' } : {})
  });
  return json(200, done);
}

/** The fix jobs' door: what waits, and where each fix is now. Each move is taken or refused on its own. */
async function fixes(request: Request, deps: ReviewDeps, run: GithubRun): Promise<Response> {
  if (request.method === 'GET') return json(200, await deps.fixes(FIXES_PER_RUN));
  const text = await request.text();
  if (text.length > 256 * 1024) return json(413, { error: 'At most 256 KB.' });
  let sent: ReturnType<typeof parseFixUpdates>;
  try {
    sent = parseFixUpdates(JSON.parse(text));
  } catch (e) {
    return json(400, { error: e instanceof ReviewError ? e.message : 'not JSON' });
  }
  if (!sent.runUrl.includes(`/actions/runs/${run.runId}`)) return json(400, { error: 'runUrl: this run\'s address' });
  const results: string[] = [];
  for (const update of sent.updates) results.push(await deps.fixed(update, sent.runUrl));
  return json(200, { results });
}
