import { DatabaseSync } from 'node:sqlite';
import {
  encodeHlc, foldOrg, privilegeAllows, privilegeFor, privilegesFor, SEED_ROLES, writtenPartId, type AnyEvent
} from '@langquest-next/core';
import type { AppendResult } from '@langquest-next/sync';
import { handleAgentApi, type AgentDeps, type OrgStub } from '../worker/agent/http';
import { AgentOrg } from '../worker/agent/org';
import type { AgentStore, DeviceGrant, NewToken, NewWebhook, TokenRecord, WebhookRecord } from '../worker/agent/store';
import { WebhookDispatcher } from '../worker/agent/dispatch';
import type { JobRun } from '../../../server/jobRuns';
import { RETRY_AT_MS, signature } from '../worker/agent/webhooks';
import { referenceOf } from '../worker/agent/view';
import { hashSecret } from '../worker/agent/tokens';
import type { ReviewLink } from '../worker/agent/view';
import { sniffVoiceNote } from '../worker/agent/voice';
import { MemoryCache, OrgFolder, type Source } from '../worker/orgFolder';
import { check, compileAll, openApiProblems, uncovered } from './openapiCheck';

/**
 * The access-token API (decision 70). What matters most: a token never sees
 * or does more than its person can, a listening app given read:published
 * never receives a translation that is not approved, and what it writes
 * lands in the log as ordinary reviews the team sees.
 */

const ORG = 'org1';
const T0 = 1_790_000_000_000;

class Log implements Source {
  readonly streams = new Map<string, AnyEvent[]>();
  private seq = 0;

  add(streamId: string, type: string, payload: unknown, actorId = 'admin', id = `e${this.seq + 1}`) {
    this.seq += 1;
    this.push({ id, type, orgId: ORG, streamId, actorId, deviceId: 'd', hlc: encodeHlc(T0 + this.seq * 1000, 0, 'd'), payload } as AnyEvent);
  }

  push(e: AnyEvent) {
    const list = this.streams.get(e.streamId) ?? [];
    list.push({ ...e, serverSeq: list.length + 1 } as AnyEvent);
    this.streams.set(e.streamId, list);
  }

  async pull(orgId: string, streamId: string, after: number, limit: number) {
    return (this.streams.get(streamId) ?? []).filter((e) => orgId === ORG && e.serverSeq! > after).slice(0, limit);
  }
  async snapshotMeta() { return null; }
  async snapshotChunk() { return null; }

  /** append_events as far as this API needs it: idempotent by id, and the actor's privileges decide (may_emit). */
  async append(events: AnyEvent[]): Promise<AppendResult[]> {
    const org = foldOrg(this.streams.get('_org') ?? []);
    return events.map((e) => {
      if ([...this.streams.values()].flat().some((x) => x.id === e.id)) return { id: e.id, accepted: true, serverSeq: null, reason: 'duplicate' };
      if (!privilegeAllows(privilegeFor(e), privilegesFor(org, e.actorId, e.streamId))) return { id: e.id, accepted: false, serverSeq: null, reason: 'not allowed' };
      this.push(e);
      return { id: e.id, accepted: true, serverSeq: 1, reason: null };
    });
  }

  reviews(streamId: string) {
    return (this.streams.get(streamId) ?? []).filter((e) => e.type === 'v1.ReviewRecorded').map((e) => ({ actorId: e.actorId, ...(e.payload as Record<string, unknown>) }));
  }
}

const unit = (unitId: string, label: string, parentUnitId: string | null = 'book') => ({ unitId, parentUnitId, kind: 'passage', label, order: unitId });
const card = (hash: string, durationMs = 1500) => ({ hash: hash.repeat(64).slice(0, 64), durationMs, format: 'm4a' as const });

/** Record and share a version of a passage; with `approve`, the one step's review passes it. */
function recorded(log: Log, lang: string, unitId: string, opts: { approve?: boolean; submit?: boolean; take?: string } = {}) {
  const take = opts.take ?? `take-${unitId}`;
  const cards = [card(`${unitId}a`), card(`${unitId}b`, 2500)];
  log.add(lang, 'v1.RecordingAdded', { recordingId: `rec-${take}`, unitId, kind: 'target', cards }, 'tr');
  log.add(lang, 'v1.TakeComposed', { takeId: take, unitId, cardHashes: cards.map((c) => c.hash), parentTakeId: null }, 'tr');
  if (opts.submit === false) return take;
  log.add(lang, 'v1.TakeSubmitted', { takeId: take }, 'tr');
  if (opts.approve) log.add(lang, 'v1.ReviewRecorded', { reviewId: `peer-${take}`, takeId: take, kindId: 'peer', outcome: 'looks_good', via: 'app' }, 'rev');
  return take;
}

/**
 * Dinka (din) with one peer step: d1 approved, d2 in review, d3 a draft, d4
 * not started. Nuer (nus) with peer review then a consultant checkpoint: n1
 * approved, n2 past peer review and waiting at the checkpoint. 'admin' runs
 * the organization, 'rev' reviews and 'tr' translates everywhere, 'dinka'
 * only views Dinka.
 */
function world() {
  const log = new Log();
  log.add('_org', 'v1.OrgCreated', { name: 'Org' });
  for (const r of SEED_ROLES) log.add('_org', 'v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
  log.add('_org', 'v1.LanguageAdded', { languageId: 'din', name: 'Dinka', code: 'din', sourceCode: 'eng' });
  log.add('_org', 'v1.LanguageAdded', { languageId: 'nus', name: 'Nuer', code: 'nus', sourceCode: 'eng' });
  log.add('_org', 'v1.MemberAdded', { profileId: 'admin', roleId: 'org_admin', scope: { level: 'org' } });
  log.add('_org', 'v1.MemberAdded', { profileId: 'rev', roleId: 'reviewer', scope: { level: 'org' } });
  log.add('_org', 'v1.MemberAdded', { profileId: 'tr', roleId: 'translator', scope: { level: 'org' } });
  log.add('_org', 'v1.MemberAdded', { profileId: 'dinka', roleId: 'viewer', scope: { level: 'language', languageId: 'din' } });
  for (const lang of ['din', 'nus']) {
    log.add(lang, 'v1.FlowSelected', { flowId: 'peer_only', name: 'Peer only' });
    log.add(lang, 'v1.FlowStepSet', { stepId: 'peer_only/s1', order: 's00', kindIds: ['peer'], checkpoint: false });
    log.add(lang, 'v1.UnitAdded', unit('book', 'Luke', null));
  }
  // Nuer also has a consultant checkpoint after peer review.
  log.add('nus', 'v1.FlowStepSet', { stepId: 'peer_only/s2', order: 's01', kindIds: ['consultant'], checkpoint: true });
  log.add('din', 'v1.UnitAdded', unit('d1', 'Luke 1'));
  log.add('din', 'v1.UnitAdded', unit('d2', 'Luke 2'));
  log.add('din', 'v1.UnitAdded', unit('d3', 'Luke 3'));
  log.add('din', 'v1.UnitAdded', unit('d4', 'Luke 4'));
  log.add('nus', 'v1.UnitAdded', unit('n1', 'Luke 1'));
  recorded(log, 'din', 'd1', { approve: true });
  recorded(log, 'din', 'd2');
  recorded(log, 'din', 'd3', { submit: false });
  recorded(log, 'nus', 'n1', { approve: true });
  log.add('nus', 'v1.ReviewRecorded', { reviewId: 'consultant-n1', takeId: 'take-n1', kindId: 'consultant', outcome: 'looks_good', via: 'app' }, 'admin');
  log.add('nus', 'v1.UnitAdded', unit('n2', 'Luke 2'));
  recorded(log, 'nus', 'n2', { approve: true });
  return log;
}

class MemoryStore implements AgentStore {
  readonly tokens: (TokenRecord & { tokenHash: string })[] = [];
  readonly grants: (DeviceGrant & { deviceCodeHash: string })[] = [];
  readonly orgs = new Map<string, string[]>([['admin', [ORG]], ['rev', [ORG]], ['tr', [ORG]], ['dinka', [ORG]]]);
  private n = 0;
  private strip = ({ tokenHash: _h, ...t }: TokenRecord & { tokenHash: string }): TokenRecord => t;
  async tokenByHash(hash: string) { const t = this.tokens.find((x) => x.tokenHash === hash); return t ? this.strip(t) : null; }
  async insertToken(t: NewToken) {
    const row = { ...t, id: `tok${++this.n}`, createdAt: new Date(T0).toISOString(), revokedAt: null, lastUsedAt: null };
    this.tokens.push(row);
    return this.strip(row);
  }
  async tokensOf(orgId: string, profileId: string) { return this.tokens.filter((t) => t.orgId === orgId && t.profileId === profileId).map(this.strip); }
  async revokeToken(id: string, profileId: string) {
    const t = this.tokens.find((x) => x.id === id && x.profileId === profileId && !x.revokedAt);
    if (t) t.revokedAt = new Date(T0).toISOString();
    if (t) for (const l of this.links) if (l.tokenId === id && !l.revokedAt) l.revokedAt = t.revokedAt;
    if (t) for (const w of this.webhooks) if (w.tokenId === id && !w.disabledAt) Object.assign(w, { disabledAt: t.revokedAt, disabledReason: 'token_revoked' });
    return !!t;
  }
  async touchToken(id: string, at: string) { const t = this.tokens.find((x) => x.id === id); if (t) t.lastUsedAt = at; }
  async tokenNames(orgId: string, ids: string[]) {
    return Object.fromEntries(this.tokens.filter((t) => t.orgId === orgId && ids.includes(t.id)).map((t) => [t.id, t.clientName ?? t.name]));
  }
  async insertGrant(g: Parameters<AgentStore['insertGrant']>[0]) {
    const row = { ...g, id: `g${++this.n}`, createdAt: new Date(T0).toISOString(), lastPolledAt: null, approvedAt: null, deniedAt: null, tokenId: null };
    this.grants.push(row);
    return row;
  }
  async grantByUserCode(code: string) { return this.grants.find((g) => g.userCode === code) ?? null; }
  async grantByDeviceHash(hash: string) { return this.grants.find((g) => g.deviceCodeHash === hash) ?? null; }
  async updateGrant(id: string, patch: Partial<DeviceGrant>) { Object.assign(this.grants.find((g) => g.id === id)!, patch); }
  async decideGrant(id: string, d: Partial<DeviceGrant>) {
    const g = this.grants.find((x) => x.id === id)!;
    if (g.approvedAt || g.deniedAt) return false;
    Object.assign(g, d);
    return true;
  }
  async deleteGrantsExpiredBefore(before: string) {
    for (let i = this.grants.length - 1; i >= 0; i -= 1) if (this.grants[i]!.expiresAt < before) this.grants.splice(i, 1);
  }
  async orgsOf(profileId: string) { return this.orgs.get(profileId) ?? []; }
  readonly links: (ReviewLink & { codeHash: string })[] = [];
  async insertLink(l: Omit<ReviewLink, 'id' | 'createdAt' | 'revokedAt'> & { codeHash: string }) {
    const row = { ...l, id: `00000000-0000-4000-8000-${String(++this.n).padStart(12, '0')}`, createdAt: new Date(T0).toISOString(), revokedAt: null };
    this.links.push(row);
    return row;
  }
  async linkByCodeHash(hash: string) { return this.links.find((l) => l.codeHash === hash) ?? null; }
  async linksOf(orgId: string, languageId: string, unitId: string) { return this.links.filter((l) => l.orgId === orgId && l.languageId === languageId && l.unitId === unitId); }
  async linkById(id: string) { return this.links.find((l) => l.id === id) ?? null; }
  async openLinkCount(orgId: string, profileId: string, now: string) {
    return this.links.filter((l) => l.orgId === orgId && l.createdBy === profileId && !l.revokedAt && l.expiresAt > now).length;
  }
  async revokeLink(id: string) {
    const l = this.links.find((x) => x.id === id && !x.revokedAt);
    if (l) l.revokedAt = new Date(T0).toISOString();
    return !!l;
  }
  readonly webhooks: WebhookRecord[] = [];
  async insertWebhook(w: NewWebhook) {
    const row = { ...w, id: `wh${++this.n}`, createdAt: new Date(T0).toISOString(), disabledAt: null, disabledReason: null };
    this.webhooks.push(row);
    return { ...row };
  }
  async webhooksOfToken(tokenId: string) { return this.webhooks.filter((w) => w.tokenId === tokenId).map((w) => ({ ...w })).reverse(); }
  async deleteWebhook(id: string, tokenId: string) {
    const i = this.webhooks.findIndex((w) => w.id === id && w.tokenId === tokenId);
    if (i >= 0) this.webhooks.splice(i, 1);
    return i >= 0;
  }
  async liveWebhooks(orgId: string) {
    return this.webhooks.filter((w) => w.orgId === orgId && !w.disabledAt)
      .map((w) => ({ webhook: { ...w }, token: this.strip(this.tokens.find((t) => t.id === w.tokenId)!) }));
  }
  async webhooksByIds(ids: string[]) { return this.webhooks.filter((w) => ids.includes(w.id)).map((w) => ({ ...w })); }
  async disableWebhooks(ids: string[], reason: string) {
    for (const w of this.webhooks) if (ids.includes(w.id) && !w.disabledAt) Object.assign(w, { disabledAt: new Date(T0).toISOString(), disabledReason: reason });
  }
  async webhookOrgs() { return [...new Set(this.webhooks.filter((w) => !w.disabledAt).map((w) => w.orgId))]; }
}

/** The object's SQLite, as worker.test.ts runs it. */
function sqlite() {
  const db = new DatabaseSync(':memory:');
  return {
    exec: (query: string, ...bindings: unknown[]) => {
      const statement = db.prepare(query);
      const rows = /^\s*select/i.test(query) ? statement.all(...(bindings as never[])) : (statement.run(...(bindings as never[])), []);
      return { toArray: () => rows as Record<string, unknown>[] };
    },
    transactionSync: <T>(fn: () => T): T => {
      db.exec('begin');
      try { const out = fn(); db.exec('commit'); return out; } catch (e) { db.exec('rollback'); throw e; }
    }
  };
}

/** What a webhook's server received. */
interface Received { url: string; headers: Record<string, string>; body: any; raw: string }

const withoutKeys = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

function setup() {
  const log = world();
  const store = new MemoryStore();
  let now = T0 + 10_000_000;
  let signed = 0;
  const folder = new OrgFolder(log, ORG, new MemoryCache(), () => now, 0);
  const received: Received[] = [];
  // What the app's server answers; a status, or 'down' for no answer at all.
  let answerWith: number | 'down' = 200;
  const runs: JobRun[] = [];
  const dispatcher = new WebhookDispatcher(sqlite(), ORG, {
    store,
    orgState: () => folder.orgState(true),
    languageState: (id) => folder.languageState(id),
    heads: async () => Object.fromEntries([...log.streams].map(([id, list]) => [id, list.length])),
    fetch: async (url, init) => {
      const raw = init.body as string;
      received.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(raw), raw });
      if (answerWith === 'down') throw new TypeError('fetch failed');
      return new Response('ok', { status: answerWith });
    },
    now: () => now,
    jobRun: (run) => { runs.push(run); }
  });
  const agent = new AgentOrg(folder, ORG, {
    append: (events) => log.append(events),
    sign: async (key) => {
      signed += 1;
      return { url: `https://lq.test/api/blobs/${key}?sig=x`, expiresAt: now + 600_000 };
    },
    now: () => now,
    webhooks: dispatcher
  });
  const deps: AgentDeps = {
    store,
    // A signed-in session is "jwt:<profile>" here.
    profileOf: async (jwt) => (jwt.startsWith('jwt:') ? jwt.slice(4) : null),
    org: (orgId) => (orgId === ORG ? agent : { read: async () => ({ ok: false, status: 404, code: 'x', error: 'x' }), write: async () => ({ ok: false, status: 404, code: 'x', error: 'x' }), access: async () => null }) as OrgStub,
    saveVoiceNote: async (_o, _l, bytes) => (await hashSecret(String.fromCharCode(...bytes))),
    now: () => now
  };
  const call = async (method: string, path: string, auth?: string, body?: unknown, raw?: Uint8Array) => {
    const res = await handleAgentApi(new Request(`https://lq.test${path}`, {
      method,
      headers: {
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(raw ? { 'content-type': 'audio/mp4', 'content-length': String(raw.length) } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : raw ? { body: raw } : {})
    }), deps);
    const out = { status: res.status, body: (res.status === 202 || res.status === 204 ? null : await res.json()) as any };
    // Every exchange must agree with the OpenAPI document (decisions.md 86).
    const problem = check(method, path, out.status, out.body, raw ?? body);
    if (problem) throw new Error(problem);
    return out;
  };
  /** A token made on the connect page by `profileId`. */
  const token = async (profileId: string, spec: Record<string, unknown>) => {
    const r = await call('POST', '/api/v1/session/tokens', `jwt:${profileId}`, { orgId: ORG, name: 'test', ...spec });
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    return r.body.token as string;
  };
  return {
    log, store, call, token, advance: (ms: number) => { now += ms; }, signed: () => signed,
    dispatcher, received, runs, answer: (a: number | 'down') => { answerWith = a; },
    /** What the alarm does after a poke: look, then send what is due. */
    tick: async () => { await dispatcher.scan(); await dispatcher.deliverDue(); }
  };
}

