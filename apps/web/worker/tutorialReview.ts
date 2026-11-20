import { parseFixUpdates, parseReview, PICTURE_FILE, PICTURE_MAX, REPOSITORY, ReviewError, type FixUpdate, type Review } from '../../../server/tutorialFeedback';
import type { JobRun } from '../../../server/jobRuns';
import { BadDigest, type BlobBucket } from './blobs';
import type { GithubRun, OidcRule } from './githubOidc';

/**
 * The door Claude's nightly look at the tutorial videos' feedback uses
 * (.github/workflows/tutorial-review.yml, docs/tutorial-videos.md
 * "Feedback", decisions.md 186): `GET /api/tutorial-review` is what is open
 * (`ops_tutorial_review_state`), `POST` what the look made
 * (server/tutorialFeedback.ts `Review`, checked, then `ops_tutorial_reviewed`).
 * The same workflow's fix jobs (decisions.md 186, amended 2026-11-13) use
 * `GET /api/tutorial-review/fixes`, the accepted changes that wait for Claude
 * and the draft pull requests that wait for a person (`ops_tutorial_fixes`),
 * and `POST` there, where each fix is now (`FixUpdate`, `ops_tutorial_fixed`).
 * Before its look, the workflow sends each picture the look names (decisions.md
 * 186, amended 2026-11-17): `PUT /api/tutorial-review/pictures/<sha256>.<png|jpg>`,
 * kept in the blobs bucket by its bytes' hash and served to anyone at
 * `/api/tutorial-pictures/` (`handleTutorialPicture`).
 *
 * Only that workflow, run from main, gets in: it sends the OpenID Connect
 * token GitHub gives the job, which names the workflow and its branch
 * (githubOidc.ts). GitHub holds no key to production; a branch, a fork or
 * another workflow is refused. Each look is recorded as a
 * `tutorial_review` job run, so a night without one shows on the ops
 * dashboard.
 */
export const REVIEW_PATH = '/api/tutorial-review';
export const FIXES_PATH = '/api/tutorial-review/fixes';
/** Where the workflow puts a picture: this, then its file name. */
export const PICTURES_PATH = '/api/tutorial-review/pictures/';
/** Where anyone reads one: this, then its file name. */
export const PICTURE_PATH = '/api/tutorial-pictures/';
/** Where a picture is kept in the blobs bucket. */
export const pictureKey = (name: string) => `tutorial-pictures/${name}`;
/** At most this many accepted changes are handed to one fix run. */
export const FIXES_PER_RUN = 3;
export const REVIEW_RULE: OidcRule = {
  audience: 'https://next.langquest.org/api/tutorial-review',
  workflowRef: `${REPOSITORY}/.github/workflows/tutorial-review.yml@refs/heads/main`
};
/** A night's look is a few hundred kilobytes at most. */
export const REVIEW_MAX_BYTES = 4 * 1024 * 1024;

export interface ReviewDeps {
  verify(token: string, rule: OidcRule): Promise<GithubRun | null>;
  state(): Promise<unknown>;
  reviewed(review: Review): Promise<{ review: number; code: number; looked: number; suggested: number; skipped: number }>;
  record(run: JobRun): Promise<void>;
  /** `ops_tutorial_fixes`: the accepted changes that wait for Claude, and the draft pull requests that wait for a person. */
  fixes(limit: number): Promise<unknown>;
  /** `ops_tutorial_fixed`: 'ok', 'not_found' or 'refused'. */
  fixed(update: FixUpdate, runUrl: string): Promise<string>;
  /** The blobs bucket, where the look's pictures are kept; without it a picture is refused (503). */
  pictures?: BlobBucket | undefined;
  now(): number;
}

const json = (status: number, body: unknown) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });

export async function handleTutorialReview(request: Request, deps: ReviewDeps): Promise<Response> {
  const path = new URL(request.url).pathname;
  const picture = path.startsWith(PICTURES_PATH);
  if (picture ? request.method !== 'PUT' : request.method !== 'GET' && request.method !== 'POST') return json(405, { error: picture ? 'Only PUT is supported.' : 'Only GET and POST are supported.' });
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const run = token ? await deps.verify(token, REVIEW_RULE).catch(() => null) : null;
  if (!run) return json(401, { error: `Only ${REVIEW_RULE.workflowRef} gets in, with its GitHub OIDC token.` });
  if (picture) return putPicture(request, path.slice(PICTURES_PATH.length), deps.pictures);
  if (path === FIXES_PATH) return fixes(request, deps, run);
  if (request.method === 'GET') return json(200, await deps.state());

  const started = deps.now();
  const length = Number(request.headers.get('content-length') ?? NaN);
  if (Number.isFinite(length) && length > REVIEW_MAX_BYTES) return json(413, { error: `A look is at most ${REVIEW_MAX_BYTES / 1024 / 1024} MB.` });
  const text = await request.text();
  if (text.length > REVIEW_MAX_BYTES) return json(413, { error: `A look is at most ${REVIEW_MAX_BYTES / 1024 / 1024} MB.` });
  let review: Review;
  try {
    review = parseReview(JSON.parse(text));
  } catch (e) {
    const error = e instanceof ReviewError ? e.message : 'not JSON';
    await deps.record({ job: 'tutorial_review', startedAt: started, ms: deps.now() - started, outcome: 'error', errorClass: 'bad_review' });
    return json(400, { error });
  }
  // The run the token names is the run the look says it is.
  if (!review.runUrl.includes(`/actions/runs/${run.runId}`)) return json(400, { error: 'runUrl: this run\'s address' });
  const done = await deps.reviewed(review);
  await deps.record({
    job: 'tutorial_review', startedAt: started, ms: deps.now() - started, outcome: done.skipped ? 'partial' : 'ok',
    n: { code: done.code, looked: done.looked, suggested: done.suggested, skipped: done.skipped },
    ...(done.skipped ? { errorClass: 'unknown_ids' } : {})
  });
  return json(200, done);
}

