import type { AnyEvent, Role } from './events';
import { PRIVILEGES } from './org';
import { isLicense, LICENSES } from './license';

/**
 * Shape checks for envelopes and known payloads. The server runs the same
 * rules in SQL (validate_payload) before an event enters the append-only
 * log; the client runs them again so an event that slipped through can
 * never throw inside the fold. Unknown types pass: an older app must keep
 * folding when a newer app emits events it does not know.
 */
const ROLES: readonly Role[] = ['owner', 'coordinator', 'translator', 'reviewer', 'viewer'];

export function validateEvent(e: AnyEvent): string | null {
  for (const k of ['id', 'type', 'orgId', 'projectId', 'actorId', 'deviceId', 'hlc'] as const) {
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
  const role = (k: string) => (ROLES.includes(p[k] as Role) ? null : `${k} must be a role`);
  const cards = (k: string) => {
    if (!Array.isArray(p[k])) return `${k} must be an array`;
    for (const c of p[k] as unknown[]) {
      if (!isObject(c)) return `${k} entries must be objects`;
      const card = c as Record<string, unknown>;
      if (typeof card['hash'] !== 'string' || card['hash'] === '') return `${k} entries need a hash`;
      if (typeof card['durationMs'] !== 'number') return `${k} entries need durationMs`;
    }
    return null;
  };
  const strArray = (k: string) =>
    Array.isArray(p[k]) && (p[k] as unknown[]).every((x) => typeof x === 'string') ? null : `${k} must be a string array`;
  const optBool = (k: string) => (p[k] === undefined || typeof p[k] === 'boolean' ? null : `${k} must be a boolean`);
  const bool = (k: string) => (typeof p[k] === 'boolean' ? null : `${k} must be a boolean`);
  const hash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  const nonEmpty = (o: unknown, ...keys: string[]) => keys.every((k) => typeof (o as Record<string, unknown>)[k] === 'string' && (o as Record<string, unknown>)[k] !== '');
  const libraryItem = () =>
    str('itemId') ??
    (/^[a-z0-9][a-z0-9._-]{0,120}$/i.test(p['itemId'] as string) ? null : 'itemId may use letters, digits, . _ and - only') ??
    oneOf('kind', ['template', 'flow', 'material', 'versification']);
  const oneOf = (k: string, values: string[]) => (values.includes(p[k] as string) ? null : `${k} must be one of ${values.join(', ')}`);
  const optStrRecord = (k: string) =>
    p[k] === undefined || (isObject(p[k]) && Object.values(p[k] as object).every((v) => typeof v === 'string')) ? null : `${k} must map ids to strings`;

  switch (e.type) {
    case 'v1.ProjectCreated':
      return str('name', 'sourceLanguoidId');
    case 'v1.ProjectConfigChanged':
      return isObject(p['config']) ? null : 'config must be an object';
    case 'v1.MemberAdded':
    case 'v1.MemberRoleChanged':
      return str('profileId') ?? role('role');
    case 'v1.MemberRemoved':
      return str('profileId');
    case 'v1.LaneAdded':
      return str('laneId', 'languoidId');
    case 'v1.UnitAdded':
      return (
        str('unitId', 'kind', 'label', 'order') ??
        (p['parentUnitId'] === null || typeof p['parentUnitId'] === 'string' ? null : 'parentUnitId must be a string or null')
      );
    case 'v1.ReferenceAttached':
      return str('unitId', 'refId', 'kind') ?? optStr('blobHash', 'text');
    case 'v1.RecordingAdded':
      return (
        str('recordingId', 'unitId', 'laneId') ??
        (p['kind'] === 'source' || p['kind'] === 'target' ? null : 'kind must be source or target') ??
        cards('cards')
      );
    case 'v1.TakeComposed':
      return (
        str('takeId', 'unitId', 'laneId') ??
        strArray('cardHashes') ??
        (p['parentTakeId'] === null || typeof p['parentTakeId'] === 'string' ? null : 'parentTakeId must be a string or null')
      );
    case 'v1.TakeArchived':
    case 'v1.TakeSubmitted':
      return str('takeId');
    case 'v1.TakeSelected':
      return str('unitId', 'laneId', 'takeId');
    case 'v1.ReviewSubmitted':
      return (
        str('takeId', 'stepId') ??
        (p['decision'] === 'approve' || p['decision'] === 'suggest_changes' ? null : 'decision must be approve or suggest_changes') ??
        optStr('comment')
      );
    case 'v1.AssignmentMade':
      return str('unitId', 'laneId', 'profileId') ?? role('role') ?? optStr('dueDate', 'instructions');
    case 'v1.SourceImported':
      return str('sourceProjectId') ?? (typeof p['sourceSeq'] === 'number' ? null : 'sourceSeq must be a number') ?? strArray('unitIds');
    case 'v1.BlobStored':
      return str('hash') ?? (typeof p['size'] === 'number' ? null : 'size must be a number');
    case 'v1.Redacted':
      return str('eventId') ?? optStr('reason');
    case 'v1.BlobInvalidated':
      return str('hash') ?? optStr('reason');
    case 'v1.ReviewKindDefined':
      return (
        str('kindId', 'name') ?? optStr('description', 'usualReviewer') ??
        optBool('withholdsContext') ??
        (p['produces'] === undefined || produces(p['produces']) ? null : 'produces needs what, into, action, checkedBy')
      );
    case 'v2.WorkflowStepSet':
      return str('stepId', 'order') ?? optStr('laneId') ?? strArray('kindIds') ??
        (typeof p['checkpoint'] === 'boolean' ? null : 'checkpoint must be a boolean');
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
        str('departureId', 'unitId', 'laneId', 'reason') ??
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
        str('requestId', 'unitId', 'laneId') ??
        oneOf('what', ['record', 'review']) ??
        optStr('kindId', 'profileId', 'dueDate', 'note', 'noteBlobHash') ??
        (p['what'] === 'review' && !p['kindId'] ? 'a review request needs kindId' : null) ??
        (p['profileId'] === undefined && p['guest'] === undefined ? 'profileId or guest required' : null) ??
        (p['guest'] === undefined || guest(p['guest']) ? null : 'guest needs name, channel, contact') ??
        (p['questions'] === undefined || questions(p['questions']) ? null : 'questions must be id, text, type')
      );
    case 'v1.RequestWithdrawn':
      return str('requestId');
    case 'v1.NoteAdded':
      return (
        str('noteId', 'unitId', 'laneId') ??
        optStr('text', 'blobHash', 'photoHash', 'onTakeId') ??
        anchor(p['anchor']) ??
        (!p['text'] && !p['blobHash'] && !p['photoHash'] ? 'a note needs text, audio or a photo' : null)
      );
    case 'v1.StudyStepMarked':
      return str('unitId', 'laneId', 'guideId', 'stepId') ?? (typeof p['done'] === 'boolean' ? null : 'done must be a boolean');
    case 'v1.LaneNamed':
      return str('laneId', 'name');
    case 'v1.InviteIssued':
      return str('inviteId', 'roleId', 'expiresAt') ?? scope(p['scope']);
    case 'v1.InviteRedeemed':
      return str('inviteId', 'profileId');
    case 'v1.JoinDecided':
      return str('requestId', 'profileId') ?? (typeof p['accepted'] === 'boolean' ? null : 'accepted must be a boolean');
    case 'v1.OrgLicenseSet':
      return isLicense(p['license']) ? null : `license must be one of ${LICENSES.join(', ')}`;
    // ---- the library (library.ts, docs/decisions.md 36)
    case 'v1.LibraryItemDefined':
      return libraryItem() ?? str('name') ?? (typeof p['description'] === 'string' ? null : 'description must be a string') ??
        (p['copiedFrom'] === undefined || (isObject(p['copiedFrom']) && nonEmpty(p['copiedFrom'], 'orgId', 'orgName', 'itemId') && hash((p['copiedFrom'] as Record<string, unknown>)['docHash']))
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
    case 'v2.LaneTemplateSelected':
      return str('laneId', 'itemId', 'unitPrefix') ?? (hash(p['docHash']) ? null : 'docHash must be a SHA-256 hex digest') ??
        (/[/\s]/.test(p['unitPrefix'] as string) ? 'unitPrefix may not contain / or spaces' : null) ??
        (p['books'] === undefined || (Array.isArray(p['books']) && (p['books'] as unknown[]).every((b) => typeof b === 'string' && /^[A-Z0-9]{3}$/.test(b)))
          ? null : 'books must be USFM book codes');
    case 'v1.LaneUnitHidden':
      return str('laneId', 'unitId') ?? bool('hidden');
    case 'v2.LaneFlowSelected':
      return str('laneId', 'flowId', 'itemId', 'name') ?? (hash(p['docHash']) ? null : 'docHash must be a SHA-256 hex digest') ??
        (typeof p['catalogVersion'] === 'number' && p['catalogVersion'] >= 2 ? null : 'catalogVersion must be 2 or more') ??
        (/[/@\s]/.test(p['flowId'] as string) ? 'flowId may not contain /, @ or spaces' : null);
    default:
      return null;
  }
}

/** A membership scope: org, or project with projectId, or lane with projectId and laneId. */
function scope(v: unknown): string | null {
  if (!isObject(v)) return 'scope must be an object';
  const level = v['level'];
  if (level === 'org') return null;
  if (typeof v['projectId'] !== 'string' || v['projectId'] === '') return 'scope.projectId required';
  if (level === 'project') return null;
  if (level === 'lane') return typeof v['laneId'] === 'string' && v['laneId'] !== '' ? null : 'scope.laneId required';
  return 'scope.level must be org, project or lane';
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
