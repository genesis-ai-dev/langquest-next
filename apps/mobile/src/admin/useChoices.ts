// The choices behind "What will they record?" and "Who checks the
// recordings?" (decision 71, demo ADR-039), shared by Get ready and New
// Language: the organization's templates and flows and what other
// organizations share (libraryChoices' order: its own first, then
// LangQuest's), with their documents, sorted into the few plain answers an
// admin is offered and the rest one tap deeper.
import type { FlowDoc, KindDef, TemplateDoc } from '@langquest-next/core';
import { useMemo, useState } from 'react';
import { libraryChoices, STARTER_TEMPLATE, type LibraryChoice } from '../templates/contentTemplates';
import type { Ctx } from '../shell/ctx';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { STARTER_FLOW } from '../org/orgAdmin';
import { flowTitle, recordKind, type RecordKind } from './adminModel';
import { offeredFlows, type FlowSetMember } from './flowSetsModel';
import { teamLanguages } from '../reference/languages';

/** A flow with one check by the community, by the title flowTitle gives it in the language showing ("Just the community"). */
const communityOnly = () => flowTitle([{ kindIds: ['community'] }], []);

/** Templates by the kind of work they give: the likely stories and chapters, and something else. */
export function useRecordChoices(ctx: Ctx, inUseItemId: string | null | undefined, extraHashes: (string | null | undefined)[] = []) {
  const lib = useLibrary(ctx);
  const libItems = lib.items;
  const library = ctx.org.state?.library;
  const shared = useSharedItems('template', lib.orgId);
  const choices = useMemo(() => libraryChoices(library ?? {}, libItems('template'), shared.rows, STARTER_TEMPLATE.name), [library, libItems, shared.rows]);
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
  /** One flow of a set in several languages (a Checking Manual's), and the languages it can be switched to. */
  set?: { key: string; members: FlowSetMember<FlowEntry>[] };
}

/**
 * Flows as plain answers: the one in use or suggested, a single community
 * check, the organization's own; the rest one tap deeper. Given the team's
 * `languages`, only flows written in one of them (or saying no language)
 * are offered, and the one in use always (decision 84).
 */
export function useCheckChoices(ctx: Ctx, inUseItemId: string | null | undefined, kinds: readonly KindDef[], languages?: readonly string[]) {
  const lib = useLibrary(ctx);
  const libItems = lib.items;
  const library = ctx.org.state?.library;
  const shared = useSharedItems('flow', lib.orgId);
  const choices = useMemo(() => libraryChoices(library ?? {}, libItems('flow'), shared.rows, STARTER_FLOW.name), [library, libItems, shared.rows]);
  const docs = useLibraryDocs(lib.orgId, choices.map((c) => c.hash));
  const current = choices.find((c) => c.source === 'ours' && c.item.itemId === inUseItemId) ?? null;
  // A set of flows in several languages (a Checking Manual's) is one choice, in the team's language first,
  // switched among the languages it is offered in (decision 84's way, for flows).
  const reads = useMemo(() => languages ?? teamLanguages(ctx.org.state, ctx.language.state, ctx.language.languageId),
    [languages, ctx.org.state, ctx.language.state, ctx.language.languageId]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const entries: FlowEntry[] = offeredFlows(choices.map((c) => ({ c, doc: docs.get<FlowDoc>(c.hash) })).filter((e): e is FlowEntry => !!e.doc),
    reads, chosen, languages, (e) => e.c === current);
  /** Show a set of flows in another of its languages. */
  const chooseIn = (setKey: string, entryKey: string) => setChosen((m) => ({ ...m, [setKey]: entryKey }));
  const kindsOf = (doc: FlowDoc): KindDef[] => [...doc.kinds, ...kinds];
  const titleOf = (doc: FlowDoc) => flowTitle(doc.steps, kindsOf(doc));
  const starter = entries.find((e) => e.c.name === STARTER_FLOW.name || (e.c.source === 'ours' && e.c.item.name === STARTER_FLOW.name)) ?? null;
  const first = (current ? entries.find((e) => e.c === current) : null) ?? starter ?? entries[0] ?? null;
  const community = communityOnly();
  const single = entries.find((e) => e !== first && titleOf(e.doc) === community) ?? null;
  const main = [first, single, ...entries.filter((e) => e !== first && e !== single && e.c.source === 'ours')].filter((e): e is FlowEntry => !!e);
  const rest = entries.filter((e) => !main.includes(e));
  return { lib, entries, current, starter, first, main, rest, kindsOf, titleOf, chooseIn, loaded: shared.loaded };
}
