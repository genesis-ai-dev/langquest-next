import { SHOWN, type AnyEvent } from './events';
import { LIBRARY_KINDS } from './libraryDocs';
import { ORG_STREAM, PRIVILEGES, TARGET_SCOPES } from './orgTerms';
import { isLicense, LICENSES } from './license';
import { isWrittenPart, MAKES_RESULTS, resultAllowed, WRITTEN_PART_MAX, WRITTEN_PARTS_PER_EVENT, writtenPartId, type MakesSpec } from './writing';

/**
 * Shape checks for envelopes and known payloads. The server runs the same
 * rules in SQL (validate_payload) before an event enters the append-only
 * log; the client runs them again so an event that slipped through can
 * never throw inside the fold. Unknown types pass: an older app must keep
 * folding when a newer app emits events it does not know.
 */

/** A languoid's id (docs/languoids.md): a UUID. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The names every plain object already answers to. The fold keys its maps by
 * the ids in events (`state.takes[takeId]`), so an id of `__proto__` would
 * reach Object.prototype instead of a take, and one change there changes
 * every object in the app. No string or key in an event may be one of these
 * (SQL `_names_object_member`).
 */
export const OBJECT_MEMBER_NAMES: readonly string[] = [
  '__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
  'toLocaleString', 'toString', 'valueOf', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__'
];
const MEMBER_NAMES = new Set(OBJECT_MEMBER_NAMES);

/** The first string or key anywhere in `v` that names an object member, or null. Iterative, so no depth can overflow the stack. */
export function objectMemberNameIn(v: unknown): string | null {
  const stack: unknown[] = [v];
  while (stack.length > 0) {
    const x = stack.pop();
    if (typeof x === 'string') {
      if (MEMBER_NAMES.has(x)) return x;
    } else if (Array.isArray(x)) {
      for (const item of x) stack.push(item);
    } else if (typeof x === 'object' && x !== null) {
      for (const [k, child] of Object.entries(x)) {
        if (MEMBER_NAMES.has(k)) return k;
        stack.push(child);
      }
    }
  }
  return null;
}

