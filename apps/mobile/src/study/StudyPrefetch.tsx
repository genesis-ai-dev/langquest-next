// Takes kept passages' study pictures and audio along (decisions.md 61):
// mounted once with the app, it finds each kept passage's guide and hands
// its addresses to `studyFiles.ts`, which downloads what is missing while
// connected. Draws nothing.
import { useEffect, useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { useStudyGuides } from './useStudyGuides';
import { setStudyWanted, STUDY_FILES_OFFLINE, studyUrls } from './studyFiles';

export function StudyPrefetch(props: { ctx: Ctx }) {
  const { ctx } = props;
  const state = ctx.language.state;
  const kept = ctx.language.blobs.keptUnits;
  const scopeNow = ctx.language.blobs.scope;
  // Worked out when the scope or the kept units change, not on every render of the app root.
  // The default scope comes worked out from the phone's table too (decisions.md 143).
  const key = useMemo(() => {
    if (!state || !STUDY_FILES_OFFLINE) return '';
    const scope = new Set(scopeNow);
    for (const u of kept) scope.add(u);
    return [...scope].sort().join(',');
  }, [state, scopeNow, kept]);
  // Keyed by the scope's members, so a new fold with the same scope finds the same guides.
  const unitIds = useMemo(() => (key ? key.split(',') : []), [key]);
  const guides = useStudyGuides(ctx, unitIds);
  const online = ctx.language.online !== false;
  const { orgId, languageId } = ctx.language;
  useEffect(() => {
    if (!STUDY_FILES_OFFLINE) return;
    const next = new Map<string, string[]>();
    for (const [unitId, guide] of guides) next.set(unitId, studyUrls(guide));
    setStudyWanted(next, online, { orgId, languageId });
  }, [guides, online, orgId, languageId]);
  return null;
}
