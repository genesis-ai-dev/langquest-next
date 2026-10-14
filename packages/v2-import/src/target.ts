import type { SupabaseClient } from '@supabase/supabase-js';
import { CLIENT_PROTOCOL_VERSION, type AnyEvent, type TemplateDoc, type VersificationDoc } from '@langquest-next/core';
import type { CopiedFile } from './map';
import type { LedgerEntry } from './reconcile';

/**
 * This app's side of the import: the plan the board saved, the ledger, the
 * file map, the log and the files, all as the service role. Everything the
 * import keeps of its own is in the `v2_import` schema, reached through the
 * `v2_import_*` functions (migration 20261013000000_v2_import.sql).
 */
export interface Target {
  plan(): Promise<Plan>;
  savePlan(orgs: PlanOrg[], placements: SavedPlacement[], by: string): Promise<void>;
  /** A person's role in one project's language; null goes back to what their v2 work says. */
  setRole(projectId: string, profileId: string, role: ChosenRole | null, by: string): Promise<void>;
  ledger(scope: string): Promise<Map<string, LedgerEntry>>;
  putLedger(scope: string, entries: LedgerEntry[]): Promise<void>;
  /** Files by v2 name: copied, or missing from v2's bucket since when. */
  files(names: string[]): Promise<Map<string, CopiedFile | { missingSince: string }>>;
  putFiles(files: { name: string; file: CopiedFile | null }[]): Promise<void>;
  /** Append as the service role; every refusal comes back with its reason. */
  append(events: AnyEvent[], onProgress?: (done: number) => unknown): Promise<{ accepted: number; duplicates: number; rejected: { id: string; reason: string }[] }>;
  /** Hashes already in R2 for one language. */
  stored(orgId: string, streamId: string): Promise<Set<string>>;
  upload(orgId: string, streamId: string, hash: string, format: 'wav' | 'm4a', bytes: Uint8Array): Promise<void>;
  /** A LangQuest library item's current version, with its versification. */
  template(itemId: string): Promise<{ docHash: string; doc: TemplateDoc; versification: VersificationDoc | null } | null>;
  /** A LangQuest library item's name and current version, or null when the library has no such item. */
  libraryItem(itemId: string): Promise<{ name: string; docHash: string } | null>;
  /** Let an organization read a library document and what it depends on. */
  grantLibrary(orgId: string, docHash: string): Promise<void>;
  /** The readable code for a languoid: ISO 639-3, else its glottocode. Null when this database does not have it. */
  languoidCode(languoidId: string): Promise<string | null>;
  /** Who created the organization here, if anyone: an organization people made is filled only when the board chose it. */
  orgCreator(orgId: string): Promise<string | null>;
  /** Names for people the import names, only where they have none here yet. */
  addNames(people: { id: string; name: string }[]): Promise<void>;
  /** A transfer of one project starts; its id names it in the log. */
  passStart(projectId: string, orgId: string, by: string): Promise<number>;
  passProgress(passId: number, progress: Progress): Promise<void>;
  passFinish(passId: number, report: unknown, error?: string): Promise<void>;
  log(lines: LogLine[]): Promise<void>;
  /** Each project's latest transfer, the log after a line, and how many v2 people have signed in here. */
  status(after: number): Promise<Status>;
  /** v2 people by id: their name here, and when they first and last signed in, if they have. */
  people(ids: string[]): Promise<PersonHere[]>;
  /** People from v2 who have signed in here, newest first. */
  signedIn(): Promise<PersonHere[]>;
  /** One project's log, newest first. */
  projectLog(projectId: string): Promise<(LogLine & { id: number; at: string })[]>;
  cursor(name: string, value?: Date): Promise<Date | null>;
}

export interface PlanOrg {
  org_id: string;
  name: string;
  existing: boolean;
  admins: string[];
}

export interface PlanPlacement {
  project_id: string;
  org_id: string | null;
  name?: string | null;
  languoid_id: string | null;
  code: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
}

export interface SavedPlacement {
  project_id: string;
  org_id: string | null;
  name?: string | null;
  languoid_id: string | null;
  code: string | null;
  confirmed: boolean;
}

/** A role chosen on the dashboard: an organization role's id at the language's scope, or none. */
export type ChosenRole = 'org_admin' | 'coordinator' | 'translator' | 'reviewer' | 'viewer' | 'none';

export interface Plan {
  orgs: PlanOrg[];
  placements: PlanPlacement[];
  roles: { project_id: string; profile_id: string; role: ChosenRole }[];
  passes: { project_id: string; finished_at: string; report: unknown }[];
}

