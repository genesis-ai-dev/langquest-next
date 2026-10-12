import type { V2Asset, V2Content, V2LanguageLink, V2Membership, V2Placement, V2ProjectRow, V2ProjectRows, V2Quest, V2Vote } from './rows';

/**
 * Reading LangQuest v2, never writing it (docs/v2-import.md). The import
 * needs a project's rows, which projects changed, the projects and people
 * for the board, and the audio files. `restReader` reads through v2's
 * PostgREST with its publishable key: every table the import maps is
 * world-readable there, but `profile` is not, so it gives no names or
 * emails; a reader with more access answers `people`.
 */
export interface V2Reader {
  projectRows(projectId: string): Promise<V2ProjectRows>;
  /** Projects with a row inserted or changed after `since` (by v2's server clock where it has one). */
  changedSince(since: Date): Promise<Set<string>>;
  projects(): Promise<V2ProjectSummary[]>;
  memberships(): Promise<(Pick<V2Membership, 'profile_id' | 'membership' | 'active'> & { project_id: string })[]>;
  /** Names and emails, when this reader may see them; empty otherwise. */
  people(ids: string[]): Promise<{ id: string; name: string | null; email: string | null }[]>;
  /** A file from v2's bucket, or null when the bucket does not have it. */
  download(name: string): Promise<Uint8Array | null>;
}

export interface V2ProjectSummary extends Pick<V2ProjectRow, 'id' | 'name' | 'active' | 'private' | 'created_at' | 'creator_id' | 'template'> {
  assets: number;
  lastActivity: string | null;
}

export interface RestSource {
  url: string;
  /** v2's publishable (anon) key. */
  key: string;
  /** The public bucket v2 keeps audio in. */
  bucket: string;
  fetch?: typeof fetch;
}

const PAGE = 1000;