export function validateEvent(e: AnyEvent): string | null {
  for (const k of ['id', 'type', 'orgId', 'streamId', 'actorId', 'deviceId', 'hlc'] as const) {
    if (typeof e[k] !== 'string' || e[k] === '') return `${k} must be a non-empty string`;
    if (MEMBER_NAMES.has(e[k])) return `${k} may not be ${e[k]}`;
  }
  if (!isObject(e.payload)) return 'payload must be an object';
  const member = objectMemberNameIn(e.payload);
  if (member !== null) return `payload may not use the name ${member}`;
  const p = e.payload as Record<string, unknown>;
  const str = (...keys: string[]) => {
    for (const k of keys) if (typeof p[k] !== 'string' || p[k] === '') return `${k} must be a non-empty string`;
    return null;
  };
  const optStr = (...keys: string[]) => {
    for (const k of keys) if (p[k] !== undefined && typeof p[k] !== 'string') return `${k} must be a string`;
    return null;
  };
  const cards = (k: string) => {
    if (!Array.isArray(p[k])) return `${k} must be an array`;
    for (const c of p[k] as unknown[]) {
      if (!isObject(c)) return `${k} entries must be objects`;
      if (typeof c['hash'] !== 'string' || c['hash'] === '') return `${k} entries need a hash`;
      if (typeof c['durationMs'] !== 'number') return `${k} entries need durationMs`;
      if (c['atMs'] !== undefined && !(Number.isInteger(c['atMs']) && (c['atMs'] as number) >= 0)) return `${k} atMs must be a whole number of milliseconds`;
    }
    return null;
  };
  const strArray = (k: string) =>
    Array.isArray(p[k]) && (p[k] as unknown[]).every((x) => typeof x === 'string') ? null : `${k} must be a string array`;
  const optBool = (k: string) => (p[k] === undefined || typeof p[k] === 'boolean' ? null : `${k} must be a boolean`);
  const bool = (k: string) => (typeof p[k] === 'boolean' ? null : `${k} must be a boolean`);
  const hash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  const nonEmptyIn = (o: unknown, ...keys: string[]) => keys.every((k) => typeof (o as Record<string, unknown>)[k] === 'string' && (o as Record<string, unknown>)[k] !== '');
  const oneOf = (k: string, values: readonly string[]) => (values.includes(p[k] as string) ? null : `${k} must be one of ${values.join(', ')}`);
  const libraryItem = () =>
    str('itemId') ??
    (/^[a-z0-9][a-z0-9._-]{0,120}$/i.test(p['itemId'] as string) ? null : 'itemId may use letters, digits, . _ and - only') ??
    oneOf('kind', LIBRARY_KINDS);
  const date = (k: string) => (typeof p[k] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p[k]) ? null : `${k} must be a YYYY-MM-DD date`);
  const optStrRecord = (k: string) =>
    p[k] === undefined || (isObject(p[k]) && Object.values(p[k] as object).every((v) => typeof v === 'string')) ? null : `${k} must map ids to strings`;
  const clusterId = () => (/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(p['clusterId'] as string) ? null : 'clusterId may use letters, digits, _ and - only');
  const nullableStr = (k: string) => (p[k] === null || (typeof p[k] === 'string' && p[k] !== '') ? null : `${k} must be a string or null`);

  switch (e.type) {
    // ---- organization stream (org.ts)
    case 'v1.OrgCreated':
    case 'v1.OrgRenamed':
      return str('name');
    case 'v1.RoleDefined':
      return str('roleId', 'name') ??
        (Array.isArray(p['privileges']) && (p['privileges'] as unknown[]).every((x) => (PRIVILEGES as readonly unknown[]).includes(x)) ? null : 'privileges must be known privileges');
    case 'v1.RoleRetired':
      return str('roleId');
    case 'v1.MemberAdded':
      return str('profileId', 'roleId') ?? scope(p['scope']);
    case 'v1.MemberRemoved':
      return str('profileId') ?? scope(p['scope']);
    case 'v1.InviteIssued':
      return str('inviteId', 'roleId', 'expiresAt') ?? scope(p['scope']);
    case 'v1.InviteRedeemed':
      return str('inviteId', 'profileId');
    case 'v1.JoinDecided':
      return str('requestId', 'profileId') ?? bool('accepted');
    case 'v1.LicenseSet':
      return isLicense(p['license']) ? null : `license must be one of ${LICENSES.join(', ')}`;
    case 'v1.LanguageAdded':
      return str('languageId', 'name', 'code', 'sourceCode') ??
        (/^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/.test(p['languageId'] as string) ? null : 'languageId may use letters, digits, _ and - only') ??
        (p['languageId'] === ORG_STREAM ? 'languageId is reserved' : null);
    case 'v1.LanguageRenamed':
      return str('languageId', 'name');
    case 'v1.LanguageCodeSet':
      return str('languageId', 'code') ??
        ((p['code'] as string).length <= 40 ? null : 'code must be at most 40 characters') ??
        (p['languoidId'] === null || (typeof p['languoidId'] === 'string' && UUID.test(p['languoidId'])) ? null : 'languoidId must be a languoid id or null');
    case 'v1.LanguageCountrySet':
      return str('languageId') ?? (typeof p['country'] === 'string' && /^[A-Z]{2}$/.test(p['country']) ? null : 'country must be an ISO 3166 alpha-2 code');
    case 'v1.LanguageTargetSet':
      return (
        str('languageId') ?? oneOf('scope', TARGET_SCOPES) ?? date('startDate') ?? date('targetDate') ??
        ((p['targetDate'] as string) > (p['startDate'] as string) ? null : 'targetDate must be after startDate')
      );
    case 'v1.ClusterNamed':
      return str('clusterId', 'name') ?? clusterId();
    case 'v1.LanguageClusterSet':
      return str('languageId', 'clusterId') ?? clusterId() ?? bool('inCluster');
    case 'v1.ReferenceRecommended':
      return str('itemId') ?? bool('recommended');
    case 'v1.LibraryItemDefined':
      return libraryItem() ?? str('name') ?? (typeof p['description'] === 'string' ? null : 'description must be a string') ??
        (p['copiedFrom'] === undefined || (isObject(p['copiedFrom']) && nonEmptyIn(p['copiedFrom'], 'orgId', 'orgName', 'itemId') && hash(p['copiedFrom']['docHash']))
          ? null : 'copiedFrom needs orgId, orgName, itemId and a docHash');
    case 'v1.LibraryVersionPublished':
      return libraryItem() ?? (hash(p['docHash']) ? null : 'docHash must be a SHA-256 hex digest') ?? optStr('note');
    case 'v1.LibrarySharingSet':
      return libraryItem() ?? bool('shared') ?? bool('subscribable');
    case 'v1.LibraryItemArchived':
      return libraryItem() ?? bool('archived');
    case 'v1.LibrarySubscribed':
      return libraryItem() ?? str('sourceOrgId', 'sourceOrgName', 'sourceItemId', 'name') ?? bool('autoUpdate') ?? bool('active');
    case 'v1.LibraryPinned':
      return libraryItem() ?? (hash(p['docHash']) ? null : 'docHash must be a SHA-256 hex digest');
    // ---- either stream
    case 'v1.Redacted':
      return str('eventId') ?? optStr('reason');
    // ---- language stream
    case 'v1.TemplateSelected':
      return str('itemId', 'unitPrefix') ?? (hash(p['docHash']) ? null : 'docHash must be a SHA-256 hex digest') ??
        (/[/\s]/.test(p['unitPrefix'] as string) ? 'unitPrefix may not contain / or spaces' : null) ??
        (p['books'] === undefined || (Array.isArray(p['books']) && (p['books'] as unknown[]).every((b) => typeof b === 'string' && /^[A-Z0-9]{3}$/.test(b)))
          ? null : 'books must be USFM book codes');
    case 'v1.UnitAdded':
      return str('unitId', 'kind', 'label', 'order') ?? (p['parentUnitId'] === null ? null : str('parentUnitId'));
    case 'v1.UnitHidden':
      return str('unitId') ?? bool('hidden');
    case 'v1.BookNameSet':
      return str('book', 'name') ?? (/^[A-Z0-9]{3}$/.test(p['book'] as string) ? null : 'book must be a USFM book code');
    case 'v1.FlowSelected':
      return str('flowId') ?? (/[/@\s]/.test(p['flowId'] as string) ? 'flowId may not contain /, @ or spaces' : null) ??
        optStr('itemId', 'name') ?? (p['docHash'] === undefined || hash(p['docHash']) ? null : 'docHash must be a SHA-256 hex digest');
    case 'v1.FlowStepSet':
      return str('stepId', 'order') ?? strArray('kindIds') ?? bool('checkpoint');
    case 'v1.FlowStepRemoved':
      return str('stepId');
    case 'v1.ReviewKindDefined':
      return (
        str('kindId', 'name') ?? optStr('description', 'usualReviewer') ??
        optBool('withholdsContext') ??
        (p['produces'] === undefined || produces(p['produces']) ? null : 'produces needs what, into, action, checkedBy')
      );
    case 'v1.ReviewTeamDefined':
      return str('teamId', 'name');
    case 'v1.ReviewTeamMemberSet':
      return str('teamId', 'profileId') ?? bool('member');
    case 'v1.ReviewTeamKindSet':
      return str('teamId') ?? nullableStr('kindId');
    case 'v1.FlowStepLinksSet':
      return str('stepId') ?? bool('allowed');
    case 'v1.CheckHelpSet':
      return str('kindId') ?? bool('linked') ??
        ((p['itemId'] === undefined) === (p['materialId'] === undefined) ? 'exactly one of itemId, materialId' : null) ??
        (p['itemId'] === undefined || nonEmpty(p['itemId']) ? null : 'itemId must be a non-empty string') ??
        (p['materialId'] === undefined || nonEmpty(p['materialId']) ? null : 'materialId must be a non-empty string');
    case 'v1.CheckShowsSet':
      return str('kindId') ?? oneOf('what', SHOWN) ?? bool('shown') ??
        (p['from'] === undefined ? null : !nonEmpty(p['from']) ? 'from must be a non-empty string'
          : p['what'] === 'notes' || p['what'] === 'earlier' ? null : 'from is only for notes and earlier');
    case 'v1.VersionReleased':
      return str('takeId', 'channel') ?? bool('live') ??
        (p['url'] === undefined || nonEmpty(p['url']) ? null : 'url must be a non-empty string') ??
        // Characters, as SQL length() counts them.
        ([...(p['channel'] as string)].length <= 60 ? null : 'channel must be at most 60 characters');
    case 'v1.RecordingAdded':
      return str('recordingId', 'unitId') ?? oneOf('kind', ['source', 'target']) ?? cards('cards');
    case 'v1.TakeComposed':
      return str('takeId', 'unitId') ?? strArray('cardHashes') ?? (p['parentTakeId'] === null ? null : str('parentTakeId')) ??
        // A take holds recorded parts or written ones, never both (decisions.md 137).
        (oneMedium(p['cardHashes'] as string[]) ? null : 'cardHashes must be all recorded or all written parts');
    case 'v1.WritingAdded':
      return str('writingId', 'unitId') ?? writtenPartsError(p['parts']);
    case 'v1.MediaAllowedSet':
      return bool('recording') ?? bool('writing') ?? oneOf('first', ['recording', 'writing']) ??
        (p['recording'] || p['writing'] ? null : 'recording or writing must be allowed') ??
        (p[p['first'] as string] ? null : 'first must be allowed');
    case 'v1.StepMakesSet':
      return str('kindId') ?? (p['makes'] === null ? null : makesError(p['makes']));
    case 'v1.CheckLooksAtSet':
      return str('kindId') ?? nullableStr('makerKindId');
    case 'v1.Made':
      return (
        str('madeId', 'unitId') ??
        optNonEmpty(p, 'kindId', 'fromTakeId', 'fromMadeId', 'takeId', 'requestId') ??
        ((p['fromTakeId'] === undefined) === (p['fromMadeId'] === undefined) ? 'exactly one of fromTakeId, fromMadeId' : null) ??
        ((p['parts'] === undefined) === (p['takeId'] === undefined) ? 'exactly one of parts, takeId' : null) ??
        (p['language'] === undefined || languageCode(p['language']) ? null : 'language must be a language code') ??
        (p['added'] === undefined ? null : p['added'] !== true ? 'added must be true when present'
          : p['fromTakeId'] === undefined || p['parts'] === undefined || p['language'] !== undefined ? 'added needs fromTakeId and parts, in the team\'s own language' : null) ??
        (p['parts'] === undefined ? null : cards('parts') ??
          ((p['parts'] as unknown[]).length > 0 ? null : 'parts must not be empty') ??
          (oneMedium((p['parts'] as { hash: string }[]).map((c) => c.hash)) ? null : 'parts must be all recorded or all written'))
      );
    case 'v1.TakeArchived':
      return str('takeId');
    case 'v1.TakeSubmitted':
      return str('takeId') ?? (p['questionSetIds'] === undefined ? null : strArray('questionSetIds'));
    case 'v1.ResponseRecorded':
      return str('takeId', 'respondsToTakeId') ?? optStr('note', 'blobHash');
    case 'v1.CardVerseSet':
      return str('unitId', 'hash') ?? oneOf('mark', ['next', 'join', 'set', 'none']) ?? cardVerseError(p);
    case 'v1.AudioFormatSet':
      return str('hash') ?? oneOf('format', ['wav', 'm4a']);
    case 'v1.ExternalValueSet':
      return externalKeyError(p['key']) ?? (p['data'] === null || isObject(p['data']) ? null : 'data must be an object or null');
    case 'v1.ReviewRecorded':
      return (
        str('reviewId', 'takeId', 'kindId') ??
        oneOf('outcome', ['looks_good', 'needs_changes', 'recorded']) ??
        oneOf('via', ['app', 'link', 'logged']) ??
        optStr('comment', 'commentBlobHash', 'place', 'givenBy', 'requestId') ??
        optStrRecord('answers') ?? optStrRecord('skipped') ??
        (p['people'] === undefined || (typeof p['people'] === 'number' && p['people'] >= 0) ? null : 'people must be a number') ??
        (p['artifacts'] === undefined ? null : cards('artifacts')) ??
        (p['outcome'] === 'recorded' && (!Array.isArray(p['artifacts']) || p['artifacts'].length === 0) ? 'recorded needs artifacts' : null)
      );
    case 'v1.DepartureRecorded':
      return (
        str('departureId', 'unitId', 'reason') ??
        oneOf('type', ['skip', 'override', 'keep']) ??
        optStr('kindId', 'stepId', 'reviewId', 'reasonBlobHash') ??
        (p['type'] === 'skip' && !p['kindId'] ? 'skip needs kindId' : null) ??
        (p['type'] === 'override' && !p['stepId'] ? 'override needs stepId' : null) ??
        (p['type'] === 'keep' && !p['reviewId'] ? 'keep needs reviewId' : null)
      );
    case 'v1.DepartureUndone':
      return str('departureId');
    case 'v1.RequestMade':
      return (
        str('requestId', 'unitId') ??
        oneOf('what', ['record', 'review']) ??
        optStr('kindId', 'profileId', 'teamId', 'dueDate', 'note', 'noteBlobHash') ??
        (p['what'] === 'review' && !p['kindId'] ? 'a review request needs kindId' : null) ??
        (p['guest'] === undefined || guest(p['guest']) ? null : 'guest needs name, channel, contact') ??
        (p['questions'] === undefined || questions(p['questions']) ? null : 'questions must be id, text, type') ??
        (['profileId', 'guest', 'teamId'].filter((k) => p[k] !== undefined && p[k] !== '').length === 1 ? null : 'exactly one of profileId, guest, teamId')
      );
    case 'v1.RequestWithdrawn':
      return str('requestId');
    case 'v1.ReviewWithdrawn':
      return str('reviewId');
    case 'v1.NoteWithdrawn':
      return str('noteId');
    case 'v1.NoteAdded':
      return (
        str('noteId', 'unitId') ??
        optStr('text', 'blobHash', 'photoHash', 'onTakeId', 'kindId') ??
        anchor(p['anchor']) ??
        (!p['text'] && !p['blobHash'] && !p['photoHash'] ? 'a note needs text, audio or a photo' : null)
      );
    case 'v1.StudyStepMarked':
      return str('unitId', 'guideId', 'stepId') ?? bool('done');
    case 'v1.MaterialDefined':
      return str('materialId', 'kind', 'title') ?? optStr('templateRef') ??
        (isObject(p['scope']) && Object.entries(p['scope']).every(([k, v]) => (k === 'unitId' || k === 'stepId') && nonEmpty(v))
          ? null : 'scope may name a unitId and a stepId only');
    case 'v1.MaterialFieldSet':
      return str('materialId', 'fieldId') ?? optStr('text', 'blobHash');
    case 'v1.MaterialLocked':
      return str('materialId') ?? bool('locked');
    case 'v1.KeyTermDefined':
      return str('termId', 'term') ?? (typeof p['gloss'] === 'string' ? null : 'gloss must be a string') ?? strArray('unitScope');
    case 'v1.KeyTermRenderingAdded':
      return str('termId', 'renderingId', 'rendering') ?? (typeof p['context'] === 'string' ? null : 'context must be a string');
    case 'v1.KeyTermAdjusted':
      return str('termId', 'adjustmentId') ?? (typeof p['note'] === 'string' ? null : 'note must be a string') ?? optStr('blobHash', 'duringTakeId');
    case 'v1.KeyTermLinked':
      return str('takeId', 'termId') ?? optStr('note', 'adjustmentId');
    case 'v1.ReferenceSet':
      return str('itemId') ?? oneOf('state', ['recommended', 'hidden', 'inherit']);
    case 'v1.ReferenceLanguageSet':
      return str('language') ?? (/^[a-z0-9-]{2,40}$/.test(p['language'] as string) ? null : 'language must be a language code');
    case 'v1.ReferenceLanguageAdded':
      return str('language') ?? (/^[a-z0-9-]{2,40}$/.test(p['language'] as string) ? null : 'language must be a language code') ?? bool('added');
    case 'v1.PassageReferenceLinked':
      return str('unitId', 'itemId') ?? bool('linked');
    case 'v1.ReferencesUsed':
      return (
        str('unitId') ??
        (['takeId', 'reviewId'].filter((k) => p[k] !== undefined).length === 1 ? null : 'exactly one of takeId, reviewId') ??
        optStr('takeId', 'reviewId') ?? (p['takeId'] === '' || p['reviewId'] === '' ? 'takeId or reviewId must be non-empty' : null) ??
        usedItems(p['items'])
      );
    case 'v1.BlobStored':
      return str('hash') ?? (typeof p['size'] === 'number' ? null : 'size must be a number');
    case 'v1.BlobInvalidated':
      return str('hash') ?? optStr('reason');
    default:
      return null;
  }
}

