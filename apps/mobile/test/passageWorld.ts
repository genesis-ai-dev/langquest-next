// The UI suite's fixture world (e2e/ui/fixture.ts `buildWorld`;
// docs/ui-test-suite/README.md, "The fixture world") in memory, for the
// screen-model tests (docs/testing.md layer 3): the same roles in ORG, and
// language Alpha's passages built by the same core commands in the same
// order, folded here instead of synced through the server. Deterministic:
// fixed ids, clocks from a fixed start, and a due date far ahead.
import {
  checkPeopleSpecs, commands, DEFAULT_KINDS, derivePassage, emptyLanguageState, flowTemplate, foldLanguage, foldOrg, formatQuestionField, HlcClock, ORG_STREAM,
  PRIVILEGES, SEED_ROLES,
  type AnyEvent, type EventSpec, type LanguageState, type OrgState, type Privilege, type Scope
} from '@langquest-next/core';
import { deriveSession, type Session } from '../src/shell/session';

export const WORLD_ROLES = ['ADMIN', 'COORD', 'LADMIN', 'TRANS', 'REV', 'TREV', 'VIEW', 'KEPT'] as const;
export type WorldRole = (typeof WORLD_ROLES)[number];

export const PASSAGES = ['P-NEW', 'P-DRAFT', 'P-SUBMITTED', 'P-NEEDS', 'P-BT', 'P-CHECK', 'P-ASIDE', 'P-DONE', 'P-S'] as const;
export type WorldPassage = (typeof PASSAGES)[number];

/** Display names, as the fixture gives them (fixture.ts NAMES). */
export const NAMES: Record<WorldRole, string> = {
  ADMIN: 'Ada Admin', COORD: 'Cora Coordinator', LADMIN: 'Lena Lead', TRANS: 'Tom Translator', REV: 'Rita Reviewer',
  TREV: 'Trevor Both', VIEW: 'Vic Viewer', KEPT: 'Kept Person'
};

/** Profile ids: the role's name in lower case. */
export const ID: Record<WorldRole, string> = Object.fromEntries(WORLD_ROLES.map((r) => [r, r.toLowerCase()])) as Record<WorldRole, string>;

const LANGUAGE = 'alpha';
const ORG = 'org-ui';
/** Luke's FIA passages behind each key (fixture.ts PASSAGES), as units of their own. */
const LABELS: Record<WorldPassage, string> = {
  'P-NEW': 'Luke 13:1-9', 'P-DRAFT': 'Luke 14:1-14', 'P-SUBMITTED': 'Luke 15:11-32', 'P-NEEDS': 'Luke 14:15-24', 'P-BT': 'Luke 14:25-35',
  'P-CHECK': 'Luke 15:1-10', 'P-ASIDE': 'Luke 16:1-15', 'P-DONE': 'Luke 16:19-31', 'P-S': 'Luke 12:35-48'
};
export const unitOf = (k: WorldPassage): string => `LUK/${k}`;
export const labelOf = (k: WorldPassage): string => LABELS[k];
/** COORD's due date on P-NEW's request: fixed, and far enough ahead never to be overdue. */
export const DUE = '2099-01-15';

export interface PassageWorld {
  languageId: string;
  state: LanguageState;
  org: OrgState;
  /** The session of a role's person in Alpha, as the app derives it. */
  session: (who: WorldRole) => Session;
  /** `ctx.name` as `who` sees it: everyone by name, themselves as "You". */
  nameFor: (who: WorldRole) => (profileId: string, lower?: boolean) => string;
}

