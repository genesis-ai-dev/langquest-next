import { CLIENT_PROTOCOL_VERSION, encodeHlc, ORG_PARTITION, SEED_ROLES, type AnyEvent, type EventPayloads, type EventType, type Role, type Scope } from '@langquest-next/core';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * LangQuest v2 rows -> v1 events (PLAN.md build order step 8).
 *
 * v2 keeps state in rows; this app keeps intents in a log. The mapping is a
 * pure function of the rows so a re-run appends nothing new: every event id
 * is derived from the v2 row it came from and every clock from the row's
 * `created_at`, and `append_events` treats a known id as a duplicate.
 *
 *   project                     -> ProjectCreated, one LaneAdded per target language
 *   profile_project_link        -> MemberAdded (owner -> owner, member -> translator)
 *   quest                       -> UnitAdded kind "book"
 *   source asset (via quest_asset_link) -> UnitAdded kind "passage" under its first quest
 *   source asset_content_link   -> ReferenceAttached source_text / source_audio
 *   translation asset with audio -> RecordingAdded + TakeComposed + TakeSubmitted
 *   vote                        -> ReviewSubmitted on the default "community" step
 *
 * Audio is the one thing rows cannot carry across: v2 names objects, v1 names
 * bytes. The caller copies each object first (download, hash, upload) and
 * hands the mapper the hash and duration per v2 object name.
 */

export interface V2Rows {
  project: { id: string; name: string; description: string | null; created_at: string; creator_id: string | null };
  languages: { language_type: 'source' | 'target'; languoid_id: string | null; active: boolean }[];
  members: { profile_id: string; membership: string; active: boolean; created_at: string }[];
  quests: { id: string; name: string | null; created_at: string }[];
  questAssets: { quest_id: string; asset_id: string; order_index: number | null }[];
  assets: {
    id: string;
    name: string | null;
    source_asset_id: string | null;
    creator_id: string | null;
    created_at: string;
    content: { text: string | null; audio: string[] | null }[];
  }[];
  votes: { id: string; asset_id: string; polarity: string; comment: string | null; creator_id: string | null; created_at: string }[];
}

export interface CopiedBlob {
  hash: string;
  durationMs: number;
}

export interface MapOptions {
  orgId: string;
  /** v2 object name -> the blob as stored in this app. Missing names are reported and skipped. */
  blobs: ReadonlyMap<string, CopiedBlob>;
  /** Extra memberships, e.g. the account that will open the demo. */
  grant?: { profileId: string; role: Role }[];
}

export interface MapReport {
  events: number;
  books: number;
  passages: number;
  references: number;
  takes: number;
  reviews: number;
  members: number;
  /** Source assets linked to no quest: nowhere to hang them, so left out. */
  unlinkedAssets: number;
  /** Translations that carry text and no audio: nothing an oral log can hold. */
  textOnlyTranslations: number;
  /** v2 audio names the copy step did not provide. */
  missingAudio: string[];
}

const DEVICE = 'v2import';
const SYSTEM_ACTOR = 'v2import';
const STEP = 'community';
/** Ties between member registers at the same clock go to the stronger role. */
const ROLE_RANK: Record<Role, number> = { viewer: 1, translator: 2, reviewer: 3, coordinator: 4, owner: 5 };