const USED_KINDS = ['source', 'guide', 'note', 'questions'];
function usedItems(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > 200) return 'items must be a list of 1 to 200';
  for (const x of v) {
    if (!isObject(x)) return 'items must be objects';
    if (typeof x['itemId'] !== 'string' || x['itemId'] === '' || typeof x['name'] !== 'string' || x['name'] === '') return 'items need an itemId and a name';
    if (!USED_KINDS.includes(x['kind'] as string)) return `item kind must be one of ${USED_KINDS.join(', ')}`;
    if (typeof x['opened'] !== 'boolean') return 'opened must be a boolean';
    for (const k of ['docHash', 'ref', 'detail', 'copyright']) if (x[k] !== undefined && typeof x[k] !== 'string') return `${k} must be a string`;
  }
  return null;
}

/** A membership scope: the organization, or one language. */
function scope(v: unknown): string | null {
  if (!isObject(v)) return 'scope must be an object';
  if (v['level'] === 'org') return Object.keys(v).length === 1 ? null : 'an org scope names nothing else';
  if (v['level'] === 'language') return nonEmpty(v['languageId']) && Object.keys(v).length === 2 ? null : 'a language scope names its languageId and nothing else';
  return 'scope.level must be org or language';
}

const nonEmpty = (v: unknown) => typeof v === 'string' && v !== '';

