/**
 * Import LangQuest v2 projects into the event log (PLAN.md build order 8).
 *
 *   npm run import:v2 -- --project <v2 project id> [--project ...] [--org langquest-v2]
 *       [--grant <email>=<role>] [--skip-audio] [--concurrency 8]
 *   npm run import:v2 -- --all [--follow [--interval 15]] ...
 *
 * --all imports every active v2 project. --follow then keeps running: every
 * --interval seconds it asks v2 which projects received rows since the last
 * poll (by v2's server-side upload stamps, so a phone that was offline for
 * weeks still counts as new) and re-imports just those. The poll cursor is
 * kept in V2_IMPORT_CACHE, so a restart resumes instead of sweeping again;
 * pass --all to force a full sweep.
 *
 * Reads v2 anonymously (its tables are world-readable) from V2_SUPABASE_URL /
 * V2_SUPABASE_ANON_KEY, copies audio from the public V2_BUCKET (default
 * "assets") into this app's "blobs" bucket by content hash, then appends the
 * mapped events with the service role. Re-running is a no-op: ids are
 * derived from v2 rows and the server reports them as duplicates.
 *
 * The target is SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, local by default;
 * point them at a hosted project to import there. Downloaded v2 audio is
 * cached under V2_IMPORT_CACHE, so importing the same projects into a second
 * target re-uploads from disk instead of pulling from v2 again.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { fold, type Role } from '@langquest-next/core';
import { appendAll, audioNames, changedV2Projects, copyBlobs, fetchV2ProjectIds, fetchV2Rows, mapOrgSeed, mapV2Project, SupabaseTransport, type SeededProject, type V2Cursor } from '@langquest-next/client';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const values = (name: string) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] !== undefined ? [args[i + 1]!] : []));
const value = (name: string, fallback: string) => values(name)[0] ?? fallback;

const follow = flag('follow');
const projects = values('project');
if (projects.length === 0 && !flag('all') && !follow) {
  console.error('--project <v2 project id>, --all, or --follow is required');
  process.exit(1);
}
const orgId = value('org', 'langquest-v2');
const v2 = {
  url: process.env['V2_SUPABASE_URL'] ?? 'https://unsxkmlcyxgtgmtzfonb.supabase.co',
  anonKey: process.env['V2_SUPABASE_ANON_KEY'] ?? '',
  bucket: process.env['V2_BUCKET'] ?? 'assets'
};
if (!v2.anonKey) {
  console.error('V2_SUPABASE_ANON_KEY is required');
  process.exit(1);
}
const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54321';
const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
if (!key) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required');
  process.exit(1);
}
const service = createClient(url, key, { auth: { persistSession: false } });
const cacheDir = process.env['V2_IMPORT_CACHE'] ?? join(tmpdir(), 'langquest-v2-import');
await mkdir(cacheDir, { recursive: true });

// --grant email=role: look the account up here so the mapper stays pure.
const grant: { profileId: string; role: Role }[] = [];
for (const g of values('grant')) {
  const [email, role] = g.split('=') as [string, Role | undefined];
  const { data, error } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === email);
  if (!user) throw new Error(`--grant: no local user with email ${email}`);
  grant.push({ profileId: user.id, role: role ?? 'owner' });
}

async function download(name: string): Promise<Uint8Array | null> {
  const cached = join(cacheDir, name.replace(/[^A-Za-z0-9._-]/g, '_'));
  try {
    return new Uint8Array(await readFile(cached));
  } catch {
    // not cached
  }
  const res = await fetch(`${v2.url}/storage/v1/object/public/${v2.bucket}/${name.split('/').map(encodeURIComponent).join('/')}`);
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  await writeFile(cached, bytes);
  return bytes;
}

/**
 * v2 also holds WAV and MP3 objects. This app's references are m4a, so
 * anything that is not already MP4 becomes AAC in an m4a container, once,
 * cached next to the download. Bit-exact flags keep the output, and so its
 * hash, the same on a re-run with the same ffmpeg.
 */
