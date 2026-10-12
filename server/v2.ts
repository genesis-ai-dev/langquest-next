/**
 * LangQuest v2 → this app, one way, and kept up to date (docs/v2-import.md).
 *
 *   npm run v2 -- board [--port 8079]          the grouping board, in your browser
 *   npm run v2 -- sync                         one pass: confirmed projects v2 changed since the last
 *   npm run v2 -- sync --all                   every confirmed project, read whole (the nightly pass)
 *   npm run v2 -- sync --project <v2 id> …     just these
 *   npm run v2 -- try --project <v2 id> …      map v2 projects and check the result, writing nothing
 *
 * Reads v2 with V2_SUPABASE_URL / V2_SUPABASE_ANON_KEY (v2's publishable
 * key; v2 is never written) and its public bucket V2_BUCKET ("assets").
 * Writes this app at SUPABASE_URL with SUPABASE_SERVICE_ROLE_KEY, local by
 * default (`node scripts/with-local-keys.mjs` supplies the keys), and files
 * through the app's Worker at API_URL (`npm run web:dev` locally).
 * V2_EVERY_LANGUAGE_ID names the Every Language platform account's v2 id
 * while the reader cannot see emails. Downloaded files are kept under
 * V2_IMPORT_CACHE. Output names projects by id only: the repository and
 * its CI logs are public.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { workerBlobs } from '@langquest-next/client';
import { createHash } from 'node:crypto';
import { foldLanguage, foldOrg, ORG_STREAM, subscriptionItemId, validateEvent } from '@langquest-next/core';
import { bucketName, boardData, mapProject, parseRecommendations, reconcile, restReader, supabaseTarget, sync, WAYS, LIBRARY_ORG, type CopiedFile, type SavedPlacement, type PlanOrg, type TemplateRef } from '@langquest-next/v2-import';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string) => args.includes(`--${name}`);
const values = (name: string) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] !== undefined ? [args[i + 1]!] : []));

const env = (name: string, fallback?: string): string => {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    console.error(`${name} is required (docs/v2-import.md)`);
    process.exit(1);
  }
  return v;
};

const v2 = restReader({
  url: env('V2_SUPABASE_URL', 'https://unsxkmlcyxgtgmtzfonb.supabase.co'),
  key: env('V2_SUPABASE_ANON_KEY'),
  bucket: env('V2_BUCKET', 'assets')
});
const url = env('SUPABASE_URL', 'http://127.0.0.1:54421');
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const target = supabaseTarget(db, workerBlobs(env('API_URL', 'http://127.0.0.1:8787'), serviceKey));
const cacheDir = process.env['V2_IMPORT_CACHE'] ?? join(tmpdir(), 'langquest-v2-import');
await mkdir(cacheDir, { recursive: true });
const cachePath = (name: string) => join(cacheDir, name.replace(/[^A-Za-z0-9._-]/g, '_'));
const cache = {
  get: (name: string) => readFile(cachePath(name)).then((b) => new Uint8Array(b), () => null),
  put: (name: string, bytes: Uint8Array) => writeFile(cachePath(name), bytes)
};
const deps = { v2, target, cache, log: (line: string) => console.log(line) };

if (command === 'sync') {
  const reports = await sync(deps, { all: flag('all'), projects: values('project') });
  const refused = reports.filter((r) => r.rejected?.length || r.skipped?.startsWith('failed'));
  for (const r of refused) console.log(`${r.projectId}: ${r.skipped ?? r.rejected!.slice(0, 5).map((x) => `${x.id} (${x.reason})`).join('; ')}`);
  if (refused.length) process.exitCode = 2;
} else if (command === 'try') {
  await tryProjects(values('project'));
} else if (command === 'board') {
  await board(Number(values("port")[0] ?? 8079));
} else {
  console.error('usage: npm run v2 -- board | sync [--all] [--project <v2 id> …] | try --project <v2 id> …');
  process.exit(2);
}

async function board(port: number) {
  const by = values('as')[0] ?? (spawnSync('git', ['config', 'user.name'], { encoding: 'utf8' }).stdout.trim() || 'unknown');
  const page = await readFile(join(root, 'server/v2-board.html'), 'utf8');
  const recommendations = parseRecommendations(await readFile(join(root, 'docs/v2-project-languages.csv'), 'utf8'));
  const everyLanguageIds = (process.env['V2_EVERY_LANGUAGE_ID'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  let v2Cache: Promise<[Awaited<ReturnType<typeof v2.projects>>, Awaited<ReturnType<typeof v2.memberships>>]> | null = null;

  const json = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const body = (req: import('node:http').IncomingMessage) => new Promise<unknown>((resolve, reject) => {
    let text = '';
    req.on('data', (c: Buffer) => { text += c.toString('utf8'); });
    req.on('end', () => { try { resolve(JSON.parse(text || '{}')); } catch (e) { reject(e); } });
  });

  createServer(async (req, res) => {
    try {
      const u = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      // Only this machine: the page shows private projects' names and who is in them.
      if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return json(res, 403, { error: 'local only' });
      if (req.method === 'GET' && u.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(page);
      }
      if (req.method === 'GET' && u.pathname === '/api/board') {
        if (u.searchParams.has('fresh') || !v2Cache) v2Cache = Promise.all([v2.projects(), v2.memberships()]);
        const [projects, memberships] = await v2Cache;
        const ids = [...new Set(memberships.map((m) => m.profile_id))];
        const data = boardData({ projects, memberships, people: await v2.people(ids), recommendations, plan: await target.plan(), everyLanguageIds });
        return json(res, 200, { ...data, by });
      }
      if (req.method === 'GET' && u.pathname === '/api/languoids') {
        const { data, error } = await db.rpc('search_languoids', { search_query: u.searchParams.get('q') ?? '', result_limit: 12, levels: ['language', 'dialect'] });
        if (error) return json(res, 500, { error: error.message });
        return json(res, 200, data);
      }
      if (req.method === 'POST' && u.pathname === '/api/plan') {
        const input = (await body(req)) as { orgs: PlanOrg[]; placements: SavedPlacement[] };
        // A confirmed language needs its readable code: the languoid's ISO code, else its glottocode.
        for (const p of input.placements) {
          if (p.languoid_id && !p.code) p.code = await target.languoidCode(p.languoid_id);
          if (p.confirmed && (!p.org_id || !p.code)) return json(res, 400, { error: `${p.project_id} needs an organization and a language before it is confirmed` });
        }
        await target.savePlan(input.orgs, input.placements, by);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && u.pathname === '/api/sync') {
        const { projectId } = (await body(req)) as { projectId: string };
        return json(res, 200, await sync(deps, { projects: [projectId] }));
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
  }).listen(port, '127.0.0.1', () => console.log(`The board is at http://127.0.0.1:${port} (saving as ${by})`));
}

/**
 * Map v2 projects as a pass would, without copying a file or writing
 * anything: each file stands in by a hash of its name. Checks that every
 * event is valid and folds, and prints what would come over.
 */