function buildOrg(): OrgState {
  let seq = 0;
  const events: AnyEvent[] = [];
  const emit = (type: string, payload: unknown) => {
    seq += 1;
    events.push({ id: `o${seq}`, type, orgId: ORG, streamId: ORG_STREAM, actorId: ID.ADMIN, deviceId: 'admin', hlc: `${String(seq).padStart(15, '0')}:000000:admin`, payload } as AnyEvent);
  };
  emit('v1.OrgCreated', { name: 'UI Test Org' });
  for (const r of SEED_ROLES) emit('v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
  const only = (keep: (p: Privilege) => boolean) => PRIVILEGES.filter(keep);
  emit('v1.RoleDefined', { roleId: 'language-lead', name: 'Language Lead', privileges: only((x) => x !== 'manage_roles' && x !== 'override_checkpoints') });
  emit('v1.RoleDefined', { roleId: 'translator-reviewer', name: 'Translator-Reviewer',
    privileges: only((x) => ['translate', 'review', 'fill_reference', 'send_to_reviewers', 'view_status'].includes(x)) });
  emit('v1.LanguageAdded', { languageId: LANGUAGE, name: 'Alpha', code: 'alp', sourceCode: 'eng' });
  const org: Scope = { level: 'org' };
  const atA: Scope = { level: 'language', languageId: LANGUAGE };
  const members: [WorldRole, string, Scope][] = [
    ['ADMIN', 'org_admin', org], ['COORD', 'coordinator', org], ['LADMIN', 'language-lead', atA], ['TRANS', 'translator', atA],
    ['REV', 'reviewer', atA], ['TREV', 'translator-reviewer', atA], ['VIEW', 'viewer', org], ['KEPT', 'translator', atA]
  ];
  for (const [who, roleId, scope] of members) emit('v1.MemberAdded', { profileId: ID[who], roleId, scope });
  return foldOrg(events);
}

function buildLanguage(): LanguageState {
  const events: AnyEvent[] = [];
  let wall = 1_790_000_000_000;
  let seq = 0;
  const clocks = new Map<string, HlcClock>();
  const state = () => foldLanguage(events, emptyLanguageState());
  const append = (who: WorldRole, specs: EventSpec[]) => {
    const actorId = ID[who];
    const clock = clocks.get(actorId) ?? new HlcClock(actorId, () => wall);
    clocks.set(actorId, clock);
    for (const spec of specs) {
      wall += 1000;
      seq += 1;
      events.push({ id: `e${seq}`, type: spec.type, orgId: ORG, streamId: LANGUAGE, actorId, deviceId: actorId, hlc: clock.next(), payload: spec.payload } as AnyEvent);
    }
  };
  const run = (who: WorldRole, make: (c: ReturnType<typeof commands>, s: LanguageState) => EventSpec[]) => {
    const s = state();
    append(who, make(commands(s), s));
  };
  let n = 0;
  const id = (what: string) => `${what}-${++n}`;
  const unit = unitOf;

  // ADMIN adds the language as New language does: its passages, and the Standard Bible Flow's checks copied (decision 91).
  append('ADMIN', PASSAGES.map((k, i) => ({ type: 'v1.UnitAdded', payload: { unitId: unit(k), parentUnitId: null, kind: 'passage', label: LABELS[k], order: `a${i}` } }) as EventSpec));
  const flow = flowTemplate('standard_bible')!;
  const used = new Set(flow.steps.flatMap((s) => s.kindIds));
  run('ADMIN', (c) => c.copyFlow({ commandId: 'alpha:checks', name: flow.name, kinds: DEFAULT_KINDS.filter((k) => used.has(k.id)), steps: flow.steps }));

  // COORD sets up the checks' people and the Consultant check's question, then asks TRANS to record P-NEW.
  const checkKinds = [...new Set(Object.values(state().flowSteps).flatMap((st) => st.value.kindIds))];
  const checkName: Record<string, string> = { peer: 'Peer check', bt: 'Back translation', community: 'Community check', consultant: 'Consultant check', final: 'Final approval' };
  for (const kindId of ['peer', 'bt']) {
    run('COORD', (_c, s) => checkPeopleSpecs(s, { commandId: id('people'), kindId, people: [ID.REV, ID.TREV], kinds: checkKinds, nameOf: (k) => checkName[k] ?? k }).specs);
  }
  run('COORD', (c) => c.defineMaterial({
    commandId: id('questions'), materialId: 'questions-consultant', kind: 'questions', title: 'Consultant check questions', scope: { stepId: 'consultant' },
    fields: [{ fieldId: 'q1', text: formatQuestionField({ text: 'Does it carry the meaning of the original?', type: 'yesno', required: true }) }]
  }));
  run('COORD', (c) => c.ask({ commandId: id('ask'), unitId: unit('P-NEW'), what: 'record', profileId: ID.TRANS, dueDate: DUE }));

  // TRANS records: two parts kept as a draft on P-DRAFT, and Version 1 (three parts) of six passages; asks REV for one Peer check.
  let card = 0;
  const takeOf: Partial<Record<WorldPassage, string>> = {};
  const recordParts = (k: WorldPassage, parts: number) => {
    const cards = Array.from({ length: parts }, () => ({ hash: `h${String(++card).padStart(4, '0')}`, durationMs: 3000, format: 'wav' as const }));
    for (const c of cards) {
      const recordingId = id('rec');
      run('TRANS', (cmd) => cmd.addRecording({ commandId: recordingId, recordingId, unitId: unit(k), kind: 'target', card: c }));
    }
    run('TRANS', (cmd) => cmd.keepTake({ commandId: id('keep'), unitId: unit(k), cardHashes: cards.map((c) => c.hash), actorId: ID.TRANS }));
    return cards;
  };
  recordParts('P-DRAFT', 2);
  for (const k of ['P-SUBMITTED', 'P-NEEDS', 'P-BT', 'P-CHECK', 'P-ASIDE', 'P-DONE'] as const) {
    const cards = recordParts(k, 3);
    run('TRANS', (c) => c.publishVersion({ commandId: id('publish'), unitId: unit(k), cardHashes: cards.map((x) => x.hash), actorId: ID.TRANS }));
    takeOf[k] = derivePassage(state(), unit(k)).latest!.takeId;
  }
  run('TRANS', (c) => c.ask({ commandId: id('ask'), unitId: unit('P-SUBMITTED'), what: 'review', kindId: 'peer', profileId: ID.REV }));

  // REV reviews: feedback with a voice note, Peer checks that look good, back translations and community checks.
  const take = (k: WorldPassage) => takeOf[k]!;
  append('REV', [{ type: 'v1.AudioFormatSet', payload: { hash: 'note-rev', format: 'wav' } } as EventSpec]);
  run('REV', (c) => c.recordReview({ commandId: id('review'), takeIds: [take('P-NEEDS')], kindId: 'peer', outcome: 'needs_changes', via: 'app',
    comment: 'Verse 18 is too fast', commentBlobHash: 'note-rev' }));
  for (const k of ['P-BT', 'P-CHECK', 'P-DONE'] as const) {
    run('REV', (c) => c.recordReview({ commandId: id('review'), takeIds: [take(k)], kindId: 'peer', outcome: 'looks_good', via: 'app' }));
  }
  for (const k of ['P-CHECK', 'P-DONE'] as const) {
    const bt = [1, 2].map(() => ({ hash: `bt${String(++card).padStart(4, '0')}`, durationMs: 3000, format: 'wav' as const }));
    run('REV', (c) => c.produceContent({ commandId: id('bt'), fromTakeId: take(k), kindId: 'bt', cards: bt, via: 'app' }));
    run('REV', (c) => c.recordReview({ commandId: id('review'), takeIds: [take(k)], kindId: 'community', outcome: 'looks_good', via: 'app', people: 6 }));
  }

  // TRANS asks REV to back-translate P-BT, now its Peer check looks good.
  run('TRANS', (c) => c.ask({ commandId: id('ask'), unitId: unit('P-BT'), what: 'review', kindId: 'bt', profileId: ID.REV }));

  // COORD sets P-ASIDE's Community check aside, and takes P-DONE through the consultant and final approval.
  run('COORD', (c) => c.depart({ commandId: id('skip'), unitId: unit('P-ASIDE'), type: 'skip', kindId: 'community', reason: 'No community meeting this month' }));
  run('COORD', (c) => c.recordReview({ commandId: id('review'), takeIds: [take('P-DONE')], kindId: 'consultant', outcome: 'looks_good', via: 'app',
    answers: { 'questions-consultant#q1': 'Yes' } }));
  run('COORD', (c) => c.recordReview({ commandId: id('review'), takeIds: [take('P-DONE')], kindId: 'final', outcome: 'looks_good', via: 'app' }));
  return state();
}

let built: PassageWorld | null = null;

/** The world, built once per test file. */
export function passageWorld(): PassageWorld {
  if (built) return built;
  const org = buildOrg();
  const state = buildLanguage();
  const byId = new Map(WORLD_ROLES.map((r) => [ID[r], NAMES[r]]));
  built = {
    languageId: LANGUAGE, state, org,
    session: (who) => deriveSession(ID[who], who === 'KEPT' ? null : `${ID[who]}@example.test`, true, org, LANGUAGE),
    nameFor: (who) => (profileId, lower = false) => (profileId === ID[who] ? (lower ? 'you' : 'You') : byId.get(profileId) ?? profileId)
  };
  return built;
}
