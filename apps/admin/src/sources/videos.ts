import { CHANNELS, type ChannelLanguage } from '../../../../server/youtube';
import type { AppFix, FeedbackInput, Picture, Suggestion } from '../../../../server/tutorialFeedback';
import { diagConnection, withDiag, type Query } from '../db';
import { failed, ok, type Section } from '../section';
import { filmingSection, type Filming } from './filming';
import { fixesSection, type FixPr } from './fixes';
import { githubApi, type GitHubEnv } from './githubApi';
import { tutorialsOf, type CardRecord, type Feedback, type Tutorials } from './ops';

/**
 * The tutorial videos as three lists (docs/tutorial-videos.md "On the ops
 * dashboard", decisions.md 186 amended 2026-11-13 and 2026-11-16): every video
 * in each app language with its state and a timeline of what happened to it;
 * what an admin must do (answer a suggestion, say what to do when Claude could
 * not make a change, post a suggested reply and say so, publish, connect a
 * channel); and what
 * the workers do now or tonight (filming, checks of slotted videos, fixes being
 * written or merging themselves, comments to read, uploads). A fourth list is
 * the record of every change Claude made to a video, with its pull request:
 * a clear fix merges itself, so no person sees it except here. The page draws them as four tabs
 * (pageVideos.ts, docs/decisions/2026-11-19-the-tutorial-videos-page-opens-on-what-waits-on-you.md).
 * Read from four places: the database
 * (diag.ops_tutorial_films, ops_tutorial_feedback, ops_tutorials), each
 * language's status-<language>.json in the public `tutorials` release (the
 * nightly writes it, e2e/tutorials/nightly.ts), the filming run on GitHub
 * (sources/filming.ts), and the languages filmed each night (the dashboard's switches, else tutorials.yml).
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

/**
 * A suggestion's fix (server/tutorialFeedback.ts FIX_STATES): Claude writes it as a pull request that merges itself when
 * its checks pass (`open` until then), or finds the video already does it (`unneeded`).
 */
export interface Fix { state: 'working' | 'open' | 'merged' | 'closed' | 'failed' | 'unneeded'; pr: number | null; at: string; run: string | null; note: string | null }
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
  /** The pull requests that name a Linear issue (sources/fixes.ts): where a fix in the app is on GitHub. */
  prs?: FixPr[] | null;
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
  /** For a film: what made it ('app' | 'script' | 'tool' | 'new' | 'asked' | 'unknown'). For a decision: 'accepted' or 'rejected'. For a fix: its state. */
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
  /** What a suggestion is about, as Claude picked it from the last film run, and the same places after its fix. */
  pictures?: Picture[];
  after?: Picture[];
}

/** One cause of a film, for the page: the mark it has on the timeline, what happened in words, and the changes that did it. */
export interface FilmCause { mark: string; text: string; links: { text: string; href: string }[] }

export interface VideoRow {
  tutorial: string; language: string; title: string;
  states: VideoState[];
  /** The newest film: when it was made and why (in a line, and cause by cause for the page), and whether YouTube has it. */
  film: { madeAt: string; why: string | null; causes: FilmCause[]; up: boolean } | null;
  marks: Mark[];
}

export interface AdminItem {
  kind: 'approve' | 'appFix' | 'fixFailed' | 'held' | 'fails' | 'reply' | 'comment' | 'screen' | 'publish' | 'connect' | 'empty' | 'paused';
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
  /** What the card is about, as pictures Claude picked from the last film run (decisions.md 186, amended 2026-11-17). */
  pictures?: Picture[];
  /** Where "Tell Claude what to do" applies: the words that start the note, so Claude knows the problem it answers. */
  instruct?: string;
  /** The admin's newest instruction for this video since the problem began. */
  instructed?: { at: string; text: string; looked: boolean; fix: Fix | null };
  /** The comment or change inputs the card shows, sent with an instruction so the look does not suggest them again. */
  inputIds?: string[];
  /** The video's title, for a card that is one video's. */
  video?: string;
  /** For `empty`: the language's Film each night switch, and how many videos its first night films. */
  filming?: { language: string; on: boolean; videos: number };
  /**
   * For `reply`: the comment (in English, and as written when that differs), the reply Claude suggests in the comment's
   * language (and in English when that differs), and the comment on YouTube. The page copies the reply; a person posts it.
   */
  reply?: { id: string; comment: string; original: string | null; text: string; english: string | null; link: string };
  /** For `fixFailed`: the instruction "Try again" sends, which names the change in full. */
  retry?: string;
  /** "Fix it" on this suggestion: the agent team changes the app (on a code suggestion, or a change to the video that failed). */
  fixApp?: string;
  /**
   * For `appFix`: the fix in the app, from Fix it to the new film, as one card that stays until a day after the film
   * (docs/decisions/2026-11-21-fix-it-sends-a-video-suggestion-to-the-agent-team.md). `issue` takes the admin's
   * instructions ("ask me first", "merge it"); `pr` is the agent team's pull request; `why` says why it waits on the
   * admin (stage `yours` or `none`); `before` and `after` say whether the agent team kept the screen before and after
   * its change; `answer` is the team's newest answer to an instruction.
   */
  app?: { issue: string | null; stage: AppStage; pr: number | null; summary: string | null; answer: string | null; why: string | null; before: boolean; after: boolean; askFirst: boolean };
}

