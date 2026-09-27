import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { referencedBlobs } from '../src/blobs';
import { EVENT_REGISTRY, eventBlobHashes, registryEntry, type EventRegistryEntry } from '../src/eventRegistry';
import type { AnyEvent, EventType } from '../src/events';
import { EVENT_PRIVILEGE, foldOrg, privilegeFor } from '../src/org';
import { deriveInbox } from '../src/inbox';
import { buildIndexes } from '../src/indexes';
import { passageKeys, passageRow } from '../src/readModels';
import { createTextTranslation } from '../src/textTranslations';
import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import { validateEvent } from '../src/validate';
import { buildFixture, buildOrgFixture, buildRegistryExampleFixture, buildStep11Fixture, shuffle } from './fixtures';

/**
 * Guards for the event registry. The event log is durable history that
 * every installed client must keep syncing (AGENTS.md). These tests make the
 * dangerous edits fail loudly: a type without rules, a privilege that
 * drifts, a shipped shape that changes, and core rules the server does not run.
 */

const here = dirname(fileURLToPath(import.meta.url));
const TYPES = Object.keys(EVENT_REGISTRY) as EventType[];
const entryOf = (t: EventType) => EVENT_REGISTRY[t] as EventRegistryEntry<EventType>;
const envelope = (type: EventType, payload: unknown, id = `t-${type}`): AnyEvent =>
  ({ id, type, orgId: 'org1', projectId: 'p1', actorId: 'lead', deviceId: 'dX', hlc: '000000000001000:000000:dX', payload }) as AnyEvent;

describe('a: every event type has a complete registry entry', () => {
  // Why: `satisfies` catches a missing entry at compile time; this catches a
  // half-filled one at runtime (a JS caller, an `as` cast, a bad merge).
  it.each(TYPES)('%s declares validate, privilege, blobHashes, example and shipped', (type) => {
    const e = entryOf(type);
    expect(typeof e.validate).toBe('function');
    expect(typeof e.blobHashes).toBe('function');
    expect(e.privilege === null || typeof e.privilege === 'string').toBe(true);
    expect(typeof e.shipped).toBe('boolean');
    expect(e.example && typeof e.example === 'object').toBe(true);
  });

  it('the registry module imports nothing that imports it back', () => {
    // Why: org.ts re-exports EVENT_PRIVILEGE from the registry. A cycle
    // through org, validate or reducer left it uninitialized in the Metro web
    // bundle ("Cannot access 'EVENT_PRIVILEGE' before initialization") and
    // the app never started, while vitest's loader hid the problem.
    const source = readFileSync(join(here, '../src/eventRegistry.ts'), 'utf8');
    const imports = [...source.matchAll(/^import\s+(?!type\b)[^;]*from\s+'\.\/(\w+)'/gm)].map((m) => m[1]);
    for (const cyclic of ['org', 'validate', 'reducer', 'index', 'commands', 'state']) expect(imports).not.toContain(cyclic);
  });

  it('lookups for unfamiliar or prototype names find nothing and never throw', () => {
    // Why: a type string comes off the wire. `constructor` must not be read
    // as an entry, or validateEvent would throw inside the fold.
    for (const t of ['v9.Future', 'constructor', '__proto__', 'toString']) expect(registryEntry(t)).toBeUndefined();
    expect(validateEvent(envelope('constructor' as EventType, {}))).toBeNull();
  });
});

