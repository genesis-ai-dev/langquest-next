import { validTakeMetadata } from './audioEdits';
import { validateBibleEvent } from './dynamicBible';
import type { EventPayloads, EventType, Role } from './events';
import { validateObt } from './obt';
import { PRIVILEGES, type Privilege } from './privileges';
import { validateTextTranslation } from './textTranslations';

/**
 * The single place that says what every event type is on the write side:
 * its payload rule, the privilege it needs, which blobs it references, a
 * minimal valid example, and whether it has shipped.
 *
 * Write, transport and read stay separate concerns. Commands and the server
 * door use `validate` and `privilege`. Transport and storage never look here;
 * they carry any type, known or not. Reducers read the payload types only.
 *
 * `satisfies` makes a missing entry for any EventType a compile error. The
 * guard tests (test/eventRegistry.test.ts) check the rest: examples pass,
 * privileges equal SQL `event_privilege`, every type is in SQL
 * `validate_payload`, and shipped shapes never change (test/shipped-events.json).
 *
 * Every `validate` must equal the SQL `validate_payload` rule for its type
 * (PLAN.md invariant 11). Never make a shipped rule stricter than SQL: the
 * fold would then drop events the server accepted from older clients.
 * This module must not import org.ts, validate.ts or reducer.ts: org.ts
 * re-exports EVENT_PRIVILEGE from here, and a cycle leaves it uninitialized
 * at load time in the Metro web bundle.
 */
export interface EventRegistryEntry<T extends EventType> {
  /** Payload rule. `null` means valid. Must never throw on any JSON object. */
  validate: (p: Record<string, unknown>) => string | null;
  /** Same semantics as EVENT_PRIVILEGE: null = server-only, 'by_kind' = see privilegeFor. */
  privilege: Privilege | 'bootstrap' | 'by_kind' | null;
  /** Blob hashes this payload references, the ones `referencedBlobs` derives from it. */
  blobHashes: (p: Record<string, unknown>) => string[];
  /** A minimal valid payload with every optional field filled. Fixtures and the shape snapshot use it. */
  example: EventPayloads[T];
  /** Shipped events never change shape (PLAN.md section 6). Add a v2 event instead. */
  shipped: boolean;
}

const ROLES: readonly Role[] = ['owner', 'coordinator', 'translator', 'reviewer', 'viewer'];
const HASH = 'a'.repeat(64);
const noBlobs = (): string[] => [];

