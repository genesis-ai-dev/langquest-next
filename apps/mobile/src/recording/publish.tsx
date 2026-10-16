// Done, as its own screen inside the recording workspace (decision 127,
// replacing Publish; demo ADR-034, simple/translator.tsx Publish; REC-W3,
// REC-W4): hear the version once more, say something about it (voice first;
// needed from Version 2 on, where it says what changed), and send it to the
// people who do its next check, all in one tap. "Someone else" and "Send
// later" finish it too. What is said here is kept as you go, like the parts,
// so leaving loses nothing.
import { checkPeople, questionsForKind, type KindStatus, type QuestionSpec, type ReviewView } from '@langquest-next/core';
import { useEffect, useState, type ReactNode } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { ClipPlayer } from '../audio/clipPlayer';
import type { Ctx } from '../shell/ctx';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { Field, Header, Ico, PrimaryBtn, QuietLinks, Screen, SectionLabel, Sheet } from '../ui/kit';
import { SavedMark } from '../ui/SavedMark';
import { txt } from '../ui/textStyles';
import { feedbackSource, versionTitle, type PassageView } from '../passage/passageView';
import { AskCheckCard, TheyAnswer } from '../passage/askParts';
import { askButtonLabel } from '../passage/recordModel';
import type { UsualTarget } from '../passage/sendTarget';
import { C, radius, space, target, TINT, type as T } from '../ui/theme';
import { VoiceNote } from '../audio/voiceNote';
import { checkName } from '../admin/adminModel';
import { useDraft } from '../drafts/useDraft';
import { isNoteDraft, type NoteDraft } from '../drafts/draftModel';
import { mmss } from './model';
import { styles as ps } from './blockStyles';

/** How a finished version goes on: to the usual people for a check, to someone else, or nowhere yet. */
export type DoneAsk = { kindId: string; questions: QuestionSpec[] } | { someoneElse: string } | null;

