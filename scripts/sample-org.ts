/**
 * A sample organization the whole team can join, built from what the
 * LangQuest organization shares (docs/library.md):
 *
 *   npm run sample:org -- [--invites 10] [--role org_admin] [--hosted] [--history]
 *
 * with SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY set.
 * The library must be seeded first (`npm run library:seed`).
 *
 * It signs in as a sample admin account (made with the service role; its
 * password is reset on every run and never shown) and writes through the
 * ordinary sync path, so every event passes the server's validation and
 * permission rules like a phone's would:
 *
 * - "LangQuest Sample", following LangQuest's Standard Bible Flow and two
 *   templates, with automatic updates;
 * - Dinka on "FIA passages (English)" and Nuer on "Bible chapters
 *   (Original)", which numbers some books differently (Joel, Malachi, the
 *   Psalms), so FIA's English-numbered guides show versification at work;
 *   each language its own partition (docs/decisions.md 37);
 * - invite codes for teammates, printed at the end.
 *
 * With --history (local database only), four more languages and months of
 * back-dated recording, review and upload behind all six, for the web
 * dashboard: see scripts/sample-history.ts.
 *
 * Running it again changes nothing but the invite codes it prints.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MemoryStore, SupabaseTransport, SyncClient } from '@langquest-next/client';
import {
  applyOrgEvent, emptyOrgState, emptyState, foldOrg, ORG_PARTITION, REDUCER_VERSION, SEED_ROLES, selectFlowSpecs, selectTemplateSpecs,
  subscriptionItemId, type EventSpec, type FlowDoc, type LibraryDoc, type OrgState, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import { addHistory, dashboardLogin } from './sample-history';

export const SAMPLE_ORG = { id: 'langquest-sample', name: 'LangQuest Sample' } as const;
const ADMIN_EMAIL = 'sample-admin@langquest.invalid';

/** The languages the sample has, each on one of LangQuest's templates. */
export const SAMPLE_LANGUAGES = [
  { laneId: 'L-din-sample', code: 'din', name: 'Dinka', template: 'FIA passages (English)' },
  { laneId: 'L-nus-sample', code: 'nus', name: 'Nuer', template: 'Bible chapters (Original)' }
] as const;

/** The languages --history adds, so the dashboard has a quiet one, a stuck one and an inactive one to show. */
export const HISTORY_LANGUAGES = [
  { laneId: 'L-bfa-sample', code: 'bfa', name: 'Bari', template: 'FIA passages (English)' },
  { laneId: 'L-kcg-sample', code: 'kcg', name: 'Tyap', template: 'Bible chapters (Original)' },
  { laneId: 'L-bom-sample', code: 'bom', name: 'Berom', template: 'FIA passages (English)' },
  { laneId: 'L-hlb-sample', code: 'hlb', name: 'Halbi', template: 'Bible chapters (Original)' }
] as const;
const SAMPLE_FLOW = 'Standard Bible Flow';

interface Shared { org_id: string; org_name: string; item_id: string; kind: string; name: string; description: string; subscribable: boolean; latest_hash: string }

const orgMaterializer = {
  empty: emptyOrgState, apply: applyOrgEvent, fold: foldOrg,
  compact: (s: OrgState) => { s.appliedEventIds = {}; }, version: REDUCER_VERSION
};

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

async function rpc<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** The sample admin's session: the account is made once, its password reset each run. */
async function signIn(url: string, anon: string, service: string): Promise<{ sb: SupabaseClient; userId: string }> {
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = randomBytes(24).toString('hex');
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw new Error(listError.message);
  const existing = list.users.find((u) => u.email === ADMIN_EMAIL);
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.auth.admin.createUser({ email: ADMIN_EMAIL, password, email_confirm: true });
    if (error) throw new Error(error.message);
  }
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password });
  if (error || !data.user) throw new Error(`sign in: ${error?.message}`);
  return { sb, userId: data.user.id };
}

