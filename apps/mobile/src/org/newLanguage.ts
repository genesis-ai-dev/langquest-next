import {
  CommandError, commands, emptyLanguageState, isTemplateDoc, privilegesFor,
  type EventPayloads, type EventSpec, type KindDef, type LanguageState, type LibraryDoc, type OrgState
} from '@langquest-next/core';
import { t } from '../i18n';
import type { SharedItem } from '../library/model';
import { addLanguage, booksInScope, newLanguageId, type LanguageScope } from '../orgAdmin';
import { chooseSetLanguage, type GuideSet, type ReferenceSay, type SetMember } from '../reference/guideSets';

/** The parts of adding a language, in order, as step 3 names them while Continue runs. */
export type Making = 'passages' | 'checks' | 'helps' | 'listing' | 'saving';

/** Something a new language's team is offered from the start: an item here, or one another organization shares. */
export interface Offer { itemId: string | null; shared: SharedItem | null; name: string; label: string; set?: GuideSet; member?: SetMember }

/** The parts Continue goes through: helps only when something is offered. */
export function newLanguageParts(offering: boolean): Making[] {
  return ['passages', 'checks', ...(offering ? ['helps' as const] : []), 'listing', 'saving'];
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
  appendOrg: <T extends 'v1.LanguageAdded' | 'v1.LanguageCodeSet'>(type: T, payload: EventPayloads[T]) => Promise<void>;
  syncOrg: () => Promise<void>;
  appendToLanguage: (languageId: string, specs: EventSpec[]) => Promise<void>;
  newId: () => string;
  /** Each part is named on screen before it starts. */
  onPart: (now: Making) => Promise<void>;
  /** An expected failure (offline, refused), for diagnostics. */
  note: (where: string, e: unknown) => void;
}

/**
 * Add a language (ORG-2, decisions 63, 71, 76, 84, 91): listed in the
 * organization's stream first, then its own stream starts with the
 * template, its own copy of the checks, and what its team is offered.
 * The new language has no members yet, so its first events go in under
 * org-scope privileges. What helps is never required and a language can be
 * added offline: an offer that could not be followed is named, not fatal.
 */
export async function createLanguage(input: {
  org: OrgState | null; actorId: string; name: string; code: string; languoidId: string | null; reads: string;
  scope: LanguageScope; chosenBooks: ReadonlySet<string>; checks: { name?: string | undefined; kinds: readonly KindDef[]; steps: readonly { kindIds: readonly string[]; checkpoint?: boolean }[] }; offers: Offer[];
}, deps: NewLanguageDeps): Promise<{ languageId: string; name: string; notOffered: string[] }> {
  const languageName = input.name.trim();
  const mine = input.org ? privilegesFor(input.org, input.actorId) : new Set<string>();
  if (!mine.has('manage_templates') || !mine.has('manage_flows')) throw new CommandError(t('org.newLanguage.needsPermission'));
  const languoid = input.code.trim() || languageName.slice(0, 3);
  const languageId = newLanguageId(languoid, deps.newId());
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
  await deps.onPart('listing');
  const fresh = emptyLanguageState();
  // A ready-made flow is copied into the language, its checks the language's own (decision 91).
  const flowSpecs = commands(fresh).copyFlow({ commandId: `${languageId}:checks`, name: input.checks.name ?? '', kinds: input.checks.kinds, steps: input.checks.steps });
  const plan = addLanguage(input.org, {
    languageId, code: languoid, name: languageName, languoidId: input.languoidId, sourceCode: input.reads,
    template: await deps.applySpecs(use.itemId, { docHash: use.docHash, into: fresh, ...(books ? { books } : {}) }),
    flow: flowSpecs
  });
  await deps.appendOrg('v1.LanguageAdded', plan.added);
  if (plan.link) await deps.appendOrg('v1.LanguageCodeSet', plan.link);
  // Its stream takes events once the organization's lists it: send that first when connected.
  // i18n-ignore: a diagnostics label (noteExpected), never shown
  await deps.syncOrg().catch((e: unknown) => deps.note('new language listing', e));
  await deps.onPart('saving');
  await deps.appendToLanguage(languageId, [...plan.specs, ...offerSpecs(languageId, offered, setSays, input.org?.recommendations)]);
  return { languageId, name: languageName, notOffered };
}
