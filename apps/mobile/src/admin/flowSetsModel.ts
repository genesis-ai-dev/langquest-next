// Ready-made flows published once per language (Translation Academy's
// Checking Manual in 22 of them): one organization's flows of one pattern
// are one choice, shown in the team's language and switched to another the
// way a guide set is (reference/guideSets.ts, decision 84). Pure, so it is
// tested (test/flowSetsModel.test.ts).
import type { FlowDoc } from '@langquest-next/core';
import type { LibraryChoice } from '../templates/contentTemplates';
import { docLanguage, sameLanguage } from '../reference/languages';

/** A flow's language: the `language` its words are in (decision 84, as flows gained it). */
export function flowLanguage(doc: FlowDoc): string | undefined {
  return docLanguage(doc) ?? undefined;
}

/** The organization a choice comes from: the one sharing it, or the one this organization follows or copied it from. */
export function choiceOrigin(c: LibraryChoice): string {
  if (c.source === 'shared') return c.shared.org_id;
  return c.item.subscription?.sourceOrgId ?? c.item.copiedFrom?.orgId ?? '';
}

export interface FlowSetMember<T> { language: string; entry: T }

/**
 * Entries with each set of one organization's flows of one pattern, each in
 * its language, made one: the member in the first of `reads` it has (the
 * team's reference language first), else English, else the first. Its
 * `members` are the languages to switch to, in order of `reads` then name.
 * A flow with no pattern or language stands alone.
 */
export function collapseFlowSets<T extends { c: LibraryChoice; doc: FlowDoc }>(entries: readonly T[], reads: readonly string[], chosen: Readonly<Record<string, string>> = {}):
  (T & { set?: { key: string; members: FlowSetMember<T>[] } })[] {
  const keyOf = (e: T) => {
    const lang = flowLanguage(e.doc);
    return e.doc.pattern && lang ? `${choiceOrigin(e.c)}|${e.doc.pattern}` : null;
  };
  const groups = new Map<string, FlowSetMember<T>[]>();
  for (const e of entries) {
    const k = keyOf(e);
    if (k) groups.set(k, [...(groups.get(k) ?? []), { language: flowLanguage(e.doc)!, entry: e }]);
  }
  const rank = (l: string) => { const i = reads.findIndex((r) => sameLanguage(r, l)); return i < 0 ? reads.length + (l === 'eng' ? 0 : 1) : i; };
  const out: (T & { set?: { key: string; members: FlowSetMember<T>[] } })[] = [];
  const done = new Set<string>();
  for (const e of entries) {
    const k = keyOf(e);
    if (!k) { out.push(e); continue; }
    if (done.has(k)) continue;
    done.add(k);
    const members = [...groups.get(k)!].sort((a, b) => rank(a.language) - rank(b.language) || a.language.localeCompare(b.language));
    const pick = members.find((m) => m.entry.c.key === chosen[k]) ?? members[0]!;
    out.push(members.length > 1 ? { ...pick.entry, set: { key: k, members } } : pick.entry);
  }
  return out;
}
