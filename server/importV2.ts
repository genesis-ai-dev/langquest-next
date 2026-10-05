/**
 * Import LangQuest v2 projects into the event log (PLAN.md build order 8).
 *
 *   npm run import:v2 -- --project <v2 project id> [--project ...] [--org langquest-v2]
 *       [--grant <email>=<role>] [--skip-audio] [--concurrency 8]
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
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { fold, type Role } from '@langquest-next/core';
import { appendAll, audioNames, copyBlobs, fetchV2Rows, mapOrgSeed, mapV2Project, SupabaseTransport, type SeededProject } from '@langquest-next/client';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const values = (name: string) => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] !== undefined ? [args[i + 1]!] : []));
const value = (name: string, fallback: string) => values(name)[0] ?? fallback;

const projects = values('project');
if (projects.length === 0) {
  console.error('at least one --project <v2 project id> is required');
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
const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
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
const seeded: SeededProject[] = [];
let orgOwner = '';
let orgAt = new Date().toISOString();

for (const projectId of projects) {
  console.log(`\n== v2 project ${projectId}`);
  const rows = await fetchV2Rows(v2, projectId);
  console.log(`rows: ${rows.quests.length} quests, ${rows.assets.length} assets, ${rows.votes.length} votes, ${rows.members.length} member links`);

  // Languages v2 users made are not in the language list (docs/languoids.md);
  // a project that uses one is imported as it is and listed here to sort out.
  const languoidIds = [...new Set(rows.languages.filter((l) => l.active && l.languoid_id).map((l) => l.languoid_id!))];
  if (languoidIds.length) {
    const { data, error } = await service.from('languoid').select('id').in('id', languoidIds);
    if (error) throw new Error(`languoid: ${error.message}`);
    const known = new Set((data ?? []).map((l) => l.id as string));
    for (const id of languoidIds.filter((x) => !known.has(x))) {
      console.log(`  language ${id} is not in the language list (made by a v2 user?); its lane keeps the v2 id`);
    }
  }

  // Blobs the log already confirms need no second upload.
  const alreadyStored = new Set<string>();
  for (let after = 0; ; ) {
    const page = await transport.pull(orgId, projectId, after, 1000);
    for (const e of page) if (e.type === 'v1.BlobStored') alreadyStored.add((e.payload as { hash: string }).hash);
    if (page.length < 1000) break;
    after = page[page.length - 1]!.serverSeq!;
  }

  const names = flag('skip-audio') ? [] : audioNames(rows);
  const t0 = Date.now();
  const { blobs, failed } = await copyBlobs(names, orgId, projectId, {
    download,
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
  if (names.length) console.log(`audio: ${blobs.size} copied, ${failed.length} failed, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  for (const f of failed.slice(0, 10)) console.log(`  failed ${f.name}: ${f.reason}`);

  const { events, report, owner, roles } = mapV2Project(rows, { orgId, blobs, grant });
  seeded.push({ projectId, name: rows.project.name, roles });
  // Whoever you granted ownership to is the org's admin: that is the account
  // that will actually drive it. Otherwise fall back to v2's project owner.
  if (!orgOwner) {
    orgOwner = grant.find((g) => g.role === 'owner')?.profileId ?? owner;
    orgAt = rows.project.created_at;
  }
  const folded = fold(events);
  const invalid = Object.keys(folded.invalidEvents).length;
  console.log(`events: ${report.events} (${report.books} books, ${report.passages} passages, ${report.references} references, ${report.takes} takes, ${report.reviews} reviews, ${report.members} members)`);
  console.log(`left out: ${report.unlinkedAssets} assets without a quest, ${report.textOnlyTranslations} text-only translations, ${report.missingAudio.length} audio files not copied, ${invalid} invalid`);
  if (invalid) throw new Error('mapper produced events the reducer rejects; not appending');

  const result = await appendAll(service, events);
  console.log(`append: ${result.accepted} accepted, ${result.duplicates} duplicates, ${result.rejected.length} rejected`);
  for (const r of result.rejected.slice(0, 20)) console.log(`  rejected ${r.id}: ${r.reason}`);
  if (result.rejected.length) process.exitCode = 2;
}

// The org partition last: it names every project just imported. v2 has no
// organization of its own, so without this an imported org has no roles and
// no org memberships, and every org-level screen has nothing to show.
if (seeded.length > 0) {
  const seed = mapOrgSeed(orgId, `Imported from LangQuest v2`, orgOwner, seeded, orgAt);
  const r = await appendAll(service, seed);
  console.log(`\norg partition ${orgId}: ${r.accepted} accepted, ${r.duplicates} duplicates, ${r.rejected.length} rejected`);
  for (const x of r.rejected.slice(0, 10)) console.log(`  rejected ${x.id}: ${x.reason}`);
  if (r.rejected.length) process.exitCode = 2;
}
