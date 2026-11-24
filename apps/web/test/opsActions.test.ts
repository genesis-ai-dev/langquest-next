import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {} }));
const { act, instructIssue, parseAction, PUBLISH_MAX } = await import('../worker/opsActions');
const { CHANNELS, signState } = await import('../../../server/youtube');
type Deps = Parameters<typeof act>[0];

/** What the ops dashboard may do (worker/opsActions.ts, decisions.md 162), with the app Worker checking the person itself. */

const VIEWER = '0857d1bc-0000-4000-8000-000000000001';
const FEEDBACK = '11111111-1111-4111-8111-111111111111';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const SUGGESTION = '33333333-3333-4333-8333-333333333333';
const CODE = '44444444-4444-4444-8444-444444444444';
const ANSWERED = '55555555-5555-4555-8555-555555555555';
const QUIET = '66666666-6666-4666-8666-666666666666';
const NOW = Date.parse('2026-10-28T09:00:00Z');
const CLIENT = { clientId: 'client.apps.googleusercontent.com', clientSecret: 'client-secret' };
const REDIRECT = 'https://next.langquest.org/ops/api/youtube/callback';

function deps(over: Partial<Deps> = {}): Deps & { rows: unknown[]; done: string[]; runs: string[] } {
  const rows: unknown[] = [];
  const done: string[] = [];
  const runs: string[] = [];
  return {
    rows, done, runs,
    startRun: async (workflow) => { runs.push(workflow); return 'started'; },
    whoIs: async (token) => (token === 'aal2' ? { profileId: VIEWER, aal: 'aal2' } : token === 'aal1' ? { profileId: VIEWER, aal: 'aal1' } : null),
    globalViewerOn: async (_profile, aal) => aal === 'aal2',
    setFeedbackStatus: async (id, status) => { done.push(`feedback ${id} ${status}`); return id === FEEDBACK; },
    runJob: async (key) => { done.push(`run ${key}`); return 'started'; },
    decideVerification: async (id, grant, profileId) => { done.push(`verification ${id} ${grant ? 'grant' : 'decline'} by ${profileId}`); return id === REQUEST ? (grant ? 'granted' : 'declined') : 'not_found'; },
    record: async (row) => { rows.push(row); },
    youtube: null,
    connectChannel: async (row) => { done.push(`connect ${row.language} ${row.channelId} ${row.title} ${row.refreshToken} by ${row.by} section ${row.section}`); },
    approveTutorials: async (items, by) => { done.push(`approve ${items.length} by ${by}`); return items.length; },
    addNote: async (tutorial, text, by) => { done.push(`note ${tutorial} ${text} by ${by}`); },
    replyDone: async (id, state, by) => { done.push(`reply ${id} ${state} by ${by}`); return id === REQUEST ? 'ok' : 'not_found'; },
    closeIssue: async (issue, as) => { done.push(`close ${issue} ${as}`); return as === 'completed' ? 'Live' : 'Canceled'; },
    issueStates: async (issues) => { done.push(`states ${issues.join(',')}`); return issues.map((issue) => ({ issue, state: 'Live', closed: true, closedAt: '2026-10-28T08:00:00Z', fixedBy: 700 })); },
    keepIssueStates: async (states) => { done.push(`keep ${states.map((x) => x.issue + ':' + x.state).join(',')}`); return states.length; },
    claimIssue: async (issue, claim, by) => {
      done.push(`${claim ? 'claim' : 'release'} ${issue} by ${by}`);
      return issue === 'LAN-500' ? (claim ? 'taken' : 'not_yours') : claim ? 'claimed' : 'released';
    },
    setFilming: async (language, on, by) => { done.push(`filming ${language} ${on} by ${by}`); return on ? 'on' : 'off'; },
    markQuietAccount: async (profile, ok, by) => { done.push(`quiet ${profile} ${ok} by ${by}`); return profile === QUIET ? (ok ? 'marked' : 'unmarked') : 'not_found'; },
    instruct: async (row, by) => { done.push(`instruct ${JSON.stringify(row)} by ${by}`); return SUGGESTION; },
    instructIssue: async (issue, text, by) => { done.push(`issue ${issue} ${text} by ${by}`); return issue === 'LAN-284' ? SUGGESTION : issue === 'LAN-285' ? 'full' : 'not_found'; },
    resolveLines: async (lines, by) => { done.push(`resolve ${JSON.stringify(lines)} by ${by}`); return lines.length; },
    showLines: async (lines, by) => { done.push(`show ${lines.join(',')} by ${by}`); return lines.length; },
    askCard: async (row, by) => { done.push(`ask ${row.card} ${row.page} ${row.title} [${row.context}] ${row.text} by ${by}`); return row.card === 'page:full' ? 'full' : row.card === 'page:many' ? 'many' : SUGGESTION; },
    decideSuggestion: async (id, decision, detail, reason, by) => {
      done.push(`${decision} ${id} ${detail} ${reason} by ${by}`);
      return id === SUGGESTION ? { result: decision, kind: 'script' } : id === CODE ? { result: decision, kind: 'code' } : id === ANSWERED ? { result: 'decided', kind: 'script' } : { result: 'not_found' };
    },
    fileSuggestion: async (id) => { done.push(`file ${id}`); return 'LAN-170'; },
    fixInApp: async (id, by, askFirst) => {
      done.push(`fix ${id} by ${by}${askFirst ? ' ask first' : ''}`);
      return id === CODE ? { result: 'asked', kind: 'code', issue: null } : id === SUGGESTION ? { result: 'asked', kind: 'instruction', issue: 'LAN-171' }
        : id === ANSWERED ? { result: 'already', kind: 'code', issue: 'LAN-170' } : { result: 'not_found' };
    },
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

  it('takes an account\'s quiet installs marked not an issue or counted again, with its id checked', () => {
    expect(parseAction({ kind: 'quiet-account', profile: QUIET, ok: true })).toEqual({ kind: 'quiet-account', profile: QUIET, ok: true });
    expect(parseAction({ kind: 'quiet-account', profile: QUIET.toUpperCase(), ok: false })).toEqual({ kind: 'quiet-account', profile: QUIET, ok: false });
    for (const bad of [{ kind: 'quiet-account' }, { kind: 'quiet-account', profile: 'x', ok: true }, { kind: 'quiet-account', profile: QUIET }, { kind: 'quiet-account', profile: QUIET, ok: 'yes' }]) {
      expect(parseAction(bad)).toBeNull();
    }
  });

  it('turns a language\'s nightly filming on or off as the person who pressed it, and records it', async () => {
    for (const bad of [{ kind: 'tutorial-filming', language: 'xx', on: true }, { kind: 'tutorial-filming', language: 'tl' }, { kind: 'tutorial-filming', language: 'tl', on: 'yes' }]) {
      expect(parseAction(bad)).toBeNull();
    }
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'tutorial-filming', language: 'tl', on: true })).toEqual({ ok: true, result: 'on' });
    expect(await act(d, 'aal2', { kind: 'tutorial-filming', language: 'zh-Hans', on: false })).toEqual({ ok: true, result: 'off' });
    expect(d.done).toEqual([`filming tl true by ${VIEWER}`, `filming zh-Hans false by ${VIEWER}`]);
    expect(d.rows).toEqual([
      { profileId: VIEWER, action: 'filming_on', target: 'tl', result: 'ok' },
      { profileId: VIEWER, action: 'filming_off', target: 'zh-Hans', result: 'ok' }
    ]);
  });

  it('marks an account\'s quiet installs as the staff member who pressed it, and records it', async () => {
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'quiet-account', profile: QUIET, ok: true })).toEqual({ ok: true, result: 'marked' });
    expect(await act(d, 'aal2', { kind: 'quiet-account', profile: QUIET, ok: false })).toEqual({ ok: true, result: 'unmarked' });
    expect(d.done).toEqual([`quiet ${QUIET} true by ${VIEWER}`, `quiet ${QUIET} false by ${VIEWER}`]);
    expect(d.rows).toEqual([
      { profileId: VIEWER, action: 'quiet_ok', target: QUIET, result: 'ok' },
      { profileId: VIEWER, action: 'quiet_ok_undo', target: QUIET, result: 'ok' }
    ]);
  });

  it('says an account that is not there is not found, refuses a password-only session, and records both', async () => {
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'quiet-account', profile: FEEDBACK, ok: true })).toMatchObject({ ok: false, status: 404 });
    expect(await act(d, 'aal1', { kind: 'quiet-account', profile: QUIET, ok: true })).toMatchObject({ ok: false, status: 403 });
    expect(d.done).toEqual([`quiet ${FEEDBACK} true by ${VIEWER}`]);
    expect(d.rows).toEqual([
      { profileId: VIEWER, action: 'quiet_ok', target: FEEDBACK, result: 'refused', detail: 'not_found' },
      { profileId: VIEWER, action: 'quiet_ok', target: QUIET, result: 'refused' }
    ]);
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
    if (input.includes('/playlists?') && method === 'GET') return Response.json({ items: [] });
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

  it('connects the LangQuest channel chosen, its token kept and its home page laid out', async () => {
    const { youtube, calls } = google({ id: CHANNELS.es, title: 'LangQuest - Español' });
    const d = deps({ youtube });
    const state = await signState(CLIENT.clientSecret, VIEWER, NOW - 60_000);
    expect(await act(d, 'aal2', { kind: 'youtube-connect', code: '4/0AVGzR1A-code', state })).toEqual({ ok: true, result: 'es' });
    expect(calls).toEqual([
      'POST https://oauth2.googleapis.com/token',
      'GET https://www.googleapis.com/youtube/v3/channels',
      'GET https://www.googleapis.com/youtube/v3/channelSections',
      'GET https://www.googleapis.com/youtube/v3/playlists',
      'POST https://www.googleapis.com/youtube/v3/channelSections',
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

describe('an instruction on a user issue (docs/decisions/2026-11-18-an-admin-tells-claude-what-to-do-with-a-user-issue.md)', () => {
  it('takes an issue and the words, checked', () => {
    expect(parseAction({ kind: 'user-issue-note', issue: 'LAN-284', text: '  Wait for the passage first.  ' })).toEqual({ kind: 'user-issue-note', issue: 'LAN-284', text: 'Wait for the passage first.' });
    for (const bad of [
      { kind: 'user-issue-note', issue: 'lan-284', text: 'x' }, { kind: 'user-issue-note', issue: 'LAN-284; drop', text: 'x' }, { kind: 'user-issue-note', text: 'x' },
      { kind: 'user-issue-note', issue: 'LAN-284', text: ' ' }, { kind: 'user-issue-note', issue: 'LAN-284', text: 'x'.repeat(2001) }, { kind: 'user-issue-note', issue: 'LAN-284', text: 7 }
    ]) {
      expect(parseAction(bad)).toBeNull();
    }
  });

  it('keeps it as this person for the watch, records it, and refuses an issue that is not open or has three waiting', async () => {
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'user-issue-note', issue: 'LAN-284', text: 'Wait for the passage first.' })).toEqual({ ok: true, result: 'instructed', run: 'started' });
    expect(await act(d, 'aal2', { kind: 'user-issue-note', issue: 'LAN-285', text: 'One more.' })).toMatchObject({ ok: false, status: 400 });
    expect(await act(d, 'aal2', { kind: 'user-issue-note', issue: 'LAN-1', text: 'Fix it.' })).toMatchObject({ ok: false, status: 404 });
    expect(d.done).toEqual([`issue LAN-284 Wait for the passage first. by ${VIEWER}`, `issue LAN-285 One more. by ${VIEWER}`, `issue LAN-1 Fix it. by ${VIEWER}`]);
    // The log keeps the issue and the note's id, never the words.
    expect(d.rows).toEqual([
      { profileId: VIEWER, action: 'user_issue_note', target: 'LAN-284', result: 'ok', detail: `note:${SUGGESTION}:run:started` },
      { profileId: VIEWER, action: 'user_issue_note', target: 'LAN-285', result: 'refused', detail: 'full' },
      { profileId: VIEWER, action: 'user_issue_note', target: 'LAN-1', result: 'refused', detail: 'not_found' }
    ]);
    // Only the kept instruction starts the watch now.
    expect(d.runs).toEqual(['user-issues.yml']);
    const aal1 = deps();
    expect(await act(aal1, 'aal1', { kind: 'user-issue-note', issue: 'LAN-284', text: 'Fix it.' })).toMatchObject({ ok: false, status: 403 });
    expect(aal1.done).toEqual([]);
    expect(aal1.runs).toEqual([]);
  });

  it('keeps the instruction when the watch cannot start now, and says why in the log', async () => {
    for (const [run, said] of [['no_token', 'no_token'], ['refused_403', 'refused_403'], [null, 'error']] as const) {
      const d = deps({ startRun: async () => { if (!run) throw new Error('down'); return run; } });
      expect(await act(d, 'aal2', { kind: 'user-issue-note', issue: 'LAN-284', text: 'Fix it.' })).toEqual({ ok: true, result: 'instructed', run: said });
      expect(d.rows).toEqual([{ profileId: VIEWER, action: 'user_issue_note', target: 'LAN-284', result: 'ok', detail: `note:${SUGGESTION}:run:${said}` }]);
    }
  });

  it('says why it refused, with the issue', async () => {
    expect(await act(deps(), 'aal2', { kind: 'user-issue-note', issue: 'LAN-1', text: 'Fix it.' })).toEqual({
      ok: false, status: 404, error: 'Claude cannot take an instruction on LAN-1. The watch did not file this issue, and no line on this page names it now.'
    });
  });

  it('keeps an instruction on an issue a line names itself (a nightly test\'s), only when the dashboard names it now', async () => {
    const calls: unknown[] = [];
    const rpc = async (args: { p_issue: string; p_named?: true }) => { calls.push(args); return args.p_issue === 'LAN-12' || args.p_named ? 'id-1' : 'not_found'; };
    // The watch's own issue: one call, the dashboard is not asked.
    let asked = 0;
    const named = async () => { asked++; return ['LAN-278']; };
    expect(await instructIssue('LAN-12', 'Fix it.', VIEWER, rpc, named)).toBe('id-1');
    expect(asked).toBe(0);
    // A nightly test's issue on the page now: kept, as named.
    expect(await instructIssue('LAN-278', 'Find the cause.', VIEWER, rpc, named)).toBe('id-1');
    expect(calls.at(-1)).toEqual({ p_issue: 'LAN-278', p_text: 'Find the cause.', p_by: VIEWER, p_named: true });
    // Neither: refused, and never kept as named.
    expect(await instructIssue('LAN-5', 'Fix it.', VIEWER, rpc, named)).toBe('not_found');
    expect(calls.at(-1)).toEqual({ p_issue: 'LAN-5', p_text: 'Fix it.', p_by: VIEWER });
    // A dashboard that answers something else names nothing.
    expect(await instructIssue('LAN-278', 'x', VIEWER, rpc, async () => 'LAN-278')).toBe('not_found');
  });
});

describe('a question to Claude from any card (docs/decisions/2026-11-23-ask-claude-from-every-dashboard-card.md)', () => {
  const q = { kind: 'card-question', card: 'line:capacity-r2-class-a', page: 'storage', title: 'R2 class A operations are past the plan', context: 'Recording uploads 5,524,967 of 1,000,000 free', text: ' What does it cost? ' };

  it('takes a line\'s or a page\'s card, its section, title, words and the question, checked', () => {
    expect(parseAction(q)).toEqual({ ...q, text: 'What does it cost?' });
    expect(parseAction({ ...q, context: undefined })).toEqual({ ...q, context: '', text: 'What does it cost?' });
    for (const bad of [{ ...q, card: 'feedback:x' }, { ...q, card: 'line:a\nb' }, { ...q, page: 'Storage' }, { ...q, title: ' ' }, { ...q, text: ' ' },
      { ...q, text: 'x'.repeat(2001) }, { ...q, title: 'x'.repeat(301) }, { ...q, context: 'x'.repeat(6001) }, { ...q, context: 7 }]) {
      expect(parseAction(bad), JSON.stringify(bad).slice(0, 80)).toBeNull();
    }
  });

  it('keeps it for Claude, and says why when a card or the dashboard has too many waiting', async () => {
    const d = deps();
    expect(await act(d, 'aal2', q)).toEqual({ ok: true, result: 'asked', run: 'started' });
    expect(d.done).toEqual([`ask line:capacity-r2-class-a storage R2 class A operations are past the plan [Recording uploads 5,524,967 of 1,000,000 free] What does it cost? by ${VIEWER}`]);
    expect(await act(d, 'aal2', { ...q, card: 'page:full' })).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('Three questions on this card') });
    expect(await act(d, 'aal2', { ...q, card: 'page:many' })).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('Twenty questions') });
    expect(d.rows).toEqual([
      { profileId: VIEWER, action: 'card_question', target: 'line:capacity-r2-class-a', result: 'ok', detail: `question:${SUGGESTION}:run:started` },
      { profileId: VIEWER, action: 'card_question', target: 'page:full', result: 'refused', detail: 'full' },
      { profileId: VIEWER, action: 'card_question', target: 'page:many', result: 'refused', detail: 'many' }
    ]);
    expect(d.runs).toEqual(['card-questions.yml']);
    const aal1 = deps();
    expect(await act(aal1, 'aal1', q)).toMatchObject({ ok: false, status: 403 });
    expect(aal1.done).toEqual([]);
  });

  it('logs at most 100 characters of a long card', async () => {
    const d = deps();
    await act(d, 'aal2', { ...q, card: 'line:' + 'x'.repeat(190) });
    expect((d.rows[0] as { target: string }).target).toHaveLength(100);
  });
});