/** The fix jobs' door: what waits, and where each fix is now. Each move is taken or refused on its own. */
async function fixes(request: Request, deps: ReviewDeps, run: GithubRun): Promise<Response> {
  if (request.method === 'GET') return json(200, await deps.fixes(FIXES_PER_RUN));
  const text = await request.text();
  if (text.length > 256 * 1024) return json(413, { error: 'At most 256 KB.' });
  let sent: ReturnType<typeof parseFixUpdates>;
  try {
    sent = parseFixUpdates(JSON.parse(text));
  } catch (e) {
    return json(400, { error: e instanceof ReviewError ? e.message : 'not JSON' });
  }
  if (!sent.runUrl.includes(`/actions/runs/${run.runId}`)) return json(400, { error: 'runUrl: this run\'s address' });
  const results: string[] = [];
  for (const update of sent.updates) results.push(await deps.fixed(update, sent.runUrl));
  return json(200, { results });
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const startsWith = (bytes: Uint8Array, head: number[]) => bytes.length > head.length && head.every((b, i) => bytes[i] === b);

/** A picture the look names: a PNG or JPEG of at most 3 MB, kept under its bytes' hash, which R2 checks. */
async function putPicture(request: Request, name: string, bucket: BlobBucket | undefined): Promise<Response> {
  const m = PICTURE_FILE.exec(name);
  if (!m) return json(404, { error: 'A picture is named by its SHA-256 and .png or .jpg.' });
  if (!bucket) return json(503, { error: 'Pictures are not kept here.' });
  const length = Number(request.headers.get('content-length') ?? NaN);
  if (Number.isFinite(length) && length > PICTURE_MAX.bytes) return json(413, { error: `A picture is at most ${PICTURE_MAX.bytes / 1024 / 1024} MB.` });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.length || bytes.length > PICTURE_MAX.bytes) return json(413, { error: `A picture is at most ${PICTURE_MAX.bytes / 1024 / 1024} MB.` });
  if (!startsWith(bytes, m[2] === 'png' ? PNG : JPEG)) return json(415, { error: `Not a ${m[2] === 'png' ? 'PNG' : 'JPEG'}.` });
  if (await bucket.head(pictureKey(name))) return json(200, { picture: name, kept: true });
  try {
    await bucket.put(pictureKey(name), bytes, bytes.length, m[1]!, m[2] === 'png' ? 'image/png' : 'image/jpeg');
    return json(200, { picture: name, kept: true });
  } catch (e) {
    if (e instanceof BadDigest) return json(422, { error: 'The picture does not match its name; it was not kept.' });
    console.error(`tutorial picture ${name}:`, e);
    return json(502, { error: 'The picture could not be kept just now. Try again.' });
  }
}

/**
 * `GET /api/tutorial-pictures/<sha256>.<png|jpg>`: a picture Claude's look picked to show what a suggestion is
 * about (decisions.md 186, amended 2026-11-17), for the ops dashboard and the fix's pull request. A step's screen
 * from a film run's try, or a still of a film: test data in a public video, so no sign-in, as the films
 * (tutorialVideos.ts). Its name is its bytes' hash, so it never changes.
 */
export async function handleTutorialPicture(request: Request, bucket: BlobBucket | undefined): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Only GET is supported.', { status: 405 });
  const m = PICTURE_FILE.exec(new URL(request.url).pathname.slice(PICTURE_PATH.length));
  if (!m) return new Response('Not found.', { status: 404 });
  if (!bucket) return new Response('Pictures are not kept here.', { status: 503 });
  const object = await bucket.get(pictureKey(m[0]));
  if (!object) return new Response('Not found.', { status: 404 });
  return new Response(request.method === 'HEAD' ? null : object.body, {
    headers: {
      'content-type': m[2] === 'png' ? 'image/png' : 'image/jpeg',
      'content-length': String(object.size),
      'x-content-type-options': 'nosniff',
      etag: `"${m[1]}"`,
      'cache-control': 'public, max-age=31536000, immutable'
    }
  });
}
