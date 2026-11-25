import type { LanguageState, OrgState } from '@langquest-next/core';
import { NEARBY_HEAD_VERSION, nearbyDocHeadOf } from '@langquest-next/core/nearby';
import type { NearbyDocs, NearbyLabels, NearbyLibrary } from '@langquest-next/sync/nearby';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { appBuild } from '../diagnostics/appBuild';
import { noteExpected } from '../diagnostics/report';
import { docText, hashOf, heldDocHead, keepFetchedDoc } from '../library/docStore';
import { keepTeammateLabels, keptLabels, labelsFromServer } from '../library/labelsTeammate.native';
import { phoneSharedFor } from '../library/sharedTeammate.native';
import { wornNow } from '../shell/appCovered';
import type { NearbyLanguage } from '../sync/useLanguage';
import { UNREADABLE_DOCS_KEY, unreadableOf, withUnreadable } from './unreadableDocsModel';

/**
 * The library documents a language uses, between any two teammates' phones
 * (docs/nearby-sync-plan.md 14.1, 2026-11-24): on Android and iPhone alike, on Share nearby and
 * while LangQuest is open. A phone serves those it holds and asks a teammate for those it lacks,
 * so a guide one teammate read online, or a starting copy that came short, reaches the rest.
 */

/** The library documents kept on this phone, as a teammate reads and keeps them (sync's `NearbyDocs`): heads, never whole documents, for the walk. */
export const phoneDocs: NearbyDocs = {
  // Kept on disk beside the documents, by the shape of core's nearby head (review P6).
  head: (hash) => heldDocHead(hash, nearbyDocHeadOf, `nearby${NEARBY_HEAD_VERSION}`),
  text: (hash) => docText(hash),
  // Called only once nearby code checked the text whole (`admitDoc`): not checked again.
  keep: (hash, text) => keepFetchedDoc(hash, text, true),
  // The phone's native SHA-256 (review P6).
  hashText: (text) => hashOf(text),
  // A document a newer build added a format for: asked of no teammate again until the app updates (2026-11-24, review item 28).
  unreadable: async () => unreadableOf(await AsyncStorage.getItem(UNREADABLE_DOCS_KEY), appBuild()),
  noteUnreadable: async (hash) => {
    const next = withUnreadable(await AsyncStorage.getItem(UNREADABLE_DOCS_KEY), appBuild(), hash);
    if (next !== null) await AsyncStorage.setItem(UNREADABLE_DOCS_KEY, next);
  }
};

/**
 * The names library items go by in the app's language (decision 195), between teammates' phones
 * (2026-11-24, review item 13): served from what this phone keeps, and asked of a teammate while
 * what it keeps came from no server read. English needs none.
 */
export const phoneLabels: NearbyLabels = {
  lang: async () => {
    // Read when a session asks: the app's language and its words stay out of what nearby code loads at start.
    const { readerLanguage } = await import('../reference/languages');
    const lang = readerLanguage();
    return lang === 'eng' ? null : lang;
  },
  kept: (lang) => keptLabels(lang),
  fromServer: (lang) => labelsFromServer(lang),
  keep: (lang, labels) => keepTeammateLabels(lang, labels),
  // A read or keep that threw ends nothing (the review of item 13's fix): the names wait for another session, and this says so.
  failed: (err) => noteExpected('nearby: labels', err)
};

/** This person's library for a room: the organization and language as they stand on this phone when a session asks. */
export function nearbyLibraryOf(o: { language: NearbyLanguage['client']; org: () => OrgState | null }): NearbyLibrary {
  return {
    org: () => o.org(),
    language: () => o.language.getState() as LanguageState,
    keptPassageLinks: () => o.language.keptPassageLinks(),
    docs: phoneDocs,
    // Under a cover (decision 171) only what the language itself names: a search finds no more than its work asks for.
    worn: wornNow,
    labels: phoneLabels,
    // The Bibles other organizations share that the team reads (review item 9).
    shared: phoneSharedFor({ orgId: o.language.orgId, languageId: o.language.streamId, org: o.org, state: () => o.language.getState() as LanguageState })
  };
}
