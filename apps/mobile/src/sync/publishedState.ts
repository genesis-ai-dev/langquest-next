import type { LanguageState } from '@langquest-next/core';

/**
 * The fold mutates its state in place, so a screen sees a change only
 * through a new top-level copy, and every copy makes each mounted screen
 * build its indexes again (`indexesFor` caches by identity). The client
 * publishes when a commit is queued and again when it is saved, and the
 * hook refreshed after each append too: two or three copies, and as many
 * index builds, for one append (performance-audit.md item 2). This copies
 * only when the fold changed: another state object (a refold), or another
 * of the client's fold revisions (`PublishedState.revision`,
 * `SyncClient.publishedRevision`). Null means keep the copy the screens
 * already have.
 */
export function stateCopier(): (live: LanguageState, revision: number) => LanguageState | null {
  let last: { live: LanguageState; revision: number } | null = null;
  return (live, revision) => {
    if (last && last.live === live && last.revision === revision) return null;
    last = { live, revision };
    return { ...live };
  };
}
