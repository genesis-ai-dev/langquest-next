/**
 * SQL that holds the server's validate_payload, privilege table and
 * language-of-event rule to core's, for every event type in the fixtures
 * (both streams) plus broken variants of each (every field missing,
 * wrong-typed or null, and the edge cases each type has). The fitness
 * function for invariant 11; `npm run db:test` runs it.
 */
import { writeFileSync } from 'node:fs';
import {
  EVENT_PAYLOAD_MAX_BYTES, EVENT_PRIVILEGE, LIBRARY_EVENT_TYPES, MANAGE_PRIVILEGES, ORG_EVENT_TYPES, PRIVILEGES, emptyOrgState, entityKeyOf, eventSizeError, idAuthor, jsonbTextBytes, languageOfOrgEvent, mayReadLanguage, mayWriteFiles, privilegeAllows, privilegeFor, privilegesOfFixedRole, validateEvent, type AnyEvent, type OrgState, type Privilege, type Role
} from '@langquest-next/core';
import { base64urlDecode, filesNamedBy, isServerEventId } from '@langquest-next/core/nearby';
import { buildFixture, buildOrgFixture, buildRecordFixture, buildStep11Fixture } from '../packages/core/test/fixtures';
import { GENERATIONS, NEWCOMER_ID, NEWCOMER_SALT, PUBLIC_KEY } from '../packages/core/test/nearbyVectors';

const sql = (v: unknown) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;

// A few of each type is enough; the variants below do the rest.
const perType = new Map<string, number>();
const events = [...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture(), ...buildOrgFixture()].filter((e) => {
  const n = perType.get(e.type) ?? 0;
  perType.set(e.type, n + 1);
  return n < 3;
});
for (const type of Object.keys(EVENT_PRIVILEGE)) {
  if (!perType.has(type)) throw new Error(`no fixture event of type ${type}: add one to packages/core/test/fixtures.ts`);
}

// Optional fields each payload may carry, so a wrong type is tried even when
// the fixture leaves the field out.
const OPTIONAL: Partial<Record<string, string[]>> = {
  'v1.ReviewKindDefined': ['description', 'usualReviewer', 'withholdsContext', 'produces'],
  'v1.ReviewRecorded': ['comment', 'commentBlobHash', 'answers', 'skipped', 'people', 'place', 'givenBy', 'requestId', 'artifacts'],
  'v1.DepartureRecorded': ['kindId', 'stepId', 'reviewId', 'reasonBlobHash'],
  'v1.RequestMade': ['kindId', 'profileId', 'guest', 'teamId', 'dueDate', 'note', 'noteBlobHash', 'questions'],
  'v1.NoteAdded': ['text', 'blobHash', 'photoHash', 'onTakeId', 'kindId'],
  'v1.LibraryItemDefined': ['copiedFrom'],
  'v1.LibraryVersionPublished': ['note'],
  'v1.TemplateSelected': ['books'],
  'v1.FlowSelected': ['itemId', 'docHash', 'name'],
  'v1.CheckHelpSet': ['itemId', 'materialId'],
  'v1.ReferencesUsed': ['takeId', 'reviewId'],
  'v1.TakeSubmitted': ['questionSetIds'],
  'v1.ResponseRecorded': ['note', 'blobHash'],
  'v1.CardVerseSet': ['from', 'to'],
  'v1.CardCleanUpSet': ['cleanedHash', 'cleanedFormat', 'tool', 'limitDb'],
  'v1.MaterialDefined': ['templateRef'],
  'v1.MaterialFieldSet': ['text', 'blobHash'],
  'v1.KeyTermAudioRenderingAdded': ['duringTakeId'],
  'v1.KeyTermAdjusted': ['blobHash', 'duringTakeId'],
  'v1.KeyTermLinked': ['note', 'adjustmentId'],
  'v1.Redacted': ['reason'],
  'v1.BlobInvalidated': ['reason']
};
const HASH = 'a'.repeat(64);
const GUEST = { name: 'n', channel: 'sms', contact: 'c' };
const SCOPED = new Set(['v1.MemberAdded', 'v1.MemberRemoved', 'v1.InviteIssued']);

