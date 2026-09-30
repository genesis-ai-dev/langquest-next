import { encodeHlc, REDUCER_VERSION, SEED_ROLES, takeSnapshot, type AnyEvent } from '@langquest-next/core';
import { handleApi, type ApiDeps } from '../worker/api';
import { OrgFolder, type Source } from '../worker/orgFolder';

/**
 * The dashboard's server (decision 44): who gets which languages, and how
 * the per-organization state catches up. Driven by an in-memory log, so no
 * Cloudflare or Supabase is needed.
 */

const ORG = 'org1';

class FakeLog implements Source {
  readonly partitions = new Map<string, AnyEvent[]>();
  readonly snapshots = new Map<string, string>();
  readonly pulls: { projectId: string; after: number }[] = [];
  private seq = 0;

  add(projectId: string, type: string, payload: unknown, id = `e${this.seq + 1}`): string {
    const list = this.partitions.get(projectId) ?? [];
    this.seq += 1;
    list.push({ id, type, orgId: ORG, projectId, actorId: 'admin', deviceId: 'd', hlc: encodeHlc(1_790_000_000_000 + this.seq, 0, 'd'), payload, serverSeq: list.length + 1 } as AnyEvent);
    this.partitions.set(projectId, list);
    return id;
  }

  /** What the projection worker would have stored for the partition as it stands. */
  snapshot(projectId: string) {
    this.snapshots.set(projectId, JSON.stringify(takeSnapshot(ORG, projectId, this.partitions.get(projectId) ?? [])));
  }

  async pull(orgId: string, projectId: string, after: number, limit: number) {
    this.pulls.push({ projectId, after });
    await Promise.resolve();
    return (this.partitions.get(projectId) ?? []).filter((e) => orgId === ORG && e.serverSeq! > after).slice(0, limit);
  }

  async snapshotMeta(_org: string, projectId: string, reducerVersion: number) {
    const s = this.snapshots.get(projectId);
    if (!s || reducerVersion !== REDUCER_VERSION) return null;
    return { serverSeq: (JSON.parse(s) as { serverSeq: number }).serverSeq, chunks: 1, bytes: s.length };
  }

  async snapshotChunk(_org: string, projectId: string) {
    const s = this.snapshots.get(projectId);
    return s ? JSON.stringify((JSON.parse(s) as { state: unknown }).state) : null;
  }
}