describe('a line resolved until its problem comes back (docs/decisions/2026-11-24-a-resolved-line-comes-back-with-its-problem.md)', () => {
  const line = { line: 'usage-billed:R2 class A operations', part: 'capacity', level: 'watch', measure: 20.25, title: 'R2 class A operations this month are past what the plan includes',
    text: 'R2 class A operations this month are past what the plan includes. 5,524,967 of 1,000,000; about $20.25 so far.' };

  it('takes each line as the page showed it, checked', () => {
    expect(parseAction({ kind: 'line-resolve', lines: [line] })).toEqual({ kind: 'line-resolve', lines: [line] });
    expect(parseAction({ kind: 'line-resolve', lines: [{ ...line, measure: undefined, title: ' x ' }] })).toEqual({ kind: 'line-resolve', lines: [{ ...line, measure: null, title: 'x' }] });
    // The words are for Claude's check later; a page from before sends none.
    expect(parseAction({ kind: 'line-resolve', lines: [{ ...line, text: undefined }] })).toEqual({ kind: 'line-resolve', lines: [{ ...line, text: null }] });
    expect(parseAction({ kind: 'line-resolve', lines: [{ ...line, text: '  ' }] })).toEqual({ kind: 'line-resolve', lines: [{ ...line, text: null }] });
    for (const bad of [[], [{ ...line, line: 'Usage' }], [{ ...line, line: 'usage-billed:a\nb' }], [{ ...line, part: 'Capacity' }], [{ ...line, level: 'info' }],
      [{ ...line, title: ' ' }], [{ ...line, title: 'x'.repeat(301) }], [{ ...line, measure: -1 }], [{ ...line, measure: '5' }], [line, line],
      [{ ...line, text: 'x'.repeat(1001) }], [{ ...line, text: 7 }],
      Array.from({ length: 21 }, (_, i) => ({ ...line, line: `job-stopped:j${i}` }))]) {
      expect(parseAction({ kind: 'line-resolve', lines: bad }), JSON.stringify(bad).slice(0, 80)).toBeNull();
    }
    expect(parseAction({ kind: 'line-show', lines: ['job-stopped:projection', 'job-stopped:projection'] })).toEqual({ kind: 'line-show', lines: ['job-stopped:projection'] });
    expect(parseAction({ kind: 'line-show', lines: ['Not a line'] })).toBeNull();
    expect(parseAction({ kind: 'line-show', lines: [] })).toBeNull();
  });

  it('keeps it by the person, and logs the first line and how many', async () => {
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'line-resolve', lines: [line] })).toEqual({ ok: true, result: 'resolved' });
    expect(await act(d, 'aal2', { kind: 'line-show', lines: [line.line] })).toEqual({ ok: true, result: 'shown' });
    expect(d.done).toEqual([`resolve ${JSON.stringify([line])} by ${VIEWER}`, `show ${line.line} by ${VIEWER}`]);
    expect(d.rows).toEqual([
      { profileId: VIEWER, action: 'line_resolved', target: line.line, result: 'ok', detail: 'lines:1' },
      { profileId: VIEWER, action: 'line_shown', target: line.line, result: 'ok', detail: 'lines:1' }
    ]);
    const aal1 = deps();
    expect(await act(aal1, 'aal1', { kind: 'line-resolve', lines: [line] })).toMatchObject({ ok: false, status: 403 });
    expect(aal1.done).toEqual([]);
  });
});

