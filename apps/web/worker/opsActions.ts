import { WorkerEntrypoint } from 'cloudflare:workers';
import { UI_LANGUAGES } from '@langquest-next/core';
import { serviceClient, type Env } from './env';
import { claimsVerifier, sessionLiveCheck } from './identity';
import { isJobKey, type JobKey } from './jobsModel';
import {
  CALLBACK_PATH, consentUrl, exchangeCode, languageOfChannel, myChannel, readState, revoke, setHome, signState, YouTubeError,
  type ChannelLanguage, type Client, type Fetch
} from '../../../server/youtube';
import { LinearError } from '../../../server/linear';
import { fileSuggestion } from './fileSuggestion';
import { CARD, PAGE, QUESTION_MAX } from '../../../server/cardQuestions';

/**
 * The few things the ops dashboard may do (docs/ops-dashboard-plan.md
 * section 6, decisions.md 162): mark feedback seen or done, run a server
 * job now, grant or decline an organization's blue check (173), connect
 * a tutorial channel on YouTube and publish its videos (180), add a note
 * on a tutorial video or answer Claude's suggestion for one (186), say what
 * became of the reply Claude suggested for a comment (posted by a person, or
 * none needed), tell Claude what to do with a user issue
 * (docs/decisions/2026-11-18-an-admin-tells-claude-what-to-do-with-a-user-issue.md), ask Claude a
 * question from any card or page (docs/decisions/2026-11-23-ask-claude-from-every-dashboard-card.md),
 * mark a line resolved until its problem comes back, or show it again
 * (docs/decisions/2026-11-24-a-resolved-line-comes-back-with-its-problem.md),
 * mark an account's quiet installs not an issue, claim or release a Linear issue, and mark Claude's
 * replies seen (docs/decisions/2026-11-24-claim-issues-and-see-claudes-replies.md). The dashboard's own Worker holds no writer's key; it
 * calls this entrypoint over a service binding with the person's own token,
 * and this Worker checks that token itself (a live session, a Global Viewer
 * on an `aal2` session) before acting with the service role. Every attempt
 * by someone it could identify is written to `ops.actions`, refused ones
 * too. Suspending, deleting, moderating and granting stay in the CLIs.
 */

export type Action =
  | { kind: 'feedback'; id: string; status: 'new' | 'seen' | 'done' }
  | { kind: 'run'; key: JobKey }
  | { kind: 'verification'; id: string; decision: 'grant' | 'decline' }
  /** Connect YouTube: Google's page for choosing a channel, for this person. */
  | { kind: 'youtube-start' }
  /** What Google sent back from that page, which the dashboard's callback handed to the page. */
  | { kind: 'youtube-connect'; code: string; state: string }
  /** Publish: the versions chosen on the dashboard, each [tutorial, language, sha256]. */
  | { kind: 'tutorials-publish'; items: [string, string, string][] }
  /** A note on a tutorial video, or on none, for Claude's nightly look. */
  | { kind: 'tutorial-note'; tutorial: string | null; text: string }
  /**
   * What an admin told Claude to do with a video, from a card on the dashboard (a comment, a screen change,
   * a film that failed or was held): a `tutorial-note` with `instruct: true`. Accepted at once (186).
   */
  | { kind: 'tutorial-instruction'; tutorial: string; text: string; problem: string | null; language: string | null; inputs: string[] }
  /** A person's answer to Claude's suggestion: accept or reject it (as edited), or only edit its detail. */
  | { kind: 'tutorial-suggestion'; id: string; decision: 'accept' | 'reject' | 'edit'; detail: string | null; reason: string | null }
  /**
   * "Fix it": the agent team changes the app for this suggestion, as a draft pull request that merges after an admin's
   * yes (docs/decisions/2026-11-21-fix-it-sends-a-video-suggestion-to-the-agent-team.md). On a suggestion about the
   * app that waits for an answer (it is accepted), or on one whose change to the video failed.
   */
  | { kind: 'tutorial-fix'; id: string; askFirst: boolean }
  /**
   * What became of the reply Claude suggested for a comment on YouTube: a person posted it there (`posted`), chose to
   * post none (`none`), or takes that back (`open`). It records only; nothing is posted from here (186).
   */
  | { kind: 'tutorial-reply'; id: string; done: 'posted' | 'none' | 'open' }
  /** What an admin told Claude to do with a user issue, from its card on the dashboard: for the watch's next run. */
  | { kind: 'user-issue-note'; issue: string; text: string }
  /** A question to Claude from a card or a page of the dashboard, with the card's words as the page drew them. */
  | { kind: 'card-question'; card: string; page: string; title: string; context: string; text: string }
  /** Lines of the dashboard marked resolved, each as the page showed it: hidden until its problem comes back. */
  | { kind: 'line-resolve'; lines: ResolvedLine[] }
  /** Lines resolved before, shown again. */
  | { kind: 'line-show'; lines: string[] }
  /** An account's quiet installs marked not an issue, or counted again. */
  | { kind: 'quiet-account'; profile: string; ok: boolean }
  /** A language's tutorial videos filmed each night, or paused (decision 2026-11-21, filming languages switch). */
  | { kind: 'tutorial-filming'; language: string; on: boolean }
  /**
   * A developer claims a Linear issue so that no other developer works on it, or releases it
   * (docs/decisions/2026-11-24-claim-issues-and-see-claudes-replies.md).
   */
  | { kind: 'issue-claim'; issue: string; claim: boolean }
  /** The admin opened Claude's replies in the corner of the dashboard: the replies until now are seen. */
  | { kind: 'replies-seen' };