const broken: AnyEvent[] = events.flatMap((e) => {
  const p = e.payload as Record<string, unknown>;
  const variants: Record<string, unknown>[] = [];
  // Every field missing, then every field (present or optional) as a number and as null.
  for (const k of Object.keys(p)) { const { [k]: _, ...rest } = p; variants.push(rest); }
  for (const k of new Set([...Object.keys(p), ...(OPTIONAL[e.type] ?? [])])) {
    variants.push({ ...p, [k]: 5 }, { ...p, [k]: null }, { ...p, [k]: '' });
  }
  // A name every object has, as each string field and as a key (decisions.md 113).
  for (const k of Object.keys(p)) if (typeof p[k] === 'string') variants.push({ ...p, [k]: '__proto__' }, { ...p, [k]: 'constructor' });
  variants.push({ ...p, extra: JSON.parse('{"__proto__": {"toString": 1}}') as unknown }, { ...p, extra: [['valueOf']] });
  if ('outcome' in p) variants.push({ ...p, outcome: 'approve' });
  if ('type' in p) variants.push({ ...p, type: 'ignore' });
  if ('anchor' in p) {
    const anchor = p['anchor'] as Record<string, unknown>;
    variants.push({ ...p, anchor: { kind: 'page' } }, { ...p, anchor: { kind: 5 } }, { ...p, anchor: [] });
    for (const kind of ['version', 'verse', 'study', 'term']) variants.push({ ...p, anchor: { kind } });
    for (const k of Object.keys(anchor)) { const { [k]: _, ...rest } = anchor; variants.push({ ...p, anchor: rest }); }
  }
  if (SCOPED.has(e.type)) {
    for (const scope of [{ level: 'team' }, { level: 'language' }, { level: 'language', languageId: '' }, { level: 'org', languageId: 'x' },
      { level: 'language', languageId: 'x', teamId: 'y' }, { level: 'language', languageId: 5 }, [], 'org']) variants.push({ ...p, scope });
  }
  switch (e.type) {
    case 'v1.ReviewRecorded':
      variants.push({ ...p, outcome: 'recorded', artifacts: [] }, { ...p, artifacts: [{ hash: 'x' }] }, { ...p, artifacts: ['x'] },
        { ...p, people: -1 }, { ...p, answers: { q: 5 } }, { ...p, answers: [] }, { ...p, via: 'email' },
        ...[0, 4200, -1, 1.5, '3', null].map((atMs) => ({ ...p, artifacts: [{ hash: 'x', durationMs: 900, format: 'm4a', atMs }] })));
      break;
    case 'v1.RecordingAdded':
      variants.push({ ...p, cards: [{ hash: '', durationMs: 1 }] }, { ...p, cards: [{ hash: 'x', durationMs: '1' }] }, { ...p, cards: {} });
      break;
    case 'v1.RoleDefined':
      variants.push({ ...p, privileges: ['fly'] }, { ...p, privileges: 'translate' }, { ...p, privileges: [] });
      break;
    case 'v1.LanguageAdded':
      for (const languageId of ['_org', 'a b', '-x', 'a/b', 'x'.repeat(82)]) variants.push({ ...p, languageId });
      break;
    case 'v1.LanguageCountrySet':
      variants.push({ ...p, country: 'ss' }, { ...p, country: 'SSD' });
      break;
    case 'v1.ClusterNamed':
    case 'v1.LanguageClusterSet':
      for (const clusterId of ['a b', '-x', 'a/b', 'x'.repeat(81), 'x'.repeat(82), 'Dinka_cluster-2']) variants.push({ ...p, clusterId });
      break;
    case 'v1.LanguageCodeSet':
      variants.push({ ...p, languoidId: 'nyan1308' }, { ...p, languoidId: '' }, { ...p, languoidId: 5 }, { ...p, code: '' },
        { ...p, code: 'x'.repeat(41) }, { ...p, code: 'x'.repeat(40) }, { ...p, languoidId: '5870452D-7878-4328-916D-F4FECC0B79F2' });
      break;
    case 'v1.LanguageTargetSet':
      variants.push({ ...p, scope: 'psalms' }, { ...p, startDate: '2026-1-1' }, { ...p, targetDate: p['startDate'] },
        { ...p, startDate: '2027-01-01', targetDate: '2026-01-01' }, { ...p, targetDate: 'soon' });
      break;
    case 'v1.ReferenceSet':
      variants.push({ ...p, state: 'pinned' });
      break;
    case 'v1.ReferenceLanguageAdded':
      variants.push({ ...p, language: '' }, { ...p, language: 'Greek' }, { ...p, language: 'x' }, { ...p, added: 'yes' });
      break;
    case 'v1.ReferenceLanguageSet':
      variants.push({ ...p, language: '' }, { ...p, language: 'French' }, { ...p, language: 'x' }, { ...p, language: 'x'.repeat(41) }, { ...p, language: 7 });
      break;
    case 'v1.ReviewTeamKindSet':
      variants.push({ ...p, kindId: ['peer'] });
      break;
    case 'v1.FlowStepLinksSet':
      variants.push({ ...p, allowed: 'yes' }, { ...p, stepId: '' });
      break;
    case 'v1.CheckHelpSet':
      variants.push({ ...p, itemId: 'x', materialId: 'y' }, { kindId: p['kindId'], linked: true }, { ...p, materialId: '' }, { ...p, itemId: '' }, { ...p, kindId: '' });
      break;
    case 'v1.CheckShowsSet':
      variants.push({ ...p, what: 'bible' }, { ...p, what: 'BibleText' }, { ...p, shown: 'no' }, { ...p, kindId: '' },
        { ...p, what: 'notes', from: 'peer' }, { ...p, what: 'earlier', from: '' }, { ...p, what: 'bibleText', from: 'peer' }, { ...p, what: 'notes', from: 7 });
      break;
    case 'v1.BookNameSet':
      variants.push({ ...p, book: 'luk' }, { ...p, book: 'LUKE' }, { ...p, book: '1 SA' });
      break;
    case 'v1.BookNamesSelected':
      variants.push({ ...p, names: { luk: 'Luka' } }, { ...p, names: { LUK: '' } }, { ...p, names: { LUK: 7 } }, { ...p, names: [] }, { ...p, names: 'Luka' },
        { ...p, names: {} }, { ...p, language: 'Nepali' }, { ...p, language: '' }, { ...p, docHash: 'x' }, { ...p, itemId: '' });
      break;
    case 'v1.CardCleanUpSet': {
      const file = { cleanedHash: 'x', cleanedFormat: 'm4a' };
      for (const use of ['cleaned', 'original', 'none', 'kept']) variants.push({ unitId: p['unitId'], hash: p['hash'], use }, { unitId: p['unitId'], hash: p['hash'], use, tool: 'dfn3' },
        { unitId: p['unitId'], hash: p['hash'], use, ...file }, { unitId: p['unitId'], hash: p['hash'], use, tool: 'dfn3', ...file });
      variants.push({ ...p, use: 'cleaned', cleanedHash: p['hash'], cleanedFormat: 'wav', tool: 'dfn3' }, { ...p, use: 'cleaned', cleanedHash: 'x', cleanedFormat: 'mp3', tool: 'dfn3' },
        { ...p, use: 'none', cleanedHash: 'x' }, { ...p, use: 'none', cleanedFormat: 'wav' }, { ...p, use: 'none', limitDb: 12 });
      for (const limitDb of [0, -1, 12, 12.5, 100, 100.5, '12', Infinity]) variants.push({ ...p, use: 'original', tool: 'dfn3', limitDb }, { ...p, use: 'cleaned', cleanedHash: 'x', cleanedFormat: 'wav', tool: 'dfn3', limitDb });
      break;
    }
    case 'v1.KeyTermAudioRenderingAdded':
      for (const durationMs of [0, -1, 1, 900.5, 30000, 30001, '900', null, Infinity]) variants.push({ ...p, durationMs });
      variants.push({ ...p, blobHash: '' }, { ...p, renderingId: '' }, { ...p, termId: 7 }, { ...p, wayId: 'way:x' }, { ...p, wayId: '' }, { ...p, wayId: 7 }, { ...p, duringTakeId: 'take1' }, { ...p, duringTakeId: '' }, { ...p, duringTakeId: 7 });
      break;
    case 'v1.VersionReleased':
      variants.push({ ...p, live: 1 }, { ...p, channel: '' }, { ...p, channel: 'x'.repeat(61) }, { ...p, channel: '🎧'.repeat(60) }, { ...p, url: '' }, { ...p, url: ' ' });
      break;
    case 'v1.ExternalValueSet':
      for (const key of ['/a', 'a/', 'a//b', 'a b', 'a?b', 'a%b', '.', '..', 'a/./b', 'a/../b', '...', 'a.b/c~d:e@f+g-h_i', 'x'.repeat(256), 'x'.repeat(257), 'é', '🎧']) {
        variants.push({ ...p, key });
      }
      variants.push({ ...p, data: [] }, { ...p, data: [1] }, { ...p, data: true }, { ...p, data: {} }, { ...p, data: { nested: { deep: [1, null] } } });
      break;
    case 'v1.UnitAdded':
    case 'v1.TakeComposed':
      variants.push({ ...p, parentUnitId: 'x', parentTakeId: 'x' });
      break;
    case 'v1.FlowSelected':
      for (const flowId of ['a/b', 'a@b', 'a b']) variants.push({ ...p, flowId });
      variants.push({ ...p, docHash: 'abc' }, { ...p, docHash: HASH });
      break;
    case 'v1.MaterialDefined':
      variants.push({ ...p, scope: { teamId: 'x' } }, { ...p, scope: { unitId: '' } }, { ...p, scope: [] }, { ...p, scope: { unitId: 5 } },
        { ...p, scope: { unitId: 'u', stepId: 's' } });
      break;
    case 'v1.ReferencesUsed': {
      const item = (p['items'] as Record<string, unknown>[])[0]!;
      variants.push({ ...p, items: [] }, { ...p, items: 'x' }, { ...p, items: [5] }, { ...p, takeId: 't', reviewId: 'r' },
        { ...p, items: Array.from({ length: 201 }, () => item) });
      for (const k of Object.keys(item)) {
        const { [k]: _, ...rest } = item;
        variants.push({ ...p, items: [rest] }, { ...p, items: [{ ...item, [k]: 5 }] });
      }
      for (const k of ['docHash', 'ref', 'detail', 'copyright']) variants.push({ ...p, items: [{ ...item, [k]: 5 }] });
      variants.push({ ...p, items: [{ ...item, kind: 'video' }] }, { ...p, items: [{ ...item, opened: 'yes' }] }, { ...p, items: [{ ...item, itemId: '' }] });
      break;
    }
    case 'v1.RequestMade': {
      // Exactly one addressee: a person, a guest or a team.
      const { profileId: _a, guest: _b, teamId: _c, ...none } = p;
      variants.push(none, { ...none, profileId: 'r1' }, { ...none, guest: GUEST }, { ...none, teamId: 't1' },
        { ...none, profileId: 'r1', teamId: 't1' }, { ...none, profileId: 'r1', guest: GUEST }, { ...none, teamId: 't1', guest: GUEST },
        { ...none, profileId: 'r1', teamId: '' }, { ...none, teamId: 't1', what: 'review' });
      variants.push({ ...p, questions: [{ id: 'q', text: 't', type: 'yesno', required: 'yes' }] }, { ...p, questions: [{ id: 'q', text: 't', type: 'essay' }] },
        { ...p, questions: [{ id: 'q', text: 't', type: 'text' }] }, { ...none, guest: { name: 'n', channel: 'email', contact: 'c' } });
      break;
    }
    case 'v1.LicenseSet':
      for (const bad of ['MIT', 'cc0-1.0', 'CC-BY-ND-4.0', 'All rights reserved', ['CC0-1.0'], true]) variants.push({ ...p, license: bad });
      break;
    case 'v1.LibraryItemDefined': {
      const from: Record<string, unknown> = { orgId: 'o', orgName: 'O', itemId: 'i', docHash: HASH };
      variants.push({ ...p, copiedFrom: from }, { ...p, copiedFrom: 'o' }, { ...p, copiedFrom: [from] });
      for (const k of Object.keys(from)) {
        const { [k]: _, ...rest } = from;
        variants.push({ ...p, copiedFrom: rest }, { ...p, copiedFrom: { ...from, [k]: '' } }, { ...p, copiedFrom: { ...from, [k]: 5 } });
      }
      variants.push({ ...p, copiedFrom: { ...from, docHash: 'abc' } });
      break;
    }
    case 'v1.TemplateSelected': {
      variants.push({ ...p, books: [] }, { ...p, books: ['GEN', '1SA'] }, { ...p, books: ['GEN', 'gen'] }, { ...p, books: ['GENE'] },
        { ...p, books: [5] }, { ...p, books: 'GEN' }, { ...p, books: ['GEN', null] }, { ...p, unitPrefix: 'a b' }, { ...p, unitPrefix: 'a/b' });
      const { books: _, ...rest } = p;
      variants.push(rest);
      break;
    }
  }
  if ((LIBRARY_EVENT_TYPES as readonly string[]).includes(e.type) || e.type === 'v1.TemplateSelected') {
    for (const k of ['itemId', 'docHash']) {
      if (!(k in p)) continue;
      for (const bad of ['a/b', 'a@b', 'a b', '-a', 'A'.repeat(64), 'a'.repeat(63), 'x'.repeat(122)]) variants.push({ ...p, [k]: bad });
    }
    if ('kind' in p) variants.push({ ...p, kind: 'song' }, { ...p, kind: 'Template' });
    if ('description' in p) variants.push({ ...p, description: '' });
  }
  return variants.map((payload) => ({ ...e, payload }) as AnyEvent);
});
const rows = [...events, ...broken].map((e) => ({ type: e.type, payload: e.payload, valid: validateEvent(e) === null }));