/** EVENT_PRIVILEGE as it was before the registry existed (org.ts at 076ab4a). Never edit an existing line. */
const PRE_REGISTRY_PRIVILEGE: Record<string, string | null> = {
  'v1.BibleSettingsSet': 'manage_reference', 'v1.BiblePassageSelected': 'translate', 'v1.TextTranslationCreated': 'translate',
  'v1.TakeMetadataSet': 'translate', 'v1.ObtPolicySet': 'manage_flows', 'v1.ObtRoundStarted': 'translate', 'v1.ObtAudioAdded': 'view_status',
  'v1.ObtInteractionSet': 'view_status', 'v1.ObtStepRecorded': 'view_status', 'v1.ObtWorkspaceCreated': null, 'v1.ProjectCreated': 'bootstrap',
  'v1.ProjectConfigChanged': 'manage_structure', 'v1.MemberAdded': 'invite_members', 'v1.MemberRoleChanged': 'invite_members',
  'v1.MemberRemoved': 'invite_members', 'v1.LaneAdded': 'manage_structure', 'v1.UnitAdded': 'manage_templates',
  'v1.ReferenceAttached': 'fill_reference', 'v1.RecordingAdded': 'translate', 'v1.TakeComposed': 'translate', 'v1.TakeArchived': 'translate',
  'v1.TakeSelected': 'translate', 'v1.TakeSubmitted': 'translate', 'v1.ReviewSubmitted': 'review', 'v1.AssignmentMade': 'assign_work',
  'v1.SourceImported': 'manage_structure', 'v1.BlobStored': null, 'v1.BlobInvalidated': null, 'v1.Redacted': 'manage_structure',
  'v1.LaneTemplateSelected': 'manage_templates', 'v1.LaneFlowSelected': 'manage_flows', 'v1.WorkflowStepSet': 'manage_flows',
  'v1.WorkflowStepRemoved': 'manage_flows', 'v1.ReviewTeamDefined': 'manage_teams', 'v1.ReviewTeamMemberSet': 'manage_teams',
  'v1.ResponseRecorded': 'translate', 'v1.ReviewCommentRecorded': 'review', 'v1.MaterialDefined': 'by_kind',
  'v1.MaterialFieldSet': 'fill_reference', 'v1.MaterialLocked': 'manage_reference', 'v1.StepQuestionSetLinked': 'manage_flows',
  'v1.KeyTermDefined': 'fill_reference', 'v1.KeyTermRenderingAdded': 'fill_reference', 'v1.KeyTermAdjusted': 'fill_reference',
  'v1.KeyTermLinked': 'fill_reference', 'v1.OrgCreated': 'bootstrap', 'v1.RoleDefined': 'manage_roles', 'v1.RoleRetired': 'manage_roles',
  'v1.OrgMemberAdded': 'invite_members', 'v1.OrgMemberRemoved': 'invite_members', 'v1.CatalogItemToggled': 'by_kind',
  'v1.ProjectRegistered': 'manage_structure', 'v1.InviteIssued': 'invite_members', 'v1.InviteRedeemed': null, 'v1.JoinDecided': 'invite_members'
};

describe('b: examples are valid and privileges did not move', () => {
  it.each(TYPES)('%s example passes validateEvent', (type) => {
    // Why: examples seed the permutation fixtures and the shape snapshot.
    // An invalid example would fold to nothing and prove nothing.
    expect(validateEvent(envelope(type, entryOf(type).example))).toBeNull();
  });

  it('EVENT_PRIVILEGE equals the pre-registry table for every type that existed then', () => {
    // Why: a privilege change silently widens or narrows who may write.
    // That is a security decision, never a refactor side effect.
    for (const [type, privilege] of Object.entries(PRE_REGISTRY_PRIVILEGE)) {
      expect(EVENT_PRIVILEGE[type as EventType], type).toBe(privilege);
    }
  });

  it.each(TYPES)('%s example resolves to the same concrete privilege as before', (type) => {
    const before = PRE_REGISTRY_PRIVILEGE[type];
    if (before === undefined) return; // added after the registry; SQL parity (d) pins it
    const example = envelope(type, entryOf(type).example);
    const kind = (entryOf(type).example as { kind?: string }).kind;
    const expected =
      type === 'v1.MaterialDefined' ? (kind === 'questions' ? 'fill_reference' : 'manage_reference')
        : type === 'v1.CatalogItemToggled' ? ({ reference: 'manage_reference', flow: 'manage_flows' } as Record<string, string>)[kind ?? ''] ?? 'manage_templates'
          : before;
    expect(privilegeFor(example)).toBe(expected);
  });
});