/** A line as the page showed it when the admin tapped Resolved (migration 20261124013000_ops_line_resolves.sql). */
export interface ResolvedLine {
  /** '<key>[:<subject>]' (apps/admin/src/alertKinds.ts alertId). */
  line: string;
  /** The part whose answer holds the line. */
  part: string;
  level: 'urgent' | 'problem' | 'watch';
  /** The line's measure (usage-billed: its cost so far), or null. */
  measure: number | null;
  title: string;
  /** The line's words as the page showed them, for Claude to compare with its words later (migration 20261124034500_ops_line_resolve_checks.sql), or null. */
  text: string | null;
}

export type ActionResult =
  | { ok: true; result: string }
  | { ok: false; status: 400 | 401 | 403 | 404 | 502 | 503; error: string };

export interface ActionDeps {
  /** Who the token is, from its verified claims and a live session; null when it is not good. */
  whoIs(token: string): Promise<{ profileId: string; aal: string | undefined } | null>;
  /** An active Global Viewer grant at this session's level (`_gv_on` refuses anything below aal2). */
  globalViewerOn(profileId: string, aal: string | undefined): Promise<boolean>;
  setFeedbackStatus(id: string, status: 'new' | 'seen' | 'done'): Promise<boolean>;
  runJob(key: JobKey): Promise<'started' | 'running' | 'disabled'>;
  /** A waiting blue check request granted or declined, by this staff member: `granted`, `declined`, or why not. */
  decideVerification(id: string, grant: boolean, profileId: string): Promise<string>;
  record(row: { profileId: string; action: string; target: string; result: 'ok' | 'refused' | 'error'; detail?: string }): Promise<void>;
  /** The OAuth client and where Google sends people back; null where YouTube is not set up (preview, a local Worker). */
  youtube: { client: Client; redirectUri: string; fetcher: Fetch } | null;
  /** A channel connected: its refresh token into Vault, by this person (`ops_youtube_connected`). */
  connectChannel(row: { channelId: string; language: ChannelLanguage; title: string; refreshToken: string; by: string; section: string }): Promise<void>;
  /** Versions marked to go up, by this person: how many were newly marked (`ops_tutorials_approve`). */
  approveTutorials(items: [string, string, string][], by: string): Promise<number>;
  /** A note kept for Claude's look (`ops_tutorial_note`). */
  addNote(tutorial: string | null, text: string, by: string): Promise<void>;
  /** An admin's instruction kept as an accepted suggestion (`ops_tutorial_instruct`): its id. */
  instruct(row: { tutorial: string; text: string; problem: string | null; language: string | null; inputs: string[] }, by: string): Promise<string>;
  /** An admin's instruction on a user issue kept for the watch (`ops_user_issue_instruct`): its id, `not_found` or `full`. */
  instructIssue(issue: string, text: string, by: string): Promise<string>;
  /** Lines resolved by this person (`ops_line_resolve`): how many. */
  resolveLines(lines: ResolvedLine[], by: string): Promise<number>;
  /** Lines shown again by this person (`ops_line_show`): how many were resolved. */
  showLines(lines: string[], by: string): Promise<number>;
  /** A question from a card kept for Claude (`ops_card_ask`): its id, `full` or `many`. */
  askCard(row: { card: string; page: string; title: string; context: string; text: string }, by: string): Promise<string>;
  /** A suggestion answered (`ops_suggestion_decide`): what happened, and the suggestion's kind. */
  decideSuggestion(id: string, decision: 'accepted' | 'rejected' | 'edited', detail: string | null, reason: string | null, by: string): Promise<{ result: string; kind?: string }>;
  /** A comment's suggested reply marked posted, not needed, or waiting again, by this person: `ok`, or `not_found` (`ops_tutorial_reply_done`). */
  replyDone(id: string, done: 'posted' | 'none' | 'open', by: string): Promise<string>;
  /** An account's quiet installs marked not an issue or counted again, by this staff member: `marked`, `unmarked`, or `not_found` (`ops_quiet_account_mark`). */
  markQuietAccount(profile: string, ok: boolean, by: string): Promise<string>;
  /** A Linear issue claimed or released by this person (`ops_issue_claim`): `claimed`, `released`, `taken` or `not_yours`. */
  claimIssue(issue: string, claim: boolean, by: string): Promise<string>;
  /** A language's nightly filming turned on or off, by this person: `on` or `off` (`ops_tutorial_filming_set`). */
  setFilming(language: string, on: boolean, by: string): Promise<string>;
  /** An accepted code change filed in Linear: its issue, or null without a Linear key (the comments job files it later). */
  fileSuggestion(id: string): Promise<string | null>;
  /** A suggestion to fix in the app, by this person (`ops_suggestion_fix_in_app`): what happened, its kind, and its issue when it has one. */
  fixInApp(id: string, by: string, askFirst: boolean): Promise<{ result: string; kind?: string; issue?: string | null }>;
  now(): number;
}

