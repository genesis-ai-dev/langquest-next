// Which draft a key term's page ties the term to (TERM-4, STUDY-025). A
// person may keep several drafts of a passage (decision 83), and a teammate
// may be drafting it too: the tie goes on the draft this person has open,
// never on someone else's. The workspace names its open draft (`draftId`);
// without that, the person's own draft they changed last, which is the one
// the workspace opens by default.
import { draftsBy, latestDraftBy, type PassageState } from '@langquest-next/core';

export function draftToTie(passage: Pick<PassageState, 'drafts'> | null | undefined, actorId: string, named?: string | null): string | undefined {
  if (!passage) return undefined;
  const mine = draftsBy(passage, actorId);
  if (named && mine.some((d) => d.takeId === named)) return named;
  return latestDraftBy(passage, actorId)?.takeId;
}