// ---- c: shipped shapes are frozen -------------------------------------------------

/** Field name (suffixed `?` when the validator lets it be absent) to JSON shape. */
type Fingerprint = Record<string, string>;
const SNAPSHOT = join(here, 'shipped-events.json');
// Existing entries only ever loosen to match SQL: reducer v8 marked role, kind,
// decision, parentUnitId and parentTakeId optional because SQL never required them.

/** A structural description of a JSON value: field names and JSON types, recursively. */
function shapeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return `array<${v.length ? shapeOf(v[0]) : 'empty'}>`;
  if (typeof v === 'object') {
    return `{${Object.keys(v as object).sort().map((k) => `${k}:${shapeOf((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return typeof v;
}

/**
 * Top-level fields of the example, each with its JSON shape and whether the
 * validator requires it (dropping it makes the example invalid). Examples
 * fill every optional field, so optional fields are listed too.
 */
function fingerprint(type: EventType): Fingerprint {
  const example = entryOf(type).example as Record<string, unknown>;
  const out: Fingerprint = {};
  for (const k of Object.keys(example).sort()) {
    const { [k]: _dropped, ...rest } = example;
    const required = validateEvent(envelope(type, rest)) !== null;
    out[required ? k : `${k}?`] = shapeOf(example[k]);
  }
  return out;
}

const V2_ADVICE =
  'Never change a shipped event (PLAN.md section 6, AGENTS.md). Restore it and add a new versioned event ' +
  '(e.g. v2.X) with its own registry entry, reducer case and SQL cases. If you only edited the example ' +
  'payload without changing the event, restore the example.';

describe('c: shipped event shapes never change', () => {
  const current = Object.fromEntries(TYPES.filter((t) => entryOf(t).shipped).map((t) => [t, fingerprint(t)]));
  // Recording a NEW shipped type: UPDATE_SHIPPED_EVENTS=1 npm test. Existing entries are never rewritten.
  if (process.env['UPDATE_SHIPPED_EVENTS'] === '1') {
    const saved: Record<string, Fingerprint> = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf8')) : {};
    for (const [t, f] of Object.entries(current)) saved[t] ??= f;
    writeFileSync(SNAPSHOT, `${JSON.stringify(saved, null, 2)}\n`);
  }
  const saved: Record<string, Fingerprint> = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));

  it('no shipped event type was removed or unshipped', () => {
    // Why: installed clients keep emitting and folding every shipped type.
    // Removing one breaks their sync and hides facts already in the log.
    for (const type of Object.keys(saved)) {
      const entry = registryEntry(type);
      expect(entry, `${type} was removed. ${V2_ADVICE}`).toBeDefined();
      expect(entry?.shipped, `${type} was marked unshipped. Shipped is permanent.`).toBe(true);
    }
  });

  it.each(Object.keys(current))('%s keeps its shipped shape', (type) => {
    // Why: old clients wrote this shape and the server accepted it. A new
    // required field or type turns their history invalid (invariants 1, 13).
    const before = saved[type];
    expect(before, `${type} is shipped but not recorded. Run UPDATE_SHIPPED_EVENTS=1 npm test and commit test/shipped-events.json.`).toBeDefined();
    expect(current[type], `${type} changed shape. ${V2_ADVICE}`).toEqual(before);
  });
});

// ---- d: SQL parity ---------------------------------------------------------------

/**
 * Reads supabase/migrations in filename order and replays the statements
 * that define validate_payload and event_privilege. Later migrations wrap
 * the function: `alter function X rename to X_pre_Y`, then `create function X`
 * that handles its types and calls X_pre_Y for the rest. So "the latest
 * definition" is a chain of bodies, outermost first.
 *
 * Limits (kept simple on purpose): it only understands `$$`-quoted bodies,
 * `alter function public.X(...) rename to Y`, quoted `'v1.X'` literals,
 * `like 'v1.Prefix%'`, `when 'v1.X' then '<priv>'|null|case`, and
 * `p_type in (...) then '<priv>'`. It proves every type is named by the
 * server and every flat privilege matches. It does not prove each SQL rule
 * equals the core rule; the rules sit side by side for review, and the
 * payload-dependent `case` privileges are pinned by test b.
 */
function sqlChain(root: string): string[] {
  const dir = join(here, '../../../supabase/migrations');
  const fns = new Map<string, string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8');
    const statements: { at: number; apply: () => void }[] = [];
    for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\([^)]*\)[\s\S]*?\$\$([\s\S]*?)\$\$/gi)) {
      statements.push({ at: m.index!, apply: () => fns.set(m[1]!, m[2]!) });
    }
    for (const m of sql.matchAll(/alter\s+function\s+public\.(\w+)\s*\([^)]*\)\s+rename\s+to\s+(\w+)/gi)) {
      statements.push({ at: m.index!, apply: () => { fns.set(m[2]!, fns.get(m[1]!) ?? ''); fns.delete(m[1]!); } });
    }
    for (const s of statements.sort((a, b) => a.at - b.at)) s.apply();
  }
  const chain: string[] = [];
  const seen = new Set<string>();
  const visit = (name: string) => {
    const body = fns.get(name);
    if (body === undefined || seen.has(name)) return;
    seen.add(name);
    chain.push(body);
    for (const m of body.matchAll(new RegExp(`public\\.(${root}\\w*)\\s*\\(`, 'g'))) visit(m[1]!);
  };
  visit(root);
  return chain;
}