export interface WorkerItem {
  /** `now`: running; `next`: waits its turn or tonight's run. */
  when: 'now' | 'next';
  kind: 'filming' | 'check' | 'fixing' | 'merging' | 'toFix' | 'comments' | 'upload';
  title: string; detail: string; link?: string; at?: string | null;
}

/** One change Claude made, or tried to make, to a video: the record (decisions.md 186, amended 2026-11-16). Newest first. */
export interface ChangeItem {
  /** When the fix last moved. */
  at: string;
  tutorial: string; language: string;
  /** The video's title, and the change in a line. */
  video: string; change: string;
  /** Who said yes: Claude itself (a clear fix), an admin (an accepted suggestion), or an admin's instruction. */
  by: 'claude' | 'admin' | 'instruction';
  state: Fix['state'];
  pr: number | null; link: string | null;
  /** Why it failed, or why no change was needed. */
  note: string | null;
  /** What the change is about, before it, and the same places once the video was filmed again. */
  pictures: Picture[];
  after: Picture[];
}

export interface Videos {
  /** Each app language: filmed each night or paused, its last status file, and how many of its videos need a person (a bad or warn state, not counting the pause). */
  languages: { language: string; nightly: boolean; statusAt: string | null; issues: number }[];
  videos: VideoRow[];
  admin: AdminItem[];
  worker: WorkerItem[];
  changes: ChangeItem[];
  /** Whether each source answered: a list built without one says so on the page. */
  missing: string[];
  /** diag.ops_card_record('video'): who did what on each video's cards, and what Claude did; newest first. Absent before migration 20261121213000_ops_card_record.sql. */
  records?: CardRecord[];
}

// ---- how ----------------------------------------------------------------------------------------

const REPO = 'https://github.com/genesis-ai-dev/langquest-next';
/** The English name the dashboard gives a language where it is said in a sentence; Intl calls tl Filipino, the team says Tagalog. */
const LANGUAGE_NAMES: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', ar: 'Arabic', sw: 'Swahili', ha: 'Hausa', am: 'Amharic',
  hi: 'Hindi', bn: 'Bangla', ne: 'Nepali', id: 'Indonesian', th: 'Thai', my: 'Burmese', 'zh-Hans': 'Simplified Chinese', tl: 'Tagalog' };
const pr = (n: number) => `${REPO}/pull/${n}`;
/** The timeline goes back this far. */
export const TIMELINE_DAYS = 60;
const RECONNECT = /^youtube_(invalid_grant|not_connected|unauthorized|forbidden)/;
/** Suggestions Claude writes as a fix: a change to a video's script, screens or voice, and an admin's instruction (accepted as it is sent). */
const FIXABLE = new Set(['script', 'screen', 'voice', 'instruction']);

/**
 * Where a fix in the app is (Fix it), from its instructions, the agent team's record, the pull requests on GitHub and
 * the film: `filing` (to Linear first), `queued` and `writing` (the agent team), `checks` (it merges by itself when its
 * checks pass), `yours` (it waits on the admin: they asked to see it first, or the rule needs a developer, or 3 tries
 * failed), `none` (the team made no change), `merged`, `filming` (sent to be filmed again) and `filmed`.
 */
