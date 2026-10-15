import { publishedCopy, type LanguageState } from '@langquest-next/core';

/**
 * The fold mutates its state in place, so a screen sees a change only
 * through a new top-level copy. The client publishes when a commit is
 * queued and again when it is saved, and the hook refreshed after each
 * append too: two or three publishes for one append (performance-audit.md
 * item 2). This copies only when the fold changed: another state object (a
 * refold), or another of the client's fold revisions
 * (`PublishedState.revision`, `SyncClient.publishedRevision`). Null means
 * keep the copy the screens already have.
 *
 * Each copy is core's `publishedCopy`, which remembers the live state it
 * came from: the next copy's indexes and passage views start from this
 * one's and redo only the passages the events between touched
 * (performance-audit-app.md C1).
 */
export function stateCopier(): (live: LanguageState, revision: number) => LanguageState | null {
  let last: { live: LanguageState; revision: number } | null = null;
  return (live, revision) => {
    if (last && last.live === live && last.revision === revision) return null;
    last = { live, revision };
    return publishedCopy(live);
  };
}