/** The languages that can be filmed: the app's languages, each with a YouTube channel. */
const FILMED = new Set<string>(UI_LANGUAGES.map((l) => l.code));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TUTORIAL = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LANGUAGE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?$/;
const SHA256 = /^[0-9a-f]{64}$/;
/** A Linear issue's id (LAN-12). */
const ISSUE = /^[A-Z]{1,10}-[0-9]{1,7}$/;
/** More than every video in every language at once (47 × 15), so one Publish can send them all. */
export const PUBLISH_MAX = 2000;
/** The longest note, edited detail and reason the dashboard sends. */
export const NOTE_MAX = 2000;
export const DETAIL_MAX = 4000;
export const REASON_MAX = 500;
/** The longest problem line an instruction's card sends, and the most inputs it names. */
export const PROBLEM_MAX = 200;
export const INSTRUCTION_INPUTS_MAX = 20;
/** A line's id (alertKinds.ts alertId): its kind, and its subject after a colon. */
export const LINE = /^[a-z0-9-]{1,60}(:[^\u0000-\u001f\u007f]{1,200})?$/;
const PART = /^[a-z0-9_]{1,40}$/;
const LEVELS = new Set(['urgent', 'problem', 'watch']);
/** The most lines one tap resolves: an Overview row holds a part's lines of one kind. */
export const RESOLVE_MAX = 20;
export const LINE_TITLE_MAX = 300;
export const LINE_TEXT_MAX = 1000;

function resolvedLines(input: unknown): ResolvedLine[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > RESOLVE_MAX) return null;
  const out: ResolvedLine[] = [];
  for (const x of input as unknown[]) {
    const l = (typeof x === 'object' && x !== null ? x : {}) as { line?: unknown; part?: unknown; level?: unknown; measure?: unknown; title?: unknown; text?: unknown };
    const title = typeof l.title === 'string' ? l.title.trim() : '';
    const measure = l.measure === undefined || l.measure === null ? null : typeof l.measure === 'number' && Number.isFinite(l.measure) && l.measure >= 0 ? l.measure : undefined;
    const text = l.text === undefined || l.text === null ? null : typeof l.text === 'string' && l.text.length <= LINE_TEXT_MAX ? l.text.trim() || null : undefined;
    if (text === undefined) return null;
    if (typeof l.line !== 'string' || !LINE.test(l.line) || typeof l.part !== 'string' || !PART.test(l.part) || typeof l.level !== 'string' || !LEVELS.has(l.level)
      || !title || title.length > LINE_TITLE_MAX || measure === undefined || out.some((o) => o.line === l.line)) return null;
    out.push({ line: l.line, part: l.part, level: l.level as ResolvedLine['level'], measure, title, text });
  }
  return out;
}

function tutorialItems(items: unknown): [string, string, string][] | null {
  if (!Array.isArray(items) || items.length === 0 || items.length > PUBLISH_MAX) return null;
  const good = items.every((i) => Array.isArray(i) && i.length === 3 && typeof i[0] === 'string' && i[0].length <= 80 && TUTORIAL.test(i[0])
    && typeof i[1] === 'string' && LANGUAGE.test(i[1]) && typeof i[2] === 'string' && SHA256.test(i[2]));
  return good ? (items as [string, string, string][]) : null;
}