const roles: Role[] = ['owner', 'coordinator', 'translator', 'reviewer', 'viewer'];
// Events whose privilege depends on the payload: try each value that matters.
const withKinds = events.flatMap((e): AnyEvent[] => {
  if ((LIBRARY_EVENT_TYPES as readonly string[]).includes(e.type)) {
    return ['template', 'flow', 'material', 'versification', 'names', 'labels', 'song'].map((kind) => ({ ...e, payload: { ...e.payload, kind } }) as AnyEvent);
  }
  if (e.type === 'v1.MaterialDefined') return ['questions', 'tmf'].map((kind) => ({ ...e, payload: { ...e.payload, kind } }) as AnyEvent);
  if (e.type === 'v1.ReviewRecorded') return ['app', 'link', 'logged'].map((via) => ({ ...e, payload: { ...e.payload, via } }) as AnyEvent);
  if (e.type === 'v1.DepartureRecorded') return ['skip', 'override', 'keep'].map((type) => ({ ...e, payload: { ...e.payload, type } }) as AnyEvent);
  return [e];
});
const perms = withKinds.flatMap((e) => roles.map((role) => ({ role, type: e.type, payload: e.payload, allowed: privilegeAllows(privilegeFor(e), privilegesOfFixedRole(role)) })));
// Each privilege alone, so two that every fixed role holds together are still told apart.
const single = withKinds.flatMap((e) => PRIVILEGES.map((priv) => ({ priv, type: e.type, payload: e.payload, allowed: privilegeAllows(privilegeFor(e), new Set([priv])) })));
// The language an organization-stream event is authorized against.
const scopedLanguage = [...events, ...broken.filter((e) => SCOPED.has(e.type) && validateEvent(e) === null)]
  .map((e) => ({ type: e.type, payload: e.payload, language: languageOfOrgEvent(e) ?? null }));

