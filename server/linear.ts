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

/** An issue's status in Linear, as ops.user_issues keeps it (migration 20261124200000_user_issue_states_now.sql). */
export interface IssueState { issue: string; state: string; closed: boolean; closedAt: string | null; fixedBy: number | null }

/**
 * An issue as the Releases page's line of merges shows it
 * (docs/decisions/2026-11-26-release-timeline-on-the-releases-page.md): its
 * title, when it was reported, and its status.
 */
export interface IssueInfo { issue: string; title: string; createdAt: string; state: string; closed: boolean }

/** A pull request of this repository that Linear links to an issue (scripts/user-issues.mjs PR_URL). */
const PR_LINK = /^https:\/\/github\.com\/genesis-ai-dev\/langquest-next\/pull\/([0-9]{1,8})/;

/** Whether a status closes an issue for the watch: done, canceled or a duplicate, but not Outage (scripts/user-issues.mjs isClosed). */
export const isClosedState = (s: { name: string; type: string }) => s.type === 'completed' || ((s.type === 'canceled' || s.type === 'duplicate') && s.name !== 'Outage');

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
  const numbersOf = (identifiers: string[]) =>
    [...new Set(identifiers.map((id) => Number(id.split('-')[1])).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 100);
  return {
    /**
     * The team's issues by their ids (LAN-12), at most 100: each one's status, whether that status closes it
     * (scripts/user-issues.mjs isClosed: done, canceled or a duplicate; not Outage), and when it closed.
     */
    async states(identifiers: string[]): Promise<IssueState[]> {
      const numbers = numbersOf(identifiers);
      if (!numbers.length) return [];
      const data = await gql<{ issues: { nodes: { identifier: string; state: { name: string; type: string }; completedAt: string | null; canceledAt: string | null; attachments: { nodes: { url: string }[] } }[] } }>(
        `query($key: String!, $numbers: [Float!]) { issues(first: 100, filter: { team: { key: { eq: $key } }, number: { in: $numbers } }) {
          nodes { identifier state { name type } completedAt canceledAt attachments { nodes { url } } } } }`, { key: TEAM_KEY, numbers });
      return data.issues.nodes.map((i) => {
        const prs = i.attachments.nodes.map((a) => Number(PR_LINK.exec(a.url ?? '')?.[1])).filter((n) => n > 0);
        return { issue: i.identifier, state: i.state.name, closed: isClosedState(i.state), closedAt: i.completedAt ?? i.canceledAt ?? null, fixedBy: prs.length ? Math.max(...prs) : null };
      });
    },
    /** The team's issues by their ids, at most 100: each one's title, when it was made, and its status. */
    async info(identifiers: string[]): Promise<IssueInfo[]> {
      const numbers = numbersOf(identifiers);
      if (!numbers.length) return [];
      const data = await gql<{ issues: { nodes: { identifier: string; title: string; createdAt: string; state: { name: string; type: string } }[] } }>(
        `query($key: String!, $numbers: [Float!]) { issues(first: 100, filter: { team: { key: { eq: $key } }, number: { in: $numbers } }) {
          nodes { identifier title createdAt state { name type } } } }`, { key: TEAM_KEY, numbers });
      return data.issues.nodes.map((i) => ({ issue: i.identifier, title: i.title.slice(0, 300), createdAt: i.createdAt, state: i.state.name, closed: isClosedState(i.state) }));
    },
    /**
     * Closes one of the team's issues: as done (the team's first status of the kind `completed`: Live) or as
     * needing no fix (the first `canceled` one that is not Outage). Returns the status's name.
     */
    async close(identifier: string, as: 'completed' | 'canceled'): Promise<string> {
      const data = await gql<{ issue: { id: string; team: { states: { nodes: { id: string; name: string; type: string; position: number }[] } } } | null }>(
        `query($id: String!) { issue(id: $id) { id team { states { nodes { id name type position } } } } }`, { id: identifier });
      if (!data.issue) throw new LinearError('not_found');
      const state = data.issue.team.states.nodes.filter((n) => n.type === as && n.name !== 'Outage').sort((a, b) => a.position - b.position)[0];
      if (!state) throw new LinearError('no_state');
      const done = await gql<{ issueUpdate: { success: boolean } }>(`mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`,
        { id: data.issue.id, input: { stateId: state.id } });
      if (!done.issueUpdate.success) throw new LinearError('not_changed');
      return state.name;
    },
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