async function asM4a(name: string, bytes: Uint8Array): Promise<Uint8Array> {
  const isMp4 = bytes.length > 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70; // 'ftyp'
  if (isMp4) return bytes;
  const src = join(cacheDir, name.replace(/[^A-Za-z0-9._-]/g, '_'));
  const out = `${src}.m4a`;
  try {
    return new Uint8Array(await readFile(out));
  } catch {
    // not converted yet
  }
  await writeFile(src, bytes);
  await promisify(execFile)('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vn', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-c:a', 'aac', '-b:a', '96k', '-f', 'ipod', out]);
  return new Uint8Array(await readFile(out));
}

/** Duration from the MP4 movie header (mvhd): timescale and duration, version 0 or 1. */
function mp4DurationMs(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i + 24 <= bytes.length; i++) {
    if (bytes[i] !== 0x6d || bytes[i + 1] !== 0x76 || bytes[i + 2] !== 0x68 || bytes[i + 3] !== 0x64) continue; // 'mvhd'
    const version = bytes[i + 4];
    if (version === 0 && i + 24 <= bytes.length) {
      const timescale = view.getUint32(i + 16);
      const duration = view.getUint32(i + 20);
      return timescale ? Math.round((duration / timescale) * 1000) : 0;
    }
    if (version === 1 && i + 36 <= bytes.length) {
      const timescale = view.getUint32(i + 24);
      const duration = Number(view.getBigUint64(i + 28));
      return timescale ? Math.round((duration / timescale) * 1000) : 0;
    }
  }
  throw new Error('no mvhd box: not an MP4/M4A file');
}

const transport = new SupabaseTransport(service);
// Hashes the target log already confirms, per project, kept across polls so a
// follow cycle does not re-read a project's whole log to learn them again.
const storedByProject = new Map<string, Set<string>>();

// The org's admin must stay the same actor on every run: the server accepts
// the org's creation and its admin's membership only from the first actor.
// Once the org exists, whoever created it is the owner.
async function existingOrgOwner(): Promise<string | null> {
  const { data, error } = await service.from('events').select('actor_id').eq('org_id', orgId).eq('project_id', '_org').eq('type', 'v1.OrgCreated').limit(1);
  if (error) throw new Error(`reading org owner: ${error.message}`);
  return (data?.[0] as { actor_id: string } | undefined)?.actor_id ?? null;
}
let orgOwner = (await existingOrgOwner()) ?? grant.find((g) => g.role === 'owner')?.profileId ?? '';
let orgAt = new Date().toISOString();

