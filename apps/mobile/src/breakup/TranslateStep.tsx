// "What will they translate?" (decisions.md 74 and 80), shared by New
// Language (step 2) and Get ready (question 1): the Bible or something else;
// for the Bible, first its numbering, for the whole Bible, then how it is
// broken up, from the ways in that numbering, what other languages here use
// first; for something else, the organization's own outlines or a new one.
// The walk-through is one tap away.
import { emptyBooks, withEmptyBooksFilled, type TemplateDoc, type VersificationDoc } from '@langquest-next/core';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { STARTER_TEMPLATE, type LibraryChoice } from '../contentTemplates';
import type { Ctx } from '../ctx';
import { Chip, SectionLabel, txt } from '../kit';
import { prepareDoc } from '../library/docStore';
import { useLibraryDocs } from '../library/useLibrary';
import { FindBiblePage, NumberingChosenPage, NumberingContext, NumberingListPage, QuizPage, type NumberingChoice } from './NumberingStep';
import { factsOf, QUIZ } from './numberingGuide';
import { useRecordChoices } from '../simple/choices';
import { ChoiceCard, Question, QuietLink } from '../simple/admin';
import { C, space } from '../theme';
import { baseWay, CHAPTERS_ITEM, emptyLine, WAY_ITEMS, wayOf, type WayRow } from './model';
import { LessonSheet, OthersChoice, PreviewSheet, WayCard } from './parts';
import { adoptWay, ownTemplate, useWays } from './useBreakup';

export type Translate = ReturnType<typeof useTranslate>;

