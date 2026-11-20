// Takes kept passages' study pictures and audio along (decisions.md 61):
// mounted once with the app, it finds each kept passage's guide and hands
// its addresses to `studyFiles.ts`, which downloads what is missing while
// connected. Draws nothing.
//
// Only passages kept with their reference material: the person's own, and
// those kept by their own button. A book's or a section's button keeps its
// passages for their recordings alone (`referenceUnits`,
// docs/decisions/2026-11-20-a-book-has-its-own-download-button.md, amended):
// one guide can name sixty files, so a whole book's would be thousands.
import { useEffect, useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { referenceUnits } from '../sync/offlineModel';
import { useStudyGuideSet } from './useStudyGuides';
import { setStudyWanted, STUDY_FILES_OFFLINE, studyUrls } from './studyFiles';

export function StudyPrefetch(props: { ctx: Ctx }) {
  const { ctx } = props;
  const state = ctx.language.state;
  const { keptUnits, recordingsOnly, scope } = ctx.language.blobs;
  // Worked out when the scope or the kept units change, not on every render of the app root.
  // The default scope comes worked out from the phone's table too (decisions.md 143).
  const key = useMemo(() => {
    if (!state || !STUDY_FILES_OFFLINE) return '';
    return [...referenceUnits({ scope, keptUnits, recordingsOnly })].sort().join(',');
  }, [state, scope, keptUnits, recordingsOnly]);
  // Keyed by the scope's members, so a new fold with the same scope finds the same guides.
  const unitIds = useMemo(() => (key ? key.split(',') : []), [key]);
  const { guides, lookedUp } = useStudyGuideSet(ctx, unitIds);
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