export type AppStage = 'filing' | 'queued' | 'writing' | 'checks' | 'yours' | 'none' | 'merged' | 'filming' | 'filmed';
export function appStage(s: { issue: string | null; app?: AppFix | null }, prs: FixPr[] | null | undefined): { stage: AppStage; pr: number | null; at: string | null } | null {
  const app = s.app;
  if (!app) return null;
  const fix = app.fix;
  const named = (prs ?? []).filter((p) => !!s.issue && p.issues.includes(s.issue));
  const pr = app.refilmPr ?? fix?.pr ?? named.find((p) => p.state === 'open')?.number ?? named[0]?.number ?? null;
  if (app.filmedAt) return { stage: 'filmed', pr, at: app.filmedAt };
  if (app.refilmAt) return { stage: 'filming', pr, at: app.refilmAt };
  const merged = named.find((p) => p.state === 'merged' && (pr === null || p.number === pr));
  if (merged) return { stage: 'merged', pr: merged.number, at: merged.mergedAt };
  if (!s.issue) return { stage: 'filing', pr: null, at: app.askedAt };
  const newest = app.notes[0];
  // An instruction that waits for an answer: the team has it now, or at its next run. "merge it" on a fix that waits merges it.
  if (newest && !newest.answeredAt) {
    const merging = !!fix?.pr && /^\s*(merge it|approved?)\b/i.test(newest.text);
    return { stage: merging ? 'checks' : newest.takenAt ? 'writing' : 'queued', pr, at: newest.takenAt ?? newest.at };
  }
  if (fix?.decision === 'merge') return { stage: 'checks', pr, at: fix.at };
  if (pr !== null) return { stage: 'yours', pr, at: fix?.at ?? null };
  return fix || newest?.answeredAt ? { stage: 'none', pr: null, at: fix?.at ?? newest?.answeredAt ?? null } : { stage: 'queued', pr: null, at: app.askedAt };
}
/** A fix in the app's card stays this long after the new film came in, so the admin sees the chain end. */
export const APP_DONE_HOURS = 24;
/** What happens next at each stage of a fix in the app, and what happens if the admin does nothing. */
const APP_NEXT: Record<AppStage, string> = {
  filing: 'Claude files it in Linear, then its agent team changes the app. When the ops dashboard has no Linear key, the comments job files it at midnight Pacific. Nothing waits on you.',
  queued: 'Claude\'s agent team starts within 15 minutes (it runs every 15 minutes). It changes the app, not the video. Nothing waits on you.',
  writing: 'Claude\'s agent team writes the fix now. Then a second Claude reads the change and the checks run. Nothing waits on you.',
  checks: 'The fix merges by itself when its checks pass. If a check fails, Claude tries again, up to 3 times. Then it asks you here. Nothing waits on you.',
  yours: 'Merge it, or tell Claude what to change. Nothing happens until you answer.',
  none: 'Read Claude\'s answer. Tell Claude what to do instead, or leave the issue in Linear for a person. Nothing happens until you answer.',
  merged: 'The fix is in main. Claude\'s next fix run (:20 and :50 each hour) films the video again. Nothing waits on you.',
  filming: 'The film run films the video again now. The new film goes to YouTube by itself. Nothing waits on you.',
  filmed: 'Done: the new film is in. This card goes away a day after the film.'
};
/** Why a fix in the app waits on the admin, from the agent team's record (its reason, as the gate says it). */
function appWhy(app: AppFix, stage: AppStage): string | null {
  if (stage === 'none') return app.notes.find((n) => n.answer)?.answer ?? app.fix?.why ?? 'Claude\'s agent team made no change.';
  if (stage !== 'yours') return null;
  const f = app.fix;
  if (f?.reason === 'instruction' || (app.askFirst && f?.decision === 'waits')) return 'You asked to see the change before it merges.';
  if (f?.reason === 'stalled') return f.why ?? 'Claude tried 3 times to get it into main.';
  return f?.why ? `It needs a developer: ${f.why}` : 'It needs a developer.';
}

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

/**
 * A screen's name as a person reads it, from its id in the app's flow (apps/mobile/src/shell/flow.ts): `my_work` is
 * My work, `settings_home` is Settings. The page never shows the id.
 */
