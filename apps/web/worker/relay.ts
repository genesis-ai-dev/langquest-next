import type { AnyEvent } from '@langquest-next/core';
import {
  checkChain, eventDigest, NEARBY_BATCH_MAX_EVENTS, nearbyBytes, nearbyCopy, nearbyParentError, nearbyPayloadError, parseBatchManifest, signedBy, type BatchManifest, type Sha256, type Verify
} from '@langquest-next/core/nearby';
import type { RpcAnswer } from './nearby';
import { accountFromChain, type AccountDeps, type CheckedJoin } from './nearbyJoin';

/**
 * Delivery through a teammate (docs/nearby-sync-plan.md section 6): a phone that reaches the
 * internet sends the signed work it holds for its teammates, and the server appends it as
 * each author. Written as a literal so `server-calls` sees it (decisions.md 151).
 *
 * `POST /api/relay`, bearer token, `{ orgId, streamId, clientVersion, batches: [{ manifest,
 * sig, chain, events }] }`, answers `{ batches: [{ key, n, refused?, verdicts? }] }`: `refused`
 * when a batch was not tried at all (the phone keeps its rows for a later try), `verdicts` one
 * per event as `append_events` words them, so `rejectCodeOf` reads them. The Worker checks
 * the caller's token and that the caller may read the language, then each batch's chain
 * (with no expiry, since a batch may be carried for months, and at most two links), its
 * signature and every event's digest. A newcomer's batch (two links) goes through the join
 * route's `accountFromChain`: if the pass still takes them, their account is made with that id
 * and the events are applied as theirs; if not, no account is made and each event answers
 * `not a member`, so a teammate's copy keeps its Try again for when they are let in; and a
 * database not ready refuses the batch whole, which the phone keeps. The manifest's signature
 * is the proof of key (section 6, "Authors with no account yet"). It does not ask `org_features`: the
 * flag gates the way in, so a turned-off organization still settles. The per-account checks,
 * a revoked key's dates and cap, and the refusals by name are in `relay_append_events`, called
 * once per author and signer's key, at most 500 events each, so a request mixing authors gets
 * separate transactions and partial success. LQ001 answers 426, a missing key list or a
 * database behind (`PGRST202`) 503, which the phone takes as "not yet".
 */
export const RELAY_PATH = '/api/relay';

export interface RelayDeps {
  /** The public keys phones trust (`NEARBY_CERT_KEYS`); empty until a person sets them, and then the route answers 503. */
  rootKeys(): ReadonlyMap<string, string>;
  /** The profile a token belongs to (the API's own `profileOf`). */
  profileOf(token: string): Promise<string | null>;
  /** `can_read_stream` with the service client. */
  mayRead(orgId: string, streamId: string, profileId: string): Promise<RpcAnswer>;
  /** `relay_append_events` with the service client. */
  append(author: string, key: string, events: AnyEvent[], clientVersion: number): Promise<RpcAnswer>;
  /** A newcomer's account, as the join route makes it (nearbyJoin.ts); without it a newcomer's batch is refused whole and kept. */
  accounts?: Omit<AccountDeps, 'rootKeys' | 'verify' | 'sha256'>;
  verify: Verify;
  sha256: Sha256;
}

/** One event's answer, as `append_events` gives it. */
export interface RelayVerdict {
  id: string;
  accepted: boolean;
  serverSeq: number | null;
  reason: string | null;
}

export interface RelayBatchAnswer {
  key: string;
  n: number;
  refused?: string;
  verdicts?: RelayVerdict[];
}

/** A phone sends one batch at a time; a few fit, each at most 512 KiB of event text. */
const MAX_BATCHES = 4;
const MAX_BODY = 3 * 1024 * 1024;
/** What `append_events` takes at once. */
const RPC_EVENTS = 500;

const NO_STORE = { 'cache-control': 'private, no-store' };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...NO_STORE } });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && v.length >= 1 && v.length <= 256 && !/[\u0000-\u001f\u007f]/.test(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const tokenOf = (request: Request) => /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
const idOf = (e: unknown): string => (isObject(e) && typeof e['id'] === 'string' ? e['id'] : '');

const behind = () => json(503, { error: 'The server is being updated. Try again later.' });

export async function handleRelay(request: Request, deps: RelayDeps): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Only POST is supported.' });
  try {
    return await relay(request, deps);
  } catch (e) {
    console.error(`${RELAY_PATH}:`, e);
    return json(502, { error: 'The server could not answer just now. Try again.' });
  }
}

