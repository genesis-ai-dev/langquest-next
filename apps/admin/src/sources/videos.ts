import { CHANNELS, type ChannelLanguage } from '../../../../server/youtube';
import type { FeedbackInput, Suggestion } from '../../../../server/tutorialFeedback';
import { diagConnection, withDiag, type Query } from '../db';
import { failed, ok, type Section } from '../section';
import { filmingSection, type Filming } from './filming';
import { githubApi, type GitHubEnv } from './githubApi';
import { tutorialsOf, type Feedback, type Tutorials } from './ops';

/**
 * The tutorial videos as three lists (docs/tutorial-videos.md "On the ops
 * dashboard", decisions.md 186 amended 2026-11-13): every video in each app
 * language with its state and a timeline of what happened to it; what an
 * admin must do (approve a suggestion, merge a fix, look at a held or failing
 * film, publish, connect a channel, turn a language on); and what the workers
 * do now or tonight (filming, checks of slotted videos, fixes being written,
 * comments to read, uploads). Read from four places: the database
 * (diag.ops_tutorial_films, ops_tutorial_feedback, ops_tutorials), each
 * language's status-<language>.json in the public `tutorials` release (the
 * nightly writes it, e2e/tutorials/nightly.ts), the filming run on GitHub
 * (sources/filming.ts), and the nightly language list in tutorials.yml.
 * It raises no alerts: the parts it draws on already raise theirs.
 */

// ---- what it reads ------------------------------------------------------------------------------

/** One film from diag.ops_tutorial_films(). */
export interface FilmRow {
  tutorial: string; language: string; sha256: string; madeAt: string;
  chosenAt: string | null; publishedAt: string | null; youtubeId: string | null; failed: string | null; failedAt: string | null;
}

/** A change a cause or a slot names (e2e/tutorials/why.ts Ref). */
interface Ref { sha: string; pr: number | null; subject: string }
/** Why a film was made (e2e/tutorials/why.ts Cause). */
export type Cause =
  | { kind: 'new' | 'asked' | 'frame' }
  | { kind: 'script'; changes: Ref[] }
  | { kind: 'screen'; steps: number[]; screens: string[]; changes: Ref[]; shared?: true };

/** status-<language>.json, as the nightly writes it (e2e/tutorials/nightly.ts). */
export interface StatusFile {
  language: string; commit: string | null; at: string;
  videos: {
    tutorial: string; title: string;
    tonight: 'filmed' | 'held' | 'failed' | 'same' | 'not tried';
    film: { sha256: string; filmedAt: string | null; commit: string | null; why: Cause[] | null } | null;
    why: Cause[]; slots: (Ref & { screens: string[] })[]; checked: (Ref & { screens: string[] })[];
    held?: string[];
  }[];
}

/** A suggestion's fix (server/tutorialFeedback.ts, after the fix-writing change): Claude writes it as a pull request. */
export interface Fix { state: 'working' | 'open' | 'merged' | 'closed' | 'failed'; pr: number | null; at: string; run: string | null; note: string | null }
type FixedSuggestion = Suggestion & { fix?: Fix | null };

export interface VideosInput {
  films: FilmRow[] | null;
  feedback: (Omit<Feedback, 'suggestions'> & { suggestions: FixedSuggestion[] }) | null;
  tutorials: Tutorials | null;
  status: Partial<Record<string, StatusFile>>;
  filming: Filming | null;
  /** The app languages tutorials.yml films each night; null when it could not be read. */
  nightly: string[] | null;
}

// ---- what it says -------------------------------------------------------------------------------

/**
 * A video's state, most urgent first. Several can be true at once; the first is its state, the rest show beside it.
 * `level`: bad, an admin must act; warn, it waits on someone; info, a worker has it; good, nothing to do.
 */
