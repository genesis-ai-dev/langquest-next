// The pieces of asking for a check (decision 91) that the passage's ask
// page, Someone else and the recording's Done screen share (decision 126):
// a check that happens next, with its people, and the questions they will answer.
import type { QuestionSpec, questionsForKind } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';
import { Field, Group, Ico, IconBtn, Row, SectionLabel, SmallBtn } from '../ui/kit';
import { kindIcon } from '../ui/kindIcon';
import { txt } from '../ui/textStyles';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge } from '../helpMode/helpBadge';
import { PeopleLine } from '../checks/parts';
import { nextQuestionType, questionTypeLabel } from './record';
import { C, radius, space } from '../ui/theme';

const newId = () => Crypto.randomUUID();

/** One of the checks that happen next, on the ask page: pick it to ask for it (decision 91). */
export function AskCheckCard(props: { ctx: Ctx; kindId: string; name: string; on: boolean; radio: boolean; people: string[]; onPress: () => void }) {
  const { on } = props;
  const spot = useHelpSpot(props.name, t('passage.published.pickCheckHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="radio" accessibilityState={{ selected: on, checked: on }} aria-checked={on}
      style={[styles.askCard, !on && { borderWidth: 1, borderColor: C.border }]}>
      <View style={styles.askIcon}><Ico name={kindIcon(props.kindId)} size={24} color={C.primary} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={[txt.body, { fontWeight: '800', fontSize: 19 }]}>{props.name}</Text>
        <PeopleLine ctx={props.ctx} people={props.people} />
      </View>
      {props.radio ? <View style={[styles.radio, on && { borderColor: C.primary }]}>{on ? <View style={styles.radioDot} /> : null}</View> : null}
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/**
 * What the people asked will answer: the check's own questions (decision 91),
 * then any added for this request, with a field to add one. On Done, on the ask page
 * and on Someone else alike.
 */
export function TheyAnswer(props: { asked: ReturnType<typeof questionsForKind>; questions: QuestionSpec[]; setQuestions: (f: (qs: QuestionSpec[]) => QuestionSpec[]) => void }) {
  const [draft, setDraft] = useState('');
  const [type, setType] = useState<QuestionSpec['type']>('yesno');
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    props.setQuestions((qs) => [...qs, { id: `ask:${newId()}`, text, type }]);
    setDraft('');
  };
  return (
    <>
      <SectionLabel label={t('checks.theyAnswer')} />
      {props.asked.length > 0 || props.questions.length > 0 ? (
        <Group>
          {props.asked.map((sq) => (
            <Row key={sq.q.id} icon="chat" label={sq.q.text} sub={[questionTypeLabel(sq.q.type), sq.required ? t('common.required') : ''].filter(Boolean).join(' · ')} />
          ))}
          {props.questions.map((q, i) => (
            <Row key={q.id} label={q.text} sub={questionTypeLabel(q.type)} last={i === props.questions.length - 1}
              right={<IconBtn name="close" label={t('passage.ask.removeQuestion')} help={t('passage.ask.removeQuestionHelp')} onPress={() => props.setQuestions((qs) => qs.filter((x) => x.id !== q.id))} bg="transparent" color={C.muted} />} />
          ))}
        </Group>
      ) : null}
      <Field value={draft} onChangeText={setDraft} placeholder={t('passage.ask.askSpecific')} help={t('passage.ask.askSpecificHelp')} />
      <View style={styles.btnRow}>
        <View style={{ flex: 1 }}>
          <SmallBtn label={t('passage.ask.answerType', { type: questionTypeLabel(type) })} help={t('passage.ask.answerTypeHelp')} onPress={() => setType(nextQuestionType)} />
        </View>
        <View style={{ flex: 1 }}>
          <SmallBtn label={t('passage.ask.addQuestion')} icon="plus" tone="primary" help={t('passage.ask.addQuestionHelp')} disabled={!draft.trim()} onPress={add} />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  askCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.xl, borderWidth: 2, borderColor: C.primary, backgroundColor: C.card },
  askIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  btnRow: { flexDirection: 'row', gap: space.sm },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.primary },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' }
});
