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
import { Chip, SectionLabel, txt } from '../kit';
import { prepareDoc } from '../library/docStore';
import { useRecordChoices } from '../simple/choices';
import { ChoiceCard, Question, QuietLink } from '../simple/admin';
import { C, space } from '../theme';
import { CHAPTERS_ITEM, emptyLine, WAY_ITEMS, type WayRow } from './model';
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
  const row: WayRow | null = ways.rows.find((r) => r.choice.key === key) ?? inUse ?? ways.rows[0] ?? null;
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
    const name = `${row.choice.name}, other books by chapter`;
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
  const { t } = props;
  const [lesson, setLesson] = useState(false);
  const [peek, setPeek] = useState<WayRow | null>(null);
  const bibleUsed = t.ways.rows.find((r) => r.usedIn.length > 0);
  const wayDoc = (item: string) => t.ways.docOf(t.ways.way(item)?.choice);
  const fiaV11n = t.ways.v11nOf(wayDoc(WAY_ITEMS[0]));
  return (
    <>
      <Question>What will {props.lang} translate?</Question>
      <ChoiceCard on={t.what === 'bible'} icon="book" title="The Bible"
        sub={bibleUsed ? `Used in ${bibleUsed.usedIn[0]}` : 'Then choose how it is broken up'} onPress={() => t.setWhat('bible')} />
      <ChoiceCard on={t.what === 'else'} icon="folder" title="Something else"
        sub="Stories, songs, lessons. Make folders, and put what to record in them." onPress={() => t.setWhat('else')} />
      <QuietLink icon="help" label="How is material broken up?" detail="A short walk-through in five steps." onPress={() => setLesson(true)} />

      {t.what === 'bible' ? (
        <>
          <SectionLabel label="How should the Bible be broken up?" />
          <Text style={[txt.sm, { color: C.muted, marginTop: -space.sm }]}>Each piece is recorded on its own. The bars show a book cut that way.</Text>
          {t.ways.rows.map((r) => (
            <WayCard key={r.choice.key} row={r} doc={t.ways.docOf(r.choice)} v11n={t.ways.v11nOf(t.ways.docOf(r.choice))} on={t.row === r}
              onPress={() => t.setKey(r.choice.key)} onPreview={() => setPeek(r)}>
              {t.row === r && t.empty.length ? (
                <OthersChoice empty={emptyLine(t.doc!)} count={t.empty.length} on={t.others} onPick={t.setOthers} />
              ) : null}
            </WayCard>
          ))}
          {t.ways.rows.length === 0 ? <Text style={txt.smMuted}>{t.ways.loaded ? 'Nothing to choose from yet. Connect to load the ways LangQuest offers.' : 'Loading…'}</Text> : null}
        </>
      ) : null}

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

      <LessonSheet visible={lesson} onClose={() => setLesson(false)} wayDoc={wayDoc} v11n={fiaV11n} />
      <PreviewSheet key={peek?.choice.key ?? 'none'} visible={!!peek} name={peek?.choice.name ?? ''} doc={t.ways.docOf(peek?.choice)} v11n={t.ways.v11nOf(t.ways.docOf(peek?.choice))}
        onClose={() => setPeek(null)} onUse={peek ? () => { t.setKey(peek.choice.key); setPeek(null); } : undefined} />
    </>
  );
}