export type StateKey = 'fails' | 'held' | 'fixFailed' | 'approve' | 'merge' | 'fixing' | 'toFix' | 'filming' | 'tonight' | 'slotted'
  | 'comment' | 'reply' | 'publish' | 'upload' | 'new' | 'paused' | 'current';
export interface VideoState { key: StateKey; text: string; level: 'bad' | 'warn' | 'info' | 'good'; link?: string }

/** One thing on a video's timeline. */
export interface Mark {
  at: string;
  kind: 'film' | 'up' | 'comment' | 'suggested' | 'decided' | 'fix' | 'held' | 'failed';
  /** For a film: its causes, in words ('app change', 'script', 'film tool', 'new', 'asked'); else what happened. */
  text: string;
  /** For a film: what made it ('app' | 'script' | 'tool' | 'new' | 'asked' | 'unknown'). */
  cause?: string;
  link?: string;
}

export interface VideoRow {
  tutorial: string; language: string; title: string;
  states: VideoState[];
  /** The newest film: when it was made and why, and whether YouTube has it. */
  film: { madeAt: string; why: string | null; up: boolean } | null;
  marks: Mark[];
}

export interface AdminItem {
  kind: 'approve' | 'merge' | 'fixFailed' | 'held' | 'fails' | 'reply' | 'publish' | 'connect' | 'paused';
  title: string; detail: string; at: string | null;
  tutorial?: string; language?: string; link?: string;
  /** For `approve`: the suggestion, for its Accept, Edit and Reject. */
  suggestion?: FixedSuggestion;
}

export interface WorkerItem {
  /** `now`: running; `next`: waits its turn or tonight's run. */
  when: 'now' | 'next';
  kind: 'filming' | 'check' | 'fixing' | 'toFix' | 'comments' | 'upload';
  title: string; detail: string; link?: string; at?: string | null;
}

export interface Videos {
  languages: { language: string; nightly: boolean; statusAt: string | null }[];
  videos: VideoRow[];
  admin: AdminItem[];
  worker: WorkerItem[];
  /** Whether each source answered: a list built without one says so on the page. */
  missing: string[];
}

// ---- how ----------------------------------------------------------------------------------------

const REPO = 'https://github.com/genesis-ai-dev/langquest-next';
const pr = (n: number) => `${REPO}/pull/${n}`;
/** The comments a reply is suggested for, shown for this long: the page cannot tell whether someone posted it. */
export const REPLY_DAYS = 14;
/** The timeline goes back this far. */
export const TIMELINE_DAYS = 60;
const RECONNECT = /^youtube_(invalid_grant|not_connected|unauthorized|forbidden)/;
const FIXABLE = new Set(['script', 'screen', 'voice']);

/** What made a film, in one word for its mark. */
export function causeOf(why: Cause[] | null | undefined): string {
  if (!why) return 'unknown';
  if (why.some((c) => c.kind === 'new')) return 'new';
  if (why.some((c) => c.kind === 'script')) return 'script';
  if (why.some((c) => c.kind === 'screen' && !c.shared)) return 'app';
  if (why.some((c) => c.kind === 'screen' || c.kind === 'frame')) return 'tool';
  if (why.some((c) => c.kind === 'asked')) return 'asked';
  return 'unknown';
}

