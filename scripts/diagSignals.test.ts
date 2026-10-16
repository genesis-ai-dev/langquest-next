import { jobSignals, signals, type InstallSummary, type JobStat, type LanguageHealth } from './diagSignals';

// The hypotheses a report leads with. Each case is a cause we expect to
// meet in the field, stated as the numbers it leaves behind.

const health = (over: Partial<LanguageHealth> = {}): LanguageHealth => ({
  events: { events: 500, maxSeq: 500, events7d: 10, lastEventAt: null },
  reducerVersion: 6,
  snapshots: [{ reducerVersion: 6, seq: 450, createdAt: '', tail: 50, bytes: 1000 }],
  blobs: { count: 0, bytes: 0, maxBytes: 0 },
  roles: {},
  ...over
});

const install = (over: Partial<InstallSummary> = {}): InstallSummary => ({
  profileId: 't1', context: {}, lastSeen: '', clockAheadS: 0,
  sync: null, transfer: null, load: null, snapshots: null, device: null, errors: null, releases: null,
  ...over
});

const texts = (sum: Record<string, InstallSummary>, h = health()) => signals(h, [], sum, []).map((s) => `${s.level}: ${s.text}`);

describe('diagnostic signals', () => {
  it('a healthy language and phone say nothing', () => {
    expect(texts({ a: install({ transfer: { down: { count: 10, bytes: 10e6, ms: 50_000, fetchMs: 40_000, verifyMs: 5_000 } } }) })).toEqual([]);
  });

  it('blames a missing snapshot when a cold phone must fold the whole log', () => {
    const t = texts({}, health({ events: { events: 90_000, maxSeq: 90_000, events7d: 0, lastEventAt: null }, snapshots: [] }));
    expect(t[0]).toMatch(/^problem: No snapshot for reducer 6: a new phone folds all 90000 events/);
  });

  it('tells a slow link from a slow phone', () => {
    const link = texts({ a: install({ transfer: { down: { count: 5, bytes: 500_000, ms: 60_000, fetchMs: 55_000, verifyMs: 1_000 } } }) });
    expect(link.join('\n')).toMatch(/slow link/);
    expect(link.join('\n')).not.toMatch(/the phone, not the link/);
    const phone = texts({ a: install({ transfer: { down: { count: 5, bytes: 50e6, ms: 60_000, fetchMs: 20_000, verifyMs: 40_000 } } }) });
    expect(phone.join('\n')).toMatch(/the phone, not the link, is the bottleneck/);
    expect(phone.join('\n')).not.toMatch(/slow link/);
  });

  it('calls a sync phone-bound when folding outweighs the network', () => {
    const t = texts({ a: install({ sync: { count: 3, p50Ms: 20_000, p95Ms: 40_000, pushNetMs: 0, pullNetMs: 5_000, applyMs: 50_000, pages: 20, pulled: 10_000, maxPending: 0, maxOfflineMs: null, outcomes: { ok: 3 } } }) });
    expect(t.join('\n')).toMatch(/phone-bound/);
  });

  it('reports failures by cause, and low disk and a fast clock', () => {
    const t = texts({ a: install({
      transfer: { down: { count: 10, bytes: 1e6, ms: 1000, fetchMs: 900, failOffline: 4, failHash: 1 } },
      device: { freeDiskMb: 120, at: '' },
      clockAheadS: 3600
    }) });
    expect(t).toContain('problem: 5 of 10 downloads failed: 4 link dropped, 1 hash mismatch.');
    expect(t).toContain('problem: Only 120 MB free on the phone.');
    expect(t.join('\n')).toMatch(/60 min ahead/);
  });

  it('names members whose phones have never reported', () => {
    const s = signals(health(), [{ profile_id: 't9', roles: 'translator', devices: null, last_event_at: null, installs: null, last_diag_at: null }], {}, []);
    expect(s[0]?.text).toMatch(/Member t9 \(translator\) has never delivered diagnostics/);
  });

  it('tells a sign-in that cannot renew from a phone with no signal, and names an error by its code', () => {
    // Why: a captive portal or a rate limit once read as days offline, and every error read "Error".
    const t = texts({ a: install({ sync: {
      count: 5, p50Ms: 1000, p95Ms: 2000, pushNetMs: 0, pullNetMs: 0, applyMs: 0, pages: 1, pulled: 0, maxPending: 0, maxOfflineMs: null,
      outcomes: { unrenewed: 3, error: 2 }, errorCodes: { 'pull:57014': 2 }
    } }) });
    expect(t.join('\n')).toMatch(/3 syncs ended unable to renew the sign-in/);
    expect(t).toContain('problem: 2 syncs ended with an unexpected error (pull:57014 ×2).');
  });

  it("gives the Worker's refusals their meaning", () => {
    // Why: a file too large to upload is retried forever; "4xx" hid it.
    const t = texts({ a: install({ transfer: { up: { count: 4, bytes: 0, ms: 100, failTooLarge: 3, failGone: 1 } } }) });
    expect(t).toContain('problem: 4 of 4 uploads failed: 3 too large to upload (413), 1 gone from the device.');
    expect(t.join('\n')).toMatch(/too large for the server to take/);
    expect(t.join('\n')).toMatch(/1 upload found the recording gone from the device/);
  });

  it("reports transfers beside the language's own lists by source", () => {
    const t = texts({ a: install({ otherTransfer: { 'source:down': { count: 10, bytes: 1, failNotFound: 6 } } }) });
    expect(t).toContain('problem: 6 of 10 source audio downloads failed: 6 not on the server (404).');
  });

  it('flags lost files, stuck recordings and a full diagnostics queue', () => {
    const t = texts({ a: install({
      device: { at: '', lostFiles: 3, lostRecordings: 1, oldestUnsentMin: 3 * 24 * 60, uploadsWaiting: 7 },
      diagDropped: 250
    }) });
    expect(t.join('\n')).toMatch(/lost 3 files behind the app's back, 1 of them recordings never sent/);
    expect(t.join('\n')).toMatch(/A recording has waited 3 days to upload \(7 waiting\)/);
    expect(t.join('\n')).toMatch(/250 diagnostics records were dropped/);
  });

  it('reads recording trouble off the audio tally', () => {
    const t = texts({ a: install({ audio: { takes: 10, tooShort: 8, micRefused: 2, saveFail: 1, encodeFail: 1, wavKept: 1 } }) });
    expect(t).toContain('problem: The microphone was refused 2 times: permission is off for the app.');
    expect(t.join('\n')).toMatch(/Recording failed 1 time \(0 start, 0 stop, 1 save\) against 10 takes/);
    expect(t.join('\n')).toMatch(/8 takes were too short to keep/);
  });

  it('reads sign-in, invites and hand-over off the auth records', () => {
    const t = texts({ a: install({ auth: [
      { op: 'ended', outcome: 'refused', code: 'refresh_token_already_used', action: null, count: 1, lastAt: 'T', maxMs: null, last: { pending: 12 } },
      { op: 'redeem', outcome: 'refused', code: '42501', action: null, count: 40, lastAt: 'T', maxMs: null, last: { attempt: 40 } },
      { op: 'courier', outcome: 'gone', code: null, action: null, count: 1, lastAt: 'T', maxMs: null, last: { eventsLeft: 5, uploadsLeft: 2 } },
      { op: 'org_list', outcome: 'server', code: 'http503', action: null, count: 2, lastAt: 'T', maxMs: null, last: null }
    ] }) });
    expect(t).toContain('problem: Signed out by the server (refresh_token_already_used) once, last T, with 12 events not yet sent.');
    expect(t).toContain('problem: Joining by invite ended "refused" (42501) 40 times (attempt 40).');
    expect(t.join('\n')).toMatch(/could not be handed over \("gone"\) once: 5 events and 2 uploads waiting/);
    expect(t.join('\n')).toMatch(/organizations could not be fetched \(http503\) 2 times/);
  });

  it("notices a member's phone that syncs the organization but never opened the language", () => {
    const t = texts({ a: install({ orgSync: { count: 4, p95Ms: 1000, applyMs: 10, pulled: 3, outcomes: { ok: 4 }, lastAt: 'T' } }) });
    expect(t.join('\n')).toMatch(/synced the organization \(4 times, last T\) but recorded nothing about this language/);
  });

  it('says when an update made the phone drop its checkpoint', () => {
    const t = texts({ a: install({ load: { count: 1, p50Ms: 10, p95Ms: 10, maxEvents: 5, staleCheckpoints: 1 } }) });
    expect(t.join('\n')).toMatch(/dropped its checkpoint 1 time and fetched the stream again/);
  });

  it('runs without a language, for the organization report', () => {
    expect(signals(null, [], { a: install({ errors: [{ name: 'TypeError', where: 'x', code: null, count: 1, lastErrorId: 'E-1', lastAt: 'T' }] }) }, [])
      .map((s) => s.text)).toEqual(['1× TypeError at "x" (latest E-1, T).']);
  });

  it("reads the server's own jobs: one that stopped, one that keeps failing, pushes that do not go", () => {
    // Why: the projection passes, push delivery and the import ran where support could not see them.
    const job = (over: Partial<JobStat>): JobStat => ({
      job: 'projection', every: '00:05:00', runs: 100, failures: 0, partials: 0, streak: 0, last_at: 'T', last_outcome: 'ok',
      last_error_class: null, last_ok_at: 'T', p95_ms: 1000, totals: null, orgs: 1, stale: false, ...over
    });
    const t = jobSignals([
      job({}),
      job({ job: 'projection_large', stale: true, last_ok_at: 'T0', last_outcome: 'error', last_error_class: '57014' }),
      job({ job: 'v2_import', streak: 4, failures: 4, last_error_class: 'TypeError' }),
      job({ job: 'push_delivery', totals: { claimed: 40, sent: 5, noToken: 30, failed: 5 } })
    ]).map((s) => `${s.level}: ${s.text}`);
    expect(t).toHaveLength(3);
    expect(t[0]).toMatch(/^problem: Server job projection_large has not run successfully since T0 .* \(57014\)/);
    expect(t[1]).toBe('problem: Server job v2_import failed its last 4 runs (TypeError).');
    expect(t[2]).toBe('watch: Push delivery sent 5 of 40 notifications it claimed (30 with no push token, 5 failed).');
  });
});
