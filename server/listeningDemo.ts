/**
 * Isolated listening demo (decisions.md 109): LangQuest's own partner API views,
 * reducer, change digests and webhook signatures over a local append-only log.
 * EveryBible's bridge and phones talk to it as to next.langquest.org; nothing
 * reaches a hosted database. `/demo/*` stands in for the translator's phone:
 * record a new take, approve it.
 */
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, existsSync, appendFileSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  encodeHlc, foldLanguage, foldOrg, orgLanguages, privilegeAllows, privilegeFor, privilegesFor,
  SEED_ROLES, validateEvent, type AnyEvent,
} from '@langquest-next/core';
import { AgentOrg } from '../apps/web/worker/agent/org';
import { OrgFolder, MemoryCache, type Source } from '../apps/web/worker/orgFolder';
import { wholeRecords } from '../apps/web/worker/languageRecords';
import { parseReview, parseRelease, isRefusal } from '../apps/web/worker/agent/view';
import { passageQueryFrom } from '../apps/web/worker/agent/http';
import { diffDigests, digestOf, newEventId, signature, type Digest } from '../apps/web/worker/agent/webhooks';
import type { Grant } from '../apps/web/worker/agent/tokens';

const port = Number(process.env.LISTENING_DEMO_PORT ?? 8791);
const base = `http://127.0.0.1:${port}`;
const directory = resolve(process.env.LISTENING_DEMO_DIR ?? '.listening-demo');
mkdirSync(directory, { recursive: true });
const tokenPath = resolve(directory, 'token');
if (!existsSync(tokenPath)) writeFileSync(tokenPath, 'lqp_' + randomBytes(32).toString('base64url'), { mode: 0o600 });
const token = readFileSync(tokenPath, 'utf8').trim();
const logPath = resolve(directory, 'events.ndjson');
const orgId = 'every-language-prototype';
const admin = 'prototype-admin';
const adminGrant: Grant = { tokenId: 'local-demo-token', orgId, profileId: admin, scopes: ['read', 'review', 'release'], languageIds: null };
// A listening app's own read-only token: approved versions only (docs/agent-api.md, Tokens).
const listenerPath = resolve(directory, 'listener-token');
if (!existsSync(listenerPath)) writeFileSync(listenerPath, 'lqp_' + randomBytes(32).toString('base64url'), { mode: 0o600 });
const grants = new Map<string, Grant>([
  [`Bearer ${token}`, adminGrant],
  [`Bearer ${readFileSync(listenerPath, 'utf8').trim()}`, { tokenId: 'local-demo-listener', orgId, profileId: admin, scopes: ['read:published'], languageIds: null }],
]);

// ---- audio: synthesized speech, kept by its hash like LangQuest's blobs --------------------
function speak(text: string) {
  const spoken = resolve(directory, 'spoken.wav');
  execFileSync('/usr/bin/say', ['-o', spoken, '--data-format=LEI16@22050', text]);
  const bytes = readFileSync(spoken);
  const hash = createHash('sha256').update(bytes).digest('hex');
  writeFileSync(resolve(directory, `${hash}.wav`), bytes);
  return { hash, bytes, durationMs: Math.round(((bytes.length - 44) / 44100) * 1000) };
}