export function restReader(src: RestSource): V2Reader {
  const http = src.fetch ?? fetch;
  const get = async <T>(path: string, range?: [number, number]): Promise<T[]> => {
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await http(`${src.url}/rest/v1/${path}`, {
          headers: { apikey: src.key, authorization: `Bearer ${src.key}`, ...(range ? { Range: `${range[0]}-${range[1]}` } : {}) }
        });
        const body = (await res.json()) as T[] | { message?: string };
        if (!res.ok || !Array.isArray(body)) throw new Error(`v2 ${path.split('?')[0]}: ${(body as { message?: string }).message ?? res.status}`);
        return body;
      } catch (e) {
        if (attempt >= 4) throw e;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  };
  /** Every row, a page at a time by the table's key, so a long walk never slows down at a deep offset. */
  const byKey = async <T extends Record<string, unknown>>(path: string, key: string): Promise<T[]> => {
    const out: T[] = [];
    let after: string | null = null;
    for (;;) {
      const page: T[] = await get<T>(`${path}&order=${key}.asc&limit=${PAGE}${after ? `&${key}=gt.${encodeURIComponent(after)}` : ''}`);
      out.push(...page);
      if (page.length < PAGE) return out;
      after = String(page[page.length - 1]![key]);
    }
  };
  /** Tables without a single-column key, by offset. */
  const byOffset = async <T>(path: string): Promise<T[]> => {
    const out: T[] = [];
    for (let off = 0; ; off += PAGE) {
      const page = await get<T>(path, [off, off + PAGE - 1]);
      out.push(...page);
      if (page.length < PAGE) return out;
    }
  };

  return {
    async projectRows(projectId) {
      const p = encodeURIComponent(projectId);
      const [projects, languages, members, quests, placements, assets, contents, votes] = await Promise.all([
        get<V2ProjectRow>(`project?select=id,name,description,created_at,last_updated,active,private,creator_id,template&id=eq.${p}`),
        byOffset<V2LanguageLink>(`project_language_link?select=languoid_id,language_type,active&project_id=eq.${p}&order=languoid_id,language_type`),
        byOffset<V2Membership>(`profile_project_link?select=profile_id,membership,active,created_at,last_updated&project_id=eq.${p}&order=profile_id`),
        byKey<V2Quest & Record<string, unknown>>(`quest?select=id,name,parent_id,metadata,active,visible,duplicate_of,creator_id,created_at,last_updated&project_id=eq.${p}`, 'id'),
        byOffset<V2Placement & { quest: unknown }>(
          `quest_asset_link?select=quest_id,asset_id,active,visible,order_index,metadata,created_at,quest!inner(project_id)&quest.project_id=eq.${p}&order=quest_id,asset_id`
        ),
        byKey<V2Asset & Record<string, unknown>>(`asset?select=id,name,content_type,source_asset_id,creator_id,active,visible,order_index,metadata,created_at,last_updated&project_id=eq.${p}`, 'id'),
        byKey<V2Content & { asset: unknown } & Record<string, unknown>>(
          `asset_content_link?select=id,asset_id,text,audio,languoid_id,source_language_id,active,order_index,created_at,asset!inner(project_id)&asset.project_id=eq.${p}`, 'id'
        ),
        byKey<V2Vote & { asset: unknown } & Record<string, unknown>>(
          `vote?select=id,asset_id,polarity,comment,creator_id,active,created_at,last_updated,asset!inner(project_id)&asset.project_id=eq.${p}`, 'id'
        )
      ]);
      const project = projects[0];
      if (!project) throw new Error(`v2 project ${projectId} not found`);
      return {
        project,
        languages,
        members,
        quests,
        placements: placements.map(({ quest: _q, ...p }) => ({ ...p, order_index: p.order_index ?? 0 })),
        assets,
        contents: contents.map(({ asset: _a, ...c }) => ({ ...c, audio: Array.isArray(c.audio) ? c.audio : null, created_at: String(c.created_at) })),
        votes: votes.map(({ asset: _a, ...v }) => v)
      };
    },

    async changedSince(since) {
      const t = encodeURIComponent(since.toISOString());
      const both = `or=(last_updated.gt.${t},uploaded_at.gt.${t})`;
      const lists = await Promise.all([
        byOffset<{ id: string }>(`project?select=id&last_updated=gt.${t}&order=id`).then((r) => r.map((x) => x.id)),
        byOffset<{ project_id: string }>(`quest?select=project_id&${both}&order=id`).then((r) => r.map((x) => x.project_id)),
        byOffset<{ project_id: string }>(`asset?select=project_id&${both}&order=id`).then((r) => r.map((x) => x.project_id)),
        // The segment's own timestamps are text in production; the server stamps these two.
        byOffset<{ asset: { project_id: string } | null }>(`asset_content_link?select=asset(project_id)&or=(uploaded_at.gt.${t},audio_uploaded_at.gt.${t})&order=id`)
          .then((r) => r.flatMap((x) => (x.asset ? [x.asset.project_id] : []))),
        byOffset<{ quest: { project_id: string } | null }>(`quest_asset_link?select=quest(project_id)&${both}&order=quest_id,asset_id`)
          .then((r) => r.flatMap((x) => (x.quest ? [x.quest.project_id] : []))),
        byOffset<{ asset: { project_id: string } | null }>(`vote?select=asset(project_id)&${both}&order=id`).then((r) => r.flatMap((x) => (x.asset ? [x.asset.project_id] : []))),
        byOffset<{ project_id: string }>(`profile_project_link?select=project_id&last_updated=gt.${t}&order=project_id,profile_id`).then((r) => r.map((x) => x.project_id)),
        byOffset<{ project_id: string }>(`project_language_link?select=project_id&last_updated=gt.${t}&order=project_id,languoid_id`).then((r) => r.map((x) => x.project_id))
      ]);
      return new Set(lists.flat().filter(Boolean));
    },

    async projects() {
      const [rows, closures] = await Promise.all([
        byKey<V2ProjectRow & { last_updated: string } & Record<string, unknown>>('project?select=id,name,active,private,created_at,creator_id,template,last_updated', 'id'),
        byOffset<{ project_id: string; total_assets: number; last_updated: string }>('project_closure?select=project_id,total_assets,last_updated&order=project_id')
      ]);
      const closure = new Map(closures.map((c) => [c.project_id, c]));
      return rows.map((p) => ({
        id: p.id, name: p.name, active: p.active, private: p.private, created_at: p.created_at, creator_id: p.creator_id, template: p.template,
        assets: closure.get(p.id)?.total_assets ?? 0,
        lastActivity: [p.last_updated, closure.get(p.id)?.last_updated].filter((x): x is string => !!x).sort().at(-1) ?? null
      }));
    },

    memberships() {
      return byOffset('profile_project_link?select=profile_id,project_id,membership,active&order=project_id,profile_id');
    },

    async people() {
      return [];
    },

    async download(name) {
      const res = await http(`${src.url}/storage/v1/object/public/${src.bucket}/${name.split('/').map(encodeURIComponent).join('/')}`);
      if (res.status === 400 || res.status === 404) return null;
      if (!res.ok) throw new Error(`v2 file ${name}: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    }
  };
}
