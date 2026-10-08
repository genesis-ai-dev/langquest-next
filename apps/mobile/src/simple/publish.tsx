// Publish, as its own screen inside the recording workspace (decision 71;
// demo ADR-034, simple/translator.tsx Publish; REC-W3, REC-W4): hear the
// version once more, say something about it (voice first; needed from
// Version 2 on, where it says what changed), then publish it for the team.
// What happens next (ask for a check) is the passage record's, opened with
// the `published` param by the workspace.
import { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { ClipPlayer } from '../clipPlayer';
import type { Ctx } from '../ctx';
import { useHelpPress } from '../helpContext';
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
  const [text, setText] = useState(props.revisingKind ? `Revised after the ${props.revisingKind} feedback.` : '');
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
  const parts = `${props.cards.length} part${props.cards.length === 1 ? '' : 's'}`;
  const sub = [parts, props.totalMs !== undefined ? mmss(props.totalMs) : null, props.bible ? `recorded with the ${props.bible} Bible` : null].filter(Boolean).join(' · ');
  return (
    <Screen
      header={<Header title={v.title} sub="Publish" onBack={props.onClose} close />}
      footer={<PrimaryBtn label={`Publish ${title}`} icon="send" busy={props.busy} disabled={needsNote && !said} onPress={() => props.onPublish(text, hash)} />}>
      <ClipPlayer language={ctx.language} hashes={props.cards} title={title} sub={sub}
        onNote={(at) => { setText((t) => `${t.trim() ? `${t.trim()} ` : ''}At ${mmss(at * 1000)}: `); setSaying(true); }} />
      <SayRow said={said} needsNote={needsNote} text={text} hasVoice={!!hash} prior={props.n - 1} onPress={() => setSaying(true)} />
      <Text style={styles.explain}>
        Publishing saves {title} to the passage. Everyone on the team can hear it. It goes out when the device has internet.
      </Text>
      {props.answers.length > 0 || props.tied > 0 ? (
        <View style={{ gap: space.xs, paddingHorizontal: space.xs }}>
          {props.answers.map((r) => (
            <View key={r.id} style={styles.check}>
              <Ico name="check" size={16} color={TINT.greenText} strokeWidth={3} />
              <Text style={[txt.sm, { flex: 1 }]}>Answers the {v.kind(r.kindId).name} feedback from {feedbackSource(r, ctx.name)}</Text>
            </View>
          ))}
          {props.tied > 0 ? (
            <View style={styles.check}>
              <Ico name="check" size={16} color={TINT.greenText} strokeWidth={3} />
              <Text style={[txt.sm, { flex: 1 }]}>{props.tied} key word{props.tied === 1 ? '' : 's'} tied to this version</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {saying ? (
        <Sheet visible title={needsNote ? 'What changed?' : 'Say something about it'}
          sub={needsNote ? `Since ${versionTitle(props.n - 1)}. The team hears it with this version.` : 'Anything the team should know. They hear it with this version.'}
          onClose={() => setSaying(false)}
          footer={<PrimaryBtn label="Done" icon="check" onPress={() => setSaying(false)} />}>
          <VoiceNote ctx={ctx} label={needsNote ? 'Say what changed' : 'Say it'} hash={hash} onChange={setHash} />
          <Field value={text} onChangeText={setText} placeholder="Or type it" multiline />
        </Sheet>
      ) : null}
    </Screen>
  );
}

/** "Say something about it · Optional": the change note, voice first (a-publish). */
function SayRow(props: { said: boolean; needsNote: boolean; text: string; hasVoice: boolean; prior: number; onPress: () => void }) {
  const label = props.said ? (props.needsNote ? 'What changed' : 'What you said about it') : props.needsNote ? 'Say what changed' : 'Say something about it';
  const sub = props.said
    ? [props.hasVoice ? 'Voice note' : null, props.text.trim() ? `“${props.text.trim()}”` : null].filter(Boolean).join(' · ')
    : props.needsNote ? `Needed · since ${versionTitle(props.prior)}, so the team knows what to listen for` : 'Optional · the team hears it with this version';
  const onPress = useHelpPress(label, 'By voice or typed. The team hears it with this version.', props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}. ${sub}`}
      style={({ pressed }) => [styles.row, props.needsNote && !props.said && { borderColor: TINT.amberText }, pressed && ps.pressed]}>
      <View style={[styles.tile, props.said && { backgroundColor: TINT.green }]}>
        <Ico name={props.said ? 'check' : 'mic'} size={22} color={props.said ? TINT.greenText : C.primary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle}>{label}</Text>
        <Text style={txt.smMuted} numberOfLines={3}>{sub}</Text>
      </View>
      <Ico name="right" size={22} color={C.muted} />
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
