import { REPOSITORY } from '../../../server/tutorialFeedback';
import type { GithubRun, OidcRule } from './githubOidc';

/**
 * The door the filming knocks on when its films are in the release
 * (.github/workflows/tutorials.yml, docs/tutorial-videos.md, decisions.md
 * 192): `POST /api/tutorial-filmed` starts the intake job, which takes the
 * films in and then starts the publish job (jobsModel.ts `JOBS`), so the
 * videos go up as soon as they are made instead of at the next scheduled
 * time. An intake already running takes it in once more when it ends.
 *
 * Only that workflow, run from main, gets in, with the OpenID Connect token
 * GitHub gives the job (githubOidc.ts), as for the nightly look
 * (tutorialReview.ts): GitHub holds no key to production.
 */
export const FILMED_PATH = '/api/tutorial-filmed';
export const FILMED_RULE: OidcRule = {
  audience: 'https://next.langquest.org/api/tutorial-filmed',
  workflowRef: `${REPOSITORY}/.github/workflows/tutorials.yml@refs/heads/main`
};

export interface FilmedDeps {
  verify(token: string, rule: OidcRule): Promise<GithubRun | null>;
  /** Starts the intake, or has the run under way take the films in once more when it ends. */
  intake(): Promise<'started' | 'running' | 'disabled'>;
}

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export async function handleTutorialFilmed(request: Request, deps: FilmedDeps): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Only POST is supported.' });
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const run = token ? await deps.verify(token, FILMED_RULE).catch(() => null) : null;
  if (!run) return json(401, { error: `Only ${FILMED_RULE.workflowRef} gets in, with its GitHub OIDC token.` });
  return json(200, { intake: await deps.intake() });
}
