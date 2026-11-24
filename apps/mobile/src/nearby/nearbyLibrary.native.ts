import type { LanguageState, OrgState } from '@langquest-next/core';
import { nearbyDocHeadOf } from '@langquest-next/core/nearby';
import type { NearbyDocs, NearbyLibrary } from '@langquest-next/sync/nearby';
import { docText, heldDocHead, keepFetchedDoc } from '../library/docStore';
import { wornNow } from '../shell/appCovered';
import type { NearbyLanguage } from '../sync/useLanguage';

/**
 * The library documents a language uses, between any two teammates' phones
 * (docs/nearby-sync-plan.md 14.1, 2026-11-24): on Android and iPhone alike, on Share nearby and
 * while LangQuest is open. A phone serves those it holds and asks a teammate for those it lacks,
 * so a guide one teammate read online, or a starting copy that came short, reaches the rest.
 */

/** The library documents kept on this phone, as a teammate reads and keeps them (sync's `NearbyDocs`): heads, never whole documents, for the walk. */
export const phoneDocs: NearbyDocs = {
  head: (hash) => heldDocHead(hash, nearbyDocHeadOf),
  text: (hash) => docText(hash),
  keep: (hash, text) => keepFetchedDoc(hash, text)
};

/** This person's library for a room: the organization and language as they stand on this phone when a session asks. */
export function nearbyLibraryOf(o: { language: NearbyLanguage['client']; org: () => OrgState | null }): NearbyLibrary {
  return {
    org: () => o.org(),
    language: () => o.language.getState() as LanguageState,
    keptPassageLinks: () => o.language.keptPassageLinks(),
    docs: phoneDocs,
    // Under a cover (decision 171) only what the language itself names: a search finds no more than its work asks for.
    worn: wornNow
  };
}
