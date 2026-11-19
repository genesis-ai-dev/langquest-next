import { evidenceAsked, LookedError, parseLooked, type EvidenceAsk, type IssueNotes, type Looked, type Media, type Phone, type ResearchContext, type Watch } from '../../../server/userIssues';
import { REPOSITORY } from '../../../server/tutorialFeedback';
import type { JobRun } from '../../../server/jobRuns';
import type { GithubRun, OidcRule } from './githubOidc';

/**
 * The door the watch for user issues uses (.github/workflows/user-issues.yml,
 * docs/diagnostics.md "The watch for user issues", decisions.md 202):
 * `GET /api/user-issues` is what is new (`ops_user_issue_watch`), `POST` what
 * the workflow did about it (server/userIssues.ts `Looked`, checked, then
 * `ops_user_issues_looked`), including the issues closed or reopened in Linear.
 *
 * Only that workflow, run from main, gets in, with the OpenID Connect token
 * GitHub gives the job (githubOidc.ts), as the tutorial review's door does
 * (decision 186). GitHub holds no key to production. Each GET is recorded as
 * a `user_issue_watch` run, so a watch that stops shows on the ops dashboard,
 * and each POST as a `user_issue_look` run.
 *
 * `GET ?media=<feedback id>` and `GET ?phone=<install>&at=<time>` are what
 * Claude looks at besides the counts: a problem's screenshot and picture, and
 * that phone's build and records around the time (server/userIssues.ts
 * `evidenceAsked`, decisions.md 202 amended 2026-11-04). Not recorded as runs:
 * one look asks for several.
 *
 * `GET ?notes=<issue>` is what an admin told Claude to do with that issue from
 * its card on the ops dashboard, for the run that writes its fix, and a POST's
 * `notes` what the run did with each
 * (docs/decisions/2026-11-18-an-admin-tells-claude-what-to-do-with-a-user-issue.md).
 *
 * `GET ?research=1` is what the research team's lead reads one time each day
 * (docs/agent-team.md "The research team"): the watch's issues and the record
 * of each fix in Claude's own words, and the items of earlier runs. A POST's
 * `research` is what it found, and `handed` the issues of it that the watch
 * gave to the fix team.
 */
export const USER_ISSUES_PATH = '/api/user-issues';
export const USER_ISSUES_RULE: OidcRule = {
  audience: 'https://next.langquest.org/api/user-issues',
  workflowRef: `${REPOSITORY}/.github/workflows/user-issues.yml@refs/heads/main`
};
/** What one run sends back is a few kilobytes; 200 kinds with notes fit well under this. */
export const USER_ISSUES_MAX_BYTES = 512 * 1024;

export interface UserIssuesDeps {
  verify(token: string, rule: OidcRule): Promise<GithubRun | null>;
  watch(): Promise<Watch>;
  /** null: not there, an idea, or older than the watch hands over. */
  media(id: string): Promise<Media | null>;
  /** null: no such install. */
  phone(install: string, at: string | null): Promise<Phone | null>;
  /** One issue's instructions from the dashboard: those that wait, and the last answered ones. */
  notes(issue: string): Promise<IssueNotes>;
  /** What the research team's lead reads. */
  research(): Promise<ResearchContext>;
  looked(looked: Looked): Promise<{ looked: number; grew: number; closed?: number; reopened?: number; taken?: number; answered?: number; fixes?: number; research?: number; handed?: number }>;
  record(run: JobRun): Promise<void>;
  now(): number;
}

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export async function handleUserIssues(request: Request, deps: UserIssuesDeps): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return json(405, { error: 'Only GET and POST are supported.' });
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const run = token ? await deps.verify(token, USER_ISSUES_RULE).catch(() => null) : null;
  if (!run) return json(401, { error: `Only ${USER_ISSUES_RULE.workflowRef} gets in, with its GitHub OIDC token.` });
  const started = deps.now();

  if (request.method === 'GET') {
    let ask: EvidenceAsk | null;
    try {
      ask = evidenceAsked(new URL(request.url).searchParams);
    } catch (e) {
      return json(400, { error: e instanceof LookedError ? e.message : 'bad request' });
    }
    if (ask) {
      if ('notes' in ask) return json(200, await deps.notes(ask.notes));
      if ('research' in ask) return json(200, await deps.research());
      const found = 'media' in ask ? await deps.media(ask.media) : await deps.phone(ask.phone, ask.at);
      return found ? json(200, found) : json(404, { error: 'Not there, or not one the watch hands over.' });
    }
    let watch: Watch;
    try {
      watch = await deps.watch();
    } catch (e) {
      await deps.record({ job: 'user_issue_watch', startedAt: started, ms: deps.now() - started, outcome: 'error', errorClass: 'watch_failed' });
      throw e;
    }
    await deps.record({
      job: 'user_issue_watch', startedAt: started, ms: deps.now() - started, outcome: 'ok',
      n: { active: watch.active, look: watch.look.length, grew: watch.grew.length }
    });
    return json(200, watch);
  }

  const length = Number(request.headers.get('content-length') ?? NaN);
  const tooBig = `What a run sends back is at most ${USER_ISSUES_MAX_BYTES / 1024} KB.`;
  if (Number.isFinite(length) && length > USER_ISSUES_MAX_BYTES) return json(413, { error: tooBig });
  const text = await request.text();
  if (text.length > USER_ISSUES_MAX_BYTES) return json(413, { error: tooBig });
  let looked: Looked;
  try {
    looked = parseLooked(JSON.parse(text));
  } catch (e) {
    const error = e instanceof LookedError ? e.message : 'not JSON';
    await deps.record({ job: 'user_issue_look', startedAt: started, ms: deps.now() - started, outcome: 'error', errorClass: 'bad_looked' });
    return json(400, { error });
  }
  // The run the token names is the run the workflow says it is.
  if (!looked.runUrl.includes(`/actions/runs/${run.runId}`)) return json(400, { error: 'runUrl: this run\'s address' });
  const done = await deps.looked(looked);
  const verdicts = { filed: 0, known: 0, noise: 0, fixed: 0 };
  for (const l of looked.looked) verdicts[l.verdict] += 1;
  await deps.record({
    job: 'user_issue_look', startedAt: started, ms: deps.now() - started, outcome: 'ok',
    n: { looked: done.looked, ...verdicts, grew: done.grew, closed: done.closed ?? 0, reopened: done.reopened ?? 0, notesTaken: done.taken ?? 0, notesAnswered: done.answered ?? 0, fixes: done.fixes ?? 0, research: done.research ?? 0, handed: done.handed ?? 0 }
  });
  return json(200, done);
}