describe('a claim on an issue, and Claude\'s replies seen (docs/decisions/2026-11-24-claim-issues-and-see-claudes-replies.md)', () => {
  it('takes a Linear issue and claim or release, and nothing else', () => {
    expect(parseAction({ kind: 'issue-claim', issue: 'LAN-12', claim: true })).toEqual({ kind: 'issue-claim', issue: 'LAN-12', claim: true });
    expect(parseAction({ kind: 'issue-claim', issue: 'LAN-12', claim: false })).toEqual({ kind: 'issue-claim', issue: 'LAN-12', claim: false });
    for (const bad of [{ kind: 'issue-claim', issue: 'lan-12', claim: true }, { kind: 'issue-claim', issue: 'LAN-12' }, { kind: 'issue-claim', issue: 'LAN-12', claim: 'yes' },
      { kind: 'issue-claim', claim: true }]) {
      expect(parseAction(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(parseAction({ kind: 'replies-seen' })).toEqual({ kind: 'replies-seen' });
  });

  it('claims and releases as the person, says why another developer\'s claim stays, and logs each', async () => {
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'issue-claim', issue: 'LAN-12', claim: true })).toEqual({ ok: true, result: 'claimed' });
    expect(await act(d, 'aal2', { kind: 'issue-claim', issue: 'LAN-12', claim: false })).toEqual({ ok: true, result: 'released' });
    expect(await act(d, 'aal2', { kind: 'issue-claim', issue: 'LAN-500', claim: true })).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('claimed this issue first') });
    expect(await act(d, 'aal2', { kind: 'issue-claim', issue: 'LAN-500', claim: false })).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('Only they can release it') });
    expect(d.done).toEqual([`claim LAN-12 by ${VIEWER}`, `release LAN-12 by ${VIEWER}`, `claim LAN-500 by ${VIEWER}`, `release LAN-500 by ${VIEWER}`]);
    expect(d.rows).toEqual([
      { profileId: VIEWER, action: 'issue_claim', target: 'LAN-12', result: 'ok' },
      { profileId: VIEWER, action: 'issue_release', target: 'LAN-12', result: 'ok' },
      { profileId: VIEWER, action: 'issue_claim', target: 'LAN-500', result: 'refused', detail: 'taken' },
      { profileId: VIEWER, action: 'issue_release', target: 'LAN-500', result: 'refused', detail: 'not_yours' }
    ]);
    const aal1 = deps();
    expect(await act(aal1, 'aal1', { kind: 'issue-claim', issue: 'LAN-12', claim: true })).toMatchObject({ ok: false, status: 403 });
    expect(aal1.done).toEqual([]);
  });

  it('keeps the time the person opened Claude\'s replies', async () => {
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'replies-seen' })).toEqual({ ok: true, result: 'seen' });
    expect(d.rows).toEqual([{ profileId: VIEWER, action: 'replies_seen', target: 'replies', result: 'ok' }]);
  });
});