async function importProject(projectId: string): Promise<SeededProject | null> {
  console.log(`\n== v2 project ${projectId}`);
  const rows = await fetchV2Rows(v2, projectId);
  console.log(`rows: ${rows.quests.length} quests, ${rows.assets.length} assets, ${rows.votes.length} votes, ${rows.members.length} member links`);

  // Blobs the log already confirms need no second upload.
  let alreadyStored = storedByProject.get(projectId);
  if (!alreadyStored) {
    alreadyStored = new Set<string>();
    for (let after = 0; ; ) {
      const page = await transport.pull(orgId, projectId, after, 1000);
      for (const e of page) if (e.type === 'v1.BlobStored') alreadyStored.add((e.payload as { hash: string }).hash);
      if (page.length < 1000) break;
      after = page[page.length - 1]!.serverSeq!;
    }
    storedByProject.set(projectId, alreadyStored);
  }

  const names = flag('skip-audio') ? [] : audioNames(rows);
  const t0 = Date.now();
  const { blobs, failed } = await copyBlobs(names, orgId, projectId, {
    download: async (name) => {
      const bytes = await download(name);
      return bytes && asM4a(name, bytes);
    },
    digest: async (b) => createHash('sha256').update(b).digest('hex'),
    durationMs: async (bytes) => mp4DurationMs(bytes),
    upload: async (o, p, hash, bytes) => {
      const { error } = await service.storage.from('blobs').upload(`${o}/${p}/${hash}.m4a`, bytes, { contentType: 'audio/mp4', upsert: false });
      if (error && !/already exists|duplicate/i.test(error.message)) throw new Error(error.message);
    },
    alreadyStored,
    onProgress: (done, total) => {
      if (done % 100 === 0 || done === total) process.stdout.write(`  audio ${done}/${total}\r`);
    }
  }, Number(value('concurrency', '8')));
  for (const b of blobs.values()) alreadyStored.add(b.hash);
  if (names.length) console.log(`audio: ${blobs.size} copied, ${failed.length} failed, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  for (const f of failed.slice(0, 10)) console.log(`  failed ${f.name}: ${f.reason}`);

  const { events, report, owner, roles } = mapV2Project(rows, { orgId, blobs, grant });
  // Whoever you granted ownership to is the org's admin: that is the account
  // that will actually drive it. Otherwise fall back to v2's project owner.
  if (!orgOwner) {
    orgOwner = owner;
    orgAt = rows.project.created_at;
  }
  const folded = fold(events);
  const invalid = Object.keys(folded.invalidEvents).length;
  console.log(`events: ${report.events} (${report.books} books, ${report.passages} passages, ${report.references} references, ${report.takes} takes, ${report.reviews} reviews, ${report.members} members)`);
  console.log(`left out: ${report.unlinkedAssets} assets without a quest, ${report.textOnlyTranslations} text-only translations, ${report.missingAudio.length} audio files not copied, ${invalid} invalid`);
  if (invalid) {
    console.log('  mapper produced events the reducer rejects; not appending');
    process.exitCode = 2;
    return null;
  }

  const result = await appendAll(service, events);
  console.log(`append: ${result.accepted} accepted, ${result.duplicates} duplicates, ${result.rejected.length} rejected`);
  for (const r of result.rejected.slice(0, 20)) console.log(`  rejected ${r.id}: ${r.reason}`);
  if (result.rejected.length) process.exitCode = 2;
  return { projectId, name: rows.project.name, roles };
}

// The org partition last: it names every project just imported. v2 has no
// organization of its own, so without this an imported org has no roles and
// no org memberships, and every org-level screen has nothing to show.
async function seedOrg(seeded: SeededProject[]) {
  if (seeded.length === 0 || !orgOwner) return;
  const seed = mapOrgSeed(orgId, `Imported from LangQuest v2`, orgOwner, seeded, orgAt);
  const r = await appendAll(service, seed);
  console.log(`org partition ${orgId}: ${r.accepted} accepted, ${r.duplicates} duplicates, ${r.rejected.length} rejected`);
  for (const x of r.rejected.slice(0, 10)) console.log(`  rejected ${x.id}: ${x.reason}`);
  if (r.rejected.length) process.exitCode = 2;
}

/** Import each project; a project that throws (v2 or network down) is returned for a retry. */
async function importMany(ids: Iterable<string>): Promise<string[]> {
  const seeded: SeededProject[] = [];
  const retry: string[] = [];
  for (const id of ids) {
    try {
      const s = await importProject(id);
      if (s) seeded.push(s);
    } catch (err) {
      console.log(`  project ${id} failed: ${(err as Error).message}`);
      retry.push(id);
    }
  }
  await seedOrg(seeded);
  return retry;
}

const cursorFile = join(cacheDir, `cursor-${orgId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
async function loadCursor(): Promise<V2Cursor | null> {
  try {
    return JSON.parse(await readFile(cursorFile, 'utf8')) as V2Cursor;
  } catch {
    return null;
  }
}

const resumed = follow ? await loadCursor() : null;
// Start the cursor before a sweep, not after: anything v2 receives while
// the sweep runs is then picked up by the first poll.
let cursor: V2Cursor = resumed ?? { watermark: new Date(Date.now() - 5 * 60_000).toISOString(), seen: {} };
const sweep = flag('all') || (follow && !resumed) ? await fetchV2ProjectIds(v2) : projects;
if (sweep.length) {
  console.log(`importing ${sweep.length} v2 project(s) into org ${orgId}`);
  const retry = await importMany(sweep);
  if (retry.length) {
    console.log(`${retry.length} project(s) failed: ${retry.join(', ')}`);
    process.exitCode = 2;
  }
}

if (follow) {
  const intervalMs = Number(value('interval', '15')) * 1000;
  let pending = new Set<string>();
  console.log(`\nfollowing v2 every ${intervalMs / 1000} s from ${cursor.watermark}`);
  for (;;) {
    try {
      const next = await changedV2Projects(v2, cursor);
      for (const p of next.projects) pending.add(p);
      if (pending.size) {
        console.log(`\n[${new Date().toISOString()}] v2 changed in ${pending.size} project(s)`);
        pending = new Set(await importMany(pending));
      }
      // Advance only once the changes it found are imported or queued for retry.
      cursor = next.cursor;
      await writeFile(cursorFile, JSON.stringify(cursor));
    } catch (err) {
      console.log(`[${new Date().toISOString()}] poll failed, retrying: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
