import { WorkerEntrypoint } from 'cloudflare:workers';
import { lineIssues, watchLines, type WatchLine } from './alertKinds';
import { keepAlive, type Keep } from './auth';
import type { Env } from './env';
import { attention } from './index';

/**
 * One answer for the calls of one run of the watch, which asks for the lines and then what is there. Later
 * calls share it while it runs, so the call that starts it keeps it alive (auth.ts Keep).
 */
let lastAnswer: { until: number; value: ReturnType<typeof attention> } | null = null;
function answer(env: Env, keep?: Keep): ReturnType<typeof attention> {
  if (lastAnswer && lastAnswer.until > Date.now()) return lastAnswer.value;
  const value = keepAlive(attention(env, false, keep), keep);
  lastAnswer = { until: Date.now() + 30_000, value };
  value.catch(() => { lastAnswer = null; });
  return value;
}

/** A call's waitUntil, for the answer later calls share. Not a method, so no caller can call it over RPC. */
const keepOf = (ctx: ExecutionContext): Keep => (work) => ctx.waitUntil(work);

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
    return watchLines((await answer(this.env, keepOf(this.ctx))).items);
  }

  /**
   * Every line the page shows now and the parts that answered, so a resolved line whose problem went
   * ends, and shows when the problem comes back
   * (docs/decisions/2026-11-24-a-resolved-line-comes-back-with-its-problem.md).
   */
  async present(): Promise<{ lines: string[]; parts: string[] }> {
    const a = await answer(this.env, keepOf(this.ctx));
    return { lines: [...new Set(a.items.filter((i) => i.key !== 'unreadable').map((i) => i.id))], parts: a.answered };
  }

  /**
   * Each line the page shows now, with its level and words, so Claude can compare a resolved line's
   * words now with its words at the resolve (card-questions.yml, apps/web/worker/cardQuestions.ts).
   */
  async shown(): Promise<{ id: string; level: string; text: string }[]> {
    const a = await answer(this.env, keepOf(this.ctx));
    return a.items.filter((i) => i.key !== 'unreadable').map((i) => ({ id: i.id, level: i.level, text: i.text }));
  }

  /** The Linear issues the lines name themselves now (a nightly test's), for an admin's instruction on one. */
  async named(): Promise<string[]> {
    return lineIssues((await answer(this.env, keepOf(this.ctx))).items);
  }
}
