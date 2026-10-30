// Translating a template's section names (breakup/TranslateStep.tsx).
import { emptyBooks, type TemplateDoc, type VersificationDoc } from '@langquest-next/core';
import { useMemo, useState } from 'react';
import { STARTER_TEMPLATE, type LibraryChoice } from '../templates/contentTemplatesModel';
import type { Ctx } from '../shell/ctx';
import { useLibraryDocs } from '../library/useLibrary';
import { QUIZ } from './numberingGuide';
import { useRecordChoices } from '../admin/useChoices';
import { baseWay, WAY_ITEMS, wayOf, type WayRow } from './model';
import { useWays } from './useBreakup';
import { adoptWay } from './breakupActions';
import { docLanguage, inLanguages } from '../reference/languages';

/**
 * The state of the question, and `resolve()`: the item and version the
 * language will use. `languages` are the team's (decision 193): templates in
 * them or saying none are offered, and the one in use; the rest are one tap
 * away (`showEveryLanguage`).
 */
export function useTranslate(ctx: Ctx, forLanguage: string | null, languages?: readonly string[]) {
  // The language's numbering: what its template is numbered in, until the admin chooses another.
  const [numberingCode, setNumberingCode] = useState<string | null>(null);
  const here = forLanguage && forLanguage === ctx.language.languageId ? ctx.language.state?.template?.value : null;
  const hereDocs = useLibraryDocs(ctx.language.orgId, [here?.docHash]);
  const hereDoc = hereDocs.get<TemplateDoc>(here?.docHash);
  const hereCode = hereDoc?.bible ? hereDocs.get<VersificationDoc>(hereDoc.bible.versification)?.code ?? null : null;
  const code = numberingCode ?? hereCode;
  const [everyLanguage, setEveryLanguage] = useState(false);
  const readable = (doc: TemplateDoc | null | undefined) => everyLanguage || !languages || inLanguages(docLanguage(doc), languages);
  const allWays = useWays(ctx, forLanguage, code);
  const ways = { ...allWays, rows: allWays.rows.filter((r) => r.inUse || readable(allWays.docOf(r.choice))) };
  // The LangQuest way the language uses now ("langquest.bible.fia"), whatever its numbering.
  const hereItem = here ? ways.lib.item(here.itemId) : null;
  const hereFrom = hereItem?.subscription ? { orgId: hereItem.subscription.sourceOrgId, itemId: hereItem.subscription.sourceItemId } : hereItem?.copiedFrom ?? null;
  const hereWay = hereFrom?.orgId === STARTER_TEMPLATE.orgId ? baseWay(hereFrom.itemId) : null;
  const rec = useRecordChoices(ctx, forLanguage === ctx.language.languageId ? ctx.language.state?.template?.value.itemId : null);
  const [what, setWhat] = useState<'bible' | 'else' | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [outlineKey, setOutlineKey] = useState<string | null>(null);
  const { choices: recChoices, kindOf } = rec;
  const allOutlines = useMemo(() => recChoices.filter((c) => kindOf(c) === 'outline'), [recChoices, kindOf]);
  const outlines = allOutlines.filter((c) => c === rec.current || readable(rec.docs.get<TemplateDoc>(c.hash)));
  const hiddenLanguages = allWays.rows.length - ways.rows.length + allOutlines.length - outlines.length;
  // Already in use here: start from what the language has.
  const inUse = ways.rows.find((r) => r.inUse) ?? null;
  const outlineInUse = outlines.find((c) => c === rec.current) ?? null;
  const shownWhat = what ?? (outlineInUse ? 'else' : inUse || ways.rows.length ? 'bible' : null);
  // The suggestion does not move as documents arrive: what is in use, else what another language here uses,
  // else FIA's passages (waiting for its document when it is offered), else the first there is.
  const fiaOffered = ways.choices.some((c) => wayOf(c) === WAY_ITEMS[0]);
  // In another numbering, the same way comes first.
  const suggested = inUse ?? (hereWay ? ways.rows.find((r) => wayOf(r.choice) === hereWay) : undefined) ?? ways.rows.find((r) => r.usedIn.length > 0)
    ?? ways.rows.find((r) => wayOf(r.choice) === WAY_ITEMS[0]) ?? (fiaOffered ? null : ways.rows[0] ?? null);
  const row: WayRow | null = ways.rows.find((r) => r.choice.key === key) ?? suggested;
  const outline: LibraryChoice | null = outlines.find((c) => c.key === outlineKey) ?? outlineInUse ?? outlines[0] ?? null;
  const doc = shownWhat === 'bible' ? ways.docOf(row?.choice) : shownWhat === 'else' ? rec.docs.get<TemplateDoc>(outline?.hash) : null;
  const v11n = ways.v11nOf(doc);
  // Books the way leaves out wait to be divided, each from the map when it is needed (decision 93).
  const empty = doc && shownWhat === 'bible' && row && !row.later && !row.inUse ? emptyBooks(doc) : [];

  async function resolve(): Promise<{ itemId: string; docHash: string; doc: TemplateDoc; unitPrefix?: string }> {
    const lib = ways.lib;
    if (shownWhat === 'else') {
      if (!outline || !doc) throw new Error('Choose or make an outline first.');
      return { itemId: await adoptWay(lib, outline), docHash: outline.hash, doc };
    }
    if (!row || !doc) throw new Error('Choose how the Bible is broken up.');
    // The same way in another numbering keeps the language's part ids: parts that stay the same keep their work.
    const keep = here && hereWay && wayOf(row.choice) === hereWay ? { unitPrefix: here.unitPrefix } : {};
    return { itemId: await adoptWay(lib, row.choice), docHash: row.choice.hash, doc, ...keep };
  }

  const numbering = ways.numberings.find((n) => n.code === code) ?? null;
  const ready = shownWhat === 'bible' ? !!code && !!row && !!doc : shownWhat === 'else' ? !!outline : false;

  // One question a screen (decision 80): what they translate, then the numbering (why it matters, the three
  // ways to find it, found, asked, or listed, then shown), then how it is divided. The screen holding these asks `advance` and `retreat` first.
  const [page, setPage] = useState<TranslatePage>('what');
  const [found, setFound] = useState<{ from?: string; note?: string }>({});
  const [quizTrail, setQuizTrail] = useState<string[]>([QUIZ.start]);
  const choose = (c: string, from?: string, note?: string) => {
    setNumberingCode(c);
    setKey(null);
    setFound({ ...(from ? { from } : {}), ...(note ? { note } : {}) });
    setPage('numbered');
  };
  const advance = (): boolean => {
    if (page === 'what' && shownWhat === 'bible') { setPage(numbering ? 'numbered' : 'why'); return true; }
    if (page === 'why') { setPage('how'); return true; }
    if (page === 'numbered') { setPage('ways'); return true; }
    return false;
  };
  const retreat = (): boolean => {
    if (page === 'ways') { setPage('numbered'); return true; }
    if (page === 'numbered') { setPage('what'); return true; }
    if (page === 'why') { setPage('what'); return true; }
    if (page === 'how') { setPage(numbering ? 'numbered' : 'why'); return true; }
    if (page === 'quiz' && quizTrail.length > 1) { setQuizTrail((q) => q.slice(0, -1)); return true; }
    if (page === 'find' || page === 'quiz' || page === 'list') { setPage('how'); return true; }
    return false;
  };
  const canContinue = page === 'what' ? (shownWhat === 'bible' || (shownWhat === 'else' && !!outline))
    : page === 'why' ? true : page === 'numbered' ? !!numbering : page === 'ways' ? ready : false;
  return {
    ways, rec, what: shownWhat, setWhat, row, setKey, outlines, outline, setOutlineKey, empty, doc, v11n, resolve, languages,
    hiddenLanguages, showEveryLanguage: () => setEveryLanguage(true),
    numbering, setNumbering: (c: string) => { setNumberingCode(c); setKey(null); }, numberingChanged: !!hereCode && !!code && code !== hereCode,
    ready, page, found, choose, advance, retreat, canContinue, quizTrail, setQuizTrail,
    setPage: (p: TranslatePage) => { if (p === 'quiz') setQuizTrail([QUIZ.start]); setPage(p); },
    /** Pages answered by tapping a choice have no Continue. */
    showContinue: page === 'what' || page === 'why' || page === 'numbered' || page === 'ways',
    /** The last page: what follows belongs to the screen holding the question. */
    last: page === 'ways' || (page === 'what' && shownWhat === 'else')
  };
}

export type TranslatePage = 'what' | 'why' | 'how' | 'find' | 'quiz' | 'list' | 'numbered' | 'ways';
