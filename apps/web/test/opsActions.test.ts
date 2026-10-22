import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }));
const { act, parseAction } = await import('../worker/opsActions');
type Deps = Parameters<typeof act>[0];

/** What the ops dashboard may do (worker/opsActions.ts, decisions.md 161), with the app Worker checking the person itself. */

const VIEWER = '0857d1bc-0000-4000-8000-000000000001';
const FEEDBACK = '11111111-1111-4111-8111-111111111111';

function deps(over: Partial<Deps> = {}): Deps & { rows: unknown[]; done: string[] } {
  const rows: unknown[] = [];
  const done: string[] = [];
  return {
    rows, done,
    whoIs: async (token) => (token === 'aal2' ? { profileId: VIEWER, aal: 'aal2' } : token === 'aal1' ? { profileId: VIEWER, aal: 'aal1' } : null),
    globalViewerOn: async () => true,
    setFeedbackStatus: async (id, status) => { done.push(`feedback ${id} ${status}`); return id === FEEDBACK; },
    runJob: async (key) => { done.push(`run ${key}`); return 'started'; },
    record: async (row) => { rows.push(row); },
    ...over
  };
}

describe('the ops dashboard\'s actions', () => {
  it('takes only the actions on its list, with their arguments checked', () => {
    expect(parseAction({ kind: 'feedback', id: FEEDBACK, status: 'done' })).toEqual({ kind: 'feedback', id: FEEDBACK, status: 'done' });
    expect(parseAction({ kind: 'run', key: 'projection' })).toEqual({ kind: 'run', key: 'projection' });
    for (const bad of [null, {}, { kind: 'run', key: 'drop-tables' }, { kind: 'feedback', id: 'x', status: 'done' }, { kind: 'feedback', id: FEEDBACK, status: 'deleted' }, { kind: 'suspend', id: VIEWER }]) {
      expect(parseAction(bad)).toBeNull();
    }
  });

  it('marks feedback for a Global Viewer on an aal2 session, and records it', async () => {
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'feedback', id: FEEDBACK, status: 'seen' })).toEqual({ ok: true, result: 'seen' });
    expect(d.done).toEqual([`feedback ${FEEDBACK} seen`]);
    expect(d.rows).toEqual([{ profileId: VIEWER, action: 'feedback_seen', target: FEEDBACK, result: 'ok' }]);
  });

  it('runs a job, and records a run already going as refused', async () => {
    const d = deps({ runJob: async () => 'running' });
    expect(await act(d, 'aal2', { kind: 'run', key: 'v2-import' })).toEqual({ ok: true, result: 'running' });
    expect(d.rows).toEqual([{ profileId: VIEWER, action: 'run_job', target: 'v2-import', result: 'refused', detail: 'running' }]);
  });

  it('refuses a password-only session, or someone who is not a Global Viewer, and records the refusal', async () => {
    const d = deps();
    expect(await act(d, 'aal1', { kind: 'run', key: 'projection' })).toMatchObject({ ok: false, status: 403 });
    const e = deps({ globalViewerOn: async () => false });
    expect(await act(e, 'aal2', { kind: 'run', key: 'projection' })).toMatchObject({ ok: false, status: 403 });
    expect([...d.done, ...e.done]).toEqual([]);
    expect([...d.rows, ...e.rows]).toEqual([
      { profileId: VIEWER, action: 'run_job', target: 'projection', result: 'refused' },
      { profileId: VIEWER, action: 'run_job', target: 'projection', result: 'refused' }
    ]);
  });

  it('asks nobody and records nothing for a bad token or a bad action', async () => {
    const d = deps();
    expect(await act(d, 'stale', { kind: 'run', key: 'projection' })).toMatchObject({ ok: false, status: 401 });
    expect(await act(d, '', { kind: 'run', key: 'projection' })).toMatchObject({ ok: false, status: 401 });
    expect(await act(d, 'aal2', { kind: 'run', key: 'nope' })).toMatchObject({ ok: false, status: 400 });
    expect(d.rows).toEqual([]);
    expect(d.done).toEqual([]);
  });

  it('says feedback that is not there is not found, and an error by its class only', async () => {
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'feedback', id: '22222222-2222-4222-8222-222222222222', status: 'done' })).toMatchObject({ ok: false, status: 404 });
    const e = deps({ runJob: async () => { throw new TypeError('container said something secret'); } });
    const r = await act(e, 'aal2', { kind: 'run', key: 'projection' });
    expect(r).toMatchObject({ ok: false, status: 502, error: 'It did not work (TypeError).' });
    expect(e.rows).toEqual([{ profileId: VIEWER, action: 'run_job', target: 'projection', result: 'error', detail: 'TypeError' }]);
  });
});
