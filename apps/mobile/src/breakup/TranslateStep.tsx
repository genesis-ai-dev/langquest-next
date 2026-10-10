// "What will they translate?" (decisions.md 74), shared by New Language
// (step 2) and Get ready (question 1): the Bible or something else; for
// the Bible, how it is broken up, from a list where what other languages
// here use comes first; for something else, the organization's own outlines
// or a new one. The walk-through is one tap away.
import { emptyBooks, withEmptyBooksFilled, type TemplateDoc } from '@langquest-next/core';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { type LibraryChoice } from '../contentTemplates';
import type { Ctx } from '../ctx';
import { t } from '../i18n';
import { Chip, SectionLabel, txt } from '../kit';
import { prepareDoc } from '../library/docStore';
import { useRecordChoices } from '../simple/choices';
import { ChoiceCard, Question, QuietLink } from '../simple/admin';
import { C, space } from '../theme';
import { CHAPTERS_ITEM, emptyLine, WAY_ITEMS, wayOf, type WayRow } from './model';
import { LessonSheet, OthersChoice, PreviewSheet, WayCard } from './parts';
import { adoptWay, ownTemplate, useWays } from './useBreakup';

export type Translate = ReturnType<typeof useTranslate>;

/** The state of the question, and `resolve()`: the item and version the language will use. */
export function useTranslate(ctx: Ctx, forLanguage: string | null) {
  const ways = useWays(ctx, forLanguage);
  const rec = useRecordChoices(ctx, forLanguage === ctx.language.languageId ? ctx.language.state?.template?.value.itemId : null);
  const [what, setWhat] = useState<'bible' | 'else' | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [outlineKey, setOutlineKey] = useState<string | null>(null);
  const [others, setOthers] = useState<'chapters' | 'later'>('chapters');
  const outlines = useMemo(() => rec.choices.filter((c) => rec.kindOf(c) === 'outline'), [rec.choices, rec.kindOf]);
  // Already in use here: start from what the language has.
  const inUse = ways.rows.find((r) => r.inUse) ?? null;
  const outlineInUse = outlines.find((c) => c === rec.current) ?? null;
  const shownWhat = what ?? (outlineInUse ? 'else' : inUse || ways.rows.length ? 'bible' : null);
  // The suggestion does not move as documents arrive: what is in use, else what another language here uses,
  // else FIA's passages (waiting for its document when it is offered), else the first there is.
  const fiaOffered = ways.choices.some((c) => wayOf(c) === WAY_ITEMS[0]);
  const suggested = inUse ?? ways.rows.find((r) => r.usedIn.length > 0)
    ?? ways.rows.find((r) => wayOf(r.choice) === WAY_ITEMS[0]) ?? (fiaOffered ? null : ways.rows[0] ?? null);
  const row: WayRow | null = ways.rows.find((r) => r.choice.key === key) ?? suggested;
  const outline: LibraryChoice | null = outlines.find((c) => c.key === outlineKey) ?? outlineInUse ?? outlines[0] ?? null;
  const doc = shownWhat === 'bible' ? ways.docOf(row?.choice) : shownWhat === 'else' ? rec.docs.get<TemplateDoc>(outline?.hash) : null;
  const v11n = ways.v11nOf(doc);
  const empty = doc && shownWhat === 'bible' && row && !row.later && !row.inUse ? emptyBooks(doc) : [];
  const chaptersDoc = ways.docOf(ways.way(CHAPTERS_ITEM)?.choice);
  /** What the language gets: the way as it is, or with the books it leaves out broken up by chapter. */
  const finalDoc = empty.length && others === 'chapters' && doc && chaptersDoc ? withEmptyBooksFilled(doc, chaptersDoc) : doc;

  async function resolve(): Promise<{ itemId: string; docHash: string; doc: TemplateDoc }> {
    const lib = ways.lib;
    if (shownWhat === 'else') {
      if (!outline || !doc) throw new Error('Choose or make an outline first.');
      return { itemId: await adoptWay(lib, outline), docHash: outline.hash, doc };
    }
    if (!row || !doc || !finalDoc) throw new Error('Choose how the Bible is broken up.');
    if (finalDoc === doc) return { itemId: await adoptWay(lib, row.choice), docHash: row.choice.hash, doc };
    // FIA's passages, the other books by chapter: the organization's own template, made once and reused.
    const name = `${row.choice.name}, other books by chapter`; // i18n-ignore: the new template's name, stored in the event log
    const { hash } = await prepareDoc(finalDoc);
    const existing = lib.items('template').find((it) => !it.archived && it.source !== 'subscription' && it.current === hash);
    if (existing) return { itemId: existing.itemId, docHash: hash, doc: finalDoc };
    if (row.choice.source === 'shared') {
      const copyId = await lib.copy(row.choice.shared);
      const out = await lib.publish({ kind: 'template', itemId: copyId, name, description: finalDoc.description, doc: finalDoc });
      return { ...out, doc: finalDoc };
    }
    const out = await ownTemplate(ctx, lib, { doc: finalDoc, name, from: row.choice.item, fromHash: row.choice.hash });
    return { ...out, doc: finalDoc };
  }

  return {
    ways, rec, what: shownWhat, setWhat, row, setKey, outlines, outline, setOutlineKey, others, setOthers, empty, doc, finalDoc, v11n, resolve,
    ready: shownWhat === 'bible' ? !!row && !!doc : shownWhat === 'else' ? !!outline : false
  };
}

