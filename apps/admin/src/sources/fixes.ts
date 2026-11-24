import { ok, type Section } from '../section';
import { githubApi, type GitHubEnv } from './githubApi';

/**
 * The pull requests that name a Linear issue (LAN-284) in their title or
 * body, as every commit from an issue already does (AGENTS.md): open ones
 * and those merged in the last 14 days, newest updated first. Each line of
 * the dashboard has a Linear issue (alertKinds.ts), so a pull request that
 * names it is that line's fix, seen at once, before the watch next reads
 * Linear (docs/decisions/2026-11-17-each-ops-line-has-a-linear-issue.md).
 * Only numbers, titles, times and issue ids are kept, never a login.
 */

export interface FixPr {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'merged';
  mergedAt: string | null;
  /** Linear issues its title or body names. */
  issues: string[];
}

export interface Fixes { repo: string; since: string; prs: FixPr[] }

interface Pull { number: number; title: string; html_url: string; state: string; merged_at: string | null; updated_at: string; body: string | null; base?: { ref: string } }

/** How far back a merged fix counts: a line fixed longer ago that still shows is a new problem. */
export const FIX_DAYS = 14;
/** Pages of 100 pull requests, newest updated first: three hold about 14 days at this repository's pace. */
const PAGES = 3;
const MAX_ISSUES = 20;
/** A Linear issue id; the team's key is LAN (scripts/linear-sync.mjs TEAM_KEY). */
const ISSUE = /\bLAN-\d{1,7}\b/g;

/** The Linear issues a title and body name, each once. */
export function namedIssues(...texts: (string | null | undefined)[]): string[] {
  return [...new Set(texts.flatMap((t) => String(t ?? '').match(ISSUE) ?? []))].slice(0, MAX_ISSUES);
}

export function fixPrs(pulls: Pull[], now = Date.now()): FixPr[] {
  const since = now - FIX_DAYS * 86_400_000;
  return pulls.flatMap((p): FixPr[] => {
    const merged = p.merged_at !== null;
    if (p.state !== 'open' && !merged) return [];
    // A copy onto a release branch (decisions.md 155) is not the fix: the merge into main is.
    if (p.base && p.base.ref !== 'main') return [];
    if (merged && Date.parse(p.merged_at!) < since) return [];
    const issues = namedIssues(p.title, p.body);
    if (!issues.length) return [];
    return [{ number: p.number, title: p.title.slice(0, 200), url: p.html_url, state: merged ? 'merged' : 'open', mergedAt: p.merged_at, issues }];
  });
}

export async function fixesSection(env: GitHubEnv, fetcher: typeof fetch = fetch, now = Date.now()): Promise<Section<Fixes>> {
  const gh = githubApi(env, fetcher);
  const since = now - FIX_DAYS * 86_400_000;
  const pulls: Pull[] = [];
  for (let page = 1; page <= PAGES; page++) {
    const got = await gh<Pull[]>(`/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`, 'GitHub pull requests');
    pulls.push(...got);
    if (got.length < 100 || Date.parse(got[got.length - 1]!.updated_at) < since) break;
  }
  return ok({ repo: env.GITHUB_REPO, since: new Date(since).toISOString(), prs: fixPrs(pulls, now) });
}