describe('reading', () => {
  it('gives a read:published token approved passages only, with their audio in playing order', async () => {
    const { call, token } = setup();
    const t = await token('admin', { scopes: ['read:published'] });
    const list = await call('GET', '/api/v1/languages/din/passages', t);
    expect(list.status).toBe(200);
    // d2 (in review), d3 (draft) and d4 (not started) must never reach a listening app.
    expect(list.body.passages.map((p: any) => [p.unitId, p.status])).toEqual([['d1', 'approved']]);
    expect(list.body.nextAfter).toBeNull();
    expect(list.body.passages[0].path).toEqual(['Luke']);
    expect(list.body.passages[0].version.durationMs).toBe(4000);

    const one = await call('GET', '/api/v1/languages/din/passages/d1', t);
    expect(one.body.audio.map((a: any) => a.hash)).toEqual([card('d1a').hash, card('d1b').hash]);
    expect(one.body.audio[0].url).toBe(`https://lq.test/api/blobs/${ORG}/din/${card('d1a').hash}.m4a?sig=x`);
    // The team's own reviews stay inside the team.
    expect(one.body.reviews).toEqual([]);
    expect(one.body.steps).toBeUndefined();

    expect((await call('GET', '/api/v1/languages/din/passages/d2', t)).status).toBe(404);
  });

  it('keeps playing the approved version to a listening app while a new one waits for review', async () => {
    const { call, token, log } = setup();
    const t = await token('admin', { scopes: ['read:published', 'review'] });
    // The team view still calls d1 done after a re-record: its peer kind's latest review approves.
    recorded(log, 'din', 'd1', { take: 'take-d1-v2' });
    const one = await call('GET', '/api/v1/languages/din/passages/d1', t);
    expect(one.body.version).toMatchObject({ n: 1, takeId: 'take-d1' });
    expect(one.body.audio.map((a: any) => a.hash)).toEqual([card('d1a').hash, card('d1b').hash]);
    expect((await call('POST', '/api/v1/languages/din/passages/d1/reviews', t, { outcome: 'looks_good', reviewerId: 'a', takeId: 'take-d1-v2' })).status).toBe(404);
    // Feedback answered by a revision keeps the check open (decisions.md 96): still in review, nothing approved.
    const reader = await token('admin', { scopes: ['read'] });
    log.add('din', 'v1.ReviewRecorded', { reviewId: 'peer-d2-no', takeId: 'take-d2', kindId: 'peer', outcome: 'needs_changes', via: 'app' }, 'rev');
    recorded(log, 'din', 'd2', { take: 'take-d2-v2' });
    expect((await call('GET', '/api/v1/languages/din/passages/d2', reader)).body).toMatchObject({ status: 'in_review', approvedVersion: null });
    expect((await call('GET', '/api/v1/languages/din/passages/d2', t)).status).toBe(404);
  });

  it('hands a read token the approved version\'s audio beside the latest, so a published chapter keeps playing', async () => {
    // Why: EveryBible publishes the approved version. When the team records again, its
    // listeners must keep hearing what was published, not lose the chapter until the
    // new take is approved (decisions.md 109).
    const { call, token, log } = setup();
    const t = await token('admin', { scopes: ['read'] });
    const fresh = [card('e1'), card('e2')];
    log.add('din', 'v1.RecordingAdded', { recordingId: 'rec-d1-v2', unitId: 'd1', kind: 'target', cards: fresh }, 'tr');
    log.add('din', 'v1.TakeComposed', { takeId: 'take-d1-v2', unitId: 'd1', cardHashes: fresh.map((c) => c.hash), parentTakeId: null }, 'tr');
    log.add('din', 'v1.TakeSubmitted', { takeId: 'take-d1-v2' }, 'tr');
    const one = await call('GET', '/api/v1/languages/din/passages/d1', t);
    expect(one.body.version.takeId).toBe('take-d1-v2');
    expect(one.body.approvedVersion.takeId).toBe('take-d1');
    expect(one.body.audio.map((a: any) => a.hash)).toEqual(fresh.map((c) => c.hash));
    expect(one.body.approvedAudio.map((a: any) => a.hash)).toEqual([card('d1a').hash, card('d1b').hash]);
    const listed = await call('GET', '/api/v1/languages/din/passages?unitIds=d1&include=approvedAudio', t);
    expect(listed.body.passages[0].approvedAudio).toEqual(one.body.approvedAudio);
    // Nothing approved yet: nothing to keep playing.
    expect((await call('GET', '/api/v1/languages/din/passages/d2', t)).body.approvedAudio).toEqual([]);
  });

  it('gives a read token every passage, with reviews and steps', async () => {
    const { call, token } = setup();
    const t = await token('admin', { scopes: ['read'] });
    const list = await call('GET', '/api/v1/languages/din/passages', t);
    expect(list.body.passages.map((p: any) => [p.unitId, p.status])).toEqual([['d1', 'approved'], ['d2', 'in_review'], ['d3', 'drafting'], ['d4', 'not_started']]);
    expect(list.body.passages[2].version).toBeNull();
    expect((await call('GET', '/api/v1/languages/din/passages?status=in_review', t)).body.passages.map((p: any) => p.unitId)).toEqual(['d2']);
    expect((await call('GET', '/api/v1/languages/din', t)).body).toMatchObject({ languageId: 'din', can: { read: 'all' } });
    const d1 = await call('GET', '/api/v1/languages/din/passages/d1', t);
    expect(d1.body.reviews.map((r: any) => [r.kind, r.outcome])).toEqual([['Peer Review', 'looks_good']]);
    expect(d1.body.steps).toEqual([{ name: 'Peer Review', complete: true, checkpoint: false, kinds: [{ kindId: 'peer', name: 'Peer Review', state: 'approved', apiReviewCounts: true }] }]);
    expect(d1.body.requests).toEqual([]);
  });

  it('adds what include names to every passage on the list, as one passage gives it', async () => {
    // Why: "where is each passage in review?" took one call per passage.
    const { call, token, log } = setup();
    log.add('din', 'v1.RequestMade', { requestId: 'q-rev', unitId: 'd2', what: 'review', kindId: 'peer', profileId: 'rev' }, 'tr');
    const t = await token('rev', { scopes: ['read'] });
    const plain = await call('GET', '/api/v1/languages/din/passages', t);
    expect(plain.body.passages.every((p: any) => Object.keys(p).every((k) => !['steps', 'requests', 'reviews', 'versions', 'audio', 'text', 'made'].includes(k)))).toBe(true);
    const one = await call('GET', '/api/v1/languages/din/passages/d2', t);
    const progress = await call('GET', '/api/v1/languages/din/passages?status=in_review&include=steps,requests', t);
    expect(progress.body.passages).toEqual([{ ...withoutKeys(one.body, ['audio', 'text', 'reviews', 'versions', 'approvedAudio', 'made']) }]);
    expect(progress.body.passages[0].requests).toMatchObject([{ requestId: 'q-rev', forYou: true }]);
    // Everything one passage gives, for several picked passages, in display order.
    const picked = await call('GET', '/api/v1/languages/din/passages?unitIds=d2&unitIds=d1&unitIds=nope&include=audio,text,reviews,steps,requests,versions,approvedAudio,made', t);
    expect(picked.body.passages.map((p: any) => p.unitId)).toEqual(['d1', 'd2']);
    expect(picked.body.passages[1]).toEqual(one.body);
    expect((await call('GET', '/api/v1/languages/din/passages?include=steps,colour', t)).body).toMatchObject({ code: 'bad_request' });
  });

  it('gives a listening app audio and reviews on the list, but never the team\'s flow', async () => {
    const { call, token } = setup();
    const listener = await token('admin', { scopes: ['read:published'] });
    const one = await call('GET', '/api/v1/languages/din/passages/d1', listener);
    const list = await call('GET', '/api/v1/languages/din/passages?include=audio,text,reviews', listener);
    expect(list.body.passages).toEqual([one.body]);
    for (const include of ['steps', 'requests', 'versions', 'approvedAudio', 'made']) {
      expect((await call('GET', `/api/v1/languages/din/passages?include=${include}`, listener)).body).toMatchObject({ code: 'scope' });
    }
  });

  it('pages the list, signing links only for the page it gives', async () => {
    const { call, token, signed } = setup();
    const t = await token('admin', { scopes: ['read'] });
    const seen: string[] = [];
    let after: string | null = null;
    let pages = 0;
    do {
      const before = signed();
      const page = await call('GET', `/api/v1/languages/din/passages?limit=3&include=audio${after ? `&after=${after}` : ''}`, t);
      expect(page.body.passages.length).toBeLessThanOrEqual(3);
      expect(signed() - before).toBe(page.body.passages.reduce((n: number, p: any) => n + p.audio.length, 0));
      seen.push(...page.body.passages.map((p: any) => p.unitId));
      after = page.body.nextAfter;
      pages += 1;
    } while (after);
    expect(seen).toEqual(['d1', 'd2', 'd3', 'd4']);
    expect(pages).toBe(2);
    // A full last page says there is no more, rather than sending the caller to an empty one.
    expect((await call('GET', '/api/v1/languages/din/passages?limit=4', t)).body.nextAfter).toBeNull();
    // Filters apply before the page is cut.
    expect((await call('GET', '/api/v1/languages/din/passages?limit=1&status=drafting', t)).body).toMatchObject({ passages: [{ unitId: 'd3' }], nextAfter: null });
    for (const bad of ['limit=0', 'limit=501', 'limit=two', 'after=nope']) {
      expect((await call('GET', `/api/v1/languages/din/passages?${bad}`, t)).status).toBe(400);
    }
  });

  it('links a voice note recorded in a browser under its real format (decisions.md 77)', async () => {
    // Why: a browser without MP4 stores the note as <hash>.wav; a link to
    // <hash>.m4a would point at nothing.
    const { call, token, log } = setup();
    const t = await token('admin', { scopes: ['read'] });
    const web = 'w'.repeat(64);
    const phone = 'p'.repeat(64);
    log.add('din', 'v1.AudioFormatSet', { hash: web, format: 'wav' }, 'rev');
    log.add('din', 'v1.ReviewRecorded', { reviewId: 'peer-d2-web', takeId: 'take-d2', kindId: 'peer', outcome: 'needs_changes', via: 'app', commentBlobHash: web }, 'rev');
    log.add('din', 'v1.ReviewRecorded', { reviewId: 'peer-d1-phone', takeId: 'take-d1', kindId: 'peer', outcome: 'looks_good', via: 'app', commentBlobHash: phone }, 'rev');
    const d2 = await call('GET', '/api/v1/languages/din/passages/d2', t);
    expect(d2.body.reviews[0].voiceNotes[0].url).toBe(`https://lq.test/api/blobs/${ORG}/din/${web}.wav?sig=x`);
    const d1 = await call('GET', '/api/v1/languages/din/passages/d1', t);
    expect(d1.body.reviews.find((r: any) => r.voiceNotes).voiceNotes[0].url).toBe(`https://lq.test/api/blobs/${ORG}/din/${phone}.m4a?sig=x`);
  });

  it('never reaches past the person: a language list narrows, and their own access caps it', async () => {
    const { call, token } = setup();
    const onlyNuer = await token('admin', { scopes: ['read'], languageIds: ['nus'] });
    expect((await call('GET', '/api/v1/languages', onlyNuer)).body.map((l: any) => l.languageId)).toEqual(['nus']);
    expect((await call('GET', '/api/v1/languages/din/passages', onlyNuer)).status).toBe(404);
    // A Dinka viewer's token for "every language" is still only Dinka.
    const viewer = await token('dinka', { scopes: ['read'] });
    expect((await call('GET', '/api/v1/languages', viewer)).body.map((l: any) => l.languageId)).toEqual(['din']);
    expect((await call('GET', '/api/v1/languages/nus/passages', viewer)).status).toBe(404);
    // And they cannot hand a token a language they cannot see.
    expect((await call('POST', '/api/v1/session/tokens', 'jwt:dinka', { orgId: ORG, name: 'x', scopes: ['read'], languageIds: ['nus'] })).status).toBe(400);
  });

  it('follows changes with changedSince', async () => {
    const { call, token, log } = setup();
    const t = await token('admin', { scopes: ['read'] });
    const first = await call('GET', '/api/v1/languages/din/passages', t);
    const newest = first.body.passages.map((p: any) => p.updatedAt).filter(Boolean).sort().at(-1);
    expect((await call('GET', `/api/v1/languages/din/passages?changedSince=${newest}`, t)).body).toEqual({ passages: [], nextAfter: null });
    log.add('din', 'v1.ReviewRecorded', { reviewId: 'peer-d2', takeId: 'take-d2', kindId: 'peer', outcome: 'looks_good', via: 'app' }, 'rev');
    const changed = await call('GET', `/api/v1/languages/din/passages?changedSince=${newest}`, t);
    expect(changed.body.passages.map((p: any) => [p.unitId, p.status])).toEqual([['d2', 'approved']]);
  });

  it('refuses missing, foreign, revoked and expired tokens', async () => {
    const { call, token, store, advance } = setup();
    expect((await call('GET', '/api/v1/languages')).status).toBe(401);
    expect((await call('GET', '/api/v1/languages', 'jwt:admin')).body.code).toBe('bad_token');
    expect((await call('GET', '/api/v1/languages', 'lqp_nothing')).status).toBe(401);
    const t = await token('admin', { scopes: ['read'] });
    const id = (await call('GET', '/api/v1/me', t)).body.token.id;
    expect((await call('POST', `/api/v1/session/tokens/${id}/revoke`, 'jwt:rev')).status).toBe(404); // not theirs
    expect((await call('POST', `/api/v1/session/tokens/${id}/revoke`, 'jwt:admin')).status).toBe(200);
    expect((await call('GET', '/api/v1/languages', t)).body.code).toBe('revoked');
    const soon = await token('admin', { scopes: ['read'], expiresInDays: 1 });
    expect((await call('GET', '/api/v1/languages', soon)).status).toBe(200);
    advance(86_400_000 + 1);
    expect((await call('GET', '/api/v1/languages', soon)).body.code).toBe('expired');
    expect(store.tokens.every((x) => !JSON.stringify(x).includes(t))).toBe(true); // only hashes are kept
  });
});

