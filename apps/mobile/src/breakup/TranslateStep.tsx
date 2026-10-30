// "What will they translate?" (decisions.md 74 and 80), shared by New
// Language (step 2) and Get ready (question 1): the Bible or something else;
// for the Bible, first its numbering, for the whole Bible, then how it is
// broken up, from the ways in that numbering, your own way (book by book)
// first and set apart, then what other languages here use, with a line
// naming the books it leaves waiting (they are divided
// later, from the map; decision 93); for something else, the organization's
// own outlines or a new one. The walk-through is one tap away.
import type { VersificationDoc } from '@langquest-next/core';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { choiceName } from '../templates/contentTemplatesModel';
import { Chip, SectionLabel } from '../ui/kit';
import { HelpRow } from '../helpMode/helpBadge';
import { txt } from '../ui/textStyles';
import { useLibraryDocs } from '../library/useLibrary';
import { FindBiblePage, NumberingChosenPage, NumberingContext, NumberingListPage, QuizPage, type NumberingChoice } from './NumberingStep';
import { factsOf } from './numberingGuide';
import { ChoiceCard, Question, QuietLink } from '../admin/admin';
import { space } from '../ui/theme';
import { emptyLine, WAY_ITEMS, type WayRow } from './model';
import { LessonSheet, PreviewSheet, WayCard } from './parts';
import type { useTranslate } from './useTranslate';

export type Translate = ReturnType<typeof useTranslate>;

