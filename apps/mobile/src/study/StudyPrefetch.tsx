// Takes kept passages' study pictures and audio along (decisions.md 61):
// mounted once with the app, it finds each kept passage's guide and hands
// its addresses to `studyFiles.ts`, which downloads what is missing while
// connected. Draws nothing.
import { defaultOfflineScope } from '@langquest-next/core';
import { useEffect, useMemo } from 'react';
import type { Ctx } from '../ctx';
import { useStudyGuides } from './libraryGuides';
import { setStudyWanted, STUDY_FILES_OFFLINE, studyUrls } from './studyFiles';

export function StudyPrefetch(props: { ctx: Ctx }) {
  const { ctx } = props;
  const state = ctx.partition.state;
  const kept = ctx.partition.blobs.keptUnits;
  const me = ctx.session.actorId;
  let key = '';
  if (state && STUDY_FILES_OFFLINE) {
    const scope = defaultOfflineScope(state, me);
    for (const u of kept) scope.add(u);
    key = [...scope].sort().join(',');
  }
  // Keyed by the scope's members, so a new fold with the same scope finds the same guides.
  const unitIds = useMemo(() => (key ? key.split(',') : []), [key]);
  const guides = useStudyGuides(ctx, unitIds);
  const online = ctx.partition.online !== false;
  useEffect(() => {
    if (!STUDY_FILES_OFFLINE) return;
    const next = new Map<string, string[]>();
    for (const [unitId, guide] of guides) next.set(unitId, studyUrls(guide));
    setStudyWanted(next, online);
  }, [guides, online]);
  return null;
}
