// Publish, as its own screen inside the recording workspace (decision 71;
// demo ADR-034, simple/translator.tsx Publish; REC-W3, REC-W4): hear the
// version once more, say something about it (voice first; needed from
// Version 2 on, where it says what changed), then publish it for the team.
// What happens next (ask for a check) is the passage record's, opened with
// the `published` param by the workspace.
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import { ClipPlayer } from '../clipPlayer';
import type { Ctx } from '../ctx';
import { useHelpSpot } from '../helpContext';
import { HelpBadge } from '../helpBadge';
import { t } from '../i18n';
import { Field, Header, Ico, PrimaryBtn, Screen, Sheet, txt } from '../kit';
import { feedbackSource, versionTitle, type PassageView } from '../passageView';
import type { ReviewView } from '@langquest-next/core';
import { C, radius, space, target, TINT, type as T } from '../theme';
import { VoiceNote } from '../voiceNote';
import { mmss } from './model';
import { styles as ps } from './parts';

export function PublishScreen(props: {
  ctx: Ctx; v: PassageView; n: number; first: boolean; cards: string[]; totalMs: number | undefined; bible: string | undefined;
  busy: boolean; answers: ReviewView[]; tied: number; revisingKind?: string;
  onClose: () => void; onPublish: (note: string, hash: string | null) => void;
}) {
  const { ctx, v } = props;
  const title = versionTitle(props.n);
  // A first draft of the note, in the person's words: they can change it, and it is saved as they leave it.
  const [text, setText] = useState(props.revisingKind ? t('recording.publish.revisedAfter', { kind: props.revisingKind }) : '');
  const [hash, setHash] = useState<string | null>(null);
  const [saying, setSaying] = useState(false);
  const needsNote = !props.first;
  // A screen inside the workspace: Back returns to it, never past it.
  const onClose = props.onClose;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);
  const said = !!text.trim() || !!hash;
  const parts = t('recording.publish.parts', { count: props.cards.length });
  const sub = [parts, props.totalMs !== undefined ? mmss(props.totalMs) : null, props.bible ? t('recording.publish.withBible', { bible: props.bible }) : null].filter(Boolean).join(' · ');
  return (
    <Screen
      header={<Header title={v.title} sub={t('common.publish')} onBack={props.onClose} close />}
      footer={<PrimaryBtn label={t('recording.publish.publishVersion', { version: title })} icon="send" busy={props.busy} disabled={needsNote && !said} onPress={() => props.onPublish(text, hash)} />}>
      <ClipPlayer language={ctx.language} hashes={props.cards} title={title} sub={sub}
        onNote={(at) => { setText((prev) => `${prev.trim() ? `${prev.trim()} ` : ''}${t('recording.publish.atMoment', { time: mmss(at * 1000) })} `); setSaying(true); }} />
      <SayRow said={said} needsNote={needsNote} text={text} hasVoice={!!hash} prior={props.n - 1} onPress={() => setSaying(true)} />
      <Text style={styles.explain}>{t('recording.publish.explain', { version: title })}</Text>
      {props.answers.length > 0 || props.tied > 0 ? (
        <View style={{ gap: space.xs, paddingHorizontal: space.xs }}>
          {props.answers.map((r) => (
            <View key={r.id} style={styles.check}>
              <Ico name="check" size={16} color={TINT.greenText} strokeWidth={3} />
              <Text style={[txt.sm, { flex: 1 }]}>{t('recording.publish.answers', { kind: v.kind(r.kindId).name, from: feedbackSource(r, ctx.name) })}</Text>
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
      {saying ? (
        <Sheet visible title={needsNote ? t('recording.publish.whatChangedQuestion') : t('recording.publish.saySomething')}
          sub={needsNote ? t('recording.publish.sinceVersion', { version: versionTitle(props.n - 1) }) : t('recording.publish.anythingToKnow')}
          onClose={() => setSaying(false)}
          footer={<PrimaryBtn label={t('common.done')} icon="check" onPress={() => setSaying(false)} />}>
          <VoiceNote ctx={ctx} label={needsNote ? t('recording.publish.sayWhatChanged') : t('common.sayIt')} hash={hash} onChange={setHash} />
          <Field value={text} onChangeText={setText} placeholder={t('common.orTypeIt')} multiline />
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
  explain: { fontSize: T.sm + 1, lineHeight: 23, color: C.muted, paddingHorizontal: space.xs },
  check: { flexDirection: 'row', alignItems: 'center', gap: space.sm }
});
