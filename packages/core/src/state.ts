import { emptyReferenceState, type ReferenceState } from './references';
import type { Card } from './events';
import type { Hlc } from './hlc';
import { emptyRecordState, type RecordState } from './record';

/**
 * Projected state of one language's stream. Plain JSON so it can be
 * snapshotted and compared structurally. Nothing here is written directly;
 * only the reducer produces it. Who works in the language is not here: it
 * comes from the organization's memberships (`languagePeople`, org.ts).
 */

/** A last-writer-wins register: the value plus the clock that set it. */
export interface Register<V> {
  value: V;
  hlc: Hlc;
  eventId: string;
}

interface Unit {
  parentUnitId: string | null;
  kind: string;
  label: string;
  order: string;
  /** Clock of the UnitAdded that stands: the earliest (reducer `earlier`). */
  hlc: Hlc;
}

interface Recording {
  unitId: string;
  kind: 'source' | 'target';
  cards: Card[];
  actorId: string;
  hlc: Hlc;
}

interface Take {
  unitId: string;
  cardHashes: string[];
  parentTakeId: string | null;
  actorId: string;
  hlc: Hlc;
  archived: boolean;
}

interface Submission {
  takeId: string;
  actorId: string;
  hlc: Hlc;
  questionSetIds: string[];
}

export interface ReviewTeam {
  name: Register<string>;
  /** profileId -> in the team (register) */
  members: Record<string, Register<boolean>>;
  /** The kind it usually reviews (v1.ReviewTeamKindSet); absent or null = any. */
  kindId?: Register<string | null>;
}

export interface Material {
  kind: string;
  title: string;
  scope: { unitId?: string; stepId?: string };
  templateRef?: string;
  createdBy: string;
  hlc: Hlc;
  /** fieldId -> content register */
  fields: Record<string, Register<{ text?: string; blobHash?: string }>>;
  locked: Register<boolean>;
}

interface KeyTerm {
  term: string;
  gloss: string;
  unitScope: string[];
  /** Clock of the KeyTermDefined that stands (the earliest), or '' for a placeholder left by an early rendering. */
  hlc: Hlc;
  renderings: Record<string, { rendering: string; context: string; hlc: Hlc }>;
  adjustments: Record<string, { note: string; blobHash?: string; duringTakeId?: string; actorId: string; hlc: Hlc }>;
}

/** The template a language uses (v1.TemplateSelected). */
interface TemplateSelection {
  itemId: string;
  docHash: string;
  /** What its units' ids start with (`${unitPrefix}/${node}`). */
  unitPrefix: string;
  /** The books the language covers; absent means every book. */
  books?: string[];
}

/** The flow a language uses (v1.FlowSelected); `flowId` is its steps' prefix. */
export interface FlowSelection {
  flowId: string;
  itemId?: string;
  docHash?: string;
  name?: string;
}

export interface LanguageState extends RecordState, ReferenceState {
  units: Record<string, Unit>;
  recordings: Record<string, Recording>;
  takes: Record<string, Take>;
  /** takeId -> submission (grow-only; first submission is the one that counts) */
  submissions: Record<string, Submission>;
  /**
   * hash -> latest server verdict (LWW by clock): stored with this size, or
   * invalidated. Only the server writes these events.
   */
  blobs: Record<string, { size: number; hlc: Hlc; eventId: string; stored: boolean }>;
  /** hash -> a voice note's format, when it is not m4a (v1.AudioFormatSet; earliest wins). */
  audioFormats: Record<string, Register<'wav' | 'm4a'>>;
  /** Idempotency guard. Compacted away when a snapshot is taken. */
  appliedEventIds: Record<string, true>;
  /** eventId -> reason. Malformed events are skipped, never thrown on. */
  invalidEvents: Record<string, string>;
  /** eventId -> true. Targets of v1.Redacted; never applied. */
  redactions: Record<string, true>;
  template: Register<TemplateSelection> | null;
  /** unitId -> hidden (TPL-7): parts the template's current version no longer has. */
  hiddenUnits: Record<string, Register<boolean>>;
  /** USFM book -> what this language calls it (v1.BookNameSet, decision 74); absent in older snapshots. */
  bookNames?: Record<string, Register<string>>;
  flow: Register<FlowSelection> | null;
  teams: Record<string, ReviewTeam>;
  /** stepId -> may it be reviewed by a shared link (v1.FlowStepLinksSet). */
  stepLinks: Record<string, Register<boolean>>;
  /** takeId -> channel -> live there (v1.VersionReleased). */
  releases: Record<string, Record<string, Register<{ live: boolean; url?: string; by: string }>>>;
  /** takeId -> the translator's response that produced it */
  responses: Record<string, { respondsToTakeId: string; note?: string; blobHash?: string; actorId: string; hlc: Hlc }>;
  materials: Record<string, Material>;
  keyTerms: Record<string, KeyTerm>;
  /** takeId -> termId -> link */
  keyTermLinks: Record<string, Record<string, { note?: string; adjustmentId?: string; actorId: string; hlc: Hlc }>>;
}

export function emptyLanguageState(): LanguageState {
  return {
    units: {},
    recordings: {},
    takes: {},
    submissions: {},
    blobs: {},
    audioFormats: {},
    appliedEventIds: {},
    invalidEvents: {},
    redactions: {},
    template: null,
    hiddenUnits: {},
    flow: null,
    teams: {},
    stepLinks: {},
    releases: {},
    responses: {},
    materials: {},
    keyTerms: {},
    keyTermLinks: {},
    ...emptyRecordState(),
    ...emptyReferenceState()
  };
}

