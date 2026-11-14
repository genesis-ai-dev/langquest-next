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
/** A suggestion with its fix; an admin's instruction is a suggestion of kind 'instruction', with the language of the film it is about. */
type FixedSuggestion = Omit<Suggestion, 'kind'> & { kind: Suggestion['kind'] | 'instruction'; language?: string | null; fix?: Fix | null };

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
  /** What a click on the mark opens: lines to read, what was written as written, links, and films to watch side by side. */
  detail: MarkDetail;
}

export interface MarkDetail {
  title: string;
  lines: string[];
  /** A comment as written, in its own language. */
  quote?: string;
  links: { text: string; href: string }[];
  /** Films to play: this film, and the one before it to compare. */
  films: { label: string; href: string }[];
}

export interface VideoRow {
  tutorial: string; language: string; title: string;
  states: VideoState[];
  /** The newest film: when it was made and why, and whether YouTube has it. */
  film: { madeAt: string; why: string | null; up: boolean } | null;
  marks: Mark[];
}

export interface AdminItem {
  kind: 'approve' | 'merge' | 'fixFailed' | 'held' | 'fails' | 'reply' | 'comment' | 'screen' | 'publish' | 'connect' | 'paused';
  /** The problem, in a line. */
  title: string;
  /** What is wrong, as found. */
  detail: string;
  at: string | null;
  /** Who acts next: an admin, Claude (at its next run), or nobody until an admin does. */
  who: 'you' | 'claude';
  /** What happens next, and what happens if the admin does nothing. */
  next: string;
  tutorial?: string; language?: string; link?: string;
  /** For `approve`: the suggestion, for its Accept, Edit and Reject. */
  suggestion?: FixedSuggestion;
  /** Where "Tell Claude what to do" applies: the words that start the note, so Claude knows the problem it answers. */
  instruct?: string;
  /** The admin's newest instruction for this video since the problem began. */
  instructed?: { at: string; text: string; looked: boolean; fix: Fix | null };
  /** The comment or change inputs the card shows, sent with an instruction so the look does not suggest them again. */
  inputIds?: string[];
}

export interface WorkerItem {
  /** `now`: running; `next`: waits its turn or tonight's run. */
  when: 'now' | 'next';
  kind: 'filming' | 'check' | 'fixing' | 'toFix' | 'comments' | 'upload';
  title: string; detail: string; link?: string; at?: string | null;
}

