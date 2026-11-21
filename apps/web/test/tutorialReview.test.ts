import { describe, expect, it } from 'vitest';
import { GITHUB_ISSUER, githubOidc } from '../worker/githubOidc';
import { BadDigest, type BlobBucket } from '../worker/blobs';
import { FIXES_PER_RUN, handleTutorialPicture, handleTutorialReview, REVIEW_RULE, type ReviewDeps } from '../worker/tutorialReview';
import { FIX_UPDATES_MAX, parseFixUpdates, parseReview, PICTURE_MAX, ReviewError, type FixUpdate, type Review } from '../../../server/tutorialFeedback';
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
      .toEqual({ sha: 'a'.repeat(40), runUrl: RUN, code: [], comments: [], looked: [], suggestions: [], attach: [], pictures: [] });
    expect(parseReview(review({ looked: [{ input: INPUT, outcome: '' }] })).looked[0]!.outcome).toBeNull();
  });

  it('takes a clear fix Claude accepts itself, and the language of the film a suggestion is about (decisions.md 186, amended 2026-11-16)', () => {
    const clear = parseReview(review({ suggestions: [{ kind: 'screen', tutorial: 'answer-feedback', language: 'fr', clear: true, title: 'Tap On this device', detail: 'Step 4.', inputs: [] }] }));
    expect(clear.suggestions[0]).toMatchObject({ kind: 'screen', tutorial: 'answer-feedback', language: 'fr', clear: true });
    expect(parseReview(review()).suggestions.every((s) => s.clear === false && s.language === null)).toBe(true);
  });

  const picture = (over: Record<string, unknown> = {}) => ({
    picture: `${'c'.repeat(64)}.jpg`, language: 'fr', tutorial: 'study-a-passage', kind: 'still', n: 14, at: 81.31,
    caption: 'The end of the French video. The dark band starts in the middle of the words.', ring: [0.61, 0.38, 0.25, 0.35], ...over
  });
  const pictured = (pictures: unknown[]) => ({ suggestions: [{ kind: 'screen', tutorial: 'study-a-passage', language: 'fr', title: 't', detail: 'd', inputs: [], pictures }] });

  it('takes the pictures a suggestion is about, and pictures for suggestions made before (decisions.md 186, amended 2026-11-17)', () => {
    const r = parseReview(review({ ...pictured([picture(), picture({ picture: `${'d'.repeat(64)}.png`, kind: 'step', n: 12, at: undefined, ring: undefined })]),
      pictures: [{ suggestion: OPEN, pictures: [picture()] }, { suggestion: OPEN, when: 'after', pictures: [picture({ ring: [0.123456, 0, 0.5, 0.5] })] }] }));
    expect(r.suggestions[0]!.pictures).toEqual([picture(), { picture: `${'d'.repeat(64)}.png`, language: 'fr', tutorial: 'study-a-passage', kind: 'step', n: 12, caption: picture().caption }]);
    expect(r.pictures).toEqual([{ suggestion: OPEN, when: 'now', pictures: [picture()] }, { suggestion: OPEN, when: 'after', pictures: [picture({ ring: [0.123, 0, 0.5, 0.5] })] }]);
    expect(parseReview(review()).suggestions.every((s) => s.pictures.length === 0)).toBe(true);
    // A waiting suggestion's words said again in plain words, with its pictures or alone.
    expect(parseReview(review({ pictures: [{ suggestion: OPEN, pictures: [picture()], title: ' At the end, the screen is half dark ' }, { suggestion: OPEN, detail: 'Picture 1 shows it.' }] })).pictures)
      .toEqual([{ suggestion: OPEN, when: 'now', pictures: [picture()], title: 'At the end, the screen is half dark' }, { suggestion: OPEN, when: 'now', pictures: [], detail: 'Picture 1 shows it.' }]);
  });

  it('says the first thing wrong', () => {
    const wrong: [Record<string, unknown>, string][] = [
      // A picture is named by its hash, from a film run, with a caption and a ring inside it.
      [pictured([picture({ picture: 'fr/study-a-passage/check/14.jpg' })]), 'suggestions[0].pictures[0].picture'],
      [pictured([picture({ picture: `${'c'.repeat(64)}.gif` })]), 'suggestions[0].pictures[0].picture'],
      [pictured([picture({ language: 'French' })]), 'suggestions[0].pictures[0].language'],
      [pictured([picture({ tutorial: '../x' })]), 'suggestions[0].pictures[0].tutorial'],
      [pictured([picture({ kind: 'frame' })]), 'suggestions[0].pictures[0].kind'],
      [pictured([picture({ n: 0 })]), 'suggestions[0].pictures[0].n'],
      [pictured([picture({ at: -1 })]), 'suggestions[0].pictures[0].at'],
      [pictured([picture({ caption: '' })]), 'suggestions[0].pictures[0].caption'],
      [pictured([picture({ caption: 'x'.repeat(PICTURE_MAX.caption + 1) })]), 'suggestions[0].pictures[0].caption'],
      [pictured([picture({ caption: 'Tap the calculator.' })]), 'suggestions[0].pictures[0].caption'],
      [pictured([picture({ ring: [0.8, 0.1, 0.5, 0.2] })]), 'suggestions[0].pictures[0].ring'],
      [pictured([picture({ ring: [0.1, 0.1, 0, 0.2] })]), 'suggestions[0].pictures[0].ring'],
      [pictured([picture({ ring: [0.1, 0.1, 0.2] })]), 'suggestions[0].pictures[0].ring'],
      [pictured(Array.from({ length: PICTURE_MAX.pictures + 1 }, () => picture())), 'pictures: a list'],
      [{ suggestions: [{ kind: 'new', tutorial: null, title: 't', detail: 'd', inputs: [], pictures: [picture()] }] }, 'suggestions[0].pictures'],
      [{ pictures: [{ suggestion: 'pr-272', pictures: [picture()] }] }, 'pictures[0].suggestion'],
      [{ pictures: [{ suggestion: OPEN, when: 'later', pictures: [picture()] }] }, 'pictures[0].when'],
      [{ pictures: [{ suggestion: OPEN, pictures: [] }] }, 'pictures[0].pictures'],
      [{ pictures: [{ suggestion: OPEN, title: '' }] }, 'pictures[0].title'],
      [{ pictures: [{ suggestion: OPEN, detail: 'x'.repeat(4001) }] }, 'pictures[0].detail'],
      [{ pictures: [{ suggestion: OPEN, when: 'after', pictures: [picture()], title: 'New words' }] }, 'pictures[0]: new words'],
      [{ pictures: [{ suggestion: OPEN, title: 'Turn on the calculator' }] }, 'pictures[0].title'],
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
      // Only a change to one video is clear; the app itself and a new video always wait for a person.
      [{ suggestions: [{ kind: 'code', tutorial: 'record-a-passage', clear: true, title: 't', detail: 'd', inputs: [] }] }, 'suggestions[0].clear'],
      [{ suggestions: [{ kind: 'new', tutorial: null, clear: true, title: 't', detail: 'd', inputs: [] }] }, 'suggestions[0].clear'],
      [{ suggestions: [{ kind: 'script', tutorial: null, clear: true, title: 't', detail: 'd', inputs: [] }] }, 'suggestions[0].clear'],
      [{ suggestions: [{ kind: 'script', tutorial: 'record-a-passage', clear: 'yes', title: 't', detail: 'd', inputs: [] }] }, 'suggestions[0].clear'],
      [{ suggestions: [{ kind: 'script', tutorial: 'record-a-passage', language: 'French', title: 't', detail: 'd', inputs: [] }] }, 'suggestions[0].language'],
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
    moves.length = 0;
    const d: ReviewDeps = {
      verify: async (t) => (t === 'good' ? { repository: 'genesis-ai-dev/langquest-next', workflowRef: REVIEW_RULE.workflowRef, runId: '123456', runAttempt: '1', eventName: 'schedule' } : null),
      state: async () => ({ last: null, inputs: [], suggestions: [], videos: [] }),
      reviewed: async (r) => { sent.push(r); return { review: 1, code: 1, looked: 1, suggested: 2, skipped: 0 }; },
      record: async (run) => { runs.push(run); },
      fixes: async (limit) => ({ toFix: [], open: [], limit }),
      fixed: async (u) => { moves.push(u); return u.id === UNKNOWN ? 'not_found' : 'ok'; },
      refilmed: async (r) => (r.id === UNKNOWN ? 'refused' : 'ok'),
      fixedElsewhere: async (r) => { moves.push(r as never); return r.id === UNKNOWN ? 'not_found' : 'ok'; },
      now: () => NOW,
      ...over
    };
    return { d, runs, sent, moves };
  }
  const moves: FixUpdate[] = [];
  const UNKNOWN = '0d000000-0000-4000-8000-0000000000ff';
  const req = (method: string, auth: string | null, body?: unknown, path = '/api/tutorial-review') =>
    new Request(`https://next.langquest.org${path}`, { method, headers: auth ? { authorization: `Bearer ${auth}` } : {}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

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

  it('hands the fix jobs what waits, and takes where each fix is now, from this run only', async () => {
    const { d, runs } = deps();
    const FIXES = '/api/tutorial-review/fixes';
    expect((await handleTutorialReview(req('GET', 'stolen', undefined, FIXES), d)).status).toBe(401);
    expect(await (await handleTutorialReview(req('GET', 'good', undefined, FIXES), d)).json()).toEqual({ toFix: [], open: [], limit: FIXES_PER_RUN });
    const runUrl = 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/123456';
    const id = '0d000000-0000-4000-8000-000000000001';
    const posted = await handleTutorialReview(req('POST', 'good', { runUrl, updates: [{ id, state: 'open', pr: 451 }, { id: UNKNOWN, state: 'working' }] }, FIXES), d);
    expect(await posted.json()).toEqual({ results: ['ok', 'not_found'], refilmed: [], fixedElsewhere: [] });
    expect(moves).toEqual([{ id, state: 'open', pr: 451, note: null }, { id: UNKNOWN, state: 'working', pr: null, note: null }]);
    expect((await handleTutorialReview(req('POST', 'good', { runUrl: runUrl.replace('123456', '999'), updates: [] }, FIXES), d)).status).toBe(400);
    expect(await (await handleTutorialReview(req('POST', 'good', { runUrl, updates: [{ id, state: 'merged' }] }, FIXES), d)).json()).toEqual({ error: 'updates[0].pr: the pull request, for merged' });
    expect(runs).toEqual([]);
  });

  it('takes a cause in the app, and the fixes in the app whose video was sent to be filmed again', async () => {
    // docs/decisions/2026-11-21-fix-it-sends-a-video-suggestion-to-the-agent-team.md
    const { d } = deps();
    const FIXES = '/api/tutorial-review/fixes';
    const runUrl = 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/123456';
    const id = '0d000000-0000-4000-8000-000000000001';
    const posted = await handleTutorialReview(req('POST', 'good', {
      runUrl, updates: [{ id, state: 'failed', note: 'The word comes from the app.', app: true }], refilmed: [{ id, pr: 640 }, { id: UNKNOWN, pr: 641 }]
    }, FIXES), d);
    expect(await posted.json()).toEqual({ results: ['ok'], refilmed: ['ok', 'refused'], fixedElsewhere: [] });
    expect(moves).toEqual([{ id, state: 'failed', pr: null, note: 'The word comes from the app.', app: true }]);
  });

  it('takes the changes that failed which a pull request of their own fixed', async () => {
    // docs/decisions/2026-11-21-a-failed-video-change-learns-the-pull-request-that-fixed-it.md
    const { d } = deps();
    const runUrl = 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/123456';
    const id = '0d000000-0000-4000-8000-000000000001';
    const fixed = [{ id, pr: 633, mergedAt: '2026-11-21T22:01:00Z', file: 'apps/mobile/src/i18n/fr.json' }, { id: UNKNOWN, pr: 634, mergedAt: '2026-11-21T22:02:00Z', file: null }];
    const posted = await handleTutorialReview(req('POST', 'good', { runUrl, updates: [], fixedElsewhere: fixed }, '/api/tutorial-review/fixes'), d);
    expect(await posted.json()).toEqual({ results: [], refilmed: [], fixedElsewhere: ['ok', 'not_found'] });
    expect(moves).toEqual(fixed);
  });
});

describe('the look\'s pictures (decisions.md 186, amended 2026-11-17)', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const shaOf = async (b: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');
  function store() {
    const kept: Record<string, { body: Uint8Array; type: string }> = {};
    const bucket: BlobBucket = {
      async get(key) { const o = kept[key]; return o ? { size: o.body.length, body: new Response(o.body).body! } : null; },
      async head(key) { return kept[key] ? { size: kept[key]!.body.length } : null; },
      async put(key, body, length, sha256, type) {
        const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
        if ((await shaOf(bytes)) !== sha256) throw new BadDigest('no');
        kept[key] = { body: bytes, type };
        return { size: length };
      },
      async delete() {},
      async list() { return { objects: [] }; }
    };
    return { kept, bucket };
  }
  const verify: ReviewDeps['verify'] = async (t) => (t === 'good' ? { repository: 'genesis-ai-dev/langquest-next', workflowRef: REVIEW_RULE.workflowRef, runId: '1', runAttempt: '1', eventName: 'schedule' } : null);
  const deps = (bucket?: BlobBucket) => ({ verify, pictures: bucket } as unknown as ReviewDeps);
  const put = (d: ReviewDeps, name: string, body: Uint8Array, auth: string | null = 'good', method = 'PUT') => handleTutorialReview(new Request(`https://next.langquest.org/api/tutorial-review/pictures/${name}`, {
    method, ...(method === 'PUT' ? { body } : {}), headers: { 'content-length': String(body.length), ...(auth ? { authorization: `Bearer ${auth}` } : {}) }
  }), d);

  it('keeps a picture the review workflow sends, under its hash, once', async () => {
    const { kept, bucket } = store();
    const name = `${await shaOf(PNG)}.png`;
    const r = await put(deps(bucket), name, PNG);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ picture: name, kept: true });
    expect(kept[`tutorial-pictures/${name}`]).toEqual({ body: PNG, type: 'image/png' });
    expect((await put(deps(bucket), name, PNG)).status).toBe(200);
  });

  it('takes nothing from anyone else, nor what is not a picture of its name', async () => {
    const { kept, bucket } = store();
    const name = `${await shaOf(PNG)}.png`;
    expect((await put(deps(bucket), name, PNG, null)).status).toBe(401);
    expect((await put(deps(bucket), name, PNG, 'stolen')).status).toBe(401);
    expect((await put(deps(bucket), name, PNG, 'good', 'POST')).status).toBe(405);
    expect((await put(deps(bucket), `${'a'.repeat(64)}.png`, PNG)).status).toBe(422);
    expect((await put(deps(bucket), `${await shaOf(PNG)}.jpg`, PNG)).status).toBe(415);
    expect((await put(deps(bucket), `..%2Ftutorials%2F${name}`, PNG)).status).toBe(404);
    expect((await put(deps(bucket), `${await shaOf(PNG)}.svg`, PNG)).status).toBe(404);
    expect((await put(deps(bucket), name, new Uint8Array(PICTURE_MAX.bytes + 1))).status).toBe(413);
    expect((await put(deps(), name, PNG)).status).toBe(503);
    expect(kept).toEqual({});
  });

  it('shows a kept picture to anyone, as an image that never changes, and nothing else in the bucket', async () => {
    const { bucket } = store();
    const name = `${await shaOf(PNG)}.png`;
    await put(deps(bucket), name, PNG);
    const get = (path: string, method = 'GET') => handleTutorialPicture(new Request(`https://next.langquest.org${path}`, { method }), bucket);
    const r = await get(`/api/tutorial-pictures/${name}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(r.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(PNG);
    expect((await get(`/api/tutorial-pictures/${name}`, 'HEAD')).status).toBe(200);
    expect((await get(`/api/tutorial-pictures/${'b'.repeat(64)}.png`)).status).toBe(404);
    expect((await get('/api/tutorial-pictures/../tutorials/en/x/a.mp4')).status).toBe(404);
    expect((await get(`/api/tutorial-pictures/${name}`, 'PUT')).status).toBe(405);
  });
});

describe('parseFixUpdates', () => {
  const runUrl = 'https://github.com/genesis-ai-dev/langquest-next/actions/runs/7/attempts/2';
  const id = '0d000000-0000-4000-8000-000000000001';
  it('takes each move with its pull request, or why there is no fix', () => {
    expect(parseFixUpdates({ runUrl, updates: [{ id, state: 'failed', note: ' The script has no such line. ' }, { id, state: 'closed', pr: 9 }] })).toEqual({
      runUrl, updates: [{ id, state: 'failed', pr: null, note: 'The script has no such line.' }, { id, state: 'closed', pr: 9, note: null }], refilmed: [], fixedElsewhere: []
    });
    // A fix that needs no change, and one whose checks failed (its pull request closed).
    expect(parseFixUpdates({ runUrl, updates: [{ id, state: 'unneeded', note: 'Step 4 already taps it.' }, { id, state: 'failed', pr: 9, note: 'Its checks failed.' }] }).updates)
      .toEqual([{ id, state: 'unneeded', pr: null, note: 'Step 4 already taps it.' }, { id, state: 'failed', pr: 9, note: 'Its checks failed.' }]);
  });
  it('says the first thing wrong', () => {
    for (const [sent, error] of [
      [{ runUrl: 'https://github.com/someone/else/actions/runs/7', updates: [] }, 'runUrl'],
      [{ runUrl, updates: [{ id: 'x', state: 'open', pr: 1 }] }, 'updates[0].id'],
      [{ runUrl, updates: [{ id, state: 'done' }] }, 'updates[0].state'],
      [{ runUrl, updates: [{ id, state: 'open', pr: 0 }] }, 'updates[0].pr'],
      [{ runUrl, updates: [{ id, state: 'failed', note: 'x'.repeat(1001) }] }, 'updates[0].note'],
      [{ runUrl, updates: Array.from({ length: FIX_UPDATES_MAX + 1 }, () => ({ id, state: 'working' })) }, 'updates: a list'],
      [{ runUrl, updates: [{ id, state: 'open', pr: 3, app: true }] }, 'updates[0].app'],
      [{ runUrl, updates: [{ id, state: 'failed', app: 'yes' }] }, 'updates[0].app'],
      [{ runUrl, updates: [], refilmed: [{ id, pr: null }] }, 'refilmed[0].pr'],
      [{ runUrl, updates: [], refilmed: [{ id: 'x', pr: 3 }] }, 'refilmed[0].id'],
      [{ runUrl, updates: [], fixedElsewhere: [{ id, pr: 3, mergedAt: 'yesterday', file: null }] }, 'fixedElsewhere[0].mergedAt'],
      [{ runUrl, updates: [], fixedElsewhere: [{ id, pr: 3, mergedAt: '2026-11-21T22:01:00Z', file: '../secrets' }] }, 'fixedElsewhere[0].file'],
      [{ runUrl, updates: [], fixedElsewhere: [{ id, pr: -1, mergedAt: '2026-11-21T22:01:00Z' }] }, 'fixedElsewhere[0].pr']
    ] as const) expect(() => parseFixUpdates(sent), error).toThrow(new RegExp(`^${error.replace(/[[\]]/g, '\\$&')}`));
  });
});
