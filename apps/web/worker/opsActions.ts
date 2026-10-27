import { WorkerEntrypoint } from 'cloudflare:workers';
import { serviceClient, type Env } from './env';
import { claimsVerifier, sessionLiveCheck } from './identity';
import { isJobKey, type JobKey } from './jobsModel';

/**
 * The few things the ops dashboard may do (docs/ops-dashboard-plan.md
 * section 6, decisions.md 162): mark feedback seen or done, run a server
 * job now, and grant or decline an organization's blue check (173). The dashboard's own Worker holds no writer's key; it
 * calls this entrypoint over a service binding with the person's own token,
 * and this Worker checks that token itself (a live session, a Global Viewer
 * on an `aal2` session) before acting with the service role. Every attempt
 * by someone it could identify is written to `ops.actions`, refused ones
 * too. Suspending, deleting, moderating and granting stay in the CLIs.
 */

export type Action =
  | { kind: 'feedback'; id: string; status: 'new' | 'seen' | 'done' }
  | { kind: 'run'; key: JobKey }
  | { kind: 'verification'; id: string; decision: 'grant' | 'decline' };

export type ActionResult =
  | { ok: true; result: string }
  | { ok: false; status: 400 | 401 | 403 | 404 | 502; error: string };

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
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  return null;
}

export async function act(deps: ActionDeps, token: string, input: unknown): Promise<ActionResult> {
  const action = parseAction(input);
  if (!action) return { ok: false, status: 400, error: 'Not an action the ops dashboard may take.' };
  const who = token ? await deps.whoIs(token) : null;
  if (!who) return { ok: false, status: 401, error: 'Your sign-in ended. Sign in again.' };
  const name = action.kind === 'feedback' ? `feedback_${action.status}` : action.kind === 'verification' ? `verification_${action.decision}` : 'run_job';
  const target = action.kind === 'run' ? action.key : action.id;
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
    const result = await deps.runJob(action.key);
    await deps.record({ profileId: who.profileId, action: name, target, result: result === 'started' ? 'ok' : 'refused', detail: result });
    return { ok: true, result };
  } catch (e) {
    const detail = e instanceof Error ? e.constructor.name : 'unknown';
    await deps.record({ profileId: who.profileId, action: name, target, result: 'error', detail }).catch(() => {});
    return { ok: false, status: 502, error: `It did not work (${detail}).` };
  }
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