async function tryProjects(ids: string[]) {
  const templates: Record<'bible' | 'fia', TemplateRef | null> = { bible: null, fia: null };
  for (const kind of ['bible', 'fia'] as const) {
    const t = await target.template(WAYS[kind].sourceItemId);
    templates[kind] = t && { itemId: subscriptionItemId(LIBRARY_ORG.id, WAYS[kind].sourceItemId), docHash: t.docHash, doc: t.doc, versification: t.versification };
  }
  for (const id of ids) {
    const t0 = Date.now();
    const rows = await v2.projectRows(id);
    const files = new Map<string, CopiedFile>();
    for (const c of rows.contents) for (const raw of c.audio ?? []) {
      const name = bucketName(raw);
      if (name) files.set(name, { hash: createHash('sha256').update(name).digest('hex'), size: 0, durationMs: 1000, format: name.endsWith('.wav') ? 'wav' : 'm4a' });
    }
    const kind = rows.project.template === 'bible' || rows.project.template === 'fia' ? rows.project.template : null;
    const mapped = mapProject(rows, {
      orgId: 'org-try', language: { code: 'und', languoidId: null, sourceCode: 'eng', decidedAt: new Date().toISOString() },
      files, templates: kind && templates[kind] ? { [kind]: templates[kind]! } : {}, now: Date.now()
    });
    const r = reconcile(mapped.facts, new Map(), { orgId: 'org-try', scope: id, now: Date.now() });
    const invalid = r.events.flatMap((e) => { const why = validateEvent(e); return why ? [`${e.type}: ${why}`] : []; });
    const lang = foldLanguage(r.events.filter((e) => e.streamId === id));
    foldOrg(r.events.filter((e) => e.streamId === ORG_STREAM));
    const byType = new Map<string, number>();
    for (const e of r.events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
    console.log(`\n== ${id} (${rows.project.template ?? 'unstructured'}): ${rows.quests.length} quests, ${rows.assets.length} assets, ${rows.contents.length} segments, ${rows.votes.length} votes; read in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    console.log(`events: ${r.events.length} (${[...byType].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t.slice(3)} ${n}`).join(', ')})`);
    const { missingFiles, ...counts } = mapped.report;
    console.log(`report: ${JSON.stringify(counts)}, files never uploaded: ${missingFiles.length}`);
    console.log(`fold: ${Object.keys(lang.units).length} units, ${Object.keys(lang.takes).length} takes, ${Object.keys(lang.invalidEvents).length} invalid in the fold; ${invalid.length} invalid at the door${invalid.length ? `: ${invalid.slice(0, 5).join('; ')}` : ''}`);
  }
}