/** Types SQL may name that core does not register. Document each one. None today. */
const SERVER_ONLY_SQL_TYPES: string[] = [];

function namedTypes(chain: string[]): { literals: Set<string>; prefixes: string[] } {
  const literals = new Set<string>();
  const prefixes: string[] = [];
  for (const body of chain) {
    for (const m of body.matchAll(/'(v\d+\.\w+)'/g)) literals.add(m[1]!);
    for (const m of body.matchAll(/like\s+'(v\d+\.\w*)%'/gi)) prefixes.push(m[1]!);
  }
  return { literals, prefixes };
}

describe('d: core and SQL know the same event types', () => {
  const validateChain = sqlChain('validate_payload');
  const privilegeChain = sqlChain('event_privilege');

  it('finds the wrapped chains (parser sanity)', () => {
    expect(validateChain.length).toBeGreaterThan(1);
    expect(privilegeChain.length).toBeGreaterThan(1);
  });

  it.each(TYPES)('%s is handled by SQL validate_payload', (type) => {
    // Why: invariant 11. A type the server does not validate enters the
    // permanent log unchecked, and core then drops what the server kept.
    const { literals, prefixes } = namedTypes(validateChain);
    expect(literals.has(type) || prefixes.some((p) => type.startsWith(p)), `${type} is missing from SQL validate_payload`).toBe(true);
  });

  it('SQL names no event type that core does not register', () => {
    // Why: a server-side type without a core entry has no core validator,
    // privilege or example, so clients cannot emit or check it the same way.
    for (const chain of [validateChain, privilegeChain]) {
      for (const t of namedTypes(chain).literals) {
        if (!SERVER_ONLY_SQL_TYPES.includes(t)) expect(registryEntry(t), `SQL names ${t}, which EVENT_REGISTRY lacks`).toBeDefined();
      }
    }
  });

  it('SQL event_privilege gives every type the same privilege as core', () => {
    // Why: the server authorizes, the client predicts. If they disagree the
    // UI offers actions the server refuses, or the server allows more than core says.
    const sql = new Map<string, string | null>();
    for (const body of privilegeChain) {
      const found: [string, string | null][] = [];
      for (const m of body.matchAll(/when\s+'(v\d+\.\w+)'\s+then\s+(?:'(\w+)'|(null)|(case))/gi)) {
        found.push([m[1]!, m[4] ? 'by_kind' : m[2] ?? null]);
      }
      for (const m of body.matchAll(/p_type\s+in\s*\(([^)]*)\)\s*then\s+'(\w+)'/gi)) {
        for (const t of m[1]!.matchAll(/'(v\d+\.\w+)'/g)) found.push([t[1]!, m[2]!]);
      }
      for (const [t, p] of found) if (!sql.has(t)) sql.set(t, p); // outer wrappers win
    }
    for (const type of TYPES) expect(sql.get(type) ?? null, type).toBe(EVENT_PRIVILEGE[type]);
  });
});