export function mapV2Project(rows: V2Rows, opts: MapOptions): { events: AnyEvent[]; report: MapReport; owner: string; roles: ReadonlyMap<string, Role> } {
  const projectId = rows.project.id;
  const report: MapReport = {
    events: 0, books: 0, passages: 0, references: 0, takes: 0, reviews: 0, members: 0,
    unlinkedAssets: 0, textOnlyTranslations: 0, missingAudio: []
  };
  const events: AnyEvent[] = [];
  const clock = (iso: string) => encodeHlc(Date.parse(iso), 0, DEVICE);
  const emit = <T extends EventType>(id: string, type: T, actorId: string, at: string, payload: EventPayloads[T]) => {
    events.push({ id: `v2:${id}`, type, orgId: opts.orgId, projectId, actorId, deviceId: DEVICE, hlc: clock(at), payload } as AnyEvent);
  };

  // Roles come from what people did, since v2 only knows owner and member:
  // owners stay owners; someone who both recorded and voted needs a role that
  // may do both (coordinator); a voter is a reviewer; everyone else who was a
  // member or recorded is a translator. The first owner bootstraps, because
  // the server lets a project's first two events come from one actor only.
  const translations = rows.assets.filter((a) => a.source_asset_id !== null);
  const recorded = new Set(translations.flatMap((t) => (t.creator_id ? [t.creator_id] : [])));
  const voted = new Set(rows.votes.flatMap((v) => (v.creator_id ? [v.creator_id] : [])));
  const activeMembers = rows.members.filter((m) => m.active).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const roles = new Map<string, Role>();
  for (const id of [...activeMembers.map((m) => m.profile_id), ...recorded, ...voted]) {
    if (roles.has(id)) continue;
    roles.set(id, recorded.has(id) && voted.has(id) ? 'coordinator' : voted.has(id) ? 'reviewer' : 'translator');
  }
  for (const m of activeMembers) if (m.membership === 'owner') roles.set(m.profile_id, 'owner');
  for (const g of opts.grant ?? []) roles.set(g.profileId, g.role);
  const owner = activeMembers.find((m) => m.membership === 'owner')?.profile_id ?? rows.project.creator_id ?? SYSTEM_ACTOR;
  roles.set(owner, 'owner');

  const sourceLanguoid = rows.languages.find((l) => l.language_type === 'source' && l.active)?.languoid_id ?? 'unknown';
  const t0 = rows.project.created_at;
  emit(`project:${projectId}`, 'v1.ProjectCreated', owner, t0, { name: rows.project.name, sourceLanguoidId: sourceLanguoid });
  // The role is part of the id and of the clock, so a later run that derives
  // a stronger role for someone appends a new register that wins the fold
  // instead of colliding with the old event id.
  const member = (profileId: string, role: Role) => {
    events.push({
      id: `v2:member:${projectId}:${profileId}:${role}`, type: 'v1.MemberAdded', orgId: opts.orgId, projectId, actorId: owner,
      deviceId: DEVICE, hlc: encodeHlc(Date.parse(t0), ROLE_RANK[role], DEVICE), payload: { profileId, role }
    });
  };
  member(owner, 'owner');
  for (const [profileId, role] of roles) if (profileId !== owner) member(profileId, role);
  report.members = roles.size;

  const lanes = new Map<string, string>();
  for (const l of rows.languages) {
    if (l.language_type !== 'target' || !l.active || !l.languoid_id || lanes.has(l.languoid_id)) continue;
    const laneId = `lane:${l.languoid_id}`;
    lanes.set(l.languoid_id, laneId);
    emit(`lane:${projectId}:${l.languoid_id}`, 'v1.LaneAdded', owner, t0, { laneId, languoidId: l.languoid_id });
  }
  const defaultLane = [...lanes.values()][0];

  const questOrder = [...rows.quests].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  questOrder.forEach((q, i) => {
    emit(`unit:${q.id}`, 'v1.UnitAdded', owner, q.created_at, {
      unitId: q.id, parentUnitId: null, kind: 'book', label: q.name ?? `Quest ${i + 1}`, order: pad(i)
    });
    report.books += 1;
  });

  const questOf = new Map<string, { quest_id: string; order_index: number }>();
  for (const l of rows.questAssets) {
    const prior = questOf.get(l.asset_id);
    if (!prior) questOf.set(l.asset_id, { quest_id: l.quest_id, order_index: l.order_index ?? 0 });
  }
  const sources = rows.assets.filter((a) => a.source_asset_id === null).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const passageIds = new Set<string>();
  sources.forEach((a, i) => {
    const link = questOf.get(a.id);
    if (!link) {
      report.unlinkedAssets += 1;
      return;
    }
    passageIds.add(a.id);
    const firstText = a.content.find((c) => c.text)?.text ?? '';
    emit(`unit:${a.id}`, 'v1.UnitAdded', owner, a.created_at, {
      unitId: a.id, parentUnitId: link.quest_id, kind: 'passage',
      label: a.name || firstText.slice(0, 60) || a.id, order: `${pad(link.order_index)}.${pad(i)}`
    });
    report.passages += 1;
    a.content.forEach((c, j) => {
      if (c.text) {
        emit(`ref:${a.id}:${j}:text`, 'v1.ReferenceAttached', owner, a.created_at, { unitId: a.id, refId: `${a.id}:${j}:text`, kind: 'source_text', text: c.text });
        report.references += 1;
      }
      for (const name of c.audio ?? []) {
        const blob = opts.blobs.get(name);
        if (!blob) {
          report.missingAudio.push(name);
          continue;
        }
        emit(`ref:${a.id}:${j}:${name}`, 'v1.ReferenceAttached', owner, a.created_at, { unitId: a.id, refId: `${a.id}:${j}:${blob.hash}`, kind: 'source_audio', blobHash: blob.hash });
        report.references += 1;
      }
    });
  });

  const takeOfAsset = new Map<string, string>();
  for (const t of translations) {
    if (!t.source_asset_id || !passageIds.has(t.source_asset_id) || !defaultLane) continue;
    const names = t.content.flatMap((c) => c.audio ?? []);
    if (names.length === 0) {
      report.textOnlyTranslations += 1;
      continue;
    }
    const actor = t.creator_id ?? owner;
    const cards = names.flatMap((name) => {
      const blob = opts.blobs.get(name);
      if (!blob) {
        report.missingAudio.push(name);
        return [];
      }
      return [{ hash: blob.hash, durationMs: blob.durationMs, format: 'm4a' as const }];
    });
    if (cards.length === 0) continue;
    const unitId = t.source_asset_id;
    emit(`rec:${t.id}`, 'v1.RecordingAdded', actor, t.created_at, { recordingId: t.id, unitId, laneId: defaultLane, kind: 'target', cards });
    const takeId = `take:${t.id}`;
    emit(`take:${t.id}`, 'v1.TakeComposed', actor, t.created_at, { takeId, unitId, laneId: defaultLane, cardHashes: cards.map((c) => c.hash), parentTakeId: null });
    emit(`select:${t.id}`, 'v1.TakeSelected', actor, t.created_at, { unitId, laneId: defaultLane, takeId });
    emit(`submit:${t.id}`, 'v1.TakeSubmitted', actor, t.created_at, { takeId });
    takeOfAsset.set(t.id, takeId);
    report.takes += 1;
  }

  for (const v of rows.votes) {
    const takeId = takeOfAsset.get(v.asset_id);
    if (!takeId) continue;
    const up = v.polarity === 'up';
    emit(`vote:${v.id}`, 'v1.ReviewSubmitted', v.creator_id ?? owner, v.created_at, {
      takeId, stepId: STEP, decision: up ? 'approve' : 'suggest_changes', ...(v.comment ? { comment: v.comment } : {})
    });
    report.reviews += 1;
  }

  report.events = events.length;
  return { events, report, owner, roles };
}

