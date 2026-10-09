import type { AnyEvent } from './events';
import { LIBRARY_KINDS } from './libraryDocs';
import { ORG_STREAM, PRIVILEGES, TARGET_SCOPES } from './orgTerms';
import { isLicense, LICENSES } from './license';

/**
 * Shape checks for envelopes and known payloads. The server runs the same
 * rules in SQL (validate_payload) before an event enters the append-only
 * log; the client runs them again so an event that slipped through can
 * never throw inside the fold. Unknown types pass: an older app must keep
 * folding when a newer app emits events it does not know.
 */

/** A languoid's id (docs/languoids.md): a UUID. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validateEvent(e: AnyEvent): string | null {
  for (const k of ['id', 'type', 'orgId', 'streamId', 'actorId', 'deviceId', 'hlc'] as const) {
    if (typeof e[k] !== 'string' || e[k] === '') return `${k} must be a non-empty string`;
  }
  if (!isObject(e.payload)) return 'payload must be an object';
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
    case 'v1.VersionReleased':
      return str('takeId', 'channel') ?? bool('live') ??
        (p['url'] === undefined || nonEmpty(p['url']) ? null : 'url must be a non-empty string') ??
        // Characters, as SQL length() counts them.
        ([...(p['channel'] as string)].length <= 60 ? null : 'channel must be at most 60 characters');
    case 'v1.RecordingAdded':
      return str('recordingId', 'unitId') ?? oneOf('kind', ['source', 'target']) ?? cards('cards');
    case 'v1.TakeComposed':
      return str('takeId', 'unitId') ?? strArray('cardHashes') ?? (p['parentTakeId'] === null ? null : str('parentTakeId'));
    case 'v1.TakeArchived':
      return str('takeId');
    case 'v1.TakeSubmitted':
      return str('takeId') ?? (p['questionSetIds'] === undefined ? null : strArray('questionSetIds'));
    case 'v1.ResponseRecorded':
      return str('takeId', 'respondsToTakeId') ?? optStr('note', 'blobHash');
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
    case 'v1.NoteAdded':
      return (
        str('noteId', 'unitId') ??
        optStr('text', 'blobHash', 'photoHash', 'onTakeId') ??
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
    default: return null;
  }
}