// ---- e: every registry type is folded order-independently and idempotently -------

describe('e: registry examples fold like every other fact', () => {
  const examples = buildRegistryExampleFixture();
  const stories = [...buildFixture(), ...buildStep11Fixture(), ...buildOrgFixture()];

  it('the example fixture has one valid event per registry type', () => {
    expect(examples.map((e) => e.type).sort()).toEqual([...TYPES].sort());
    expect(fold(examples, emptyState()).invalidEvents).toEqual({});
  });

  it('any permutation of examples and stories folds to the same state (invariant 2)', () => {
    const all = [...stories, ...examples];
    const canonical = fold(all, emptyState());
    for (let seed = 1; seed <= 50; seed++) expect(fold(shuffle(all, seed), emptyState())).toEqual(canonical);
  });

  it('applying the examples twice equals applying them once (invariant 3)', () => {
    const once = fold(examples, emptyState());
    expect(fold([...examples, ...shuffle(examples, 3)], emptyState())).toEqual(once);
  });
});

// ---- blob extraction agrees with the fold's blob work lists ----------------------

describe('registry blob hashes equal what referencedBlobs derives', () => {
  it.each(TYPES)('%s example alone', (type) => {
    // Why: upload and download work lists come from referencedBlobs. A
    // registry that named different blobs would mislead any caller using it.
    const event = envelope(type, entryOf(type).example);
    expect(eventBlobHashes(event).sort()).toEqual([...referencedBlobs(fold([event], emptyState())).keys()].sort());
  });

  it('across every fixture, skipping invalid and redacted events', () => {
    const all = [...buildFixture(), ...buildStep11Fixture(), ...buildOrgFixture(), ...buildRegistryExampleFixture()];
    const state = fold(all, emptyState());
    const live = all.filter((e) => !state.invalidEvents[e.id] && !state.redactions[e.id]);
    expect(new Set(live.flatMap(eventBlobHashes))).toEqual(new Set(referencedBlobs(state).keys()));
  });

  it('unfamiliar and malformed payloads reference nothing and never throw', () => {
    expect(eventBlobHashes({ type: 'v9.Future', payload: { blobHash: 'x' } })).toEqual([]);
    expect(eventBlobHashes({ type: 'v1.RecordingAdded', payload: { cards: [null, 3, { hash: 5 }] } })).toEqual([]);
    expect(eventBlobHashes({ type: 'v1.ResponseRecorded', payload: null })).toEqual([]);
  });
});

// ---- the parity gap this registry closed: core now refuses what SQL refuses --------

