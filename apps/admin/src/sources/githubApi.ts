import { getJson } from '../section';

/** What a source needs to read this repository on GitHub. */
export interface GitHubEnv { GITHUB_REPO: string; ADMIN_GITHUB_TOKEN?: string }

/** Reads `path` under the repository on GitHub's API; the repository is public, so the token only lifts the anonymous rate limit. */
export function githubApi(env: GitHubEnv, fetcher: typeof fetch): <T>(path: string, what: string) => Promise<T> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'langquest-next-admin',
    ...(env.ADMIN_GITHUB_TOKEN ? { authorization: `Bearer ${env.ADMIN_GITHUB_TOKEN}` } : {})
  };
  const api = `https://api.github.com/repos/${env.GITHUB_REPO}`;
  const anonymous = env.ADMIN_GITHUB_TOKEN ? '' : ' Without ADMIN_GITHUB_TOKEN, GitHub limits anonymous calls per address, which a Worker shares.';
  return <T>(path: string, what: string) => getJson<T>(fetcher, `${api}${path}`, { headers }, what)
    .catch((e: Error) => { throw new Error(`${e.message}${anonymous}`); });
}