export function screenName(id: string): string {
  const words = id.replace(/_home$/, '').replace(/[_-]+/g, ' ').trim() || id;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
const screenNames = (ids: string[]) => [...new Set(ids.map(screenName))].join(', ');
const refs = (r: Ref[]) => (r.length ? ` (${r.map((c) => (c.pr ? `PR ${c.pr}` : c.sha.slice(0, 7))).join(', ')})` : '');
/** One cause in words, without the changes that did it. */
function causeText(c: Cause): string {
  switch (c.kind) {
    case 'new': return 'First film';
    case 'asked': return 'Filmed on request';
    case 'frame': return 'New film frame';
    case 'script': return 'Script changed';
    case 'screen': return `Words changed on ${screenNames(c.screens) || 'a screen'}`;
  }
}
/** A film's causes in a line. */
export function whyText(why: Cause[] | null | undefined): string | null {
  if (!why || !why.length) return null;
  return why.map((c) => `${causeText(c)}${'changes' in c ? refs(c.changes) : ''}`).join('; ');
}
/** A film's causes one by one, each with its timeline mark and its changes as links. */
export function filmCauses(why: Cause[] | null | undefined): FilmCause[] {
  return (why ?? []).map((c) => ({
    mark: causeOf([c]), text: causeText(c),
    links: 'changes' in c ? c.changes.map((r) => ({ text: r.pr ? `PR ${r.pr}` : r.sha.slice(0, 7), href: r.pr ? `${pr(r.pr)}/files` : `${REPO}/commit/${r.sha}` })) : []
  }));
}

/** The languages tutorials.yml films when the dashboard's switches do not answer, from its NIGHTLY_LANGUAGES line. */
export function nightlyLanguages(workflow: string): string[] | null {
  const m = /^\s*NIGHTLY_LANGUAGES:\s*([^\n#]*)/m.exec(workflow);
  return m ? m[1]!.split(',').map((l) => l.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean) : null;
}

/** A state that waits on a person; a paused language's own pause and missing films are said once, not per video. */
const NEEDS_PERSON = (s: VideoState) => (s.level === 'bad' || s.level === 'warn') && s.key !== 'paused' && s.key !== 'new';

const LEVEL_ORDER: StateKey[] = ['fails', 'held', 'fixFailed', 'approve', 'fixing', 'merge', 'toFix', 'filming', 'tonight', 'slotted', 'comment', 'reply', 'publish', 'upload', 'new', 'paused', 'current'];

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
  // A suggested reply waits until a person says it is posted, or that none is needed (migration *_tutorial_reply_done.sql);
  // the comment itself is taken out 30 days after it was posted.
  const replyDue = (i: FeedbackInput) => !!i.reply && !i.replyDone;

  const admin: AdminItem[] = [];
  const worker: WorkerItem[] = [];
  const changes: ChangeItem[] = [];

  // ---- suggestions and their fixes (any language: a suggestion names a video, not a language) ----
  const suggestionsOf = new Map<string, FixedSuggestion[]>();
  for (const s of feedback?.suggestions ?? []) {
    if (s.tutorial) suggestionsOf.set(s.tutorial, [...(suggestionsOf.get(s.tutorial) ?? []), s]);
    const on = s.tutorial ? `${title(s.tutorial)}: ` : '';
    // A suggestion's cards go on its video's row in its film's language (English when it names none).
    const where = s.tutorial ? { tutorial: s.tutorial, language: s.language ?? 'en' } : {};
    const pictures = s.pictures?.length ? { pictures: s.pictures } : {};
    const appFixable = s.kind === 'code' && !!s.tutorial;
    if (!s.decision) admin.push({ kind: 'approve', title: `${on}${s.title}`, detail: s.detail, at: s.madeAt, who: 'you', ...where, suggestion: s, ...pictures,
      ...(appFixable ? { fixApp: s.id } : {}),
      next: FIXABLE.has(s.kind) && s.tutorial ? 'Accept, and Claude changes the video. The next night films it again. Nothing happens until you answer.'
        : appFixable ? 'Fix it: Claude changes the app. The fix merges by itself when it keeps the rules, and then the video is filmed again. Tick "Ask me before it merges" to see the change first. Only file in Linear: a person fixes it later. Nothing happens until you answer.'
        : s.kind === 'code' ? 'Accept, and it goes to Linear as an app issue. Nothing happens until you answer.' : 'Accept or reject it. Nothing happens until you answer.' });
    const app = appStage(s, input.prs);
    // A fix in the app: one card from Fix it to the new film, which Claude's steps move along by themselves.
    if (app && s.tutorial && (app.stage !== 'filmed' || !app.at || now - Date.parse(app.at) < APP_DONE_HOURS * 3600_000)) {
      const fixed = s.app!.fix;
      const why = appWhy(s.app!, app.stage);
      const link = app.pr ? pr(app.pr) : s.issueUrl ?? undefined;
      admin.push({ kind: 'appFix', title: `${on}${s.title}`, detail: s.detail, at: s.app!.askedAt, who: app.stage === 'yours' || app.stage === 'none' ? 'you' : 'claude',
        ...where, ...pictures, ...(link ? { link } : {}),
        app: { issue: s.issue, stage: app.stage, pr: app.pr, summary: fixed?.summary ?? null, answer: s.app!.notes.find((n) => n.answer)?.answer ?? null, why,
          before: !!fixed?.before, after: !!fixed?.beforeAfter, askFirst: !!s.app!.askFirst },
        next: (why && app.stage === 'yours' ? `${why} ` : '') + APP_NEXT[app.stage] });
    }
    const fix = s.fix;
    const yes = s.kind === 'instruction' ? `Your instruction: ${s.detail}` : s.clear ? `${s.title}. Claude found it clear and accepted it itself.` : `${s.title}. You accepted it.`;
    if (fix?.state === 'open' && fix.pr) worker.push({ when: 'now', kind: 'merging', title: `${on}Claude's change merges itself when its checks pass (PR ${fix.pr})`, detail: `${yes} If a check fails, or it does not merge within a day, Claude closes it and asks you under Waits on you.`, at: fix.at, link: pr(fix.pr) });
    if (fix?.state === 'failed' && !s.app) admin.push({ kind: 'fixFailed', title: `${on}Claude could not make the change`, detail: fix.note ?? s.title, at: fix.at, who: 'you', ...pictures, ...(fix.pr ? { link: pr(fix.pr) } : fix.run ? { link: fix.run } : {}),
      ...(s.tutorial ? { fixApp: s.id } : {}),
      next: 'Try again, or tell Claude what to do instead. Claude starts at its next fix run (:20 and :50 each hour). When the cause is in the app, Fix it in the app: Claude changes the app, the fix merges by itself when it keeps the rules, and then the video is filmed again. Nothing happens until you do.', ...where, ...(s.tutorial ? { instruct: `Claude could not make the change "${s.title}" (${fix.note ?? 'no reason given'}).`, retry: `Try this change again: ${s.title}. ${s.detail}`.slice(0, 2000) } : {}) });
    if (fix?.state === 'working') worker.push({ when: 'now', kind: 'fixing', title: `${on}Claude writes the change now`, detail: `${yes} When done, the pull request merges itself when its checks pass.`, at: fix.at, ...(fix.run ? { link: fix.run } : {}) });
    if (s.decision === 'accepted' && !fix && s.tutorial && FIXABLE.has(s.kind)) worker.push({ when: 'next', kind: 'toFix', title: `${on}Claude starts the change at its next fix run (:20 and :50 each hour)`, detail: `${yes} Claude makes it as a pull request that merges itself when its checks pass.`, at: s.decidedAt });
    if (fix && s.tutorial) changes.push({ at: fix.at, tutorial: s.tutorial, language: s.language ?? 'en', video: title(s.tutorial), change: s.kind === 'instruction' ? s.detail : s.title,
      by: s.kind === 'instruction' ? 'instruction' : s.clear ? 'claude' : 'admin', state: fix.state, pr: fix.pr, link: fix.pr ? pr(fix.pr) : fix.run, note: fix.note,
      pictures: s.pictures ?? [], after: s.after ?? [] });
  }
  changes.sort((a, b) => b.at.localeCompare(a.at));

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
      if (sv?.tonight === 'held') { add({ key: 'held', text: 'Film held', level: 'bad', ...(j?.url ? { link: j.url } : {}) }); }
      // A suggestion about one language's film (its voice or lines) shows on that language's row; one about the video, on every row.
      const mineSg = (suggestionsOf.get(tutorial) ?? []).filter((sg) => !sg.language || sg.language === language);
      for (const sg of mineSg) {
        if (!sg.decision) add({ key: 'approve', text: 'Suggestion to answer', level: 'warn' });
        const ap = appStage(sg, input.prs);
        if (ap?.stage === 'yours') add({ key: 'approve', text: 'App fix waits on you', level: 'warn', ...(ap.pr ? { link: pr(ap.pr) } : {}) });
        if (ap?.stage === 'none') add({ key: 'approve', text: 'No app fix: read Claude\'s answer', level: 'warn' });
        if (ap?.stage === 'writing' || ap?.stage === 'queued' || ap?.stage === 'filing') add({ key: 'fixing', text: 'Claude fixes the app', level: 'info' });
        if (ap?.stage === 'checks') add({ key: 'merge', text: 'App fix waits on its checks', level: 'info', ...(ap.pr ? { link: pr(ap.pr) } : {}) });
        if (ap?.stage === 'merged' || ap?.stage === 'filming') add({ key: 'filming', text: 'App fix merged, filmed again now', level: 'info', ...(ap.pr ? { link: pr(ap.pr) } : {}) });
        if (sg.fix?.state === 'failed' && !sg.app) add({ key: 'fixFailed', text: 'Change failed', level: 'bad', ...(sg.fix.pr ? { link: pr(sg.fix.pr) } : sg.fix.run ? { link: sg.fix.run } : {}) });
        if (sg.fix?.state === 'open') add({ key: 'merge', text: 'Change waits on its checks', level: 'info', ...(sg.fix.pr ? { link: pr(sg.fix.pr) } : {}) });
        if (sg.fix?.state === 'working') add({ key: 'fixing', text: 'Claude writes the change', level: 'info' });
        if (sg.decision === 'accepted' && !sg.fix && FIXABLE.has(sg.kind)) add({ key: 'toFix', text: sg.kind === 'instruction' ? 'Claude has your instruction' : sg.clear ? 'Clear fix, Claude starts it next' : 'Accepted, Claude starts the change next', level: 'info' });
        // A fix merged after the last night's status is filmed by the next night.
        if (sg.fix?.state === 'merged' && isNightly(language) && (!s || Date.parse(sg.fix.at) > Date.parse(s.at))) add({ key: 'tonight', text: 'Change merged, films tonight', level: 'info' });
      }
      const slots = sv?.slots ?? [];
      if (slots.length) {
        slotted++;
        if (filmingLanguage(language)) add({ key: 'filming', text: 'Checked in tonight\'s run now', level: 'info', ...(j?.url ? { link: j.url } : {}) });
        else add({ key: 'slotted', text: `Screen changed, checked ${isNightly(language) ? 'tonight' : 'when the language is on'}`, level: 'info',
          link: slots[0]!.pr ? pr(slots[0]!.pr) : `${REPO}/commit/${slots[0]!.sha}` });
      }
      const mine = comments.filter((i) => i.tutorial === tutorial && (i.language ?? 'en') === language);
      if (mine.some((i) => !i.lookedAt)) add({ key: 'comment', text: 'New comment', level: 'info', link: commentLink(mine.find((i) => !i.lookedAt)!) });
      if (mine.some(replyDue)) add({ key: 'reply', text: 'Reply to post', level: 'warn', link: commentLink(mine.find(replyDue)!) });
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
          ...(i.replyDone === 'posted' ? ['A person posted the reply.'] : i.replyDone === 'none' ? ['A person chose to post no reply.'] : []),
          i.lookedAt ? `Claude's answer: ${i.outcome ?? 'made a suggestion (see the suggestion mark)'}` : 'Claude has not looked at it yet.'],
        quote: i.text, links: [{ text: 'Open the comment on YouTube', href: commentLink(i) }], films: []
      } });
      for (const sg of mineSg) {
        const about = [sg.detail, ...sg.inputs.map((i) => `Answers: ${i.english ?? i.text}`)];
        const shown = { ...(sg.pictures?.length ? { pictures: sg.pictures } : {}), ...(sg.after?.length ? { after: sg.after } : {}) };
        // A clear fix is suggested and accepted by Claude at once: one mark says both.
        if (recent(sg.madeAt) && !sg.clear) marks.push({ at: sg.madeAt, kind: 'suggested', text: `Suggested: ${sg.title}`, detail: { title: `Claude suggested: ${sg.title}`, lines: about, links: [], films: [], ...shown } });
        const decided = sg.clear ? 'Clear fix, accepted by Claude' : sg.decision === 'accepted' ? 'Accepted' : 'Rejected';
        if (sg.decision && recent(sg.decidedAt)) marks.push({ at: sg.decidedAt!, kind: 'decided', cause: sg.decision === 'rejected' ? 'rejected' : 'accepted', text: `${decided}: ${sg.title}`, detail: {
          title: `${decided}: ${sg.title}`, lines: [...about, ...(sg.clear ? ['Claude checked that the video is wrong against the app and that there is one right fix, so no person was asked.'] : []), ...(sg.reason ? [`Why: ${sg.reason}`] : [])],
          links: sg.issueUrl ? [{ text: `Linear ${sg.issue}`, href: sg.issueUrl }] : [], films: [], ...shown
        } });
        const fixState = sg.fix?.state === 'unneeded' ? 'no change needed' : sg.fix?.state === 'open' ? 'open, merges itself when checks pass' : sg.fix?.state;
        if (sg.fix && recent(sg.fix.at)) marks.push({ at: sg.fix.at, kind: 'fix', cause: sg.fix.state, text: `Fix ${fixState}${sg.fix.pr ? ` (PR ${sg.fix.pr})` : ''}`, ...(sg.fix.pr ? { link: pr(sg.fix.pr) } : sg.fix.run ? { link: sg.fix.run } : {}), detail: {
          title: `Fix: ${fixState}`, lines: [sg.title, ...(sg.fix.note ? [`${sg.fix.state === 'unneeded' ? 'Why' : 'Error'}: ${sg.fix.note}`] : [])],
          links: [...(sg.fix.pr ? [{ text: `PR ${sg.fix.pr}: what changed in the script`, href: `${pr(sg.fix.pr)}/files` }] : []), ...(sg.fix.run ? [{ text: 'The run that wrote it', href: sg.fix.run }] : [])], films: [], ...shown
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
        film: newest ? { madeAt: newest.madeAt, why: filmWhy, causes: sv?.film && sv.film.sha256 === newest.sha256 ? filmCauses(sv.film.why) : [], up: !!newest.youtubeId }
          : sv?.film?.filmedAt ? { madeAt: sv.film.filmedAt, why: whyText(sv.film.why), causes: filmCauses(sv.film.why), up: false } : null
      });
      const name = `${title(tutorial)} (${language})`;
      // A held or failing film waits on Claude's next look, which fixes it when the fix is clear or asks a person (a suggestion);
      // once a look after the film made nothing for it, or what it made was rejected, it waits on an admin.
      const answered = (feedback?.suggestions ?? []).filter((x) => x.tutorial === tutorial && (x.language ?? 'en') === language && s && x.madeAt >= s.at);
      const filmWho: AdminItem['who'] = answered.some((x) => x.decision !== 'rejected') || !(s && feedback?.last && feedback.last.at > s.at) ? 'claude' : 'you';
      if (sv?.tonight === 'held') admin.push({ kind: 'held', title: `${name}: the new film was held back`, detail: `The frame check found: ${(sv.held ?? []).join('; ') || 'a problem in a frame'}. YouTube keeps the old film.`, at: s!.at, tutorial, language, who: filmWho,
        next: filmWho === 'you' ? 'Claude\'s look did not fix it. Tell Claude what to change. Each night holds the film again until then.' : 'Claude looks at it at 10:00 UTC, and changes the video or asks you. You can tell Claude now what to change.', instruct: `The new film of "${title(tutorial)}" (${language}) was held by the frame check: ${(sv.held ?? []).join('; ')}.`, ...(j?.url ? { link: j.url } : {}) });
      if (sv?.tonight === 'failed') admin.push({ kind: 'fails', title: `${name}: the film fails`, detail: 'The filming stops at a step: the script expects something the app no longer shows. YouTube keeps the old film.', at: s!.at, tutorial, language, who: filmWho,
        next: filmWho === 'you' ? 'Claude\'s look did not fix it. Tell Claude what changed in the app. Each night fails again until then.' : 'Claude looks at it at 10:00 UTC, and changes the video or asks you. You can tell Claude now what changed in the app.', instruct: `The film of "${title(tutorial)}" (${language}) fails each night (see the log of the filming run).`, ...(j?.url ? { link: j.url } : {}) });
      for (const i of mine.filter(replyDue)) admin.push({ kind: 'reply', title: `${name}: a reply to post`, detail: `Comment: ${i.english ?? i.text}\nSuggested reply: ${i.replyEnglish ?? i.reply}`, at: i.at, tutorial, language, who: 'you', link: commentLink(i),
        reply: { id: i.id, comment: i.english ?? i.text, original: i.english && i.english !== i.text ? i.text : null, text: i.reply!, english: i.replyEnglish && i.replyEnglish !== i.reply ? i.replyEnglish : null, link: commentLink(i) },
        next: 'Copy the reply and post it on YouTube. Then press Done.' });
      for (const i of mine.filter((c) => !c.lookedAt)) admin.push({ kind: 'comment', title: `${name}: a new comment`, detail: i.english ?? i.text, at: i.at, tutorial, language, who: 'claude', link: commentLink(i),
        next: 'Claude reads it at 10:00 UTC, and changes the video or suggests a change or a reply. You can tell Claude now what to do.', inputIds: [i.id], instruct: `About the comment on "${title(tutorial)}" (${language}): "${i.english ?? i.text}".` });
      if (slots.length && isNightly(language)) admin.push({ kind: 'screen', title: `${name}: a screen it shows changed`, detail: slots.map((c) => `${c.pr ? `PR ${c.pr}` : c.sha.slice(0, 7)} changed ${screenNames(c.screens)}`).join('; '), at: s?.at ?? null, tutorial, language, who: 'claude',
        link: slots[0]!.pr ? `${pr(slots[0]!.pr)}/files` : `${REPO}/commit/${slots[0]!.sha}`,
        next: 'Tonight the filming checks the video, and films it again if the words on its screens changed. If the script must change too, tell Claude now.', instruct: `A screen in "${title(tutorial)}" (${language}) changed: ${slots.map((c) => (c.pr ? `PR ${c.pr}` : c.sha.slice(0, 7))).join(', ')}.` });
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
    next: 'Tick them under Channels and videos, then press Publish. They stay off YouTube until you do.' });
  for (const c of tutorials?.channels ?? []) {
    const needs = !c.connectedAt ? isNightly(c.language) || (tutorials?.waiting ?? []).some((w) => w.language === c.language)
      : (tutorials?.waiting ?? []).some((w) => w.language === c.language && w.failed && RECONNECT.test(w.failed));
    if (needs) admin.push({ kind: 'connect', title: `The ${c.language} channel is ${c.connectedAt ? 'refused by YouTube' : 'not connected'}`, detail: 'LangQuest cannot put films up there.', at: null, who: 'you', language: c.language, link: '#tutorials',
      next: 'Press Connect under Channels and videos, and sign in with the account that owns the channel.' });
  }
  // A paused language with no video on YouTube at all (Tagalog, added after filming went to English only) is not
  // like a paused language whose older videos are up: its connected channel is empty, so it waits on the admin.
  for (const l of languages) {
    const channel = (tutorials?.channels ?? []).find((c) => c.language === l && c.connectedAt);
    if (isNightly(l) || !films || !channel || films.some((f) => f.language === l && f.youtubeId)) continue;
    const count = videosIn(l).length;
    admin.push({ kind: 'empty', title: `${LANGUAGE_NAMES[l] ?? l}: 0 videos on YouTube`, detail: `${LANGUAGE_NAMES[l] ?? l} is not filmed each night, and it has never been filmed. Its YouTube channel has no videos.`, at: null, who: 'you', language: l,
      filming: { language: l, on: false, videos: count },
      next: `Press Turn on filming. The next filming at 20:10 UTC films ${count ? `its ${count} videos` : 'every video'}, and they go up on YouTube after it. Until then the channel stays empty.` });
  }
  const paused = languages.filter((l) => !isNightly(l));
  if (paused.length) admin.push({ kind: 'paused', title: `${paused.length} ${paused.length === 1 ? 'language is' : 'languages are'} paused`, detail: `Not filmed each night: ${paused.join(', ')}.`, at: null, who: 'you',
    next: 'Their videos on YouTube stay as they are. To film one, choose it under Language and press Turn on filming.' });

  // ---- the rest of the worker queue ----
  if (feedback?.waiting) worker.push({ when: 'next', kind: 'comments', title: `10:00 UTC: Claude reads ${feedback.waiting} new ${feedback.waiting === 1 ? 'comment, change or note' : 'comments, changes and notes'}`, detail: 'Claude fixes a video itself when the fix is clear. Anything else becomes a suggestion under Waits on you, for you to accept or reject.' });
  if (filming?.run && !filmingNow) worker.unshift({ when: 'next', kind: 'filming', title: `20:10 UTC: film the videos that changed (${(nightly ?? ['en']).join(', ')})`, detail: `Each video is tried; one films again only when its script or screen words changed. New films then go up on YouTube. Last run (${filming.run.number}): ${filming.run.conclusion ?? filming.run.status}.`, link: filming.run.url });

  for (const a of admin) if (a.tutorial) a.video = title(a.tutorial);
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
  // A problem whose instruction became a fix that failed is said by that fix's own card.
  for (let k = admin.length - 1; k >= 0; k--) if (admin[k]!.instructed?.fix?.state === 'failed') admin.splice(k, 1);
  const ADMIN_ORDER: AdminItem['kind'][] = ['fails', 'held', 'fixFailed', 'approve', 'reply', 'comment', 'screen', 'connect', 'empty', 'publish', 'paused'];
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
      issues: new Set(admin.filter((a) => a.language === l && a.tutorial && a.who === 'you').map((a) => a.tutorial)).size
        + admin.filter((a) => a.language === l && !a.tutorial && a.who === 'you').length })),
    videos, admin, worker, changes, missing
  };
}

