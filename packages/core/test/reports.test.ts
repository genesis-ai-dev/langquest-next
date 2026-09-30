import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { HlcClock } from '../src/hlc';
import { commands } from '../src/commands';
import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import { derivePassage } from '../src/passage';
import { laneReport, laneReports, paceOf, recencyOf, REPORT_WEEKS, weekStartOf } from '../src/reports';
import { SCOPE_VERSES } from '../src/coverage';
import { buildFixture, buildRecordFixture, buildStep11Fixture, shuffle } from './fixtures';

/**
 * The web dashboard's per-language report. It must say what the passage
 * record says (the phone's Status screen reads the same derivations), and
 * like every derivation it must not depend on the order events arrived in.
 */

const DAY = 86_400_000;

function project() {
  const events: AnyEvent[] = [];
  let wall = Date.UTC(2026, 8, 1);
  let seq = 0;
  const clocks = new Map<string, HlcClock>();
  const emit = <T extends EventType>(actorId: string, type: T, payload: EventPayloads[T]) => {
    const clock = clocks.get(actorId) ?? new HlcClock(actorId, () => wall);
    clocks.set(actorId, clock);
    wall += 1000;
    seq += 1;
    events.push({ id: `x${seq}`, type, orgId: 'o', projectId: 'p', actorId, deviceId: actorId, hlc: clock.next(), payload } as AnyEvent);
  };
  const state = () => fold(events, emptyState());
  const run = (actorId: string, build: (c: ReturnType<typeof commands>) => { type: EventType; payload: unknown }[]) => {
    for (const spec of build(commands(state()))) emit(actorId, spec.type, spec.payload as never);
  };
  emit('lead', 'v1.MemberAdded', { profileId: 'lead', role: 'owner' });
  emit('lead', 'v1.MemberAdded', { profileId: 'akol', role: 'translator' });
  emit('lead', 'v1.MemberAdded', { profileId: 'ayen', role: 'reviewer' });
  emit('lead', 'v1.LaneAdded', { laneId: 'din', languoidId: 'din' });
  emit('lead', 'v1.LaneNamed', { laneId: 'din', name: 'Dinka' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john', parentUnitId: null, kind: 'book', label: 'John', order: 'b' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john3', parentUnitId: 'john', kind: 'passage', label: 'John 3:1-21', order: 'b1' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john4', parentUnitId: 'john', kind: 'passage', label: 'John 4:1-42', order: 'b2' });
  emit('lead', 'v1.UnitAdded', { unitId: 'luke', parentUnitId: null, kind: 'book', label: 'Luke', order: 'a' });
  emit('lead', 'v1.UnitAdded', { unitId: 'luke15', parentUnitId: 'luke', kind: 'passage', label: 'Luke 15:11-32', order: 'a1' });
  run('lead', (c) => c.useFlow({ commandId: 'flow', laneId: 'din', flowId: 'standard_bible' }));
  return {
    emit, run, state, events,
    at: (ms: number) => { wall = ms; },
    now: () => wall
  };
}

const publish = (p: ReturnType<typeof project>, unitId: string, cards: string[]) =>
  p.run('akol', (c) => c.publishVersion({ commandId: `v:${unitId}:${cards.join('')}`, unitId, laneId: 'din', cardHashes: cards }));

describe('language report', () => {
  it('counts each passage once, by where its record stands', () => {
    const p = project();
    publish(p, 'john3', ['c1']);
    const r = laneReport(p.state(), 'din', p.now());
    expect(r.name).toBe('Dinka');
    expect(r.flowName).toBe('Standard Bible Flow');
    expect(r.work).toEqual({ not_started: 2, drafting: 0, in_review: 1, feedback: 0, done: 0 });
    expect(r.progress.total).toBe(3);
    expect(r.progress.recorded).toBe(1);
  });

  it('names the step most recorded passages wait at, earliest step on a tie', () => {
    const p = project();
    publish(p, 'john3', ['c1']);
    publish(p, 'luke15', ['c2']);
    const r = laneReport(p.state(), 'din', p.now());
    expect(r.stages.map((s) => s.passages)).toEqual([2, 0, 0, 0]);
    expect(r.stages[2]?.checkpoint).toBe(true);
    expect(r.bottleneck).toBe('2 in Peer Review + Back Translation');
  });

  it('feedback nobody answered is its own bucket and needs attention', () => {
    const p = project();
    publish(p, 'john3', ['c1']);
    const takeId = derivePassage(p.state(), 'john3', 'din').latest!.takeId;
    p.run('ayen', (c) => c.recordReview({ commandId: 'rv', takeIds: [takeId], kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Verse 3 is unclear.' }));
    const r = laneReport(p.state(), 'din', p.now());
    expect(r.work.feedback).toBe(1);
    expect(r.work.in_review).toBe(0);
    expect(r.attention.feedback).toBe(1);
  });

  it('a request is overdue only when its due date is before the report day', () => {
    const p = project();
    publish(p, 'john3', ['c1']);
    p.run('lead', (c) => c.ask({ commandId: 'late', unitId: 'john3', laneId: 'din', what: 'review', kindId: 'community', profileId: 'ayen', dueDate: '2026-08-15' }));
    p.run('lead', (c) => c.ask({ commandId: 'soon', unitId: 'john4', laneId: 'din', what: 'record', profileId: 'akol', dueDate: '2026-12-01' }));
    const r = laneReport(p.state(), 'din', Date.UTC(2026, 8, 2));
    expect(r.attention.openRequests).toBe(2);
    expect(r.attention.overdueRequests).toBe(1);
  });

  it('with no review steps a recorded passage is done and nothing is a bottleneck', () => {
    const p = project();
    p.run('lead', (c) => c.useFlow({ commandId: 'collect', laneId: 'din', flowId: 'collect_only' }));
    publish(p, 'john3', ['c1']);
    const r = laneReport(p.state(), 'din', p.now());
    expect(r.work.done).toBe(1);
    expect(r.stages).toEqual([]);
    expect(r.bottleneck).toBeNull();
  });

  it('groups passages by book in canon order', () => {
    const p = project();
    publish(p, 'john3', ['c1']);
    const r = laneReport(p.state(), 'din', p.now());
    expect(r.books.map((b) => [b.label, b.total, b.recorded, b.done])).toEqual([['Luke', 1, 0, 0], ['John', 2, 1, 0]]);
  });

  it('buckets activity into Monday-starting weeks and drops what is older than the window', () => {
    const p = project();
    const now = Date.UTC(2026, 8, 30, 12);
    p.at(now - 7 * DAY * REPORT_WEEKS - DAY);
    publish(p, 'luke15', ['old']);
    p.at(Date.UTC(2026, 8, 27, 23));
    publish(p, 'john3', ['sun']);
    p.at(Date.UTC(2026, 8, 28, 1));
    publish(p, 'john4', ['mon']);
    const r = laneReport(p.state(), 'din', now);
    expect(r.activity).toHaveLength(REPORT_WEEKS);
    expect(r.activity.at(-1)).toEqual({ weekStart: '2026-09-28', cards: 0, versions: 1, reviews: 0, requests: 0 });
    expect(r.activity.at(-2)).toMatchObject({ weekStart: '2026-09-21', versions: 1 });
    expect(r.activity.reduce((n, w) => n + w.versions, 0)).toBe(2);
    expect(r.lastActivity?.slice(0, 16)).toBe('2026-09-28T01:00');
  });

  it('a language with no passages reports zeros, not errors', () => {
    const events: AnyEvent[] = [{ id: 'l', type: 'v1.LaneAdded', orgId: 'o', projectId: 'p', actorId: 'a', deviceId: 'a', hlc: '001790000000000:000000:a', payload: { laneId: 'nus', languoidId: 'nus' } } as AnyEvent];
    const r = laneReport(fold(events, emptyState()), 'nus', Date.UTC(2026, 8, 30));
    expect(r.name).toBe('NUS');
    expect(r.progress.total).toBe(0);
    expect(r.books).toEqual([]);
    expect(r.bottleneck).toBeNull();
    expect(r.lastActivity).toBeNull();
  });

  it('any permutation of the log gives the same reports', () => {
    const events = [...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture()];
    const now = Date.UTC(2026, 8, 30);
    const canonical = laneReports(fold(events, emptyState()), now);
    expect(canonical.length).toBeGreaterThan(0);
    for (let seed = 1; seed <= 50; seed++) {
      expect(laneReports(fold(shuffle(events, seed), emptyState()), now)).toEqual(canonical);
    }
  });
});

describe('coverage, uploads and the ledger', () => {
  const card = (hash: string) => ({ hash, durationMs: 4000 });
  const record = (p: ReturnType<typeof project>, unitId: string, hash: string) =>
    p.run('akol', (c) => c.addRecording({ commandId: `rec:${hash}`, unitId, laneId: 'din', recordingId: `r:${hash}`, kind: 'target', card: card(hash) }));
  const stored = (p: ReturnType<typeof project>, hash: string) => p.emit('server', 'v1.BlobStored', { hash, size: 100 });

  it('weights coverage by verses of the canon, recorded and done separately', () => {
    const p = project();
    publish(p, 'john3', ['c1']);
    const r = laneReport(p.state(), 'din', p.now());
    expect(r.coverage.recorded.gospels).toBe(Math.round((1000 * 21) / SCOPE_VERSES.gospels) / 10);
    expect(r.coverage.recorded.nt).toBe(Math.round((1000 * 21) / SCOPE_VERSES.nt) / 10);
    expect(r.coverage.recorded.ot).toBe(0);
    expect(r.coverage.done.gospels).toBe(0);
    p.run('lead', (c) => c.useFlow({ commandId: 'collect', laneId: 'din', flowId: 'collect_only' }));
    expect(laneReport(p.state(), 'din', p.now()).coverage.done.gospels).toBe(r.coverage.recorded.gospels);
  });

  it('dates a milestone by the version that crossed it', () => {
    const p = project();
    p.emit('lead', 'v1.UnitAdded', { unitId: 'mark', parentUnitId: null, kind: 'passage', label: 'Mark 1-16', order: 'c1' });
    p.emit('lead', 'v1.UnitAdded', { unitId: 'johnAll', parentUnitId: null, kind: 'passage', label: 'John 1-21', order: 'c2' });
    publish(p, 'mark', ['m']);
    expect(laneReport(p.state(), 'din', p.now()).milestones).toEqual([]);
    p.at(Date.UTC(2026, 8, 20));
    publish(p, 'johnAll', ['j']);
    const r = laneReport(p.state(), 'din', p.now());
    expect(r.milestones.map((m) => [m.scope, m.threshold, m.at.slice(0, 10)])).toEqual([['gospels', 25, '2026-09-20']]);
    expect(r.coverage.weekly.at(-1)!.recorded.gospels).toBe(r.coverage.recorded.gospels);
    expect(r.coverage.weekly[0]!.recorded.gospels).toBe(0);
  });

  it('times uploads by the server confirmation and counts each chapter once, in its first month', () => {
    const p = project();
    p.emit('lead', 'v1.UnitAdded', { unitId: 'john3b', parentUnitId: 'john', kind: 'passage', label: 'John 3:22-36', order: 'b3' });
    p.at(Date.UTC(2026, 7, 30));
    record(p, 'john3', 'h1');
    p.at(Date.UTC(2026, 8, 2, 9));
    stored(p, 'h1');
    record(p, 'john3b', 'h2');
    stored(p, 'h2');
    const r = laneReport(p.state(), 'din', Date.UTC(2026, 8, 3));
    expect(r.uploads.cards).toBe(2);
    expect(r.uploads.chapters).toBe(1);
    expect(r.uploads.lastAt?.slice(0, 10)).toBe('2026-09-02');
    expect(r.uploads.daily.find((d) => d.day === '2026-09-02')).toEqual({ day: '2026-09-02', cards: 2, chapters: 1 });
    expect(r.ledger.at(-1)).toEqual({ month: '2026-09', chapters: 1, books: [{ bookId: 'joh', label: 'John', chapters: 1 }] });
    expect(r.ledger.at(-2)).toMatchObject({ month: '2026-08', chapters: 0 });
    expect(r.uploads.log.map((e) => [e.label, e.cards, e.verses])).toEqual([['John 3:22-36', 1, 15], ['John 3:1-21', 1, 21]]);
    expect(r.activity.at(-1)!.cards).toBe(2);
  });

  it('raises audio recorded weeks ago that never reached the server', () => {
    const p = project();
    const now = Date.UTC(2026, 8, 30);
    p.at(now - 20 * DAY);
    record(p, 'john3', 'old');
    p.at(now - 3 * DAY);
    record(p, 'john4', 'new');
    const r = laneReport(p.state(), 'din', now);
    expect(r.alerts).toMatchObject({ stuckCards: 1, stuckPassages: 1, invalidCards: 0 });
    expect(r.alerts.stuckSince?.slice(0, 10)).toBe('2026-09-10');
  });

  it('carries the country and target an admin set', () => {
    const p = project();
    p.emit('lead', 'v1.LaneCountrySet', { laneId: 'din', country: 'SS' });
    p.emit('lead', 'v1.LaneTargetSet', { laneId: 'din', scope: 'nt', startDate: '2026-01-01', targetDate: '2027-07-01' });
    const r = laneReport(p.state(), 'din', p.now());
    expect(r.country).toBe('SS');
    expect(r.target).toEqual({ scope: 'nt', startDate: '2026-01-01', targetDate: '2027-07-01' });
  });
});

describe('reading a report at a moment', () => {
  const base = () => laneReport(project().state(), 'din', Date.UTC(2026, 8, 30));
  const now = Date.UTC(2026, 8, 30);

  it('bands a language by days since its last upload', () => {
    const r = base();
    const at = (days: number) => ({ ...r, uploads: { ...r.uploads, lastAt: new Date(now - days * DAY).toISOString() } });
    expect(recencyOf(r, now)).toEqual({ band: 'not_started', days: null });
    expect(recencyOf(at(0), now).band).toBe('active');
    expect(recencyOf(at(13), now).band).toBe('active');
    expect(recencyOf(at(14), now).band).toBe('check_in');
    expect(recencyOf(at(27), now).band).toBe('reminder');
    expect(recencyOf(at(30), now).band).toBe('four_weeks');
    expect(recencyOf(at(40), now).band).toBe('five_weeks');
    expect(recencyOf(at(45), now).band).toBe('inactive');
  });

  it('measures pace against a straight line to the target, and tells behind from stalled by the recent rate', () => {
    const r = base();
    const withCoverage = (now8: number, nowPct: number) => {
      const weekly = r.coverage.weekly.map((w, i, all) => ({ ...w, recorded: { ...w.recorded, nt: i === all.length - 1 ? nowPct : i >= all.length - 9 ? now8 : 0 } }));
      return { ...r, target: { scope: 'nt' as const, startDate: '2026-01-01', targetDate: '2027-01-01' }, coverage: { ...r.coverage, recorded: { ...r.coverage.recorded, nt: nowPct }, weekly } };
    };
    expect(paceOf(r, now)).toBeNull();
    const halfway = Date.UTC(2026, 6, 2, 12);
    expect(paceOf(withCoverage(40, 50), halfway)).toMatchObject({ band: 'on_pace', expected: 50, gap: 0 });
    expect(paceOf(withCoverage(60, 70), halfway)?.band).toBe('ahead');
    // 25 points in eight weeks finishes the remaining 70 by early December: behind, but catching up.
    expect(paceOf(withCoverage(5, 30), halfway)?.band).toBe('behind');
    // 20 points in eight weeks lands after the target date.
    expect(paceOf(withCoverage(10, 30), halfway)?.band).toBe('stalled');
    expect(paceOf(withCoverage(30, 30), halfway)).toMatchObject({ band: 'stalled', projectedFinish: null });
    expect(paceOf(withCoverage(90, 100), halfway)?.band).toBe('complete');
  });
});

describe('weekStartOf', () => {
  it('is the Monday at or before the day, in UTC', () => {
    expect(weekStartOf(Date.UTC(2026, 8, 28))).toBe(Date.UTC(2026, 8, 28));
    expect(weekStartOf(Date.UTC(2026, 8, 30, 18))).toBe(Date.UTC(2026, 8, 28));
    expect(weekStartOf(Date.UTC(2026, 9, 4, 23, 59))).toBe(Date.UTC(2026, 8, 28));
  });
});
