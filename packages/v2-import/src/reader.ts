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
  /** Every project; with `counts`, each one's asset count and newest asset too (a request per project). */
  projects(opts?: { counts?: boolean }): Promise<V2ProjectSummary[]>;
  memberships(): Promise<(Pick<V2Membership, 'profile_id' | 'membership' | 'active'> & { project_id: string })[]>;
  /** Names and emails, when this reader may see them; empty otherwise. */
  people(ids: string[]): Promise<{ id: string; name: string | null; email: string | null }[]>;
  /** A file from v2's bucket, or null when the bucket does not have it. */
  download(name: string): Promise<Uint8Array | null>;
  /** The languages v2 links to a project, by name: what its team picked, right or wrong. */
  projectLanguages(projectId: string): Promise<{ type: 'source' | 'target'; name: string; active: boolean }[]>;
}

export interface V2ProjectSummary extends Pick<V2ProjectRow, 'id' | 'name' | 'active' | 'private' | 'created_at' | 'creator_id' | 'template'> {
  description?: string | null;
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
  /** Names, from a reader that may see them (v2's publishable key may not): a read-only login on v2. */
  people?: V2Reader['people'];
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

  /** Rows for many ids, a slice of ids per request, a few requests at a time. */
  const bySlices = async <T>(ids: string[], size: number, read: (ids: string) => Promise<T[]>): Promise<T[]> => {
    const slices: string[][] = [];
    for (let i = 0; i < ids.length; i += size) slices.push(ids.slice(i, i + size));
    const out: T[][] = new Array(slices.length);
    await pool(slices.map((ids, i) => ({ ids, i })), 6, async ({ ids, i }) => { out[i] = await read(ids.map(encodeURIComponent).join(',')); });
    return out.flat();
  };

  return {
    async projectRows(projectId) {
      const p = encodeURIComponent(projectId);
      const [projects, languages, members, quests, assets] = await Promise.all([
        get<V2ProjectRow>(`project?select=id,name,description,created_at,last_updated,active,private,creator_id,template&id=eq.${p}`),
        byOffset<V2LanguageLink>(`project_language_link?select=languoid_id,language_type,active&project_id=eq.${p}&order=languoid_id,language_type`),
        byOffset<V2Membership>(`profile_project_link?select=profile_id,membership,active,created_at,last_updated&project_id=eq.${p}&order=profile_id`),
        byKey<V2Quest & Record<string, unknown>>(`quest?select=id,name,parent_id,metadata,active,visible,duplicate_of,creator_id,created_at,last_updated&project_id=eq.${p}`, 'id'),
        byKey<V2Asset & Record<string, unknown>>(`asset?select=id,name,content_type,source_asset_id,creator_id,active,visible,order_index,metadata,created_at,last_updated&project_id=eq.${p}`, 'id')
      ]);
      const project = projects[0];
      if (!project) throw new Error(`v2 project ${projectId} not found`);
      // The link tables have no project column, and joining through one makes
      // v2 scan them whole (its statement timeout stops that): ask by the
      // project's own quest and asset ids instead, a slice at a time.
      const [placements, contents, votes] = await Promise.all([
        bySlices<V2Placement>(quests.map((q) => q.id), 100, (ids) => byOffset(`quest_asset_link?select=quest_id,asset_id,active,visible,order_index,metadata,created_at&quest_id=in.(${ids})&order=quest_id,asset_id`)),
        bySlices<V2Content>(assets.map((a) => a.id), 150, (ids) => byOffset(`asset_content_link?select=id,asset_id,text,audio,languoid_id,source_language_id,active,order_index,created_at,uploaded_at,audio_uploaded_at&asset_id=in.(${ids})&order=id`)),
        bySlices<V2Vote>(assets.map((a) => a.id), 150, (ids) => byOffset(`vote?select=id,asset_id,polarity,comment,creator_id,active,created_at,last_updated&asset_id=in.(${ids})&order=id`))
      ]);
      return {
        project,
        languages,
        members,
        quests,
        placements: placements.map((x) => ({ ...x, order_index: x.order_index ?? 0 })),
        assets,
        contents: contents.map((c) => ({ ...c, audio: Array.isArray(c.audio) ? c.audio : null, created_at: String(c.created_at) })),
        votes
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

    async projects(opts = {}) {
      const rows = await byKey<V2ProjectRow & { last_updated: string } & Record<string, unknown>>('project?select=id,name,description,active,private,created_at,creator_id,template,last_updated', 'id');
      if (!opts.counts) {
        return rows.map((p) => ({ id: p.id, name: p.name, description: p.description, active: p.active, private: p.private, created_at: p.created_at, creator_id: p.creator_id, template: p.template, assets: 0, lastActivity: p.last_updated }));
      }
      // v2's own rollups (project_closure) stopped being kept up to date, so count
      // each project's assets, and find its newest, in one small request each.
      const counted = new Map<string, { assets: number; newest: string | null }>();
      await pool(rows, 8, async (p) => {
        const res = await http(`${src.url}/rest/v1/asset?select=created_at&project_id=eq.${encodeURIComponent(p.id)}&order=created_at.desc&limit=1`, {
          headers: { apikey: src.key, authorization: `Bearer ${src.key}`, Prefer: 'count=exact' }
        });
        const body = (await res.json()) as { created_at: string }[] | { message?: string };
        if (!res.ok || !Array.isArray(body)) throw new Error(`v2 asset count: ${(body as { message?: string }).message ?? res.status}`);
        counted.set(p.id, { assets: Number(res.headers.get('content-range')?.split('/')[1] ?? 0), newest: body[0]?.created_at ?? null });
      });
      return rows.map((p) => ({
        id: p.id, name: p.name, description: p.description, active: p.active, private: p.private, created_at: p.created_at, creator_id: p.creator_id, template: p.template,
        assets: counted.get(p.id)?.assets ?? 0,
        lastActivity: [p.last_updated, counted.get(p.id)?.newest].filter((x): x is string => !!x).sort().at(-1) ?? null
      }));
    },

    memberships() {
      return byOffset('profile_project_link?select=profile_id,project_id,membership,active&order=project_id,profile_id');
    },

    async people(ids) {
      return src.people ? src.people(ids) : [];
    },

    async projectLanguages(projectId) {
      const rows = await get<{ language_type: 'source' | 'target'; active: boolean; languoid: { name: string | null } | null }>(
        `project_language_link?select=language_type,active,languoid:languoid_id(name)&project_id=eq.${encodeURIComponent(projectId)}`
      );
      return rows.map((r) => ({ type: r.language_type, name: r.languoid?.name ?? 'unknown', active: r.active }));
    },

    async download(name) {
      const res = await http(`${src.url}/storage/v1/object/public/${src.bucket}/${name.split('/').map(encodeURIComponent).join('/')}`);
      if (res.status === 400 || res.status === 404) return null;
      if (!res.ok) throw new Error(`v2 file ${name}: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    }
  };
}

async function pool<T>(items: readonly T[], size: number, work: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) await work(items[i]!);
  }));
}