// ---- the log ----------------------------------------------------------------------------
const streams = new Map<string, AnyEvent[]>();
const ids = new Set<string>();
function push(event: AnyEvent, persist = true) {
  const list = streams.get(event.streamId) ?? [];
  const stored = { ...event, serverSeq: list.length + 1 };
  list.push(stored);
  streams.set(event.streamId, list);
  ids.add(event.id);
  if (persist) appendFileSync(logPath, JSON.stringify(stored) + '\n');
}
let clock = Date.now();
const hlc = () => encodeHlc(Math.max(++clock, Date.now()), 0, 'demo');
function add(streamId: string, type: string, payload: unknown, actorId = admin) {
  push({ id: `demo-${randomBytes(8).toString('hex')}`, orgId, streamId, type, payload, actorId, deviceId: 'demo', hlc: hlc() } as AnyEvent);
}
/** A new take of a passage, as the translator's phone would share it. */
function record(languageId: string, unitId: string, text: string) {
  const clip = speak(text);
  const n = (streams.get(languageId) ?? []).filter((e) => e.type === 'v1.TakeComposed' && (e.payload as { unitId: string }).unitId === unitId).length + 1;
  const takeId = `${languageId}-${unitId}-v${n}`;
  add(languageId, 'v1.BlobStored', { hash: clip.hash, size: clip.bytes.length });
  add(languageId, 'v1.RecordingAdded', { recordingId: `rec-${takeId}`, unitId, kind: 'target', cards: [{ hash: clip.hash, durationMs: clip.durationMs, format: 'wav' }] });
  add(languageId, 'v1.TakeComposed', { takeId, unitId, cardHashes: [clip.hash], parentTakeId: null });
  add(languageId, 'v1.TakeSubmitted', { takeId });
  return takeId;
}
function latestTake(languageId: string, unitId: string) {
  return (streams.get(languageId) ?? [])
    .filter((e) => e.type === 'v1.TakeComposed' && (e.payload as { unitId: string }).unitId === unitId)
    .map((e) => (e.payload as { takeId: string }).takeId).at(-1);
}
/** The peer check approving the newest take, as a reviewer would in the app. */
function approve(languageId: string, unitId: string) {
  const takeId = latestTake(languageId, unitId);
  if (!takeId) return null;
  add(languageId, 'v1.ReviewRecorded', { reviewId: `peer-${takeId}`, takeId, kindId: 'peer', outcome: 'looks_good', via: 'app' });
  return takeId;
}

