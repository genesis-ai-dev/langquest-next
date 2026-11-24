/**
 * A workflow of this repository started on main at once, when an admin sends
 * Claude a message from the ops dashboard
 * (docs/decisions/2026-11-24-a-message-to-claude-starts-its-run-at-once.md):
 * an instruction on a user issue starts the watch (user-issues.yml), and a
 * question on a card starts card-questions.yml. Without this the message
 * waited for the next scheduled run, which GitHub starts 5 to 25 minutes late.
 *
 * The token is OPS_RUN_GITHUB_TOKEN, a fine-grained token for this repository
 * alone with only Actions: Read and write (docs/admin.md). It can start, stop
 * or run again a workflow, and it reads and writes no code. Without it, or
 * when GitHub refuses it, nothing starts: the message waits for the schedule,
 * as before, and the page says so.
 */
export const RUN_REPO = 'genesis-ai-dev/langquest-next';
/** The only workflows the Worker starts. */
export const RUN_WORKFLOWS = ['user-issues.yml', 'card-questions.yml'] as const;
export type RunWorkflow = (typeof RUN_WORKFLOWS)[number];
/** What happened: started, no token here, GitHub's HTTP status when it refused, or no answer. */
export type RunStart = 'started' | 'no_token' | `refused_${number}` | 'error';

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export async function startRun(token: string | undefined, workflow: RunWorkflow, fetcher: Fetch = fetch): Promise<RunStart> {
  if (!token) return 'no_token';
  if (!RUN_WORKFLOWS.includes(workflow)) return 'refused_400';
  try {
    const res = await fetcher(`https://api.github.com/repos/${RUN_REPO}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28',
        'user-agent': 'langquest-next-ops', 'content-type': 'application/json'
      },
      body: JSON.stringify({ ref: 'main' }),
      signal: AbortSignal.timeout(5000)
    });
    // GitHub answers 204 (or 200 with the run's id, from 2026) when the run is made.
    return res.status === 204 || res.status === 200 ? 'started' : `refused_${res.status}`;
  } catch {
    return 'error';
  }
}