const refs = (r: Ref[]) => (r.length ? ` (${r.map((c) => (c.pr ? `#${c.pr}` : c.sha.slice(0, 7))).join(', ')})` : '');
/** A film's causes in words. */
export function whyText(why: Cause[] | null | undefined): string | null {
  if (!why || !why.length) return null;
  return why.map((c) => {
    switch (c.kind) {
      case 'new': return 'first film';
      case 'asked': return 'filmed on request';
      case 'frame': return 'new film frame';
      case 'script': return `its script changed${refs(c.changes)}`;
      case 'screen': return `words on ${c.screens.join(', ') || 'a screen'} changed${c.shared ? ' (shared code)' : ''}${refs(c.changes)}`;
    }
  }).join('; ');
}

/** The languages tutorials.yml films each night, from its NIGHTLY_LANGUAGES line. */
export function nightlyLanguages(workflow: string): string[] | null {
  const m = /^\s*NIGHTLY_LANGUAGES:\s*([^\n#]*)/m.exec(workflow);
  return m ? m[1]!.split(',').map((l) => l.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null;
}

const LEVEL_ORDER: StateKey[] = ['fails', 'held', 'fixFailed', 'approve', 'merge', 'fixing', 'toFix', 'filming', 'tonight', 'slotted', 'comment', 'reply', 'publish', 'upload', 'new', 'paused', 'current'];

/** The three lists, from what was read. Pure. */
export function videoBoard(input: VideosInput, now = Date.now()): Videos {
  const { films, feedback, tutorials, status, filming, nightly } = input;
  const languages = Object.keys(CHANNELS) as ChannelLanguage[];
  const isNightly = (l: string) => (nightly ? nightly.includes(l) : l === 'en');
  const since = now - TIMELINE_DAYS * 86_400_000;
  const recent = (iso: string | null | undefined) => !!iso && Date.parse(iso) >= since;

  const titles = new Map<string, string>((feedback?.videos ?? []).map((v) => [v.tutorial, v.title]));
  for (const s of Object.values(status)) for (const v of s?.videos ?? []) if (!titles.has(v.tutorial)) titles.set(v.tutorial, v.title);
  const title = (t: string) => titles.get(t) ?? t;

  // Each language's films, newest last, by video.
  const filmsOf = new Map<string, FilmRow[]>();
  for (const f of films ?? []) {
    const key = `${f.language}\u0000${f.tutorial}`;
    filmsOf.set(key, [...(filmsOf.get(key) ?? []), f].sort((a, b) => a.madeAt.localeCompare(b.madeAt)));
  }
  // The videos of a language, in the nightly's order, else in the database's (by position), else the English titles'.
  const videosIn = (language: string): string[] => {
    const s = status[language];
    if (s) return s.videos.map((v) => v.tutorial);
    const seen = [...new Set((films ?? []).filter((f) => f.language === language).map((f) => f.tutorial))];
    return seen.length ? seen : language === 'en' ? [...titles.keys()] : [];
  };

  const filmingNow = filming?.run && filming.run.status !== 'completed' ? filming : null;
  const job = (language: string) => filming?.jobs.find((j) => j.language === language) ?? null;
  const filmingLanguage = (language: string) => { const j = filmingNow ? job(language) : null; return j && (j.state === 'running' || j.state === 'waiting') ? j : null; };

  // Comments and their suggested replies, by video and language.
  const inputs = new Map<string, FeedbackInput>();
  for (const i of feedback?.inputs ?? []) inputs.set(i.id, i);
  for (const s of feedback?.suggestions ?? []) for (const i of s.inputs) inputs.set(i.id, i);
  const comments = [...inputs.values()].filter((i) => i.kind === 'comment');
  const commentLink = (i: FeedbackInput) => (i.youtubeId && i.ref ? `https://www.youtube.com/watch?v=${i.youtubeId}&lc=${i.ref}` : 'https://studio.youtube.com');
  const replyDue = (i: FeedbackInput) => !!i.reply && now - Date.parse(i.at) <= REPLY_DAYS * 86_400_000;

  const admin: AdminItem[] = [];
  const worker: WorkerItem[] = [];

  // ---- suggestions and their fixes (any language: a suggestion names a video, not a language) ----
  const suggestionsOf = new Map<string, FixedSuggestion[]>();
  for (const s of feedback?.suggestions ?? []) {
    if (s.tutorial) suggestionsOf.set(s.tutorial, [...(suggestionsOf.get(s.tutorial) ?? []), s]);
    const on = s.tutorial ? `${title(s.tutorial)}: ` : '';
    if (!s.decision) admin.push({ kind: 'approve', title: `${on}${s.title}`, detail: s.detail, at: s.madeAt, ...(s.tutorial ? { tutorial: s.tutorial } : {}), suggestion: s });
    const fix = s.fix;
    if (fix?.state === 'open' && fix.pr) admin.push({ kind: 'merge', title: `${on}merge the fix in PR ${fix.pr}`, detail: s.title, at: fix.at, link: pr(fix.pr), ...(s.tutorial ? { tutorial: s.tutorial } : {}) });
    if (fix?.state === 'failed') admin.push({ kind: 'fixFailed', title: `${on}Claude could not write the fix`, detail: fix.note ?? s.title, at: fix.at, ...(fix.run ? { link: fix.run } : {}), ...(s.tutorial ? { tutorial: s.tutorial } : {}) });
    if (fix?.state === 'working') worker.push({ when: 'now', kind: 'fixing', title: `${on}Claude writes the fix`, detail: s.title, at: fix.at, ...(fix.run ? { link: fix.run } : {}) });
    if (s.decision === 'accepted' && !fix && s.tutorial && FIXABLE.has(s.kind)) worker.push({ when: 'next', kind: 'toFix', title: `${on}fix not started`, detail: s.title, at: s.decidedAt });
  }

  // ---- each video in each language ----
  const videos: VideoRow[] = [];
  for (const language of languages) {
    const s = status[language];
    const j = job(language);
    let slotted = 0;
    for (const tutorial of videosIn(language)) {
      const sv = s?.videos.find((v) => v.tutorial === tutorial);
      const own = filmsOf.get(`${language}\u0000${tutorial}`) ?? [];
      const newest = own[own.length - 1] ?? null;
      const states: VideoState[] = [];
      const add = (st: VideoState) => { if (!states.some((x) => x.key === st.key)) states.push(st); };

      if (sv?.tonight === 'failed') add({ key: 'fails', text: 'Film fails', level: 'bad', ...(j?.url ? { link: j.url } : {}) });
      if (sv?.tonight === 'held') { add({ key: 'held', text: 'Held by the frame check', level: 'bad', ...(j?.url ? { link: j.url } : {}) }); }
      for (const sg of suggestionsOf.get(tutorial) ?? []) {
        if (!sg.decision) add({ key: 'approve', text: 'Waits for admin approval', level: 'warn' });
        if (sg.fix?.state === 'failed') add({ key: 'fixFailed', text: 'Fix failed', level: 'bad', ...(sg.fix.run ? { link: sg.fix.run } : {}) });
        if (sg.fix?.state === 'open') add({ key: 'merge', text: 'Waits for admin to merge the PR', level: 'warn', ...(sg.fix.pr ? { link: pr(sg.fix.pr) } : {}) });
        if (sg.fix?.state === 'working') add({ key: 'fixing', text: 'Worker is fixing it', level: 'info' });
        if (sg.decision === 'accepted' && !sg.fix && FIXABLE.has(sg.kind)) add({ key: 'toFix', text: 'Accepted, fix not started', level: 'warn' });
        // A fix merged after the last night's status is filmed by the next night.
        if (sg.fix?.state === 'merged' && isNightly(language) && (!s || Date.parse(sg.fix.at) > Date.parse(s.at))) add({ key: 'tonight', text: 'Fix merged, films tonight', level: 'info' });
      }
      const slots = sv?.slots ?? [];
      if (slots.length) {
        slotted++;
        if (filmingLanguage(language)) add({ key: 'filming', text: 'Checked in tonight\'s run now', level: 'info', ...(j?.url ? { link: j.url } : {}) });
        else add({ key: 'slotted', text: `Screen changed, checked ${isNightly(language) ? 'tonight' : 'when the language is on'}`, level: 'info',
          link: slots[0]!.pr ? pr(slots[0]!.pr) : `${REPO}/commit/${slots[0]!.sha}` });
      }
      const mine = comments.filter((i) => i.tutorial === tutorial && (i.language ?? 'en') === language);
      if (mine.some((i) => !i.lookedAt)) add({ key: 'comment', text: 'Comment not handled yet', level: 'info', link: commentLink(mine.find((i) => !i.lookedAt)!) });
      if (mine.some(replyDue)) add({ key: 'reply', text: 'Reply suggested', level: 'warn', link: commentLink(mine.find(replyDue)!) });
      if (newest && !newest.youtubeId) {
        if (newest.failed && RECONNECT.test(newest.failed)) add({ key: 'upload', text: 'Upload refused: connect the channel again', level: 'bad' });
        else if (!newest.chosenAt) add({ key: 'publish', text: 'Ready to publish', level: 'warn' });
        else add({ key: 'upload', text: 'New film waits for upload (YouTube daily limit)', level: 'info' });
      }
      if (!newest && !(sv?.film)) add({ key: 'new', text: 'No film yet', level: isNightly(language) ? 'info' : 'warn' });
      if (!isNightly(language)) add({ key: 'paused', text: 'Language paused', level: 'warn' });
      if (!states.length) add({ key: 'current', text: 'Up to date', level: 'good' });
      states.sort((a, b) => LEVEL_ORDER.indexOf(a.key) - LEVEL_ORDER.indexOf(b.key));

      // The timeline: films and uploads, comments, suggestions and fixes, tonight's hold or failure.
      const marks: Mark[] = [];
      for (const f of own) {
        const why = sv?.film && sv.film.sha256 === f.sha256 ? sv.film.why : null;
        if (recent(f.madeAt)) marks.push({ at: f.madeAt, kind: 'film', cause: causeOf(why), text: whyText(why) ?? 'new film' });
        if (recent(f.publishedAt) && f.youtubeId) marks.push({ at: f.publishedAt!, kind: 'up', text: 'on YouTube', link: `https://youtu.be/${f.youtubeId}` });
      }
      for (const i of mine) if (recent(i.at)) marks.push({ at: i.at, kind: 'comment', text: i.english ?? i.text, link: commentLink(i) });
      for (const sg of suggestionsOf.get(tutorial) ?? []) {
        if (recent(sg.madeAt)) marks.push({ at: sg.madeAt, kind: 'suggested', text: `Suggested: ${sg.title}` });
        if (sg.decision && recent(sg.decidedAt)) marks.push({ at: sg.decidedAt!, kind: 'decided', text: `${sg.decision === 'accepted' ? 'Accepted' : 'Rejected'}: ${sg.title}` });
        if (sg.fix && recent(sg.fix.at)) marks.push({ at: sg.fix.at, kind: 'fix', text: `Fix ${sg.fix.state}${sg.fix.pr ? ` (PR ${sg.fix.pr})` : ''}`, ...(sg.fix.pr ? { link: pr(sg.fix.pr) } : sg.fix.run ? { link: sg.fix.run } : {}) });
      }
      if (s && (sv?.tonight === 'held' || sv?.tonight === 'failed')) marks.push({ at: s.at, kind: sv.tonight, text: sv.tonight === 'held' ? `Held: ${(sv.held ?? []).join('; ')}` : 'Film failed' });
      marks.sort((a, b) => a.at.localeCompare(b.at));

      const filmWhy = sv?.film && newest && sv.film.sha256 === newest.sha256 ? whyText(sv.film.why) : null;
      videos.push({
        tutorial, language, title: title(tutorial), states, marks,
        film: newest ? { madeAt: newest.madeAt, why: filmWhy, up: !!newest.youtubeId } : sv?.film?.filmedAt ? { madeAt: sv.film.filmedAt, why: whyText(sv.film.why), up: false } : null
      });
      if (sv?.tonight === 'held') admin.push({ kind: 'held', title: `${title(tutorial)} (${language}): look at the held film`, detail: (sv.held ?? []).join('; ') || 'The frame check held it.', at: s!.at, tutorial, language, ...(j?.url ? { link: j.url } : {}) });
      if (sv?.tonight === 'failed') admin.push({ kind: 'fails', title: `${title(tutorial)} (${language}): the film fails`, detail: 'Its script or the app stops it. The log says where.', at: s!.at, tutorial, language, ...(j?.url ? { link: j.url } : {}) });
      for (const i of mine.filter(replyDue)) admin.push({ kind: 'reply', title: `${title(tutorial)} (${language}): post the suggested reply`, detail: `${i.english ?? i.text}\nReply: ${i.replyEnglish ?? i.reply}`, at: i.at, tutorial, language, link: commentLink(i) });
    }
    // ---- this language's worker queue ----
    const j2 = filmingLanguage(language);
    if (j2) worker.push({ when: j2.state === 'running' ? 'now' : 'next', kind: 'filming', title: `Filming ${language}`, detail: j2.state === 'running' ? (j2.step ?? 'running') : 'waits its turn (five languages film at once)', at: j2.startedAt, ...(j2.url ? { link: j2.url } : {}) });
    else if (slotted && isNightly(language)) worker.push({ when: 'next', kind: 'check', title: `Check ${slotted} ${slotted === 1 ? 'video' : 'videos'} in ${language} tonight`, detail: 'A screen they show changed. A video films again only when its words changed.' });
    const waiting = (tutorials?.waiting ?? []).filter((w) => w.language === language && w.chosenAt && !(w.failed && RECONNECT.test(w.failed)));
    if (waiting.length) worker.push({ when: 'next', kind: 'upload', title: `Upload ${waiting.length} ${waiting.length === 1 ? 'film' : 'films'} in ${language}`, detail: 'YouTube takes about 100 a day for all channels.', at: waiting[0]!.chosenAt });
  }

  // ---- the rest of the admin list ----
  const ready = (tutorials?.waiting ?? []).filter((w) => !w.chosenAt);
  if (ready.length) admin.push({ kind: 'publish', title: `Publish ${ready.length} ${ready.length === 1 ? 'film' : 'films'}`, detail: 'Tick them under Channels and videos, then Publish.', at: null, link: '#tutorials' });
  for (const c of tutorials?.channels ?? []) {
    const needs = !c.connectedAt ? isNightly(c.language) || (tutorials?.waiting ?? []).some((w) => w.language === c.language)
      : (tutorials?.waiting ?? []).some((w) => w.language === c.language && w.failed && RECONNECT.test(w.failed));
    if (needs) admin.push({ kind: 'connect', title: `${c.connectedAt ? 'Connect again' : 'Connect'} the ${c.language} channel`, detail: 'Under Channels and videos.', at: null, language: c.language, link: '#tutorials' });
  }
  const paused = languages.filter((l) => !isNightly(l));
  if (paused.length) admin.push({ kind: 'paused', title: `${paused.length} ${paused.length === 1 ? 'language is' : 'languages are'} paused`, detail: `Not filmed each night: ${paused.join(', ')}. Add one to NIGHTLY_LANGUAGES in tutorials.yml to turn it on.`, at: null, link: `${REPO}/blob/main/.github/workflows/tutorials.yml` });

  // ---- the rest of the worker queue ----
  if (feedback?.waiting) worker.push({ when: 'next', kind: 'comments', title: `Claude looks at ${feedback.waiting} new ${feedback.waiting === 1 ? 'comment, change or note' : 'comments, changes and notes'}`, detail: 'Each morning at 10:00 UTC (tutorial-review.yml).' });
  if (filming?.run && !filmingNow) worker.unshift({ when: 'next', kind: 'filming', title: 'Next filming run: 20:10 UTC', detail: `Languages: ${(nightly ?? ['en']).join(', ')}. Last run ${filming.run.number}: ${filming.run.conclusion ?? filming.run.status}.`, link: filming.run.url });

  const ADMIN_ORDER: AdminItem['kind'][] = ['fails', 'held', 'fixFailed', 'merge', 'approve', 'reply', 'connect', 'publish', 'paused'];
  admin.sort((a, b) => ADMIN_ORDER.indexOf(a.kind) - ADMIN_ORDER.indexOf(b.kind) || (b.at ?? '').localeCompare(a.at ?? ''));
  worker.sort((a, b) => Number(a.when !== 'now') - Number(b.when !== 'now'));

  const missing = [
    ...(films ? [] : ['films (migration 20261113234000_tutorial_films.sql)']),
    ...(feedback ? [] : ['suggestions and comments']),
    ...(tutorials ? [] : ['channels and uploads']),
    ...(filming ? [] : ['the filming run on GitHub']),
    ...(nightly ? [] : ['the nightly language list']),
    ...(Object.keys(status).length ? [] : ['the nightly status files (the first comes the night after PR 449 merges)'])
  ];
  return {
    languages: languages.map((l) => ({ language: l, nightly: isNightly(l), statusAt: status[l]?.at ?? null })),
    videos, admin, worker, missing
  };
}

// ---- reading ------------------------------------------------------------------------------------

export interface VideosEnv extends GitHubEnv { DIAG?: Hyperdrive }

/** A database read, or null when the function is missing or fails (the list says what it lacks). */
async function maybe<T>(query: Query, sql: string): Promise<T | null> {
  try { return (await query<T>(sql)) ?? null; } catch { return null; }
}

/** status-<language>.json from the public release, or nothing when that language has none yet. */
async function statusFile(env: GitHubEnv, language: string, fetcher: typeof fetch): Promise<StatusFile | null> {
  const res = await fetcher(`https://github.com/${env.GITHUB_REPO}/releases/download/tutorials/status-${language}.json`,
    { headers: { 'user-agent': 'langquest-next-admin' }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  if (!res || !res.ok) return null;
  const body = await res.json().catch(() => null) as StatusFile | null;
  return body && Array.isArray(body.videos) ? body : null;
}

export async function videosSection(env: VideosEnv, fetcher: typeof fetch = fetch): Promise<Section> {
  const gh = githubApi(env, fetcher);
  const db = (async () => {
    try {
      return await withDiag(diagConnection(env), async (query) => {
        const [films, feedback, tutorials] = await Promise.all([
          maybe<FilmRow[]>(query, 'select diag.ops_tutorial_films() as v'),
          maybe<VideosInput['feedback']>(query, 'select diag.ops_tutorial_feedback() as v'),
          maybe<Parameters<typeof tutorialsOf>[0]>(query, 'select diag.ops_tutorials() as v')
        ]);
        return { films, feedback, tutorials };
      });
    } catch {
      return { films: null, feedback: null, tutorials: null };
    }
  })();
  const workflow = gh<{ content: string }>('/contents/.github/workflows/tutorials.yml?ref=main', 'GitHub tutorials.yml')
    .then((f) => nightlyLanguages(atob(f.content.replace(/\n/g, '')))).catch(() => null);
  const filming = filmingSection(env, fetcher).then((s) => (s.state === 'ok' ? s.data as Filming : null)).catch(() => null);
  const statuses = Promise.all(Object.keys(CHANNELS).map(async (l) => [l, await statusFile(env, l, fetcher)] as const));
  const [d, nightly, run, files] = await Promise.all([db, workflow, filming, statuses]);
  if (!d.films && !d.feedback && !d.tutorials && !run) return failed('Could not read the database or GitHub for the tutorial videos.');
  const status: Partial<Record<string, StatusFile>> = {};
  for (const [l, f] of files) if (f) status[l] = f;
  return ok(videoBoard({ films: d.films, feedback: d.feedback, tutorials: d.tutorials ? tutorialsOf(d.tutorials) : null, status, filming: run, nightly }));
}