export interface Videos {
  /** Each app language: filmed each night or paused, its last status file, and how many of its videos need a person (a bad or warn state, not counting the pause). */
  languages: { language: string; nightly: boolean; statusAt: string | null; issues: number }[];
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
/** Suggestions Claude writes as a fix: a change to a video's script, screens or voice, and an admin's instruction (accepted as it is sent). */
const FIXABLE = new Set(['script', 'screen', 'voice', 'instruction']);

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

/** A state that waits on a person; a paused language's own pause and missing films are said once, not per video. */
const NEEDS_PERSON = (s: VideoState) => (s.level === 'bad' || s.level === 'warn') && s.key !== 'paused' && s.key !== 'new';

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
    // A suggestion's cards go on its video's row in its film's language (English when it names none).
    const where = s.tutorial ? { tutorial: s.tutorial, language: s.language ?? 'en' } : {};
    if (!s.decision) admin.push({ kind: 'approve', title: `${on}${s.title}`, detail: s.detail, at: s.madeAt, who: 'you', ...where, suggestion: s,
      next: FIXABLE.has(s.kind) && s.tutorial ? 'Accept: Claude writes the change as a pull request, and you merge it. The next night films the video again. Nothing happens until you answer.'
        : s.kind === 'code' ? 'Accept: it goes to Linear as an app issue. Nothing happens until you answer.' : 'Accept or reject it. Nothing happens until you answer.' });
    const fix = s.fix;
    if (fix?.state === 'open' && fix.pr) admin.push({ kind: 'merge', title: `${on}Claude's fix waits for your merge (PR ${fix.pr})`, detail: s.title, at: fix.at, who: 'you', link: pr(fix.pr),
      next: 'Look at the change and merge it. The next night films the video again. Nothing happens until you merge.', ...where });
    if (fix?.state === 'failed') admin.push({ kind: 'fixFailed', title: `${on}Claude could not write the fix`, detail: fix.note ?? s.title, at: fix.at, who: 'you', ...(fix.run ? { link: fix.run } : {}),
      next: 'Tell Claude what to do instead. Claude tries again at its next run. Nothing happens until you do.', ...where, ...(s.tutorial ? { instruct: `Claude could not write the fix for "${s.title}" (${fix.note ?? 'no reason given'}).` } : {}) });
    if (fix?.state === 'working') worker.push({ when: 'now', kind: 'fixing', title: `${on}Claude writes the fix now`, detail: `${s.title}. When done, the pull request waits for your merge under For an admin.`, at: fix.at, ...(fix.run ? { link: fix.run } : {}) });
    if (s.decision === 'accepted' && !fix && s.tutorial && FIXABLE.has(s.kind)) worker.push({ when: 'next', kind: 'toFix', title: `${on}Claude starts the fix at its next fix run (:20 and :50 each hour)`, detail: `${s.kind === 'instruction' ? `Your instruction: ${s.detail}` : `${s.title}. You accepted it.`} Claude writes it as a pull request for your merge.`, at: s.decidedAt });
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
        if (sg.decision === 'accepted' && !sg.fix && FIXABLE.has(sg.kind)) add({ key: 'toFix', text: sg.kind === 'instruction' ? 'Claude has your instruction' : 'Accepted, fix not started', level: sg.kind === 'instruction' ? 'info' : 'warn' });
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
      const filmHref = (f: FilmRow) => `/api/tutorials/${language}/${tutorial}/${f.sha256}.mp4`;
      const changeLinks = (why: Cause[] | null) => (why ?? []).flatMap((c) => 'changes' in c ? c.changes.map((r) => ({
        text: `${c.kind === 'script' ? 'Script' : c.shared ? 'Shared app code' : 'App'} change: ${r.pr ? `PR ${r.pr}` : r.sha.slice(0, 7)}${r.subject && !/^Merge pull request/.test(r.subject) ? ` (${r.subject.slice(0, 80)})` : ''}`,
        href: r.pr ? `${pr(r.pr)}/files` : `${REPO}/commit/${r.sha}`
      })) : []);
      const causeLines = (why: Cause[] | null) => why ? why.map((c) => whyText([c])!) : ['Why this film was made was not recorded: films before 14 November keep no cause.'];
      own.forEach((f, n) => {
        const why = sv?.film && sv.film.sha256 === f.sha256 ? sv.film.why : null;
        const before = own[n - 1];
        if (recent(f.madeAt)) marks.push({ at: f.madeAt, kind: 'film', cause: causeOf(why), text: whyText(why) ?? 'new film', detail: {
          title: `New film, ${f.madeAt.slice(0, 16).replace('T', ' ')} UTC`,
          lines: [...causeLines(why), ...(why?.some((c) => c.kind === 'screen') ? [`Steps whose words changed: ${why.flatMap((c) => c.kind === 'screen' ? c.steps : []).join(', ')}.`] : [])],
          links: [...changeLinks(why), ...(f.youtubeId ? [{ text: 'Watch on YouTube', href: `https://youtu.be/${f.youtubeId}` }] : [])],
          films: [{ label: 'This film', href: filmHref(f) }, ...(before ? [{ label: 'The film before', href: filmHref(before) }] : [])]
        } });
        if (recent(f.publishedAt) && f.youtubeId) marks.push({ at: f.publishedAt!, kind: 'up', text: 'on YouTube', link: `https://youtu.be/${f.youtubeId}`, detail: {
          title: 'On YouTube', lines: [`Put up ${f.publishedAt!.slice(0, 16).replace('T', ' ')} UTC.`],
          links: [{ text: 'Watch on YouTube', href: `https://youtu.be/${f.youtubeId}` }], films: []
        } });
      });
      for (const i of mine) if (recent(i.at)) marks.push({ at: i.at, kind: 'comment', text: i.english ?? i.text, link: commentLink(i), detail: {
        title: `Comment on YouTube (${language})`,
        lines: [...(i.english && i.english !== i.text ? [`In English: ${i.english}`] : []), ...(i.reply ? [`Reply suggested: ${i.replyEnglish ?? i.reply}`] : []),
          i.lookedAt ? `Claude's answer: ${i.outcome ?? 'made a suggestion (see the suggestion mark)'}` : 'Claude has not looked at it yet.'],
        quote: i.text, links: [{ text: 'Open the comment on YouTube', href: commentLink(i) }], films: []
      } });
      for (const sg of suggestionsOf.get(tutorial) ?? []) {
        const about = [sg.detail, ...sg.inputs.map((i) => `Answers: ${i.english ?? i.text}`)];
        if (recent(sg.madeAt)) marks.push({ at: sg.madeAt, kind: 'suggested', text: `Suggested: ${sg.title}`, detail: { title: `Claude suggested: ${sg.title}`, lines: about, links: [], films: [] } });
        if (sg.decision && recent(sg.decidedAt)) marks.push({ at: sg.decidedAt!, kind: 'decided', text: `${sg.decision === 'accepted' ? 'Accepted' : 'Rejected'}: ${sg.title}`, detail: {
          title: `${sg.decision === 'accepted' ? 'Accepted' : 'Rejected'}: ${sg.title}`, lines: [...about, ...(sg.reason ? [`Why: ${sg.reason}`] : [])],
          links: sg.issueUrl ? [{ text: `Linear ${sg.issue}`, href: sg.issueUrl }] : [], films: []
        } });
        if (sg.fix && recent(sg.fix.at)) marks.push({ at: sg.fix.at, kind: 'fix', text: `Fix ${sg.fix.state}${sg.fix.pr ? ` (PR ${sg.fix.pr})` : ''}`, ...(sg.fix.pr ? { link: pr(sg.fix.pr) } : sg.fix.run ? { link: sg.fix.run } : {}), detail: {
          title: `Fix: ${sg.fix.state}`, lines: [sg.title, ...(sg.fix.note ? [`Error: ${sg.fix.note}`] : [])],
          links: [...(sg.fix.pr ? [{ text: `PR ${sg.fix.pr}: what changed in the script`, href: `${pr(sg.fix.pr)}/files` }] : []), ...(sg.fix.run ? [{ text: 'The run that wrote it', href: sg.fix.run }] : [])], films: []
        } });
      }
      if (s && (sv?.tonight === 'held' || sv?.tonight === 'failed')) marks.push({ at: s.at, kind: sv.tonight, text: sv.tonight === 'held' ? `Held: ${(sv.held ?? []).join('; ')}` : 'Film failed', detail: {
        title: sv.tonight === 'held' ? 'Held by the frame check' : 'The film failed',
        lines: sv.tonight === 'held' ? (sv.held ?? ['The frame check held it.']) : ['The error is in the log of the language\'s filming job.'],
        links: j?.url ? [{ text: 'Open the log', href: j.url }] : [], films: []
      } });
      marks.sort((a, b) => a.at.localeCompare(b.at));