describe('what an approved passage holds (decisions.md 130)', () => {
  const words = (...texts: string[]) => texts.map((text) => ({ id: writtenPartId(text), text }));
  const written = (parts: { id: string }[]) => parts.map((p) => ({ hash: p.id, durationMs: 0 }));
  /** A step that writes a recording down and adds the words to the version. */
  const transcription = (log: Log) => {
    log.add('din', 'v1.ReviewKindDefined', { kindId: 'transcribe', name: 'Transcription' });
    log.add('din', 'v1.StepMakesSet', { kindId: 'transcribe', makes: { from: 'recording', to: 'writing', language: 'same', result: 'added' } });
  };

  it('serves a written version as its words with their verses, and never signs a link for a written part', async () => {
    const { call, token, log, signed } = setup();
    const parts = words('In the beginning was the Word.', 'He was with God in the beginning.', 'Through him all things were made.');
    log.add('din', 'v1.UnitAdded', unit('d5', 'Luke 5'));
    // The third part's words have not reached the server yet.
    log.add('din', 'v1.WritingAdded', { writingId: 'w-d5', unitId: 'd5', parts: parts.slice(0, 2) }, 'tr');
    log.add('din', 'v1.CardVerseSet', { unitId: 'd5', hash: parts[0]!.id, mark: 'set', from: '5:1', to: '5:1' }, 'tr');
    log.add('din', 'v1.CardVerseSet', { unitId: 'd5', hash: parts[1]!.id, mark: 'set', from: '5:2', to: '5:3' }, 'tr');
    log.add('din', 'v1.TakeComposed', { takeId: 'take-d5', unitId: 'd5', cardHashes: parts.map((p) => p.id), parentTakeId: null }, 'tr');
    log.add('din', 'v1.TakeSubmitted', { takeId: 'take-d5' }, 'tr');
    log.add('din', 'v1.ReviewRecorded', { reviewId: 'peer-d5', takeId: 'take-d5', kindId: 'peer', outcome: 'looks_good', via: 'app' }, 'rev');
    const listener = await token('admin', { scopes: ['read:published'] });
    const before = signed();
    const d5 = await call('GET', '/api/v1/languages/din/passages/d5', listener);
    expect(d5.body).toMatchObject({
      status: 'approved', version: { n: 1, medium: 'writing', durationMs: 0 }, approvedVersion: { n: 1, takeId: 'take-d5', medium: 'writing' }, audio: []
    });
    expect(d5.body.version.added).toBeUndefined();
    expect(d5.body.text).toEqual([
      { text: 'In the beginning was the Word.', verses: { from: '5:1', to: '5:1' } },
      { text: 'He was with God in the beginning.', verses: { from: '5:2', to: '5:3' } }
    ]);
    expect(signed()).toBe(before);

    // A step reads it aloud and adds the recording to it: the written version now plays that.
    log.add('din', 'v1.ReviewKindDefined', { kindId: 'read-aloud', name: 'Read it aloud' });
    log.add('din', 'v1.StepMakesSet', { kindId: 'read-aloud', makes: { from: 'writing', to: 'recording', language: 'same', result: 'added' } });
    log.add('din', 'v1.Made', { madeId: 'aloud-d5', unitId: 'd5', kindId: 'read-aloud', fromTakeId: 'take-d5', added: true, parts: [card('d5r', 3000)] }, 'tr');
    const aloud = await call('GET', '/api/v1/languages/din/passages/d5', listener);
    expect(aloud.body.version).toMatchObject({ medium: 'writing', durationMs: 3000, added: [{ medium: 'recording', kindId: 'read-aloud', kind: 'Read it aloud', addedAt: aloud.body.updatedAt }] });
    expect(aloud.body.audio.map((a: any) => a.hash)).toEqual([card('d5r').hash]);
    expect(aloud.body.text).toEqual(d5.body.text);
    // The list and MCP give the same; a review link plays the same.
    const listed = await call('GET', '/api/v1/languages/din/passages?unitIds=d5&include=audio,text', listener);
    expect(listed.body.passages).toEqual([withoutKeys(aloud.body, ['reviews'])]);
    const mcp = await call('POST', '/api/v1/mcp', listener, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_passages', arguments: { languageId: 'din', unitIds: ['d5'], include: ['audio', 'text'] } } });
    expect(JSON.parse(mcp.body.result.content[0].text).passages).toEqual(listed.body.passages);
    const link = await call('POST', '/api/v1/session/review-links', 'jwt:tr', { orgId: ORG, languageId: 'din', unitId: 'd5', kindId: 'peer', counts: false });
    const page = await call('GET', `/api/v1/links/${link.body.url.slice(link.body.url.lastIndexOf('/') + 1)}`);
    expect(page.body.audio.map((a: any) => a.hash)).toEqual([card('d5r').hash]);
  });

  it('gives a recorded version the words a step added to it, and keeps what was made beside it for the team', async () => {
    const { call, token, log } = setup();
    const parts = words('Zechariah served as priest.', 'He was chosen by lot.');
    transcription(log);
    log.add('din', 'v1.ReviewKindDefined', { kindId: 'make-bt-said', name: 'Back translation' });
    log.add('din', 'v1.StepMakesSet', { kindId: 'make-bt-said', makes: { from: 'either', to: 'recording', language: 'other', result: 'beside' } });
    log.add('din', 'v1.WritingAdded', { writingId: 'w-d1', unitId: 'd1', parts }, 'tr');
    log.add('din', 'v1.CardVerseSet', { unitId: 'd1', hash: parts[0]!.id, mark: 'set', from: '1:8', to: '1:8' }, 'tr');
    log.add('din', 'v1.Made', { madeId: 'words-d1', unitId: 'd1', kindId: 'transcribe', fromTakeId: 'take-d1', added: true, parts: written(parts) }, 'tr');
    log.add('din', 'v1.Made', { madeId: 'bt-d1', unitId: 'd1', kindId: 'make-bt-said', fromTakeId: 'take-d1', language: 'eng', parts: [card('bt1', 5000)] }, 'tr');
    const listener = await token('admin', { scopes: ['read:published'] });
    const d1 = await call('GET', '/api/v1/languages/din/passages/d1', listener);
    expect(d1.body.version).toEqual({
      n: 1, takeId: 'take-d1', submittedAt: expect.any(String), durationMs: 4000, medium: 'recording',
      added: [{ medium: 'writing', kindId: 'transcribe', kind: 'Transcription', addedAt: expect.any(String) }]
    });
    expect(d1.body.audio.map((a: any) => a.hash)).toEqual([card('d1a').hash, card('d1b').hash]);
    expect(d1.body.text).toEqual([{ text: 'Zechariah served as priest.', verses: { from: '1:8', to: '1:8' } }, { text: 'He was chosen by lot.' }]);
    // What was made beside the version is the team's.
    expect(d1.body.made).toBeUndefined();
    expect((await call('GET', '/api/v1/languages/din/passages?include=made', listener)).body).toMatchObject({ code: 'scope' });
    const team = await token('admin', { scopes: ['read'] });
    const made = (await call('GET', '/api/v1/languages/din/passages?unitIds=d1&include=made', team)).body.passages[0].made;
    expect(made).toEqual([
      { madeId: 'words-d1', kindId: 'transcribe', kind: 'Transcription', medium: 'writing', fromVersionN: 1, added: true, at: d1.body.version.added[0].addedAt, text: d1.body.text },
      {
        madeId: 'bt-d1', kindId: 'make-bt-said', kind: 'Back translation', medium: 'recording', language: 'eng', fromVersionN: 1, added: false, at: expect.any(String),
        audio: [{ hash: card('bt1').hash, format: 'm4a', durationMs: 5000, url: `https://lq.test/api/blobs/${ORG}/din/${card('bt1').hash}.m4a?sig=x`, expiresAt: expect.any(String) }]
      }
    ]);
    // Something made is a change to follow.
    expect(d1.body.updatedAt).toBe(made[1].at);
  });

  it('shows words changed after a review, and the approval stands', async () => {
    const { call, token, log } = setup();
    transcription(log);
    const first = words('Mary went to the hill country.');
    const fixed = words('Mary hurried to the hill country.');
    log.add('din', 'v1.WritingAdded', { writingId: 'w-1', unitId: 'd2', parts: first }, 'tr');
    log.add('din', 'v1.Made', { madeId: 'words-1', unitId: 'd2', kindId: 'transcribe', fromTakeId: 'take-d2', added: true, parts: written(first) }, 'tr');
    log.add('din', 'v1.ReviewRecorded', { reviewId: 'peer-d2', takeId: 'take-d2', kindId: 'peer', outcome: 'looks_good', via: 'app' }, 'rev');
    const listener = await token('admin', { scopes: ['read:published'] });
    const approved = await call('GET', '/api/v1/languages/din/passages/d2', listener);
    expect(approved.body.version.added).toEqual([{ medium: 'writing', kindId: 'transcribe', kind: 'Transcription', addedAt: expect.any(String) }]);
    log.add('din', 'v1.WritingAdded', { writingId: 'w-2', unitId: 'd2', parts: fixed }, 'tr');
    log.add('din', 'v1.Made', { madeId: 'words-2', unitId: 'd2', kindId: 'transcribe', fromTakeId: 'take-d2', added: true, parts: written(fixed) }, 'tr');
    const changed = await call('GET', '/api/v1/languages/din/passages/d2', listener);
    expect(changed.body).toMatchObject({ status: 'approved', approvedVersion: { n: 1, takeId: 'take-d2', medium: 'recording' }, text: [{ text: 'Mary hurried to the hill country.' }] });
    const team = await token('admin', { scopes: ['read'] });
    const review = (await call('GET', '/api/v1/languages/din/passages/d2', team)).body.reviews.find((r: any) => r.kindId === 'peer');
    expect(changed.body.version.added).toEqual([{
      medium: 'writing', kindId: 'transcribe', kind: 'Transcription', addedAt: approved.body.version.added[0].addedAt,
      changedAt: changed.body.updatedAt, changedAfterReview: { kindId: 'peer', kind: 'Peer Review', at: review.at }
    }]);
  });

  it('says which step made a version, which is approved with the checks before that step counted from the version it replaced', async () => {
    const { call, token, log } = setup();
    log.add('nus', 'v1.ReviewKindDefined', { kindId: 'make-final', name: 'Final recording' });
    log.add('nus', 'v1.StepMakesSet', { kindId: 'make-final', makes: { from: 'recording', to: 'recording', language: 'same', result: 'version' } });
    log.add('nus', 'v1.FlowStepSet', { stepId: 'peer_only/s3', order: 's02', kindIds: ['make-final'], checkpoint: false });
    const t = await token('admin', { scopes: ['read'] });
    // n1 passed peer review and the consultant; its final recording is still to be made.
    expect((await call('GET', '/api/v1/languages/nus/passages/n1', t)).body.approvedVersion).toBeNull();
    recorded(log, 'nus', 'n1', { take: 'take-n1-final' });
    log.add('nus', 'v1.Made', { madeId: 'final-n1', unitId: 'n1', kindId: 'make-final', fromTakeId: 'take-n1', takeId: 'take-n1-final' }, 'tr');
    const n1 = await call('GET', '/api/v1/languages/nus/passages/n1', t);
    const madeBy = { kindId: 'make-final', kind: 'Final recording', fromVersionN: 1 };
    expect(n1.body).toMatchObject({
      status: 'approved', version: { n: 2, takeId: 'take-n1-final', medium: 'recording', madeBy }, approvedVersion: { n: 2, takeId: 'take-n1-final', medium: 'recording' }
    });
    expect(n1.body.versions).toEqual([
      { n: 1, takeId: 'take-n1', submittedAt: expect.any(String), medium: 'recording' },
      { n: 2, takeId: 'take-n1-final', submittedAt: expect.any(String), medium: 'recording', madeBy }
    ]);
    // A version a step made is a version, not something made beside one.
    expect(n1.body.made).toEqual([]);
    const listener = await token('admin', { scopes: ['read:published'] });
    expect((await call('GET', '/api/v1/languages/nus/passages/n1', listener)).body.version).toMatchObject({ n: 2, madeBy });
  });
});

describe('writing', () => {
  it('records listener feedback as a review by the token\'s person, once per reviewer and outcome', async () => {
    const { call, token, log } = setup();
    const t = await token('rev', { scopes: ['read:published', 'review'] });
    const path = '/api/v1/languages/din/passages/d1/reviews';
    const first = await call('POST', path, t, { outcome: 'looks_good', reviewerId: 'device-42', reviewerName: 'Mary' });
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBe(false);
    expect(first.body.passage.listenerFeedback).toEqual({ looksGood: 1, needsChanges: 0 });
    // The same tap again, or an app's retry, records nothing new.
    expect((await call('POST', path, t, { outcome: 'looks_good', reviewerId: 'device-42' })).body.duplicate).toBe(true);
    await call('POST', path, t, { outcome: 'needs_changes', reviewerId: 'device-7', comment: 'Verse 3 is hard to follow' });
    const listener = log.reviews('din').filter((r) => r['kindId'] === 'listener');
    expect(listener).toHaveLength(2);
    expect(listener[0]).toMatchObject({ actorId: 'rev', via: 'link', givenBy: 'Mary', takeId: 'take-d1', outcome: 'looks_good' });
    // The app's own reviewer ids never reach the log.
    expect(JSON.stringify(log.streams.get('din'))).not.toContain('device-42');
  });

  it('says which requests wait on the token\'s person, and only a review of the asked kind answers one', async () => {
    // Why: a reviewer asked for a peer review sent listener feedback through the API, and the team kept waiting.
    const { call, token, log } = setup();
    log.add('din', 'v1.RequestMade', { requestId: 'q-rev', unitId: 'd2', what: 'review', kindId: 'peer', profileId: 'rev', note: 'Please check' }, 'tr');
    const asked = await token('rev', { scopes: ['read', 'review'] });
    const before = await call('GET', '/api/v1/languages/din/passages/d2', asked);
    expect(before.body.requests).toEqual([{ requestId: 'q-rev', what: 'review', kindId: 'peer', kind: 'Peer Review', forYou: true, note: 'Please check', askedAt: expect.any(String) }]);
    expect(before.body.steps[0].kinds).toEqual([{ kindId: 'peer', name: 'Peer Review', state: 'asked', apiReviewCounts: true }]);
    // Anyone else with read sees it, not as theirs.
    const other = await token('admin', { scopes: ['read'] });
    expect((await call('GET', '/api/v1/languages/din/passages/d2', other)).body.requests).toMatchObject([{ requestId: 'q-rev', forYou: false }]);
    // Listener feedback leaves the request open; a peer review answers it and completes the step.
    const listener = await call('POST', '/api/v1/languages/din/passages/d2/reviews', asked, { outcome: 'looks_good', reviewerId: 'caleb' });
    expect(listener.body.passage.requests).toHaveLength(1);
    const peer = await call('POST', '/api/v1/languages/din/passages/d2/reviews', asked, { kindId: 'peer', outcome: 'looks_good', reviewerId: 'caleb' });
    expect(peer.body.passage.requests).toEqual([]);
    expect(peer.body.passage.steps[0]).toMatchObject({ complete: true, kinds: [{ state: 'approved' }] });
  });

  it('lets a partner review a step of the flow, which counts like any review but never clears a checkpoint', async () => {
    const { call, token } = setup();
    // A translator's token: a review by link is recorded like a check logged from outside the app.
    const t = await token('tr', { scopes: ['read', 'review'] });
    const peer = await call('POST', '/api/v1/languages/din/passages/d2/reviews', t, { kindId: 'peer', outcome: 'looks_good', reviewerId: 'partner', reviewerName: 'Partner checker' });
    expect(peer.body.passage).toMatchObject({ status: 'approved', approvedVersion: { n: 1 } });
    const consultant = await call('POST', '/api/v1/languages/nus/passages/n2/reviews', t, { kindId: 'consultant', outcome: 'looks_good', reviewerId: 'partner' });
    expect(consultant.status).toBe(200);
    expect(consultant.body.passage.steps).toMatchObject([
      { name: 'Peer Review', complete: true, checkpoint: false, kinds: [{ kindId: 'peer', apiReviewCounts: true }] },
      { name: 'Consultant Check', complete: false, checkpoint: true, kinds: [{ kindId: 'consultant', apiReviewCounts: false }] }
    ]);
    expect(consultant.body.passage.approvedVersion).toBeNull();
    expect((await call('POST', '/api/v1/languages/din/passages/d2/reviews', t, { kindId: 'consultant', outcome: 'looks_good', reviewerId: 'p' })).body.code).toBe('no_kind');
  });

  it('will not attach audio already in the language as a voice note, which would hand out a link to it', async () => {
    const { call, token } = setup();
    const t = await token('rev', { scopes: ['read:published', 'review'] });
    // d2's cards are unapproved; a published-only token must not get a link to them this way.
    const r = await call('POST', '/api/v1/languages/din/passages/d1/reviews', t, { outcome: 'needs_changes', reviewerId: 'a', voiceNotes: [{ hash: card('d2a').hash, format: 'm4a' }] });
    expect(r.status).toBe(400);
  });

  it('takes a voice note with a token and attaches it to a review, which plays it back', async () => {
    const { call, token } = setup();
    const t = await token('rev', { scopes: ['read', 'review'] });
    const up = await call('PUT', '/api/v1/languages/din/voice-notes', t, undefined, m4a('token-note'));
    expect(up.body.voiceNote).toMatchObject({ format: 'm4a', hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const sent = await call('POST', '/api/v1/languages/din/passages/d2/reviews', t, { outcome: 'needs_changes', reviewerId: 'a', voiceNotes: [{ ...up.body.voiceNote, atMs: 1200 }] });
    expect(sent.body.passage.reviews.at(-1).voiceNotes).toEqual([{ url: expect.stringContaining(up.body.voiceNote.hash), expiresAt: expect.any(String), durationMs: 0, atMs: 1200 }]);
    const reader = await token('rev', { scopes: ['read'] });
    expect((await call('PUT', '/api/v1/languages/din/voice-notes', reader, undefined, m4a('nope'))).body).toMatchObject({ code: 'scope' });
  });

  it('lets a team hear about needs-changes on a version in review', async () => {
    const { call, token } = setup();
    const t = await token('rev', { scopes: ['read', 'review'] });
    await call('POST', '/api/v1/languages/din/passages/d2/reviews', t, { outcome: 'needs_changes', reviewerId: 'a', comment: 'Too fast' });
    const d2 = await call('GET', '/api/v1/languages/din/passages/d2', t);
    expect(d2.body.status).toBe('feedback');
    expect(d2.body.reviews.at(-1)).toMatchObject({ kind: 'Listener', comment: 'Too fast', via: 'link' });
  });

  it('refuses writes the scopes or the person do not allow', async () => {
    const { call, token } = setup();
    const readOnly = await token('rev', { scopes: ['read:published'] });
    expect((await call('POST', '/api/v1/languages/din/passages/d1/reviews', readOnly, { outcome: 'looks_good', reviewerId: 'a' })).body.code).toBe('scope');
    // A viewer can neither review nor translate, so cannot be given the review scope at all...
    expect((await call('POST', '/api/v1/session/tokens', 'jwt:dinka', { orgId: ORG, name: 'x', scopes: ['review'] })).status).toBe(400);
    // ...and a published-only token cannot answer what it cannot see.
    const listen = await token('rev', { scopes: ['read:published', 'review'] });
    expect((await call('POST', '/api/v1/languages/din/passages/d2/reviews', listen, { outcome: 'looks_good', reviewerId: 'a' })).status).toBe(404);
    expect((await call('POST', '/api/v1/languages/din/passages/d1/reviews', listen, { outcome: 'great' })).status).toBe(400);
    // Reporting releases needs someone who assigns work.
    const reviewerRelease = await token('rev', { scopes: ['read', 'release'] });
    expect((await call('POST', '/api/v1/languages/din/passages/d1/releases', reviewerRelease, { channel: 'EL app', live: true })).body.code).toBe('privilege');
  });

  it('records where the approved version is live, and a newer approved version does not inherit it', async () => {
    const { call, token, log } = setup();
    const t = await token('admin', { scopes: ['read', 'release'] });
    expect((await call('POST', '/api/v1/languages/din/passages/d2/releases', t, { channel: 'EL app', live: true })).body.code).toBe('not_approved');
    const ok = await call('POST', '/api/v1/languages/din/passages/d1/releases', t, { channel: 'Every Language app', live: true, url: 'https://el.example/luke/1' });
    expect(ok.body.passage.releases).toMatchObject([{ channel: 'Every Language app', versionN: 1, url: 'https://el.example/luke/1' }]);
    // The team records and approves version 2: version 1 is still what is out there.
    recorded(log, 'din', 'd1', { take: 'take-d1-v2', approve: true });
    const after = await call('GET', '/api/v1/languages/din/passages/d1', t);
    expect(after.body).toMatchObject({ approvedVersion: { n: 2 }, releases: [{ versionN: 1 }] });
    // Only the approved version goes live; any version can be taken down.
    expect((await call('POST', '/api/v1/languages/din/passages/d1/releases', t, { channel: 'Every Language app', live: true, takeId: 'take-d1' })).body.code).toBe('not_approved');
    await call('POST', '/api/v1/languages/din/passages/d1/releases', t, { channel: 'Every Language app', live: false, takeId: 'take-d1' });
    expect((await call('GET', '/api/v1/languages/din/passages/d1', t)).body.releases).toEqual([]);
  });
});

describe('review links', () => {
  /** A link shared by the translator, as the app would ask for it. */
  async function share(call: Awaited<ReturnType<typeof setup>>['call'], spec: Record<string, unknown>, who = 'tr') {
    return call('POST', '/api/v1/session/review-links', `jwt:${who}`, { orgId: ORG, languageId: 'din', unitId: 'd2', kindId: 'peer', counts: true, ...spec });
  }
  const codeOf = (url: string) => url.slice(url.lastIndexOf('/') + 1);
  const answer = (outcome: string, extra: Record<string, unknown> = {}) => ({ outcome, name: 'Abuk', browserId: 'browser-1', submissionId: `s-${outcome}`, ...extra });

  it('lets anyone holding it hear the version and answer with any name, recorded as the sharer', async () => {
    const { call, log } = setup();
    const made = await share(call, { label: 'Women\'s fellowship' });
    expect(made.status).toBe(200);
    expect(made.body.url).toMatch(/^https:\/\/lq\.test\/r\/[A-Za-z0-9_-]{22}$/);
    const code = codeOf(made.body.url);
    const page = await call('GET', `/api/v1/links/${code}`);
    expect(page.body).toMatchObject({ label: 'Women\'s fellowship', passage: { label: 'Luke 2', path: ['Luke'] }, language: 'Dinka', kind: { id: 'peer' }, version: 1, open: true });
    expect(page.body.audio.map((a: any) => a.hash)).toEqual([card('d2a').hash, card('d2b').hash]);
    const sent = await call('POST', `/api/v1/links/${code}/reviews`, undefined, answer('looks_good', { comment: 'Clear and natural' }));
    expect(sent.status).toBe(200);
    expect(log.reviews('din').at(-1)).toMatchObject({ actorId: 'tr', kindId: 'peer', via: 'link', givenBy: 'Abuk', outcome: 'looks_good', comment: 'Clear and natural', takeId: 'take-d2' });
    // It counts toward the step: d2 is approved.
    const t = await setupToken(call);
    expect((await call('GET', '/api/v1/languages/din/passages/d2', t)).body.status).toBe('approved');
  });

  it('keeps every voice clip with the moment it is about, in order, and plays them back', async () => {
    const { call } = setup();
    const code = codeOf((await share(call, { counts: false })).body.url);
    const upload = async (bytes: Uint8Array) => {
      const r = await call('PUT', `/api/v1/links/${code}/voice-note`, undefined, undefined, bytes);
      expect(r.status).toBe(200);
      return r.body.voiceNote;
    };
    const late = await upload(m4a('late'));
    const early = await upload(m4a('early'));
    const sent = await call('POST', `/api/v1/links/${code}/reviews`, undefined, answer('needs_changes', {
      comment: 'Two places', voiceNotes: [{ ...late, durationMs: 3000, atMs: 41_500 }, { ...early, durationMs: 2000, atMs: 3_000 }]
    }));
    expect(sent.status).toBe(200);
    const t = await setupToken(call);
    const d2 = await call('GET', '/api/v1/languages/din/passages/d2', t);
    const mine = d2.body.reviews.find((r: any) => r.givenBy === 'Abuk');
    expect(mine.voiceNotes.map((n: any) => [n.atMs, n.durationMs])).toEqual([[3000, 2000], [41_500, 3000]]);
    expect(mine.voiceNotes[0].url).toMatch(/\.m4a\?sig=x$/);
    // Not more than a review takes, and never a moment that is not a whole number.
    const many = Array.from({ length: 11 }, (_, i) => ({ ...early, hash: String(i).padStart(64, 'a'), durationMs: 1000 }));
    expect((await call('POST', `/api/v1/links/${code}/reviews`, undefined, answer('looks_good', { voiceNotes: many }))).status).toBe(400);
    expect((await call('POST', `/api/v1/links/${code}/reviews`, undefined, answer('looks_good', { voiceNotes: [{ ...early, atMs: 1.5 }] }))).status).toBe(400);
  });

  it('records a feedback link as listener feedback that never moves the step', async () => {
    const { call, log } = setup();
    const code = codeOf((await share(call, { counts: false })).body.url);
    await call('POST', `/api/v1/links/${code}/reviews`, undefined, answer('looks_good'));
    expect(log.reviews('din').at(-1)).toMatchObject({ kindId: 'listener', givenBy: 'Abuk' });
    const t = await setupToken(call);
    expect((await call('GET', '/api/v1/languages/din/passages/d2', t)).body.status).toBe('in_review');
  });

  it('keeps a browser\'s latest answer, records a resend once, and caps one browser', async () => {
    const { call, log, advance } = setup();
    const code = codeOf((await share(call, {})).body.url);
    await call('POST', `/api/v1/links/${code}/reviews`, undefined, answer('looks_good'));
    expect((await call('POST', `/api/v1/links/${code}/reviews`, undefined, answer('looks_good'))).body.duplicate).toBe(true);
    advance(30_000); // they listen again
    await call('POST', `/api/v1/links/${code}/reviews`, undefined, answer('needs_changes', { comment: 'On second listen, verse 4' }));
    const t = await setupToken(call);
    expect((await call('GET', '/api/v1/languages/din/passages/d2', t)).body.status).toBe('feedback');
    for (let i = 0; i < 8; i += 1) await call('POST', `/api/v1/links/${code}/reviews`, undefined, answer('looks_good', { submissionId: `more-${i}` }));
    expect((await call('POST', `/api/v1/links/${code}/reviews`, undefined, answer('looks_good', { submissionId: 'one-too-many' }))).body.code).toBe('full');
    expect(log.reviews('din').filter((r) => r['givenBy'] === 'Abuk')).toHaveLength(10);
  });

  it('is shared only by people who may send to reviewers, and never counts toward a checkpoint unless allowed', async () => {
    const { call } = setup();
    expect((await share(call, {}, 'dinka')).body.code).toBe('privilege');
    // Checkpoints refuse counting links by default; feedback links are fine.
    const consultant = { languageId: 'nus', unitId: 'n2', kindId: 'consultant' };
    expect((await share(call, consultant)).body.code).toBe('links_off');
    expect((await share(call, { ...consultant, counts: false })).status).toBe(200);
  });

  it('closes when revoked, when it expires, or when the sharer can no longer record it', async () => {
    const { call, log, advance } = setup();
    const made = await share(call, { expiresInDays: 1 });
    const code = codeOf(made.body.url);
    expect((await call('POST', `/api/v1/session/review-links/${made.body.id}/revoke`, 'jwt:rev')).status).toBe(404); // not theirs
    expect((await call('POST', `/api/v1/session/review-links/${made.body.id}/revoke`, 'jwt:tr')).status).toBe(200);
    expect((await call('POST', `/api/v1/links/${code}/reviews`, undefined, answer('looks_good'))).status).toBe(410);
    expect(await call('GET', `/api/v1/links/${code}`)).toEqual({ status: 410, body: { error: expect.any(String), code: 'closed' } });

    const later = codeOf((await share(call, { expiresInDays: 1 })).body.url);
    advance(86_400_000 + 1);
    expect((await call('POST', `/api/v1/links/${later}/reviews`, undefined, answer('looks_good'))).status).toBe(410);

    const third = codeOf((await share(call, {})).body.url);
    log.add('_org', 'v1.MemberRemoved', { profileId: 'tr', scope: { level: 'org' } });
    advance(61_000); // the organization's state catches up once a minute
    expect((await call('POST', `/api/v1/links/${third}/reviews`, undefined, answer('looks_good'))).status).toBe(410);
    expect((await call('GET', '/api/v1/links/notarealcodeatallxxxxx')).status).toBe(404);
  });

  it('stops playing, and taking clips, once its sharer leaves (decisions.md 77)', async () => {
    const { call, log, advance } = setup();
    const code = codeOf((await share(call, {})).body.url);
    expect((await call('GET', `/api/v1/links/${code}`)).body.audio).toHaveLength(2);
    log.add('_org', 'v1.MemberRemoved', { profileId: 'tr', scope: { level: 'org' } });
    advance(61_000);
    expect(await call('GET', `/api/v1/links/${code}`)).toEqual({ status: 410, body: { error: expect.any(String), code: 'closed' } });
    expect((await call('PUT', `/api/v1/links/${code}/voice-note`, undefined, undefined, m4a('after'))).status).toBe(410);
  });

  it('may be taken back by whoever assigns work in the language, not by anyone else', async () => {
    const { call } = setup();
    const made = await share(call, {});
    expect((await call('POST', `/api/v1/session/review-links/${made.body.id}/revoke`, 'jwt:dinka')).status).toBe(404);
    expect((await call('POST', `/api/v1/session/review-links/${made.body.id}/revoke`, 'jwt:admin')).status).toBe(200);
    expect((await call('GET', `/api/v1/links/${codeOf(made.body.url)}`)).status).toBe(410);
  });

  it('closes with the token it was shared with, and a person has only so many open', async () => {
    const { call, token, store } = setup();
    const t = await token('tr', { scopes: ['read', 'review'] });
    const made = await call('POST', '/api/v1/review-links', t, { languageId: 'din', unitId: 'd2', kindId: 'peer', counts: true });
    expect(made.status).toBe(200);
    const record = store.tokens.find((x) => x.profileId === 'tr')!;
    expect((await call('POST', `/api/v1/session/tokens/${record.id}/revoke`, 'jwt:tr')).status).toBe(200);
    expect((await call('GET', `/api/v1/links/${codeOf(made.body.url)}`)).status).toBe(410);

    for (let i = 0; i < 200; i += 1) store.links.push({ ...store.links[0]!, id: `filler-${i}`, codeHash: `h${i}`, tokenId: null, revokedAt: null });
    expect((await share(call, {})).body.code).toBe('too_many_links');
  });

  it('counts toward a step only while the step takes links', async () => {
    const { call, log, token } = setup();
    const code = codeOf((await share(call, {})).body.url);
    // A coordinator turns links off for the step after the link went out.
    log.add('din', 'v1.FlowStepLinksSet', { stepId: 'peer_only/s1', allowed: false });
    await call('POST', `/api/v1/links/${code}/reviews`, undefined, answer('looks_good'));
    expect(log.reviews('din').at(-1)).toMatchObject({ kindId: 'listener', givenBy: 'Abuk' });
    const t = await setupToken(call);
    expect((await call('GET', '/api/v1/languages/din/passages/d2', t)).body.status).toBe('in_review');
    // A token's review of that step is kept but completes nothing, and so does one appended by link directly.
    const partner = await token('admin', { scopes: ['read', 'review'] });
    expect((await call('POST', '/api/v1/languages/din/passages/d2/reviews', partner, { outcome: 'looks_good', reviewerId: 'p', kindId: 'peer' })).status).toBe(200);
    log.add('din', 'v1.ReviewRecorded', { reviewId: 'direct-link', takeId: 'take-d2', kindId: 'peer', outcome: 'looks_good', via: 'link' }, 'tr');
    expect((await call('GET', '/api/v1/languages/din/passages/d2', t)).body.status).toBe('in_review');
    // Turned back on, they count.
    log.add('din', 'v1.FlowStepLinksSet', { stepId: 'peer_only/s1', allowed: true });
    expect((await call('GET', '/api/v1/languages/din/passages/d2', t)).body.status).toBe('approved');
  });

  it('says nothing about a closed link but that it closed: not who it was for, nor the passage', async () => {
    const { call } = setup();
    const made = await share(call, { label: 'Pastor Deng' });
    await call('POST', `/api/v1/session/review-links/${made.body.id}/revoke`, 'jwt:tr');
    const page = await call('GET', `/api/v1/links/${codeOf(made.body.url)}`);
    expect(page.status).toBe(410);
    expect(JSON.stringify(page.body)).not.toMatch(/Pastor|Luke|Dinka|peer/);
  });

  it('will not attach audio stored long before, such as a recording since taken out of the record', async () => {
    const { call, log, advance } = setup();
    const code = codeOf((await share(call, {})).body.url);
    // A recording's file stays stored after a moderator redacts the recording.
    const old = 'c'.repeat(64);
    log.add('din', 'v1.BlobStored', { hash: old, size: 1200 }, 'service');
    advance(7 * 60 * 60 * 1000);
    const sent = await call('POST', `/api/v1/links/${code}/reviews`, undefined,
      answer('looks_good', { voiceNotes: [{ hash: old, durationMs: 1000, format: 'm4a' }] }));
    expect(sent.status).toBe(400);
    // A note just uploaded is attached as before.
    const note = (await call('PUT', `/api/v1/links/${code}/voice-note`, undefined, undefined, m4a('fresh'))).body.voiceNote;
    expect((await call('POST', `/api/v1/links/${code}/reviews`, undefined, answer('looks_good', { voiceNotes: [{ ...note, durationMs: 1000 }] }))).status).toBe(200);
  });

  it('takes a hundred voice clips an hour, far fewer than its writes', async () => {
    const { call } = setup();
    const code = codeOf((await share(call, { counts: false })).body.url);
    for (let i = 0; i < 100; i += 1) {
      expect((await call('PUT', `/api/v1/links/${code}/voice-note`, undefined, undefined, m4a(`clip-${i}`))).status).toBe(200);
    }
    expect((await call('PUT', `/api/v1/links/${code}/voice-note`, undefined, undefined, m4a('one-more'))).status).toBe(429);
  });

  it('takes a voice note phones can play, and nothing else', () => {
    const wav = new Uint8Array(44 + 32000);
    const v = new DataView(wav.buffer);
    [...'RIFF'].forEach((c, i) => (wav[i] = c.charCodeAt(0)));
    [...'WAVEfmt '].forEach((c, i) => (wav[8 + i] = c.charCodeAt(0)));
    v.setUint32(16, 16, true); v.setUint32(28, 32000, true);
    [...'data'].forEach((c, i) => (wav[36 + i] = c.charCodeAt(0)));
    v.setUint32(40, 32000, true);
    expect(sniffVoiceNote(wav)).toEqual({ format: 'wav', durationMs: 1000 });
    const m4a = new Uint8Array(32);
    [...'ftypM4A '].forEach((c, i) => (m4a[4 + i] = c.charCodeAt(0)));
    expect(sniffVoiceNote(m4a)?.format).toBe('m4a');
    expect(sniffVoiceNote(new TextEncoder().encode('\x1aE\xdf\xa3 webm, which iPhones do not play'))).toBeNull();
  });
});

/** A tiny MP4 header: enough for the format check, different bytes per name. */
function m4a(name: string): Uint8Array {
  const b = new Uint8Array(32 + name.length);
  [...'ftypM4A '].forEach((c, i) => (b[4 + i] = c.charCodeAt(0)));
  [...name].forEach((c, i) => (b[32 + i] = c.charCodeAt(0)));
  return b;
}

/** A read token for checking what a link did. */
async function setupToken(call: Awaited<ReturnType<typeof setup>>['call']) {
  const r = await call('POST', '/api/v1/session/tokens', 'jwt:admin', { orgId: ORG, name: 'check', scopes: ['read'] });
  return r.body.token as string;
}

describe('the device flow', () => {
  it('lets an app ask, a person narrow and approve, and the app poll its way to a working token', async () => {
    const { call, store, advance } = setup();
    const asked = await call('POST', '/api/v1/device/code', undefined, { clientName: 'Every Language Listener', scopes: ['read', 'review', 'release'] });
    expect(asked.status).toBe(200);
    expect(asked.body.verification_uri_complete).toBe(`https://lq.test/connect?code=${encodeURIComponent(asked.body.user_code)}`);
    const poll = () => call('POST', '/api/v1/device/token', undefined, { device_code: asked.body.device_code });
    expect((await poll()).body.error).toBe('authorization_pending');
    expect((await poll()).body.error).toBe('slow_down');
    expect((await call('GET', '/api/v1/languages', asked.body.device_code)).status).toBe(401); // not yet

    const code = asked.body.user_code.toLowerCase().replace('-', ' '); // as a person might type it
    const seen = await call('GET', `/api/v1/session/device/${encodeURIComponent(code)}`, 'jwt:rev');
    expect(seen.body).toMatchObject({ clientName: 'Every Language Listener', state: 'pending', requestedScopes: ['read', 'review', 'release'] });
    // A person may narrow what the app asked for, never widen it.
    const decide = (scopes: string[]) => call('POST', `/api/v1/session/device/${encodeURIComponent(code)}`, 'jwt:rev', { decision: 'approve', orgId: ORG, scopes, languageIds: ['din'] });
    expect((await decide(['read:published', 'read'])).status).toBe(400);
    expect((await decide(['read', 'review'])).status).toBe(200);
    expect((await decide(['read'])).status).toBe(409); // already decided

    advance(5000);
    const done = await poll();
    expect(done.body).toMatchObject({ access_token: asked.body.device_code, token_type: 'Bearer', scope: 'read review', language_ids: ['din'] });
    const langs = await call('GET', '/api/v1/languages', done.body.access_token);
    expect(langs.body.map((l: any) => [l.languageId, l.can])).toEqual([['din', { read: 'all', review: true, release: false, externalValues: { read: true, write: false } }]]);
    expect(store.tokens[0]!.tokenHash).toBe(await hashSecret(asked.body.device_code));
    expect(store.tokens[0]!.clientName).toBe('Every Language Listener');
  });

  it('never leaves a working token behind when an approval and a denial cross', async () => {
    const { call, store } = setup();
    const a = await call('POST', '/api/v1/device/code', undefined, { clientName: 'Agent', scopes: ['read'] });
    // Someone denies in another tab after this page loaded the request as pending.
    const real = store.decideGrant.bind(store);
    store.decideGrant = async (id, d) => {
      await real(id, { deniedAt: new Date(T0).toISOString() });
      return real(id, d);
    };
    const r = await call('POST', `/api/v1/session/device/${a.body.user_code}`, 'jwt:admin', { decision: 'approve', orgId: ORG, scopes: ['read'] });
    expect(r.status).toBe(409);
    expect((await call('GET', '/api/v1/languages', a.body.device_code)).body.code).toBe('revoked');
  });

  it('tells the app when a person denies it or nobody answers', async () => {
    const { call, advance } = setup();
    const a = await call('POST', '/api/v1/device/code', undefined, { client_name: 'Agent', scope: 'read' });
    await call('POST', `/api/v1/session/device/${a.body.user_code}`, 'jwt:admin', { decision: 'deny' });
    expect((await call('POST', '/api/v1/device/token', undefined, { device_code: a.body.device_code })).body.error).toBe('access_denied');
    const b = await call('POST', '/api/v1/device/code', undefined, { clientName: 'Agent' });
    advance(16 * 60 * 1000);
    expect((await call('POST', '/api/v1/device/token', undefined, { device_code: b.body.device_code })).body.error).toBe('expired_token');
    expect((await call('POST', '/api/v1/device/code', undefined, { clientName: 'Agent', scopes: ['admin'] })).body.code).toBe('invalid_scope');
  });
});

describe('MCP', () => {
  const rpc = (id: number, method: string, params: unknown = {}) => ({ jsonrpc: '2.0', id, method, params });

  it('offers only the tools the token may use, and answers them from the same API', async () => {
    const { call, token } = setup();
    const t = await token('rev', { scopes: ['read:published', 'review'] });
    const init = await call('POST', '/api/v1/mcp', t, rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }));
    expect(init.body.result.protocolVersion).toBe('2025-06-18');
    expect((await call('POST', '/api/v1/mcp', t, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    const tools = (await call('POST', '/api/v1/mcp', t, rpc(2, 'tools/list'))).body.result.tools.map((x: any) => x.name);
    expect(tools).toEqual(['whoami', 'list_languages', 'list_passages', 'get_passage', 'record_review']);
    const listed = await call('POST', '/api/v1/mcp', t, rpc(3, 'tools/call', { name: 'list_passages', arguments: { languageId: 'din' } }));
    expect(JSON.parse(listed.body.result.content[0].text).passages.map((p: any) => p.unitId)).toEqual(['d1']);
    const sent = await call('POST', '/api/v1/mcp', t, rpc(4, 'tools/call', { name: 'record_review', arguments: { languageId: 'din', unitId: 'd1', outcome: 'looks_good', comment: 'Clear' } }));
    expect(sent.body.result.isError).toBe(false);
    const flood = Array.from({ length: 21 }, (_, i) => rpc(100 + i, 'tools/call', { name: 'list_languages', arguments: {} }));
    expect((await call('POST', '/api/v1/mcp', t, flood)).status).toBe(400);
    const refused = await call('POST', '/api/v1/mcp', t, rpc(5, 'tools/call', { name: 'report_release', arguments: {} }));
    expect(refused.body.error.code).toBe(-32602);
    // Stateless: closing a session is accepted and changes nothing.
    expect((await call('DELETE', '/api/v1/mcp', t)).status).toBe(204);
  });

  it('takes include, unitIds, limit and after on list_passages, as the REST route does', async () => {
    const { call, token } = setup();
    const t = await token('admin', { scopes: ['read'] });
    const tool = async (id: number, name: string, args: unknown) => (await call('POST', '/api/v1/mcp', t, rpc(id, 'tools/call', { name, arguments: args }))).body.result;
    const listed = JSON.parse((await tool(1, 'list_passages', { languageId: 'din', status: 'in_review', include: ['steps', 'requests'] })).content[0].text);
    expect(listed).toMatchObject({ passages: [{ unitId: 'd2', steps: [{ name: 'Peer Review', complete: false }], requests: [] }], nextAfter: null });
    const page = JSON.parse((await tool(2, 'list_passages', { languageId: 'din', unitIds: ['d3', 'd1'], limit: 1 })).content[0].text);
    expect(page).toMatchObject({ passages: [{ unitId: 'd1' }], nextAfter: 'd1' });
    const next = JSON.parse((await tool(3, 'list_passages', { languageId: 'din', unitIds: ['d3', 'd1'], limit: 1, after: 'd1' })).content[0].text);
    expect(next).toMatchObject({ passages: [{ unitId: 'd3' }], nextAfter: null });
    expect((await tool(4, 'list_passages', { languageId: 'din', include: 'steps' })).isError).toBe(true);
    expect((await tool(5, 'list_passages', { languageId: 'din', limit: 2.5 })).isError).toBe(true);
    expect((await tool(6, 'list_passages', { languageId: 'din', unitIds: 'd1' })).isError).toBe(true);
  });
});

describe('external values (decisions.md 79)', () => {
  const KEY = 'org.everylanguage.listening/plays/d1/2026-10-08';
  const at = (key = KEY) => `/api/v1/languages/din/external-values/${key}`;

  it('stores a value under a key, as the token\'s person, and reads it back labelled with its app', async () => {
    const { call, token, log } = setup();
    const t = await token('tr', { scopes: ['external_values'], name: 'Every Language Listener' });
    const put = await call('PUT', at(), t, { data: { count: 40 } });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ key: KEY, data: { count: 40 }, writtenBy: { profileId: 'tr', tokenId: 'tok1', app: 'Every Language Listener' } });
    // An ordinary event in the language's log, from the token's own device.
    const written = log.streams.get('din')!.filter((e) => e.type === 'v1.ExternalValueSet');
    expect(written).toMatchObject([{ actorId: 'tr', deviceId: 'api-tok1', payload: { key: KEY, data: { count: 40 } } }]);
    // The newest write to a key wins.
    await call('PUT', at(), t, { data: { count: 42 } });
    expect((await call('GET', at(), t)).body).toMatchObject({ data: { count: 42 } });
  });

  it('lists by key prefix, page by page, and shows deletions only to a reader following changes', async () => {
    const { call, token, advance } = setup();
    const t = await token('tr', { scopes: ['external_values'] });
    await call('PUT', at(), t, { data: { count: 40 } });
    await call('PUT', at('org.everylanguage.listening/playlist/7'), t, { data: { title: 'Luke for children' } });
    await call('PUT', at('org.other.app/state'), t, { data: { x: 1 } });
    const plays = await call('GET', '/api/v1/languages/din/external-values?keyPrefix=org.everylanguage.listening/', t);
    expect(plays.body.values.map((v: any) => v.key)).toEqual(['org.everylanguage.listening/playlist/7', KEY]);
    expect(plays.body.nextAfter).toBeNull();
    const before = new Date(T0 + 10_000_000).toISOString();
    advance(1000);
    expect((await call('DELETE', at('org.everylanguage.listening/playlist/7'), t)).body).toEqual({ key: 'org.everylanguage.listening/playlist/7', deleted: true });
    expect((await call('GET', at('org.everylanguage.listening/playlist/7'), t)).body.code).toBe('no_value');
    expect((await call('GET', '/api/v1/languages/din/external-values', t)).body.values.map((v: any) => v.key)).toEqual([KEY, 'org.other.app/state']);
    // A follower asking what changed since its last look learns the key is gone.
    const changed = await call('GET', `/api/v1/languages/din/external-values?changedSince=${before}`, t);
    expect(changed.body.values).toMatchObject([{ key: 'org.everylanguage.listening/playlist/7', data: null }]);
  });

  it('is written only with the scope, by someone who contributes to the language, and read with read or the scope', async () => {
    const { call, token } = setup();
    // A viewer contributes nothing, so cannot be given the scope at all.
    expect((await call('POST', '/api/v1/session/tokens', 'jwt:dinka', { orgId: ORG, name: 'x', scopes: ['external_values'] })).status).toBe(400);
    const reader = await token('rev', { scopes: ['read'] });
    expect((await call('PUT', at(), reader, { data: { count: 1 } })).body.code).toBe('scope');
    const listener = await token('rev', { scopes: ['read:published'] });
    expect((await call('GET', '/api/v1/languages/din/external-values', listener)).body.code).toBe('scope');
    const dinkaOnly = await token('tr', { scopes: ['external_values'], languageIds: ['din'] });
    expect((await call('PUT', '/api/v1/languages/nus/external-values/a', dinkaOnly, { data: {} })).body.code).toBe('no_language');
    const writer = await token('tr', { scopes: ['external_values'] });
    await call('PUT', at(), writer, { data: { count: 1 } });
    expect((await call('GET', at(), reader)).body.data).toEqual({ count: 1 });
  });

  it('refuses keys that would not read back as a path, and data that is not a small object', async () => {
    const { call, token } = setup();
    const t = await token('tr', { scopes: ['external_values'] });
    expect((await call('PUT', at('a%20b'), t, { data: {} })).body.code).toBe('bad_key');
    expect((await call('PUT', at('a%3Fb'), t, { data: {} })).body.code).toBe('bad_key');
    expect((await call('PUT', at(`a/${'x'.repeat(256)}`), t, { data: {} })).body.code).toBe('bad_key');
    expect((await call('PUT', at(), t, { data: [1] })).body.code).toBe('bad_request');
    expect((await call('PUT', at(), t, { count: 1 })).body.code).toBe('bad_request');
    expect((await call('PUT', at(), t, { data: { text: 'x'.repeat(5000) } })).status).toBe(413);
    expect((await call('POST', at(), t, { data: {} })).status).toBe(405);
  });

  it('offers the same over MCP', async () => {
    const { call, token } = setup();
    const rpc = (id: number, method: string, params: unknown = {}) => ({ jsonrpc: '2.0', id, method, params });
    const t = await token('tr', { scopes: ['external_values'], name: 'Agent' });
    const tools = (await call('POST', '/api/v1/mcp', t, rpc(1, 'tools/list'))).body.result.tools.map((x: any) => x.name);
    expect(tools).toEqual(expect.arrayContaining(['set_external_value', 'get_external_values']));
    const set = await call('POST', '/api/v1/mcp', t, rpc(2, 'tools/call', { name: 'set_external_value', arguments: { languageId: 'din', key: 'agent/notes', data: { seen: true } } }));
    expect(set.body.result.isError).toBe(false);
    const got = await call('POST', '/api/v1/mcp', t, rpc(3, 'tools/call', { name: 'get_external_values', arguments: { languageId: 'din', keyPrefix: 'agent/' } }));
    expect(JSON.parse(got.body.result.content[0].text).values).toMatchObject([{ key: 'agent/notes', data: { seen: true }, writtenBy: { app: 'Agent' } }]);
    const gone = await call('POST', '/api/v1/mcp', t, rpc(4, 'tools/call', { name: 'set_external_value', arguments: { languageId: 'din', key: 'agent/notes', data: null } }));
    expect(JSON.parse(gone.body.result.content[0].text)).toEqual({ key: 'agent/notes', deleted: true });
  });
});

describe('webhooks and the change feed (decisions.md 101)', () => {
  const HOOK = 'https://app.example/langquest';
  const make = async (call: Awaited<ReturnType<typeof setup>>['call'], t: string, events: string[], extra: Record<string, unknown> = {}) => {
    const r = await call('POST', '/api/v1/webhooks', t, { url: HOOK, events, ...extra });
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    return r.body as { webhookId: string; secret: string };
  };

  it('nudges once per language and kind for a burst of takes, signed, with ids and a cursor and never the content', async () => {
    const { log, call, token, tick, received } = setup();
    const t = await token('rev', { scopes: ['read'] });
    const { secret } = await make(call, t, ['passage.version.submitted']);
    // A recording session: two takes before anyone looks.
    recorded(log, 'din', 'd3', { take: 'take-d3b' });
    recorded(log, 'din', 'd4');
    await tick();
    expect(received).toHaveLength(1);
    const [got] = received;
    expect(got!.url).toBe(HOOK);
    expect(Object.keys(got!.body).sort()).toEqual(['cursor', 'id', 'languageId', 'occurredAt', 'orgId', 'type', 'unitIds']);
    expect(got!.body).toMatchObject({ type: 'passage.version.submitted', orgId: ORG, languageId: 'din', unitIds: ['d3', 'd4'] });
    expect(got!.headers['langquest-event-id']).toBe(got!.body.id);
    // The app checks the signature with its secret, over the exact bytes sent.
    const t0 = Number(/t=(\d+)/.exec(got!.headers['langquest-signature']!)![1]);
    expect(got!.headers['langquest-signature']).toBe(await signature(secret, t0, got!.raw));
    await tick();
    expect(received).toHaveLength(1);
  });

  it('lists every change in order, deletions and late pushes included, so a missed delivery or an outage loses nothing', async () => {
    const { log, call, token } = setup();
    const t = await token('rev', { scopes: ['read'] });
    const start = await call('GET', '/api/v1/languages/din/changes', t);
    expect(start.body.changes).toEqual([]);
    log.add('din', 'v1.UnitHidden', { unitId: 'd4', hidden: true });
    log.add('din', 'v1.ReviewRecorded', { reviewId: 'peer-take-d2', takeId: 'take-d2', kindId: 'peer', outcome: 'looks_good', via: 'app' }, 'rev');
    // A phone three days offline shares its take now; its clock says three days ago.
    log.push({ id: 'late', type: 'v1.TakeSubmitted', orgId: ORG, streamId: 'din', actorId: 'tr', deviceId: 'offline', hlc: encodeHlc(T0 - 3 * 86_400_000, 0, 'offline'), payload: { takeId: 'take-d3' } } as AnyEvent);
    const page = await call('GET', `/api/v1/languages/din/changes?after=${start.body.cursor}`, t);
    expect(page.body.changes.map((c: { type: string; unitId: string }) => [c.type, c.unitId])).toEqual([
      ['unit.deleted', 'd4'],
      ['passage.status.changed', 'd2'],
      ['passage.review.created', 'd2'],
      ['passage.version.submitted', 'd3'],
      ['passage.status.changed', 'd3']
    ]);
    expect(page.body.more).toBe(false);
    const again = await call('GET', `/api/v1/languages/din/changes?after=${page.body.cursor}`, t);
    expect(again.body.changes).toEqual([]);
    const paged = await call('GET', `/api/v1/languages/din/changes?after=${start.body.cursor}&limit=2`, t);
    expect(paged.body).toMatchObject({ more: true, cursor: paged.body.changes[1].cursor });
  });

  it('needs read, and says when a cursor is older than the changes kept', async () => {
    const { log, call, token, tick, advance } = setup();
    const published = await token('rev', { scopes: ['read:published'] });
    expect((await call('GET', '/api/v1/languages/din/changes', published)).body.code).toBe('scope');
    expect((await call('POST', '/api/v1/webhooks', published, { url: HOOK, events: ['unit.created'] })).body.code).toBe('scope');
    const t = await token('rev', { scopes: ['read'] });
    await make(call, t, ['unit.created']);
    const start = await call('GET', '/api/v1/languages/din/changes', t);
    expect((await call('GET', '/api/v1/languages/din/changes?after=x', t)).status).toBe(400);
    recorded(log, 'din', 'd4');
    expect((await call('GET', `/api/v1/languages/din/changes?after=${start.body.cursor}`, t)).body.changes.length).toBeGreaterThan(0);
    advance(91 * 86_400_000);
    await tick();
    expect((await call('GET', `/api/v1/languages/din/changes?after=${start.body.cursor}`, t))).toMatchObject({ status: 410, body: { code: 'cursor_expired' } });
  });

  it('retries a failing app with the same event id for a day, then stops the webhook and says why', async () => {
    const { log, call, token, tick, received, answer, advance, dispatcher, store, runs } = setup();
    const t = await token('rev', { scopes: ['read'] });
    const { webhookId } = await make(call, t, ['passage.version.submitted']);
    answer(500);
    recorded(log, 'din', 'd4');
    await tick();
    expect(received).toHaveLength(1);
    await dispatcher.deliverDue();
    expect(received).toHaveLength(1);
    for (let i = 1; i < RETRY_AT_MS.length; i++) {
      advance(RETRY_AT_MS[i]! - RETRY_AT_MS[i - 1]!);
      await dispatcher.deliverDue();
      expect(received).toHaveLength(i + 1);
    }
    expect(new Set(received.map((r) => r.body.id)).size).toBe(1);
    expect(store.webhooks[0]!.disabledReason).toMatch(/failed for a day/);
    // Each batch is a job run for support (diag.jobs), counts only: no address, no body.
    expect(runs).toHaveLength(RETRY_AT_MS.length);
    expect(runs.every((r) => r.job === 'webhook_dispatch' && r.outcome === 'partial' && r.orgId === ORG)).toBe(true);
    expect(runs.at(-1)!.n).toMatchObject({ attempts: 1, answered5xx: 1, answered2xx: 0, stopped: 1 });
    expect(JSON.stringify(runs)).not.toContain('https://');
    const log2 = await call('GET', `/api/v1/webhooks/${webhookId}/deliveries`, t);
    expect(log2.body.pending).toBe(0);
    expect(log2.body.deliveries).toHaveLength(RETRY_AT_MS.length);
    expect(log2.body.deliveries[0]).toMatchObject({ status: 500, attempt: RETRY_AT_MS.length });
    expect((await call('POST', `/api/v1/webhooks/${webhookId}/ping`, t)).body.code).toBe('disabled');
  });

  it('tells an app its token was revoked, as its webhook\'s last delivery', async () => {
    const { log, call, token, tick, received, dispatcher, store } = setup();
    const t = await token('rev', { scopes: ['read'] });
    await make(call, t, ['token.revoked', 'passage.version.submitted']);
    expect((await call('DELETE', '/api/v1/token', t)).body).toEqual({ revoked: true });
    await dispatcher.deliverDue();
    expect(received.map((r) => r.body)).toEqual([expect.objectContaining({ type: 'token.revoked', tokenId: store.tokens[0]!.id, reason: 'revoked' })]);
    expect((await call('GET', '/api/v1/me', t)).body.code).toBe('revoked');
    recorded(log, 'din', 'd4');
    await tick();
    expect(received).toHaveLength(1);
  });

  it('says when the languages a token reaches change, as its person gains or loses them', async () => {
    const { log, call, token, tick, received } = setup();
    const t = await token('dinka', { scopes: ['read'] });
    await make(call, t, ['language.added', 'language.removed']);
    log.add('_org', 'v1.MemberAdded', { profileId: 'dinka', roleId: 'viewer', scope: { level: 'language', languageId: 'nus' } });
    await tick();
    log.add('_org', 'v1.MemberRemoved', { profileId: 'dinka', scope: { level: 'language', languageId: 'din' } });
    await tick();
    expect(received.map((r) => [r.body.type, r.body.languageId])).toEqual([['language.added', 'nus'], ['language.removed', 'din']]);
  });

  it('belongs to its token: made with a public https address in its languages, pinged, listed without the secret, deleted', async () => {
    const { log, call, token, tick, received } = setup();
    const t = await token('dinka', { scopes: ['read'] });
    for (const bad of [{ url: 'http://app.example/x' }, { url: 'https://127.0.0.1/x' }, { url: 'https://localhost./x' }, { events: ['unit.moved'] }, { languageIds: ['nus'] }]) {
      expect((await call('POST', '/api/v1/webhooks', t, { url: HOOK, events: ['unit.created'], ...bad })).status).toBe(400);
    }
    const { webhookId, secret } = await make(call, t, ['unit.created'], { languageIds: ['din'] });
    expect(secret).toMatch(/^whsec_/);
    const listed = await call('GET', '/api/v1/webhooks', t);
    expect(listed.body.webhooks).toEqual([expect.objectContaining({ id: webhookId, languageIds: ['din'] })]);
    expect(JSON.stringify(listed.body)).not.toContain(secret);
    expect((await call('GET', `/api/v1/webhooks/${webhookId}`, t)).body.id).toBe(webhookId);
    const ping = await call('POST', `/api/v1/webhooks/${webhookId}/ping`, t);
    expect(ping.body.delivery).toMatchObject({ type: 'ping', status: 200, attempt: 1 });
    expect(received.at(-1)!.body).toMatchObject({ type: 'ping', webhookId });
    expect((await call('GET', `/api/v1/webhooks/${webhookId}/deliveries`, t)).body.deliveries[0].type).toBe('ping');
    const other = await token('rev', { scopes: ['read'] });
    expect((await call('GET', `/api/v1/webhooks/${webhookId}`, other)).status).toBe(404);
    expect((await call('DELETE', `/api/v1/webhooks/${webhookId}`, t)).body).toEqual({ id: webhookId, deleted: true });
    log.add('din', 'v1.UnitAdded', unit('d5', 'Luke 5'));
    await tick();
    expect(received).toHaveLength(1);
  });

  it('names the organization in /me, and gives each passage its kind, order and verses, so an app need not parse unit ids', async () => {
    const { call, token } = setup();
    const t = await token('rev', { scopes: ['read'] });
    expect((await call('GET', '/api/v1/me', t)).body.org).toEqual({ id: ORG, name: 'Org' });
    const d1 = (await call('GET', '/api/v1/languages/din/passages/d1', t)).body;
    expect(d1).toMatchObject({ kind: 'passage', order: 'd1', reference: null });
    expect(referenceOf('bsb/GEN.1.1-2.3~org')).toEqual({ book: 'GEN', chapter: 1, verse: 1, endChapter: 2, endVerse: 3 });
    expect(referenceOf('bsb/MAT.5')).toEqual({ book: 'MAT', chapter: 5, verse: null, endChapter: 5, endVerse: null });
    expect(referenceOf('bsb/MRK')).toEqual({ book: 'MRK', chapter: null, verse: null, endChapter: null, endVerse: null });
  });
});

describe('the OpenAPI document (decisions.md 86)', () => {
  it('is served without a token, linked from the index, and every schema in it compiles', async () => {
    const { call } = setup();
    const spec = await call('GET', '/api/v1/openapi.json');
    expect(spec.body).toMatchObject({ openapi: '3.1.0', servers: [{ url: 'https://lq.test/api/v1' }] });
    expect((await call('GET', '/api/v1')).body.openapi).toBe('https://lq.test/api/v1/openapi.json');
    compileAll();
  });

  it('is valid OpenAPI 3.1, by the OpenAPI Initiative\'s own schema', () => {
    expect(openApiProblems()).toBeNull();
  });

  // Last in the file: the tests above went through check() on every call.
  it('was reached in every operation by the tests above', () => {
    expect(uncovered()).toEqual([]);
  });
});
