/**
 * Runs one path of an organization's Durable Object (`OrgSnapshot`) over a
 * large organization inside a heap the size of a Durable Object's isolate.
 * The test runs it as `node --max-old-space-size=112`: Cloudflare resets an
 * isolate that passes 128 MB ("Durable Object's isolate exceeded its memory
 * limit"), and every request to that organization then fails (502 on
 * /connect, 2026-10-16).
 *
 * As in production, events come from the source a page at a time (Postgres
 * there, a generator here), folds are saved outside the heap (SQLite there,
 * files here), and the webhook tables are SQLite in both, so what fills the
 * heap is what the object itself keeps.
 *
 * Paths, each what one kind of request makes the object do:
 * - fold: a cold object's first full pass (a report or a passage read), then
 *   every language's fold. Access checks (/connect, /me) fold no language
 *   (decisions.md 140; orgAccess.test.ts).
 * - webhooks: a webhook over every language; the first scan, the log grows, a
 *   second scan that finds changes everywhere, deliveries, a feed read per language.
 * - api: a token lists every passage of every language with include=audio,reviews.
 * - reports: the Reports screen, cold and then fresh.
 * - writes: the hourly write and upload counters, for many tokens over six hours.
 *
 * `unbounded` swaps in the regression each path's bound exists to stop, so the
 * test can show it catches it: fold and reports keep every fold (no budget);
 * webhooks keep each fold and digest they compare; api keeps every page it
 * answered (a response cache); writes keep every timestamp.
 *
 * Usage: orgFolderHeap.ts <path> <languages> <passagesPerLanguage> [unbounded]
 * Prints one JSON line: { ok, path, peakHeapMb, retainedHeapMb, heldLanguages, foldMb, ... }.
 * Run with --expose-gc for retainedHeapMb.
 */
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeHlc, ORG_STREAM, SEED_ROLES, type AnyEvent, type LanguageState, type OrgState } from '@langquest-next/core';
import { OrgFolder, MemoryCache, type OrgCache, type Source } from '../../worker/orgFolder';
import { AgentOrg, UPLOADS_PER_HOUR } from '../../worker/agent/org';
import { WebhookDispatcher } from '../../worker/agent/dispatch';
import { WEBHOOK_EVENTS } from '../../worker/agent/webhooks';
import { PASSAGES_PAGE_MAX } from '../../worker/agent/view';
import type { TokenRecord, WebhookRecord } from '../../worker/agent/store';
import type { Grant } from '../../worker/agent/tokens';
import type { SqlStore } from '../../worker/sqlCache';
import { readPath } from '../../worker/blobs';

const [path, ...rest] = process.argv.slice(2);
const [languages, passages] = rest.slice(0, 2).map(Number);
const unbounded = rest.includes('unbounded');
const orgId = 'heap-test-org';
const TAKES = 3;
const PER_PASSAGE = 1 + TAKES * 4;
const T0 = 1_790_000_000_000;
const languageIds = Array.from({ length: languages! }, (_, i) => `lang-${i}`);

function event(streamId: string, seq: number, type: string, payload: unknown): AnyEvent {
  return {
    id: `${streamId}-${seq}`, orgId, streamId, type, payload, actorId: 'admin', deviceId: 'd',
    hlc: encodeHlc(T0 + seq * 1000, 0, 'd'), serverSeq: seq
  } as AnyEvent;
}