export const EVENT_REGISTRY = {
  // ---- project partition, core catalog
  'v1.ProjectCreated': {
    validate: (p) => str(p, 'name', 'sourceLanguoidId'),
    privilege: 'bootstrap', blobHashes: noBlobs, shipped: true,
    example: { name: 'Luke', sourceLanguoidId: 'eng' }
  },
  'v1.ProjectConfigChanged': {
    validate: (p) => (isObject(p['config']) ? null : 'config must be an object'),
    privilege: 'manage_structure', blobHashes: noBlobs, shipped: true,
    example: {
      config: {
        unitKinds: [{ id: 'book', label: 'Book', childKinds: [] }],
        workflow: [{ id: 'ex-step', role: 'reviewer', teamId: 'ex-team', required: true, rule: 'any', label: 'Peer' }]
      }
    }
  },
  'v1.MemberAdded': {
    validate: (p) => str(p, 'profileId') ?? role(p, 'role'),
    privilege: 'invite_members', blobHashes: noBlobs, shipped: true,
    example: { profileId: 'ex-member', role: 'translator' }
  },
  'v1.MemberRoleChanged': {
    validate: (p) => str(p, 'profileId') ?? role(p, 'role'),
    privilege: 'invite_members', blobHashes: noBlobs, shipped: true,
    example: { profileId: 'ex-member', role: 'reviewer' }
  },
  'v1.MemberRemoved': {
    validate: (p) => str(p, 'profileId'),
    privilege: 'invite_members', blobHashes: noBlobs, shipped: true,
    example: { profileId: 'ex-member' }
  },
  'v1.LaneAdded': {
    validate: (p) => str(p, 'laneId', 'languoidId'),
    privilege: 'manage_structure', blobHashes: noBlobs, shipped: true,
    example: { laneId: 'ex-lane', languoidId: 'xyz' }
  },
  'v1.UnitAdded': {
    validate: (p) =>
      str(p, 'unitId', 'kind', 'label', 'order') ??
      (p['parentUnitId'] === null || typeof p['parentUnitId'] === 'string' ? null : 'parentUnitId must be a string or null'),
    privilege: 'manage_templates', blobHashes: noBlobs, shipped: true,
    example: { unitId: 'ex-unit', parentUnitId: null, kind: 'passage', label: 'Example 1:1', order: 'a0' }
  },
  'v1.ReferenceAttached': {
    validate: (p) => str(p, 'unitId', 'refId', 'kind') ?? optStr(p, 'blobHash', 'text'),
    privilege: 'fill_reference', blobHashes: (p) => hashes(p['blobHash']), shipped: true,
    example: { unitId: 'ex-unit', refId: 'ex-ref', kind: 'overview_audio', blobHash: HASH, text: 'Overview' }
  },
  'v1.RecordingAdded': {
    validate: (p) =>
      str(p, 'recordingId', 'unitId', 'laneId') ??
      (p['kind'] === 'source' || p['kind'] === 'target' ? null : 'kind must be source or target') ??
      cards(p, 'cards'),
    privilege: 'translate', blobHashes: (p) => cardHashes(p['cards']), shipped: true,
    example: { recordingId: 'ex-rec', unitId: 'ex-unit', laneId: 'ex-lane', kind: 'target', cards: [{ hash: HASH, durationMs: 1000, format: 'wav' }] }
  },
  'v1.TakeComposed': {
    validate: (p) =>
      str(p, 'takeId', 'unitId', 'laneId') ??
      strArray(p, 'cardHashes') ??
      (p['parentTakeId'] === null || typeof p['parentTakeId'] === 'string' ? null : 'parentTakeId must be a string or null'),
    // Card hashes point at RecordingAdded cards; the recording is what references the blob.
    privilege: 'translate', blobHashes: noBlobs, shipped: true,
    example: { takeId: 'ex-take', unitId: 'ex-unit', laneId: 'ex-lane', cardHashes: [HASH], parentTakeId: null }
  },
  'v1.TakeMetadataSet': {
    validate: (p) =>
      typeof p['takeId'] === 'string' && p['takeId'].length > 0 && typeof p['unitId'] === 'string' && !!p['unitId'] &&
      typeof p['laneId'] === 'string' && !!p['laneId'] && validTakeMetadata(p)
        ? null
        : 'Invalid recording metadata',
    privilege: 'translate', blobHashes: noBlobs, shipped: true,
    example: { takeId: 'ex-take', unitId: 'ex-unit', laneId: 'ex-lane', name: 'Example', milestones: [{ verseStart: 1, verseEnd: 1, startMs: 0, endMs: 500 }] }
  },
  'v1.TakeArchived': {
    validate: (p) => str(p, 'takeId'),
    privilege: 'translate', blobHashes: noBlobs, shipped: true,
    example: { takeId: 'ex-take' }
  },
  'v1.TakeSelected': {
    validate: (p) => str(p, 'unitId', 'laneId', 'takeId'),
    privilege: 'translate', blobHashes: noBlobs, shipped: true,
    example: { unitId: 'ex-unit', laneId: 'ex-lane', takeId: 'ex-take' }
  },
  'v1.TakeSubmitted': {
    validate: (p) => str(p, 'takeId'),
    privilege: 'translate', blobHashes: noBlobs, shipped: true,
    example: { takeId: 'ex-take', questionSetIds: ['ex-material'] }
  },
  'v1.ReviewSubmitted': {
    validate: (p) =>
      str(p, 'takeId', 'stepId') ??
      (p['decision'] === 'approve' || p['decision'] === 'suggest_changes' ? null : 'decision must be approve or suggest_changes') ??
      optStr(p, 'comment'),
    privilege: 'review', blobHashes: noBlobs, shipped: true,
    example: { takeId: 'ex-take', stepId: 'ex-step', decision: 'suggest_changes', comment: 'Unclear', answers: { q1: 'yes' } }
  },
  'v1.AssignmentMade': {
    validate: (p) => str(p, 'unitId', 'laneId', 'profileId') ?? role(p, 'role') ?? optStr(p, 'dueDate', 'instructions'),
    privilege: 'assign_work', blobHashes: noBlobs, shipped: true,
    example: { unitId: 'ex-unit', laneId: 'ex-lane', profileId: 'ex-member', role: 'translator', dueDate: '2026-10-01', instructions: 'Record it' }
  },
  'v1.SourceImported': {
    validate: (p) =>
      str(p, 'sourceProjectId') ?? (typeof p['sourceSeq'] === 'number' ? null : 'sourceSeq must be a number') ?? strArray(p, 'unitIds'),
    privilege: 'manage_structure', blobHashes: noBlobs, shipped: true,
    example: { sourceProjectId: 'ex-source', sourceSeq: 1, unitIds: ['ex-unit'] }
  },
  'v1.BlobStored': {
    validate: (p) => str(p, 'hash') ?? (typeof p['size'] === 'number' ? null : 'size must be a number'),
    // A storage verdict, not a reference: it never adds upload or download work.
    privilege: null, blobHashes: noBlobs, shipped: true,
    example: { hash: HASH, size: 1 }
  },
  'v1.Redacted': {
    validate: (p) => str(p, 'eventId') ?? optStr(p, 'reason'),
    privilege: 'manage_structure', blobHashes: noBlobs, shipped: true,
    example: { eventId: 'ex-missing-event', reason: 'mistake' }
  },
  'v1.BlobInvalidated': {
    validate: (p) => str(p, 'hash') ?? optStr(p, 'reason'),
    privilege: null, blobHashes: noBlobs, shipped: true,
    example: { hash: HASH, reason: 'hash mismatch' }
  },

  // ---- step 11: catalog selection, per-step workflow, teams, respond loop.
  // Rules mirror SQL validate_payload exactly (20260917125750).
  'v1.LaneTemplateSelected': {
    validate: (p) =>
      (sqlStr(p, 'laneId', 'templateId') ? null : 'laneId and templateId must be non-empty strings') ??
      (typeof p['catalogVersion'] === 'number' ? null : 'catalogVersion must be a number'),
    privilege: 'manage_templates', blobHashes: noBlobs, shipped: true,
    example: { laneId: 'ex-lane', templateId: 'book', catalogVersion: 1 }
  },
  'v1.LaneFlowSelected': {
    validate: (p) =>
      (sqlStr(p, 'laneId', 'flowId') ? null : 'laneId and flowId must be non-empty strings') ??
      (typeof p['catalogVersion'] === 'number' ? null : 'catalogVersion must be a number'),
    privilege: 'manage_flows', blobHashes: noBlobs, shipped: true,
    example: { laneId: 'ex-lane', flowId: 'quick_check', catalogVersion: 1 }
  },
  'v1.WorkflowStepSet': {
    validate: (p) =>
      (sqlStr(p, 'stepId', 'order') ? null : 'stepId and order must be non-empty strings') ??
      (sqlIn(p, 'role', ROLES) ? null : 'role must be a role') ??
      (typeof p['required'] === 'boolean' ? null : 'required must be a boolean') ??
      (sqlIn(p, 'rule', ['any', 'majority', 'unanimous']) ? null : 'rule must be any, majority or unanimous'),
    privilege: 'manage_flows', blobHashes: noBlobs, shipped: true,
    example: { stepId: 'ex-step', laneId: 'ex-lane', order: 's00', label: 'Peer', role: 'reviewer', teamId: 'ex-team', required: true, rule: 'majority' }
  },
  'v1.WorkflowStepRemoved': {
    validate: (p) => (sqlStr(p, 'stepId') ? null : 'stepId must be a non-empty string'),
    privilege: 'manage_flows', blobHashes: noBlobs, shipped: true,
    example: { stepId: 'ex-removed-step' }
  },
  'v1.ReviewTeamDefined': {
    validate: (p) => (sqlStr(p, 'teamId', 'laneId', 'name') ? null : 'teamId, laneId, name must be non-empty strings'),
    privilege: 'manage_teams', blobHashes: noBlobs, shipped: true,
    example: { teamId: 'ex-team', laneId: 'ex-lane', name: 'Reviewers' }
  },
  'v1.ReviewTeamMemberSet': {
    validate: (p) =>
      (sqlStr(p, 'teamId', 'profileId') ? null : 'teamId and profileId must be non-empty strings') ??
      (typeof p['member'] === 'boolean' ? null : 'member must be a boolean'),
    privilege: 'manage_teams', blobHashes: noBlobs, shipped: true,
    example: { teamId: 'ex-team', profileId: 'ex-member', member: true }
  },
  'v1.ResponseRecorded': {
    validate: (p) => (sqlStr(p, 'takeId', 'respondsToTakeId') ? null : 'takeId and respondsToTakeId must be non-empty strings'),
    privilege: 'translate', blobHashes: (p) => hashes(p['blobHash']), shipped: true,
    example: { takeId: 'ex-take', respondsToTakeId: 'ex-previous-take', note: 'Changed verse 2', blobHash: HASH }
  },
  'v1.ReviewCommentRecorded': {
    validate: (p) => (sqlStr(p, 'takeId', 'stepId', 'blobHash') ? null : 'takeId, stepId, blobHash must be non-empty strings'),
    privilege: 'review', blobHashes: (p) => hashes(p['blobHash']), shipped: true,
    example: { takeId: 'ex-take', stepId: 'ex-step', blobHash: HASH }
  },

  // ---- step 12: materials and key terms (SQL 20260914000011, unchanged since)
  'v1.MaterialDefined': {
    validate: (p) =>
      (sqlStr(p, 'materialId', 'kind', 'title') ? null : 'materialId, kind, title must be non-empty strings') ??
      (isObject(p['scope']) ? null : 'scope must be an object'),
    privilege: 'by_kind', blobHashes: noBlobs, shipped: true,
    example: { materialId: 'ex-material', kind: 'tmf', title: 'Framework', scope: { laneId: 'ex-lane', unitId: 'ex-unit', stepId: 'ex-step' }, templateRef: 'tmf' }
  },
  'v1.MaterialFieldSet': {
    validate: (p) => (sqlStr(p, 'materialId', 'fieldId') ? null : 'materialId and fieldId must be non-empty strings'),
    privilege: 'fill_reference', blobHashes: (p) => hashes(p['blobHash']), shipped: true,
    example: { materialId: 'ex-material', fieldId: 'body', text: 'Four checks', blobHash: HASH }
  },
  'v1.MaterialLocked': {
    validate: (p) =>
      (sqlStr(p, 'materialId') ? null : 'materialId must be a non-empty string') ??
      (typeof p['locked'] === 'boolean' ? null : 'locked must be a boolean'),
    privilege: 'manage_reference', blobHashes: noBlobs, shipped: true,
    example: { materialId: 'ex-material', locked: true }
  },
  'v1.StepQuestionSetLinked': {
    validate: (p) => (sqlStr(p, 'stepId', 'materialId') ? null : 'stepId and materialId must be non-empty strings'),
    privilege: 'manage_flows', blobHashes: noBlobs, shipped: true,
    example: { stepId: 'ex-step', materialId: 'ex-material' }
  },
  'v1.KeyTermDefined': {
    validate: (p) =>
      (sqlStr(p, 'termId', 'laneId', 'term') ? null : 'termId, laneId, term must be non-empty strings') ??
      (typeof p['gloss'] === 'string' ? null : 'gloss must be a string') ??
      (sqlStrArray(p['unitScope']) ? null : 'unitScope must be a string array'),
    privilege: 'fill_reference', blobHashes: noBlobs, shipped: true,
    example: { termId: 'ex-term', laneId: 'ex-lane', term: 'Word', gloss: 'Logos', unitScope: ['ex-unit'] }
  },
  'v1.KeyTermRenderingAdded': {
    validate: (p) =>
      (sqlStr(p, 'termId', 'renderingId', 'rendering') ? null : 'termId, renderingId, rendering must be non-empty strings') ??
      (typeof p['context'] === 'string' ? null : 'context must be a string'),
    privilege: 'fill_reference', blobHashes: noBlobs, shipped: true,
    example: { termId: 'ex-term', renderingId: 'ex-rendering', rendering: 'Wët', context: 'divine' }
  },
  'v1.KeyTermAdjusted': {
    validate: (p) =>
      (sqlStr(p, 'termId', 'adjustmentId') ? null : 'termId and adjustmentId must be non-empty strings') ??
      (typeof p['note'] === 'string' ? null : 'note must be a string'),
    privilege: 'fill_reference', blobHashes: (p) => hashes(p['blobHash']), shipped: true,
    example: { termId: 'ex-term', adjustmentId: 'ex-adjustment', note: 'Standardized', blobHash: HASH, duringTakeId: 'ex-take' }
  },
  'v1.KeyTermLinked': {
    validate: (p) => (sqlStr(p, 'takeId', 'termId') ? null : 'takeId and termId must be non-empty strings'),
    privilege: 'fill_reference', blobHashes: noBlobs, shipped: true,
    example: { takeId: 'ex-take', termId: 'ex-term', note: 'Used it', adjustmentId: 'ex-adjustment' }
  },

  // ---- org partition (SQL 20260914000009, unchanged since)
  'v1.OrgCreated': {
    validate: (p) => (sqlStr(p, 'name') ? null : 'name must be a non-empty string'),
    privilege: 'bootstrap', blobHashes: noBlobs, shipped: true,
    example: { name: 'Example org' }
  },
  'v1.RoleDefined': {
    validate: (p) =>
      (sqlStr(p, 'roleId', 'name') ? null : 'roleId and name must be non-empty strings') ??
      (Array.isArray(p['privileges']) && p['privileges'].every((x) => typeof x === 'string' && (PRIVILEGES as readonly string[]).includes(x))
        ? null
        : 'privileges must be an array of known privileges'),
    privilege: 'manage_roles', blobHashes: noBlobs, shipped: true,
    example: { roleId: 'ex-role', name: 'Example role', privileges: ['translate', 'view_status'] }
  },
  'v1.RoleRetired': {
    validate: (p) => (sqlStr(p, 'roleId') ? null : 'roleId must be a non-empty string'),
    privilege: 'manage_roles', blobHashes: noBlobs, shipped: true,
    example: { roleId: 'ex-role' }
  },
  'v1.OrgMemberAdded': {
    validate: (p) => (sqlStr(p, 'profileId', 'roleId') ? null : 'profileId and roleId must be non-empty strings') ?? scope(p['scope']),
    privilege: 'invite_members', blobHashes: noBlobs, shipped: true,
    example: { profileId: 'ex-member', roleId: 'ex-role', scope: { level: 'lane', projectId: 'ex-project', laneId: 'ex-lane' }, displayName: 'Example' }
  },
  'v1.OrgMemberRemoved': {
    validate: (p) => (sqlStr(p, 'profileId') ? null : 'profileId must be a non-empty string') ?? scope(p['scope']),
    privilege: 'invite_members', blobHashes: noBlobs, shipped: true,
    example: { profileId: 'ex-member', scope: { level: 'project', projectId: 'ex-project' } }
  },
  'v1.CatalogItemToggled': {
    validate: (p) =>
      (sqlStr(p, 'itemId') ? null : 'itemId must be a non-empty string') ??
      (sqlIn(p, 'kind', ['template', 'reference', 'flow']) ? null : 'kind must be template, reference or flow') ??
      (sqlIn(p, 'level', ['org', 'project']) ? null : 'level must be org or project') ??
      (p['level'] === 'project' && !sqlStr(p, 'projectId') ? 'projectId required at project level' : null) ??
      (typeof p['enabled'] === 'boolean' ? null : 'enabled must be a boolean'),
    privilege: 'by_kind', blobHashes: noBlobs, shipped: true,
    example: { kind: 'flow', itemId: 'quick_check', level: 'project', projectId: 'ex-project', enabled: true }
  },
  'v1.ProjectRegistered': {
    validate: (p) => (sqlStr(p, 'projectId', 'name') ? null : 'projectId and name must be non-empty strings'),
    privilege: 'manage_structure', blobHashes: noBlobs, shipped: true,
    example: { projectId: 'ex-project', name: 'Example project' }
  },
  'v1.InviteIssued': {
    validate: (p) => str(p, 'inviteId', 'roleId', 'expiresAt') ?? scope(p['scope']),
    privilege: 'invite_members', blobHashes: noBlobs, shipped: true,
    example: { inviteId: 'ex-invite', roleId: 'ex-role', scope: { level: 'org' }, expiresAt: '2026-10-01T00:00:00Z' }
  },
  'v1.InviteRedeemed': {
    validate: (p) => str(p, 'inviteId', 'profileId'),
    privilege: null, blobHashes: noBlobs, shipped: true,
    example: { inviteId: 'ex-invite', profileId: 'ex-member' }
  },
  'v1.JoinDecided': {
    validate: (p) => str(p, 'requestId', 'profileId') ?? (typeof p['accepted'] === 'boolean' ? null : 'accepted must be a boolean'),
    privilege: 'invite_members', blobHashes: noBlobs, shipped: true,
    example: { requestId: 'ex-request', profileId: 'ex-member', accepted: true }
  },

  // ---- Spoken Worldwide (OBT), Bible, written drafts: rules live beside their features.
  'v1.ObtPolicySet': {
    validate: (p) => validateObt('v1.ObtPolicySet', p),
    privilege: 'manage_flows', blobHashes: noBlobs, shipped: true,
    example: { laneId: 'ex-lane', consultantRole: 'reviewer', finalRole: 'coordinator', minimumInteractions: 1 }
  },
  'v1.ObtRoundStarted': {
    validate: (p) => validateObt('v1.ObtRoundStarted', p),
    privilege: 'translate', blobHashes: noBlobs, shipped: true,
    example: { unitId: 'ex-unit', laneId: 'ex-lane', roundId: 'ex-round', firstDraftId: 'ex-take', previousRoundId: null }
  },
  'v1.ObtAudioAdded': {
    validate: (p) => validateObt('v1.ObtAudioAdded', p),
    privilege: 'view_status', blobHashes: (p) => cardHashes(p['cards']), shipped: true,
    example: { unitId: 'ex-unit', laneId: 'ex-lane', clipId: 'ex-clip', cards: [{ hash: HASH, durationMs: 1000, format: 'm4a' }] }
  },
  'v1.ObtInteractionSet': {
    validate: (p) => validateObt('v1.ObtInteractionSet', p),
    privilege: 'view_status', blobHashes: (p) => hashes(p['photoHash']), shipped: true,
    example: {
      unitId: 'ex-unit', laneId: 'ex-lane', interactionId: 'ex-interaction', roundId: 'ex-round', draftId: 'ex-take',
      participantName: 'Listener', clipIds: ['ex-clip'], comments: 'Understood', photoHash: HASH
    }
  },
  'v1.ObtStepRecorded': {
    validate: (p) => validateObt('v1.ObtStepRecorded', p),
    privilege: 'view_status', blobHashes: noBlobs, shipped: true,
    example: {
      unitId: 'ex-unit', laneId: 'ex-lane', roundId: 'ex-round', step: 'back_translation', inputId: 'ex-take',
      decision: 'complete', takeId: 'ex-back-take', note: 'Done', clipIds: ['ex-clip'], language: 'English'
    }
  },
  'v1.ObtWorkspaceCreated': {
    validate: (p) => validateObt('v1.ObtWorkspaceCreated', p),
    privilege: null, blobHashes: noBlobs, shipped: true,
    example: { unitId: 'ex-unit', laneId: 'ex-lane', inputTakeId: 'ex-take', language: 'English' }
  },
  'v1.BibleSettingsSet': {
    validate: (p) => validateBibleEvent('v1.BibleSettingsSet', p),
    privilege: 'manage_reference', blobHashes: noBlobs, shipped: true,
    example: { laneId: 'ex-lane', density: 35, sourceId: 'bsb', audioFilesetId: 'ENGESV' }
  },
  'v1.BiblePassageSelected': {
    validate: (p) => validateBibleEvent('v1.BiblePassageSelected', p),
    privilege: 'translate', blobHashes: noBlobs, shipped: true,
    example: { laneId: 'ex-lane', book: 'gen', start: 1, end: 2 }
  },
  'v1.TextTranslationCreated': {
    validate: (p) => validateTextTranslation(p),
    privilege: 'translate', blobHashes: noBlobs, shipped: true,
    example: { translationId: 'ex-text', unitId: 'ex-unit', laneId: 'ex-lane', parentTranslationId: null, text: 'In the beginning', sourceText: 'In the beginning', origin: 'written' }
  }
} satisfies { [T in EventType]: EventRegistryEntry<T> };