function pad(n: number): string {
  return String(Math.max(0, Math.trunc(n))).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Reading v2. Anonymous read is enough: v2 grants SELECT on these tables to
// everyone. Pages of 1000 (PostgREST's cap) walked by offset.
// ---------------------------------------------------------------------------

export interface V2Source {
  url: string;
  anonKey: string;
  /** Public bucket holding v2 audio; objects are addressed by the names in asset_content_link.audio. */
  bucket: string;
}

async function pageAll<T>(src: V2Source, path: string): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; ; off += 1000) {
    const res = await fetch(`${src.url}/rest/v1/${path}`, { headers: { apikey: src.anonKey, Range: `${off}-${off + 999}` } });
    const body = (await res.json()) as T[] | { message: string };
    if (!Array.isArray(body)) throw new Error(`v2 ${path}: ${(body as { message: string }).message}`);
    out.push(...body);
    if (body.length < 1000) return out;
  }
}

export async function fetchV2Rows(src: V2Source, projectId: string): Promise<V2Rows> {
  const p = encodeURIComponent(projectId);
  const [projects, languages, members, quests, questAssets, assets] = await Promise.all([
    pageAll<V2Rows['project']>(src, `project?select=id,name,description,created_at,creator_id&id=eq.${p}`),
    pageAll<V2Rows['languages'][number]>(src, `project_language_link?select=language_type,languoid_id,active&project_id=eq.${p}`),
    pageAll<V2Rows['members'][number]>(src, `profile_project_link?select=profile_id,membership,active,created_at&project_id=eq.${p}`),
    pageAll<V2Rows['quests'][number]>(src, `quest?select=id,name,created_at&project_id=eq.${p}&active=eq.true&order=created_at,id`),
    pageAll<{ quest_id: string; asset_id: string; order_index: number | null }>(
      src, `quest_asset_link?select=quest_id,asset_id,order_index,quest!inner(project_id)&quest.project_id=eq.${p}&active=eq.true&order=quest_id,order_index`
    ),
    pageAll<{ id: string; name: string | null; source_asset_id: string | null; creator_id: string | null; created_at: string; asset_content_link: { text: string | null; audio: string[] | null; active: boolean; order_index: number }[] }>(
      src, `asset?select=id,name,source_asset_id,creator_id,created_at,asset_content_link(text,audio,active,order_index)&project_id=eq.${p}&active=eq.true&order=created_at,id`
    )
  ]);
  const project = projects[0];
  if (!project) throw new Error(`v2 project ${projectId} not found`);
  const ids = new Set(assets.map((a) => a.id));
  const votes: V2Rows['votes'] = [];
  for (const chunk of chunks([...ids], 200)) {
    votes.push(...(await pageAll<V2Rows['votes'][number]>(src, `vote?select=id,asset_id,polarity,comment,creator_id,created_at&active=eq.true&asset_id=in.(${chunk.join(',')})`)));
  }
  return {
    project,
    languages,
    members,
    quests,
    questAssets: questAssets.map(({ quest_id, asset_id, order_index }) => ({ quest_id, asset_id, order_index })),
    assets: assets.map((a) => ({
      id: a.id, name: a.name, source_asset_id: a.source_asset_id, creator_id: a.creator_id, created_at: a.created_at,
      content: (a.asset_content_link ?? []).filter((c) => c.active).sort((x, y) => x.order_index - y.order_index).map(({ text, audio }) => ({ text, audio }))
    })),
    votes
  };
}

