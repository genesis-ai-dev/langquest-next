/**
 * LangQuest v2 → this app, one way, and kept up to date (docs/v2-import.md).
 *
 *   npm run v2 -- board [--port 8079]          the grouping board, in your browser
 *   npm run v2 -- sync                         one pass: confirmed projects v2 changed since the last
 *   npm run v2 -- sync --all                   every confirmed project, read whole (the nightly pass)
 *   npm run v2 -- sync --project <v2 id> …     just these
 *   npm run v2 -- try --project <v2 id> …      map v2 projects and check the result, writing nothing
 *   … --production                              against the hosted projects (docs/v2-import.md, "Going live")
 *
 * Reads v2 with V2_SUPABASE_URL / V2_SUPABASE_ANON_KEY (v2's publishable
 * key; v2 is never written) and its public bucket V2_BUCKET ("assets").
 * Writes this app at SUPABASE_URL with SUPABASE_SERVICE_ROLE_KEY, local by
 * default (`node scripts/with-local-keys.mjs` supplies the keys), and files
 * through the app's Worker at API_URL (`npm run web:dev` locally), or into
 * the folder V2_IMPORT_FILES_DIR when trying it without the Worker.
 * V2_DATABASE_URL, a read-only login on v2 (scripts/v2-access.sh), gives
 * people's usernames and emails; without it, the dashboard reads them with
 * the Supabase CLI you are logged in with, when it may read v2 (never on
 * CI). V2_EVERY_LANGUAGE_ID overrides the Every Language
 * platform account's v2 id. Downloaded files are kept under
 * V2_IMPORT_CACHE when it is set. On CI, output names projects by id only:
 * the repository and its CI logs are public.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { workerBlobs } from '@langquest-next/client';
import { createHash } from 'node:crypto';
import { foldLanguage, foldOrg, ORG_STREAM, subscriptionItemId, validateEvent } from '@langquest-next/core';
import { bucketName, boardData, mapProject, parseRecommendations, reconcile, restReader, supabaseTarget, sync, WAYS, LIBRARY_ORG, type ChosenRole, type CopiedFile, type SavedPlacement, type PlanOrg, type TemplateRef } from '@langquest-next/v2-import';

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

// --production reads and writes the hosted projects with the keys the team already keeps: v2's
// key and read-only login from .env.production (dotenvx; needs .env.keys), and this app's
// service-role key from the Supabase CLI you are logged in with. Nothing is printed.
const PRODUCTION_REF = 'xymxnebdwtbkfxlbylch';
if (flag('production') && !process.env['V2_HOSTED_RUN']) {
  const keys = spawnSync('npx', ['supabase', 'projects', 'api-keys', '--project-ref', PRODUCTION_REF, '-o', 'json'], { cwd: root, encoding: 'utf8' });
  const list = keys.status === 0 ? (JSON.parse(keys.stdout.slice(keys.stdout.indexOf('['))) as { name: string; api_key: string }[]) : [];
  const service = list.find((k) => k.name === 'service_role')?.api_key;
  if (!service) {
    console.error('x could not read the production service key with the Supabase CLI; run npx supabase login first');
    process.exit(1);
  }
  const r = spawnSync('npx', ['dotenvx', 'run', '-f', '.env.production', '-fk', '.env.keys', '--strict', '--', 'npx', 'tsx', ...process.argv.slice(1)], {
    cwd: root, stdio: 'inherit',
    env: { ...process.env, V2_HOSTED_RUN: '1', SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: service, API_URL: 'https://next.langquest.org' }
  });
  process.exit(r.status ?? 1);
}

// Usernames and emails are in v2's profile table, which v2's publishable key cannot read: they
// come through a read-only login (scripts/v2-access.sh), or else, on the dashboard, through the
// Supabase CLI you are logged in with. Each is read once; the page only ever shows them on this machine.
const v2Db = process.env['V2_DATABASE_URL'];
const V2_REF = 'unsxkmlcyxgtgmtzfonb';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type V2Person = { id: string; name: string | null; email: string | null };
const PEOPLE_SQL = "select coalesce(json_agg(json_build_object('id', id, 'name', username, 'email', email)), '[]') as people from public.profile where id = any";
const seen = new Map<string, V2Person>();
let cliDir: string | null = null;
let cliFailedAt = 0;
// One lookup at a time: two pages asking at once would read everyone twice.
let peopleQueue: Promise<unknown> = Promise.resolve();
function v2People(ids: string[]): Promise<V2Person[]> {
  const next = peopleQueue.then(() => readPeople(ids));
  peopleQueue = next.catch(() => {});
  return next;
}
async function readPeople(ids: string[]): Promise<V2Person[]> {
  const todo = [...new Set(ids)].filter((id) => UUID.test(id) && !seen.has(id));
  for (let i = 0; i < todo.length; i += 500) {
    const batch = todo.slice(i, i + 500);
    let rows: { id: string; name: string | null; email: string | null }[];
    if (v2Db) {
      const r = spawnSync('psql', [v2Db, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-v', `ids={${batch.join(',')}}`], {
        input: `${PEOPLE_SQL}(:'ids'::uuid[]);\n`, encoding: 'utf8'
      });
      if (r.error || r.status !== 0) throw new Error(`v2 people: ${(r.stderr || r.error?.message || '').trim()}`);
      rows = JSON.parse(r.stdout.trim() || '[]');
    } else {
      // After a failure, try again in five minutes rather than on every refresh.
      if (Date.now() - cliFailedAt < 5 * 60_000) break;
      // Read-only, through Supabase's API as you; from an empty folder, so this checkout's link is not used.
      cliDir ??= await mkdtemp(join(tmpdir(), 'v2-people-'));
      const r = spawnSync(join(root, 'node_modules/.bin/supabase'), ['db', 'query', '--linked', '--project-ref', V2_REF, '--output-format', 'json',
        `${PEOPLE_SQL}(array[${batch.map((id) => `'${id}'`).join(',')}]::uuid[])`], { cwd: cliDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      // The rows come bare, or wrapped as { rows } when the CLI thinks an agent is reading; an update notice may follow.
      let list: { people: typeof rows }[] | null = null;
      try {
        if (r.status === 0) {
          const text = r.stdout;
          const parsed = JSON.parse(text.slice(text.search(/[[{]/), Math.max(text.lastIndexOf(']'), text.lastIndexOf('}')) + 1)) as unknown;
          list = Array.isArray(parsed) ? parsed : ((parsed as { rows?: { people: typeof rows }[] }).rows ?? null);
        }
      } catch { list = null; }
      if (!list) {
        cliFailedAt = Date.now();
        const why = (r.error?.message ?? r.stderr ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !/^(Initialising|A new version|We recommend)/.test(l))[0] ?? `exit ${r.status}`;
        console.error(`v2 usernames and emails are not shown for now (${why}): log in with npx supabase login, or set V2_DATABASE_URL`);
        break;
      }
      rows = list[0]?.people ?? [];
    }
    for (const id of batch) seen.set(id, { id, name: null, email: null });
    for (const p of rows) seen.set(p.id, { id: p.id, name: p.name?.trim() || null, email: p.email?.trim() || null });
  }
  return ids.flatMap((id) => (seen.has(id) ? [seen.get(id)!] : []));
}

const v2 = restReader({
  url: env('V2_SUPABASE_URL', 'https://unsxkmlcyxgtgmtzfonb.supabase.co'),
  key: env('V2_SUPABASE_ANON_KEY'),
  bucket: env('V2_BUCKET', 'assets'),
  ...(v2Db || (command === 'board' && !process.env['CI']) ? { people: v2People } : {})
});
const url = env('SUPABASE_URL', 'http://127.0.0.1:54421');
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
const db = createClient(url, serviceKey, { auth: { persistSession: false } });
// V2_IMPORT_FILES_DIR keeps files in a folder instead of R2: for trying the import against a
// local database without the app's Worker (no BlobStored events are appended that way).
const filesDir = process.env['V2_IMPORT_FILES_DIR'];
const folderFiles = (dir: string) => ({
  async list(prefix: string) {
    const out: { key: string; size: number }[] = [];
    const d = join(dir, prefix);
    for (const name of await readdir(d).catch(() => [] as string[])) out.push({ key: `${prefix}${name}`, size: 0 });
    return out;
  },
  async put(key: string, bytes: Uint8Array) {
    await mkdir(join(dir, key, '..'), { recursive: true });
    await writeFile(join(dir, key), bytes);
  }
});
const target = supabaseTarget(db, filesDir ? folderFiles(filesDir) : workerBlobs(env('API_URL', 'http://127.0.0.1:8787'), serviceKey));
// Keeping downloads only pays for cloned projects, which share files, and v2's audio is about
// 230 GB (docs/v2-import.md), so files are kept only when V2_IMPORT_CACHE names a folder for them.
const cacheDir = process.env['V2_IMPORT_CACHE'];
if (cacheDir) await mkdir(cacheDir, { recursive: true });
const cachePath = (name: string) => join(cacheDir!, name.replace(/[^A-Za-z0-9._-]/g, '_'));
const cache = cacheDir ? {
  get: (name: string) => readFile(cachePath(name)).then((b) => new Uint8Array(b), () => null),
  put: (name: string, bytes: Uint8Array) => writeFile(cachePath(name), bytes)
} : undefined;
// On CI, whose logs are public, a line says only which project and how it went; the dashboard has the words.
const print = (projectId: string, level: string, message: string) => console.log(process.env['CI'] ? `${projectId || 'pass'} ${level}` : `${projectId ? `${projectId}: ` : ''}${message}`);
const whoAmI = () => spawnSync('git', ['config', 'user.name'], { encoding: 'utf8' }).stdout.trim();
const deps = { v2, target, ...(cache ? { cache } : {}), print, by: process.env['V2_IMPORT_BY'] ?? (whoAmI() || 'the command line') };

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
  const by = values('as')[0] ?? (whoAmI() || 'unknown');
  const recommendations = parseRecommendations(await readFile(join(root, 'docs/v2-project-languages.csv'), 'utf8'));
  const everyLanguageIds = (process.env['V2_EVERY_LANGUAGE_ID'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const host = new URL(url).hostname;
  const where = host === '127.0.0.1' || host === 'localhost' ? 'local' : host.startsWith('xymxnebdwtbkfxlbylch.') ? 'production' : 'hosted';

  // v2's projects and memberships change slowly and take a while to count: read once, again on request.
  type V2Data = [Awaited<ReturnType<typeof v2.projects>>, Awaited<ReturnType<typeof v2.memberships>>];
  let v2Data: Promise<V2Data> | null = null;
  const readV2 = (fresh = false) => {
    if (fresh || !v2Data) {
      v2Data = Promise.all([v2.projects({ counts: true }), v2.memberships()]);
      v2Data.catch(() => { v2Data = null; });
    }
    return v2Data;
  };
  // Who is in which v2 project, without counting every project's recordings: what the Same email list needs.
  let v2Members: Promise<V2Data[1]> | null = null;
  const readMembers = (fresh = false) => {
    if (fresh || !v2Members) {
      v2Members = v2Data ? v2Data.then(([, m]) => m, () => v2.memberships()) : v2.memberships();
      v2Members.catch(() => { v2Members = null; });
    }
    return v2Members;
  };

  // Transfers started here run one at a time, in the order they were asked for.
  const queue: string[] = [];
  let running: string | null = null;
  const drain = async () => {
    if (running) return;
    while (queue.length) {
      running = queue.shift()!;
      try {
        const [projects] = await readV2();
        await sync({ ...deps, by }, { projects: [running], summaries: projects });
      } catch (e) {
        console.error(`${running}: ${(e as Error).message}`);
      }
      running = null;
    }
  };

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
        return res.end(await readFile(join(root, 'server/v2-board.html'), 'utf8'));
      }
      if (req.method === 'GET' && u.pathname === '/api/board') {
        const [projects, memberships] = await readV2(u.searchParams.has('fresh'));
        const ids = [...new Set(memberships.map((m) => m.profile_id))];
        const [names, here, plan] = await Promise.all([v2.people(ids), target.people(ids), target.plan()]);
        const known = new Map(here.map((p) => [p.id, p]));
        // Names this app knows (people who signed in, or the import named) stand in for v2's when it hides them.
        const people = ids.map((id) => ({ id, name: names.find((n) => n.id === id)?.name ?? known.get(id)?.display_name ?? null, email: names.find((n) => n.id === id)?.email ?? null }));
        const data = boardData({ projects, memberships, people, recommendations, plan, ...(everyLanguageIds.length ? { everyLanguageIds } : {}) });
        const members: Record<string, { id: string; owner: boolean }[]> = {};
        for (const m of memberships) if (m.active) (members[m.project_id] ??= []).push({ id: m.profile_id, owner: m.membership === 'owner' });
        const signedIn: Record<string, string> = {};
        for (const p of here) if (p.signed_in_at) signedIn[p.id] = p.signed_in_at;
        const nameOf: Record<string, string> = {};
        for (const p of people) if (p.name) nameOf[p.id] = p.name;
        const emailOf: Record<string, string> = {};
        for (const p of people) if (p.email) emailOf[p.id] = p.email;
        const roles: Record<string, Record<string, string>> = {};
        for (const r of plan.roles ?? []) (roles[r.project_id] ??= {})[r.profile_id] = r.role;
        return json(res, 200, { ...data, by, where, host, members, signedIn, nameOf, emailOf, roles });
      }
      if (req.method === 'GET' && u.pathname === '/api/status') {
        const status = await target.status(Number(u.searchParams.get('after') ?? 0));
        return json(res, 200, { ...status, queue: [...(running ? [running] : []), ...queue] });
      }
      if (req.method === 'GET' && u.pathname === '/api/people') {
        return json(res, 200, await target.signedIn());
      }
      if (req.method === 'GET' && u.pathname.startsWith('/api/project/')) {
        const id = decodeURIComponent(u.pathname.slice('/api/project/'.length));
        const [log, languages] = await Promise.all([target.projectLog(id), v2.projectLanguages(id).catch(() => [])]);
        return json(res, 200, { log, languages });
      }
      if (req.method === 'GET' && u.pathname === '/api/languoids') {
        // The language list, as New language searches it, with where each is spoken to tell same-named ones apart.
        const { data, error } = await db.rpc('search_languoids', { search_query: u.searchParams.get('q') ?? '', result_limit: 15, levels: ['language', 'dialect'] });
        if (error) return json(res, 500, { error: error.message });
        const found = (data ?? []) as { id: string }[];
        const places = new Map<string, string[]>();
        if (found.length) {
          const { data: links } = await db.from('languoid_region').select('languoid_id, region:region_id(name, level)').in('languoid_id', found.map((l) => l.id)).eq('active', true);
          for (const l of (links ?? []) as unknown as { languoid_id: string; region: { name: string | null; level: string } | null }[]) {
            if (l.region?.level === 'nation' && l.region.name) (places.get(l.languoid_id) ?? places.set(l.languoid_id, []).get(l.languoid_id)!).push(l.region.name);
          }
        }
        return json(res, 200, found.map((l) => ({ ...l, countries: (places.get(l.id) ?? []).sort() })));
      }
      if (req.method === 'POST' && u.pathname === '/api/role') {
        const { projectId, profileId, role } = (await body(req)) as { projectId: string; profileId: string; role: ChosenRole | null };
        if (role !== null && !['org_admin', 'coordinator', 'translator', 'reviewer', 'viewer', 'none'].includes(role)) return json(res, 400, { error: 'Unknown role.' });
        await target.setRole(projectId, profileId, role, by);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && u.pathname === '/api/plan') {
        const input = (await body(req)) as { orgs: PlanOrg[]; placements: SavedPlacement[] };
        // A linked language's readable code is the languoid's ISO code, else its glottocode. One not linked yet
        // comes over by its name, and its admins link it in Next (Caleb, 2026-10-13).
        for (const p of input.placements) {
          if (p.languoid_id && !p.code) p.code = await target.languoidCode(p.languoid_id);
          if (p.confirmed && !p.org_id) return json(res, 400, { error: 'Choose an organization first.' });
        }
        await target.savePlan(input.orgs, input.placements, by);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && u.pathname === '/api/same-email') {
        // v2 people whose email already has an account in Next under another id, and the links confirmed so far.
        // Next does not confirm emails, so a match is only a question for the team (Caleb, 2026-10-14).
        const memberships = await readMembers(u.searchParams.has('fresh'));
        const ids = [...new Set(memberships.map((m) => m.profile_id))];
        const [people, plan] = await Promise.all([v2.people(ids), target.plan()]);
        const emails = [...new Set(people.flatMap((p) => (p.email ? [p.email.trim().toLowerCase()] : [])))];
        const accounts = await target.nextAccounts(emails);
        const byEmail = new Map<string, typeof accounts>();
        for (const a of accounts) byEmail.set(a.email, [...(byEmail.get(a.email) ?? []), a]);
        const links = new Map((plan.links ?? []).filter((l) => l.active !== false).map((l) => [l.v2_id, l]));
        const projectsOf = (id: string) => [...new Set(memberships.filter((m) => m.profile_id === id && m.active).map((m) => m.project_id))];
        const rows = people.flatMap((p) => {
          const email = p.email?.trim().toLowerCase();
          const others = (email ? byEmail.get(email) ?? [] : []).filter((a) => a.id !== p.id);
          const link = links.get(p.id);
          if (!others.length && !link) return [];
          return [{ v2Id: p.id, v2Name: p.name, email: email ?? link?.email ?? null, next: others, link: link ?? null, projects: projectsOf(p.id) }];
        });
        return json(res, 200, { rows });
      }
      if (req.method === 'POST' && (u.pathname === '/api/link' || u.pathname === '/api/unlink')) {
        const { v2Id, nextId, email } = (await body(req)) as { v2Id: string; nextId?: string; email?: string };
        if (!v2Id || (u.pathname === '/api/link' && !nextId)) return json(res, 400, { error: 'Say which person and which account.' });
        if (u.pathname === '/api/link') await target.link(v2Id, nextId!, email ?? null, by);
        else await target.unlink(v2Id, by);
        // Their projects that have come over pick it up now: a sync each.
        const memberships = await readMembers();
        const plan = await target.plan();
        const confirmed = new Set(plan.placements.filter((p) => p.confirmed_at && p.org_id).map((p) => p.project_id));
        const theirs = [...new Set(memberships.filter((m) => m.profile_id === v2Id).map((m) => m.project_id))].filter((id) => confirmed.has(id));
        const added = theirs.filter((id) => id !== running && !queue.includes(id));
        queue.push(...added);
        void drain();
        return json(res, 200, { queued: added });
      }
      if (req.method === 'POST' && u.pathname === '/api/transfer') {
        const { projectIds } = (await body(req)) as { projectIds: string[] };
        const plan = await target.plan();
        const ready = new Set(plan.placements.filter((p) => p.confirmed_at && p.org_id).map((p) => p.project_id));
        const added = projectIds.filter((id) => ready.has(id) && id !== running && !queue.includes(id));
        queue.push(...added);
        void drain();
        return json(res, 200, { queued: added });
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: (e as Error).message });
    }
  }).listen(port, '127.0.0.1', () => console.log(`The dashboard is at http://127.0.0.1:${port} (${where} database, acting as ${by})`));
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