/** Registry lookup that is safe for any string, including unfamiliar types and `constructor`. */
export function registryEntry(type: string): EventRegistryEntry<EventType> | undefined {
  return Object.prototype.hasOwnProperty.call(EVENT_REGISTRY, type)
    ? (EVENT_REGISTRY as Record<string, EventRegistryEntry<EventType>>)[type]
    : undefined;
}

/**
 * The privilege an event type needs. `null` means server-only (never a
 * client), `'bootstrap'` means the partition's creation rule applies.
 * `'by_kind'` depends on the payload kind: see `privilegeFor` in org.ts.
 * The SQL `event_privilege` is this table; keep them identical.
 */
export const EVENT_PRIVILEGE = Object.fromEntries(
  Object.entries(EVENT_REGISTRY).map(([type, entry]) => [type, entry.privilege])
) as Record<EventType, Privilege | 'bootstrap' | 'by_kind' | null>;

/** Blob hashes one event's payload references. Unfamiliar types reference none that this client knows. */
export function eventBlobHashes(event: { type: string; payload: unknown }): string[] {
  const entry = registryEntry(event.type);
  return entry && isObject(event.payload) ? entry.blobHashes(event.payload) : [];
}

// ---- rule helpers. Core names match the historic validate.ts; `sql*` mirror SQL helpers.