function produces(v: unknown): boolean {
  return isObject(v) && ['what', 'into', 'action', 'checkedBy'].every((k) => nonEmpty(v[k]));
}

function guest(v: unknown): boolean {
  return isObject(v) && nonEmpty(v['name']) && nonEmpty(v['contact']) && (v['channel'] === 'whatsapp' || v['channel'] === 'sms');
}

function questions(v: unknown): boolean {
  return Array.isArray(v) && v.every((q) => isObject(q) && nonEmpty(q['id']) && nonEmpty(q['text']) &&
    (q['type'] === 'rating' || q['type'] === 'yesno' || q['type'] === 'text') &&
    (q['required'] === undefined || typeof q['required'] === 'boolean'));
}

/** A note's anchor (record.ts NoteAnchor). */
function anchor(v: unknown): string | null {
  if (!isObject(v)) return 'anchor must be an object';
  switch (v['kind']) {
    case 'passage': return null;
    case 'version': return nonEmpty(v['takeId']) ? null : 'anchor.takeId required';
    case 'verse': return nonEmpty(v['verse']) ? null : 'anchor.verse required';
    case 'study': return nonEmpty(v['guideId']) && nonEmpty(v['stepId']) ? null : 'anchor.guideId and stepId required';
    case 'term': return nonEmpty(v['termId']) ? null : 'anchor.termId required';
    default: return 'anchor.kind must be passage, version, verse, study or term';
  }
}