describe('feedback on the tutorial videos (decisions.md 186)', () => {
  it('takes a note on a video or none, and an answer to a suggestion, with their arguments checked', () => {
    expect(parseAction({ kind: 'tutorial-note', tutorial: 'record-a-passage', text: '  Says Save, shows Done.  ' }))
      .toEqual({ kind: 'tutorial-note', tutorial: 'record-a-passage', text: 'Says Save, shows Done.' });
    expect(parseAction({ kind: 'tutorial-note', tutorial: null, text: 'A video on exporting audio.' })).toEqual({ kind: 'tutorial-note', tutorial: null, text: 'A video on exporting audio.' });
    expect(parseAction({ kind: 'tutorial-suggestion', id: SUGGESTION, decision: 'accept' })).toEqual({ kind: 'tutorial-suggestion', id: SUGGESTION, decision: 'accept', detail: null, reason: null });
    expect(parseAction({ kind: 'tutorial-suggestion', id: SUGGESTION, decision: 'edit', detail: 'Say Done.' })).toMatchObject({ decision: 'edit', detail: 'Say Done.' });
    for (const bad of [
      { kind: 'tutorial-note', tutorial: 'Record a passage', text: 'x' }, { kind: 'tutorial-note', tutorial: null, text: ' ' },
      { kind: 'tutorial-note', tutorial: null, text: 'x'.repeat(2001) }, { kind: 'tutorial-suggestion', id: 'x', decision: 'accept' },
      { kind: 'tutorial-suggestion', id: SUGGESTION, decision: 'build' }, { kind: 'tutorial-suggestion', id: SUGGESTION, decision: 'edit' },
      { kind: 'tutorial-suggestion', id: SUGGESTION, decision: 'reject', reason: 'x'.repeat(501) }, { kind: 'tutorial-suggestion', id: SUGGESTION, decision: 'accept', detail: 7 }
    ]) {
      expect(parseAction(bad)).toBeNull();
    }
  });

  it('takes an admin\'s instruction for a video as a note with instruct, its arguments checked', () => {
    const instruct = { kind: 'tutorial-note', tutorial: 'answer-feedback', text: '  The button is now called On this device. Change the script.  ', instruct: true };
    expect(parseAction(instruct)).toEqual({
      kind: 'tutorial-instruction', tutorial: 'answer-feedback', text: 'The button is now called On this device. Change the script.', problem: null, language: null, inputs: []
    });
    expect(parseAction({ ...instruct, problem: 'Answer feedback (en): the film fails', language: 'en', inputs: [REQUEST.toUpperCase(), REQUEST] }))
      .toMatchObject({ problem: 'Answer feedback (en): the film fails', language: 'en', inputs: [REQUEST] });
    // A note without instruct stays a note: an older dashboard's, or the free note.
    expect(parseAction({ ...instruct, instruct: false })).toMatchObject({ kind: 'tutorial-note' });
    for (const bad of [
      { ...instruct, tutorial: null }, { ...instruct, instruct: 'yes' }, { ...instruct, problem: 'x'.repeat(201) }, { ...instruct, language: 'English' },
      { ...instruct, inputs: ['x'] }, { ...instruct, inputs: Array.from({ length: 21 }, () => REQUEST) }, { ...instruct, inputs: REQUEST }, { ...instruct, text: ' ' }
    ]) {
      expect(parseAction(bad)).toBeNull();
    }
  });

  it('keeps an instruction as an accepted change by this person, and records which', async () => {
    const d = deps();
    const sent = { kind: 'tutorial-note', tutorial: 'answer-feedback', text: 'Change the script.', instruct: true, problem: 'Answer feedback (en): the film fails', language: 'en', inputs: [REQUEST] };
    expect(await act(d, 'aal2', sent)).toEqual({ ok: true, result: 'instructed' });
    expect(d.done).toEqual([`instruct ${JSON.stringify({ tutorial: 'answer-feedback', text: 'Change the script.', problem: 'Answer feedback (en): the film fails', language: 'en', inputs: [REQUEST] })} by ${VIEWER}`]);
    expect(d.rows).toEqual([{ profileId: VIEWER, action: 'tutorial_note', target: 'answer-feedback', result: 'ok', detail: `instruction:${SUGGESTION}` }]);
    const aal1 = deps();
    expect(await act(aal1, 'aal1', sent)).toMatchObject({ ok: false, status: 403 });
    expect(aal1.done).toEqual([]);
  });

  it('keeps a note as this person, and records it', async () => {
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'tutorial-note', tutorial: 'record-a-passage', text: 'Says Save, shows Done.' })).toEqual({ ok: true, result: 'noted' });
    expect(d.done).toEqual([`note record-a-passage Says Save, shows Done. by ${VIEWER}`]);
    expect(d.rows).toEqual([{ profileId: VIEWER, action: 'tutorial_note', target: 'record-a-passage', result: 'ok' }]);
  });

  it('records what became of a comment\'s suggested reply, and posts nothing', async () => {
    expect(parseAction({ kind: 'tutorial-reply', id: REQUEST.toUpperCase(), done: 'posted' })).toEqual({ kind: 'tutorial-reply', id: REQUEST, done: 'posted' });
    for (const bad of [{ kind: 'tutorial-reply' }, { kind: 'tutorial-reply', id: 'x', done: 'posted' }, { kind: 'tutorial-reply', id: REQUEST }, { kind: 'tutorial-reply', id: REQUEST, done: 'send' },
      { kind: 'tutorial-reply', id: REQUEST, done: true }]) {
      expect(parseAction(bad)).toBeNull();
    }
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'tutorial-reply', id: REQUEST, done: 'posted' })).toEqual({ ok: true, result: 'posted' });
    expect(await act(d, 'aal2', { kind: 'tutorial-reply', id: REQUEST, done: 'none' })).toEqual({ ok: true, result: 'none' });
    expect(await act(d, 'aal2', { kind: 'tutorial-reply', id: REQUEST, done: 'open' })).toEqual({ ok: true, result: 'open' });
    expect(await act(d, 'aal2', { kind: 'tutorial-reply', id: SUGGESTION, done: 'posted' })).toMatchObject({ ok: false, status: 404 });
    expect(d.done).toEqual([`reply ${REQUEST} posted by ${VIEWER}`, `reply ${REQUEST} none by ${VIEWER}`, `reply ${REQUEST} open by ${VIEWER}`, `reply ${SUGGESTION} posted by ${VIEWER}`]);
    expect(d.rows).toEqual([
      { profileId: VIEWER, action: 'reply_posted', target: REQUEST, result: 'ok' }, { profileId: VIEWER, action: 'reply_none', target: REQUEST, result: 'ok' },
      { profileId: VIEWER, action: 'reply_open', target: REQUEST, result: 'ok' }, { profileId: VIEWER, action: 'reply_posted', target: SUGGESTION, result: 'refused', detail: 'not_found' }
    ]);
    // Not a Global Viewer on a verified session: nothing is written.
    const aal1 = deps();
    expect(await act(aal1, 'aal1', { kind: 'tutorial-reply', id: REQUEST, done: 'posted' })).toMatchObject({ ok: false, status: 403 });
    expect(aal1.done).toEqual([]);
  });

  it('accepts, edits or rejects a suggestion once, and records each', async () => {
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'tutorial-suggestion', id: SUGGESTION, decision: 'edit', detail: 'Say Done.' })).toEqual({ ok: true, result: 'edited' });
    expect(await act(d, 'aal2', { kind: 'tutorial-suggestion', id: SUGGESTION, decision: 'reject', reason: 'Not needed' })).toEqual({ ok: true, result: 'rejected' });
    expect(await act(d, 'aal2', { kind: 'tutorial-suggestion', id: ANSWERED, decision: 'accept' })).toMatchObject({ ok: false, status: 400 });
    expect(await act(d, 'aal2', { kind: 'tutorial-suggestion', id: REQUEST, decision: 'accept' })).toMatchObject({ ok: false, status: 404 });
    expect(d.done).toEqual([
      `edited ${SUGGESTION} Say Done. null by ${VIEWER}`, `rejected ${SUGGESTION} null Not needed by ${VIEWER}`,
      `accepted ${ANSWERED} null null by ${VIEWER}`, `accepted ${REQUEST} null null by ${VIEWER}`
    ]);
    expect(d.rows).toEqual([
      { profileId: VIEWER, action: 'suggestion_edited', target: SUGGESTION, result: 'ok', detail: 'script' },
      { profileId: VIEWER, action: 'suggestion_rejected', target: SUGGESTION, result: 'ok', detail: 'script' },
      { profileId: VIEWER, action: 'suggestion_accepted', target: ANSWERED, result: 'refused', detail: 'decided' },
      { profileId: VIEWER, action: 'suggestion_accepted', target: REQUEST, result: 'refused', detail: 'not_found' }
    ]);
  });

  it('files an accepted code change in Linear, and keeps it accepted when Linear has no key or fails', async () => {
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'tutorial-suggestion', id: CODE, decision: 'accept' })).toEqual({ ok: true, result: 'accepted:LAN-170' });
    expect(d.done).toEqual([`accepted ${CODE} null null by ${VIEWER}`, `file ${CODE}`]);
    expect(d.rows).toEqual([{ profileId: VIEWER, action: 'suggestion_accepted', target: CODE, result: 'ok', detail: 'LAN-170' }]);
    const e = deps({ fileSuggestion: async () => null });
    expect(await act(e, 'aal2', { kind: 'tutorial-suggestion', id: CODE, decision: 'accept' })).toEqual({ ok: true, result: 'accepted:waiting' });
    const { LinearError } = await import('../../../server/linear');
    const f = deps({ fileSuggestion: async () => { throw new LinearError('ratelimited'); } });
    expect(await act(f, 'aal2', { kind: 'tutorial-suggestion', id: CODE, decision: 'accept' })).toEqual({ ok: true, result: 'accepted:waiting' });
    expect(f.rows).toEqual([{ profileId: VIEWER, action: 'suggestion_accepted', target: CODE, result: 'ok', detail: 'linear_ratelimited' }]);
    // A script change never goes to Linear.
    const g = deps();
    expect(await act(g, 'aal2', { kind: 'tutorial-suggestion', id: SUGGESTION, decision: 'accept' })).toEqual({ ok: true, result: 'accepted' });
    expect(g.done).toEqual([`accepted ${SUGGESTION} null null by ${VIEWER}`]);
  });

  it('takes Fix it on a suggestion, files it in Linear when it has no issue yet, and says why it refuses', async () => {
    expect(parseAction({ kind: 'tutorial-fix', id: CODE.toUpperCase() })).toEqual({ kind: 'tutorial-fix', id: CODE, askFirst: false });
    expect(parseAction({ kind: 'tutorial-fix', id: CODE, askFirst: true })).toEqual({ kind: 'tutorial-fix', id: CODE, askFirst: true });
    expect(parseAction({ kind: 'tutorial-fix', id: CODE, askFirst: 'yes' })).toBeNull();
    expect(parseAction({ kind: 'tutorial-fix', id: 'x' })).toBeNull();
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'tutorial-fix', id: CODE, askFirst: true })).toEqual({ ok: true, result: 'fixing:LAN-170' });
    // A suggestion filed already (an instruction whose change to the video failed, filed at once) goes to no Linear call.
    expect(await act(d, 'aal2', { kind: 'tutorial-fix', id: SUGGESTION })).toEqual({ ok: true, result: 'fixing:LAN-171' });
    expect(await act(d, 'aal2', { kind: 'tutorial-fix', id: ANSWERED })).toMatchObject({ ok: false, status: 400, error: 'Someone asked for a fix in the app already.' });
    expect(await act(d, 'aal2', { kind: 'tutorial-fix', id: REQUEST })).toMatchObject({ ok: false, status: 404 });
    expect(d.done).toEqual([`fix ${CODE} by ${VIEWER} ask first`, `file ${CODE}`, `fix ${SUGGESTION} by ${VIEWER}`, `fix ${ANSWERED} by ${VIEWER}`, `fix ${REQUEST} by ${VIEWER}`]);
    expect(d.rows).toEqual([
      { profileId: VIEWER, action: 'suggestion_fix', target: CODE, result: 'ok', detail: 'LAN-170:ask_first' },
      { profileId: VIEWER, action: 'suggestion_fix', target: SUGGESTION, result: 'ok', detail: 'LAN-171' },
      { profileId: VIEWER, action: 'suggestion_fix', target: ANSWERED, result: 'refused', detail: 'already' },
      { profileId: VIEWER, action: 'suggestion_fix', target: REQUEST, result: 'refused', detail: 'not_found' }
    ]);
    // Without a Linear key the comments job files it at night; the instruction for the agent team waits until then.
    const e = deps({ fileSuggestion: async () => null });
    expect(await act(e, 'aal2', { kind: 'tutorial-fix', id: CODE })).toEqual({ ok: true, result: 'fixing:waiting' });
    expect(e.rows).toEqual([{ profileId: VIEWER, action: 'suggestion_fix', target: CODE, result: 'ok', detail: 'code' }]);
  });
});

