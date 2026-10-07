import { signals, type InstallSummary, type LanguageHealth } from './diagSignals';

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
});
