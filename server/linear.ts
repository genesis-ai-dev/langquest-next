import type { Fetch } from './youtube';

/**
 * Filing an issue in Linear from a server job (decisions.md 186), as
 * scripts/nightly-report.mjs does from GitHub: in the LangQuest Next team,
 * left unassigned for triage. The key is a Linear personal API key
 * (LINEAR_API_KEY in .env.production, given to the job by the app's Worker).
 */

/** The LangQuest Next team (scripts/linear-sync.mjs TEAM_KEY). */
export const TEAM_KEY = 'LAN';

/** A call Linear refused, by a fixed code. */
export class LinearError extends Error {
  constructor(readonly code: string) {
    super(`linear ${code}`);
    this.name = 'LinearError';
  }
}

export function linearIssues(fetcher: Fetch, key: string) {
  async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetcher('https://api.linear.app/graphql', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: key }, body: JSON.stringify({ query, variables })
    });
    const json = (await res.json().catch(() => ({}))) as { data?: T; errors?: { extensions?: { code?: string } }[] };
    if (!res.ok || json.errors || !json.data) throw new LinearError(json.errors?.[0]?.extensions?.code?.toLowerCase().replace(/[^a-z0-9_]/g, '') || String(res.status));
    return json.data;
  }
  let teamId: string | undefined;
  return {
    /** A new issue; its identifier (LAN-170) and address. */
    async create(title: string, description: string): Promise<{ identifier: string; url: string }> {
      teamId ??= (await gql<{ teams: { nodes: { id: string }[] } }>(`query($key: String!) { teams(filter: { key: { eq: $key } }) { nodes { id } } }`, { key: TEAM_KEY })).teams.nodes[0]?.id;
      if (!teamId) throw new LinearError('no_team');
      const data = await gql<{ issueCreate: { issue: { identifier: string; url: string } } }>(`mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) { issue { identifier url } } }`, { input: { teamId, title, description } });
      return data.issueCreate.issue;
    }
  };
}
