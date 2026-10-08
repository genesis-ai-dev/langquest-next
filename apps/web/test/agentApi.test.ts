import {
  encodeHlc, foldOrg, privilegeAllows, privilegeFor, privilegesFor, SEED_ROLES, type AnyEvent
} from '@langquest-next/core';
import type { AppendResult } from '@langquest-next/client';
import { handleAgentApi, type AgentDeps, type OrgStub } from '../worker/agent/http';
import { AgentOrg } from '../worker/agent/org';
import type { AgentStore, DeviceGrant, NewToken, TokenRecord } from '../worker/agent/store';
import { hashSecret } from '../worker/agent/tokens';
import { MemoryCache, OrgFolder, type Source } from '../worker/orgFolder';

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
 * not started. Nuer (nus) with n1 approved. 'admin' runs the organization,
 * 'rev' reviews everywhere, 'dinka' only views Dinka.
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
  log.add('din', 'v1.UnitAdded', unit('d1', 'Luke 1'));
  log.add('din', 'v1.UnitAdded', unit('d2', 'Luke 2'));
  log.add('din', 'v1.UnitAdded', unit('d3', 'Luke 3'));
  log.add('din', 'v1.UnitAdded', unit('d4', 'Luke 4'));
  log.add('nus', 'v1.UnitAdded', unit('n1', 'Luke 1'));
  recorded(log, 'din', 'd1', { approve: true });
  recorded(log, 'din', 'd2');
  recorded(log, 'din', 'd3', { submit: false });
  recorded(log, 'nus', 'n1', { approve: true });
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
    return !!t;
  }
  async touchToken(id: string, at: string) { const t = this.tokens.find((x) => x.id === id); if (t) t.lastUsedAt = at; }
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
}