// ---- reading ------------------------------------------------------------------------------------

export interface VideosEnv extends GitHubEnv { DIAG?: Hyperdrive }
/** A language's Film each night switch, as diag.ops_tutorial_filming() gives it. */
interface FilmingSwitch { language: string; nightly: boolean; setAt: string }

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
        const [films, feedback, tutorials, records, switches] = await Promise.all([
          maybe<FilmRow[]>(query, 'select diag.ops_tutorial_films() as v'),
          maybe<VideosInput['feedback']>(query, 'select diag.ops_tutorial_feedback() as v'),
          maybe<Parameters<typeof tutorialsOf>[0]>(query, 'select diag.ops_tutorials() as v'),
          maybe<CardRecord[]>(query, "select diag.ops_card_record('video') as v"),
          maybe<FilmingSwitch[]>(query, 'select diag.ops_tutorial_filming() as v')
        ]);
        return { films, feedback, tutorials, records, switches };
      });
    } catch {
      return { films: null, feedback: null, tutorials: null, records: null, switches: null };
    }
  })();
  const workflow = gh<{ content: string }>('/contents/.github/workflows/tutorials.yml?ref=main', 'GitHub tutorials.yml')
    .then((f) => nightlyLanguages(atob(f.content.replace(/\n/g, '')))).catch(() => null);
  const filming = filmingSection(env, fetcher).then((s) => (s.state === 'ok' ? s.data as Filming : null)).catch(() => null);
  const statuses = Promise.all(Object.keys(CHANNELS).map(async (l) => [l, await statusFile(env, l, fetcher)] as const));
  // Where each fix in the app is on GitHub (Fix it): without it a card still shows what the agent team recorded.
  const prs = fixesSection(env, fetcher).then((s) => (s.state === 'ok' ? (s.data as { prs: FixPr[] }).prs : null)).catch(() => null);
  const [d, nightly, run, files, named] = await Promise.all([db, workflow, filming, statuses, prs]);
  if (!d.films && !d.feedback && !d.tutorials && !run) return failed('Could not read the database or GitHub for the tutorial videos.');
  const status: Partial<Record<string, StatusFile>> = {};
  for (const [l, f] of files) if (f) status[l] = f;
  // The dashboard's switches choose the languages; tutorials.yml's list only where the database has no switches yet.
  const chosen = Array.isArray(d.switches) ? d.switches.filter((x) => x.nightly).map((x) => x.language) : nightly;
  const board = videoBoard({ films: d.films, feedback: d.feedback, tutorials: d.tutorials ? tutorialsOf(d.tutorials) : null, status, filming: run, nightly: chosen, prs: named });
  return ok(d.records ? { ...board, records: d.records } : board);
}