async function main(argv: string[]) {
  const value = (name: string, fallback: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback; };
  const url = process.env['SUPABASE_URL'] ?? 'http://127.0.0.1:54421';
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url);
  if (!local && !argv.includes('--hosted')) {
    throw new Error(`${url} is not local; a hosted project needs --hosted and the owner's go-ahead`);
  }
  const history = argv.includes('--history');
  if (history && !local) {
    throw new Error('--history back-dates upload confirmations in the database directly, which only a local database allows; run it against the local Supabase');
  }
  const { sb, userId } = await signIn(url, need('SUPABASE_ANON_KEY'), need('SUPABASE_SERVICE_ROLE_KEY'));
  const transport = new SupabaseTransport(sb);
  const client = <S>(projectId: string, materializer?: typeof orgMaterializer) => new SyncClient<S>({
    orgId: SAMPLE_ORG.id, projectId, actorId: userId, deviceId: 'sample-script', store: new MemoryStore(), transport,
    newId: () => randomUUID(), ...(materializer ? { materializer } : {})
  } as never);

  // 1. The organization, unless it is there already.
  const org = client<OrgState>(ORG_PARTITION, orgMaterializer);
  await org.load();
  await org.sync();
  const orgState = () => org.getState() as OrgState;
  if (!orgState().org) {
    await org.append('v1.OrgCreated', { name: SAMPLE_ORG.name });
    for (const r of SEED_ROLES) await org.append('v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
    await org.append('v1.OrgMemberAdded', { profileId: userId, roleId: 'org_admin', scope: { level: 'org' }, displayName: 'Sample admin' });
    await org.sync();
  }

  // 2. What it follows from LangQuest: the flow and the two templates.
  const shared = await rpc<Shared[]>(sb, 'library_shared_items', { p_kind: null, p_query: null, p_limit: 500, p_offset: 0 });
  const find = (kind: string, name: string) => {
    const s = shared.find((r) => r.org_id === 'langquest' && r.kind === kind && r.name === name);
    if (!s) throw new Error(`LangQuest does not share the ${kind} "${name}"; run npm run library:seed first`);
    return s;
  };
  const follow = async (s: Shared): Promise<{ itemId: string; hash: string }> => {
    const itemId = subscriptionItemId(s.org_id, s.item_id);
    const current = orgState().library[itemId]?.pinned.value;
    if (current) return { itemId, hash: current };
    await rpc(sb, 'library_adopt', { p_org: SAMPLE_ORG.id, p_source_org: s.org_id, p_source_item: s.item_id, p_hash: s.latest_hash });
    await org.append('v1.LibrarySubscribed', { itemId, kind: s.kind as never, sourceOrgId: s.org_id, sourceOrgName: s.org_name, sourceItemId: s.item_id, name: s.name, autoUpdate: true, active: true });
    await org.append('v1.LibraryPinned', { itemId, kind: s.kind as never, docHash: s.latest_hash });
    return { itemId, hash: s.latest_hash };
  };
  const docs = new Map<string, LibraryDoc>();
  const load = async (hashes: string[]) => {
    const want = hashes.filter((h) => !docs.has(h));
    if (!want.length) return;
    for (const row of await rpc<{ hash: string; body: string }[]>(sb, 'library_get_documents', { p_org: SAMPLE_ORG.id, p_hashes: want })) {
      if (createHash('sha256').update(row.body).digest('hex') !== row.hash) throw new Error(`document ${row.hash} did not match its name`);
      docs.set(row.hash, JSON.parse(row.body) as LibraryDoc);
    }
  };
  const flow = await follow(find('flow', SAMPLE_FLOW));
  await load([flow.hash]);

  // 3. Each language: listed in the org, its own partition started with its template and flow.
  const languages = history ? [...SAMPLE_LANGUAGES, ...HISTORY_LANGUAGES] : SAMPLE_LANGUAGES;
  for (const lang of languages) {
    if (orgState().projects[lang.laneId]) continue;
    const template = await follow(find('template', lang.template));
    await load([template.hash]);
    const tdoc = docs.get(template.hash) as TemplateDoc;
    if (tdoc.bible) await load([tdoc.bible.versification]);
    const v11n = tdoc.bible ? (docs.get(tdoc.bible.versification) as VersificationDoc) : null;
    await org.append('v1.ProjectRegistered', { projectId: lang.laneId, name: lang.name });
    await org.sync();
    const fresh = emptyState();
    const specs: EventSpec[] = [
      { id: randomUUID(), type: 'v1.ProjectCreated', payload: { name: lang.name, sourceLanguoidId: 'eng' } } as EventSpec,
      { id: randomUUID(), type: 'v1.LaneAdded', payload: { laneId: lang.laneId, languoidId: lang.code } } as EventSpec,
      { id: randomUUID(), type: 'v1.LaneNamed', payload: { laneId: lang.laneId, name: lang.name } } as EventSpec,
      ...selectTemplateSpecs(fresh, { commandId: randomUUID(), laneId: lang.laneId, itemId: template.itemId, docHash: template.hash, doc: tdoc, versification: v11n }),
      ...selectFlowSpecs(fresh, { commandId: randomUUID(), laneId: lang.laneId, itemId: flow.itemId, docHash: flow.hash, doc: docs.get(flow.hash) as FlowDoc })
    ];
    const work = client(lang.laneId);
    await work.load();
    await work.appendMany(specs);
    for (let pass = 0; pass < 20; pass++) {
      const r = await work.sync();
      if (r.rejected) throw new Error(`${lang.name}: the server refused ${r.rejected} events (${r.refused ?? 'see the log'})`);
      if (!(await work.pendingCount())) break;
    }
    console.log(`${lang.name}: ${specs.length} events`);
  }
  await org.sync();

  // 4. Months of work behind each language, for the web dashboard.
  if (history) {
    const service = createClient(url, need('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
    await addHistory({ sb, service, orgId: SAMPLE_ORG.id, actorId: userId, laneIds: languages.map((l) => l.laneId) });
    const login = await dashboardLogin({
      url, anon: need('SUPABASE_ANON_KEY'), service, sb, orgId: SAMPLE_ORG.id,
      isMember: (id) => Object.values(orgState().members[id] ?? {}).some((m) => !m.removed.value)
    });
    console.log(`\nWeb dashboard (npm run web:dev): sign in as ${login.email} with ${login.password} (a Coordinator; the password changes on every run).`);
  }

  // 5. Invite codes: each joins one teammate to the sample, once, for 30 days.
  const role = value('role', 'org_admin');
  const count = Number(value('invites', '10'));
  const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  console.log(`\n${SAMPLE_ORG.name} (${SAMPLE_ORG.id}): ${count} invite codes as ${role}, each usable once until ${expiresAt.slice(0, 10)}.`);
  console.log('In the app: Create Account, then "Join with QR code" or "Join an existing org", and paste one code.\n');
  for (let i = 0; i < count; i++) {
    const token = randomBytes(32).toString('hex');
    await rpc(sb, 'issue_invite', {
      p_org: SAMPLE_ORG.id, p_invite_id: randomUUID(), p_token_hash: createHash('sha256').update(token).digest('hex'),
      p_role_id: role, p_scope: { level: 'org' }, p_expires_at: expiresAt
    });
    console.log(token);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