/** The state of the question, and `resolve()`: the item and version the language will use. */
export function useTranslate(ctx: Ctx, forLanguage: string | null) {
  // The language's numbering: what its template is numbered in, until the admin chooses another.
  const [numberingCode, setNumberingCode] = useState<string | null>(null);
  const here = forLanguage && forLanguage === ctx.language.languageId ? ctx.language.state?.template?.value : null;
  const hereDocs = useLibraryDocs(ctx.language.orgId, [here?.docHash]);
  const hereDoc = hereDocs.get<TemplateDoc>(here?.docHash);
  const hereCode = hereDoc?.bible ? hereDocs.get<VersificationDoc>(hereDoc.bible.versification)?.code ?? null : null;
  const code = numberingCode ?? hereCode;
  const ways = useWays(ctx, forLanguage, code);
  // The LangQuest way the language uses now ("langquest.bible.fia"), whatever its numbering.
  const hereItem = here ? ways.lib.item(here.itemId) : null;
  const hereFrom = hereItem?.subscription ? { orgId: hereItem.subscription.sourceOrgId, itemId: hereItem.subscription.sourceItemId } : hereItem?.copiedFrom ?? null;
  const hereWay = hereFrom?.orgId === STARTER_TEMPLATE.orgId ? baseWay(hereFrom.itemId) : null;
  const rec = useRecordChoices(ctx, forLanguage === ctx.language.languageId ? ctx.language.state?.template?.value.itemId : null);
  const [what, setWhat] = useState<'bible' | 'else' | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [outlineKey, setOutlineKey] = useState<string | null>(null);
  // Books the way leaves out wait to be divided (decision 80), unless the admin says "by chapter".
  const [others, setOthers] = useState<'chapters' | 'later'>('later');
  const outlines = useMemo(() => rec.choices.filter((c) => rec.kindOf(c) === 'outline'), [rec.choices, rec.kindOf]);
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
  const empty = doc && shownWhat === 'bible' && row && !row.later && !row.inUse ? emptyBooks(doc) : [];
  const chaptersDoc = ways.docOf(ways.way(CHAPTERS_ITEM)?.choice);
  /** What the language gets: the way as it is, or with the books it leaves out broken up by chapter. */
  const finalDoc = empty.length && others === 'chapters' && doc && chaptersDoc ? withEmptyBooksFilled(doc, chaptersDoc) : doc;

  async function resolve(): Promise<{ itemId: string; docHash: string; doc: TemplateDoc; unitPrefix?: string }> {
    const lib = ways.lib;
    if (shownWhat === 'else') {
      if (!outline || !doc) throw new Error('Choose or make an outline first.');
      return { itemId: await adoptWay(lib, outline), docHash: outline.hash, doc };
    }
    if (!row || !doc || !finalDoc) throw new Error('Choose how the Bible is broken up.');
    // The same way in another numbering keeps the language's part ids: parts that stay the same keep their work.
    const keep = here && hereWay && wayOf(row.choice) === hereWay ? { unitPrefix: here.unitPrefix } : {};
    if (finalDoc === doc) return { itemId: await adoptWay(lib, row.choice), docHash: row.choice.hash, doc, ...keep };
    // FIA's passages, the other books by chapter: the organization's own template, made once and reused.
    const name = `${row.choice.name}, other books by chapter`;
    const { hash } = await prepareDoc(finalDoc);
    const existing = lib.items('template').find((it) => !it.archived && it.source !== 'subscription' && it.current === hash);
    if (existing) return { itemId: existing.itemId, docHash: hash, doc: finalDoc, ...keep };
    if (row.choice.source === 'shared') {
      const copyId = await lib.copy(row.choice.shared);
      const out = await lib.publish({ kind: 'template', itemId: copyId, name, description: finalDoc.description, doc: finalDoc });
      return { ...out, doc: finalDoc, ...keep };
    }
    const out = await ownTemplate(ctx, lib, { doc: finalDoc, name, from: row.choice.item, fromHash: row.choice.hash });
    return { ...out, doc: finalDoc, ...keep };
  }

  const numbering = ways.numberings.find((n) => n.code === code) ?? null;
  const ready = shownWhat === 'bible' ? !!code && !!row && !!doc : shownWhat === 'else' ? !!outline : false;

  // One question a screen (decision 80): what they translate, then the numbering (found, asked, or listed,
  // then shown), then how it is divided. The screen holding these asks `advance` and `retreat` first.
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
    if (page === 'what' && shownWhat === 'bible') { setPage(numbering ? 'numbered' : 'find'); return true; }
    if (page === 'numbered') { setPage('ways'); return true; }
    return false;
  };
  const retreat = (): boolean => {
    if (page === 'ways') { setPage('numbered'); return true; }
    if (page === 'numbered') { setPage('what'); return true; }
    if (page === 'find') { setPage(numbering ? 'numbered' : 'what'); return true; }
    if (page === 'quiz' && quizTrail.length > 1) { setQuizTrail((q) => q.slice(0, -1)); return true; }
    if (page === 'quiz' || page === 'list') { setPage('find'); return true; }
    return false;
  };
  const canContinue = page === 'what' ? (shownWhat === 'bible' || (shownWhat === 'else' && !!outline))
    : page === 'numbered' ? !!numbering : page === 'ways' ? ready : false;
  return {
    ways, rec, what: shownWhat, setWhat, row, setKey, outlines, outline, setOutlineKey, others, setOthers, empty, doc, finalDoc, v11n, resolve,
    numbering, setNumbering: (c: string) => { setNumberingCode(c); setKey(null); }, numberingChanged: !!hereCode && !!code && code !== hereCode,
    ready, page, found, choose, advance, retreat, canContinue, quizTrail, setQuizTrail,
    setPage: (p: TranslatePage) => { if (p === 'quiz') setQuizTrail([QUIZ.start]); setPage(p); },
    /** Pages answered by tapping a choice have no Continue. */
    showContinue: page === 'what' || page === 'numbered' || page === 'ways',
    /** The last page: what follows belongs to the screen holding the question. */
    last: page === 'ways' || (page === 'what' && shownWhat === 'else')
  };
}

export type TranslatePage = 'what' | 'find' | 'quiz' | 'list' | 'numbered' | 'ways';