/** What the dashboard sent, checked; anything else is refused before anyone is asked. */
export function parseAction(input: unknown): Action | null {
  if (typeof input !== 'object' || input === null) return null;
  const a = input as { kind?: unknown; id?: unknown; status?: unknown; key?: unknown; profile?: unknown; ok?: unknown; askFirst?: unknown };
  if (a.kind === 'feedback' && typeof a.id === 'string' && UUID.test(a.id) && (a.status === 'new' || a.status === 'seen' || a.status === 'done')) {
    return { kind: 'feedback', id: a.id, status: a.status };
  }
  if (a.kind === 'run' && typeof a.key === 'string' && isJobKey(a.key)) return { kind: 'run', key: a.key };
  if (a.kind === 'quiet-account' && typeof a.profile === 'string' && UUID.test(a.profile) && typeof a.ok === 'boolean') {
    return { kind: 'quiet-account', profile: a.profile.toLowerCase(), ok: a.ok };
  }
  const d = (input as { decision?: unknown }).decision;
  if (a.kind === 'verification' && typeof a.id === 'string' && UUID.test(a.id) && (d === 'grant' || d === 'decline')) return { kind: 'verification', id: a.id, decision: d };
  if (a.kind === 'youtube-start') return { kind: 'youtube-start' };
  const f = input as { language?: unknown; on?: unknown };
  if (a.kind === 'tutorial-filming' && typeof f.language === 'string' && FILMED.has(f.language) && typeof f.on === 'boolean') {
    return { kind: 'tutorial-filming', language: f.language, on: f.on };
  }
  const y = input as { code?: unknown; state?: unknown; items?: unknown };
  if (a.kind === 'youtube-connect' && typeof y.code === 'string' && /^[\x21-\x7e]{10,512}$/.test(y.code) && typeof y.state === 'string' && y.state.length <= 200) {
    return { kind: 'youtube-connect', code: y.code, state: y.state };
  }
  const items = a.kind === 'tutorials-publish' ? tutorialItems(y.items) : null;
  if (items) return { kind: 'tutorials-publish', items };
  const t = input as { tutorial?: unknown; text?: unknown; detail?: unknown; reason?: unknown };
  const optional = (v: unknown, max: number) => (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ? null
    : typeof v === 'string' && v.trim().length <= max ? v.trim() : undefined);
  if (a.kind === 'tutorial-note') {
    const tutorial = t.tutorial === null || t.tutorial === undefined ? null : typeof t.tutorial === 'string' && t.tutorial.length <= 80 && TUTORIAL.test(t.tutorial) ? t.tutorial : undefined;
    const text = optional(t.text, NOTE_MAX);
    if (tutorial === undefined || !text) return null;
    const i = input as { instruct?: unknown; problem?: unknown; language?: unknown; inputs?: unknown };
    if (i.instruct === undefined || i.instruct === false) return { kind: 'tutorial-note', tutorial, text };
    const problem = optional(i.problem, PROBLEM_MAX);
    const language = i.language === undefined || i.language === null ? null : typeof i.language === 'string' && LANGUAGE.test(i.language) ? i.language : undefined;
    const inputs = i.inputs === undefined || i.inputs === null ? [] : Array.isArray(i.inputs) && i.inputs.length <= INSTRUCTION_INPUTS_MAX
      && i.inputs.every((x) => typeof x === 'string' && UUID.test(x)) ? [...new Set((i.inputs as string[]).map((x) => x.toLowerCase()))] : undefined;
    if (i.instruct !== true || !tutorial || problem === undefined || language === undefined || !inputs) return null;
    return { kind: 'tutorial-instruction', tutorial, text, problem, language, inputs };
  }
  const done = (input as { done?: unknown }).done;
  if (a.kind === 'tutorial-reply' && typeof a.id === 'string' && UUID.test(a.id) && (done === 'posted' || done === 'none' || done === 'open')) {
    return { kind: 'tutorial-reply', id: a.id.toLowerCase(), done };
  }
  if (a.kind === 'issue-claim') {
    const c = input as { issue?: unknown; claim?: unknown };
    return typeof c.issue === 'string' && ISSUE.test(c.issue) && typeof c.claim === 'boolean' ? { kind: 'issue-claim', issue: c.issue, claim: c.claim } : null;
  }
  if (a.kind === 'replies-seen') return { kind: 'replies-seen' };
  if (a.kind === 'user-issue-note') {
    const issue = (input as { issue?: unknown }).issue;
    const text = optional(t.text, NOTE_MAX);
    return typeof issue === 'string' && ISSUE.test(issue) && text ? { kind: 'user-issue-note', issue, text } : null;
  }
  if (a.kind === 'card-question') {
    const q = input as { card?: unknown; page?: unknown; title?: unknown; context?: unknown };
    const text = optional(t.text, QUESTION_MAX.text);
    const title = optional(q.title, QUESTION_MAX.title);
    // The card's words may be cut by the page; none is fine.
    const context = q.context === undefined || q.context === '' ? '' : typeof q.context === 'string' && q.context.length <= QUESTION_MAX.context ? q.context : null;
    return typeof q.card === 'string' && CARD.test(q.card) && typeof q.page === 'string' && PAGE.test(q.page) && title && text && context !== null
      ? { kind: 'card-question', card: q.card, page: q.page, title, context, text } : null;
  }
  if (a.kind === 'line-resolve') {
    const lines = resolvedLines((input as { lines?: unknown }).lines);
    return lines ? { kind: 'line-resolve', lines } : null;
  }
  if (a.kind === 'line-show') {
    const lines = (input as { lines?: unknown }).lines;
    return Array.isArray(lines) && lines.length > 0 && lines.length <= RESOLVE_MAX && lines.every((l) => typeof l === 'string' && LINE.test(l))
      ? { kind: 'line-show', lines: [...new Set(lines as string[])] } : null;
  }
  if (a.kind === 'tutorial-fix' && typeof a.id === 'string' && UUID.test(a.id) && (a.askFirst === undefined || typeof a.askFirst === 'boolean')) return { kind: 'tutorial-fix', id: a.id.toLowerCase(), askFirst: a.askFirst === true };
  if (a.kind === 'tutorial-suggestion' && typeof a.id === 'string' && UUID.test(a.id) && (d === 'accept' || d === 'reject' || d === 'edit')) {
    const detail = optional(t.detail, DETAIL_MAX);
    const reason = optional(t.reason, REASON_MAX);
    if (detail === undefined || reason === undefined || (d === 'edit' && !detail)) return null;
    return { kind: 'tutorial-suggestion', id: a.id.toLowerCase(), decision: d, detail, reason };
  }
  return null;
}

const NAMES: Record<'run' | 'youtube-start' | 'youtube-connect' | 'tutorials-publish' | 'tutorial-note', string> = {
  run: 'run_job', 'youtube-start': 'youtube_start', 'youtube-connect': 'youtube_connect', 'tutorials-publish': 'tutorials_publish', 'tutorial-note': 'tutorial_note'
};
const DECIDED = { accept: 'accepted', reject: 'rejected', edit: 'edited' } as const;

function nameOf(action: Action): { name: string; target: string } {
  switch (action.kind) {
    case 'feedback': return { name: `feedback_${action.status}`, target: action.id };
    case 'verification': return { name: `verification_${action.decision}`, target: action.id };
    case 'run': return { name: NAMES.run, target: action.key };
    case 'tutorials-publish': return { name: NAMES[action.kind], target: `${action.items.length} videos` };
    case 'tutorial-note': return { name: NAMES[action.kind], target: action.tutorial ?? 'no video' };
    case 'tutorial-instruction': return { name: NAMES['tutorial-note'], target: action.tutorial };
    case 'tutorial-suggestion': return { name: `suggestion_${DECIDED[action.decision]}`, target: action.id };
    case 'tutorial-fix': return { name: 'suggestion_fix', target: action.id };
    case 'tutorial-reply': return { name: `reply_${action.done}`, target: action.id };
    case 'user-issue-note': return { name: 'user_issue_note', target: action.issue };
    // ops.actions keeps a target of at most 100 characters.
    case 'card-question': return { name: 'card_question', target: action.card.slice(0, 100) };
    case 'line-resolve': return { name: 'line_resolved', target: action.lines[0]!.line.slice(0, 100) };
    case 'line-show': return { name: 'line_shown', target: action.lines[0]!.slice(0, 100) };
    case 'tutorial-filming': return { name: action.on ? 'filming_on' : 'filming_off', target: action.language };
    case 'quiet-account': return { name: action.ok ? 'quiet_ok' : 'quiet_ok_undo', target: action.profile };
    case 'issue-claim': return { name: action.claim ? 'issue_claim' : 'issue_release', target: action.issue };
    case 'replies-seen': return { name: 'replies_seen', target: 'replies' };
    default: return { name: NAMES[action.kind], target: 'youtube' };
  }
}