function setup() {
  const log = world();
  const store = new MemoryStore();
  let now = T0 + 10_000_000;
  const agent = new AgentOrg(new OrgFolder(log, ORG, new MemoryCache(), () => now, 0), ORG, {
    append: (events) => log.append(events),
    sign: async (key) => ({ url: `https://lq.test/api/blobs/${key}?sig=x`, expiresAt: now + 600_000 }),
    now: () => now
  });
  const deps: AgentDeps = {
    store,
    // A signed-in session is "jwt:<profile>" here.
    profileOf: async (jwt) => (jwt.startsWith('jwt:') ? jwt.slice(4) : null),
    org: (orgId) => (orgId === ORG ? agent : { read: async () => ({ ok: false, status: 404, code: 'x', error: 'x' }), write: async () => ({ ok: false, status: 404, code: 'x', error: 'x' }), access: async () => null }) as OrgStub,
    saveVoiceNote: async () => 'f'.repeat(64),
    now: () => now
  };
  const call = async (method: string, path: string, auth?: string, body?: unknown) => {
    const res = await handleAgentApi(new Request(`https://lq.test${path}`, {
      method, headers: { ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    }), deps);
    return { status: res.status, body: (res.status === 202 ? null : await res.json()) as any };
  };
  /** A token made on the connect page by `profileId`. */
  const token = async (profileId: string, spec: Record<string, unknown>) => {
    const r = await call('POST', '/api/v1/session/tokens', `jwt:${profileId}`, { orgId: ORG, name: 'test', ...spec });
    if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    return r.body.token as string;
  };
  return { log, store, call, token, advance: (ms: number) => { now += ms; } };
}

describe('reading', () => {
  it('gives a read:published token approved passages only, with their audio in playing order', async () => {
    const { call, token } = setup();
    const t = await token('admin', { scopes: ['read:published'] });
    const list = await call('GET', '/api/v1/languages/din/passages', t);
    expect(list.status).toBe(200);
    // d2 (in review), d3 (draft) and d4 (not started) must never reach a listening app.
    expect(list.body.map((p: any) => [p.unitId, p.status])).toEqual([['d1', 'approved']]);
    expect(list.body[0].path).toEqual(['Luke']);
    expect(list.body[0].version.durationMs).toBe(4000);

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
    const t = await token('admin', { scopes: ['read:published', 'feedback'] });
    // The team view still calls d1 done after a re-record: its peer kind's latest review approves.
    recorded(log, 'din', 'd1', { take: 'take-d1-v2' });
    const one = await call('GET', '/api/v1/languages/din/passages/d1', t);
    expect(one.body.version).toMatchObject({ n: 1, takeId: 'take-d1' });
    expect(one.body.audio.map((a: any) => a.hash)).toEqual([card('d1a').hash, card('d1b').hash]);
    expect((await call('POST', '/api/v1/languages/din/passages/d1/feedback', t, { outcome: 'looks_good', listenerId: 'a', takeId: 'take-d1-v2' })).status).toBe(404);
    // Feedback answered by a revision is "addressed" for the team, but nobody approved the revision.
    const reader = await token('admin', { scopes: ['read'] });
    log.add('din', 'v1.ReviewRecorded', { reviewId: 'peer-d2-no', takeId: 'take-d2', kindId: 'peer', outcome: 'needs_changes', via: 'app' }, 'rev');
    recorded(log, 'din', 'd2', { take: 'take-d2-v2' });
    expect((await call('GET', '/api/v1/languages/din/passages/d2', reader)).body).toMatchObject({ status: 'approved', approvedVersion: null });
    expect((await call('GET', '/api/v1/languages/din/passages/d2', t)).status).toBe(404);
  });

  it('gives a read token every passage, with reviews and steps', async () => {
    const { call, token } = setup();
    const t = await token('admin', { scopes: ['read'] });
    const list = await call('GET', '/api/v1/languages/din/passages', t);
    expect(list.body.map((p: any) => [p.unitId, p.status])).toEqual([['d1', 'approved'], ['d2', 'in_review'], ['d3', 'drafting'], ['d4', 'not_started']]);
    expect(list.body[2].version).toBeNull();
    expect((await call('GET', '/api/v1/languages/din/passages?status=in_review', t)).body.map((p: any) => p.unitId)).toEqual(['d2']);
    const d1 = await call('GET', '/api/v1/languages/din/passages/d1', t);
    expect(d1.body.reviews.map((r: any) => [r.kind, r.outcome])).toEqual([['Peer Review', 'looks_good']]);
    expect(d1.body.steps).toEqual([{ name: 'Peer Review', complete: true }]);
  });

  it('links a voice note recorded in a browser under its real format (decisions.md 71)', async () => {
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
    expect(d2.body.reviews[0].voiceNote.url).toBe(`https://lq.test/api/blobs/${ORG}/din/${web}.wav?sig=x`);
    const d1 = await call('GET', '/api/v1/languages/din/passages/d1', t);
    expect(d1.body.reviews.find((r: any) => r.voiceNote).voiceNote.url).toBe(`https://lq.test/api/blobs/${ORG}/din/${phone}.m4a?sig=x`);
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
    const newest = first.body.map((p: any) => p.updatedAt).filter(Boolean).sort().at(-1);
    expect((await call('GET', `/api/v1/languages/din/passages?changedSince=${newest}`, t)).body).toEqual([]);
    log.add('din', 'v1.ReviewRecorded', { reviewId: 'peer-d2', takeId: 'take-d2', kindId: 'peer', outcome: 'looks_good', via: 'app' }, 'rev');
    const changed = await call('GET', `/api/v1/languages/din/passages?changedSince=${newest}`, t);
    expect(changed.body.map((p: any) => [p.unitId, p.status])).toEqual([['d2', 'approved']]);
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

describe('writing', () => {
  it('records listener feedback as a review by the token\'s person, once per listener and outcome', async () => {
    const { call, token, log } = setup();
    const t = await token('rev', { scopes: ['read:published', 'feedback'] });
    const path = '/api/v1/languages/din/passages/d1/feedback';
    const first = await call('POST', path, t, { outcome: 'looks_good', listenerId: 'device-42', listenerName: 'Mary' });
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBe(false);
    expect(first.body.passage.listenerFeedback).toEqual({ looksGood: 1, needsChanges: 0 });
    // The same tap again, or an app's retry, records nothing new.
    expect((await call('POST', path, t, { outcome: 'looks_good', listenerId: 'device-42' })).body.duplicate).toBe(true);
    await call('POST', path, t, { outcome: 'needs_changes', listenerId: 'device-7', comment: 'Verse 3 is hard to follow' });
    const listener = log.reviews('din').filter((r) => r['kindId'] === 'listener');
    expect(listener).toHaveLength(2);
    expect(listener[0]).toMatchObject({ actorId: 'rev', via: 'link', givenBy: 'Mary', takeId: 'take-d1', outcome: 'looks_good' });
    // The app's own listener ids never reach the log.
    expect(JSON.stringify(log.streams.get('din'))).not.toContain('device-42');
  });

  it('will not attach audio already in the language as a voice note, which would hand out a link to it', async () => {
    const { call, token } = setup();
    const t = await token('rev', { scopes: ['read:published', 'feedback'] });
    // d2's cards are unapproved; a published-only token must not get a link to them this way.
    const r = await call('POST', '/api/v1/languages/din/passages/d1/feedback', t, { outcome: 'needs_changes', listenerId: 'a', voiceNoteHash: card('d2a').hash });
    expect(r.status).toBe(400);
  });

  it('lets a team hear about needs-changes on a version in review', async () => {
    const { call, token } = setup();
    const t = await token('rev', { scopes: ['read', 'feedback'] });
    await call('POST', '/api/v1/languages/din/passages/d2/feedback', t, { outcome: 'needs_changes', listenerId: 'a', comment: 'Too fast' });
    const d2 = await call('GET', '/api/v1/languages/din/passages/d2', t);
    expect(d2.body.status).toBe('feedback');
    expect(d2.body.reviews.at(-1)).toMatchObject({ kind: 'Listener', comment: 'Too fast', via: 'link' });
  });

  it('refuses writes the scopes or the person do not allow', async () => {
    const { call, token } = setup();
    const readOnly = await token('rev', { scopes: ['read:published'] });
    expect((await call('POST', '/api/v1/languages/din/passages/d1/feedback', readOnly, { outcome: 'looks_good', listenerId: 'a' })).body.code).toBe('scope');
    // A viewer cannot review, so cannot be given feedback at all...
    expect((await call('POST', '/api/v1/session/tokens', 'jwt:dinka', { orgId: ORG, name: 'x', scopes: ['feedback'] })).status).toBe(400);
    // ...and a published-only token cannot answer what it cannot see.
    const listen = await token('rev', { scopes: ['read:published', 'feedback'] });
    expect((await call('POST', '/api/v1/languages/din/passages/d2/feedback', listen, { outcome: 'looks_good', listenerId: 'a' })).status).toBe(404);
    expect((await call('POST', '/api/v1/languages/din/passages/d1/feedback', listen, { outcome: 'great' })).status).toBe(400);
  });

  it('marks an approved passage ready for publication, and a new version starts without it', async () => {
    const { call, token, log } = setup();
    const t = await token('admin', { scopes: ['read', 'publish'] });
    expect((await call('POST', '/api/v1/languages/din/passages/d2/publication', t, { ready: true })).body.code).toBe('not_approved');
    expect((await call('POST', '/api/v1/languages/din/passages/d1/publication', t, { ready: false })).status).toBe(400); // must say why
    const ok = await call('POST', '/api/v1/languages/din/passages/d1/publication', t, { ready: true, note: 'Checked with the elders' });
    expect(ok.body.passage.publication).toMatchObject({ ready: true, versionN: 1, note: 'Checked with the elders' });
    expect((await call('GET', '/api/v1/languages/din/passages?ready=true', t)).body.map((p: any) => p.unitId)).toEqual(['d1']);
    // The team records a new version of d1. Nobody has heard it, so the
    // approved version, and its readiness, are still version 1's.
    recorded(log, 'din', 'd1', { take: 'take-d1-v2' });
    const waiting = await call('GET', '/api/v1/languages/din/passages/d1', t);
    expect(waiting.body.version.n).toBe(2);
    expect(waiting.body.approvedVersion.n).toBe(1);
    expect(waiting.body.publication).toMatchObject({ ready: true, versionN: 1 });
    expect((await call('POST', '/api/v1/languages/din/passages/d1/publication', t, { ready: true, takeId: 'take-d1-v2' })).body.code).toBe('not_approved');
    // Once version 2 is approved, it starts without readiness.
    log.add('din', 'v1.ReviewRecorded', { reviewId: 'peer-v2', takeId: 'take-d1-v2', kindId: 'peer', outcome: 'looks_good', via: 'app' }, 'rev');
    const after = await call('GET', '/api/v1/languages/din/passages/d1', t);
    expect(after.body.approvedVersion.n).toBe(2);
    expect(after.body.publication).toBeNull();
  });
});

describe('the device flow', () => {
  it('lets an app ask, a person narrow and approve, and the app poll its way to a working token', async () => {
    const { call, store, advance } = setup();
    const asked = await call('POST', '/api/v1/device/code', undefined, { clientName: 'Every Language Listener', scopes: ['read', 'feedback', 'publish'] });
    expect(asked.status).toBe(200);
    expect(asked.body.verification_uri_complete).toBe(`https://lq.test/connect?code=${encodeURIComponent(asked.body.user_code)}`);
    const poll = () => call('POST', '/api/v1/device/token', undefined, { device_code: asked.body.device_code });
    expect((await poll()).body.error).toBe('authorization_pending');
    expect((await poll()).body.error).toBe('slow_down');
    expect((await call('GET', '/api/v1/languages', asked.body.device_code)).status).toBe(401); // not yet

    const code = asked.body.user_code.toLowerCase().replace('-', ' '); // as a person might type it
    const seen = await call('GET', `/api/v1/session/device/${encodeURIComponent(code)}`, 'jwt:rev');
    expect(seen.body).toMatchObject({ clientName: 'Every Language Listener', state: 'pending', requestedScopes: ['read', 'feedback', 'publish'] });
    // A person may narrow what the app asked for, never widen it.
    const decide = (scopes: string[]) => call('POST', `/api/v1/session/device/${encodeURIComponent(code)}`, 'jwt:rev', { decision: 'approve', orgId: ORG, scopes, languageIds: ['din'] });
    expect((await decide(['read:published', 'read'])).status).toBe(400);
    expect((await decide(['read', 'feedback'])).status).toBe(200);
    expect((await decide(['read'])).status).toBe(409); // already decided

    advance(5000);
    const done = await poll();
    expect(done.body).toMatchObject({ access_token: asked.body.device_code, token_type: 'Bearer', scope: 'read feedback', language_ids: ['din'] });
    const langs = await call('GET', '/api/v1/languages', done.body.access_token);
    expect(langs.body.map((l: any) => [l.languageId, l.can])).toEqual([['din', { read: 'all', feedback: true, publish: false }]]);
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
    const t = await token('rev', { scopes: ['read:published', 'feedback'] });
    const init = await call('POST', '/api/v1/mcp', t, rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }));
    expect(init.body.result.protocolVersion).toBe('2025-06-18');
    expect((await call('POST', '/api/v1/mcp', t, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    const tools = (await call('POST', '/api/v1/mcp', t, rpc(2, 'tools/list'))).body.result.tools.map((x: any) => x.name);
    expect(tools).toEqual(['whoami', 'list_languages', 'list_passages', 'get_passage', 'send_feedback']);
    const listed = await call('POST', '/api/v1/mcp', t, rpc(3, 'tools/call', { name: 'list_passages', arguments: { languageId: 'din' } }));
    expect(JSON.parse(listed.body.result.content[0].text).map((p: any) => p.unitId)).toEqual(['d1']);
    const sent = await call('POST', '/api/v1/mcp', t, rpc(4, 'tools/call', { name: 'send_feedback', arguments: { languageId: 'din', unitId: 'd1', outcome: 'looks_good', comment: 'Clear' } }));
    expect(sent.body.result.isError).toBe(false);
    const flood = Array.from({ length: 21 }, (_, i) => rpc(100 + i, 'tools/call', { name: 'list_languages', arguments: {} }));
    expect((await call('POST', '/api/v1/mcp', t, flood)).status).toBe(400);
    const refused = await call('POST', '/api/v1/mcp', t, rpc(5, 'tools/call', { name: 'set_publication_ready', arguments: {} }));
    expect(refused.body.error.code).toBe(-32602);
  });
});

