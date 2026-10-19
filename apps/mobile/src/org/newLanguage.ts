import {
  CommandError, emptyLanguageState, isTemplateDoc, privilegesFor,
  type EventPayloads, type EventSpec, type LanguageState, type LibraryDoc, type OrgState
} from '@langquest-next/core';
import { draftSpecsFor } from '../checks/languageDraftModel';
import { clusterEvents, type ClusterEvent } from '../clusters/model';
import { t } from '../i18n';
import type { SharedItem } from '../library/model';
import { addLanguage, booksInScope, newLanguageId, type LanguageScope } from './orgAdmin';
import { chooseSetLanguage, type GuideSet, type ReferenceSay, type SetMember } from '../reference/guideSets';

/**
 * The parts of adding a language, in order, as step 3 names them while
 * Continue runs: with a cluster (decision 108), one part per new language,
 * and the grouping last.
 */
export type Making = 'passages' | 'checks' | 'helps' | 'listing' | 'saving' | 'cluster' | `language:${number}`;

/** A language New language adds: its name, and its code and languoid when it was found in the language list. */
export interface NewOne { key: string; name: string; code: string; languoidId: string | null }

/** The cluster new languages go in: one already here, or a new one with its name; and languages already here it takes in. */
export interface ClusterTarget { clusterId: string; name?: string; existing?: readonly string[] }

/** Something a new language's team is offered from the start: an item here, or one another organization shares. */
export interface Offer { itemId: string | null; shared: SharedItem | null; name: string; label: string; set?: GuideSet; member?: SetMember }

/** One thing New language can give a new team, on its Reference material step (decision 141): a Bible, a set of study guides, a note. */
export type MaterialChoice = Offer & { key: string; kind: 'source' | 'guide' | 'note'; sub: string };

/**
 * The parts Continue goes through: helps only when something is offered.
 * A cluster's languages are one part each (`each`), and a cluster to put
 * them in is the last part.
 */
export function newLanguageParts(offering: boolean, opts: { each?: number; cluster?: boolean } = {}): Making[] {
  const adding: Making[] = opts.each === undefined ? ['listing', 'saving'] : Array.from({ length: opts.each }, (_, i) => `language:${i}` as const);
  return ['passages', 'checks', ...(offering ? ['helps' as const] : []), ...adding, ...(opts.cluster ? ['cluster' as const] : [])];
}

/**
 * What the new language's stream says its team is offered: each item this
 * organization does not already recommend everywhere, and a guide set's
 * chosen language, with ids derived from the language so a retry appends
 * nothing twice.
 */
export function offerSpecs(languageId: string, offered: string[], setSays: ReferenceSay[], recommendations: OrgState['recommendations'] | undefined): EventSpec[] {
  return [
    ...offered.filter((id) => recommendations?.[id]?.value !== true).map((itemId) => ({ itemId, state: 'recommended' as const })),
    ...setSays
  ].map((payload, i) => ({ id: `${languageId}:offer:${i}`, type: 'v1.ReferenceSet', payload } as EventSpec));
}

/** What adding a language needs from the app: the library, the organization's stream and the new language's. */
export interface NewLanguageDeps {
  /** The template chosen on step 2, published when it is new. */
  resolveTemplate: () => Promise<{ itemId: string; docHash: string }>;
  loadDoc: (hash: string) => Promise<LibraryDoc | undefined>;
  /** Use another organization's item here: followed with automatic updates, or copied when its owner does not allow following. */
  adopt: (shared: SharedItem) => Promise<string>;
  applySpecs: (itemId: string, opts: { docHash: string; into: LanguageState; books?: string[] }) => Promise<EventSpec[]>;
  appendOrg: <T extends 'v1.LanguageAdded' | 'v1.LanguageCodeSet' | ClusterEvent['type']>(type: T, payload: EventPayloads[T]) => Promise<void>;
  syncOrg: () => Promise<void>;
  appendToLanguage: (languageId: string, specs: EventSpec[]) => Promise<void>;
  newId: () => string;
  /** Each part is named on screen before it starts. */
  onPart: (now: Making) => Promise<void>;
  /** An expected failure (offline, refused), for diagnostics. */
  note: (where: string, e: unknown) => void;
}

type NewLanguageInput = {
  org: OrgState | null; actorId: string; reads: string;
  /** Other languages its reference material may be in, beside `reads` (decision 130). */
  alsoReads?: readonly string[];
  scope: LanguageScope; chosenBooks: ReadonlySet<string>;
  /**
   * Its checks as New language's draft holds them (decisions.md 141): a flow
   * copied in (decision 91), then whatever was set on each check's pages.
   */
  checks: readonly EventSpec[];
  offers: Offer[];
};

/**
 * Add a language (ORG-2, decisions 63, 71, 76, 84, 91, 141): listed in the
 * organization's stream first, then its own stream starts with the
 * template, its checks as they were set up before it existed, and what
 * its team is offered.
 * The new language has no members yet, so its first events go in under
 * org-scope privileges. What helps is never required and a language can be
 * added offline: an offer that could not be followed is named, not fatal.
 */
