import { CLIENT_PROTOCOL_VERSION, encodeHlc, ORG_STREAM, SEED_ROLES, type AnyEvent, type EventPayloads, type EventType, type Role } from '@langquest-next/core';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * LangQuest v2 rows -> events (PLAN.md build order step 8).
 *
 * v2 keeps state in rows; this app keeps intents in a log. The mapping is a
 * pure function of the rows so a re-run appends nothing new: every event id
 * is derived from the v2 row it came from and every clock from the row's
 * `created_at`, and `append_events` treats a known id as a duplicate.
 *
 * One v2 project becomes one language, whose id is the project's id. A
 * project with several target languages is refused: it does not happen in
 * practice, and a language here is one target language (decision 63).
 *
 *   project + target language   -> LanguageAdded (organization stream, `mapOrgSeed`)
 *   profile_project_link        -> MemberAdded at the language's scope (`mapOrgSeed`)
 *   quest                       -> UnitAdded kind "book"
 *   source asset (via quest_asset_link) -> UnitAdded kind "passage" under its first quest
 *   source asset_content_link   -> a source material on the passage (text and audio fields)
 *   translation asset with audio -> RecordingAdded + TakeComposed + TakeSubmitted
 *   vote                        -> ReviewRecorded, community kind, in a one-step custom flow
 *
 * Audio is the one thing rows cannot carry across: v2 names objects, this
 * app names bytes. The caller copies each object first (download, hash,
 * upload) and hands the mapper the hash and duration per v2 object name.
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

interface CopiedBlob {
  hash: string;
  durationMs: number;
}

interface MapOptions {
  orgId: string;
  /** v2 object name -> the blob as stored in this app. Missing names are reported and skipped. */
  blobs: ReadonlyMap<string, CopiedBlob>;
  /** Extra memberships, e.g. the account that will open the demo. */
  grant?: { profileId: string; role: Role }[];
}

interface MapReport {
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

/** What the organization stream needs to list an imported language (`mapOrgSeed`). */
interface SeededLanguage {
  languageId: string;
  name: string;
  code: string;
  sourceCode: string;
  /** Who worked in the project, and the role their work amounts to. */
  roles: ReadonlyMap<string, Role>;
}

const DEVICE = 'v2import';
const SYSTEM_ACTOR = 'v2import';
const KIND = 'community';

/** The language's events, and what its organization stream must say about it first. */
export function mapV2Project(rows: V2Rows, opts: MapOptions): { events: AnyEvent[]; report: MapReport; owner: string; language: SeededLanguage } {
  const languageId = rows.project.id;
  const targets = [...new Set(rows.languages.filter((l) => l.language_type === 'target' && l.active && l.languoid_id).map((l) => l.languoid_id!))];
  if (targets.length > 1) {
    throw new Error(`v2 project ${languageId} has ${targets.length} target languages (${targets.join(', ')}); a language here is one target language`);
  }
  const report: MapReport = {
    events: 0, books: 0, passages: 0, references: 0, takes: 0, reviews: 0, members: 0,
    unlinkedAssets: 0, textOnlyTranslations: 0, missingAudio: []
  };
  const events: AnyEvent[] = [];
  const clock = (iso: string) => encodeHlc(Date.parse(iso), 0, DEVICE);
  const emit = <T extends EventType>(id: string, type: T, actorId: string, at: string, payload: EventPayloads[T]) => {
    events.push({ id: `v2:${id}`, type, orgId: opts.orgId, streamId: languageId, actorId, deviceId: DEVICE, hlc: clock(at), payload } as AnyEvent);
  };

  // Roles come from what people did, since v2 only knows owner and member:
  // owners stay owners; someone who both recorded and voted needs a role that
  // may do both (coordinator); a voter is a reviewer; everyone else who was a
  // member or recorded is a translator.
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
  report.members = roles.size;

  const t0 = rows.project.created_at;
  // v2 votes were community checks: a one-step custom flow makes them count.
  emit(`flow:${languageId}`, 'v1.FlowSelected', owner, t0, { flowId: 'custom' });
  emit(`step:${languageId}`, 'v1.FlowStepSet', owner, t0, { stepId: `custom/${KIND}`, order: 's00', kindIds: [KIND], checkpoint: false });

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
    // The passage's source text and audio, as one material on it: fields are registers, so a re-run adds nothing.
    const materialId = `v2src:${a.id}`;
    let defined = false;
    const define = () => {
      if (defined) return;
      defined = true;
      emit(`src:${a.id}`, 'v1.MaterialDefined', owner, a.created_at, { materialId, kind: 'source', title: 'Source', scope: { unitId: a.id } });
    };
    a.content.forEach((c, j) => {
      if (c.text) {
        define();
        emit(`src:${a.id}:${j}:text`, 'v1.MaterialFieldSet', owner, a.created_at, { materialId, fieldId: `${j}:text`, text: c.text });
        report.references += 1;
      }
      (c.audio ?? []).forEach((name, k) => {
        const blob = opts.blobs.get(name);
        if (!blob) {
          report.missingAudio.push(name);
          return;
        }
        define();
        emit(`src:${a.id}:${j}:${name}`, 'v1.MaterialFieldSet', owner, a.created_at, { materialId, fieldId: `${j}:audio:${k}`, blobHash: blob.hash });
        report.references += 1;
      });
    });
  });

  const takeOfAsset = new Map<string, string>();
  for (const t of translations) {
    if (!t.source_asset_id || !passageIds.has(t.source_asset_id)) continue;
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
    emit(`rec:${t.id}`, 'v1.RecordingAdded', actor, t.created_at, { recordingId: t.id, unitId, kind: 'target', cards });
    const takeId = `take:${t.id}`;
    emit(`take:${t.id}`, 'v1.TakeComposed', actor, t.created_at, { takeId, unitId, cardHashes: cards.map((c) => c.hash), parentTakeId: null });
    emit(`submit:${t.id}`, 'v1.TakeSubmitted', actor, t.created_at, { takeId });
    takeOfAsset.set(t.id, takeId);
    report.takes += 1;
  }

  for (const v of rows.votes) {
    const takeId = takeOfAsset.get(v.asset_id);
    if (!takeId) continue;
    emit(`vote:${v.id}`, 'v1.ReviewRecorded', v.creator_id ?? owner, v.created_at, {
      reviewId: `v2:vote:${v.id}`, takeId, kindId: KIND, outcome: v.polarity === 'up' ? 'looks_good' : 'needs_changes', via: 'app',
      ...(v.comment ? { comment: v.comment } : {})
    });
    report.reviews += 1;
  }

  report.events = events.length;
  const sourceCode = rows.languages.find((l) => l.language_type === 'source' && l.active)?.languoid_id ?? 'eng';
  return {
    events, report, owner,
    language: { languageId, name: rows.project.name, code: targets[0] ?? 'und', sourceCode, roles }
  };
}