describe('an issue closed from its card, and its state in Linear at once (docs/decisions/2026-11-24-close-an-issue-from-its-card.md)', () => {
  it('takes an issue and done or no fix needed, and at most 100 issues to read', () => {
    expect(parseAction({ kind: 'issue-close', issue: 'LAN-327', as: 'completed' })).toEqual({ kind: 'issue-close', issue: 'LAN-327', as: 'completed' });
    expect(parseAction({ kind: 'issue-close', issue: 'LAN-327', as: 'canceled' })).toEqual({ kind: 'issue-close', issue: 'LAN-327', as: 'canceled' });
    expect(parseAction({ kind: 'issue-states', issues: ['LAN-1', 'LAN-1', 'LAN-2'] })).toEqual({ kind: 'issue-states', issues: ['LAN-1', 'LAN-2'] });
    for (const bad of [{ kind: 'issue-close', issue: 'LAN-327', as: 'deleted' }, { kind: 'issue-close', issue: 'lan-327', as: 'completed' }, { kind: 'issue-states', issues: [] },
      { kind: 'issue-states', issues: ['LAN-1; drop'] }, { kind: 'issue-states', issues: Array.from({ length: 101 }, (_, i) => 'LAN-' + (i + 1)) }]) {
      expect(parseAction(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('closes the issue in Linear, keeps the close on the dashboard at once, and logs it', async () => {
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'issue-close', issue: 'LAN-327', as: 'completed' })).toEqual({ ok: true, result: 'Live' });
    expect(d.done).toEqual(['close LAN-327 completed', 'keep LAN-327:Live']);
    expect(d.rows).toEqual([{ profileId: VIEWER, action: 'issue_close', target: 'LAN-327', result: 'ok', detail: 'state:Live' }]);
    expect(await act(deps(), 'aal1', { kind: 'issue-close', issue: 'LAN-327', as: 'completed' })).toMatchObject({ ok: false, status: 403 });
  });

  it('says so when Linear is not set up, or refuses', async () => {
    expect(await act(deps({ closeIssue: async () => null }), 'aal2', { kind: 'issue-close', issue: 'LAN-327', as: 'canceled' }))
      .toMatchObject({ ok: false, status: 503, error: 'Linear is not set up here. Close it in Linear.' });
    const { LinearError } = await import('../../../server/linear');
    const d = deps({ closeIssue: async () => { throw new LinearError('not_found'); } });
    expect(await act(d, 'aal2', { kind: 'issue-close', issue: 'LAN-9999', as: 'canceled' })).toMatchObject({ ok: false, status: 502, error: 'It did not work (linear_not_found).' });
    expect(d.done).toEqual([]);
  });

  it('reads the open issues\' states and logs only a change', async () => {
    const d = deps();
    expect(await act(d, 'aal2', { kind: 'issue-states', issues: ['LAN-327'] })).toEqual({ ok: true, result: 'changed:1' });
    expect(d.rows).toEqual([{ profileId: VIEWER, action: 'issue_states', target: '1 issues', result: 'ok', detail: 'changed:1' }]);
    const same = deps({ keepIssueStates: async () => 0 });
    expect(await act(same, 'aal2', { kind: 'issue-states', issues: ['LAN-327'] })).toEqual({ ok: true, result: 'changed:0' });
    expect(same.rows).toEqual([]);
    expect(await act(deps({ issueStates: async () => null }), 'aal2', { kind: 'issue-states', issues: ['LAN-327'] })).toEqual({ ok: true, result: 'not_set_up' });
  });
});
