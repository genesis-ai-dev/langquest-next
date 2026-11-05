import { describe, expect, it } from 'vitest';
import { GITHUB_ISSUER, githubOidc } from '../worker/githubOidc';
import { handleTutorialReview, REVIEW_RULE, type ReviewDeps } from '../worker/tutorialReview';
import { parseReview, ReviewError, type Review } from '../../../server/tutorialFeedback';
import type { JobRun } from '../../../server/jobRuns';

/** Claude's nightly look at the tutorial videos' feedback (decisions.md 186): who gets in, and what it may send. */

const NOW = Date.parse('2026-10-30T10:05:00Z');
const RUN = 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/123456';
const INPUT = '0d000000-0000-4000-8000-000000000001';
const OPEN = '0d000000-0000-4000-8000-000000000002';

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const part = (o: unknown) => b64(new TextEncoder().encode(JSON.stringify(o)));
const params = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' } as const;
const github = await crypto.subtle.generateKey(params, true, ['sign', 'verify']);
const stranger = await crypto.subtle.generateKey(params, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', github.publicKey)), kid: 'k1' };

const goodClaims = {
  iss: GITHUB_ISSUER, aud: REVIEW_RULE.audience, exp: NOW / 1000 + 300, nbf: NOW / 1000 - 10,
  repository: 'genesis-ai-dev/langquest-next', workflow_ref: REVIEW_RULE.workflowRef, ref: 'refs/heads/main',
  run_id: '123456', run_attempt: '1', event_name: 'schedule'
};
async function token(claims: Record<string, unknown> = {}, opts: { key?: CryptoKey; header?: Record<string, unknown> } = {}) {
  const head = part({ alg: 'RS256', kid: 'k1', typ: 'JWT', ...opts.header });
  const body = part({ ...goodClaims, ...claims });
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', opts.key ?? github.privateKey, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64(sig)}`;
}

function jwks() {
  let fetched = 0;
  const fetcher = async (input: string) => {
    fetched += 1;
    expect(input).toBe(`${GITHUB_ISSUER}/.well-known/jwks`);
    return Response.json({ keys: [jwk] });
  };
  return { fetcher, count: () => fetched };
}

describe('githubOidc', () => {
  it('lets in the review workflow run from main, and says which run it is', async () => {
    const verify = githubOidc(jwks().fetcher, () => NOW);
    expect(await verify(await token(), REVIEW_RULE)).toEqual({
      repository: 'genesis-ai-dev/langquest-next', workflowRef: REVIEW_RULE.workflowRef, runId: '123456', runAttempt: '1', eventName: 'schedule'
    });
  });

  it('refuses a branch, another workflow, another repository, another audience, an old token and one GitHub did not sign', async () => {
    const verify = githubOidc(jwks().fetcher, () => NOW);
    const refused = [
      await token({ ref: 'refs/heads/try-it', workflow_ref: 'genesis-ai-dev/langquest-next/.github/workflows/tutorial-review.yml@refs/heads/try-it' }),
      await token({ ref: 'refs/heads/try-it' }),
      await token({ workflow_ref: 'genesis-ai-dev/langquest-next/.github/workflows/tutorials.yml@refs/heads/main' }),
      await token({ repository: 'someone/langquest-next' }),
      await token({ aud: 'https://example.com' }),
      await token({ iss: 'https://evil.example' }),
      await token({ exp: NOW / 1000 - 120 }),
      await token({ nbf: NOW / 1000 + 600 }),
      await token({}, { key: stranger.privateKey }),
      await token({}, { header: { alg: 'none' } }),
      'not.a.token', 'abc'
    ];
    for (const t of refused) expect(await verify(t, REVIEW_RULE)).toBeNull();
  });

  it('fetches GitHub\'s keys once an hour, and again for a key not seen at most once a minute', async () => {
    let now = NOW;
    const keys = jwks();
    const verify = githubOidc(keys.fetcher, () => now);
    await verify(await token(), REVIEW_RULE);
    await verify(await token(), REVIEW_RULE);
    expect(keys.count()).toBe(1);
    now += 30_000;
    expect(await verify(await token({}, { header: { kid: 'k9' } }), REVIEW_RULE)).toBeNull();
    expect(keys.count()).toBe(1);
    now += 60_000;
    await verify(await token({}, { header: { kid: 'k9' } }), REVIEW_RULE);
    expect(keys.count()).toBe(2);
    now += 61 * 60_000;
    await verify(await token({ exp: now / 1000 + 300 }), REVIEW_RULE);
    expect(keys.count()).toBe(3);
  });
});

const review = (over: Record<string, unknown> = {}) => ({
  sha: 'a'.repeat(40), runUrl: RUN,
  code: [{ key: 'pr-272', sha: 'b'.repeat(40), tutorial: 'record-a-passage', pr: 272, title: 'Save is Done now', english: 'The button the video taps is Done now.', at: '2026-10-29T18:00:00Z' }],
  comments: [{ id: INPUT, english: 'Thank you!', reply: '¡Gracias!', replyEnglish: 'Thanks!' }],
  looked: [{ input: INPUT, outcome: 'Thanks; nothing to change.' }],
  suggestions: [{ kind: 'script', tutorial: 'record-a-passage', title: 'Say Done', detail: 'Line 9: "Tap Done."', inputs: ['pr-272'] },
    { kind: 'new', tutorial: null, title: 'Export a recording', detail: 'Two people asked how to get the audio out.', inputs: [] }],
  attach: [{ suggestion: OPEN, inputs: ['pr-272'] }],
  ...over
});

describe('parseReview', () => {
  it('takes a look with code changes, comments in English, what it looked at, suggestions and more inputs for open ones', () => {
    const r: Review = parseReview(review());
    expect(r.code[0]).toMatchObject({ key: 'pr-272', pr: 272 });
    expect(r.suggestions[1]).toMatchObject({ kind: 'new', tutorial: null });
    expect(parseReview(review({ code: undefined, comments: undefined, looked: undefined, suggestions: undefined, attach: undefined })))
      .toEqual({ sha: 'a'.repeat(40), runUrl: RUN, code: [], comments: [], looked: [], suggestions: [], attach: [] });
    expect(parseReview(review({ looked: [{ input: INPUT, outcome: '' }] })).looked[0]!.outcome).toBeNull();
  });

  it('says the first thing wrong', () => {
    const wrong: [Record<string, unknown>, string][] = [
      [{ sha: 'main' }, 'sha'],
      [{ runUrl: 'https://github.com/someone/else/actions/runs/1' }, 'runUrl'],
      [{ suggestions: [{ kind: 'rewrite', tutorial: null, title: 't', detail: 'd', inputs: [] }] }, 'suggestions[0].kind'],
      [{ suggestions: [{ kind: 'new', tutorial: 'record-a-passage', title: 't', detail: 'd', inputs: [] }] }, 'suggestions[0].tutorial'],
      [{ suggestions: [{ kind: 'script', tutorial: 'record-a-passage', title: 't', detail: 'd', inputs: ['nobody'] }] }, 'suggestions[0].inputs[0]'],
      [{ suggestions: [{ kind: 'script', tutorial: 'Record', title: 't', detail: 'd', inputs: [] }] }, 'suggestions[0].tutorial'],
      [{ suggestions: [{ kind: 'script', tutorial: null, title: '', detail: 'd', inputs: [] }] }, 'suggestions[0].title'],
      [{ code: [{ key: 'pr-272', sha: 'b'.repeat(40), tutorial: 'record-a-passage', pr: 272, title: 't', english: 'e', at: 'yesterday' }] }, 'code[0].at'],
      [{ code: [{ key: INPUT, sha: 'b'.repeat(40), tutorial: 'record-a-passage', pr: null, title: 't', english: 'e', at: '2026-10-29T18:00:00Z' }] }, 'code[0].key'],
      [{ comments: [{ id: 'Ugc-1', english: 'e', reply: '', replyEnglish: '' }] }, 'comments[0].id'],
      [{ looked: Array.from({ length: 4001 }, () => ({ input: INPUT, outcome: null })) }, 'looked'],
      [{ attach: [{ suggestion: 'pr-272', inputs: [] }] }, 'attach[0].suggestion'],
      // The phone's disguise (decisions.md 171) is never explained in public, whoever asks.
      [{ suggestions: [{ kind: 'new', tutorial: null, title: 'Make LangQuest look like a calculator', detail: 'd', inputs: [] }] }, 'suggestions[0].title'],
      [{ suggestions: [{ kind: 'script', tutorial: 'your-account', title: 'Show the App icon row', detail: 'Tap App icon, then Notepad, and type a code.', inputs: [] }] }, 'suggestions[0].detail'],
      [{ comments: [{ id: INPUT, english: 'How do I hide the app?', reply: 'Toca Yo, luego Icono de la app.', replyEnglish: 'Tap Me, then App icon, and pick the disguise.' }] }, 'comments[0].replyEnglish']
    ];
    for (const [over, where] of wrong) {
      expect(() => parseReview(review(over)), where).toThrow(ReviewError);
      expect(() => parseReview(review(over))).toThrow(new RegExp(`^${where.replace(/[[\]]/g, '\\$&')}`));
    }
  });
});

describe('handleTutorialReview', () => {
  function deps(over: Partial<ReviewDeps> = {}) {
    const runs: JobRun[] = [];
    const sent: Review[] = [];
    const d: ReviewDeps = {
      verify: async (t) => (t === 'good' ? { repository: 'genesis-ai-dev/langquest-next', workflowRef: REVIEW_RULE.workflowRef, runId: '123456', runAttempt: '1', eventName: 'schedule' } : null),
      state: async () => ({ last: null, inputs: [], suggestions: [], videos: [] }),
      reviewed: async (r) => { sent.push(r); return { review: 1, code: 1, looked: 1, suggested: 2, skipped: 0 }; },
      record: async (run) => { runs.push(run); },
      now: () => NOW,
      ...over
    };
    return { d, runs, sent };
  }
  const req = (method: string, auth: string | null, body?: unknown) =>
    new Request('https://next.langquest.org/api/tutorial-review', { method, headers: auth ? { authorization: `Bearer ${auth}` } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

  it('lets in only the review workflow\'s token', async () => {
    const { d, runs } = deps();
    expect((await handleTutorialReview(req('GET', null), d)).status).toBe(401);
    expect((await handleTutorialReview(req('GET', 'stolen'), d)).status).toBe(401);
    expect((await handleTutorialReview(req('DELETE', 'good'), d)).status).toBe(405);
    expect(runs).toEqual([]);
  });

  it('answers what is open, and takes a look, recording it as the review\'s run', async () => {
    const { d, runs, sent } = deps();
    const state = await handleTutorialReview(req('GET', 'good'), d);
    expect(state.status).toBe(200);
    expect(await state.json()).toEqual({ last: null, inputs: [], suggestions: [], videos: [] });
    const posted = await handleTutorialReview(req('POST', 'good', review()), d);
    expect(posted.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(runs).toEqual([{ job: 'tutorial_review', startedAt: NOW, ms: 0, outcome: 'ok', n: { code: 1, looked: 1, suggested: 2, skipped: 0 } }]);
  });

  it('refuses a look that is wrong, or names another run, and records the bad one', async () => {
    const { d, runs, sent } = deps();
    const bad = await handleTutorialReview(req('POST', 'good', review({ sha: 'x' })), d);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'sha: a commit on main' });
    expect((await handleTutorialReview(req('POST', 'good', review({ runUrl: 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/999' })), d)).status).toBe(400);
    expect(sent).toEqual([]);
    expect(runs).toEqual([{ job: 'tutorial_review', startedAt: NOW, ms: 0, outcome: 'error', errorClass: 'bad_review' }]);
  });

  it('records a look with ids the database did not know as partial', async () => {
    const { d, runs } = deps({ reviewed: async () => ({ review: 2, code: 0, looked: 0, suggested: 0, skipped: 3 }) });
    await handleTutorialReview(req('POST', 'good', review()), d);
    expect(runs[0]).toMatchObject({ outcome: 'partial', errorClass: 'unknown_ids', n: { skipped: 3 } });
  });
});