const orgEvents: AnyEvent[] = (() => {
  const out: AnyEvent[] = [];
  const add = (type: string, payload: unknown) => out.push(event(ORG_STREAM, out.length + 1, type, payload));
  add('v1.OrgCreated', { name: 'Heap test' });
  for (const r of SEED_ROLES) add('v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
  add('v1.MemberAdded', { profileId: 'admin', roleId: 'org_admin', scope: { level: 'org' } });
  for (const id of languageIds) add('v1.LanguageAdded', { languageId: id, name: id, code: 'xxx', sourceCode: 'eng' });
  return out;
})();

/** A language's event at `seq` (1-based), made on demand: a book, then passages with three reviewed takes each. */
function languageEvent(streamId: string, seq: number): AnyEvent {
  if (seq === 1) return event(streamId, seq, 'v1.UnitAdded', { unitId: 'book', parentUnitId: null, kind: 'book', label: 'Book', order: 'a' });
  const p = Math.floor((seq - 2) / PER_PASSAGE);
  const k = (seq - 2) % PER_PASSAGE;
  const unitId = `u${p}`;
  if (k === 0) return event(streamId, seq, 'v1.UnitAdded', { unitId, parentUnitId: 'book', kind: 'passage', label: `Passage ${p}`, order: `a${String(p).padStart(6, '0')}` });
  const v = Math.floor((k - 1) / 4) + 1;
  const hash = `${p.toString(16)}f${v}`.padStart(64, '0');
  const takeId = `t${p}-${v}`;
  switch ((k - 1) % 4) {
    case 0: return event(streamId, seq, 'v1.RecordingAdded', { recordingId: `r${p}-${v}`, unitId, kind: 'target', cards: [{ hash, durationMs: 30000 }] });
    case 1: return event(streamId, seq, 'v1.TakeComposed', { takeId, unitId, cardHashes: [hash], parentTakeId: null });
    case 2: return event(streamId, seq, 'v1.TakeSubmitted', { takeId });
    default: return event(streamId, seq, 'v1.ReviewRecorded', {
      reviewId: `rv${p}-${v}`, takeId, kindId: 'peer', outcome: v === TAKES ? 'looks_good' : 'needs_changes', via: 'app',
      comment: 'A reviewer comment of a typical length about this take.'
    });
  }
}
/** Passages added after the first webhook scan, so the second one finds changes in every language. */
let grown = 0;
const languageLength = () => 1 + (passages! + grown) * PER_PASSAGE;

const source: Source = {
  async pull(_org, streamId, after, limit) {
    if (streamId === ORG_STREAM) return orgEvents.slice(after, after + limit);
    const out: AnyEvent[] = [];
    for (let seq = after + 1; seq <= Math.min(languageLength(), after + limit); seq++) out.push(languageEvent(streamId, seq));
    return out;
  },
  async snapshotMeta() { return null; },
  async snapshotChunk() { return null; },
  async heads() {
    return Object.fromEntries([[ORG_STREAM, orgEvents.length], ...languageIds.map((id) => [id, languageLength()])]);
  }
};

/** Saved folds live on disk, as they do in the Durable Object's SQLite. */
const dir = mkdtempSync(join(tmpdir(), 'org-folder-heap-'));
const cache: OrgCache = {
  async get(key) {
    const file = join(dir, encodeURIComponent(key));
    return existsSync(file) ? readFileSync(file, 'utf8') : null;
  },
  async put(key, value) { writeFileSync(join(dir, encodeURIComponent(key)), value); }
};

/** The object's SQLite (the webhook tables), on disk as in production. */
function sqlite(): SqlStore {
  const db = new DatabaseSync(join(dir, 'object.sqlite'));
  return {
    exec: (query, ...bindings) => {
      const statement = db.prepare(query);
      const rows = /^\s*select/i.test(query) ? statement.all(...(bindings as never[])) : (statement.run(...(bindings as never[])), []);
      return { toArray: () => rows as Record<string, unknown>[] };
    },
    transactionSync: (fn) => {
      db.exec('begin');
      try { const out = fn(); db.exec('commit'); return out; } catch (e) { db.exec('rollback'); throw e; }
    }
  };
}

const token: TokenRecord = {
  id: 'tok-heap', orgId, profileId: 'admin', name: 'Heap test app', scopes: ['read', 'review', 'release'], languageIds: null,
  createdVia: 'page', clientName: null, createdAt: new Date(T0).toISOString(), expiresAt: null, revokedAt: null, lastUsedAt: null
};
const grant: Grant = { tokenId: token.id, orgId, profileId: token.profileId, scopes: token.scopes, languageIds: null };
const webhook: WebhookRecord = {
  id: 'wh-heap', orgId, tokenId: token.id, url: 'https://partner.example/hooks', events: [...WEBHOOK_EVENTS], languageIds: null,
  secret: 'whsec_heap', createdAt: new Date(T0).toISOString(), disabledAt: null, disabledReason: null
};

let now = T0 + 10_000_000;
const folder = new OrgFolder(source, orgId, cache, () => now, undefined, unbounded && (path === 'fold' || path === 'reports') ? { stateBudgetBytes: 1e12 } : {});
const sign = async (key: string) => {
  const { path: p, expiresAt } = await readPath(key, { serviceKey: 'heap-test-service-key', now: () => now });
  return { url: `https://langquest.example${p}`, expiresAt };
};

/** What the regression keeps in the webhook path: every fold and digest the dispatcher compared. */
const compared = new Map<string, { org: OrgState; state: LanguageState }>();
/** What the regression keeps in the api path: every page it answered (a response cache). */
const answers: unknown[] = [];

function dispatcher(): WebhookDispatcher {
  const d = new WebhookDispatcher(sqlite(), orgId, {
    store: {
      async liveWebhooks() { return [{ webhook, token }]; },
      async webhooksByIds(ids) { return ids.includes(webhook.id) ? [webhook] : []; },
      async disableWebhooks() {}
    },
    orgState: () => folder.orgState(true),
    languageState: async (id) => {
      const held = await folder.languageState(id);
      if (unbounded && held) compared.set(id, held);
      return held;
    },
    heads: () => source.heads!(orgId),
    fetch: async (_url, init) => {
      void init.body;
      return new Response('ok', { status: 200 });
    },
    now: () => now
  });
  if (unbounded) (d as unknown as { digests: OrgCache }).digests = new MemoryCache();
  return d;
}

// As OrgSnapshot keeps them: one dispatcher and one AgentOrg for the object's life, over the one folder.
const webhooks = dispatcher();
const agent = new AgentOrg(folder, orgId, { append: async () => [], sign, now: () => now, webhooks });

const extra: Record<string, unknown> = {};

const paths: Record<string, () => Promise<void>> = {
  async fold() {
    // A cold object's first full pass: a report or a passage read asks for every language.
    await folder.orgState();
    // Then the partner API and the dashboard read each language's whole fold.
    for (const id of languageIds) await folder.languageState(id);
  },

  async webhooks() {
    // The webhook is made: every language gets its starting point.
    await agent.scanWebhooks();
    // A recording session in every language, then the poke's alarm: scan, deliver.
    grown = 10;
    now += 60_000;
    await webhooks.scan();
    await webhooks.deliverDue();
    // The app follows the poke and reads each language's feed.
    let changes = 0;
    for (const id of languageIds) {
      const page = await agent.changes(grant, id, 0, 1000);
      if (!page.ok) throw new Error(`changes ${id}: ${page.code}`);
      changes += page.data.changes.length;
    }
    extra['changes'] = changes;
  },

  async api() {
    let listed = 0;
    let largestPageMb = 0;
    for (const id of languageIds) {
      let after: string | undefined;
      do {
        const answer = await agent.read(grant, { op: 'passages', languageId: id, query: { filter: {}, include: ['audio', 'reviews'], limit: PASSAGES_PAGE_MAX, ...(after ? { after } : {}) } });
        if (!answer.ok) throw new Error(`passages ${id}: ${answer.code}`);
        const page = answer.data as { passages: unknown[]; nextAfter: string | null };
        if (unbounded) answers.push(page);
        // The answer leaves the object as a copy (RPC to the Worker, then JSON).
        largestPageMb = Math.max(largestPageMb, JSON.stringify(page).length / 1e6);
        listed += page.passages.length;
        after = page.nextAfter ?? undefined;
      } while (after);
    }
    extra['listed'] = listed;
    extra['largestPageMb'] = Math.round(largestPageMb * 10) / 10;
  },

  async reports() {
    const cold = await folder.reportsFor('admin');
    if (!cold || cold.rows.length !== languageIds.length) throw new Error(`reports: ${cold?.rows.length ?? 'none'} of ${languageIds.length} languages`);
    now += 60_000;
    await folder.reportsFor('admin', true);
  },

  async writes() {
    if (unbounded) {
      // The regression: every timestamp is kept, and only the count looks at the last hour.
      (AgentOrg.prototype as unknown as { allow(this: { writes: Map<string, number[]>; now(): number }, key: string, perHour: number): boolean }).allow = function (key, perHour) {
        const t = this.now();
        const all = this.writes.get(key) ?? [];
        let recent = 0;
        for (let i = all.length - 1; i >= 0 && all[i]! > t - 3_600_000; i--) recent++;
        if (recent >= perHour) return false;
        all.push(t);
        this.writes.set(key, all);
        return true;
      };
    }
    // `languages` is the number of tokens and review links here, each spending its hourly uploads, for six hours.
    const keys = languages!;
    let refused = 0;
    for (let hour = 0; hour < 6; hour++) {
      for (let i = 0; i < UPLOADS_PER_HOUR; i++) {
        now += 3_600_000 / UPLOADS_PER_HOUR;
        for (let k = 0; k < keys; k++) if (!(await agent.spend(`key-${k}`))) refused++;
      }
    }
    extra['refused'] = refused;
  }
};

let peak = 0;
const sample = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 5);
try {
  const run = paths[path!];
  if (!run) throw new Error(`unknown path ${path}; one of ${Object.keys(paths).join(', ')}`);
  await run();
  const held = folder.heldLanguages();
  const one = held.length ? await folder.languageState(held.at(-1)!) : null;
  peak = Math.max(peak, process.memoryUsage().heapUsed);
  // What stays after collection is what the object keeps between requests.
  (globalThis as { gc?: () => void }).gc?.();
  const retained = process.memoryUsage().heapUsed;
  console.log(JSON.stringify({
    ok: true, path, unbounded, peakHeapMb: Math.round(peak / 1e6), retainedHeapMb: Math.round(retained / 1e6), heldLanguages: held.length,
    foldMb: one ? Math.round(JSON.stringify(one.state).length / 1e5) / 10 : 0, kept: compared.size, ...extra
  }));
} finally {
  clearInterval(sample);
  rmSync(dir, { recursive: true, force: true });
}