/** A code for the log from what went wrong: YouTube's or Linear's reason, or the error's class. */
const codeOf = (e: unknown) => (e instanceof YouTubeError ? e.code : e instanceof LinearError ? `linear_${e.code}`.slice(0, 80) : e instanceof Error ? e.constructor.name : 'unknown');

export async function act(deps: ActionDeps, token: string, input: unknown): Promise<ActionResult> {
  const action = parseAction(input);
  if (!action) return { ok: false, status: 400, error: 'Not an action the ops dashboard may take.' };
  const who = token ? await deps.whoIs(token) : null;
  if (!who) return { ok: false, status: 401, error: 'Your sign-in ended. Sign in again.' };
  const { name, target } = nameOf(action);
  if (!(await deps.globalViewerOn(who.profileId, who.aal))) {
    await deps.record({ profileId: who.profileId, action: name, target, result: 'refused' }).catch(() => {});
    return { ok: false, status: 403, error: 'Only Global Viewers on a session verified with their authenticator may act here.' };
  }
  try {
    if (action.kind === 'feedback') {
      const found = await deps.setFeedbackStatus(action.id, action.status);
      await deps.record({ profileId: who.profileId, action: name, target, result: found ? 'ok' : 'refused', ...(found ? {} : { detail: 'not_found' }) });
      return found ? { ok: true, result: action.status } : { ok: false, status: 404, error: 'No feedback has that id.' };
    }
    if (action.kind === 'verification') {
      const answer = await deps.decideVerification(action.id, action.decision === 'grant', who.profileId);
      const done = answer === (action.decision === 'grant' ? 'granted' : 'declined');
      await deps.record({ profileId: who.profileId, action: name, target, result: done ? 'ok' : 'refused', ...(done ? {} : { detail: answer }) });
      return done ? { ok: true, result: answer } : answer === 'not_found' ? { ok: false, status: 404, error: 'No request has that id.' }
        : { ok: false, status: 400, error: 'That request is not waiting for staff.' };
    }
    if (action.kind === 'quiet-account') {
      const answer = await deps.markQuietAccount(action.profile, action.ok, who.profileId);
      const found = answer !== 'not_found';
      await deps.record({ profileId: who.profileId, action: name, target, result: found ? 'ok' : 'refused', ...(found ? {} : { detail: answer }) });
      return found ? { ok: true, result: answer } : { ok: false, status: 404, error: 'No account has that id.' };
    }
    if (action.kind === 'youtube-start' || action.kind === 'youtube-connect') {
      if (!deps.youtube) {
        await deps.record({ profileId: who.profileId, action: name, target, result: 'refused', detail: 'not_set_up' });
        return { ok: false, status: 503, error: 'YouTube is not set up here (YOUTUBE_CLIENT_ID).' };
      }
      return action.kind === 'youtube-start' ? await youtubeStart(deps, deps.youtube, who.profileId) : await youtubeConnect(deps, deps.youtube, who.profileId, action);
    }
    if (action.kind === 'tutorials-publish') {
      const marked = await deps.approveTutorials(action.items, who.profileId);
      const run = await deps.runJob('tutorial-publish');
      await deps.record({ profileId: who.profileId, action: name, target, result: 'ok', detail: `marked:${marked}:${run}` });
      return { ok: true, result: run };
    }
    if (action.kind === 'tutorial-note') {
      await deps.addNote(action.tutorial, action.text, who.profileId);
      await deps.record({ profileId: who.profileId, action: name, target, result: 'ok' });
      return { ok: true, result: 'noted' };
    }
    if (action.kind === 'tutorial-instruction') {
      const { kind: _kind, ...row } = action;
      const id = await deps.instruct(row, who.profileId);
      await deps.record({ profileId: who.profileId, action: name, target, result: 'ok', detail: `instruction:${id}` });
      return { ok: true, result: 'instructed' };
    }
    if (action.kind === 'user-issue-note') {
      const answer = await deps.instructIssue(action.issue, action.text, who.profileId);
      const kept = answer !== 'not_found' && answer !== 'full';
      await deps.record({ profileId: who.profileId, action: name, target, result: kept ? 'ok' : 'refused', detail: kept ? `note:${answer}` : answer });
      return kept ? { ok: true, result: 'instructed' }
        : answer === 'full' ? { ok: false, status: 400, error: 'Three instructions on that issue wait for Claude already. Wait for its answer.' }
          : { ok: false, status: 404, error: `Claude cannot take an instruction on ${action.issue}. The watch did not file this issue, and no line on this page names it now.` };
    }
    if (action.kind === 'card-question') {
      const { kind: _kind, ...row } = action;
      const answer = await deps.askCard(row, who.profileId);
      const kept = answer !== 'full' && answer !== 'many';
      await deps.record({ profileId: who.profileId, action: name, target, result: kept ? 'ok' : 'refused', detail: kept ? `question:${answer}` : answer });
      return kept ? { ok: true, result: 'asked' }
        : answer === 'full' ? { ok: false, status: 400, error: 'Three questions on this card wait for Claude already. Wait for its answer.' }
          : { ok: false, status: 400, error: 'Twenty questions on the dashboard wait for Claude already. Wait for its answers.' };
    }
    if (action.kind === 'line-resolve' || action.kind === 'line-show') {
      const n = action.kind === 'line-resolve' ? await deps.resolveLines(action.lines, who.profileId) : await deps.showLines(action.lines, who.profileId);
      await deps.record({ profileId: who.profileId, action: name, target, result: 'ok', detail: `lines:${n}` });
      return { ok: true, result: action.kind === 'line-resolve' ? 'resolved' : 'shown' };
    }
    if (action.kind === 'issue-claim') {
      const answer = await deps.claimIssue(action.issue, action.claim, who.profileId);
      const done = answer === (action.claim ? 'claimed' : 'released');
      await deps.record({ profileId: who.profileId, action: name, target, result: done ? 'ok' : 'refused', ...(done ? {} : { detail: answer }) });
      return done ? { ok: true, result: answer }
        : answer === 'taken' ? { ok: false, status: 400, error: 'Another developer claimed this issue first.' }
          : { ok: false, status: 400, error: 'Another developer claimed this issue. Only they can release it.' };
    }
    if (action.kind === 'replies-seen') {
      await deps.record({ profileId: who.profileId, action: name, target, result: 'ok' });
      return { ok: true, result: 'seen' };
    }
    if (action.kind === 'tutorial-filming') {
      const answer = await deps.setFilming(action.language, action.on, who.profileId);
      await deps.record({ profileId: who.profileId, action: name, target, result: 'ok' });
      return { ok: true, result: answer };
    }
    if (action.kind === 'tutorial-suggestion') return await answerSuggestion(deps, who.profileId, action, name, target);
    if (action.kind === 'tutorial-fix') return await fixInApp(deps, who.profileId, action.id, action.askFirst, name, target);
    if (action.kind === 'tutorial-reply') {
      const answer = await deps.replyDone(action.id, action.done, who.profileId);
      const found = answer === 'ok';
      await deps.record({ profileId: who.profileId, action: name, target, result: found ? 'ok' : 'refused', ...(found ? {} : { detail: answer }) });
      return found ? { ok: true, result: action.done } : { ok: false, status: 404, error: 'No comment with a suggested reply has that id.' };
    }
    const result = await deps.runJob(action.key);
    await deps.record({ profileId: who.profileId, action: name, target, result: result === 'started' ? 'ok' : 'refused', detail: result });
    return { ok: true, result };
  } catch (e) {
    const detail = codeOf(e);
    await deps.record({ profileId: who.profileId, action: name, target, result: 'error', detail }).catch(() => {});
    return { ok: false, status: 502, error: `It did not work (${detail}).` };
  }
}