export async function createLanguage(input: NewLanguageInput & { name: string; code: string; languoidId: string | null }, deps: NewLanguageDeps): Promise<{ languageId: string; name: string; notOffered: string[] }> {
  const made = await createLanguages({ ...input, languages: [{ key: 'one', name: input.name, code: input.code, languoidId: input.languoidId }] }, deps);
  return { ...made.languages[0]!, notOffered: made.notOffered };
}

/**
 * Add several languages set up alike, and the cluster they go in (decision
 * 106): the template, the checks and the offers are settled once, then each
 * language is added as `createLanguage` adds one, its own copy of each.
 * With `each`, every language is a part of its own on screen; without, the
 * one language's parts are "listing" and "saving". `done` holds languages a
 * Continue that failed partway already added: tried again, they are not
 * added twice. The cluster comes last, a name on the languages (new ones and
 * those already here it takes in), so a failure before it leaves languages
 * that are simply not in a cluster yet.
 */
export async function createLanguages(input: NewLanguageInput & {
  languages: readonly NewOne[]; cluster?: ClusterTarget | null; each?: boolean; done?: Map<string, { languageId: string; name: string }>;
}, deps: NewLanguageDeps): Promise<{ languages: { languageId: string; name: string }[]; notOffered: string[] }> {
  const mine = input.org ? privilegesFor(input.org, input.actorId) : new Set<string>();
  if (!mine.has('manage_templates') || !mine.has('manage_flows')) throw new CommandError(t('org.newLanguage.needsPermission'));
  await deps.onPart('passages');
  const use = await deps.resolveTemplate();
  const loaded = await deps.loadDoc(use.docHash);
  if (!loaded || !isTemplateDoc(loaded)) throw new CommandError(t('org.newLanguage.templateMissing'));
  const books = booksInScope(loaded, input.scope, input.chosenBooks);
  if (books && books.length === 0) throw new CommandError(t('getReady.record.chooseABook'));
  await deps.onPart('checks');
  // What its team is offered, followed first when it is another organization's (as What helps them does).
  // Only each item's own document comes now; a guide loads when a passage reads it (useLibrary `adopt`).
  // A guide set (FIA) is offered in its one chosen language, and its other languages in the library are hidden here.
  // A cluster's new languages are offered the same, followed once.
  const offered: string[] = [];
  const setSays: ReferenceSay[] = [];
  if (input.offers.length) await deps.onPart('helps');
  const notOffered: string[] = [];
  for (const o of input.offers) {
    let itemId = o.itemId;
    if (!itemId) {
      try {
        itemId = await deps.adopt(o.shared!);
      } catch (e) {
        // i18n-ignore: a diagnostics label (noteExpected), never shown
        deps.note('new language offer', e);
        notOffered.push(o.label);
        continue;
      }
    }
    if (o.set && o.member) {
      const held = { ...o.set, members: o.set.members.map((m) => (m === o.member ? { ...m, itemId, shared: null } : m)) };
      setSays.push(...chooseSetLanguage(held, itemId, null).says);
    } else offered.push(itemId);
  }
  const made: { languageId: string; name: string }[] = [];
  for (const [i, one] of input.languages.entries()) {
    await deps.onPart(input.each ? `language:${i}` : 'listing');
    const before = input.done?.get(one.key);
    if (before) { made.push(before); continue; }
    const languageName = one.name.trim();
    const languoid = one.code.trim() || languageName.slice(0, 3);
    const languageId = newLanguageId(languoid, deps.newId());
    const fresh = emptyLanguageState();
    // Its checks are its own (decision 91), each language of a cluster its own copy of the draft's.
    const plan = addLanguage(input.org, {
      languageId, code: languoid, name: languageName, languoidId: one.languoidId, sourceCode: input.reads,
      template: await deps.applySpecs(use.itemId, { docHash: use.docHash, into: fresh, ...(books ? { books } : {}) }),
      flow: draftSpecsFor(languageId, input.checks)
    });
    await deps.appendOrg('v1.LanguageAdded', plan.added);
    if (plan.link) await deps.appendOrg('v1.LanguageCodeSet', plan.link);
    // Its stream takes events once the organization's lists it: send that first when connected.
    // i18n-ignore: a diagnostics label (noteExpected), never shown
    await deps.syncOrg().catch((e: unknown) => deps.note('new language listing', e));
    if (!input.each) await deps.onPart('saving');
    const also = (input.alsoReads ?? []).map((language, i): EventSpec => ({ id: `${languageId}:reads:${i}`, type: 'v1.ReferenceLanguageAdded', payload: { language, added: true } }));
    await deps.appendToLanguage(languageId, [...plan.specs, ...offerSpecs(languageId, offered, setSays, input.org?.recommendations), ...also]);
    input.done?.set(one.key, { languageId, name: languageName });
    made.push({ languageId, name: languageName });
  }
  if (input.cluster) {
    await deps.onPart('cluster');
    const { existing = [], ...target } = input.cluster;
    for (const e of clusterEvents(input.org, { ...target, add: [...made.map((m) => m.languageId), ...existing] })) await deps.appendOrg(e.type, e.payload);
  }
  return { languages: made, notOffered };
}