/** The longest key a third-party app may use, in characters. */
export const EXTERNAL_KEY_MAX = 256;

/**
 * Why a key a third-party app chose cannot be used, or null (decisions.md
 * 79): path segments of URL-safe characters joined by `/`, none of them
 * `.` or `..`, so it reads back unchanged as the rest of a URL path. SQL
 * validate_payload says the same.
 */
export function externalKeyError(v: unknown): string | null {
  if (typeof v !== 'string' || v === '') return 'key must be a non-empty string';
  if (v.length > EXTERNAL_KEY_MAX) return `key must be at most ${EXTERNAL_KEY_MAX} characters`;
  if (!/^[A-Za-z0-9._~:@+-]+(\/[A-Za-z0-9._~:@+-]+)*$/.test(v)) return 'key must be segments of letters, digits and . _ ~ : @ + - joined by /';
  if (/(^|\/)\.\.?(\/|$)/.test(v)) return 'key segments may not be . or ..';
  return null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The entity a creating event names, as `kind:id`, or null for every other
 * event. One event per entity in a stream: the server refuses a second one
 * (`append_events`, SQL `_entity_key`, held to this by the parity script),
 * and the fold keeps the earliest, so nobody can swap the audio under a
 * reviewed version or replace someone's review (decisions.md 75). The
 * translation guide's material and key terms are left out: two phones
 * define them under the same id by design.
 */
export function entityKeyOf(e: AnyEvent): string | null {
  const p = e.payload as Record<string, unknown>;
  switch (e.type) {
    case 'v1.RecordingAdded': return `recording:${String(p['recordingId'])}`;
    case 'v1.TakeComposed': return `take:${String(p['takeId'])}`;
    case 'v1.ResponseRecorded': return `response:${String(p['takeId'])}`;
    case 'v1.ReviewRecorded': return `review:${String(p['reviewId'])}`;
    case 'v1.DepartureRecorded': return `departure:${String(p['departureId'])}`;
    case 'v1.RequestMade': return `request:${String(p['requestId'])}`;
    case 'v1.NoteAdded': return `note:${String(p['noteId'])}`;
    case 'v1.KeyTermRenderingAdded': return `rendering:${String(p['termId'])}/${String(p['renderingId'])}`;
    case 'v1.KeyTermAdjusted': return `adjustment:${String(p['termId'])}/${String(p['adjustmentId'])}`;
    case 'v1.AudioFormatSet': return `audioformat:${String(p['hash'])}`;
    case 'v1.WritingAdded': return `writing:${String(p['writingId'])}`;
    case 'v1.Made': return `made:${String(p['madeId'])}`;
    default: return null;
  }
}

const VERSE_REF = /^[1-9][0-9]{0,2}:[1-9][0-9]{0,2}$/;

/** "15:4" -> 15004, for ordering; null when it is not chapter:verse. */
export function verseRefOrder(ref: unknown): number | null {
  if (typeof ref !== 'string' || !VERSE_REF.test(ref)) return null;
  const [c, v] = ref.split(':').map(Number) as [number, number];
  return c * 1000 + v;
}

/** `set` needs from and to in order; the other marks carry neither. */
function cardVerseError(p: Record<string, unknown>): string | null {
  if (p['mark'] !== 'set') return p['from'] === undefined && p['to'] === undefined ? null : 'from and to belong to set only';
  const a = verseRefOrder(p['from']);
  const b = verseRefOrder(p['to']);
  if (a === null || b === null) return 'from and to must be chapter:verse';
  return a <= b ? null : 'from must not come after to';
}

// ---- writing (decisions.md 137) ----

function oneMedium(ids: readonly string[]): boolean {
  if (ids.length === 0) return true;
  const written = isWrittenPart(ids[0]!);
  return ids.every((id) => isWrittenPart(id) === written);
}

/** A language code as LanguageCodeSet takes one: ISO 639-3 or a glottocode, at most 40 characters. */
function languageCode(v: unknown): boolean {
  return typeof v === 'string' && v !== '' && [...v].length <= 40;
}

function optNonEmpty(p: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) if (p[k] !== undefined && (typeof p[k] !== 'string' || p[k] === '')) return `${k} must be a non-empty string`;
  return null;
}