/** Every active v2 project id, oldest first. */
export async function fetchV2ProjectIds(src: V2Source): Promise<string[]> {
  const rows = await pageAll<{ id: string }>(src, 'project?select=id&active=eq.true&order=created_at,id');
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Following v2. A phone that was offline for weeks uploads rows whose
// `created_at` is weeks old, so `created_at` cannot say what is new. v2's
// server stamps `uploaded_at = now()` on insert (and `audio_uploaded_at` when
// the audio object lands later), and its membership and language triggers
// stamp `last_updated` server-side. Those are the watermarks.
// ---------------------------------------------------------------------------

type Stamped = Record<string, unknown> & { project_id?: string; quest?: { project_id: string }; asset?: { project_id: string } };

/** What to watch per table: the server-set stamp columns and how to reach the project. */
const WATCHED: { table: string; select: string; stamp: string }[] = [
  { table: 'project', select: 'id,project_id:id', stamp: 'uploaded_at' },
  { table: 'quest', select: 'id,project_id', stamp: 'uploaded_at' },
  { table: 'quest_asset_link', select: 'quest_id,asset_id,quest!inner(project_id)', stamp: 'uploaded_at' },
  { table: 'asset', select: 'id,project_id', stamp: 'uploaded_at' },
  // Two queries, not one with an OR: v2 times out on the OR, each alone is indexed and fast.
  { table: 'asset_content_link', select: 'id,asset!inner(project_id)', stamp: 'uploaded_at' },
  { table: 'asset_content_link', select: 'id,asset!inner(project_id)', stamp: 'audio_uploaded_at' },
  { table: 'vote', select: 'id,asset!inner(project_id)', stamp: 'uploaded_at' },
  { table: 'profile_project_link', select: 'profile_id,project_id', stamp: 'last_updated' },
  { table: 'project_language_link', select: 'languoid_id,language_type,project_id', stamp: 'last_updated' }
];

export interface V2Cursor {
  /** Newest server stamp seen, ISO. Queries look back `overlapMs` before it. */
  watermark: string;
  /** Rows already reported inside the overlap window, so they are not reported twice. */
  seen: Record<string, string>;
}

/**
 * Projects with rows v2's server received after the cursor. The look-back
 * overlap catches rows whose transaction committed after a later-stamped one
 * was already read; `seen` keeps the overlap from re-reporting them. The
 * watermark only moves to stamps v2 itself wrote, never to this machine's clock.
 */
export async function changedV2Projects(
  src: V2Source, cursor: V2Cursor, overlapMs = 60_000, get: <T>(path: string) => Promise<T[]> = (path) => pageAll(src, path)
): Promise<{ projects: Set<string>; cursor: V2Cursor }> {
  const since = new Date(Date.parse(cursor.watermark) - overlapMs).toISOString();
  const projects = new Set<string>();
  const seen: Record<string, string> = { ...cursor.seen };
  let watermark = cursor.watermark;
  for (const w of WATCHED) {
    const rows = await get<Stamped>(`${w.table}?select=${w.select},${w.stamp}&${w.stamp}=gt.${since}`);
    for (const row of rows) {
      if (typeof row[w.stamp] !== 'string') continue;
      const stamp = new Date(row[w.stamp] as string).toISOString();
      const key = `${w.table}.${w.stamp}:${JSON.stringify(row)}`;
      if (seen[key]) continue;
      seen[key] = stamp;
      const projectId = row.project_id ?? row.quest?.project_id ?? row.asset?.project_id;
      if (projectId) projects.add(projectId);
      if (stamp > watermark) watermark = stamp;
    }
  }
  const floor = new Date(Date.parse(watermark) - overlapMs).toISOString();
  for (const [k, stamp] of Object.entries(seen)) if (stamp <= floor) delete seen[k];
  return { projects, cursor: { watermark, seen } };
}

export function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

/** Every v2 object name the rows reference, in first-seen order. */
export function audioNames(rows: V2Rows): string[] {
  const seen = new Set<string>();
  for (const a of rows.assets) for (const c of a.content) for (const n of c.audio ?? []) seen.add(n);
  return [...seen];
}

// ---------------------------------------------------------------------------
// Copying audio. Download by name from v2, hash, upload by hash here. The
// storage trigger appends BlobStored, so the log learns of each blob the
// same way it learns of a phone's upload.
// ---------------------------------------------------------------------------

export interface BlobCopyDeps {
  download(name: string): Promise<Uint8Array | null>;
  digest(bytes: Uint8Array): Promise<string>;
  durationMs(bytes: Uint8Array, name: string): Promise<number>;
  upload(orgId: string, projectId: string, hash: string, bytes: Uint8Array): Promise<void>;
  /** Hashes already stored in the target log (skip re-upload). */
  alreadyStored?: ReadonlySet<string>;
  onProgress?(done: number, total: number): void;
  /** Attempts per file before it is reported failed. Default 3. */
  attempts?: number;
  /** Pause between attempts; default exponential from 500 ms. Injected so tests do not sleep. */
  backoff?(attempt: number): Promise<void>;
}

export async function copyBlobs(
  names: string[], orgId: string, projectId: string, deps: BlobCopyDeps, concurrency = 8
): Promise<{ blobs: Map<string, CopiedBlob>; failed: { name: string; reason: string }[] }> {
  const blobs = new Map<string, CopiedBlob>();
  const failed: { name: string; reason: string }[] = [];
  let next = 0;
  let done = 0;
  const attempts = deps.attempts ?? 3;
  const backoff = deps.backoff ?? ((n: number) => new Promise<void>((r) => setTimeout(r, 500 * 2 ** (n - 1))));
  // A transient network failure is not evidence the object is unusable: retry,
  // and only report the file after the last attempt. A missing object in v2 is
  // a fact, not a fault, so it is not retried.
  const worker = async () => {
    for (;;) {
      const i = next++;
      const name = names[i];
      if (name === undefined) return;
      for (let attempt = 1; ; attempt++) {
        try {
          const bytes = await deps.download(name);
          if (!bytes) {
            failed.push({ name, reason: 'not found in v2 bucket' });
            break;
          }
          const hash = await deps.digest(bytes);
          const durationMs = await deps.durationMs(bytes, name);
          if (!deps.alreadyStored?.has(hash)) await deps.upload(orgId, projectId, hash, bytes);
          blobs.set(name, { hash, durationMs });
          break;
        } catch (err) {
          if (attempt >= attempts) {
            failed.push({ name, reason: `${(err as Error).message} (after ${attempts} attempts)` });
            break;
          }
          await backoff(attempt);
        }
      }
      done += 1;
      deps.onProgress?.(done, names.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, names.length) }, worker));
  return { blobs, failed };
}