function orgLog(): FakeLog {
  const log = new FakeLog();
  log.add('_org', 'v1.OrgCreated', { name: 'Org' });
  for (const r of SEED_ROLES) log.add('_org', 'v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
  log.add('_org', 'v1.ProjectRegistered', { projectId: 'din', name: 'Dinka' });
  log.add('_org', 'v1.ProjectRegistered', { projectId: 'nus', name: 'Nuer' });
  log.add('_org', 'v1.OrgMemberAdded', { profileId: 'admin', roleId: 'org_admin', scope: { level: 'org' } });
  log.add('_org', 'v1.OrgMemberAdded', { profileId: 'dinka', roleId: 'viewer', scope: { level: 'lane', projectId: 'din', laneId: 'din' } });
  log.add('din', 'v1.LaneAdded', { laneId: 'din', languoidId: 'din' });
  log.add('nus', 'v1.LaneAdded', { laneId: 'nus', languoidId: 'nus' });
  log.add('nus', 'v1.MemberAdded', { profileId: 'old', role: 'translator' });
  return log;
}

const lanes = (out: { rows: { laneId: string }[] }) => out.rows.map((r) => r.laneId);

describe('OrgFolder', () => {
  it('gives each person only the languages they may view', async () => {
    const folder = new OrgFolder(orgLog(), ORG);
    expect(lanes(await folder.reportsFor('admin'))).toEqual(['din', 'nus']);
    expect(lanes(await folder.reportsFor('dinka'))).toEqual(['din']);
    // Joined the partition the older way, with no org membership.
    expect(lanes(await folder.reportsFor('old'))).toEqual(['nus']);
    expect(lanes(await folder.reportsFor('stranger'))).toEqual([]);
    expect(folder.knows('stranger')).toBe(false);
    expect(folder.knows('old')).toBe(true);
  });

  it('starts a partition from its server snapshot and pulls only what came after', async () => {
    const log = orgLog();
    log.snapshot('din');
    log.add('din', 'v1.LaneNamed', { laneId: 'din', name: 'Thuɔŋjäŋ' });
    const out = await new OrgFolder(log, ORG).reportsFor('admin');
    expect(log.pulls.filter((p) => p.projectId === 'din')).toEqual([{ projectId: 'din', after: 1 }]);
    expect(out.rows.find((r) => r.laneId === 'din')?.report.name).toBe('Thuɔŋjäŋ');
  });

  it('answers from memory for a minute, then catches up from its cursor', async () => {
    let now = Date.UTC(2026, 8, 30, 12);
    const log = orgLog();
    const folder = new OrgFolder(log, ORG, () => now);
    const first = await folder.reportsFor('admin');
    const pulled = log.pulls.length;
    log.add('din', 'v1.LaneNamed', { laneId: 'din', name: 'Renamed' });
    now += 30_000;
    expect((await folder.reportsFor('admin')).rows[0]!.report.name).toBe('DIN');
    expect(log.pulls.length).toBe(pulled);
    now += 31_000;
    const later = await folder.reportsFor('admin');
    expect(later.rows[0]!.report.name).toBe('Renamed');
    expect(log.pulls.slice(pulled).find((p) => p.projectId === 'din')).toEqual({ projectId: 'din', after: 1 });
    expect(Date.parse(later.asOf) - Date.parse(first.asOf)).toBe(61_000);
  });

  it('shares one pass among requests that arrive together', async () => {
    const log = orgLog();
    const folder = new OrgFolder(log, ORG);
    await Promise.all([folder.reportsFor('admin'), folder.reportsFor('dinka'), folder.reportsFor('old')]);
    expect(log.pulls.filter((p) => p.projectId === '_org')).toHaveLength(1);
  });

  it('a fresh request during a pass waits for one that starts after it, so a save just made is in it', async () => {
    const log = orgLog();
    const folder = new OrgFolder(log, ORG);
    const running = folder.reportsFor('admin');
    log.add('din', 'v1.LaneNamed', { laneId: 'din', name: 'Saved just now' });
    const [a, b] = await Promise.all([folder.reportsFor('admin', true), folder.reportsFor('dinka', true), running]);
    expect(a.rows[0]!.report.name).toBe('Saved just now');
    expect(b.rows[0]!.report.name).toBe('Saved just now');
    expect(log.pulls.filter((p) => p.projectId === '_org')).toHaveLength(2);
  });

  it('refolds a partition when a redaction targets something already folded', async () => {
    const log = orgLog();
    const folder = new OrgFolder(log, ORG);
    const named = log.add('din', 'v1.LaneNamed', { laneId: 'din', name: 'Mistake' });
    expect((await folder.reportsFor('admin')).rows[0]!.report.name).toBe('Mistake');
    log.add('din', 'v1.Redacted', { eventId: named });
    expect((await folder.reportsFor('admin', true)).rows[0]!.report.name).toBe('DIN');
    expect(log.pulls.filter((p) => p.projectId === 'din').map((p) => p.after)).toEqual([0, 2, 0]);
  });
});

describe('the reports API', () => {
  const body = { rows: [], asOf: '2026-09-30T12:00:00.000Z' };
  const deps = (over: Partial<ApiDeps> = {}): ApiDeps & { calls: unknown[][] } => {
    const calls: unknown[][] = [];
    return {
      calls,
      profileOf: async (token) => (token === 'good' ? 'p1' : null),
      reports: async (...args) => { calls.push(args); return body; },
      ...over
    };
  };
  const get = (path: string, token?: string, method = 'GET') =>
    new Request(`https://dash.example${path}`, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });

  it('answers a member with their rows, never cached, and passes fresh on', async () => {
    const d = deps();
    const res = await handleApi(get('/api/orgs/org%201/reports?fresh=1', 'good'), d);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual(body);
    expect(d.calls).toEqual([['org 1', 'p1', true]]);
  });

  it('refuses a missing or bad token before touching the organization', async () => {
    const d = deps();
    expect((await handleApi(get('/api/orgs/o/reports'), d)).status).toBe(401);
    expect((await handleApi(get('/api/orgs/o/reports', 'forged'), d)).status).toBe(401);
    expect(d.calls).toEqual([]);
  });

  it('tells a stranger no, and a failure apart from a refusal', async () => {
    expect((await handleApi(get('/api/orgs/o/reports', 'good'), deps({ reports: async () => null }))).status).toBe(403);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect((await handleApi(get('/api/orgs/o/reports', 'good'), deps({ reports: async () => { throw new Error('down'); } }))).status).toBe(502);
    err.mockRestore();
  });

  it('knows only its one route and method', async () => {
    expect((await handleApi(get('/api/orgs/o/other', 'good'), deps())).status).toBe(404);
    expect((await handleApi(get('/api/orgs/o/reports', 'good', 'POST'), deps())).status).toBe(405);
    expect((await handleApi(get('/api/orgs/%E0%A4%A/reports', 'good'), deps())).status).toBe(400);
  });
});