/**
 * A suggestion answered once. An accepted code change goes to Linear now
 * when the Worker has its key; when it has none, or Linear fails, the
 * suggestion stays accepted and the comments job files it (186).
 */
async function answerSuggestion(deps: ActionDeps, profileId: string, action: Extract<Action, { kind: 'tutorial-suggestion' }>, name: string, target: string): Promise<ActionResult> {
  const decided = await deps.decideSuggestion(action.id, DECIDED[action.decision], action.detail, action.reason, profileId);
  if (decided.result === 'not_found' || decided.result === 'decided') {
    await deps.record({ profileId, action: name, target, result: 'refused', detail: decided.result });
    return decided.result === 'not_found' ? { ok: false, status: 404, error: 'No suggestion has that id.' } : { ok: false, status: 400, error: 'Someone has answered that suggestion already.' };
  }
  let detail: string = decided.kind ?? decided.result;
  let result = decided.result;
  if (decided.result === 'accepted' && decided.kind === 'code') {
    const issue = await deps.fileSuggestion(action.id).catch((e: unknown) => {
      detail = codeOf(e);
      return null;
    });
    if (issue) detail = issue;
    result = issue ? `accepted:${issue}` : 'accepted:waiting';
  }
  await deps.record({ profileId, action: name, target, result: 'ok', detail });
  return { ok: true, result };
}

/** Why "Fix it" is refused, as the card says it. */
const FIX_REFUSED: Record<string, string> = {
  not_found: 'No suggestion has that id.',
  decided: 'That suggestion was rejected, or it is a new video: there is nothing to fix in the app.',
  refused: 'Claude makes that change in the video. Ask for a fix in the app only when the change to the video failed.',
  already: 'Someone asked for a fix in the app already.'
};

/**
 * "Fix it" kept (with "Ask me before it merges", or not), then filed in Linear now when the Worker has its key, as
 * an accepted code change is. Once the issue is known, the instruction for the agent team waits (the database
 * writes it, with `go`), and the watch hands it to the fix jobs within 15 minutes. The fix merges on the agent
 * team's rule, with no tap (docs/decisions/2026-11-21-fix-it-sends-a-video-suggestion-to-the-agent-team.md). Without a key, or when Linear fails, the comments job files it at night, and
 * the instruction waits until then.
 */