/** Push in pages of 200 as a service-role caller. Any rejection is returned, never swallowed. */
export async function appendAll(service: SupabaseClient, events: AnyEvent[]): Promise<{ accepted: number; duplicates: number; rejected: { id: string; reason: string }[] }> {
  const out = { accepted: 0, duplicates: 0, rejected: [] as { id: string; reason: string }[] };
  for (const page of chunks(events, 200)) {
    const { data, error } = await service.rpc('append_events', { p_events: page, p_client_version: CLIENT_PROTOCOL_VERSION });
    if (error) throw new Error(`append_events: ${error.message}`);
    for (const r of data as { id: string; accepted: boolean; reason: string | null }[]) {
      if (!r.accepted) out.rejected.push({ id: r.id, reason: r.reason ?? 'unknown' });
      else if (r.reason === 'duplicate') out.duplicates += 1;
      else out.accepted += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The org partition for imported projects.
//
// v2 has no organization: it has projects with member links. Without an org
// partition an imported org has no roles and no org memberships, so every
// org-level feature (invites, roles, the members screen at org scope) has
// nothing to work with. Seeding it here makes an imported org the same shape
// as one created in the app, which is what `CreateOrg` builds by hand.
// ---------------------------------------------------------------------------

/** Project role -> the seeded org role that carries the same privileges. */
const ORG_ROLE_OF: Record<Role, string> = {
  owner: 'org_admin',
  coordinator: 'project_coordinator',
  translator: 'translator',
  reviewer: 'reviewer',
  viewer: 'viewer'
};

export interface SeededProject {
  projectId: string;
  name: string;
  /** Project memberships as the mapper derived them. */
  roles: ReadonlyMap<string, Role>;
}

/**
 * Events for the `_org` partition. Order matters: the server lets an org
 * with no members accept its creation and its creator's own admin
 * membership, so the owner's org-scope membership comes before anyone
 * else's. Ids derive from the org and profile, so re-running appends
 * nothing new.
 */
export function mapOrgSeed(orgId: string, orgName: string, owner: string, projects: SeededProject[], at: string): AnyEvent[] {
  const events: AnyEvent[] = [];
  const clock = (n: number) => encodeHlc(Date.parse(at), n, DEVICE);
  let n = 0;
  const emit = <T extends EventType>(id: string, type: T, payload: EventPayloads[T]) => {
    events.push({ id: `v2:${id}`, type, orgId, projectId: ORG_PARTITION, actorId: owner, deviceId: DEVICE, hlc: clock(n++), payload } as AnyEvent);
  };

  emit(`org:${orgId}`, 'v1.OrgCreated', { name: orgName });
  for (const r of SEED_ROLES) emit(`role:${orgId}:${r.roleId}`, 'v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
  emit(`orgmember:${orgId}:${owner}:org`, 'v1.OrgMemberAdded', { profileId: owner, roleId: 'org_admin', scope: { level: 'org' } });

  for (const p of projects) {
    emit(`projreg:${orgId}:${p.projectId}`, 'v1.ProjectRegistered', { projectId: p.projectId, name: p.name });
    for (const [profileId, role] of p.roles) {
      if (profileId === owner) continue;
      // Scope follows where the person actually worked, never the role (A38).
      const scope: Scope = { level: 'project', projectId: p.projectId };
      emit(`orgmember:${orgId}:${profileId}:${p.projectId}`, 'v1.OrgMemberAdded', { profileId, roleId: ORG_ROLE_OF[role], scope });
    }
  }
  return events;
}