// The entity a creating event names (one event per entity in a stream, decisions.md 75).
const entities = events.map((e) => ({ type: e.type, payload: e.payload, key: entityKeyOf(e) }));

// Ids only the server makes: every prefix, near misses of each, and `api-`.
const SERVER_ID_PREFIXES = ['invite', 'invitemember', 'inviteredeem', 'invitecheck', 'joindecided', 'joinmember', 'removed', 'accountdeleted', 'blob', 'blobinvalid', 'pin', 'seed', 'timings', 'v2'];
const serverIds = [
  ...SERVER_ID_PREFIXES.flatMap((p) => [`${p}:x`, `${p}:`, p, `${p}x:y`, `x${p}:y`, ` ${p}:y`, `${p.toUpperCase()}:y`]),
  'api-', 'api-x', 'api', 'api:x', 'API-x', ' api-x', 'xapi-x', 'e1', '', 'by:a:b:0', 'take:by:a:b'
].map((id) => ({ id, server: isServerEventId(id) }));

// Whose id this is (docs/nearby-sync-plan.md 5.4, Bound ids): bound ids with terms in front,
// entity keys, keys under a key term, near misses of each, and every fixture's ids and keys.
const UUID = '5870452d-7878-4328-916d-f4fecc0b79f2';
const authorIds = [...new Set([
  `by:${UUID}:r1:0`, `by:${UUID}:r1`, 'by:a:b:0', 'by:a:b', 'by:a', 'by:a:', 'by::b', 'by:', 'by', 'by:by:a:', 'by:a:by:b:c',
  'take:by:a:b', 'take:take:by:a:b', 'note:by:a:n', 'review:review:by:a:r', 'audioformat:by:a:x', 'a:b:c:by:z:q',
  'xby:a:b', 'Take:by:a:b', 'take1:by:a:b', 'BY:a:b', ' by:a:b', 'by :a:b', 'take-by:a:b', 'take:x1:by:a:b',
  'rendering:t/by:b:r', 'rendering:by:t:x/by:b:r', 'rendering:by:t:x/r', 'rendering:t/r', 'rendering:by:x', 'rendering:by:x:y',
  'adjustment:term/by:c:1', 'adjustment:by:a:t/by:a:x:y/z', 'rendering:t/rendering:u/by:d:e', 'rendering:/by:e:f',
  'take:by:🎧:x', 'by:é:x', 'by:a\nb:c', `${UUID}:3`, 'e1', '', 'api-x', 'invite:x',
  ...events.flatMap((e) => [e.id, entityKeyOf(e) ?? '']),
  ...events.flatMap((e) => { const k = entityKeyOf(e); return k ? [k.replace(/:/, `:by:${UUID}:`)] : []; })
])].map((id) => ({ id, author: idAuthor(id) }));
if (!authorIds.some((r) => r.author === UUID) || !authorIds.some((r) => r.author === null)) throw new Error('the id author cases must name someone and no one');

