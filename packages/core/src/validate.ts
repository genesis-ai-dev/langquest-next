import { validTakeMetadata } from './audioEdits';
import { validateTextTranslation } from './textTranslations';
import { validateObt } from './obt';
import { validateBibleEvent } from './dynamicBible';
import type { AnyEvent, Role } from './events';
import { PRIVILEGES } from './org';

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
  if (e.type === 'v1.TakeMetadataSet') return typeof p.takeId === 'string' && p.takeId.length > 0 && typeof p.unitId === 'string' && !!p.unitId && typeof p.laneId === 'string' && !!p.laneId && validTakeMetadata(p) ? null : 'Invalid recording metadata';
  if (e.type === 'v1.TextTranslationCreated') return validateTextTranslation(p);
  if (e.type === 'v1.BibleSettingsSet' || e.type === 'v1.BiblePassageSelected') {
    return validateBibleEvent(e.type, p);
  }
  if (e.type.startsWith('v1.Obt')) return validateObt(e.type, p);
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
    case 'v1.InviteIssued':
      return str('inviteId', 'roleId', 'expiresAt') ?? scope(p['scope']);
    case 'v1.InviteRedeemed':
      return str('inviteId', 'profileId');
    case 'v1.JoinDecided':
      return str('requestId', 'profileId') ?? (typeof p['accepted'] === 'boolean' ? null : 'accepted must be a boolean');
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

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