function writtenPartsError(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return 'parts must be a non-empty array';
  if (v.length > WRITTEN_PARTS_PER_EVENT) return `parts may hold at most ${WRITTEN_PARTS_PER_EVENT}`;
  for (const part of v as unknown[]) {
    if (!isObject(part)) return 'parts entries must be objects';
    const { id, text } = part as { id: unknown; text: unknown };
    if (typeof id !== 'string' || !/^w:[0-9a-f]{64}$/.test(id)) return 'parts need an id: w: and a SHA-256 hex digest';
    if (typeof text !== 'string' || text === '') return 'parts need text';
    // Characters, as SQL length() counts them.
    if ([...text].length > WRITTEN_PART_MAX) return `text must be at most ${WRITTEN_PART_MAX} characters`;
    if (writtenPartId(text) !== id) return 'id must be w: and the SHA-256 of the text';
  }
  return null;
}

function makesError(v: unknown): string | null {
  if (!isObject(v)) return 'makes must be an object or null';
  const m = v as Record<string, unknown>;
  const kinds = ['recording', 'writing', 'either'];
  if (!kinds.includes(m['from'] as string)) return 'makes.from must be one of recording, writing, either';
  if (!kinds.includes(m['to'] as string)) return 'makes.to must be one of recording, writing, either';
  if (m['language'] !== 'same' && m['language'] !== 'other') return 'makes.language must be one of same, other';
  if (!(MAKES_RESULTS as readonly unknown[]).includes(m['result'])) return 'makes.result must be one of beside, added, version';
  if (m['otherLanguage'] !== undefined && (m['language'] !== 'other' || !languageCode(m['otherLanguage']))) return 'makes.otherLanguage must be a language code, for another language only';
  if (m['fromKindId'] !== undefined && (typeof m['fromKindId'] !== 'string' || m['fromKindId'] === '')) return 'makes.fromKindId must be a non-empty string';
  if (m['result'] === 'version' && !resultAllowed(m as Pick<MakesSpec, 'from' | 'to' | 'language'>, 'version')) return 'only a step that makes recording or writing in the same language can make the next version';
  if (m['result'] === 'added' && !resultAllowed(m as Pick<MakesSpec, 'from' | 'to' | 'language'>, 'added')) return 'only a step that turns recording into writing, or writing into recording, in the same language can add to the version';
  return null;
}