describe('core payload rules match SQL for the formerly unchecked types', () => {
  const bad: [EventType, Record<string, unknown>][] = [
    ['v1.WorkflowStepSet', { stepId: 's', order: 'a', role: 'boss', required: true }],
    ['v1.WorkflowStepSet', { stepId: 's', order: 'a', required: 'yes' }],
    ['v1.LaneFlowSelected', { laneId: 'L', flowId: 'f', catalogVersion: '1' }],
    ['v1.ResponseRecorded', { takeId: 't' }],
    ['v1.ReviewCommentRecorded', { takeId: 't', stepId: 's', blobHash: '' }],
    ['v1.MaterialDefined', { materialId: 'm', kind: 'tmf', title: 'T', scope: null }],
    ['v1.MaterialLocked', { materialId: 'm', locked: 'true' }],
    ['v1.KeyTermDefined', { termId: 't', laneId: 'L', term: 'x', gloss: 'g', unitScope: [1] }],
    ['v1.KeyTermAdjusted', { termId: 't', adjustmentId: 'a' }],
    ['v1.ReviewTeamMemberSet', { teamId: 't', profileId: 'p' }],
    ['v1.StepQuestionSetLinked', { stepId: 's' }],
    ['v1.RoleDefined', { roleId: 'r', name: 'R', privileges: ['fly'] }],
    ['v1.OrgMemberAdded', { profileId: 'p', roleId: 'r', scope: { level: 'lane', projectId: 'p1' } }],
    ['v1.CatalogItemToggled', { itemId: 'i', kind: 'flow', level: 'project', enabled: true }]
  ];
  it.each(bad)('%s refuses %j', (type, payload) => {
    expect(validateEvent(envelope(type, payload))).not.toBeNull();
  });

  it('absent enum fields pass, because SQL `p->>k not in (...)` is NULL for them', () => {
    // Why: the server accepted these. Refusing them in core would drop
    // history the log already holds (invariants 1 and 13).
    expect(validateEvent(envelope('v1.WorkflowStepSet', { stepId: 's', order: 'a', required: false }))).toBeNull();
    expect(validateEvent(envelope('v1.CatalogItemToggled', { itemId: 'i', enabled: true }))).toBeNull();
  });
});

// ---- core accepts what SQL accepts: rules that were stricter than the server -----

/**
 * Before reducer v8 these payloads passed SQL validate_payload (the server
 * kept them) but core refused them, so every client folded server history as
 * invalid. Each one must now validate, fold without throwing, and land in the
 * documented state. `hlc` orders them for the last-writer-wins cases.
 */
const accepted = (id: string, type: EventType, payload: Record<string, unknown>, wall = 9000): AnyEvent =>
  ({ id, type, orgId: 'org1', projectId: 'p1', actorId: 'lead', deviceId: 'dS', hlc: `${String(wall).padStart(15, '0')}:000000:dS`, payload }) as AnyEvent;

const SERVER_ACCEPTED: AnyEvent[] = [
  // SQL never checked these optional fields; core ran optStr on them.
  accepted('sa-ref', 'v1.ReferenceAttached', { unitId: 'u-sa', refId: 'r-sa', kind: 'overview_audio', blobHash: 5, text: { rich: true } }),
  accepted('sa-review-comment', 'v1.ReviewSubmitted', { takeId: 't-sa', stepId: 's-sa', decision: 'approve', comment: 7 }),
  accepted('sa-assign-due', 'v1.AssignmentMade', { unitId: 'u-sa', laneId: 'L-sa', profileId: 'p-sa', role: 'translator', dueDate: 3, instructions: null }),
  accepted('sa-redact', 'v1.Redacted', { eventId: 'sa-never-applied', reason: 3 }),
  accepted('sa-invalidate', 'v1.BlobInvalidated', { hash: 'c'.repeat(64), reason: null }),
  // SQL `p->>'k' not in (...)` and `_is_role(NULL)` let an absent enum through.
  accepted('sa-member', 'v1.MemberAdded', { profileId: 'p-norole' }),
  accepted('sa-member-change', 'v1.MemberRoleChanged', { profileId: 'p-nullrole', role: null }),
  accepted('sa-assign-norole', 'v1.AssignmentMade', { unitId: 'u-sa', laneId: 'L-sa', profileId: 'p-sa2' }),
  accepted('sa-rec', 'v1.RecordingAdded', { recordingId: 'rec-sa', unitId: 'u-sa', laneId: 'L-sa', cards: [{ hash: 'd'.repeat(64), durationMs: 10 }] }),
  accepted('sa-review-nodecision', 'v1.ReviewSubmitted', { takeId: 't-sa2', stepId: 's-sa' }),
  // SQL `jsonb_typeof(p->'k') not in ('null', 'string')` lets an absent parent through.
  accepted('sa-unit', 'v1.UnitAdded', { unitId: 'u-sa', kind: 'passage', label: 'SA 1', order: 'z9' }),
  accepted('sa-take', 'v1.TakeComposed', { takeId: 't-sa3', unitId: 'u-sa', laneId: 'L-sa', cardHashes: ['d'.repeat(64)] }),
  // SQL trim() strips spaces only, SQL length() counts characters, and SQL
  // checks ids of written drafts as non-empty only.
  accepted('sa-text', 'v1.TextTranslationCreated', { translationId: 'tt-sa', unitId: ' ', laneId: 'L-sa', parentTranslationId: null, text: '\t', origin: 'written' }),
  accepted('sa-meta', 'v1.TakeMetadataSet', { takeId: 't-sa3', unitId: 'u-sa', laneId: 'L-sa', name: '🙂'.repeat(150), milestones: [] }),
  accepted('sa-bible', 'v1.BibleSettingsSet', { laneId: '\n', density: 10, sourceId: 'bsb' }),
  accepted('sa-obt', 'v1.ObtWorkspaceCreated', { unitId: 'u-sa', laneId: 'L-sa', inputTakeId: 't-sa3', language: '\n' })
];