export function PublishScreen(props: {
  ctx: Ctx; v: PassageView; n: number; first: boolean; cards: string[]; totalMs: number | undefined; bible: string | undefined;
  busy: boolean; answers: ReviewView[]; tied: number; revisingKind?: string;
  /** A step makes this version (a final recording, decisions.md 131): the step says what it is, so no change note. */
  making?: boolean;
  /** Writing (decisions.md 131): its words to look over instead of a recording to hear, and what it is when not a version. */
  preview?: ReactNode;
  title?: string;
  /** Where what is said here is kept until it is done (drafts/draftModel.ts). */
  draftKey: string | null;
  /** The checks it can go to next (recordModel `nextAfterDone`), with whoever usually does each. */
  next: { kinds: KindStatus[]; targets: Record<string, UsualTarget | undefined> } | null;
  onClose: () => void;
  /** Finish it; resolves true once it is on the record. */
  onDone: (note: string, hash: string | null, ask: DoneAsk) => Promise<boolean>;
}) {
  const { ctx, v } = props;
  const title = props.title ?? versionTitle(props.n);
  // A first draft of the note, in the person's words: they can change it, and it is kept as they leave it.
  const empty: NoteDraft = { text: props.revisingKind ? t('recording.publish.revisedAfter', { kind: props.revisingKind }) : '', hash: null };
  const draft = useDraft(props.draftKey, empty, isNoteDraft);
  const { text, hash } = draft.value;
  const setText = (f: (prev: string) => string) => draft.set((d) => ({ ...d, text: f(d.text) }));
  const [saying, setSaying] = useState(false);
  const needsNote = !props.first && !props.making;
  // Which of the checks next it goes to: the first, unless another is picked (decision 91).
  const [kindId, setKindId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuestionSpec[]>([]);
  const kinds = props.next?.kinds ?? [];
  const next = kinds.find((k) => k.kindId === kindId) ?? kinds[0];
  const nextTarget = next ? props.next?.targets[next.kindId] : undefined;
  // A screen inside the workspace: Back returns to it, never past it.
  const onClose = props.onClose;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);
  const said = !!text.trim() || !!hash;
  const parts = t('recording.publish.parts', { count: props.cards.length });
  const sub = [parts, props.totalMs !== undefined ? mmss(props.totalMs) : null, props.bible ? t('recording.publish.withBible', { bible: props.bible }) : null].filter(Boolean).join(' · ');
  const blocked = needsNote && !said;
  const done = (ask: DoneAsk) => {
    void props.onDone(text, hash, ask).then((ok) => { if (ok) void draft.clear(); });
  };
  const footer = next ? (
    <View style={{ gap: space.xs }}>
      <PrimaryBtn label={askButtonLabel({ target: nextTarget, kindId: next.kindId, kinds: v.kinds, name: ctx.name })} icon="send" busy={props.busy} disabled={blocked}
        help={nextTarget ? t('recording.publish.sendHelp', { version: title }) : t('recording.publish.askHelp', { version: title })}
        onPress={() => done(nextTarget ? { kindId: next.kindId, questions } : { someoneElse: next.kindId })} />
      <QuietLinks items={[
        ...(nextTarget ? [{ label: t('passage.published.someoneElse'), icon: 'people' as const, help: t('passage.published.someoneElseHelp'), onPress: () => { if (!blocked && !props.busy) done({ someoneElse: next.kindId }); } }] : []),
        { label: t('recording.publish.sendLater'), icon: 'clock' as const, help: t('recording.publish.sendLaterHelp', { version: title }), onPress: () => { if (!blocked && !props.busy) done(null); } }
      ]} />
    </View>
  ) : (
    <PrimaryBtn label={t('recording.publish.finish', { version: title })} icon="check" busy={props.busy} disabled={blocked}
      help={t('recording.publish.finishHelp', { version: title })} onPress={() => done(null)} />
  );
  return (
    <Screen
      header={<Header title={v.title} sub={title} onBack={props.onClose} close action={<SavedMark status={draft.status} help={t('saved.draftHelp')} />} />}
      footer={footer}>
      {props.preview ?? (
        <ClipPlayer language={ctx.language} hashes={props.cards} title={title} sub={sub}
          onNote={(at) => { setText((prev) => `${prev.trim() ? `${prev.trim()} ` : ''}${t('recording.publish.atMoment', { time: mmss(at * 1000) })} `); setSaying(true); }} />
      )}
      {props.making ? null : <SayRow said={said} needsNote={needsNote} text={text} hasVoice={!!hash} prior={props.n - 1} onPress={() => setSaying(true)} />}
      {props.answers.length > 0 || props.tied > 0 ? (
        <View style={{ gap: space.xs, paddingHorizontal: space.xs }}>
          {props.answers.map((r) => (
            <View key={r.id} style={styles.check}>
              <Ico name="check" size={16} color={TINT.greenText} strokeWidth={3} />
              <Text style={[txt.sm, { flex: 1 }]}>{t('recording.publish.answers', { kind: checkName(r.kindId, v.kinds), from: feedbackSource(r, ctx.name) })}</Text>
            </View>
          ))}
          {props.tied > 0 ? (
            <View style={styles.check}>
              <Ico name="check" size={16} color={TINT.greenText} strokeWidth={3} />
              <Text style={[txt.sm, { flex: 1 }]}>{t('recording.publish.tied', { count: props.tied })}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {next ? (
        <View style={{ gap: space.sm, marginTop: space.sm }}>
          <SectionLabel label={t('recording.publish.nextCheck')} />
          {kinds.map((k) => (
            <AskCheckCard key={k.kindId} ctx={ctx} kindId={k.kindId} name={checkName(k.kindId, v.kinds)} on={k.kindId === next.kindId} radio={kinds.length > 1}
              people={checkPeople(v.state, k.kindId).filter((id) => id !== ctx.session.actorId)} onPress={() => setKindId(k.kindId)} />
          ))}
          {nextTarget ? <TheyAnswer asked={questionsForKind(v.state, next.kindId)} questions={questions} setQuestions={setQuestions} /> : null}
        </View>
      ) : null}
      {saying ? (
        <Sheet visible title={needsNote ? t('recording.publish.whatChangedQuestion') : t('recording.publish.saySomething')}
          sub={needsNote ? t('recording.publish.sinceVersion', { version: versionTitle(props.n - 1) }) : t('recording.publish.anythingToKnow')}
          onClose={() => setSaying(false)} action={<SavedMark status={draft.status} help={t('saved.draftHelp')} />}
          footer={<PrimaryBtn label={t('common.done')} icon="check" help={t('recording.publish.doneHelp')} onPress={() => setSaying(false)} />}>
          <VoiceNote ctx={ctx} label={needsNote ? t('recording.publish.sayWhatChanged') : t('common.sayIt')} hash={hash} onChange={(h) => draft.set((d) => ({ ...d, hash: h }))} />
          <Field value={text} onChangeText={(x) => draft.set((d) => ({ ...d, text: x }))} placeholder={t('common.orTypeIt')} multiline />
        </Sheet>
      ) : null}
    </Screen>
  );
}

/** "Say something about it · Optional": the change note, voice first (a-publish). */
function SayRow(props: { said: boolean; needsNote: boolean; text: string; hasVoice: boolean; prior: number; onPress: () => void }) {
  const label = props.said ? (props.needsNote ? t('recording.publish.whatChanged') : t('recording.publish.whatYouSaid'))
    : props.needsNote ? t('recording.publish.sayWhatChanged') : t('recording.publish.saySomething');
  const sub = props.said
    ? [props.hasVoice ? t('common.voiceNote') : null, props.text.trim() ? t('recording.quoted', { text: props.text.trim() }) : null].filter(Boolean).join(' · ')
    : props.needsNote ? t('recording.publish.needed', { version: versionTitle(props.prior) }) : t('recording.publish.optional');
  const spot = useHelpSpot(label, t('recording.publish.sayHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={t('recording.publish.rowLabel', { label, sub })}
      style={({ pressed }) => [styles.row, props.needsNote && !props.said && { borderColor: TINT.amberText }, pressed && ps.pressed]}>
      <View style={[styles.tile, props.said && { backgroundColor: TINT.green }]}>
        <Ico name={props.said ? 'check' : 'mic'} size={22} color={props.said ? TINT.greenText : C.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle}>{label}</Text>
        <Text style={txt.smMuted} numberOfLines={3}>{sub}</Text>
      </View>
      <Ico name="right" size={22} color={C.muted} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md + 2, minHeight: target.row, padding: space.md + 2, borderRadius: radius.xl, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  tile: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: T.base, fontWeight: '800', color: C.dark },
  check: { flexDirection: 'row', alignItems: 'center', gap: space.sm }
});
