// The UI test suite's fixture world (docs/ui-test-suite/README.md, "The
// fixture world"; decisions.md 95), built through the real local server:
// every event goes through the ordinary sync path as the person who would
// write it, so it passes the server's validation and permissions like a
// phone's would. Each call makes a fresh, uniquely named world, so parallel
// test files never touch each other.
//
// The new language follows the app's New language (screens/org.tsx
// `NewLanguage.create`): the template followed from LangQuest with the New
// Testament in scope, the Standard Bible Flow copied as the language's own
// checks (decision 91), FIA's English guides offered, then `LanguageAdded`
// with the language its reference material is in. Nobody is added without
// joining (decision 75): every membership is an invite redeemed by the
// person, and the looked-after account joins through the `join` function.
//
// Local only: it makes accounts with the service role, so it refuses any
// server that is not this machine's.
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import {
  checkPeopleSpecs, commands, derivePassage, emptyLanguageState, formatQuestionField, ORG_STREAM,
  PRIVILEGES, SEED_ROLES, selectTemplateSpecs, subscriptionItemId, USFM_BOOKS,
  type CollectionDoc, type EventSpec, type FlowDoc, type KindDef, type LanguageState, type LibraryDoc, type License, type OrgState,
  type Privilege, type Scope, type SourceDoc, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import { blobKey, MemoryStore, ORG_MATERIALIZER, SupabaseTransport, SyncClient, workerBlobs, type Materializer } from '@langquest-next/sync';

// ---- the world's shape ----------------------------------------------------------------

export const ACCOUNT_KEYS = ['ADMIN', 'COORD', 'LADMIN', 'TRANS', 'REV', 'TREV', 'VIEW', 'KEPT', 'NOORG', 'OWNER2'] as const;
export type AccountKey = (typeof ACCOUNT_KEYS)[number];

export const PASSAGE_KEYS = ['P-NEW', 'P-Q1', 'P-Q2', 'P-Q3', 'P-Q4', 'P-DRAFT', 'P-SUBMITTED', 'P-NEEDS', 'P-BT', 'P-CHECK', 'P-ASIDE', 'P-DONE', 'P-S', 'P-T'] as const;
export type PassageKey = (typeof PASSAGE_KEYS)[number];

export type LanguageKey = 'A' | 'B' | 'C';

export interface UiAccount {
  id: string;
  /** For KEPT, the looked-after account's managed address (it never signs in with it). */
  email: string;
  /** Null for KEPT, which has no password. */
  password: string | null;
  name: string;
  /** Signed in when the world was built. */
  session: Session;
  /** KEPT only: the sign-in name the `join` function gave it. */
  signInName?: string;
}

export interface UiPassage {
  unitId: string;
  /** The label on the map (the template's name for the passage). */
  label: string;
  /** "Luke 13:1-9". */
  ref: string;
  /** Its Version 1, when it has one. */
  takeId?: string;
}

export interface UiWorld {
  run: string;
  builtAt: string;
  /** How long building it took. */
  buildMs: number;
  welcomed: boolean;
  supabaseUrl: string;
  apiUrl: string;
  orgId: string;
  orgName: string;
  org2Id: string;
  org2Name: string;
  /** Custom roles in ORG. */
  roles: { languageLead: string; translatorReviewer: string };
  languages: Record<LanguageKey, { languageId: string; name: string; orgId: string }>;
  passages: Record<PassageKey, UiPassage>;
  /** The required yes/no question COORD added to the Consultant Check, as `${materialId}#${fieldId}`. */
  consultantQuestionId: string;
  accounts: Record<AccountKey, UiAccount>;
}

const NAMES: Record<AccountKey, string> = {
  ADMIN: 'Ada Admin', COORD: 'Cora Coordinator', LADMIN: 'Lena Lead', TRANS: 'Tom Translator', REV: 'Rita Reviewer',
  TREV: 'Trevor Both', VIEW: 'Vic Viewer', KEPT: 'Kept Person', NOORG: 'Nora Noorg', OWNER2: 'Olive Owner'
};

/** Luke's FIA passages (library/fia/pericopes.tsv) behind each key. */
const PASSAGES: Record<PassageKey, [chapter: number, from: number, to: number]> = {
  'P-NEW': [13, 1, 9], 'P-Q1': [13, 10, 17], 'P-Q2': [13, 18, 21], 'P-Q3': [13, 22, 30], 'P-Q4': [13, 31, 35],
  'P-DRAFT': [14, 1, 14], 'P-SUBMITTED': [15, 11, 32], 'P-NEEDS': [14, 15, 24], 'P-BT': [14, 25, 35], 'P-CHECK': [15, 1, 10],
  'P-ASIDE': [16, 1, 15], 'P-DONE': [16, 19, 31], 'P-S': [12, 35, 48], 'P-T': [12, 49, 59]
};

const TEMPLATE = 'FIA passages (English)';
const FLOW = 'Standard Bible Flow';
const LIBRARY_ORG = 'langquest';
const CONSULTANT_QUESTION = 'Does it carry the meaning of the original?';

// ---- the local server ---------------------------------------------------------------

interface Server { url: string; anon: string; service: string; api: string }

export const isLocalUrl = (url: string): boolean => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/.test(url);

let server: Server | null = null;

/** The local Supabase's URL and keys from `supabase status` (as e2e/env.sh reads them), and the local Worker. */
export function localServer(): Server {
  if (server) return server;
  let status: Record<string, string> = {};
  const env = process.env;
  if (!env['EXPO_PUBLIC_SUPABASE_URL'] || !env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] || !env['SUPABASE_SERVICE_ROLE_KEY']) {
    let out = '';
    try {
      out = execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      throw new Error('The local Supabase is not running (npm run db:start).');
    }
    status = JSON.parse(out.slice(out.indexOf('{'))) as Record<string, string>;
  }
  const url = env['EXPO_PUBLIC_SUPABASE_URL'] ?? status['API_URL'] ?? '';
  const api = env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:8787';
  if (!isLocalUrl(url)) throw new Error(`${url || '(no URL)'} is not the local Supabase; the UI fixture only builds on this machine.`);
  if (!isLocalUrl(api)) throw new Error(`${api} is not the local Worker; the UI fixture only builds on this machine.`);
  const anon = env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] ?? status['ANON_KEY'] ?? '';
  const service = env['SUPABASE_SERVICE_ROLE_KEY'] ?? status['SERVICE_ROLE_KEY'] ?? '';
  if (!anon || !service) throw new Error('supabase status did not report the anon and service role keys.');
  server = { url: url.replace(/\/$/, ''), anon, service, api: api.replace(/\/$/, '') };
  return server;
}