/** Where a running transfer has got to. */
export interface Progress {
  step: 'reading' | 'files' | 'uploading' | 'events' | 'done';
  done?: number;
  total?: number;
}

export interface LogLine {
  pass_id?: number;
  project_id?: string;
  org_id?: string;
  level: 'info' | 'done' | 'warn' | 'error';
  message: string;
  counts?: Record<string, number>;
}

export interface PassRow {
  id: number;
  project_id: string;
  org_id: string | null;
  started_by: string | null;
  started_at: string;
  progress: Progress | Record<string, never>;
  progress_at: string;
  finished_at: string | null;
  report: unknown;
  error: string | null;
  /** When it last finished a transfer without an error. */
  last_done: string | null;
}

export interface Status {
  passes: PassRow[];
  log: (LogLine & { id: number; at: string })[];
  signed_in: number;
}

export interface PersonHere {
  id: string;
  display_name: string | null;
  signed_in_at: string | null;
  last_sign_in_at: string | null;
}

export interface BlobFilesLike {
  list(prefix: string): Promise<{ key: string; size: number }[]>;
  put(key: string, bytes: Uint8Array): Promise<void>;
}

const LIBRARY_ORG = 'langquest';

export function supabaseTarget(db: SupabaseClient, files: BlobFilesLike): Target {
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  };
  return {
    plan: () => rpc<Plan>('v2_import_plan', {}),
    savePlan: (orgs, placements, by) => rpc('v2_import_save_plan', { p_orgs: orgs, p_placements: placements, p_by: by }),
    setRole: (projectId, profileId, role, by) => rpc('v2_import_set_role', { p_project: projectId, p_profile: profileId, p_role: role, p_by: by }),

    async ledger(scope) {
      const out = new Map<string, LedgerEntry>();
      for (let after = ''; ; ) {
        const page = await rpc<LedgerEntry[]>('v2_import_ledger', { p_scope: scope, p_after: after, p_limit: 5000 });
        for (const e of page) out.set(e.key, e);
        if (page.length < 5000) return out;
        after = page[page.length - 1]!.key;
      }
    },
    async putLedger(scope, entries) {
      for (let i = 0; i < entries.length; i += 2000) await rpc('v2_import_ledger_put', { p_scope: scope, p_entries: entries.slice(i, i + 2000) });
    },

    async files(names) {
      const out = new Map<string, CopiedFile | { missingSince: string }>();
      for (let i = 0; i < names.length; i += 2000) {
        const rows = await rpc<{ name: string; hash: string | null; size: number; duration_ms: number; format: 'wav' | 'm4a'; missing_since: string | null }[]>('v2_import_files', { p_names: names.slice(i, i + 2000) });
        for (const r of rows) out.set(r.name, r.hash ? { hash: r.hash, size: Number(r.size), durationMs: r.duration_ms, format: r.format } : { missingSince: r.missing_since ?? new Date(0).toISOString() });
      }
      return out;
    },
    async putFiles(list) {
      const rows = list.map(({ name, file }) => (file ? { name, hash: file.hash, size: file.size, duration_ms: file.durationMs, format: file.format } : { name }));
      for (let i = 0; i < rows.length; i += 2000) await rpc('v2_import_files_put', { p_files: rows.slice(i, i + 2000) });
    },

    async append(events, onProgress) {
      const out = { accepted: 0, duplicates: 0, rejected: [] as { id: string; reason: string }[] };
      for (let i = 0; i < events.length; i += 200) {
        const page = events.slice(i, i + 200);
        const data = await rpc<{ id: string; accepted: boolean; reason: string | null }[]>('append_events', { p_events: page, p_client_version: CLIENT_PROTOCOL_VERSION });
        for (const r of data) {
          if (!r.accepted) out.rejected.push({ id: r.id, reason: r.reason ?? 'unknown' });
          else if (r.reason === 'duplicate') out.duplicates += 1;
          else out.accepted += 1;
        }
        await onProgress?.(i + page.length);
      }
      return out;
    },

    async stored(orgId, streamId) {
      const objects = await files.list(`${orgId}/${streamId}/`);
      return new Set(objects.map((o) => o.key.slice(o.key.lastIndexOf('/') + 1).replace(/\.[a-z0-9]+$/, '')));
    },
    upload: (orgId, streamId, hash, format, bytes) => files.put(`${orgId}/${streamId}/${hash}.${format}`, bytes),

    async template(itemId) {
      const { data, error } = await db.from('library_versions').select('doc_hash, hlc').eq('org_id', LIBRARY_ORG).eq('item_id', itemId)
        .order('hlc', { ascending: false }).limit(1);
      if (error) throw new Error(`library_versions: ${error.message}`);
      const docHash = data?.[0]?.doc_hash as string | undefined;
      if (!docHash) return null;
      const doc = await documentBody<TemplateDoc>(docHash);
      const vHash = doc.bible?.versification;
      return { docHash, doc, versification: vHash ? await documentBody<VersificationDoc>(vHash) : null };
    },
    async libraryItem(itemId) {
      const [versions, items] = await Promise.all([
        db.from('library_versions').select('doc_hash, hlc').eq('org_id', LIBRARY_ORG).eq('item_id', itemId).order('hlc', { ascending: false }).limit(1),
        db.from('library_items').select('name').eq('org_id', LIBRARY_ORG).eq('item_id', itemId).limit(1)
      ]);
      if (versions.error) throw new Error(`library_versions: ${versions.error.message}`);
      if (items.error) throw new Error(`library_items: ${items.error.message}`);
      const docHash = versions.data?.[0]?.doc_hash as string | undefined;
      return docHash ? { name: String(items.data?.[0]?.name ?? itemId), docHash } : null;
    },
    grantLibrary: (orgId, docHash) => rpc('v2_import_library_grant', { p_org: orgId, p_hash: docHash }),

    async languoidCode(languoidId) {
      const { data, error } = await db.from('languoid_source').select('name, unique_identifier').eq('languoid_id', languoidId).in('name', ['iso639-3', 'glottolog']);
      if (error) throw new Error(`languoid_source: ${error.message}`);
      const rows = (data ?? []) as { name: string; unique_identifier: string }[];
      return rows.find((r) => r.name === 'iso639-3')?.unique_identifier ?? rows.find((r) => r.name === 'glottolog')?.unique_identifier ?? null;
    },

    async orgCreator(orgId) {
      const { data, error } = await db.from('events').select('id, actor_id').eq('org_id', orgId).eq('stream_id', '_org').eq('type', 'v1.OrgCreated').limit(5);
      if (error) throw new Error(`events: ${error.message}`);
      const foreign = (data ?? []).find((e) => !String(e.id).startsWith('v2:'));
      return foreign ? String(foreign.actor_id) : (data ?? []).length ? 'v2import' : null;
    },

    async addNames(people) {
      for (let i = 0; i < people.length; i += 500) {
        const { error } = await db.from('profiles').upsert(people.slice(i, i + 500).map((p) => ({ id: p.id, display_name: p.name.slice(0, 100) })), { onConflict: 'id', ignoreDuplicates: true });
        if (error) throw new Error(`profiles: ${error.message}`);
      }
    },

    passStart: (projectId, orgId, by) => rpc<number>('v2_import_pass_start', { p_project: projectId, p_org: orgId, p_by: by }).then(Number),
    passProgress: (passId, progress) => rpc('v2_import_pass_progress', { p_id: passId, p_progress: progress }),
    passFinish: (passId, report, error) => rpc('v2_import_pass_finish', { p_id: passId, p_report: report ?? null, p_error: error ?? null }),
    log: (lines) => (lines.length ? rpc('v2_import_log_add', { p_lines: lines }) : Promise.resolve()),
    status: (after) => rpc<Status>('v2_import_status', { p_after: after, p_limit: 300 }),
    signedIn: () => rpc<PersonHere[]>('v2_import_signed_in', { p_limit: 2000 }),
    projectLog: (projectId) => rpc<(LogLine & { id: number; at: string })[]>('v2_import_project_log', { p_project: projectId, p_limit: 200 }),
    async people(ids) {
      const out: PersonHere[] = [];
      for (let i = 0; i < ids.length; i += 1000) out.push(...(await rpc<PersonHere[]>('v2_import_people', { p_ids: ids.slice(i, i + 1000) })));
      return out;
    },
    async cursor(name, value) {
      const v = await rpc<string | null>('v2_import_cursor', { p_name: name, p_value: value?.toISOString() ?? null });
      return v ? new Date(v) : null;
    }
  };

  async function documentBody<T>(hash: string): Promise<T> {
    const { data, error } = await db.from('library_documents').select('body').eq('hash', hash).maybeSingle();
    if (error || !data) throw new Error(`library document ${hash}: ${error?.message ?? 'not found'}`);
    return JSON.parse(String(data.body)) as T;
  }
}