if (existsSync(logPath)) {
  for (const line of readFileSync(logPath, 'utf8').trim().split('\n')) if (line) push(JSON.parse(line) as AnyEvent, false);
} else {
  add('_org', 'v1.OrgCreated', { name: 'Every Language prototype' });
  for (const r of SEED_ROLES) add('_org', 'v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
  add('_org', 'v1.MemberAdded', { profileId: admin, roleId: 'org_admin', scope: { level: 'org' } });
  for (const [languageId, name, code] of [['dinka-demo', 'Dinka · demonstration', 'din'], ['nuer-demo', 'Nuer · demonstration', 'nus']] as const) {
    add('_org', 'v1.LanguageAdded', { languageId, name, code, sourceCode: 'eng' });
    add(languageId, 'v1.FlowSelected', { flowId: 'peer_only', name: 'Peer review' });
    add(languageId, 'v1.FlowStepSet', { stepId: 'peer_only/s1', order: 's00', kindIds: ['peer'], checkpoint: false });
    add(languageId, 'v1.UnitAdded', { unitId: 'luke', parentUnitId: null, kind: 'book', label: 'Luke', order: 'a' });
    for (const chapter of [1, 2, 3]) {
      const unitId = `luke-${chapter}`;
      add(languageId, 'v1.UnitAdded', { unitId, parentUnitId: 'luke', kind: 'passage', label: `Luke ${chapter}`, order: `a${chapter}` });
      if (chapter === 3) continue;
      record(languageId, unitId, `Luke chapter ${chapter}, version one. This is a demonstration recording for the Every Language listening prototype.`);
      if (chapter === 1) approve(languageId, unitId);
    }
  }
}

// ---- the partner API, over the log -------------------------------------------------------
const source: Source = {
  async pull(_org, streamId, after, limit) {
    return (streams.get(streamId) ?? []).filter((e) => e.serverSeq! > after).slice(0, limit);
  },
  async snapshotMeta() { return null; },
  async snapshotChunk() { return null; },
};
const folder = new OrgFolder(source, orgId, new MemoryCache(), Date.now, 0);
const agent = new AgentOrg(folder, orgId, {
  async append(events) {
    const org = foldOrg(streams.get('_org') ?? []);
    const out = events.map((e) => {
      if (ids.has(e.id)) return { id: e.id, accepted: true, serverSeq: null, reason: 'duplicate' };
      const reason = validateEvent(e) ?? (!privilegeAllows(privilegeFor(e), privilegesFor(org, e.actorId, e.streamId)) ? 'not allowed' : null);
      if (reason) return { id: e.id, accepted: false, serverSeq: null, reason };
      push(e);
      return { id: e.id, accepted: true, serverSeq: 1, reason: null };
    });
    queueMicrotask(() => void look());
    return out as never;
  },
  async sign(path: string) {
    const hash = path.split('/').at(-1)!.split('.')[0]!;
    return { url: `${base}/audio/${hash}`, expiresAt: Date.now() + 600000 };
  },
  // The demo's languages are small: each is read whole.
  async records(languageId) {
    return wholeRecords((await folder.languageState(languageId))!.state);
  },
});

// ---- the change feed and webhooks: LangQuest's own digests and signatures ----------------
interface FeedRow { cursor: number; type: string; unitId: string; languageId: string; at: string }
const feed: FeedRow[] = [];
const digests = new Map<string, Digest>();
const hooks = new Map<string, { id: string; url: string; secret: string; events: string[] }>();
let looking: Promise<void> = Promise.resolve();
let lookTimer: ReturnType<typeof setTimeout> | null = null;
const languages = () => orgLanguages(foldOrg(streams.get('_org') ?? [])).map((l) => l.languageId);
/** Compares each language's digest with the last look; new rows go on the feed and out by webhook. */
function look() {
  if (lookTimer) return looking;
  // Like LangQuest, a burst of changes waits a moment and goes out together.
  looking = new Promise((done) => {
    lookTimer = setTimeout(async () => {
      lookTimer = null;
      for (const languageId of languages()) {
        const next = digestOf(foldLanguage(streams.get(languageId) ?? []));
        const before = digests.get(languageId);
        digests.set(languageId, next);
        if (!before) continue;
        const changes = diffDigests(before, next);
        if (!changes.length) continue;
        const rows = changes.map((c) => ({ cursor: feed.length + 1, type: c.type, unitId: c.unitId, languageId, at: new Date().toISOString() }));
        for (const row of rows) { row.cursor = feed.length + 1; feed.push(row); }
        // Sent from an outbox after the feed holds the rows, as LangQuest does: never awaited here.
        for (const type of new Set(rows.map((r) => r.type))) void deliver(type, languageId, rows.filter((r) => r.type === type));
      }
      done();
    }, 300);
  });
  return looking;
}
async function deliver(type: string, languageId: string, rows: FeedRow[]) {
  for (const hook of hooks.values()) {
    if (!hook.events.includes(type)) continue;
    const body = JSON.stringify({ id: newEventId(), type, occurredAt: new Date().toISOString(), orgId, languageId, unitIds: rows.map((r) => r.unitId).slice(0, 100), cursor: String(rows.at(-1)!.cursor) });
    try {
      const r = await fetch(hook.url, { method: 'POST', headers: { 'content-type': 'application/json', 'langquest-signature': await signature(hook.secret, Math.floor(Date.now() / 1000), body), 'langquest-event-id': JSON.parse(body).id }, body, signal: AbortSignal.timeout(10000) });
      console.log(`webhook ${type} → ${hook.url}: ${r.status}`);
    } catch (error) {
      console.log(`webhook ${type} → ${hook.url}: failed (${(error as Error).message})`);
    }
  }
}
// Starting digests, so the first change after start is sent rather than taken as the start.
for (const languageId of languages()) digests.set(languageId, digestOf(foldLanguage(streams.get(languageId) ?? [])));

// ---- HTTP -------------------------------------------------------------------------------
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', base);
  const reply = (data: unknown, status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  const audioMatch = /^\/audio\/([0-9a-f]{64})$/.exec(url.pathname);
  if (audioMatch) {
    const path = resolve(directory, `${audioMatch[1]}.wav`);
    if (!existsSync(path)) return reply({ error: 'No such audio' }, 404);
    const bytes = readFileSync(path);
    // Phones' players read audio in ranges, as they do LangQuest's signed links.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, bytes.length - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
      res.writeHead(206, { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${bytes.length}`, 'content-length': end - start + 1 });
      return res.end(bytes.subarray(start, end + 1));
    }
    res.writeHead(200, { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'content-length': bytes.length });
    return res.end(bytes);
  }
  const grant = grants.get(req.headers.authorization ?? '');
  if (!grant) return reply({ error: 'Unknown demo token', code: 'unauthorized' }, 401);
  let text = '';
  for await (const chunk of req) {
    text += String(chunk);
    if (text.length > 8192) return reply({ error: 'Too large' }, 413);
  }
  const body = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
  try {
    // The translator's phone, for the demo.
    if (url.pathname.startsWith('/demo/') && grant !== adminGrant) return reply({ error: 'The listener token cannot record.', code: 'scope' }, 403);
    if (req.method === 'POST' && url.pathname === '/demo/record') {
      const takeId = record(String(body.languageId), String(body.unitId), String(body.text ?? `${body.unitId}, a new recording.`));
      void look();
      return reply({ takeId });
    }
    if (req.method === 'POST' && url.pathname === '/demo/approve') {
      const takeId = approve(String(body.languageId), String(body.unitId));
      void look();
      return reply({ takeId });
    }
    if (url.pathname === '/api/v1/me') {
      const languages = await agent.read(grant, { op: 'languages' });
      return reply({ token: { orgId, scopes: grant.scopes, languageIds: grant.languageIds }, org: { id: orgId, name: 'Every Language prototype' }, languages: languages.ok ? languages.data : [], demo: true });
    }
    if (url.pathname === '/api/v1/languages') {
      const out = await agent.read(grant, { op: 'languages' });
      return reply(out.ok ? out.data : out, out.ok ? 200 : out.status);
    }
    if (url.pathname === '/api/v1/webhooks') {
      if (req.method === 'GET') return reply({ webhooks: [...hooks.values()].map(({ secret: _, ...w }) => w) });
      const id = `wh_${randomBytes(6).toString('hex')}`;
      const secret = 'whsec_' + randomBytes(32).toString('base64url');
      hooks.set(id, { id, url: String(body.url), secret, events: (body.events as string[]) ?? [] });
      console.log(`webhook registered: ${String(body.url)}`);
      return reply({ webhookId: id, secret, webhook: { id, url: body.url } });
    }
    const hook = /^\/api\/v1\/webhooks\/([^/]+)$/.exec(url.pathname);
    if (hook && req.method === 'DELETE') {
      hooks.delete(hook[1]!);
      return reply({ id: hook[1], deleted: true });
    }
    const changes = /^\/api\/v1\/languages\/([^/]+)\/changes$/.exec(url.pathname);
    if (changes) {
      await looking;
      const languageId = decodeURIComponent(changes[1]!);
      const rows = feed.filter((r) => r.languageId === languageId);
      if (!url.searchParams.has('after')) return reply({ changes: [], cursor: String(feed.length), more: false });
      const after = Number(url.searchParams.get('after'));
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 500), 1000);
      const page = rows.filter((r) => r.cursor > after).slice(0, limit);
      return reply({ changes: page.map((r) => ({ cursor: String(r.cursor), type: r.type, unitId: r.unitId, at: r.at })), cursor: String(page.at(-1)?.cursor ?? Math.max(after, feed.length)), more: page.length === limit });
    }
    const m = /^\/api\/v1\/languages\/([^/]+)\/passages(?:\/([^/]+))?(?:\/(reviews|releases))?$/.exec(url.pathname);
    if (!m) return reply({ error: 'Not found' }, 404);
    const languageId = decodeURIComponent(m[1]!);
    const unitId = m[2] ? decodeURIComponent(m[2]) : undefined;
    if (req.method === 'GET') {
      let out;
      if (unitId) out = await agent.read(grant, { op: 'passage', languageId, unitId });
      else {
        const query = passageQueryFrom(url);
        if (isRefusal(query)) return reply(query, query.status);
        out = await agent.read(grant, { op: 'passages', languageId, query });
      }
      return reply(out.ok ? out.data : out, out.ok ? 200 : out.status);
    }
    if (req.method !== 'POST' || !unitId || !m[3]) return reply({ error: 'Method not allowed' }, 405);
    let out;
    if (m[3] === 'reviews') {
      const input = parseReview(body);
      if (isRefusal(input)) return reply(input, input.status);
      out = await agent.write(grant, { op: 'review', languageId, unitId, input });
    } else {
      const input = parseRelease(body);
      if (isRefusal(input)) return reply(input, input.status);
      out = await agent.write(grant, { op: 'release', languageId, unitId, input });
    }
    return reply(out.ok ? out.data : out, out.ok ? 200 : out.status);
  } catch (error) {
    console.error(error);
    return reply({ error: 'Demo request failed' }, 500);
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Local LangQuest demo API: ${base}`);
  console.log('Uses LangQuest\'s own reducer, partner views, digests and webhook signatures; no hosted data.');
});
