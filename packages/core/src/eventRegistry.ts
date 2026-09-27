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
  /**
   * For a `'by_kind'` type added after the registry: the concrete privilege
   * one payload needs. It must equal the SQL `event_privilege` case for the
   * type. (MaterialDefined and CatalogItemToggled resolve in org.ts, as before.)
   */
  privilegeOf?: (p: Record<string, unknown>) => Privilege;
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
    validate: (p) => str(p, 'profileId') ?? (sqlIn(p, 'role', ROLES) ? null : 'role must be a role'),
    privilege: 'invite_members', blobHashes: noBlobs, shipped: true,
    example: { profileId: 'ex-member', role: 'translator' }
  },
  'v1.MemberRoleChanged': {
    validate: (p) => str(p, 'profileId') ?? (sqlIn(p, 'role', ROLES) ? null : 'role must be a role'),
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
      (sqlNullOrStr(p, 'parentUnitId') ? null : 'parentUnitId must be a string or null'),
    privilege: 'manage_templates', blobHashes: noBlobs, shipped: true,
    example: { unitId: 'ex-unit', parentUnitId: null, kind: 'passage', label: 'Example 1:1', order: 'a0' }
  },
  'v1.ReferenceAttached': {
    validate: (p) => str(p, 'unitId', 'refId', 'kind'),
    privilege: 'fill_reference', blobHashes: (p) => hashes(p['blobHash']), shipped: true,
    example: { unitId: 'ex-unit', refId: 'ex-ref', kind: 'overview_audio', blobHash: HASH, text: 'Overview' }
  },
  'v1.RecordingAdded': {
    validate: (p) =>
      str(p, 'recordingId', 'unitId', 'laneId') ??
      (sqlIn(p, 'kind', ['source', 'target']) ? null : 'kind must be source or target') ??
      cards(p, 'cards'),
    privilege: 'translate', blobHashes: (p) => cardHashes(p['cards']), shipped: true,
    example: { recordingId: 'ex-rec', unitId: 'ex-unit', laneId: 'ex-lane', kind: 'target', cards: [{ hash: HASH, durationMs: 1000, format: 'wav' }] }
  },
  'v1.TakeComposed': {
    validate: (p) =>
      str(p, 'takeId', 'unitId', 'laneId') ??
      strArray(p, 'cardHashes') ??
      (sqlNullOrStr(p, 'parentTakeId') ? null : 'parentTakeId must be a string or null'),
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
      (sqlIn(p, 'decision', ['approve', 'suggest_changes']) ? null : 'decision must be approve or suggest_changes'),
    privilege: 'review', blobHashes: noBlobs, shipped: true,
    example: { takeId: 'ex-take', stepId: 'ex-step', decision: 'suggest_changes', comment: 'Unclear', answers: { q1: 'yes' } }
  },
  'v1.AssignmentMade': {
    validate: (p) => str(p, 'unitId', 'laneId', 'profileId') ?? (sqlIn(p, 'role', ROLES) ? null : 'role must be a role'),
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
    validate: (p) => str(p, 'eventId'),
    privilege: 'manage_structure', blobHashes: noBlobs, shipped: true,
    example: { eventId: 'ex-missing-event', reason: 'mistake' }
  },
  'v1.BlobInvalidated': {
    validate: (p) => str(p, 'hash'),
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

  // ---- Phase 2 flows (SQL 20260927000001_flow_kinds.sql).
  'v2.WorkflowStepSet': {
    validate: (p) =>
      str(p, 'stepId', 'order') ?? optStr(p, 'laneId') ?? optText(p, 'label') ??
      (Array.isArray(p['kindIds']) && p['kindIds'].length >= 1 && p['kindIds'].length <= 20 &&
        (p['kindIds'] as unknown[]).every((k) => typeof k === 'string' && k !== '')
        ? null : 'kindIds must hold 1 to 20 non-empty strings') ??
      (typeof p['checkpoint'] === 'boolean' ? null : 'checkpoint must be a boolean'),
    privilege: 'manage_flows', blobHashes: noBlobs, shipped: true,
    example: { stepId: 'ex-step-v2', laneId: 'ex-lane', order: 's00', kindIds: ['kind@1/peer', 'ex-kind'], checkpoint: true, label: 'Together' }
  },
  'v1.ReviewKindDefined': {
    validate: (p) =>
      str(p, 'kindId', 'name') ?? ([...String(p['name'])].length <= 200 ? null : 'name is too long') ?? optText(p, 'icon') ??
      (p['withholdsContext'] === undefined || typeof p['withholdsContext'] === 'boolean' ? null : 'withholdsContext must be a boolean') ??
      (p['produces'] === undefined ? null
        : isObject(p['produces']) && str(p['produces'], 'what', 'language', 'checkedByKindId') === null
          ? null : 'produces needs what, language and checkedByKindId'),
    privilege: 'manage_flows', blobHashes: noBlobs, shipped: true,
    example: { kindId: 'ex-kind', name: 'Elder Review', icon: 'chat', withholdsContext: true, produces: { what: 'back translation', language: 'eng', checkedByKindId: 'kind@1/consultant' } }
  },

  'v1.CheckRecorded': {
    validate: (p) =>
      str(p, 'checkId', 'unitId', 'laneId', 'takeId', 'kindId') ?? optStr(p, 'stepId') ?? optStr(p, 'requestId') ??
      optText(p, 'comment') ?? optStr(p, 'commentBlobHash') ??
      (p['outcome'] === 'looks_good' || p['outcome'] === 'needs_changes' ? null : 'outcome must be looks_good or needs_changes') ??
      (p['outcome'] === 'needs_changes' && !sqlStr(p, 'comment') && !sqlStr(p, 'commentBlobHash') ? 'needs changes must say what: comment or commentBlobHash' : null) ??
      (p['answers'] === undefined || (isObject(p['answers']) && Object.values(p['answers']).every((v) => typeof v === 'string'))
        ? null : 'answers must map question ids to strings') ??
      (p['skippedQuestions'] === undefined || (Array.isArray(p['skippedQuestions']) &&
        (p['skippedQuestions'] as unknown[]).every((q) => isObject(q) && str(q, 'questionId', 'reason') === null))
        ? null : 'skippedQuestions entries need questionId and reason'),
    privilege: 'review', blobHashes: (p) => hashes(p['commentBlobHash']), shipped: true,
    example: {
      checkId: 'ex-check', unitId: 'ex-unit', laneId: 'ex-lane', takeId: 'ex-take', kindId: 'kind@1/peer', stepId: 'ex-step-v2',
      outcome: 'needs_changes', comment: 'Slow down in verse 2', commentBlobHash: HASH, answers: { q1: 'yes' },
      skippedQuestions: [{ questionId: 'q2', reason: 'Not asked in this language' }], requestId: 'ex-request'
    }
  },

  // ---- Phase 2b departures (SQL 20260927000003_departures.sql).
  'v1.StepSetAside': {
    validate: (p) =>
      str(p, 'departureId', 'unitId', 'laneId', 'stepId') ?? optStr(p, 'kindId') ?? reasonGiven(p),
    privilege: 'translate', blobHashes: (p) => hashes(p['reasonBlobHash']), shipped: true,
    example: { departureId: 'ex-departure', unitId: 'ex-unit', laneId: 'ex-lane', stepId: 'ex-step-v2', kindId: 'kind@1/peer', reason: 'No one available for this right now', reasonBlobHash: HASH }
  },
  'v1.CheckpointOverridden': {
    validate: (p) => str(p, 'departureId', 'unitId', 'laneId', 'stepId') ?? reasonGiven(p),
    privilege: 'manage_flows', blobHashes: (p) => hashes(p['reasonBlobHash']), shipped: true,
    example: { departureId: 'ex-override', unitId: 'ex-unit', laneId: 'ex-lane', stepId: 'ex-step-v2', reason: 'Checked informally — will record it later', reasonBlobHash: HASH }
  },
  'v1.DepartureUndone': {
    validate: (p) =>
      str(p, 'undoId', 'departureId') ?? optText(p, 'reason') ??
      (p['departureKind'] === 'set_aside' || p['departureKind'] === 'override' ? null : 'departureKind must be set_aside or override'),
    // Undoing needs the privilege of the departure it names (SQL: the same case).
    privilege: 'by_kind', privilegeOf: (p) => (p['departureKind'] === 'set_aside' ? 'translate' : 'manage_flows'),
    blobHashes: noBlobs, shipped: true,
    example: { undoId: 'ex-undo', departureId: 'ex-departure', departureKind: 'set_aside', reason: 'Peer is back from leave' }
  },

  // ---- Phase 2b kept feedback (SQL 20260927000004_feedback_kept.sql).
  'v1.FeedbackKept': {
    validate: (p) =>
      str(p, 'keptId') ?? optStr(p, 'checkId') ??
      (p['legacyTarget'] === undefined || (isObject(p['legacyTarget']) && str(p['legacyTarget'], 'takeId', 'stepId', 'reviewerId') === null)
        ? null : 'legacyTarget needs takeId, stepId and reviewerId') ??
      (p['checkId'] !== undefined || p['legacyTarget'] !== undefined ? null : 'name the feedback: checkId or legacyTarget') ??
      reasonGiven(p),
    privilege: 'translate', blobHashes: (p) => hashes(p['reasonBlobHash']), shipped: true,
    example: {
      keptId: 'ex-kept', checkId: 'ex-check', legacyTarget: { takeId: 'ex-take', stepId: 'ex-step', reviewerId: 'ex-member' },
      reason: 'Listeners preferred the current wording', reasonBlobHash: HASH
    }
  },

  // ---- Phase 2b requests (SQL 20260927000005_requests.sql).
  'v1.RequestMade': {
    validate: (p) =>
      str(p, 'requestId', 'unitId', 'laneId') ??
      (p['what'] === 'record' || p['what'] === 'check' ? null : 'what must be record or check') ??
      optStr(p, 'kindId') ?? optStr(p, 'assigneeId') ?? optStr(p, 'noteBlobHash') ?? optStr(p, 'questionSetId') ?? optText(p, 'note') ??
      (p['dueDate'] === undefined || (typeof p['dueDate'] === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(p['dueDate']))
        ? null : 'dueDate must be an ISO date (YYYY-MM-DD)'),
    // Asking to record assigns work; asking for a check sends to reviewers (SQL: the same case).
    privilege: 'by_kind', privilegeOf: (p) => (p['what'] === 'check' ? 'send_to_reviewers' : 'assign_work'),
    blobHashes: (p) => hashes(p['noteBlobHash']), shipped: true,
    example: {
      requestId: 'ex-request', unitId: 'ex-unit', laneId: 'ex-lane', what: 'check', kindId: 'kind@1/consultant', assigneeId: 'ex-member',
      dueDate: '2026-10-04', note: 'Listen for the names', noteBlobHash: HASH, questionSetId: 'ex-material'
    }
  },
  'v1.RequestWithdrawn': {
    validate: (p) => str(p, 'requestId') ?? optText(p, 'reason'),
    privilege: 'send_to_reviewers', blobHashes: noBlobs, shipped: true,
    example: { requestId: 'ex-request', reason: 'Asked the wrong person' }
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
    validate: (p) => (sqlStr(p, 'profileId', 'roleId') ? null : 'profileId and roleId must be non-empty strings') ?? scopeError(p['scope']),
    privilege: 'invite_members', blobHashes: noBlobs, shipped: true,
    example: { profileId: 'ex-member', roleId: 'ex-role', scope: { level: 'lane', projectId: 'ex-project', laneId: 'ex-lane' }, displayName: 'Example' }
  },
  'v1.OrgMemberRemoved': {
    validate: (p) => (sqlStr(p, 'profileId') ? null : 'profileId must be a non-empty string') ?? scopeError(p['scope']),
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
    // SQL checks only that scope is an object; the org fold ignores an invite whose scope is not a membership scope.
    validate: (p) => str(p, 'inviteId', 'roleId', 'expiresAt') ?? (isObject(p['scope']) ? null : 'scope must be an object'),
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
/** Absent, or a non-empty string. SQL: `p ? k and not _is_str(p->k)` refuses. */
function optStr(p: Record<string, unknown>, k: string): string | null {
  return p[k] === undefined || (typeof p[k] === 'string' && p[k] !== '') ? null : `${k} must be a non-empty string`;
}
/** Absent, or a string. SQL: `p ? k and jsonb_typeof(p->k) <> 'string'` refuses. */
function optText(p: Record<string, unknown>, k: string): string | null {
  return p[k] === undefined || typeof p[k] === 'string' ? null : `${k} must be a string`;
}
/**
 * A departure or a kept version says why: `reason` (optional text) and
 * `reasonBlobHash` (optional voice), at least one non-empty. SQL: the same.
 */
function reasonGiven(p: Record<string, unknown>): string | null {
  return optText(p, 'reason') ?? optStr(p, 'reasonBlobHash') ??
    (sqlStr(p, 'reason') || sqlStr(p, 'reasonBlobHash') ? null : 'say why: reason or reasonBlobHash');
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

/**
 * SQL `jsonb_typeof(p->'k') not in ('null', 'string')`: an absent key has a
 * NULL type, the comparison is NULL, and the IF does not fire. So absent,
 * JSON null and any string pass.
 */
function sqlNullOrStr(p: Record<string, unknown>, k: string): boolean {
  const v = p[k];
  return v === undefined || v === null || typeof v === 'string';
}

/** A membership scope: org, or project with projectId, or lane with projectId and laneId. Same as SQL `_scope_error`. */
export function scopeError(v: unknown): string | null {
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
