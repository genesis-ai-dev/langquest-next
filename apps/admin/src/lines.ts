import { WorkerEntrypoint } from 'cloudflare:workers';
import { lineIssues, watchLines, type WatchLine } from './alertKinds';
import type { Env } from './env';
import { attention } from './index';

/**
 * What the app Worker may ask this one, over a service binding with
 * `entrypoint: "OpsLines"` (apps/web/wrangler.jsonc): the dashboard's lines
 * that need a Linear issue, for the watch for user issues to hand to Claude
 * (decisions.md 202; docs/decisions/2026-11-17-each-ops-line-has-a-linear-issue.md).
 * Read-only methods. The page's API still checks a person's sign-in on
 * every call; this needs none, because only the app Worker's own code can
 * call it, and it says nothing a Global Viewer could not see.
 */
export class OpsLines extends WorkerEntrypoint<Env> {
  async lines(): Promise<WatchLine[]> {
    return watchLines((await attention(this.env, false)).items);
  }

  /** The Linear issues the lines name themselves now (a nightly test's), for an admin's instruction on one. */
  async named(): Promise<string[]> {
    return lineIssues((await attention(this.env, false)).items);
  }
}
