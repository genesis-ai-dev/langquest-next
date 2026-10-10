// Words that `packages/core` writes in English, said in the language showing
// (LAN-42). Core stays pure and English (the server and the tests read it);
// the app shows these instead:
// - the review states and the shipped kinds of review (a kind an
//   organization renamed shows its own name),
// - a passage's one-line state (core's `passageSummary`),
// - the errors core's commands throw (`CommandError`),
// - the licenses, and the books of the Bible by their core ids.
// Templates, flows and reference material are library documents (decision
// 36): their names and words are the organization's, shown as written.
import {
  CommandError, DEFAULT_KINDS, deriveKinds as coreKinds, feedbackIsMine, kindOf as coreKindOf,
  type FlowStep, type KindDef, type KindState, type LanguageState, type License, type PassageState
} from '@langquest-next/core';
import type { Catalog } from './i18n';
import { t } from './i18n';

export function stateLabel(state: KindState): string {
  switch (state) {
    case 'todo': return t('core.states.todo');
    case 'asked': return t('core.states.asked');
    case 'suggestions': return t('core.states.suggestions');
    case 'addressed': return t('core.states.addressed');
    case 'approved': return t('core.states.approved');
    case 'skipped': return t('core.states.skipped');
    case 'locked': return t('core.states.locked');
  }
}

type ShippedKind = keyof Catalog['core']['kinds'];
const SHIPPED = new Map(DEFAULT_KINDS.map((k) => [k.id, k]));

/** A shipped kind of review in the language showing, unless the organization changed its words. */
export function localKind(kind: KindDef): KindDef {
  const shipped = SHIPPED.get(kind.id);
  if (!shipped) return kind;
  const id = kind.id as ShippedKind;
  const same = (a: string | undefined, b: string | undefined) => (a ?? '') === (b ?? '');
  const out: KindDef = { ...kind };
  if (same(kind.name, shipped.name)) out.name = t(`core.kinds.${id}.name`);
  if (same(kind.description, shipped.description)) out.description = t(`core.kinds.${id}.description`);
  if (same(kind.usualReviewer, shipped.usualReviewer)) out.usualReviewer = t(`core.kinds.${id}.usualReviewer`);
  if (kind.produces && shipped.produces && id === 'bt') {
    out.produces = {
      ...kind.produces,
      ...(same(kind.produces.what, shipped.produces.what) ? { what: t('core.kinds.bt.produces.what') } : {}),
      ...(same(kind.produces.action, shipped.produces.action) ? { action: t('core.kinds.bt.produces.action') } : {})
    };
  }
  return out;
}

/** Core's `deriveKinds`, with the shipped kinds in the language showing. */
export function deriveKinds(state: LanguageState): KindDef[] {
  return coreKinds(state).map(localKind);
}

/** Core's `kindOf`, with a shipped kind in the language showing. */
export function kindOf(state: LanguageState, kindId: string): KindDef {
  return localKind(coreKindOf(state, kindId));
}

/** A flow step by its kinds: "Peer Review + Back Translation". */
export function stepName(kinds: KindDef[], step: FlowStep): string {
  return step.kindIds.map((id) => localKind(kinds.find((k) => k.id === id) ?? { id, name: id, description: '', usualReviewer: '' }).name).join(' + ');
}

/** Core's `passageSummary`: the one-line state of a passage, worded for the person looking. */
export function passageSummary(s: PassageState, kinds: KindDef[], actorId: string, name: (id: string) => string): string {
  if (s.done) return s.steps.length === 0 ? t('core.summary.recordedDone') : t('core.summary.done');
  if (!s.recorded) return s.drafting ? t('core.summary.recording') : t('core.summary.notStarted');
  if (s.awaitingResponse.length) {
    return feedbackIsMine(s, actorId) ? t('core.summary.feedbackForYou') : t('core.summary.waitingOnFeedback', { name: name(s.latest?.by ?? '') });
  }
  const asked = s.steps.flatMap((st) => st.kinds).find((k) => k.state === 'asked');
  if (asked) {
    const found = kinds.find((k) => k.id === asked.kindId);
    const kind = found ? localKind(found).name : t('core.summary.aReview');
    const r = asked.request;
    if (r?.profileId === actorId || r?.team?.memberIds.includes(actorId)) return t('core.summary.yourTurn', { kind });
    if (r?.team) return t('core.summary.waitingOnTeam', { team: r.team.name || t('core.summary.theReviewTeam'), kind });
    const who = r?.profileId ?? r?.guest?.name;
    return t('core.summary.waitingOnPerson', { name: who ? name(who) : t('core.summary.aReviewer'), kind });
  }
  if (s.next) return t('core.summary.next', { step: stepName(kinds, s.next.step) });
  return t('core.summary.version', { n: s.latest?.n ?? 1 });
}