describe('core accepts every payload SQL validate_payload accepted', () => {
  it.each(SERVER_ACCEPTED.map((e) => [e.id, e] as const))('%s validates', (_id, event) => {
    // Why: invariants 1, 11 and 13. The server kept this event; core must fold it.
    expect(validateEvent(event)).toBeNull();
  });

  it('SQL refusals that sit next to the loosened rules still refuse', () => {
    // Why: loosening must not turn into accepting anything. These are the SQL rules themselves.
    expect(validateEvent(accepted('r1', 'v1.MemberAdded', { profileId: 'p', role: 'boss' }))).not.toBeNull();
    expect(validateEvent(accepted('r2', 'v1.RecordingAdded', { recordingId: 'r', unitId: 'u', laneId: 'L', kind: 'both', cards: [] }))).not.toBeNull();
    expect(validateEvent(accepted('r3', 'v1.ReviewSubmitted', { takeId: 't', stepId: 's', decision: 'maybe' }))).not.toBeNull();
    expect(validateEvent(accepted('r4', 'v1.UnitAdded', { unitId: 'u', kind: 'k', label: 'l', order: 'o', parentUnitId: 5 }))).not.toBeNull();
    expect(validateEvent(accepted('r5', 'v1.InviteIssued', { inviteId: 'i', roleId: 'r', expiresAt: 'x', scope: 'org' }))).not.toBeNull();
    expect(validateEvent(accepted('r6', 'v1.TakeMetadataSet', { takeId: 't', unitId: 'u', laneId: 'L', name: '🙂'.repeat(201), milestones: [] }))).not.toBeNull();
    expect(validateEvent(accepted('r7', 'v1.TakeMetadataSet', { takeId: 't', unitId: 'u', laneId: 'L', name: '   ', milestones: [] }))).not.toBeNull();
    expect(validateEvent(accepted('r8', 'v1.TextTranslationCreated', { translationId: 't', unitId: 'u', laneId: 'L', parentTranslationId: null, text: '  ', origin: 'written' }))).not.toBeNull();
  });

  it('folds to the documented state and never lets an odd value into derived state', () => {
    const state = fold(SERVER_ACCEPTED, emptyState());
    expect(state.invalidEvents).toEqual({});
    // Non-string optional text is dropped, never stored as a blob hash or a label.
    expect(state.references['r-sa']).toEqual({ unitId: 'u-sa', kind: 'overview_audio' });
    expect(state.reviews['t-sa']?.['s-sa']?.['lead']?.value).toEqual({ decision: 'approve', hlc: expect.any(String) });
    const assignment = Object.values(state.assignments).find((a) => a.profileId === 'p-sa')!;
    expect(assignment).not.toHaveProperty('dueDate');
    expect(assignment).not.toHaveProperty('instructions');
    expect(state.redactions['sa-never-applied']).toBe(true);
    expect(state.blobs['c'.repeat(64)]?.stored).toBe(false);
    // The server stores a NULL role, which grants nothing: core uses the least role.
    expect(state.members['p-norole']?.role.value).toBe('viewer');
    expect(state.members['p-norole']?.removed.value).toBe(false);
    expect(state.members['p-nullrole']?.role.value).toBe('viewer');
    // Meaningless for the fold: no role to queue by, no decision to count. Ignored.
    expect(Object.values(state.assignments).some((a) => a.profileId === 'p-sa2')).toBe(false);
    expect(state.reviews['t-sa2']).toBeUndefined();
    // A kindless recording is kept (its audio stays referenced) but is neither source nor target.
    expect(state.recordings['rec-sa']).not.toHaveProperty('kind');
    expect(referencedBlobs(state).has('d'.repeat(64))).toBe(true);
    expect(state.units['u-sa']?.parentUnitId).toBeNull();
    expect(state.takes['t-sa3']?.parentTakeId).toBeNull();
  });

  it('the member role stays last-writer-wins whichever way the role-less event lands', () => {
    // Why: invariant 2. A role-less event is a real write in the server's
    // membership fold, so it must compete by clock, not be skipped.
    const before = accepted('m1', 'v1.MemberAdded', { profileId: 'p', role: 'translator' }, 100);
    const after = accepted('m2', 'v1.MemberRoleChanged', { profileId: 'p' }, 200);
    expect(fold([before, after], emptyState()).members['p']?.role.value).toBe('viewer');
    expect(fold([after, before], emptyState()).members['p']?.role.value).toBe('viewer');
    const later = accepted('m3', 'v1.MemberRoleChanged', { profileId: 'p', role: 'reviewer' }, 300);
    expect(fold([later, after, before], emptyState()).members['p']?.role.value).toBe('reviewer');
  });

  it('an invite whose scope is an object but not a membership scope is kept raw and ignored by the org fold', () => {
    const invite = accepted('inv', 'v1.InviteIssued', { inviteId: 'i-sa', roleId: 'r', expiresAt: '2999-01-01T00:00:00Z', scope: { level: 'lane', projectId: 'p1' } });
    expect(validateEvent(invite)).toBeNull();
    const org = foldOrg([invite]);
    expect(org.invalidEvents).toEqual({});
    expect(org.invites['i-sa']).toBeUndefined();
  });

  it('derived views over the folded state do not throw', () => {
    // Why: invariant 11 covers what the app reads, not just the fold.
    const all = [...buildFixture(), ...SERVER_ACCEPTED];
    const state = fold(all, emptyState());
    const idx = buildIndexes(state);
    expect(() => {
      for (const key of passageKeys(state, idx)) passageRow(state, key.unitId, key.laneId, idx);
      passageRow(state, 'u-sa', 'L-sa', idx);
      for (const actor of ['lead', 't1', 'r1', 'p-norole', 'p-nullrole']) deriveInbox(state, actor, idx);
      referencedBlobs(state);
    }).not.toThrow();
  });

  it('any permutation, with the stories and registry examples, folds to one state (invariants 2 and 3)', () => {
    const all = [...buildFixture(), ...buildStep11Fixture(), ...buildRegistryExampleFixture(), ...SERVER_ACCEPTED];
    const canonical = fold(all, emptyState());
    for (let seed = 1; seed <= 50; seed++) expect(fold(shuffle(all, seed), emptyState())).toEqual(canonical);
    expect(fold([...all, ...shuffle(SERVER_ACCEPTED, 7)], emptyState())).toEqual(canonical);
  });

  it('commands stay stricter than the server for whitespace-only user text', () => {
    // Why: the server accepts "\t" as text, but a person typing only
    // whitespace has not written a draft. The door and the command differ on purpose.
    expect(() => createTextTranslation(emptyState(), 'c1', {
      translationId: 'x', unitId: 'u', laneId: 'L', parentTranslationId: null, text: '\n\t', origin: 'written'
    })).toThrow('text is required');
  });
});
