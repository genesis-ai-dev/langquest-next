// Takes kept passages' study pictures and audio along (decisions.md 61):
// mounted once with the app, it finds each kept passage's guide and hands
// its addresses to `studyFiles.ts`, which downloads what is missing while
// connected. Draws nothing.
//
// Every passage kept on this device (`referenceUnits`): the person's own, and
// those chosen one by one or a book at a time. One guide names about a dozen
// files, so a whole book's are over a thousand: studyFiles.ts tells screens
// of their arrival at most twice a second
// (docs/decisions/2026-11-20-a-book-has-its-own-download-button.md, amended).
import { useEffect, useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { referenceUnits } from '../sync/offlineModel';
import { useStudyGuideSet } from './useStudyGuides';
import { setStudyWanted, STUDY_FILES_OFFLINE, studyUrls } from './studyFiles';
import { useSlowly } from '../ui/useSlowly';

/** How far behind the language the looking up may run. */
const FOLLOW_MS = 3000;

export function StudyPrefetch(props: { ctx: Ctx }) {
  const { ctx } = props;
  const state = ctx.language.state;
  const { keptUnits, scope } = ctx.language.blobs;
  // Worked out when the scope or the kept units change, not on every render of the app root.
  // The default scope comes worked out from the phone's table too (decisions.md 143).
  const key = useMemo(() => {
    if (!state || !STUDY_FILES_OFFLINE) return '';
    return [...referenceUnits({ scope, keptUnits })].sort().join(',');
  }, [state, scope, keptUnits]);
  // Keyed by the scope's members, so a new fold with the same scope finds the same guides.
  const unitIds = useMemo(() => (key ? key.split(',') : []), [key]);
  // The looking up follows the language a few seconds behind: a sync changes it many times a second,
  // and what a guide is chosen by (the template, what is recommended or linked) seldom changes at all.
  // Matching 97 passages on every change took most of half a second each time. The first state is
  // taken at once, so nothing waits when the language opens.
  const slow = useSlowly(state, FOLLOW_MS);
  const { guides, lookedUp } = useStudyGuideSet(ctx, unitIds, { state: slow ?? state });
  const online = ctx.language.online !== false;
  const { orgId, languageId } = ctx.language;
  useEffect(() => {
    if (!STUDY_FILES_OFFLINE) return;
    const next = new Map<string, string[]>();
    for (const [unitId, guide] of guides) next.set(unitId, studyUrls(guide));
    // A passage with no guide here counts as having none only once its documents have been read: until
    // then it may have one, and its study files are not counted as here (decisions.md 166).
    setStudyWanted(next, online, { orgId, languageId }, lookedUp);
  }, [guides, lookedUp, online, orgId, languageId]);
  return null;
}
