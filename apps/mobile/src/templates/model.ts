// What the template screens decide, kept out of the screens (decision 105):
// which view of templates this is, the lines and counts a card shows, which
// choices the picker offers, and when the editor may save. Pure: no React, no
// I/O. Ports content.tsx's rules (TPL-1, TPL-2, TPL-7, TPL-9).
import {
  bookParts, languageName, sameParts, type LanguageState, type LevelDisplay, type LibraryItemView, type OrgState, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import { sharedTemplateShown } from '../breakup/model';
import { countOutline, versionNumber, type LibraryChoice, type TemplateForm } from '../contentTemplates';
import { t } from '../i18n';
import { sourceLine, usesItem } from '../library/model';

export const lower = (s: string) => s.toLowerCase();

/** "Dinka", "Dinka and Nuer", "Dinka, Nuer and Shilluk". */
export function joinNames(names: string[]): string {
  return names.length <= 1 ? names.join('') : t('content.list.and', { items: names.slice(0, -1).join(t('content.list.separator')), last: names.at(-1) });
}

/** "Dinka moves to it by itself." / "Dinka and Nuer move to it by themselves." */
export function movesLine(names: string[]): string {
  if (names.length === 0) return '';
  return t('content.moves', { count: names.length, names: joinNames(names) });
}

/** "12 passages", "1 story": a count of what a language records, in the template's word for it. */
export function partsCount(count: number, words: { one: string; many: string }): string {
  return t('content.partsCount', { count, part: lower(words.one), parts: lower(words.many) });
}

export type TemplatesLevel = 'org' | 'language';

/** Which view of templates this is: the level from params, else the viewer's own scope (ADR-017). */
export function templatesLevel(
  params: Record<string, string>, adminScope: { level: string; languageId?: string } | null, sessionLanguageId: string | null
): { level: TemplatesLevel; languageId: string | null } {
  const level = params['level'];
  const languageParam = params['languageId'];
  if (level === 'org') return { level: 'org', languageId: null };
  if (level === 'language' || languageParam) return { level: 'language', languageId: languageParam ?? sessionLanguageId };
  if (adminScope?.level === 'org') return { level: 'org', languageId: null };
  return { level: 'language', languageId: adminScope?.languageId ?? sessionLanguageId };
}

/** Is this the open language (whose state the screen reads)? */
export function isOpenLanguage(openLanguageId: string, languageId: string | null | undefined): languageId is string {
  return !!languageId && languageId === openLanguageId;
}

/** The languages using a template: the open one, when it does (other languages' choices are in their own logs). */
export function usersOf(state: LanguageState | null, org: OrgState | null, openLanguageId: string, itemId: string): string[] {
  return usesItem(state, itemId) ? [languageName(org, openLanguageId)] : [];
}

export function orgNameOf(org: OrgState | null): string {
  return org?.org?.value.name ?? t('content.orgFallback');
}

/** The organization's templates, split into those in use and those set aside. */
export function splitArchived(all: LibraryItemView[]): { active: LibraryItemView[]; archived: LibraryItemView[] } {
  return { active: all.filter((i) => !i.archived), archived: all.filter((i) => i.archived) };
}

/** A followed template's newer version waiting to be taken: only when it is followed and does not update by itself. */
export function pendingUpdate(item: LibraryItemView | null | undefined, updates: Record<string, string>): string | undefined {
  return item?.subscription?.active && !item.subscription.autoUpdate ? updates[item.itemId] : undefined;
}

/** "Version 2 · from LangQuest", "Version 3 · copied from LangQuest", "from LangQuest", or nothing. */
export function versionLineOf(n: number | null, item: LibraryItemView | null): string {
  const sub = item?.subscription ? item.subscription.sourceOrgName : null;
  const copied = item?.copiedFrom ? item.copiedFrom.orgName : null;
  if (n) {
    if (sub !== null) return t('content.language.versionFrom', { n, org: sub });
    if (copied !== null) return t('content.language.versionCopied', { n, org: copied });
    return t('content.language.version', { n });
  }
  if (sub !== null) return t('content.language.from', { org: sub });
  if (copied !== null) return t('content.language.copied', { org: copied });
  return '';
}

/** What a language's template card says about versions: the line under the name, a newer version of the item, a followed update. */
export function languageVersionView(
  item: LibraryItemView | null, sel: { docHash: string } | null, updates: Record<string, string>
): { versionLine: string; newer: number | null; update: string | undefined } {
  const n = versionNumber(item, sel?.docHash);
  return {
    versionLine: versionLineOf(n, item),
    newer: item?.current && sel && item.current !== sel.docHash ? versionNumber(item, item.current) : null,
    update: pendingUpdate(item, updates)
  };
}

/** The books a language lists under "Divide into", narrowed by what was typed (the label, the app's name or the template's). */
export function filterBooks<B extends { label: string; book: { itemId: string; label: string } }>(
  books: B[], query: string, nameOf: (itemId: string) => string
): B[] {
  const q = query.trim().toLowerCase();
  return books.filter((b) => !q || [b.label, nameOf(b.book.itemId), b.book.label].some((name) => name.toLowerCase().includes(q)));
}

/** The two summary lines of a language's template card: the Bible line (when it is one) and the counts line. */
export function languageSummary(p: {
  doc: TemplateDoc | null | undefined; chosenBooks: number | null; v11n: VersificationDoc | null | undefined;
  bookRows: number; progress: { total: number; recorded: number }; words: { one: string; many: string };
}): { bibleLine: string | null; countsLine: string } {
  const { doc } = p;
  const bibleLine = doc?.bible
    ? [
      p.chosenBooks !== null
        ? t('content.language.booksOfIts', { chosen: p.chosenBooks, count: doc.bible.books.length })
        : t('content.books', { count: doc.bible.books.length }),
      p.v11n ? t('content.language.versification', { name: p.v11n.name }) : t('content.language.versificationLoading')
    ].join(' · ')
    : null;
  const countsLine = [
    ...(p.bookRows && !doc?.bible ? [t('content.books', { count: p.bookRows })] : []),
    partsCount(p.progress.total, p.words),
    t('content.language.recorded', { count: p.progress.recorded })
  ].join(' · ');
  return { bibleLine, countsLine };
}

/** Whether a picker choice is the template the language uses now. */
export function choiceInUse(c: LibraryChoice, sel: { itemId: string } | null): boolean {
  return !!sel && c.source === 'ours' && c.item.itemId === sel.itemId;
}

/**
 * The picker's two lists: this organization's, and, only for someone who may
 * write the library (using another's follows it first), what others share.
 * LangQuest's ways are offered once, in the numbering the language uses
 * (`numbering`, a versification code), without its older templates
 * (`sharedTemplateShown`, decision 106).
 */
export function pickerLists(choices: LibraryChoice[], canWriteLibrary: boolean, numbering = 'eng'): { ours: LibraryChoice[]; others: LibraryChoice[] } {
  return {
    ours: choices.filter((c) => c.source === 'ours'),
    others: canWriteLibrary ? choices.filter((c) => c.source === 'shared' && sharedTemplateShown(c.shared, numbering)) : []
  };
}

/**
 * The books a save divides again: divided in the version the editor started
 * from, and divided differently now (decision 106). What languages recorded
 * on their old sections moves to "Earlier sections", so Save warns first.
 */
export function redividedBooks(start: TemplateDoc, now: TemplateDoc, books: { book: string; name: string }[]): string[] {
  return books.filter((b) => bookParts(start, b.book) && !sameParts(start, now, b.book)).map((b) => b.name);
}

/** What changing to a template does, said under the picker's button: what is hidden, or what will be recorded, and that a shared one is followed. */
export function pickerNote(p: { hasCurrent: boolean; recorded: number; language: string; currentParts: string; pick: LibraryChoice }): string {
  const { pick, language } = p;
  const effect = p.hasCurrent
    ? p.recorded
      ? t('content.picker.hiddenRecorded', { language, parts: p.currentParts, count: p.recorded })
      : t('content.picker.hidden', { language, parts: p.currentParts })
    : t('content.picker.willRecord', { language, name: pick.name });
  return `${effect}${pick.source === 'shared' ? ` ${t('content.picker.followsIt', { org: pick.shared.org_name, language })}` : ''}`;
}

/** What a level is for: the last is recorded (and how each is shown), the one above holds it, the rest hold folders. */
export function levelSub(i: number, count: number, display?: LevelDisplay): string {
  if (i < count - 1) return i === count - 2 ? t('content.editor.levelHolds') : t('content.editor.levelFolders');
  switch (display ?? 'reference') {
    case 'reference': return t('content.editor.levelShownByReference');
    case 'name': return t('content.editor.levelShownByName');
    case 'both': return t('content.editor.levelShownByBoth');
  }
}

/** How a level's parts are shown until the team says: by reference for Scripture, by name otherwise. */
export function defaultDisplay(level: { display?: LevelDisplay }, bible: boolean): LevelDisplay {
  return level.display ?? (bible ? 'reference' : 'name');
}

/** The line under the level sheet's choice: an example of how a part shows. */
export function displayExample(display: LevelDisplay, reference: string): string {
  return display === 'reference' ? reference : display === 'name' ? t('content.levelSheet.exampleName') : t('content.levelSheet.exampleBoth', { reference });
}

/** Whether the editor may save: a name, and for Scripture a versification and a book, for an outline a part. */
export function formReady(f: TemplateForm): boolean {
  const bible = f.structure === 'bible';
  return !!f.name.trim() && (!bible || (!!f.versification && f.books.length > 0)) && (bible || f.outline.length > 0);
}

/** The editor's versification row: its name when the document is here, else the choice's, else loading or "choose one". */
export function versificationLabel(doc: VersificationDoc | null | undefined, choiceName: string | undefined, hash: string | null): string {
  return doc?.name ?? choiceName ?? (hash ? t('common.loading') : t('content.editor.chooseOne'));
}

/** The line under the editor's title. */
export function editorSub(isNew: boolean, item: LibraryItemView | null, orgName: string): string {
  const followed = item?.source === 'subscription';
  return isNew ? t('content.editor.subNew', { org: orgName }) : followed ? sourceLine(item) : t('content.editor.subTemplate', { source: sourceLine(item) });
}

/** Which version number a save publishes: one more than the item has, unless that document is already one of its versions. */
export function publishedVersion(item: LibraryItemView | null, docHash: string): number {
  return (item?.versions.length ?? 0) + (item?.versions.some((x) => x.docHash === docHash) ? 0 : 1);
}

/** The toast after saving: created, or saved as a version and who moves to it. */
export function savedToast(p: { isNew: boolean; name: string; n: number; users: string[] }): string {
  return p.isNew ? t('content.editor.created', { name: p.name }) : `${t('content.editor.savedAs', { name: p.name, n: p.n })} ${movesLine(p.users)}`.trim();
}

/** Books the versification has that the template does not, to add. */
export function missingBooks(v11nBooks: string[] | null, have: { book: string }[]): string[] {
  return v11nBooks ? v11nBooks.filter((b) => !have.some((x) => x.book === b)) : [];
}

/** A book row's subline: its code, the app's name when the template renames it, and the chapter count. */
export function bookRowSub(code: string, name: string, known: string, chapters: number): string {
  return [code, ...(known !== name ? [known] : []), ...(chapters ? [t('content.editor.chapterCount', { count: chapters })] : [])].join(' · ');
}

/** What an outline level holds, so only the matching add buttons show: folders, items, or either while it is empty. */
export function outlineHolds(list: TemplateForm['outline']): 'either' | 'folders' | 'items' {
  return list.length === 0 ? 'either' : list[0]!.children ? 'folders' : 'items';
}

/** "3 folders" or "5 items": what a folder in the outline holds. */
export function outlineSummary(children: NonNullable<TemplateForm['outline'][number]['children']>): string {
  const c = countOutline(children);
  return c.folders ? t('content.outline.folders', { count: c.folders }) : t('content.outline.items', { count: c.items });
}

/** The name for a level at a depth: the level's own, the last for anything deeper, else "part". */
export function levelNameAt(levels: TemplateForm['levels'], depth: number): string {
  return levels[Math.min(depth, levels.length - 1)]?.name ?? t('content.levels.part');
}

/** What a part sheet renames to: the trimmed title when it is filled in and different, else nothing. */
export function renamedTitle(title: string, current: string): string | null {
  const next = title.trim();
  return next && next !== current ? next : null;
}