function pad(n: number): string {
  return String(Math.max(0, Math.trunc(n))).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Reading v2. Anonymous read is enough: v2 grants SELECT on these tables to
// everyone. Pages of 1000 (PostgREST's cap) walked by offset.
// ---------------------------------------------------------------------------

interface V2Source {
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

function* chunks<T>(items: T[], size: number): Generator<T[]> {
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

interface BlobCopyDeps {
  download(name: string): Promise<Uint8Array | null>;
  digest(bytes: Uint8Array): Promise<string>;
  durationMs(bytes: Uint8Array, name: string): Promise<number>;
  upload(orgId: string, streamId: string, hash: string, bytes: Uint8Array): Promise<void>;
  /** Hashes already stored in the target log (skip re-upload). */
  alreadyStored?: ReadonlySet<string>;
  onProgress?(done: number, total: number): void;
  /** Attempts per file before it is reported failed. Default 3. */
  attempts?: number;
  /** Pause between attempts; default exponential from 500 ms. Injected so tests do not sleep. */
  backoff?(attempt: number): Promise<void>;
}

export async function copyBlobs(
  names: string[], orgId: string, streamId: string, deps: BlobCopyDeps, concurrency = 8
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
          if (!deps.alreadyStored?.has(hash)) await deps.upload(orgId, streamId, hash, bytes);
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
// The organization stream for imported projects.
//
// v2 has no organization: it has projects with member links. Seeding the
// organization stream here makes an imported organization the same shape as
// one created in the app: its roles, its owner, and each language listed
// (which a language stream needs before it accepts events) with the people
// who worked in it at that language's scope.
// ---------------------------------------------------------------------------

/** Project role -> the seeded org role that carries the same privileges. */
const ORG_ROLE_OF: Record<Role, string> = {
  owner: 'org_admin',
  coordinator: 'coordinator',
  translator: 'translator',
  reviewer: 'reviewer',
  viewer: 'viewer'
};

/**
 * Events for the organization stream; append them before the languages'.
 * Order matters: the server lets an organization with no members accept its
 * creation and its creator's own admin membership, so the owner's org-scope
 * membership comes before anyone else's. Ids derive from the organization,
 * language and profile, so re-running appends nothing new.
 */
export function mapOrgSeed(orgId: string, orgName: string, owner: string, languages: SeededLanguage[], at: string): AnyEvent[] {
  const events: AnyEvent[] = [];
  const clock = (n: number) => encodeHlc(Date.parse(at), n, DEVICE);
  let n = 0;
  const emit = <T extends EventType>(id: string, type: T, payload: EventPayloads[T]) => {
    events.push({ id: `v2:${id}`, type, orgId, streamId: ORG_STREAM, actorId: owner, deviceId: DEVICE, hlc: clock(n++), payload } as AnyEvent);
  };

  emit(`org:${orgId}`, 'v1.OrgCreated', { name: orgName });
  for (const r of SEED_ROLES) emit(`role:${orgId}:${r.roleId}`, 'v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
  emit(`orgmember:${orgId}:${owner}:org`, 'v1.MemberAdded', { profileId: owner, roleId: 'org_admin', scope: { level: 'org' } });

  for (const l of languages) {
    emit(`language:${orgId}:${l.languageId}`, 'v1.LanguageAdded', { languageId: l.languageId, name: l.name, code: l.code, sourceCode: l.sourceCode });
    for (const [profileId, role] of l.roles) {
      if (profileId === owner) continue;
      // Scope follows where the person actually worked, never the role (A38).
      emit(`orgmember:${orgId}:${profileId}:${l.languageId}`, 'v1.MemberAdded', {
        profileId, roleId: ORG_ROLE_OF[role], scope: { level: 'language', languageId: l.languageId }
      });
    }
  }
  return events;
}
