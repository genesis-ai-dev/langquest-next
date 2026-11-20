// Adding and renaming folders and stories on an outline language's map, and
// adding a Bible book to a Bible language's map (LAN-239,
// docs/decisions/2026-11-20-add-folders-and-stories-on-the-map.md). Pure:
// the folders the map lists, and the template each change makes. Publishing
// it for this language only is breakup/breakupActions.ts `publishChange`.
import { templateBooks, unitLabel, unitPrefixOf, type LanguageState, type TemplateDoc } from '@langquest-next/core';
import { addNode, findNode, renameNode } from '../templates/contentTemplatesModel';
import { indexesFor } from '../sync/indexes';
import { outlineHolds } from '../templates/model';
import type { Entry } from './mapModel';

/** One folder on an outline language's map, with its stories. `unitId` is null for stories in no folder. */
export interface MapFolder {
  unitId: string | null;
  /** The template's id for it (`unitId` without the template's prefix); null for stories in no folder. */
  nodeId: string | null;
  name: string;
  entries: Entry[];
}

/**
 * An outline language's folders, each with its stories, in the template's
 * order: the folders that hold stories (MAP-6), and the folders with nothing
 * in them yet, so a folder just made shows and can be filled. A folder that
 * holds only folders is not listed: its folders are.
 */
export function mapFolders(state: LanguageState, entries: readonly Entry[]): MapFolder[] {
  const prefix = state.template?.value.unitPrefix ?? null;
  const byParent = new Map<string | null, Entry[]>();
  for (const e of entries) {
    const parent = state.units[e.unitId]?.parentUnitId ?? null;
    const list = byParent.get(parent);
    if (list) list.push(e);
    else byParent.set(parent, [e]);
  }
  const hasChild = new Set<string>();
  for (const u of Object.values(state.units)) if (u.parentUnitId) hasChild.add(u.parentUnitId);
  const empty = indexesFor(state).containers.filter((id) => {
    const u = state.units[id];
    return u?.kind === 'folder' && !hasChild.has(id) && state.hiddenUnits[id]?.value !== true && (prefix === null || unitPrefixOf(id) === prefix);
  });
  const orderOf = (unitId: string | null, list: readonly Entry[]) =>
    (unitId ? state.units[unitId]?.order : undefined) ?? state.units[list[0]?.unitId ?? '']?.order ?? '';
  const folders = [
    ...[...byParent.entries()].map(([unitId, list]) => ({ unitId, list })),
    ...empty.filter((id) => !byParent.has(id)).map((unitId) => ({ unitId, list: [] as Entry[] }))
  ];
  return folders
    .map(({ unitId, list }) => ({
      unitId,
      nodeId: unitId && prefix && unitId.startsWith(`${prefix}/`) ? unitId.slice(prefix.length + 1) : null,
      name: unitId ? unitLabel(state, unitId) ?? unitId : '',
      entries: list,
      order: orderOf(unitId, list)
    }))
    .sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0))
    .map(({ order: _order, ...f }) => f);
}

/** What the map may add to an outline template: stories into a folder of stories, folders at the top when the top holds folders. */
export function outlineAdds(doc: TemplateDoc | null): { newFolder: boolean; storyIn: (nodeId: string | null) => boolean } {
  const outline = doc?.structure === 'outline' ? doc.outline ?? [] : null;
  if (!outline) return { newFolder: false, storyIn: () => false };
  return {
    newFolder: outlineHolds(outline) !== 'items',
    storyIn: (nodeId) => {
      // A folder holds folders or stories, never both (the template editor's rule).
      const list = nodeId === null ? outline : findNode(outline, nodeId)?.children;
      return !!list && outlineHolds(list) !== 'folders';
    }
  };
}

/** An id for a new folder or story, as the template editor makes them: stable, no '/' or '@'. */
export function newNodeId(random: string): string {
  return `n${random.replace(/-/g, '').slice(0, 10)}`;
}

/** The template with a new story at the end of a folder (or at the top), or a new empty folder at the top. */
export function withOutlineAdded(doc: TemplateDoc, c: { parentId: string | null; id: string; name: string; folder: boolean }): TemplateDoc {
  if (doc.structure !== 'outline') throw new Error(`${doc.name} is not an outline template`);
  return { ...doc, outline: addNode(doc.outline ?? [], c.folder ? null : c.parentId, { id: c.id, title: c.name.trim(), folder: c.folder }) };
}

/** The template with a folder or story named another way. */
export function withOutlineRenamed(doc: TemplateDoc, nodeId: string, name: string): TemplateDoc {
  if (doc.structure !== 'outline') throw new Error(`${doc.name} is not an outline template`);
  return { ...doc, outline: renameNode(doc.outline ?? [], nodeId, name.trim()) };
}

/** Whether a typed name may be saved: something to say, and not the name it has. */
export function nameReady(typed: string, was = ''): boolean {
  const name = typed.trim();
  return name.length > 0 && name !== was.trim();
}

/** Books the team's Bible numbering has that the template leaves out, in canon order, for "Add a book". */
export function booksToAdd(doc: TemplateDoc | null, numberingBooks: readonly string[]): string[] {
  if (!doc?.bible) return [];
  const have = new Set(templateBooks(doc).map((b) => b.book));
  return numberingBooks.filter((b) => !have.has(b));
}