interface Candidate {
  batch: number;
  manifest: BatchManifest;
  events: AnyEvent[];
  newcomer?: CheckedJoin;
}

/** A batch's checks before any database work. Null with a reason refuses it whole; its rows stay on the phone. */
async function checkBatch(raw: unknown, orgId: string, streamId: string, deps: RelayDeps, rootKeys: ReadonlyMap<string, string>):
  Promise<{ manifest: BatchManifest | null; refused?: string; verdicts: RelayVerdict[]; events: AnyEvent[]; newcomer?: CheckedJoin }> {
  const out: { manifest: BatchManifest | null; verdicts: RelayVerdict[]; events: AnyEvent[]; newcomer?: CheckedJoin } = { manifest: null, verdicts: [], events: [] };
  if (!isObject(raw) || typeof raw['manifest'] !== 'string' || typeof raw['sig'] !== 'string' || !Array.isArray(raw['chain']) || !Array.isArray(raw['events'])) {
    return { ...out, refused: 'not a batch' };
  }
  const manifest = parseBatchManifest(raw['manifest'], { orgId, streamId });
  if (!manifest) return { ...out, refused: 'bad manifest' };
  out.manifest = manifest;
  const events = raw['events'] as unknown[];
  if (events.length > NEARBY_BATCH_MAX_EVENTS) return { ...out, refused: 'too many events' };
  // Expiry skipped: a batch may be carried for months, and for the relay the install_keys row is the truth.
  const verdict = await checkChain(raw['chain'] as unknown[], { rootKeys, orgId, languageId: streamId, now: null, verify: deps.verify, sha256: deps.sha256, maxLinks: 2 });
  if (!verdict.ok) return { ...out, refused: `chain: ${verdict.reason}` };
  const { holder } = verdict;
  if (verdict.links === 2) out.newcomer = { holder, link: (raw['chain'] as unknown[])[1] as CheckedJoin['link'] };
  if (holder.installKey !== manifest.key || holder.deviceId !== manifest.deviceId || holder.profileId !== manifest.actorId) return { ...out, refused: 'the chain names someone else' };
  if (!await signedBy(deps.verify, manifest.key, nearbyBytes('batch', raw['manifest']), raw['sig'])) return { ...out, refused: 'bad signature' };

  const digests = new Map(manifest.events);
  const seen = new Set<string>();
  const no = (id: string, reason: string) => out.verdicts.push({ id, accepted: false, serverSeq: null, reason });
  for (const e of events) {
    const id = idOf(e);
    if (!digests.has(id) || seen.has(id)) continue;
    seen.add(id);
    // Postgres cannot keep a NUL or a lone surrogate, and one would fail the whole call (server/nearbyRelaySmoke.sql).
    const malformed = nearbyPayloadError(e);
    if (malformed !== null) { no(id, `invalid payload: ${malformed}`); continue; }
    const parent = nearbyParentError(e);
    if (parent !== null) { no(id, `malformed envelope: ${parent}`); continue; }
    const ev = e as AnyEvent;
    let digest = '';
    try { digest = await eventDigest(ev, deps.sha256); } catch { /* the mismatch below */ }
    if (digest !== digests.get(id)) { no(id, 'malformed envelope: not the event its manifest signed'); continue; }
    if (ev.actorId !== manifest.actorId || ev.deviceId !== manifest.deviceId) { no(id, 'actorId does not match caller'); continue; }
    if (ev.orgId !== orgId || ev.streamId !== streamId) { no(id, 'malformed envelope: another stream'); continue; }
    // The envelope as signed, and nothing else: a carrier could add a falsy parent the digest does not see (security review, 2026-11-10).
    out.events.push(nearbyCopy(ev));
  }
  return out;
}

const verdictOf = (row: unknown): RelayVerdict | null => {
  if (!isObject(row) || typeof row['id'] !== 'string' || typeof row['accepted'] !== 'boolean') return null;
  const seq = row['server_seq'];
  return { id: row['id'], accepted: row['accepted'], serverSeq: isCount(seq) ? seq : null, reason: typeof row['reason'] === 'string' ? row['reason'] : null };
};

