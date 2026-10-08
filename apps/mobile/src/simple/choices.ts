// The choices behind "What will they record?" and "Who checks the
// recordings?" (decision 71, demo ADR-039), shared by Get ready and New
// Language: the organization's templates and flows and what other
// organizations share (libraryChoices' order: its own first, then
// LangQuest's), with their documents, sorted into the few plain answers an
// admin is offered and the rest one tap deeper.
import { type FlowDoc, type KindDef, type TemplateDoc } from '@langquest-next/core';
import { useMemo } from 'react';
import { libraryChoices, STARTER_TEMPLATE, type LibraryChoice } from '../contentTemplates';
import type { Ctx } from '../ctx';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { STARTER_FLOW } from '../orgAdmin';
import { flowTitle, recordKind, type RecordKind } from './adminModel';

/** Templates by the kind of work they give: the likely stories and chapters, and something else. */
export function useRecordChoices(ctx: Ctx, inUseItemId: string | null | undefined, extraHashes: (string | null | undefined)[] = []) {
  const lib = useLibrary(ctx);
  const library = ctx.org.state?.library;
  const shared = useSharedItems('template', lib.orgId);
  const choices = useMemo(() => libraryChoices(library ?? {}, lib.items('template'), shared.rows, STARTER_TEMPLATE.name), [library, lib.items, shared.rows]);
  const docs = useLibraryDocs(lib.orgId, [...choices.map((c) => c.hash), ...extraHashes]);
  const current = choices.find((c) => c.source === 'ours' && c.item.itemId === inUseItemId) ?? null;
  const kindOf = (c: LibraryChoice | null | undefined): RecordKind | null => (c ? recordKind(docs.get<TemplateDoc>(c.hash)) : null);
  // The likely one of each kind: the one in use, else the organization's own, else LangQuest's.
  const pickFor = (kind: RecordKind) => (kindOf(current) === kind ? current : choices.find((c) => kindOf(c) === kind)) ?? null;
  const stories = pickFor('stories');
  const chapters = pickFor('chapters');
  // Something else: outlines, whole books, and anything else the organization made itself.
  const others = choices.filter((c) => c !== stories && c !== chapters && (kindOf(c) === 'outline' || kindOf(c) === 'books' || c.source === 'ours'));
  return { lib, choices, docs, current, kindOf, stories, chapters, others, loaded: shared.loaded, error: shared.error };
}

export interface FlowEntry {
  c: LibraryChoice;
  doc: FlowDoc;
}

/** Flows as plain answers: the one in use or suggested, a single community check, the organization's own; the rest one tap deeper. */
export function useCheckChoices(ctx: Ctx, inUseItemId: string | null | undefined, kinds: readonly KindDef[]) {
  const lib = useLibrary(ctx);
  const library = ctx.org.state?.library;
  const shared = useSharedItems('flow', lib.orgId);
  const choices = useMemo(() => libraryChoices(library ?? {}, lib.items('flow'), shared.rows, STARTER_FLOW.name), [library, lib.items, shared.rows]);
  const docs = useLibraryDocs(lib.orgId, choices.map((c) => c.hash));
  const current = choices.find((c) => c.source === 'ours' && c.item.itemId === inUseItemId) ?? null;
  const entries = choices.map((c) => ({ c, doc: docs.get<FlowDoc>(c.hash) })).filter((e): e is FlowEntry => !!e.doc);
  const kindsOf = (doc: FlowDoc): KindDef[] => [...doc.kinds, ...kinds];
  const titleOf = (doc: FlowDoc) => flowTitle(doc.steps, kindsOf(doc));
  const starter = entries.find((e) => e.c.name === STARTER_FLOW.name || (e.c.source === 'ours' && e.c.item.name === STARTER_FLOW.name)) ?? null;
  const first = (current ? entries.find((e) => e.c === current) : null) ?? starter ?? entries[0] ?? null;
  const single = entries.find((e) => e !== first && titleOf(e.doc) === 'Just the community') ?? null;
  const main = [first, single, ...entries.filter((e) => e !== first && e !== single && e.c.source === 'ours')].filter((e): e is FlowEntry => !!e);
  const rest = entries.filter((e) => !main.includes(e));
  return { lib, entries, current, starter, first, main, rest, kindsOf, titleOf, loaded: shared.loaded };
}
