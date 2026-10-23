import { WorkerEntrypoint } from 'cloudflare:workers';
import { serviceClient, type Env } from './env';
import { isJobKey, type JobKey } from './jobsModel';

/**
 * The few things the ops dashboard may do (docs/ops-dashboard-plan.md
 * section 6, decisions.md 162): mark feedback seen or done, and run a
 * server job now. The dashboard's own Worker holds no writer's key; it
 * calls this entrypoint over a service binding with the person's own token,
 * and this Worker checks that token itself (a live session, a Global Viewer
 * on an `aal2` session) before acting with the service role. Every attempt
 * by someone it could identify is written to `ops.actions`, refused ones
 * too. Suspending, deleting, moderating and granting stay in the CLIs.
 */

export type Action =
  | { kind: 'feedback'; id: string; status: 'new' | 'seen' | 'done' }
  | { kind: 'run'; key: JobKey };

export type ActionResult =
  | { ok: true; result: string }
  | { ok: false; status: 400 | 401 | 403 | 404 | 502; error: string };

export interface ActionDeps {
  /** Who the token is, from its verified claims and a live session; null when it is not good. */
  whoIs(token: string): Promise<{ profileId: string; aal: string | undefined } | null>;
  /** An active Global Viewer grant (`_gv_on`); the caller has checked the session's level. */
  globalViewerOn(profileId: string): Promise<boolean>;
  setFeedbackStatus(id: string, status: 'new' | 'seen' | 'done'): Promise<boolean>;
  runJob(key: JobKey): Promise<'started' | 'running' | 'disabled'>;
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
  return null;
}

export async function act(deps: ActionDeps, token: string, input: unknown): Promise<ActionResult> {
  const action = parseAction(input);
  if (!action) return { ok: false, status: 400, error: 'Not an action the ops dashboard may take.' };
  const who = token ? await deps.whoIs(token) : null;
  if (!who) return { ok: false, status: 401, error: 'Your sign-in ended. Sign in again.' };
  const name = action.kind === 'feedback' ? `feedback_${action.status}` : 'run_job';
  const target = action.kind === 'feedback' ? action.id : action.key;
  if (who.aal !== 'aal2' || !(await deps.globalViewerOn(who.profileId))) {
    await deps.record({ profileId: who.profileId, action: name, target, result: 'refused' }).catch(() => {});
    return { ok: false, status: 403, error: 'Only Global Viewers on a session verified with their authenticator may act here.' };
  }
  try {
    if (action.kind === 'feedback') {
      const found = await deps.setFeedbackStatus(action.id, action.status);
      await deps.record({ profileId: who.profileId, action: name, target, result: found ? 'ok' : 'refused', ...(found ? {} : { detail: 'not_found' }) });
      return found ? { ok: true, result: action.status } : { ok: false, status: 404, error: 'No feedback has that id.' };
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
      const { data, error } = await db().auth.getClaims(token);
      if (error || !data?.claims.sub) return null;
      const sessionId = data.claims['session_id'];
      // A session signed out since no longer counts (decision 118); asked every time, actions are rare.
      if (typeof sessionId === 'string') {
        const live = await db().rpc('session_is_live', { p_session: sessionId });
        if (live.error || live.data !== true) return null;
      }
      const aal = data.claims['aal'];
      return { profileId: data.claims.sub, aal: typeof aal === 'string' ? aal : undefined };
    },
    globalViewerOn: async (profileId) => {
      const { data, error } = await db().rpc('_gv_on', { p_profile: profileId, p_aal: 'aal2' });
      if (error) throw new Error(`_gv_on: ${error.message}`);
      return data === true;
    },
    setFeedbackStatus: async (id, status) => {
      const { data, error } = await db().rpc('feedback_set_status', { p_id: id, p_status: status });
      if (error) throw new Error(`feedback_set_status: ${error.message}`);
      return data === true;
    },
    runJob: (key) => env.JOBS.get(env.JOBS.idFromName(key)).run({}),
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