// The files an event names (docs/nearby-sync-plan.md section 6, Files): every valid fixture and
// variant, as sorted `hash:format` rows, a voice note's format left to the log (null).
const namedFiles = [...events, ...broken.filter((e) => validateEvent(e) === null)]
  .map((e) => ({ type: e.type, payload: e.payload, files: filesNamedBy(e).map((f) => `${f.hash}:${f.format ?? ''}`).sort() }));
if (!namedFiles.some((r) => r.files.some((f) => f.endsWith(':'))) || !namedFiles.some((r) => r.files.some((f) => f.endsWith(':wav')))) {
  throw new Error('the named-file cases must hold a voice note and a card: add one to packages/core/test/fixtures.ts');
}

// Generations of a discovery key (5.12, Generations): the golden vector from its newest down.
const hex = (b64url: string) => Buffer.from(base64urlDecode(b64url)!).toString('hex');
const generations = GENERATIONS.map((key, steps) => ({ steps, key: hex(key) }));

// Joining offline (14.1): what a pass may never grant, and a newcomer's id from their key and salt, as
// core's golden vector has it, with a key and a salt that are not canonical base64url giving none.
const managePrivileges = [...MANAGE_PRIVILEGES].sort();
const newcomerIds = [
  { key: PUBLIC_KEY, salt: NEWCOMER_SALT, id: NEWCOMER_ID },
  { key: `${PUBLIC_KEY.slice(0, 42)}x`, salt: NEWCOMER_SALT, id: null },
  { key: PUBLIC_KEY, salt: `${NEWCOMER_SALT.slice(0, 21)}x`, id: null },
  { key: PUBLIC_KEY.slice(0, 42), salt: NEWCOMER_SALT, id: null }
];

