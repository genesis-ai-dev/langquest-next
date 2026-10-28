import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }));
const { act, parseAction, PUBLISH_MAX } = await import('../worker/opsActions');
const { CHANNELS, signState } = await import('../../../server/youtube');
type Deps = Parameters<typeof act>[0];

/** What the ops dashboard may do (worker/opsActions.ts, decisions.md 162), with the app Worker checking the person itself. */

const VIEWER = '0857d1bc-0000-4000-8000-000000000001';
const FEEDBACK = '11111111-1111-4111-8111-111111111111';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const NOW = Date.parse('2026-10-28T09:00:00Z');
const CLIENT = { clientId: 'client.apps.googleusercontent.com', clientSecret: 'client-secret' };
const REDIRECT = 'https://next.langquest.org/ops/api/youtube/callback';

function deps(over: Partial<Deps> = {}): Deps & { rows: unknown[]; done: string[] } {
  const rows: unknown[] = [];
  const done: string[] = [];
  return {
    rows, done,
    whoIs: async (token) => (token === 'aal2' ? { profileId: VIEWER, aal: 'aal2' } : token === 'aal1' ? { profileId: VIEWER, aal: 'aal1' } : null),
    globalViewerOn: async (_profile, aal) => aal === 'aal2',
    setFeedbackStatus: async (id, status) => { done.push(`feedback ${id} ${status}`); return id === FEEDBACK; },
    runJob: async (key) => { done.push(`run ${key}`); return 'started'; },
    decideVerification: async (id, grant, profileId) => { done.push(`verification ${id} ${grant ? 'grant' : 'decline'} by ${profileId}`); return id === REQUEST ? (grant ? 'granted' : 'declined') : 'not_found'; },
    record: async (row) => { rows.push(row); },
    youtube: null,
    connectChannel: async (row) => { done.push(`connect ${row.language} ${row.channelId} ${row.title} ${row.refreshToken} by ${row.by} section ${row.section}`); },
    approveTutorials: async (items, by) => { done.push(`approve ${items.length} by ${by}`); return items.length; },
    now: () => NOW,
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

  it('grants or declines a blue check request (decisions.md 173) as the staff member who pressed it, and records it', async () => {
    expect(parseAction({ kind: 'verification', id: REQUEST, decision: 'grant' })).toEqual({ kind: 'verification', id: REQUEST, decision: 'grant' });
    for (const bad of [{ kind: 'verification', id: REQUEST, decision: 'revoke' }, { kind: 'verification', id: 'x', decision: 'grant' }]) expect(parseAction(bad)).toBeNull();
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'verification', id: REQUEST, decision: 'grant' })).toEqual({ ok: true, result: 'granted' });
    expect(d.done).toEqual([`verification ${REQUEST} grant by ${VIEWER}`]);
    expect(d.rows).toEqual([{ profileId: VIEWER, action: 'verification_grant', target: REQUEST, result: 'ok' }]);
    const other = '33333333-3333-4333-8333-333333333333';
    expect(await act(d, 'aal2', { kind: 'verification', id: other, decision: 'decline' })).toMatchObject({ ok: false, status: 404 });
    expect(d.rows.at(-1)).toEqual({ profileId: VIEWER, action: 'verification_decline', target: other, result: 'refused', detail: 'not_found' });
    const aal1 = deps();
    expect(await act(aal1, 'aal1', { kind: 'verification', id: REQUEST, decision: 'grant' })).toMatchObject({ ok: false, status: 403 });
    expect(aal1.done).toEqual([]);
  });
});

