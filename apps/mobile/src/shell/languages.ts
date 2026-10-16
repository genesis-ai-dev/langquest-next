// Which language this phone has open (decision 63). Each language is its
// own stream; the phone syncs the organization's stream and the open
// language's, and keeps any it opened before. Pure, so it can be tested.
import { orgLanguages, privilegesFor, type OrgState } from '@langquest-next/core';

/**
 * The language to open: the one the current screen is about, else the one
 * opened last, else the first this person is a member of, else the first by
 * name. Only languages the organization has added, and that this person may
 * read, count. Null before it has any.
 */
export function openLanguage(
  org: OrgState | null,
  actorId: string,
  wanted: { param?: string | undefined; saved?: string | null | undefined }
): string | null {
  const languages = orgLanguages(org);
  const added = new Set(languages.map((l) => l.languageId));
  // Only a language this person may read: the server refuses its stream to
  // anyone without a privilege there (can_read_stream), and opening it left
  // the session with none at all, as if they belonged to no organization.
  // Someone who may read none (not a member yet) keeps the old order.
  const readable = (id: string) => !org || privilegesFor(org, actorId, id).size > 0;
  const anyReadable = languages.some((l) => readable(l.languageId));
  const ok = (id: string | null | undefined): id is string => !!id && added.has(id) && (!anyReadable || readable(id));
  const mine = Object.values(org?.members[actorId] ?? {})
    .filter((m) => m.removed.value === false && m.scope.level === 'language' && added.has(m.scope.languageId))
    .map((m) => (m.scope.level === 'language' ? m.scope.languageId : ''))
    .sort();
  return [wanted.param, wanted.saved, mine[0], ...languages.map((l) => l.languageId)].find(ok) ?? null;
}