async function fixInApp(deps: ActionDeps, profileId: string, id: string, askFirst: boolean, name: string, target: string): Promise<ActionResult> {
  const asked = await deps.fixInApp(id, profileId, askFirst);
  if (asked.result !== 'asked') {
    await deps.record({ profileId, action: name, target, result: 'refused', detail: asked.result });
    return { ok: false, status: asked.result === 'not_found' ? 404 : 400, error: FIX_REFUSED[asked.result] ?? 'It did not work.' };
  }
  let issue = asked.issue ?? null;
  let detail: string = asked.kind ?? 'asked';
  if (!issue) {
    issue = await deps.fileSuggestion(id).catch((e: unknown) => {
      detail = codeOf(e);
      return null;
    });
  }
  if (issue) detail = issue;
  await deps.record({ profileId, action: name, target, result: 'ok', detail: askFirst ? `${detail}:ask_first` : detail });
  return { ok: true, result: issue ? `fixing:${issue}` : 'fixing:waiting' };
}

type YouTube = NonNullable<ActionDeps['youtube']>;

/** Google's page, with a state that only this person can bring back, within 15 minutes. */
async function youtubeStart(deps: ActionDeps, yt: YouTube, profileId: string): Promise<ActionResult> {
  const url = consentUrl(yt.client, yt.redirectUri, await signState(yt.client.clientSecret, profileId, deps.now()));
  await deps.record({ profileId, action: 'youtube_start', target: 'youtube', result: 'ok' });
  return { ok: true, result: url };
}

/**
 * The channel the person chose, kept: only one of LangQuest's channels, and
 * only from the person who pressed Connect. Its home page's list of the other
 * channels is brought up to date on the way; that failing does not stop the
 * Connect, and the dashboard shows its code.
 */
async function youtubeConnect(deps: ActionDeps, yt: YouTube, profileId: string, action: { code: string; state: string }): Promise<ActionResult> {
  if ((await readState(yt.client.clientSecret, action.state, deps.now())) !== profileId) {
    await deps.record({ profileId, action: 'youtube_connect', target: 'youtube', result: 'refused', detail: 'state' });
    return { ok: false, status: 400, error: 'That Connect took too long or was started by someone else. Press Connect again.' };
  }
  const { refreshToken, accessToken } = await exchangeCode(yt.fetcher, yt.client, yt.redirectUri, action.code);
  const channel = await myChannel(yt.fetcher, accessToken);
  const language = languageOfChannel(channel.id);
  if (!language) {
    await revoke(yt.fetcher, refreshToken).catch(() => {});
    await deps.record({ profileId, action: 'youtube_connect', target: channel.id.slice(0, 100), result: 'refused', detail: 'not_ours' });
    return { ok: false, status: 400, error: `${channel.title} is not one of the LangQuest channels. Press Connect again and choose a LangQuest channel.` };
  }
  const section = await setHome(yt.fetcher, accessToken, language).catch((e: unknown) => codeOf(e));
  await deps.connectChannel({ channelId: channel.id, language, title: channel.title, refreshToken, by: profileId, section });
  await deps.record({ profileId, action: 'youtube_connect', target: channel.id, result: 'ok', detail: language });
  return { ok: true, result: language };
}

/**
 * An admin's instruction on a Linear issue (`ops_user_issue_instruct`). The watch's issues and the
 * research's are known to the database. An issue a line of the dashboard names itself (a nightly
 * test's) is not: only the dashboard's Worker knows its lines (apps/admin/src/lines.ts `named`), so
 * it is asked after a not_found, and the instruction is kept with p_named. Before that Worker has
 * `named`, the answer stays not_found.
 */
export async function instructIssue(issue: string, text: string, by: string,
  rpc: (args: { p_issue: string; p_text: string; p_by: string; p_named?: true }) => Promise<string>,
  named: () => Promise<unknown>): Promise<string> {
  const answer = await rpc({ p_issue: issue, p_text: text, p_by: by });
  if (answer !== 'not_found') return answer;
  const ids = await named();
  return Array.isArray(ids) && ids.includes(issue) ? await rpc({ p_issue: issue, p_text: text, p_by: by, p_named: true }) : answer;
}