      const filmWhy = sv?.film && newest && sv.film.sha256 === newest.sha256 ? whyText(sv.film.why) : null;
      videos.push({
        tutorial, language, title: title(tutorial), states, marks,
        film: newest ? { madeAt: newest.madeAt, why: filmWhy, up: !!newest.youtubeId } : sv?.film?.filmedAt ? { madeAt: sv.film.filmedAt, why: whyText(sv.film.why), up: false } : null
      });
      const name = `${title(tutorial)} (${language})`;
      if (sv?.tonight === 'held') admin.push({ kind: 'held', title: `${name}: the new film was held back`, detail: `The frame check found: ${(sv.held ?? []).join('; ') || 'a problem in a frame'}. YouTube keeps the old film.`, at: s!.at, tutorial, language, who: 'you',
        next: 'Each night films it again and holds it again until the cause is fixed. Watch the film in the timeline, then tell Claude what to change.', instruct: `The new film of "${title(tutorial)}" (${language}) was held by the frame check: ${(sv.held ?? []).join('; ')}.`, ...(j?.url ? { link: j.url } : {}) });
      if (sv?.tonight === 'failed') admin.push({ kind: 'fails', title: `${name}: the film fails`, detail: 'The filming stops at a step: the script expects something the app no longer shows. YouTube keeps the old film.', at: s!.at, tutorial, language, who: 'you',
        next: 'Each night fails again until the script or the app is fixed. Tell Claude what changed, or what the script must do now.', instruct: `The film of "${title(tutorial)}" (${language}) fails each night (see the log of the filming run).`, ...(j?.url ? { link: j.url } : {}) });
      for (const i of mine.filter(replyDue)) admin.push({ kind: 'reply', title: `${name}: a reply to post`, detail: `Comment: ${i.english ?? i.text}\nSuggested reply: ${i.replyEnglish ?? i.reply}`, at: i.at, tutorial, language, who: 'you', link: commentLink(i),
        next: 'Post the reply on YouTube yourself. The app does not post replies. This card goes away after 14 days.' });
      for (const i of mine.filter((c) => !c.lookedAt)) admin.push({ kind: 'comment', title: `${name}: a new comment`, detail: i.english ?? i.text, at: i.at, tutorial, language, who: 'claude', link: commentLink(i),
        next: 'Claude reads it at 10:00 UTC and suggests a change or a reply for you to accept. To skip that step, tell Claude now what to do.', inputIds: [i.id], instruct: `About the comment on "${title(tutorial)}" (${language}): "${i.english ?? i.text}".` });
      if (slots.length && isNightly(language)) admin.push({ kind: 'screen', title: `${name}: a screen it shows changed`, detail: slots.map((c) => `${c.pr ? `PR ${c.pr}` : c.sha.slice(0, 7)} changed ${c.screens.join(', ')}`).join('; '), at: s?.at ?? null, tutorial, language, who: 'claude',
        link: slots[0]!.pr ? `${pr(slots[0]!.pr)}/files` : `${REPO}/commit/${slots[0]!.sha}`,
        next: 'Tonight the filming checks the video. It films again only if the words on its screens changed. If the script must change too, tell Claude now.', instruct: `A screen in "${title(tutorial)}" (${language}) changed: ${slots.map((c) => (c.pr ? `PR ${c.pr}` : c.sha.slice(0, 7))).join(', ')}.` });
    }
    // ---- this language's worker queue ----
    const j2 = filmingLanguage(language);
    if (j2) worker.push({ when: j2.state === 'running' ? 'now' : 'next', kind: 'filming', title: `Filming ${language} now`, detail: j2.state === 'running' ? `Step: ${j2.step ?? 'running'}. Each video is tried; one films again only when its script or screen words changed.` : 'Waits its turn: five languages film at once.', at: j2.startedAt, ...(j2.url ? { link: j2.url } : {}) });
    else if (slotted && isNightly(language)) worker.push({ when: 'next', kind: 'check', title: `Tonight: check ${slotted} ${slotted === 1 ? 'video' : 'videos'} in ${language} for screen changes`, detail: 'A screen each one shows changed. A video films again only when its words changed; otherwise its film stays.' });
    const waiting = (tutorials?.waiting ?? []).filter((w) => w.language === language && w.chosenAt && !(w.failed && RECONNECT.test(w.failed)));
    if (waiting.length) worker.push({ when: 'next', kind: 'upload', title: `Put ${waiting.length} new ${waiting.length === 1 ? 'film' : 'films'} in ${language} on YouTube`, detail: 'They go up by themselves. YouTube takes about 100 a day for all channels, so some wait a day.', at: waiting[0]!.chosenAt });
  }

  // ---- the rest of the admin list ----
  const ready = (tutorials?.waiting ?? []).filter((w) => !w.chosenAt);
  if (ready.length) admin.push({ kind: 'publish', title: `${ready.length} ${ready.length === 1 ? 'film waits' : 'films wait'} for Publish`, detail: 'A film made before the videos were wide is not chosen by itself.', at: null, who: 'you', link: '#tutorials',
    next: 'Tick them under Channels and videos, then Publish. They stay off YouTube until you do.' });
  for (const c of tutorials?.channels ?? []) {
    const needs = !c.connectedAt ? isNightly(c.language) || (tutorials?.waiting ?? []).some((w) => w.language === c.language)
      : (tutorials?.waiting ?? []).some((w) => w.language === c.language && w.failed && RECONNECT.test(w.failed));
    if (needs) admin.push({ kind: 'connect', title: `The ${c.language} channel is ${c.connectedAt ? 'refused by YouTube' : 'not connected'}`, detail: 'LangQuest cannot put films up there.', at: null, who: 'you', language: c.language, link: '#tutorials',
      next: 'Press Connect under Channels and videos, and sign in with the account that owns the channel.' });
  }
  const paused = languages.filter((l) => !isNightly(l));
  if (paused.length) admin.push({ kind: 'paused', title: `${paused.length} ${paused.length === 1 ? 'language is' : 'languages are'} paused`, detail: `Not filmed each night: ${paused.join(', ')}.`, at: null, who: 'you', link: `${REPO}/blob/main/.github/workflows/tutorials.yml`,
    next: 'Their videos stay as they are. To turn one on, add it to NIGHTLY_LANGUAGES in tutorials.yml (a pull request).' });

  // ---- the rest of the worker queue ----
  if (feedback?.waiting) worker.push({ when: 'next', kind: 'comments', title: `10:00 UTC: Claude reads ${feedback.waiting} new ${feedback.waiting === 1 ? 'comment, change or note' : 'comments, changes and notes'}`, detail: 'Each comment or change becomes a suggestion on its video\'s row, for you to accept or reject.' });
  if (filming?.run && !filmingNow) worker.unshift({ when: 'next', kind: 'filming', title: `20:10 UTC: film the videos that changed (${(nightly ?? ['en']).join(', ')})`, detail: `Each video is tried; one films again only when its script or screen words changed. New films then go up on YouTube. Last run (${filming.run.number}): ${filming.run.conclusion ?? filming.run.status}.`, link: filming.run.url });

  // An instruction sent from a card: the newest instruction for that video since the problem began
  // (a suggestion of kind 'instruction', with its fix); before the Worker knew instructions, a note on the video.
  const notes = [...inputs.values()].filter((i) => i.kind === 'note' && i.tutorial);
  const instructions = (feedback?.suggestions ?? []).filter((x) => x.kind === 'instruction' && x.tutorial);
  const after = (a: AdminItem, at: string) => !a.at || at >= a.at;
  for (const a of admin) {
    if (!a.instruct || !a.tutorial) continue;
    const ins = instructions.filter((x) => x.tutorial === a.tutorial && (x.language ?? 'en') === (a.language ?? 'en') && after(a, x.madeAt)).sort((x, y) => y.madeAt.localeCompare(x.madeAt))[0];
    const n = ins ? null : notes.filter((i) => i.tutorial === a.tutorial && after(a, i.at)).sort((x, y) => y.at.localeCompare(x.at))[0];
    if (ins) a.instructed = { at: ins.madeAt, text: ins.detail, looked: true, fix: ins.fix ?? null };
    else if (n) a.instructed = { at: n.at, text: n.text, looked: !!n.lookedAt, fix: null };
    if (a.instructed) a.who = 'claude';
  }
  // A problem whose instruction became a fix waiting for a merge, or a fix that failed, is said by that fix's own card.
  for (let k = admin.length - 1; k >= 0; k--) if (admin[k]!.instructed?.fix && ['open', 'failed'].includes(admin[k]!.instructed!.fix!.state)) admin.splice(k, 1);
  const ADMIN_ORDER: AdminItem['kind'][] = ['fails', 'held', 'fixFailed', 'merge', 'approve', 'reply', 'comment', 'screen', 'connect', 'publish', 'paused'];
  admin.sort((a, b) => Number(a.who !== 'you') - Number(b.who !== 'you') || ADMIN_ORDER.indexOf(a.kind) - ADMIN_ORDER.indexOf(b.kind) || (b.at ?? '').localeCompare(a.at ?? ''));
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
    languages: languages.map((l) => ({ language: l, nightly: isNightly(l), statusAt: status[l]?.at ?? null,
      issues: new Set(admin.filter((a) => a.language === l && a.tutorial && a.who === 'you').map((a) => a.tutorial)).size })),
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