/** The question on screen, one page at a time. `lang` names the language ("Hadiyya"). */
export function TranslateQuestion(props: { ctx: Ctx; t: Translate; lang: string; canMake: boolean; onMake: () => void }) {
  const { t } = props;
  const [lesson, setLesson] = useState(false);
  const [peek, setPeek] = useState<WayRow | null>(null);
  const bibleUsed = t.ways.rows.find((r) => r.usedIn.length > 0);
  const wayDoc = (item: string) => t.ways.docOf(t.ways.way(item)?.choice);
  const fiaV11n = t.ways.v11nOf(wayDoc(WAY_ITEMS[0]));
  const nDocs = useLibraryDocs(props.ctx.language.orgId, t.ways.numberings.map((n) => n.hash));
  const factsFor = (n: NumberingChoice) => factsOf(nDocs.get<VersificationDoc>(n.hash));

  if (t.page === 'find') {
    return <FindBiblePage numberings={t.ways.numberings} usedIn={t.ways.usedInByNumbering} onPick={t.choose} onQuiz={() => t.setPage('quiz')} onList={() => t.setPage('list')} />;
  }
  if (t.page === 'quiz') {
    return <QuizPage numberings={t.ways.numberings} trail={t.quizTrail} setTrail={t.setQuizTrail} onDone={(c, note) => t.choose(c, undefined, note)} onList={() => t.setPage('list')} />;
  }
  if (t.page === 'list') return <NumberingListPage numberings={t.ways.numberings} factsFor={factsFor} onPick={(c) => t.choose(c)} />;
  if (t.page === 'numbered' && t.numbering) {
    return <NumberingChosenPage choice={t.numbering} facts={factsFor(t.numbering)} {...t.found} onChange={() => t.setPage('find')} />;
  }
  if (t.page === 'ways' || t.page === 'numbered') {
    return (
      <>
        {t.numbering ? <NumberingContext choice={t.numbering} onPress={() => t.setPage('find')} /> : null}
        <Question>How should the Bible be broken up?</Question>
        {t.ways.rows.map((r) => (
          <WayCard key={r.choice.key} row={r} doc={t.ways.docOf(r.choice)} v11n={t.ways.v11nOf(t.ways.docOf(r.choice))} on={t.row === r}
            onPress={() => t.setKey(r.choice.key)} onPreview={() => setPeek(r)}>
            {t.row === r && t.empty.length ? (
              <OthersChoice empty={emptyLine(t.doc!)} count={t.empty.length} on={t.others} onPick={t.setOthers} />
            ) : null}
          </WayCard>
        ))}
        {t.ways.rows.length === 0 ? <Text style={txt.smMuted}>{t.ways.loaded ? 'Nothing to choose from yet. Connect to load the ways LangQuest offers.' : 'Loading…'}</Text> : null}
        <QuietLink icon="help" label="How is material broken up?" detail="A short walk-through in five steps." onPress={() => setLesson(true)} />
        <LessonSheet visible={lesson} onClose={() => setLesson(false)} wayDoc={wayDoc} v11n={fiaV11n} />
        <PreviewSheet key={peek?.choice.key ?? 'none'} visible={!!peek} name={peek?.choice.name ?? ''} doc={t.ways.docOf(peek?.choice)} v11n={t.ways.v11nOf(t.ways.docOf(peek?.choice))}
          onClose={() => setPeek(null)} onUse={peek ? () => { t.setKey(peek.choice.key); setPeek(null); } : undefined} />
      </>
    );
  }
  return (
    <>
      <Question>What will {props.lang} translate?</Question>
      <ChoiceCard on={t.what === 'bible'} icon="book" title="The Bible"
        sub={bibleUsed ? `Used in ${bibleUsed.usedIn[0]}` : undefined} onPress={() => t.setWhat('bible')} />
      <ChoiceCard on={t.what === 'else'} icon="folder" title="Something else"
        sub="Stories, songs, lessons" onPress={() => t.setWhat('else')} />

      {t.what === 'else' ? (
        <>
          {t.outlines.length ? (
            <>
              <SectionLabel label="Your organization's own" />
              <View style={{ gap: space.xs }}>
                {t.outlines.map((c) => <Chip key={c.key} label={c.name} on={t.outline === c} onPress={() => t.setOutlineKey(c.key)} />)}
              </View>
            </>
          ) : <Text style={txt.smMuted}>There are no ready-made ones for this yet. Make your own: folders for how it's organized, and the things people record inside them.</Text>}
          {props.canMake ? <QuietLink icon="plus" label="Make your own" detail="Folders, and what to record in them." onPress={props.onMake} /> : null}
        </>
      ) : null}

    </>
  );
}