/** Google and YouTube answering by address, with the calls made in order. */
function google(channel: { id: string; title: string }, section: Response = Response.json({ items: [] })) {
  const calls: string[] = [];
  const fetcher = async (input: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${input.split('?')[0]}`);
    if (input === 'https://oauth2.googleapis.com/token') return Response.json({ refresh_token: '1//refresh-0123456789', access_token: 'ya29.access' });
    if (input === 'https://oauth2.googleapis.com/revoke') return new Response(null, { status: 200 });
    if (input.includes('/channels?')) return Response.json({ items: [{ id: channel.id, snippet: { title: channel.title } }] });
    if (input.includes('/channelSections?') && method === 'GET') return section;
    if (input.includes('/channelSections?')) return Response.json({ id: 'section' });
    return new Response('{}', { status: 404 });
  };
  return { calls, youtube: { client: CLIENT, redirectUri: REDIRECT, fetcher } };
}

describe('tutorial videos on YouTube (decisions.md 180)', () => {
  const SHA = 'a'.repeat(64);

  it('takes Connect, what Google sent back, and a Publish of up to every video, with their arguments checked', () => {
    expect(parseAction({ kind: 'youtube-start' })).toEqual({ kind: 'youtube-start' });
    expect(parseAction({ kind: 'youtube-connect', code: '4/0AVGzR1A-code', state: 's' })).toEqual({ kind: 'youtube-connect', code: '4/0AVGzR1A-code', state: 's' });
    expect(parseAction({ kind: 'tutorials-publish', items: [['record-a-passage', 'zh-Hans', SHA]] })).toEqual({ kind: 'tutorials-publish', items: [['record-a-passage', 'zh-Hans', SHA]] });
    for (const bad of [
      { kind: 'youtube-connect', code: 'has spaces in it', state: 's' },
      { kind: 'youtube-connect', code: '4/0AVGzR1A-code' },
      { kind: 'tutorials-publish', items: [] },
      { kind: 'tutorials-publish', items: [['record-a-passage', 'en', 'not-a-hash']] },
      { kind: 'tutorials-publish', items: [['Record a passage', 'en', SHA]] },
      { kind: 'tutorials-publish', items: [['record-a-passage', 'english', SHA]] },
      { kind: 'tutorials-publish', items: Array.from({ length: PUBLISH_MAX + 1 }, () => ['record-a-passage', 'en', SHA]) }
    ]) expect(parseAction(bad)).toBeNull();
  });

  it('says YouTube is not set up where the OAuth client is not, and records it', async () => {
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'youtube-start' })).toMatchObject({ ok: false, status: 503 });
    expect(d.rows).toEqual([{ profileId: VIEWER, action: 'youtube_start', target: 'youtube', result: 'refused', detail: 'not_set_up' }]);
  });

  it('starts Connect on Google\'s page with a state only this person can bring back', async () => {
    const { youtube } = google({ id: CHANNELS.es, title: 'LangQuest - Español' });
    const d = deps({ youtube });
    const r = await act(d, 'aal2', { kind: 'youtube-start' });
    expect(r.ok).toBe(true);
    const url = new URL((r as { result: string }).result);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('state')).toBe(await signState(CLIENT.clientSecret, VIEWER, NOW));
    expect(d.rows).toEqual([{ profileId: VIEWER, action: 'youtube_start', target: 'youtube', result: 'ok' }]);
  });

  it('connects the LangQuest channel chosen, its token kept and its list of the other channels made', async () => {
    const { youtube, calls } = google({ id: CHANNELS.es, title: 'LangQuest - Español' });
    const d = deps({ youtube });
    const state = await signState(CLIENT.clientSecret, VIEWER, NOW - 60_000);
    expect(await act(d, 'aal2', { kind: 'youtube-connect', code: '4/0AVGzR1A-code', state })).toEqual({ ok: true, result: 'es' });
    expect(calls).toEqual([
      'POST https://oauth2.googleapis.com/token',
      'GET https://www.googleapis.com/youtube/v3/channels',
      'GET https://www.googleapis.com/youtube/v3/channelSections',
      'POST https://www.googleapis.com/youtube/v3/channelSections'
    ]);
    expect(d.done).toEqual([`connect es ${CHANNELS.es} LangQuest - Español 1//refresh-0123456789 by ${VIEWER} section made`]);
    expect(d.rows).toEqual([{ profileId: VIEWER, action: 'youtube_connect', target: CHANNELS.es, result: 'ok', detail: 'es' }]);
  });

  it('still connects when the list of the other channels is refused, keeping why', async () => {
    const { youtube } = google({ id: CHANNELS.en, title: 'LangQuest' }, Response.json({ error: { errors: [{ reason: 'forbidden' }] } }, { status: 403 }));
    const d = deps({ youtube });
    const state = await signState(CLIENT.clientSecret, VIEWER, NOW);
    expect(await act(d, 'aal2', { kind: 'youtube-connect', code: '4/0AVGzR1A-code', state })).toEqual({ ok: true, result: 'en' });
    expect(d.done).toEqual([`connect en ${CHANNELS.en} LangQuest 1//refresh-0123456789 by ${VIEWER} section youtube_forbidden`]);
  });

  it('refuses a state from someone else or from more than 15 minutes ago, before asking Google', async () => {
    const { youtube, calls } = google({ id: CHANNELS.es, title: 'LangQuest - Español' });
    const d = deps({ youtube });
    const other = await signState(CLIENT.clientSecret, '0857d1bc-0000-4000-8000-000000000002', NOW);
    const late = await signState(CLIENT.clientSecret, VIEWER, NOW - 16 * 60_000);
    for (const state of [other, late, 'forged']) {
      expect(await act(d, 'aal2', { kind: 'youtube-connect', code: '4/0AVGzR1A-code', state })).toMatchObject({ ok: false, status: 400 });
    }
    expect(calls).toEqual([]);
    expect(d.done).toEqual([]);
    expect(d.rows).toEqual(Array(3).fill({ profileId: VIEWER, action: 'youtube_connect', target: 'youtube', result: 'refused', detail: 'state' }));
  });

  it('keeps nothing from a channel that is not one of LangQuest\'s, and hands its token back', async () => {
    const { youtube, calls } = google({ id: 'UCaaaaaaaaaaaaaaaaaaaaaa', title: 'Someone else' });
    const d = deps({ youtube });
    const state = await signState(CLIENT.clientSecret, VIEWER, NOW);
    expect(await act(d, 'aal2', { kind: 'youtube-connect', code: '4/0AVGzR1A-code', state })).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('Someone else') });
    expect(calls.at(-1)).toBe('POST https://oauth2.googleapis.com/revoke');
    expect(d.done).toEqual([]);
    expect(d.rows).toEqual([{ profileId: VIEWER, action: 'youtube_connect', target: 'UCaaaaaaaaaaaaaaaaaaaaaa', result: 'refused', detail: 'not_ours' }]);
  });

  it('publishes: marks the versions chosen, by this person, and starts the publish job', async () => {
    const d = deps();
    const items = [['record-a-passage', 'en', SHA], ['record-a-passage', 'es', 'b'.repeat(64)]];
    expect(await act(d, 'aal2', { kind: 'tutorials-publish', items })).toEqual({ ok: true, result: 'started' });
    expect(d.done).toEqual([`approve 2 by ${VIEWER}`, 'run tutorial-publish']);
    expect(d.rows).toEqual([{ profileId: VIEWER, action: 'tutorials_publish', target: '2 videos', result: 'ok', detail: 'marked:2:started' }]);
    const aal1 = deps();
    expect(await act(aal1, 'aal1', { kind: 'tutorials-publish', items })).toMatchObject({ ok: false, status: 403 });
    expect(aal1.done).toEqual([]);
  });
});
