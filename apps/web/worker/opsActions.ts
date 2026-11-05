import { WorkerEntrypoint } from 'cloudflare:workers';
import { UI_LANGUAGES } from '@langquest-next/core';
import { serviceClient, type Env } from './env';
import { claimsVerifier, sessionLiveCheck } from './identity';
import { isJobKey, type JobKey } from './jobsModel';
import {
  CALLBACK_PATH, consentUrl, exchangeCode, languageOfChannel, myChannel, readState, revoke, setHome, signState, YouTubeError,
  type ChannelLanguage, type Client, type Fetch
} from '../../../server/youtube';
import { LinearError, linearIssues } from '../../../server/linear';
import { issueOf, type Suggestion } from '../../../server/tutorialFeedback';

/**
 * The few things the ops dashboard may do (docs/ops-dashboard-plan.md
 * section 6, decisions.md 162): mark feedback seen or done, run a server
 * job now, grant or decline an organization's blue check (173), connect
 * a tutorial channel on YouTube and publish its videos (180), and add a note
 * on a tutorial video or answer Claude's suggestion for one (186). The dashboard's own Worker holds no writer's key; it
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
  /** A person's answer to Claude's suggestion: accept or reject it (as edited), or only edit its detail. */
  | { kind: 'tutorial-suggestion'; id: string; decision: 'accept' | 'reject' | 'edit'; detail: string | null; reason: string | null };

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
  /** A suggestion answered (`ops_suggestion_decide`): what happened, and the suggestion's kind. */
  decideSuggestion(id: string, decision: 'accepted' | 'rejected' | 'edited', detail: string | null, reason: string | null, by: string): Promise<{ result: string; kind?: string }>;
  /** An accepted code change filed in Linear: its issue, or null without a Linear key (the comments job files it later). */
  fileSuggestion(id: string): Promise<string | null>;
  now(): number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TUTORIAL = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LANGUAGE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?$/;
const SHA256 = /^[0-9a-f]{64}$/;
/** More than every video in every language at once (47 × 15), so one Publish can send them all. */
export const PUBLISH_MAX = 2000;
/** The longest note, edited detail and reason the dashboard sends. */
export const NOTE_MAX = 2000;
export const DETAIL_MAX = 4000;
export const REASON_MAX = 500;

function tutorialItems(items: unknown): [string, string, string][] | null {
  if (!Array.isArray(items) || items.length === 0 || items.length > PUBLISH_MAX) return null;
  const good = items.every((i) => Array.isArray(i) && i.length === 3 && typeof i[0] === 'string' && i[0].length <= 80 && TUTORIAL.test(i[0])
    && typeof i[1] === 'string' && LANGUAGE.test(i[1]) && typeof i[2] === 'string' && SHA256.test(i[2]));
  return good ? (items as [string, string, string][]) : null;
}

/** What the dashboard sent, checked; anything else is refused before anyone is asked. */
export function parseAction(input: unknown): Action | null {
  if (typeof input !== 'object' || input === null) return null;
  const a = input as { kind?: unknown; id?: unknown; status?: unknown; key?: unknown };
  if (a.kind === 'feedback' && typeof a.id === 'string' && UUID.test(a.id) && (a.status === 'new' || a.status === 'seen' || a.status === 'done')) {
    return { kind: 'feedback', id: a.id, status: a.status };
  }
  if (a.kind === 'run' && typeof a.key === 'string' && isJobKey(a.key)) return { kind: 'run', key: a.key };
  const d = (input as { decision?: unknown }).decision;
  if (a.kind === 'verification' && typeof a.id === 'string' && UUID.test(a.id) && (d === 'grant' || d === 'decline')) return { kind: 'verification', id: a.id, decision: d };
  if (a.kind === 'youtube-start') return { kind: 'youtube-start' };
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
    return tutorial !== undefined && text ? { kind: 'tutorial-note', tutorial, text } : null;
  }
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
    case 'tutorial-suggestion': return { name: `suggestion_${DECIDED[action.decision]}`, target: action.id };
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
    if (action.kind === 'tutorial-suggestion') return await answerSuggestion(deps, who.profileId, action, name, target);
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
    decideSuggestion: async (id, decision, detail, reason, by) => {
      const { data, error } = await db().rpc('ops_suggestion_decide', { p_id: id, p_decision: decision, p_detail: detail, p_reason: reason, p_by: by });
      if (error) throw new Error(`ops_suggestion_decide: ${error.message}`);
      return data as { result: string; kind?: string };
    },
    fileSuggestion: async (id) => {
      if (!env.LINEAR_API_KEY) return null;
      const { data, error } = await db().rpc('ops_suggestions_to_file', { p_limit: 1, p_id: id });
      if (error) throw new Error(`ops_suggestions_to_file: ${error.message}`);
      const suggestion = (data as Suggestion[])[0];
      if (!suggestion) return null;
      const { title, description } = issueOf(suggestion, (code) => UI_LANGUAGES.find((l) => l.code === code)?.english ?? code);
      const issue = await linearIssues((input, init) => fetch(input, init), env.LINEAR_API_KEY).create(title, description);
      const filed = await db().rpc('ops_suggestion_filed', { p_id: id, p_issue: issue.identifier, p_url: issue.url });
      if (filed.error) throw new Error(`ops_suggestion_filed: ${filed.error.message}`);
      return issue.identifier;
    },
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