/** What a core command refused, in the language showing (its English message is the key). */
export function commandErrorText(e: CommandError): string {
  switch (e.message) {
    case 'Nothing to keep.': return t('core.errors.nothingToKeep');
    case 'Record something before publishing.': return t('core.errors.recordBeforePublishing');
    case 'Nothing changed since the last version.': return t('core.errors.nothingChanged');
    case 'Say what changed.': return t('core.errors.sayWhatChanged');
    case 'Pick the version that was heard.': return t('core.errors.pickVersionHeard');
    case 'Only a published version can be reviewed.': return t('core.errors.onlyPublishedReviewed');
    case 'Say what to change.': return t('core.errors.sayWhatToChange');
    case 'Record something before saving.': return t('core.errors.recordBeforeSaving');
    case 'Only a published version can be back-translated.': return t('core.errors.onlyPublishedBackTranslated');
    case 'Say why.': return t('core.errors.sayWhy');
    case 'Pick who to ask.': return t('core.errors.pickWhoToAsk');
    case 'Ask a team or a person, not both.': return t('core.errors.teamOrPerson');
    case 'A review request names its kind.': return t('core.errors.requestNamesKind');
    case 'A note needs words, a voice note or a photo.': return t('core.errors.noteNeedsContent');
    case 'Name the kind of review.': return t('core.errors.nameKind');
    case 'Every step needs a kind of review.': return t('core.errors.stepNeedsKind');
    case 'Name the term.': return t('core.errors.nameTerm');
    case 'Give it a title.': return t('core.errors.giveTitle');
    case 'Name the version or the review, not both.': return t('core.errors.versionOrReview');
    // The app's own CommandErrors are already in the language showing.
    default: return e.message;
  }
}

/** A license's name, its few words, and what it allows, for someone who has never heard of licenses. */
export function licenseText(license: License): { name: string; short: string; means: string } {
  switch (license) {
    case 'all-rights-reserved': return { name: t('core.licenses.allRightsReserved.name'), short: t('core.licenses.allRightsReserved.short'), means: t('core.licenses.allRightsReserved.means') };
    case 'CC-BY-NC-ND-4.0': return { name: t('core.licenses.ccByNcNd.name'), short: t('core.licenses.ccByNcNd.short'), means: t('core.licenses.ccByNcNd.means') };
    case 'CC-BY-NC-SA-4.0': return { name: t('core.licenses.ccByNcSa.name'), short: t('core.licenses.ccByNcSa.short'), means: t('core.licenses.ccByNcSa.means') };
    case 'CC-BY-SA-4.0': return { name: t('core.licenses.ccBySa.name'), short: t('core.licenses.ccBySa.short'), means: t('core.licenses.ccBySa.means') };
    case 'CC-BY-4.0': return { name: t('core.licenses.ccBy.name'), short: t('core.licenses.ccBy.short'), means: t('core.licenses.ccBy.means') };
    case 'CC0-1.0': return { name: t('core.licenses.cc0.name'), short: t('core.licenses.cc0.short'), means: t('core.licenses.cc0.means') };
  }
}

type BookId = keyof Catalog['books'];

/** A book of the Bible by core's id ("gen", "1co") in the language showing; the id itself if core has no such book. */
export function bookName(itemId: string): string {
  const key = `books.${itemId}` as `books.${BookId}`;
  const name = t(key, { defaultValue: '' });
  return name || itemId;
}