/** Core `str`: each key a non-empty string. Same as SQL `_is_str`. */
function str(p: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) if (typeof p[k] !== 'string' || p[k] === '') return `${k} must be a non-empty string`;
  return null;
}
function optStr(p: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) if (p[k] !== undefined && typeof p[k] !== 'string') return `${k} must be a string`;
  return null;
}
function role(p: Record<string, unknown>, k: string): string | null {
  return ROLES.includes(p[k] as Role) ? null : `${k} must be a role`;
}
function cards(p: Record<string, unknown>, k: string): string | null {
  const v = p[k];
  if (!Array.isArray(v)) return `${k} must be an array`;
  for (const c of v as unknown[]) {
    if (!isObject(c)) return `${k} entries must be objects`;
    if (typeof c['hash'] !== 'string' || c['hash'] === '') return `${k} entries need a hash`;
    if (typeof c['durationMs'] !== 'number') return `${k} entries need durationMs`;
  }
  return null;
}
function strArray(p: Record<string, unknown>, k: string): string | null {
  return sqlStrArray(p[k]) ? null : `${k} must be a string array`;
}

/** SQL `_is_str` over several keys. */
function sqlStr(p: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.every((k) => typeof p[k] === 'string' && p[k] !== '');
}
/** SQL `_is_str_array`: an array of strings (empty strings allowed). */
function sqlStrArray(v: unknown): boolean {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}
/**
 * SQL `p->>'k' not in (...)` refuses only a present value. An absent key or
 * JSON null yields SQL NULL, the comparison is NULL, and the IF does not fire.
 * So absent passes, exactly as the server accepts it.
 */
function sqlIn(p: Record<string, unknown>, k: string, allowed: readonly string[]): boolean {
  const v = p[k];
  return v === undefined || v === null || (typeof v === 'string' && allowed.includes(v));
}

/** A membership scope: org, or project with projectId, or lane with projectId and laneId. Same as SQL `_scope_error`. */
function scope(v: unknown): string | null {
  if (!isObject(v)) return 'scope must be an object';
  const level = v['level'];
  if (level === 'org') return null;
  if (typeof v['projectId'] !== 'string' || v['projectId'] === '') return 'scope.projectId required';
  if (level === 'project') return null;
  if (level === 'lane') return typeof v['laneId'] === 'string' && v['laneId'] !== '' ? null : 'scope.laneId required';
  return 'scope.level must be org, project or lane';
}

function hashes(...values: unknown[]): string[] {
  return values.filter((v): v is string => typeof v === 'string' && v !== '');
}
function cardHashes(v: unknown): string[] {
  return Array.isArray(v) ? hashes(...v.map((c) => (isObject(c) ? c['hash'] : undefined))) : [];
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