async function relay(request: Request, deps: RelayDeps): Promise<Response> {
  const rootKeys = deps.rootKeys();
  if (rootKeys.size === 0) return json(503, { error: 'Nearby sync is not set up here yet.' });
  const token = tokenOf(request);
  const profileId = token ? await deps.profileOf(token) : null;
  if (!profileId) return json(401, { error: 'Sign in again.' });

  const text = await request.text().catch(() => '');
  if (text.length > MAX_BODY) return json(413, { error: 'Send fewer batches at a time.' });
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = null; }
  const { orgId, streamId, clientVersion, batches } = isObject(body) ? body : {};
  if (!isId(orgId) || !isId(streamId) || !isCount(clientVersion) || !Array.isArray(batches) || batches.length === 0 || batches.length > MAX_BATCHES) {
    return json(400, { error: 'Send { orgId, streamId, clientVersion, batches }.' });
  }
  if (orgId.startsWith('_') || streamId.startsWith('_')) return json(400, { error: 'Only a language\'s work is relayed.' });

  // Someone who may not read the language is refused before any signature work, and the work stays on their phone.
  const may = await deps.mayRead(orgId, streamId, profileId);
  if (may.error?.code === 'PGRST202') return behind();
  if (may.error) throw new Error(`can_read_stream: ${may.error.message}`);
  if (may.data !== true) {
    return json(200, {
      batches: (batches as unknown[]).map((b) => {
        const m = isObject(b) ? parseBatchManifest(b['manifest'], { orgId, streamId }) : null;
        return { key: m?.key ?? '', n: m?.n ?? 0, refused: 'you cannot read this language' };
      })
    });
  }

  const checked = await Promise.all((batches as unknown[]).map((b) => checkBatch(b, orgId, streamId, deps, rootKeys)));
  const answers: RelayBatchAnswer[] = checked.map((c) => ({ key: c.manifest?.key ?? '', n: c.manifest?.n ?? 0 }));

  // One call per author and signer's key, in the order the batches came, at most 500 events each.
  const groups = new Map<string, Candidate[]>();
  checked.forEach((c, batch) => {
    if (c.refused !== undefined || !c.manifest) return;
    const group = `${c.manifest.actorId}\u0000${c.manifest.key}`;
    groups.set(group, [...(groups.get(group) ?? []), { batch, manifest: c.manifest, events: c.events, ...(c.newcomer ? { newcomer: c.newcomer } : {}) }]);
  });
  const fromServer = new Map<string, RelayVerdict>();
  const notTried = new Map<number, string>();
  for (const candidates of groups.values()) {
    const { actorId, key } = candidates[0]!.manifest;
    const events = candidates.flatMap((c) => c.events);
    const newcomer = candidates.find((c) => c.newcomer)?.newcomer;
    if (newcomer && events.length > 0) {
      // An author with no account yet: made as the join route makes it, or each event answers as not a member.
      const account = deps.accounts
        ? await accountFromChain(newcomer, { ...deps.accounts, rootKeys: () => rootKeys, verify: deps.verify, sha256: deps.sha256 }, { relay: true })
        : { kind: 'later' as const, why: 'joining offline is not set up here' };
      if (account.kind === 'later') {
        console.error(`${RELAY_PATH}: ${account.why}`);
        for (const c of candidates) notTried.set(c.batch, 'not yet: the server could not check this newcomer');
        continue;
      }
      if (account.kind === 'refused') {
        for (const e of events) fromServer.set(e.id, { id: e.id, accepted: false, serverSeq: null, reason: `not a member: ${account.error}` });
        continue;
      }
    }
    for (let at = 0; at < events.length; at += RPC_EVENTS) {
      const { data, error } = await deps.append(actorId, key, events.slice(at, at + RPC_EVENTS), clientVersion);
      if (error?.code === 'LQ001') return json(426, { code: 'LQ001', message: error.message });
      if (error?.code === 'PGRST202') return behind();
      if (error) throw new Error(`relay_append_events: ${error.message}`);
      for (const row of Array.isArray(data) ? data : []) {
        const v = verdictOf(row);
        if (v) fromServer.set(v.id, v);
      }
    }
  }

  return json(200, {
    batches: checked.map((c, i) => {
      if (c.refused !== undefined) return { ...answers[i]!, refused: c.refused };
      if (notTried.has(i)) return { ...answers[i]!, refused: notTried.get(i)! };
      const verdicts = [...c.verdicts, ...c.events.flatMap((e) => (fromServer.has(e.id) ? [fromServer.get(e.id)!] : []))];
      return { ...answers[i]!, verdicts };
    })
  });
}