// How big an event may be (decisions.md 115): each fixture, and payloads on
// either side of the limit, of text, of many small numbers (a space after
// every comma) and of nested objects (one after every colon too).
const room = (shape: (n: number) => unknown, base = shape(0)) => EVENT_PAYLOAD_MAX_BYTES - jsonbTextBytes(base);
const near = [
  (n: number) => ({ text: 'x'.repeat(n) }),
  (n: number) => ({ text: 'é'.repeat(Math.floor(n / 2)) }),
  (n: number) => ({ nums: Array.from({ length: Math.floor(n / 3) }, () => 1) }),
  (n: number) => ({ objs: Array.from({ length: Math.floor(n / 9) }, () => ({ a: 1 })) })
].flatMap((shape) => {
  const r = room(shape);
  return [-6, -3, 0, 3, 6, 30].map((d) => shape(r + d));
});
const sizes = [...events, ...near.map((payload) => ({ ...events[0]!, payload }) as AnyEvent),
  { ...events[0]!, deviceId: 'd'.repeat(256) }, { ...events[0]!, deviceId: 'd'.repeat(257) }]
  .map((e) => ({ ev: e, ok: eventSizeError(e) === null }));

// Who may read a language's work and write its files (the second rule beside
// mayViewLanguage, which asks view_status): organizations built both as core's
// OrgState and as the rows the server keeps, for every role, scope and
// removal, then asked of `_can_read_stream_at` (not a Global Viewer, aal1) and
// of `blob_access` (writing).
const ACCESS_ORG = 'parity-access';
const reg = <T>(value: T) => ({ value, hlc: '1', eventId: 'e' });
const accessRoles: { id: string; privileges: Privilege[]; retired: boolean }[] = [
  ...PRIVILEGES.map((p) => ({ id: `only_${p}`, privileges: [p], retired: false })),
  { id: 'translate_view', privileges: ['translate', 'view_status'], retired: false },
  { id: 'template_view', privileges: ['manage_templates', 'view_status'], retired: false },
  { id: 'retired_owner', privileges: ['manage_roles', 'translate'], retired: true },
  { id: 'nothing', privileges: [], retired: false }
];
const accessLanguages = [{ id: 'L1', listed: true }, { id: 'L2', listed: false }];
const accessStreams = ['_org', 'L1', 'L2', 'L3'];
interface AccessMember { profile: string; scope: 'org' | string; roleId: string; removed: boolean }
const accessMembers: AccessMember[] = accessRoles.flatMap((r): AccessMember[] => [
  { profile: `org:${r.id}`, scope: 'org', roleId: r.id, removed: false },
  { profile: `l1:${r.id}`, scope: 'L1', roleId: r.id, removed: false },
  { profile: `l2:${r.id}`, scope: 'L2', roleId: r.id, removed: false },
  { profile: `gone:${r.id}`, scope: 'org', roleId: r.id, removed: true },
  { profile: `goneL1:${r.id}`, scope: 'L1', roleId: r.id, removed: true },
  { profile: `both:${r.id}`, scope: 'org', roleId: r.id, removed: false },
  { profile: `both:${r.id}`, scope: 'L1', roleId: 'only_view_status', removed: false }
]);
const accessOrg: OrgState = emptyOrgState();
for (const r of accessRoles) accessOrg.roles[r.id] = { name: reg(r.id), privileges: reg(r.privileges), retired: r.retired } as unknown as OrgState['roles'][string];
for (const l of accessLanguages) {
  accessOrg.languages[l.id] = { added: l.listed ? { name: l.id, code: 'x', sourceCode: 'eng', ...reg(null) } : null, renamed: null, codeSet: null, country: null, target: null } as unknown as OrgState['languages'][string];
}
for (const m of accessMembers) {
  (accessOrg.members[m.profile] ??= {})[m.scope === 'org' ? 'org' : `language:${m.scope}`] = {
    roleId: reg(m.roleId), removed: reg(m.removed), scope: m.scope === 'org' ? { level: 'org' } : { level: 'language', languageId: m.scope }
  } as unknown as OrgState['members'][string][string];
}
const accessProfiles = [...new Set([...accessMembers.map((m) => m.profile), 'nobody'])];
const access = accessProfiles.flatMap((profile) => accessStreams.map((stream) => ({
  profile, stream, read: mayReadLanguage(accessOrg, profile, stream), write: mayWriteFiles(accessOrg, profile, stream)
})));
const accessRows = {
  roles: accessRoles.map((r) => ({ id: r.id, privileges: r.privileges, retired: r.retired })),
  languages: accessLanguages,
  members: accessMembers
};