/** The question on screen. `lang` names the language ("Hadiyya"). */
export function TranslateQuestion(props: { ctx: Ctx; t: Translate; lang: string; canMake: boolean; onMake: () => void }) {
  const q = props.t;
  const [lesson, setLesson] = useState(false);
  const [peek, setPeek] = useState<WayRow | null>(null);
  const bibleUsed = q.ways.rows.find((r) => r.usedIn.length > 0);
  const wayDoc = (item: string) => q.ways.docOf(q.ways.way(item)?.choice);
  const fiaV11n = q.ways.v11nOf(wayDoc(WAY_ITEMS[0]));
  return (
    <>
      <Question>{t('breakup.translate.question', { language: props.lang })}</Question>
      <ChoiceCard on={q.what === 'bible'} icon="book" title={t('breakup.translate.bible')}
        sub={bibleUsed ? t('breakup.usedIn.one', { name: bibleUsed.usedIn[0] }) : t('breakup.translate.bibleSub')} onPress={() => q.setWhat('bible')} />
      <ChoiceCard on={q.what === 'else'} icon="folder" title={t('breakup.translate.else')}
        sub={t('breakup.translate.elseSub')} onPress={() => q.setWhat('else')} />
      <QuietLink icon="help" label={t('breakup.translate.howBrokenUp')} detail={t('breakup.translate.howBrokenUpDetail')} onPress={() => setLesson(true)} />

      {q.what === 'bible' ? (
        <>
          <SectionLabel label={t('breakup.translate.howBible')} />
          <Text style={[txt.sm, { color: C.muted, marginTop: -space.sm }]}>{t('breakup.translate.eachPiece')}</Text>
          {q.ways.rows.map((r) => (
            <WayCard key={r.choice.key} row={r} doc={q.ways.docOf(r.choice)} v11n={q.ways.v11nOf(q.ways.docOf(r.choice))} on={q.row === r}
              onPress={() => q.setKey(r.choice.key)} onPreview={() => setPeek(r)}>
              {q.row === r && q.empty.length ? (
                <OthersChoice empty={emptyLine(q.doc!)} count={q.empty.length} on={q.others} onPick={q.setOthers} />
              ) : null}
            </WayCard>
          ))}
          {q.ways.rows.length === 0 ? <Text style={txt.smMuted}>{q.ways.loaded ? t('breakup.translate.nothingYet') : t('common.loading')}</Text> : null}
        </>
      ) : null}

      {q.what === 'else' ? (
        <>
          {q.outlines.length ? (
            <>
              <SectionLabel label={t('breakup.translate.ourOwn')} />
              <View style={{ gap: space.xs }}>
                {q.outlines.map((c) => <Chip key={c.key} label={c.name} on={q.outline === c} onPress={() => q.setOutlineKey(c.key)} />)}
              </View>
            </>
          ) : <Text style={txt.smMuted}>{t('breakup.translate.noneReady')}</Text>}
          {props.canMake ? <QuietLink icon="plus" label={t('breakup.translate.makeOwn')} detail={t('breakup.translate.makeOwnDetail')} onPress={props.onMake} /> : null}
        </>
      ) : null}

      <LessonSheet visible={lesson} onClose={() => setLesson(false)} wayDoc={wayDoc} v11n={fiaV11n} />
      <PreviewSheet key={peek?.choice.key ?? 'none'} visible={!!peek} name={peek?.choice.name ?? ''} doc={q.ways.docOf(peek?.choice)} v11n={q.ways.v11nOf(q.ways.docOf(peek?.choice))}
        onClose={() => setPeek(null)} onUse={peek ? () => { q.setKey(peek.choice.key); setPeek(null); } : undefined} />
    </>
  );
}

