// Which language this phone has open (decision 63). Each language is its
// own stream; the phone syncs the organization's stream and the open
// language's, and keeps any it opened before. Pure, so it can be tested.
import { orgLanguages, type OrgState } from '@langquest-next/core';

/**
 * The language to open: the one the current screen is about, else the one
 * opened last, else the first this person is a member of, else the first by
 * name. Only languages the organization has added count. Null before it
 * has any.
 */
export function openLanguage(
  org: OrgState | null,
  actorId: string,
  wanted: { param?: string | undefined; saved?: string | null | undefined }
): string | null {
  const languages = orgLanguages(org);
  const added = new Set(languages.map((l) => l.languageId));
  const ok = (id: string | null | undefined): id is string => !!id && added.has(id);
  const mine = Object.values(org?.members[actorId] ?? {})
    .filter((m) => m.removed.value === false && m.scope.level === 'language' && added.has(m.scope.languageId))
    .map((m) => (m.scope.level === 'language' ? m.scope.languageId : ''))
    .sort();
  return [wanted.param, wanted.saved, mine[0], languages[0]?.languageId].find(ok) ?? null;
}