/** The service-role wiring of `act`, for the entrypoint. */
export function actionDeps(env: Env): ActionDeps {
  const db = () => serviceClient(env);
  return {
    whoIs: async (token) => {
      const verified = await claimsVerifier(db())(token);
      if (!verified) return null;
      // A session signed out since no longer counts (decision 118); asked every time, actions are rare.
      if (verified.sessionId) {
        const live = await sessionLiveCheck(db())(verified.sessionId).catch(() => false);
        if (!live) return null;
      }
      return { profileId: verified.sub, aal: verified.aal };
    },
    globalViewerOn: async (profileId, aal) => {
      // The database holds the rule: `_gv_on` is true only for an aal2 session.
      const { data, error } = await db().rpc('_gv_on', { p_profile: profileId, p_aal: aal ?? null });
      if (error) throw new Error(`_gv_on: ${error.message}`);
      return data === true;
    },
    setFeedbackStatus: async (id, status) => {
      const { data, error } = await db().rpc('feedback_set_status', { p_id: id, p_status: status });
      if (error) throw new Error(`feedback_set_status: ${error.message}`);
      return data === true;
    },
    runJob: (key) => env.JOBS.get(env.JOBS.idFromName(key)).run({}),
    decideVerification: async (id, grant, profileId) => {
      const { data, error } = await db().rpc('org_verification_decide', { p_request: id, p_grant: grant, p_by: profileId });
      if (error) throw new Error(`org_verification_decide: ${error.message}`);
      return String(data);
    },
    youtube: env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET && env.API_URL
      ? { client: { clientId: env.YOUTUBE_CLIENT_ID, clientSecret: env.YOUTUBE_CLIENT_SECRET }, redirectUri: env.API_URL + CALLBACK_PATH, fetcher: (input, init) => fetch(input, init) }
      : null,
    connectChannel: async (row) => {
      const { error } = await db().rpc('ops_youtube_connected', {
        p_channel: row.channelId, p_language: row.language, p_title: row.title, p_refresh: row.refreshToken, p_by: row.by, p_section: row.section
      });
      if (error) throw new Error(`ops_youtube_connected: ${error.message}`);
    },
    approveTutorials: async (items, by) => {
      const { data, error } = await db().rpc('ops_tutorials_approve', { p_items: items, p_by: by });
      if (error) throw new Error(`ops_tutorials_approve: ${error.message}`);
      return Number(data);
    },
    addNote: async (tutorial, text, by) => {
      const { error } = await db().rpc('ops_tutorial_note', { p_tutorial: tutorial, p_text: text, p_by: by });
      if (error) throw new Error(`ops_tutorial_note: ${error.message}`);
    },
    replyDone: async (id, done, by) => {
      const { data, error } = await db().rpc('ops_tutorial_reply_done', { p_id: id, p_done: done, p_by: by });
      if (error) throw new Error(`ops_tutorial_reply_done: ${error.message}`);
      return String(data);
    },
    claimIssue: async (issue, claim, by) => {
      const { data, error } = await db().rpc('ops_issue_claim', { p_issue: issue, p_claim: claim, p_by: by });
      if (error) throw new Error(`ops_issue_claim: ${error.message}`);
      return String(data);
    },
    setFilming: async (language, on, by) => {
      const { data, error } = await db().rpc('ops_tutorial_filming_set', { p_language: language, p_on: on, p_by: by });
      if (error) throw new Error(`ops_tutorial_filming_set: ${error.message}`);
      return String(data);
    },
    markQuietAccount: async (profile, ok, by) => {
      const { data, error } = await db().rpc('ops_quiet_account_mark', { p_profile: profile, p_ok: ok, p_by: by });
      if (error) throw new Error(`ops_quiet_account_mark: ${error.message}`);
      return String(data);
    },
    instruct: async ({ tutorial, text, problem, language, inputs }, by) => {
      const { data, error } = await db().rpc('ops_tutorial_instruct', {
        p_tutorial: tutorial, p_language: language, p_problem: problem, p_text: text, p_inputs: inputs, p_by: by
      });
      if (error) throw new Error(`ops_tutorial_instruct: ${error.message}`);
      return String(data);
    },
    instructIssue: async (issue, text, by) => await instructIssue(issue, text, by, async (args) => {
      const { data, error } = await db().rpc('ops_user_issue_instruct', args);
      if (error) throw new Error(`ops_user_issue_instruct: ${error.message}`);
      return String(data);
    }, async () => await Promise.resolve().then(() => env.OPS_LINES?.named?.() ?? []).catch((e: unknown) => {
      console.error(`ops named issues: ${e instanceof Error ? e.name : 'unknown'}`);
      return [];
    })),
    resolveLines: async (lines, by) => {
      const { data, error } = await db().rpc('ops_line_resolve', { p_lines: lines, p_by: by });
      if (error) throw new Error(`ops_line_resolve: ${error.message}`);
      return Number(data);
    },
    showLines: async (lines, by) => {
      const { data, error } = await db().rpc('ops_line_show', { p_lines: lines, p_by: by });
      if (error) throw new Error(`ops_line_show: ${error.message}`);
      return Number(data);
    },
    askCard: async ({ card, page, title, context, text }, by) => {
      const { data, error } = await db().rpc('ops_card_ask', { p_card: card, p_page: page, p_title: title, p_context: context, p_text: text, p_by: by });
      if (error) throw new Error(`ops_card_ask: ${error.message}`);
      return String(data);
    },
    decideSuggestion: async (id, decision, detail, reason, by) => {
      const { data, error } = await db().rpc('ops_suggestion_decide', { p_id: id, p_decision: decision, p_detail: detail, p_reason: reason, p_by: by });
      if (error) throw new Error(`ops_suggestion_decide: ${error.message}`);
      return data as { result: string; kind?: string };
    },
    fixInApp: async (id, by, askFirst) => {
      const { data, error } = await db().rpc('ops_suggestion_fix_in_app', { p_id: id, p_by: by, p_ask_first: askFirst });
      if (error) throw new Error(`ops_suggestion_fix_in_app: ${error.message}`);
      return data as { result: string; kind?: string; issue?: string | null };
    },
    fileSuggestion: async (id) => await fileSuggestion(db(), env.LINEAR_API_KEY, id),
    now: () => Date.now(),
    record: async (row) => {
      const { error } = await db().rpc('ops_record_action', {
        p_profile: row.profileId, p_action: row.action, p_target: row.target, p_result: row.result, p_detail: row.detail ?? null
      });
      if (error) throw new Error(`ops_record_action: ${error.message}`);
    }
  };
}

/**
 * Reached only over the ops dashboard's service binding with
 * `entrypoint: "OpsActions"`; never over HTTP. One method.
 */
export class OpsActions extends WorkerEntrypoint<Env> {
  async perform(token: string, action: unknown): Promise<ActionResult> {
    return act(actionDeps(this.env), token, action);
  }
}
