import { describe, expect, it } from 'vitest';
import { REPLACE_LABEL, REPO, asksReplace, choiceForCommit, choiceForVersion, versionMinute } from './store-choice.mjs';
// @ts-expect-error CommonJS app config, read for its helper
import appConfig from '../apps/mobile/app.config.js';

/**
 * Whether a merge asks to replace the build in store review
 * (scripts/store-choice.mjs, decisions.md 157 amended 2026-11-04): the
 * label `store: replace review` on its pull request, read from GitHub's
 * public API. Anything that cannot be read is a wait.
 */

const pull = (number: number, labels: string[] = []) => ({ number, labels: labels.map((name) => ({ name })) });

/** GitHub's public API for one merge at 2026-11-04T18:02:41Z, as far as the lookup uses it. */
function fakeGitHub(labels: string[], { down = false } = {}) {
  const asked: string[] = [];
  const fetch = async (url: string) => {
    asked.push(url);
    const answer = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
    if (down) return answer(403, { message: 'API rate limit exceeded' });
    if (url === `https://api.github.com/repos/${REPO}/commits/abc1234def/pulls`) return answer(200, [pull(400, labels)]);
    if (url.startsWith(`https://api.github.com/repos/${REPO}/commits?sha=main&since=2026-11-04T18:02:00.000Z&until=2026-11-04T18:02:59.999Z`)) {
      return answer(200, [{ sha: 'abc1234def' }]);
    }
    if (url.startsWith(`https://api.github.com/repos/${REPO}/commits?`)) return answer(200, []);
    return answer(404, { message: 'Not Found' });
  };
  return { fetch: fetch as never, asked };
}

describe('the label', () => {
  it('asks for a replace only when a pull request carries it', () => {
    expect(asksReplace([pull(1, ['bug']), pull(2, [REPLACE_LABEL])])).toBe(true);
    expect(asksReplace([pull(1, ['bug', 'store'])])).toBe(false);
    expect(asksReplace([])).toBe(false);
    expect(REPLACE_LABEL).toBe('store: replace review');
  });

  it('is read for a merge commit', async () => {
    expect(await choiceForCommit('abc1234def', { fetch: fakeGitHub([REPLACE_LABEL]).fetch, env: {} })).toEqual({
      replace: true, why: '#400 has the label "store: replace review", so its build replaces the one in review'
    });
    expect((await choiceForCommit('abc1234def', { fetch: fakeGitHub(['docs']).fetch, env: {} })).replace).toBe(false);
  });

  it('is read for a store version, through the merge that made it', async () => {
    const github = fakeGitHub([REPLACE_LABEL]);
    expect(await choiceForVersion('2026.1104.1802', { fetch: github.fetch, env: {} })).toEqual({
      replace: true, why: '2026.1104.1802 came from #400, labelled "store: replace review"'
    });
    expect(github.asked).toHaveLength(2);
    expect((await choiceForVersion('2026.1104.1803', { fetch: github.fetch, env: {} })).why).toBe('no merge into main at 2026-11-04T18:03:00.000Z made 2026.1104.1803, so the build waits for any review');
  });

  it('is a wait whenever it cannot be read', async () => {
    const down = fakeGitHub([REPLACE_LABEL], { down: true });
    const commit = await choiceForCommit('abc1234def', { fetch: down.fetch, env: {} });
    expect(commit.replace).toBe(false);
    expect(commit.why).toContain('GitHub answered 403');
    expect((await choiceForVersion('2026.1104.1802', { fetch: down.fetch, env: {} })).replace).toBe(false);
    expect((await choiceForCommit('not a sha', { fetch: down.fetch, env: {} })).replace).toBe(false);
    expect((await choiceForVersion('1.0.0', { fetch: down.fetch, env: {} })).replace).toBe(false);
    expect(down.asked).toHaveLength(2);
  });
});

describe('a store version\'s minute', () => {
  it('is the merge time that apps/mobile/app.config.js made the version from', () => {
    for (const time of ['2026-11-04T18:02:41Z', '2027-01-05T00:05:00Z', '2026-12-31T23:59:59Z', '2026-10-22T09:05:30Z']) {
      const minute = versionMinute(appConfig.storeVersion(time))!;
      const at = new Date(time).getTime();
      expect(new Date(minute.since).getTime(), time).toBeLessThanOrEqual(at);
      expect(new Date(minute.until).getTime(), time).toBeGreaterThanOrEqual(at);
    }
  });

  it('is nothing for a version that is not a store version', () => {
    for (const v of ['1.0.0', '2026.1332.100', '2026.1104.2460', '2026.231.100', '', undefined]) expect(versionMinute(v as never), String(v)).toBeNull();
  });
});