/** Read from the app so a terms bump cannot put a terms screen in every test. */
const TERMS_VERSION = /TERMS_VERSION = '([^']+)'/.exec(
  readFileSync(new URL('../../apps/mobile/src/accountData.ts', import.meta.url), 'utf8'))![1]!;

// ---- people and their clients -----------------------------------------------------

interface Person extends UiAccount { key: AccountKey; sb: SupabaseClient }

function anonClient(): SupabaseClient {
  const s = localServer();
  return createClient(s.url, s.anon, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function rpc<T>(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** An account made with the admin API, signed in, with its profile name set as the app sets it (`save_profile`). */
async function makeAccount(key: AccountKey, run: string): Promise<Person> {
  const s = localServer();
  const admin = createClient(s.url, s.service, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `ui-${run}-${key.toLowerCase()}@example.test`;
  const password = randomBytes(12).toString('hex');
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error || !made.data.user) throw new Error(`account ${key}: ${made.error?.message ?? 'not made'}`);
  const sb = anonClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign in as ${key}: ${error?.message ?? 'no session'}`);
  await rpc(sb, 'save_profile', { p_display_name: NAMES[key] });
  return { key, id: data.user.id, email, password, name: NAMES[key], session: data.session, sb };
}

/** Terms and the welcome, recorded on the server with the app's own ids (accountData.ts `recordUserEvent`). */
async function firstRun(p: Person, welcomed: boolean) {
  const events: [string, Record<string, unknown>, string][] = [['v1.TermsAccepted', { version: TERMS_VERSION }, TERMS_VERSION]];
  if (welcomed) events.push(['v1.VisionSeen', {}, '1']);
  for (const [type, payload, key] of events) await rpc(p.sb, 'record_user_event', { p_id: `${p.id}:${type}:${key}`, p_type: type, p_payload: payload });
}

function syncClient<S>(p: Pick<Person, 'id' | 'sb'>, orgId: string, streamId: string, materializer?: Materializer<S>): SyncClient<S> {
  return new SyncClient<S>({
    ...(materializer ? { materializer } : {}),
    orgId, streamId, actorId: p.id, deviceId: `ui-fixture-${p.id}`,
    store: new MemoryStore(), transport: new SupabaseTransport(p.sb), newId: () => randomUUID()
  } as never);
}

/** Push and pull until nothing is waiting either way; any refused event fails the build, with the server's reasons. */
async function drain<S>(client: SyncClient<S>, what: string): Promise<void> {
  for (let pass = 0; pass < 60; pass++) {
    const r = await client.sync();
    if (r.offline || r.tooOld || r.refused !== null) throw new Error(`${what}: sync ${JSON.stringify(r)}`);
    if (r.rejected) {
      const { rejected } = await client.inspect();
      throw new Error(`${what}: the server refused ${r.rejected} event(s): ${rejected.map((e) => `${e.event.type} (${e.rejectReason ?? 'no reason'})`).join('; ')}`);
    }
    if (!r.more && (await client.pendingCount()) === 0) return;
  }
  throw new Error(`${what}: still syncing after 60 passes`);
}

async function commit<S>(client: SyncClient<S>, specs: EventSpec[], what: string): Promise<void> {
  if (specs.length) await client.appendMany(specs as never);
  await drain(client, what);
}

/** A language client that has pulled everything; `step` appends a command's specs against its current fold. */
async function languageClient(p: Person, orgId: string, languageId: string) {
  const client = syncClient<LanguageState>(p, orgId, languageId);
  await client.load();
  await drain(client, `${p.key} opening ${languageId}`);
  return {
    client,
    state: () => client.getState(),
    /** Append now (the fold updates at once); `done` sends it all. */
    step: async (make: (state: LanguageState) => EventSpec[]) => { const specs = make(client.getState()); if (specs.length) await client.appendMany(specs as never); },
    done: (what: string) => drain(client, `${p.key}: ${what}`)
  };
}

// ---- audio -------------------------------------------------------------------------

const SAMPLE_RATE = 16000;

/**
 * A distinct, valid WAV per card: a voiced burst (the fixture's 180 Hz
 * voice, shifted by `n` so every hash differs), then silence. 16-bit mono.
 */
function voice(n: number, voicedSeconds: number, totalSeconds: number): { bytes: Uint8Array; hash: string; durationMs: number } {
  const total = Math.round(totalSeconds * SAMPLE_RATE);
  const voiced = Math.round(voicedSeconds * SAMPLE_RATE);
  const bytes = new Uint8Array(44 + total * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => { for (let k = 0; k < text.length; k++) view.setUint8(at + k, text.charCodeAt(k)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + total * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, total * 2, true);
  const carrier = 150 + n * 3;
  for (let k = 0; k < voiced; k++) {
    const t = k / SAMPLE_RATE;
    const envelope = 0.45 + 0.15 * Math.sin(2 * Math.PI * 4 * t);
    view.setInt16(44 + k * 2, Math.round(envelope * Math.sin(2 * Math.PI * carrier * t) * 32767), true);
  }
  return { bytes, hash: createHash('sha256').update(bytes).digest('hex'), durationMs: Math.round(totalSeconds * 1000) };
}

/** Recordings made in this world, each different. Uploaded where the app keeps a language's files (decision 69). */
function audio(orgId: string, languageId: string) {
  let n = 0;
  return async (who: Person, voicedSeconds = 1.5, totalSeconds = 3) => {
    const v = voice(n++, voicedSeconds, totalSeconds);
    await workerBlobs(localServer().api, who.session.access_token).put(blobKey(orgId, languageId, v.hash, 'wav'), v.bytes);
    return { hash: v.hash, durationMs: v.durationMs, format: 'wav' as const };
  };
}

// ---- the library --------------------------------------------------------------------

interface Shared { org_id: string; org_name: string; item_id: string; kind: string; name: string; description: string; subscribable: boolean; latest_hash: string }

/** What New language reads and writes in the organization's library (useLibrary, TranslateStep, useNewLanguageOffers). */
function library(p: Person, orgId: string, org: SyncClient<OrgState>) {
  const docs = new Map<string, LibraryDoc>();
  let shared: Shared[] | null = null;
  const load = async (hashes: (string | null | undefined)[]) => {
    const want = [...new Set(hashes.filter((h): h is string => !!h && !docs.has(h)))];
    if (!want.length) return;
    for (const row of await rpc<{ hash: string; body: string }[]>(p.sb, 'library_get_documents', { p_org: orgId, p_hashes: want })) {
      if (createHash('sha256').update(row.body).digest('hex') !== row.hash) throw new Error(`library document ${row.hash} did not match its name`);
      docs.set(row.hash, JSON.parse(row.body) as LibraryDoc);
    }
  };
  const sharedItems = async () => (shared ??= await rpc<Shared[]>(p.sb, 'library_shared_items', { p_kind: null, p_query: null, p_limit: 500, p_offset: 0 }));
  return {
    docs, load,
    shared: sharedItems,
    find: async (kind: string, name: string) => {
      const s = (await sharedItems()).find((r) => r.org_id === LIBRARY_ORG && r.kind === kind && r.name === name);
      if (!s) throw new Error(`LangQuest does not share the ${kind} "${name}"; run npm run library:seed first`);
      return s;
    },
    /** Follow it with automatic updates, as `lib.subscribe(shared, true)` does; a copy when its owner does not allow following. */
    take: async (s: Shared): Promise<string> => {
      const existing = subscriptionItemId(s.org_id, s.item_id);
      if (org.getState().library[existing]) return existing;
      await rpc(p.sb, 'library_adopt', { p_org: orgId, p_source_org: s.org_id, p_source_item: s.item_id, p_hash: s.latest_hash });
      await load([s.latest_hash]);
      if (s.subscribable) {
        await org.appendMany([
          { type: 'v1.LibrarySubscribed', payload: { itemId: existing, kind: s.kind as never, sourceOrgId: s.org_id, sourceOrgName: s.org_name, sourceItemId: s.item_id, name: s.name, autoUpdate: true, active: true } },
          { type: 'v1.LibraryPinned', payload: { itemId: existing, kind: s.kind as never, docHash: s.latest_hash } }
        ] as never);
        return existing;
      }
      const copyId = `${s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 8)}`;
      await org.appendMany([
        { type: 'v1.LibraryItemDefined', payload: { itemId: copyId, kind: s.kind as never, name: s.name, description: s.description, copiedFrom: { orgId: s.org_id, orgName: s.org_name, itemId: s.item_id, docHash: s.latest_hash } } },
        { type: 'v1.LibraryVersionPublished', payload: { itemId: copyId, kind: s.kind as never, docHash: s.latest_hash } }
      ] as never);
      return copyId;
    }
  };
}

/** Books in the New Testament, as New language's default scope gives them (orgAdmin.ts `booksInScope`, 'nt'). */
function newTestament(doc: TemplateDoc): string[] | undefined {
  if (doc.structure !== 'bible' || !doc.bible) return undefined;
  return doc.bible.books.map((b) => b.book).filter((b) => {
    const i = (USFM_BOOKS as readonly string[]).indexOf(b);
    return i >= 39 && i < 66;
  });
}

/** A language id people can read in logs (orgAdmin.ts `newLanguageId`). */
function newLanguageId(code: string): string {
  return `L-${code.replace(/[^a-z0-9]+/g, '') || 'lang'}-${randomUUID().replace(/-/g, '').slice(0, 6)}`;
}

/**
 * Add a language as New language does when its admin keeps every suggested
 * answer: FIA passages (English) for the New Testament, the Standard Bible
 * Flow copied, its Bible and study guides offered in English. Returns the
 * language and the template's passage units.
 */
async function newLanguage(p: Person, orgId: string, org: SyncClient<OrgState>, name: string) {
  const lib = library(p, orgId, org);
  const code = name.slice(0, 3).toLowerCase();
  const languageId = newLanguageId(code);

  // What they translate: the template, followed, with the New Testament in scope.
  const template = await lib.find('template', TEMPLATE);
  const templateItem = await lib.take(template);
  await lib.load([template.latest_hash]);
  const tdoc = lib.docs.get(template.latest_hash) as TemplateDoc;
  if (tdoc.bible) await lib.load([tdoc.bible.versification]);
  const v11n = tdoc.bible ? (lib.docs.get(tdoc.bible.versification) as VersificationDoc | undefined) ?? null : null;
  if (tdoc.bible && !v11n) throw new Error(`the versification of ${TEMPLATE} could not be read`);
  const books = newTestament(tdoc);

  // How it is checked: the ready-made flow, read but not followed; its checks are copied (decision 91).
  const flow = await lib.find('flow', FLOW);
  await lib.load([flow.latest_hash]);
  const fdoc = lib.docs.get(flow.latest_hash) as FlowDoc;

  // What its team is offered in English (useNewLanguageOffers): a Bible, World English first, and FIA's guides.
  const materials = (await lib.shared()).filter((s) => s.kind === 'material' && s.latest_hash && !org.getState().library[subscriptionItemId(s.org_id, s.item_id)]);
  await lib.load(materials.map((s) => s.latest_hash));
  const docOf = (s: Shared) => lib.docs.get(s.latest_hash) ?? null;
  const fiaSet = materials.filter((s) => {
    const d = docOf(s);
    return d?.format === 'collection@1' && !!d.language && (d.pattern || (/\bFIA\b/.test(d.title) ? 'FIA' : null)) === 'FIA';
  });
  const guides = fiaSet.length > 1 ? fiaSet.find((s) => (docOf(s) as CollectionDoc).language === 'eng') ?? null : null;
  const bible = materials.filter((s) => { const d = docOf(s); return d?.format === 'source@1' && (d as SourceDoc).language === 'eng'; })
    .sort((a, b) => (/world english/i.test(a.name) ? 0 : 1) - (/world english/i.test(b.name) ? 0 : 1))[0] ?? null;
  const offered: string[] = [];
  const setSays: { itemId: string; state: 'recommended' | 'hidden' }[] = [];
  if (bible) offered.push(await lib.take(bible));
  if (guides) {
    const itemId = await lib.take(guides);
    setSays.push({ itemId, state: 'recommended' });
    // The set's other languages the organization holds are hidden here (guideSets.ts `chooseSetLanguage`).
    for (const s of fiaSet) {
      const other = subscriptionItemId(s.org_id, s.item_id);
      if (s !== guides && org.getState().library[other]) setSays.push({ itemId: other, state: 'hidden' });
    }
  }

  const fresh = emptyLanguageState();
  const kinds: KindDef[] = [...fdoc.kinds];
  const flowSpecs = commands(fresh).copyFlow({ commandId: `${languageId}:checks`, name: fdoc.name, kinds, steps: fdoc.steps });
  const templateSpecs = selectTemplateSpecs(fresh, {
    commandId: randomUUID(), itemId: templateItem, docHash: template.latest_hash, doc: tdoc, versification: v11n, ...(books ? { books } : {})
  });
  const recommend: EventSpec[] = [
    ...offered.filter((id) => org.getState().recommendations[id]?.value !== true).map((itemId) => ({ itemId, state: 'recommended' as const })),
    ...setSays
  ].map((payload, i) => ({ id: `${languageId}:offer:${i}`, type: 'v1.ReferenceSet', payload } as EventSpec));

  // Listed in the organization's stream first; its own stream takes events once that is in.
  await commit(org, [{ id: randomUUID(), type: 'v1.LanguageAdded', payload: { languageId, name, code, sourceCode: 'eng' } }], `${name}: LanguageAdded`);
  const lang = syncClient<LanguageState>(p, orgId, languageId);
  await lang.load();
  await commit(lang, [...templateSpecs, ...flowSpecs, ...recommend], `${name}: template, checks and offers`);
  const units = templateSpecs.filter((s) => s.type === 'v1.UnitAdded').map((s) => s.payload as { unitId: string; kind: string; label: string });
  return { languageId, units, offered: { bible: bible?.name ?? null, guides: guides?.name ?? null } };
}

/** An organization as CreateOrg makes it (createOrg.ts): the usual roles, its creator as Organization Admin, and its licence. */
async function createOrg(p: Person, name: string, license: License) {
  const orgId = `org-${randomUUID()}`;
  const org = syncClient<OrgState>(p, orgId, ORG_STREAM, ORG_MATERIALIZER);
  await org.load();
  await commit(org, [
    { id: randomUUID(), type: 'v1.OrgCreated', payload: { name } },
    ...SEED_ROLES.map((r) => ({ id: randomUUID(), type: 'v1.RoleDefined' as const, payload: { roleId: r.roleId, name: r.name, privileges: r.privileges } })),
    { id: randomUUID(), type: 'v1.MemberAdded', payload: { profileId: p.id, roleId: 'org_admin', scope: { level: 'org' } } },
    { id: randomUUID(), type: 'v1.LicenseSet', payload: { license } }
  ] as EventSpec[], `${name}: created`);
  return { orgId, org };
}

// ---- joining -----------------------------------------------------------------------

async function issueInvite(issuer: Person, orgId: string, roleId: string, scope: Scope, label: string | null = null): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await rpc(issuer.sb, 'issue_invite_v3', {
    p_org: orgId, p_invite_id: randomUUID(), p_token_hash: createHash('sha256').update(token).digest('hex'), p_role_id: roleId,
    p_scope: scope, p_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), p_label: label, p_max_uses: 1
  });
  return token;
}

/** Invited by `issuer`, redeemed by the person as themselves (invites.ts `redeemInvite`). */
async function joinByInvite(issuer: Person, who: Person, orgId: string, roleId: string, scope: Scope): Promise<void> {
  const token = await issueInvite(issuer, orgId, roleId, scope);
  await rpc(who.sb, 'redeem_invite_v2', { p_token: token });
}

/**
 * A one-person invite labelled with their name, joined as a new person with
 * no email and no password through the `join` function, as useHeldInvite's
 * `joinAsNew` does: the server makes the looked-after account and signs it in.
 */
async function joinAsNew(issuer: Person, orgId: string, roleId: string, scope: Scope, label: string): Promise<Person> {
  const token = await issueInvite(issuer, orgId, roleId, scope, label);
  const sb = anonClient();
  // Under many worlds at once the function can answer "Unable to join right now": the same
  // request id is safe to send again (the server treats it as one join).
  const requestId = randomUUID();
  let { data, error } = await sb.functions.invoke('join', { body: { token, requestId } });
  for (let attempt = 1; error && attempt < 4; attempt++) {
    await new Promise((r) => setTimeout(r, 1000 * attempt));
    ({ data, error } = await sb.functions.invoke('join', { body: { token, requestId } }));
  }
  if (error) {
    const context = (error as { context?: Response }).context;
    const reply = context ? await context.json().catch(() => null) as { error?: string } | null : null;
    throw new Error(`join as ${label}: ${reply?.error ?? error.message}`);
  }
  const joined = data as { session: { access_token: string; refresh_token: string }; signInName: string };
  const set = await sb.auth.setSession(joined.session);
  if (set.error || !set.data.session || !set.data.user) throw new Error(`join as ${label}: ${set.error?.message ?? 'no session'}`);
  return {
    key: 'KEPT', id: set.data.user.id, email: set.data.user.email ?? '', password: null, name: label,
    session: set.data.session, signInName: joined.signInName, sb
  };
}

// ---- the world ---------------------------------------------------------------------

/**
 * One fresh world (docs/ui-test-suite/README.md, "The fixture world").
 * `welcomed: false` leaves every account's Welcome unseen (AUTH-056); the
 * terms stay accepted, so the Welcome is the first thing each one sees.
 */
export async function buildWorld(opts: { welcomed?: boolean } = {}): Promise<UiWorld> {
  const started = Date.now();
  const welcomed = opts.welcomed ?? true;
  const s = localServer();
  const run = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
  const orgName = `UI Test Org ${run}`;
  const org2Name = `UI Second Org ${run}`;

  // Accounts, except the looked-after one, which joining makes.
  const made = await Promise.all(ACCOUNT_KEYS.filter((k) => k !== 'KEPT').map((k) => makeAccount(k, run)));
  const P = Object.fromEntries(made.map((p) => [p.key, p])) as Record<AccountKey, Person>;
  const { ADMIN, COORD, LADMIN, TRANS, REV, TREV, VIEW, OWNER2 } = P;

  // ORG2 is built beside ORG: its own owner, CC BY 4.0, Charlie, and ADMIN as a Translator.
  const second = (async () => {
    const { orgId, org } = await createOrg(OWNER2, org2Name, 'CC-BY-4.0');
    const charlie = await newLanguage(OWNER2, orgId, org, 'Charlie');
    await joinByInvite(OWNER2, ADMIN, orgId, 'translator', { level: 'org' });
    return { orgId, charlie };
  })();

  // ORG: All rights reserved, the seed roles and two of its own.
  const { orgId, org } = await createOrg(ADMIN, orgName, 'all-rights-reserved');
  const languageLead = `role-${randomUUID()}`;
  const translatorReviewer = `role-${randomUUID()}`;
  const only = (keep: (p: Privilege) => boolean) => PRIVILEGES.filter(keep);
  await commit(org, [
    { id: randomUUID(), type: 'v1.RoleDefined', payload: { roleId: languageLead, name: 'Language Lead', privileges: only((x) => x !== 'manage_roles' && x !== 'override_checkpoints') } },
    { id: randomUUID(), type: 'v1.RoleDefined', payload: { roleId: translatorReviewer, name: 'Translator-Reviewer',
      privileges: only((x) => ['translate', 'review', 'fill_reference', 'send_to_reviewers', 'view_status'].includes(x)) } }
  ] as EventSpec[], 'ORG: custom roles');

  // LANG-A ready, listed publicly; LANG-B only added.
  const alpha = await newLanguage(ADMIN, orgId, org, 'Alpha');
  const A = alpha.languageId;
  await rpc(ADMIN.sb, 'set_language_visibility', { p_org: orgId, p_language: A, p_listed: true });
  const B = newLanguageId('bra');
  await commit(org, [{ id: randomUUID(), type: 'v1.LanguageAdded', payload: { languageId: B, name: 'Bravo', code: 'bra', sourceCode: 'eng' } }], 'Bravo: LanguageAdded');

  // Everyone else joins by invite (decision 75).
  const atA: Scope = { level: 'language', languageId: A };
  await Promise.all([
    joinByInvite(ADMIN, COORD, orgId, 'coordinator', { level: 'org' }),
    joinByInvite(ADMIN, LADMIN, orgId, languageLead, atA),
    joinByInvite(ADMIN, TRANS, orgId, 'translator', atA),
    joinByInvite(ADMIN, REV, orgId, 'reviewer', atA),
    joinByInvite(ADMIN, TREV, orgId, translatorReviewer, atA),
    joinByInvite(ADMIN, VIEW, orgId, 'viewer', { level: 'org' })
  ]);
  const KEPT = await joinAsNew(ADMIN, orgId, 'translator', atA, NAMES.KEPT);
  P.KEPT = KEPT;
  await Promise.all(Object.values(P).map((p) => firstRun(p, welcomed)));

  // The passages, by FIA's verse ranges.
  const unitFor = (chapter: number, from: number, to: number) => {
    const node = `LUK.${chapter}.${from}-${to}`;
    const u = alpha.units.find((x) => x.kind === 'passage' && x.unitId.replace(/~[^/]*$/, '').endsWith(`/${node}`));
    if (!u) throw new Error(`${TEMPLATE} has no passage Luke ${chapter}:${from}-${to}`);
    return u;
  };
  const passages = Object.fromEntries(PASSAGE_KEYS.map((k) => {
    const [c, f, t] = PASSAGES[k];
    const u = unitFor(c, f, t);
    return [k, { unitId: u.unitId, label: u.label, ref: `Luke ${c}:${f}-${t}` }];
  })) as Record<PassageKey, UiPassage>;
  const unit = (k: PassageKey) => passages[k].unitId;
  const record = audio(orgId, A);
  const id = () => randomUUID();

  // COORD sets up the checks' people and the Consultant Check's question, then asks for recordings.
  const coord = await languageClient(COORD, orgId, A);
  const checkKinds = [...new Set(Object.values(coord.state().flowSteps).flatMap((st) => st.value.kindIds))];
  const checkName: Record<string, string> = { peer: 'Peer check', bt: 'Back translation', community: 'Community check', consultant: 'Consultant check', final: 'Final approval' };
  for (const kindId of ['peer', 'bt']) {
    await coord.step((st) => checkPeopleSpecs(st, { commandId: id(), kindId, people: [REV.id, TREV.id], kinds: checkKinds, nameOf: (k) => checkName[k] ?? k }).specs);
  }
  const questionSet = `questions-${randomUUID()}`;
  await coord.step((st) => commands(st).defineMaterial({
    commandId: id(), materialId: questionSet, kind: 'questions', title: `${checkName['consultant']} questions`, scope: { stepId: 'consultant' },
    fields: [{ fieldId: 'q1', text: formatQuestionField({ text: CONSULTANT_QUESTION, type: 'yesno', required: true }) }]
  }));
  const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  await coord.step((st) => commands(st).ask({ commandId: id(), unitId: unit('P-NEW'), what: 'record', profileId: TRANS.id, dueDate: due }));
  for (const k of ['P-Q1', 'P-Q2', 'P-Q3', 'P-Q4'] as const) await coord.step((st) => commands(st).ask({ commandId: id(), unitId: unit(k), what: 'record', profileId: TRANS.id }));
  await coord.done('checks and requests');

  // TRANS records: two parts kept as a draft, and Version 1 (three parts) of six passages; asks REV for one Peer Review.
  const trans = await languageClient(TRANS, orgId, A);
  const recordParts = async (k: PassageKey, parts: number) => {
    const cards = await Promise.all(Array.from({ length: parts }, () => record(TRANS)));
    for (const card of cards) {
      const recordingId = id();
      await trans.step((st) => commands(st).addRecording({ commandId: recordingId, recordingId, unitId: unit(k), kind: 'target', card }));
    }
    await trans.step((st) => commands(st).keepTake({ commandId: id(), unitId: unit(k), cardHashes: cards.map((c) => c.hash), actorId: TRANS.id }));
    return cards;
  };
  await recordParts('P-DRAFT', 2);
  const published = ['P-SUBMITTED', 'P-NEEDS', 'P-BT', 'P-CHECK', 'P-ASIDE', 'P-DONE'] as const;
  for (const k of published) {
    const cards = await recordParts(k, 3);
    await trans.step((st) => commands(st).publishVersion({ commandId: id(), unitId: unit(k), cardHashes: cards.map((c) => c.hash), actorId: TRANS.id }));
    passages[k].takeId = derivePassage(trans.state(), unit(k)).latest!.takeId;
  }
  await trans.step((st) => commands(st).ask({ commandId: id(), unitId: unit('P-SUBMITTED'), what: 'review', kindId: 'peer', profileId: REV.id }));
  await trans.done('recordings and versions');

  // REV reviews: feedback with a voice note, Peer Reviews that look good, back translations and community checks.
  const rev = await languageClient(REV, orgId, A);
  const take = (k: PassageKey) => passages[k].takeId!;
  const note = await record(REV, 4.5, 5);
  await rev.step(() => [{ id: id(), type: 'v1.AudioFormatSet', payload: { hash: note.hash, format: 'wav' } } as EventSpec]);
  await rev.step((st) => commands(st).recordReview({ commandId: id(), takeIds: [take('P-NEEDS')], kindId: 'peer', outcome: 'needs_changes', via: 'app',
    comment: 'Verse 18 is too fast', commentBlobHash: note.hash }));
  for (const k of ['P-BT', 'P-CHECK', 'P-DONE'] as const) {
    await rev.step((st) => commands(st).recordReview({ commandId: id(), takeIds: [take(k)], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
  }
  for (const k of ['P-CHECK', 'P-DONE'] as const) {
    const bt = await Promise.all([record(REV), record(REV)]);
    await rev.step((st) => commands(st).produceContent({ commandId: id(), fromTakeId: take(k), kindId: 'bt', cards: bt, via: 'app' }));
    await rev.step((st) => commands(st).recordReview({ commandId: id(), takeIds: [take(k)], kindId: 'community', outcome: 'looks_good', via: 'app', people: 6 }));
  }
  await rev.done('reviews');

  // TRANS asks REV to back-translate P-BT, now its Peer Review looks good.
  await trans.done('pull reviews');
  await trans.step((st) => commands(st).ask({ commandId: id(), unitId: unit('P-BT'), what: 'review', kindId: 'bt', profileId: REV.id }));
  await trans.done('back translation request');

  // COORD sets P-ASIDE's Community Check aside, and takes P-DONE through the consultant and final approval.
  await coord.done('pull reviews');
  await coord.step((st) => commands(st).depart({ commandId: id(), unitId: unit('P-ASIDE'), type: 'skip', kindId: 'community', reason: 'No community meeting this month' }));
  await coord.step((st) => commands(st).recordReview({ commandId: id(), takeIds: [take('P-DONE')], kindId: 'consultant', outcome: 'looks_good', via: 'app',
    answers: { [`${questionSet}#q1`]: 'Yes' } }));
  await coord.step((st) => commands(st).recordReview({ commandId: id(), takeIds: [take('P-DONE')], kindId: 'final', outcome: 'looks_good', via: 'app' }));
  await coord.done('set aside, consultant and final approval');

  const { orgId: org2Id, charlie } = await second;
  const account = (p: Person): UiAccount => ({
    id: p.id, email: p.email, password: p.password, name: p.name, session: p.session, ...(p.signInName ? { signInName: p.signInName } : {})
  });
  return {
    run, builtAt: new Date(started).toISOString(), buildMs: Date.now() - started, welcomed,
    supabaseUrl: s.url, apiUrl: s.api, orgId, orgName, org2Id, org2Name,
    roles: { languageLead, translatorReviewer },
    languages: {
      A: { languageId: A, name: 'Alpha', orgId },
      B: { languageId: B, name: 'Bravo', orgId },
      C: { languageId: charlie.languageId, name: 'Charlie', orgId: org2Id }
    },
    passages,
    consultantQuestionId: `${questionSet}#q1`,
    accounts: Object.fromEntries(ACCOUNT_KEYS.map((k) => [k, account(P[k])])) as Record<AccountKey, UiAccount>
  };
}

// ---- using the world from a test ---------------------------------------------------

/**
 * localStorage the app reads at startup (App.tsx): the signed-in session,
 * the open organization and its open language, and the first-run marks. Put
 * it in with `page.addInitScript` before the first load, as world.ts's
 * `openAs` does. `session` replaces the one from build time (`signIn`).
 */
export function browserStateFor(world: UiWorld, key: AccountKey, languageKey: LanguageKey = 'A', session?: Session): Record<string, string> {
  const who = world.accounts[key];
  const language = world.languages[languageKey];
  const ref = new URL(world.supabaseUrl).hostname.split('.')[0];
  const state: Record<string, string> = { [`sb-${ref}-auth-token`]: JSON.stringify(session ?? who.session) };
  if (key !== 'NOORG') {
    state[`selection:${who.id}`] = JSON.stringify({ orgId: language.orgId });
    state[`language:${who.id}:${language.orgId}`] = language.languageId;
  }
  state[`terms-version:${who.id}`] = TERMS_VERSION;
  if (world.welcomed) state[`vision:${who.id}`] = '1';
  return state;
}

/**
 * A fresh session for an account: a new password sign-in, so a test never
 * shares a refresh token with another browser. KEPT has no password; its
 * build-time session is used (refreshed by the server if it has expired).
 */
export async function signIn(world: UiWorld, key: AccountKey): Promise<{ sb: SupabaseClient; session: Session }> {
  const who = world.accounts[key];
  const sb = anonClient();
  const { data, error } = who.password
    ? await sb.auth.signInWithPassword({ email: who.email, password: who.password })
    : await sb.auth.setSession({ access_token: who.session.access_token, refresh_token: who.session.refresh_token });
  if (error || !data.session) throw new Error(`sign in as ${key}: ${error?.message ?? 'no session'}`);
  return { sb, session: data.session };
}

/**
 * A sync client as an account, loaded and caught up, for a test that changes
 * the world after it is built: `'org'` (ORG's stream), `'org2'`, or a
 * language. Append with `client.appendMany(commands(client.getState())...)`
 * and send with `sync()`.
 */
export async function clientAs(world: UiWorld, key: AccountKey, stream: 'org' | 'org2' | LanguageKey): Promise<SyncClient<LanguageState> | SyncClient<OrgState>> {
  const { sb } = await signIn(world, key);
  const who = { id: world.accounts[key].id, sb };
  const client = stream === 'org' || stream === 'org2'
    ? syncClient<OrgState>(who, stream === 'org' ? world.orgId : world.org2Id, ORG_STREAM, ORG_MATERIALIZER)
    : syncClient<LanguageState>(who, world.languages[stream].orgId, world.languages[stream].languageId);
  await client.load();
  await drain(client as SyncClient<unknown>, `${key} opening ${stream}`);
  return client;
}

/** Send what a test appended with a `clientAs` client; throws with the server's reasons if anything was refused. */
export const send = (client: SyncClient<unknown>, what = 'test write'): Promise<void> => drain(client, what);