/**
 * The most one event may carry (decisions.md 115): its payload as Postgres
 * prints it, and each envelope field. Checked where events are made
 * (SyncClient.append) and where the server takes them (append_events, SQL
 * `_event_size_refusal`), never in the fold, so nothing already in a log
 * changes meaning. A recording's cards are the largest real payload, about
 * 120 bytes each.
 */
export const EVENT_PAYLOAD_MAX_BYTES = 64 * 1024;
export const EVENT_FIELD_MAX_CHARS = 256;

/**
 * Bytes of `v` as Postgres prints jsonb (`payload::text`): the compact JSON,
 * plus the space it puts after each `:` and each `,`. Iterative, so no depth
 * can overflow the stack.
 */
export function jsonbTextBytes(v: unknown): number {
  let spaces = 0;
  const stack: unknown[] = [v];
  while (stack.length > 0) {
    const x = stack.pop();
    if (Array.isArray(x)) {
      if (x.length > 1) spaces += x.length - 1;
      for (const item of x) stack.push(item);
    } else if (typeof x === 'object' && x !== null) {
      const values = Object.values(x).filter((child) => child !== undefined);
      if (values.length > 0) spaces += 2 * values.length - 1;
      for (const child of values) stack.push(child);
    }
  }
  return utf8Bytes(JSON.stringify(v) ?? '') + spaces;
}

function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/** Why an event is too big to make or to take, or null. */
export function eventSizeError(e: AnyEvent): string | null {
  for (const k of ['id', 'type', 'orgId', 'streamId', 'actorId', 'deviceId', 'hlc', 'parentEventId'] as const) {
    const v = (e as unknown as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.length > EVENT_FIELD_MAX_CHARS) return `${k} is longer than ${EVENT_FIELD_MAX_CHARS} characters`;
  }
  const bytes = jsonbTextBytes(e.payload);
  return bytes > EVENT_PAYLOAD_MAX_BYTES ? `event too large: ${bytes} bytes (max ${EVENT_PAYLOAD_MAX_BYTES})` : null;
}