writeFileSync(process.argv[2] ?? '/tmp/record-parity.sql', `do $$ declare r jsonb; begin
  for r in select * from jsonb_array_elements(${sql(rows)}) loop
    if (public.validate_payload(r->>'type', r->'payload') is null) is distinct from (r->>'valid')::boolean then
      raise exception 'validate_payload disagrees with core: % (sql says %)', r, public.validate_payload(r->>'type', r->'payload');
    end if;
  end loop;
  for r in select * from jsonb_array_elements(${sql(perms)}) loop
    if public.role_may_emit_event(r->>'role', r->>'type', r->'payload') is distinct from (r->>'allowed')::boolean then
      raise exception 'role_may_emit_event disagrees with core: %', r;
    end if;
  end loop;
  for r in select * from jsonb_array_elements(${sql(single)}) loop
    if coalesce(string_to_array(public.event_privilege(r->>'type', r->'payload'), ',') && array[r->>'priv'], false) is distinct from (r->>'allowed')::boolean then
      raise exception 'event_privilege disagrees with core: %', r;
    end if;
  end loop;
  for r in select * from jsonb_array_elements(${sql(scopedLanguage)}) loop
    if public.language_of_org_event(r->>'type', r->'payload') is distinct from r->>'language' then
      raise exception 'language_of_org_event disagrees with core: %', r;
    end if;
  end loop;
  for r in select * from jsonb_array_elements(${sql(Object.keys(EVENT_PRIVILEGE).map((type) => ({ type, org: (ORG_EVENT_TYPES as readonly string[]).includes(type) })))}) loop
    if (r->>'type' = any (public._org_event_types())) is distinct from (r->>'org')::boolean then
      raise exception '_org_event_types disagrees with core on %', r->>'type';
    end if;
  end loop;
  for r in select * from jsonb_array_elements(${sql(sizes)}) loop
    if (public._event_size_refusal(r->'ev') is null) is distinct from (r->>'ok')::boolean then
      raise exception '_event_size_refusal disagrees with core on % bytes: %', octet_length((r->'ev'->'payload')::text), public._event_size_refusal(r->'ev');
    end if;
  end loop;
  for r in select * from jsonb_array_elements(${sql(entities)}) loop
    if public._entity_key(r->>'type', r->'payload') is distinct from r->>'key' then
      raise exception '_entity_key disagrees with core: % (sql says %)', r, public._entity_key(r->>'type', r->'payload');
    end if;
  end loop;
  for r in select * from jsonb_array_elements(${sql(serverIds)}) loop
    if public._server_event_id(r->>'id') is distinct from (r->>'server')::boolean then
      raise exception '_server_event_id disagrees with isServerEventId: %', r;
    end if;
  end loop;
  for r in select * from jsonb_array_elements(${sql(authorIds)}) loop
    if public._id_author(r->>'id') is distinct from r->>'author' then
      raise exception '_id_author disagrees with idAuthor: % (sql says %)', r, public._id_author(r->>'id');
    end if;
  end loop;
  for r in select * from jsonb_array_elements(${sql(namedFiles)}) loop
    if (select coalesce(jsonb_agg(f.hash || ':' || coalesce(f.format, '') order by f.hash || ':' || coalesce(f.format, '') collate "C"), '[]'::jsonb)
        from public._event_files(r->>'type', r->'payload') f) is distinct from r->'files' then
      raise exception '_event_files disagrees with filesNamedBy: %', r;
    end if;
  end loop;
  for r in select * from jsonb_array_elements(${sql(generations)}) loop
    if encode(public._discovery_key_below(decode('${generations[0]!.key}', 'hex'), (r->>'steps')::int), 'hex') is distinct from r->>'key' then
      raise exception '_discovery_key_below disagrees with the generations vector: %', r;
    end if;
  end loop;
  if (select array_agg(p order by p collate "C") from unnest(public._manage_privileges()) p) is distinct from array(select jsonb_array_elements_text(${sql(managePrivileges)})) then
    raise exception '_manage_privileges disagrees with MANAGE_PRIVILEGES: %', public._manage_privileges();
  end if;
  for r in select * from jsonb_array_elements(${sql(newcomerIds)}) loop
    if public._newcomer_profile_id(r->>'key', r->>'salt') is distinct from r->>'id' then
      raise exception '_newcomer_profile_id disagrees with newcomerProfileId: % (sql says %)', r, public._newcomer_profile_id(r->>'key', r->>'salt');
    end if;
  end loop;
end $$;
begin;
do $$ declare r jsonb; m jsonb; begin
  for r in select * from jsonb_array_elements(${sql(accessRows.roles)}) loop
    insert into public.org_roles (org_id, role_id, name, privileges, retired)
      values ('${ACCESS_ORG}', r->>'id', r->>'id', array(select jsonb_array_elements_text(r->'privileges')), (r->>'retired')::boolean);
  end loop;
  for r in select * from jsonb_array_elements(${sql(accessRows.languages)}) loop
    insert into public.languages (org_id, language_id, added_hlc)
      values ('${ACCESS_ORG}', r->>'id', case when (r->>'listed')::boolean then '1' else '' end);
  end loop;
  for r in select * from jsonb_array_elements(${sql(accessRows.members)}) loop
    insert into public.org_memberships (org_id, profile_id, scope_key, scope_level, language_id, role_id, removed)
      values ('${ACCESS_ORG}', r->>'profile', case when r->>'scope' = 'org' then 'org' else 'language:' || (r->>'scope') end,
        case when r->>'scope' = 'org' then 'org' else 'language' end, case when r->>'scope' = 'org' then null else r->>'scope' end,
        r->>'roleId', (r->>'removed')::boolean);
  end loop;
  for r in select * from jsonb_array_elements(${sql(access)}) loop
    if public._can_read_stream_at('${ACCESS_ORG}', r->>'stream', r->>'profile', 'aal1') is distinct from (r->>'read')::boolean then
      raise exception '_can_read_stream_at disagrees with mayReadLanguage: % (sql says %)', r, not (r->>'read')::boolean;
    end if;
    if public.blob_access('${ACCESS_ORG}/' || (r->>'stream') || '/f', r->>'profile', true) is distinct from (r->>'write')::boolean then
      raise exception 'blob_access (write) disagrees with mayWriteFiles: % (sql says %)', r, not (r->>'write')::boolean;
    end if;
  end loop;
end $$;
rollback;
select ${rows.length} as payload_checks, ${perms.length + single.length} as permission_checks, ${scopedLanguage.length} as scope_checks,
  ${entities.length} as entity_checks, ${sizes.length} as size_checks, ${access.length} as access_checks, ${serverIds.length} as server_id_checks,
  ${authorIds.length} as id_author_checks, ${generations.length} as generation_checks, ${namedFiles.length} as named_file_checks;
`);