/** The question on screen, one page at a time. `lang` names the language ("Hadiyya"). */
export function TranslateQuestion(props: { ctx: Ctx; t: Translate; lang: string; canMake: boolean; onMake: () => void }) {
  // An outline made from here comes back picked (design principle 12).
  const outlinesBefore = useRef<Set<string> | null>(null);
  const outlineKeys = props.t.outlines.map((c) => c.key).join('|');
  useEffect(() => {
    const before = outlinesBefore.current;
    const made = before ? props.t.outlines.find((c) => !before.has(c.key)) : undefined;
    if (made) { outlinesBefore.current = null; props.t.setOutlineKey(made.key); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `outlineKeys` names what changes in `outlines`
  }, [outlineKeys]);
  const makeOwn = () => { outlinesBefore.current = new Set(props.t.outlines.map((c) => c.key)); props.onMake(); };
  const q = props.t;
  const [lesson, setLesson] = useState(false);
  const [peek, setPeek] = useState<WayRow | null>(null);
  const bibleUsed = q.ways.rows.find((r) => r.usedIn.length > 0);
  const wayDoc = (item: string) => q.ways.docOf(q.ways.way(item)?.choice);
  const fiaV11n = q.ways.v11nOf(wayDoc(WAY_ITEMS[0]));
  const nDocs = useLibraryDocs(props.ctx.language.orgId, q.ways.numberings.map((n) => n.hash));
  const factsFor = (n: NumberingChoice) => factsOf(nDocs.get<VersificationDoc>(n.hash));
  // Templates written in languages the team does not use wait one tap away (decision 193).
  const otherLanguages = q.hiddenLanguages > 0
    ? <QuietLink icon="globe" label={t('breakup.translate.otherLanguages')} detail={t('breakup.translate.otherLanguagesDetail')} onPress={q.showEveryLanguage} /> : null;

  if (q.page === 'find') {
    return <FindBiblePage numberings={q.ways.numberings} usedIn={q.ways.usedInByNumbering} languages={q.languages} onPick={q.choose} onQuiz={() => q.setPage('quiz')} onList={() => q.setPage('list')} />;
  }
  if (q.page === 'quiz') {
    return <QuizPage numberings={q.ways.numberings} trail={q.quizTrail} setTrail={q.setQuizTrail} onDone={(c, note) => q.choose(c, undefined, note)} onList={() => q.setPage('list')} />;
  }
  if (q.page === 'list') return <NumberingListPage numberings={q.ways.numberings} factsFor={factsFor} onPick={(c) => q.choose(c)} />;
  if (q.page === 'numbered' && q.numbering) {
    return <NumberingChosenPage choice={q.numbering} facts={factsFor(q.numbering)} {...q.found} onChange={() => q.setPage('find')} />;
  }
  if (q.page === 'ways' || q.page === 'numbered') {
    // Your own way comes first and stands apart (design principle 12, decision 107): every book waits until
    // someone reads it and chooses where its sections start, from the map or My Work. It is LangQuest's
    // "Book by book", which used to come last.
    const own = q.ways.rows.find((r) => r.later) ?? null;
    const ready = q.ways.rows.filter((r) => !r.later);
    return (
      <>
        {q.numbering ? <NumberingContext choice={q.numbering} onPress={() => q.setPage('find')} /> : null}
        <Question>{t('breakup.translate.howBible')}</Question>
        {own ? (
          <ChoiceCard own on={q.row === own} icon="edit" title={t('breakup.own.title')} sub={t('breakup.translate.ownSub')} onPress={() => q.setKey(own.choice.key)}>
            {q.row === own ? <Text style={[txt.smMuted, { marginTop: space.sm }]}>{t('breakup.translate.ownNote')}</Text> : null}
          </ChoiceCard>
        ) : null}
        {own && ready.length ? <SectionLabel label={t('breakup.own.orReadyMade')} /> : null}
        {ready.map((r) => (
          <HelpRow key={r.choice.key} of="breakup.way">
            <WayCard row={r} doc={q.ways.docOf(r.choice)} v11n={q.ways.v11nOf(q.ways.docOf(r.choice))} on={q.row === r}
              onPress={() => q.setKey(r.choice.key)} onPreview={() => setPeek(r)}
              note={q.row === r && q.empty.length ? (
                <Text style={txt.smMuted}>{t('breakup.leftOut.wait', { count: q.empty.length, books: emptyLine(q.doc!) })}</Text>
              ) : null} />
          </HelpRow>
        ))}
        {q.ways.rows.length === 0 ? <Text style={txt.smMuted}>{q.ways.loaded ? t('breakup.translate.nothingYet') : t('common.loading')}</Text> : null}
        {otherLanguages}
        <QuietLink icon="help" label={t('breakup.translate.howBrokenUp')} detail={t('breakup.translate.howBrokenUpDetail')} onPress={() => setLesson(true)} />
        <LessonSheet visible={lesson} onClose={() => setLesson(false)} wayDoc={wayDoc} v11n={fiaV11n} />
        <PreviewSheet key={peek?.choice.key ?? 'none'} visible={!!peek} name={peek ? choiceName(peek.choice) : ''} doc={q.ways.docOf(peek?.choice)} v11n={q.ways.v11nOf(q.ways.docOf(peek?.choice))}
          onClose={() => setPeek(null)} onUse={peek ? () => { q.setKey(peek.choice.key); setPeek(null); } : undefined} />
      </>
    );
  }
  return (
    <>
      <Question>{t('breakup.translate.question', { language: props.lang })}</Question>
      <ChoiceCard on={q.what === 'bible'} icon="book" title={t('breakup.translate.bible')}
        sub={bibleUsed ? t('breakup.usedIn.one', { name: bibleUsed.usedIn[0] }) : undefined} help={t('breakup.translate.bibleHelp')} onPress={() => q.setWhat('bible')} />
      <ChoiceCard on={q.what === 'else'} icon="folder" title={t('breakup.translate.else')}
        sub={t('breakup.translate.elseKinds')} help={t('breakup.translate.elseHelp')} onPress={() => q.setWhat('else')} />

      {q.what === 'else' ? (
        <>
          {q.outlines.length ? (
            <>
              <SectionLabel label={t('breakup.translate.ourOwn')} />
              <View style={{ gap: space.xs }}>
                {q.outlines.map((c) => (
                  <HelpRow key={c.key} of="breakup.outline">
                    <Chip label={choiceName(c)} on={q.outline === c} help={t('breakup.translate.outlineHelp')} onPress={() => q.setOutlineKey(c.key)} />
                  </HelpRow>
                ))}
              </View>
            </>
          ) : <Text style={txt.smMuted}>{t('breakup.translate.noneReady')}</Text>}
          {otherLanguages}
          {props.canMake ? <QuietLink icon="plus" label={t('breakup.translate.makeOwn')} detail={t('breakup.translate.makeOwnDetail')} onPress={makeOwn} /> : null}
        </>
      ) : null}

    </>
  );
}

