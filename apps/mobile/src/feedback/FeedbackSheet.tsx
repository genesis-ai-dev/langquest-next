// Feedback from help mode (decisions.md 141). While help is on for a screen,
// a lit Feedback button waits at the foot of it, where toasts show, so it
// never covers the header, the tabs or the screen's own buttons. Like the ?,
// it acts rather than explains: it turns help off, takes the window as the
// person saw it, and opens a sheet to say what is wrong or what would help.
// The screenshot and the person's name and email each go only if they turn
// them on. Saved as an account change, it goes when the phone is online.
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { Chip, ChipWrap, Field, Group, Ico, PrimaryBtn, Row, Sheet } from '../ui/kit';
import { HelpLit } from '../helpMode/helpBadge';
import { useHelpMode } from '../helpMode/useHelpMode';
import { useAccountActions, useDisplayNames } from '../account/useAccount';
import { ownName } from '../account/accountText';
import { failureMessage } from '../diagnostics/report';
import { t } from '../i18n';
import { lift } from '../ui/shadow';
import { C, radius, space } from '../ui/theme';
import { captureWindow, type Shot } from './capture';
import { adoptWaitingFeedback, sendFeedback } from './feedbackData';
import { bodyPlaceholder, FEEDBACK_KINDS, feedbackReady, kindLabel, profileChoice, sentMessage, type FeedbackKind } from './feedbackModel';

/** Two frames: the dimming has gone from the screen before it is taken. */
const afterPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** The Feedback button over a screen in help mode, and the sheet it opens. */
export function FeedbackHost(props: { ctx: Ctx; screen: string; bottom: number; signedIn: boolean }) {
  const help = useHelpMode();
  const [open, setOpen] = useState<{ shot: Shot | null } | null>(null);
  const [taking, setTaking] = useState(false);
  const { actorId } = props.ctx.session;
  // What was written before signing in goes as whoever signs in.
  useEffect(() => { if (props.signedIn) void adoptWaitingFeedback(actorId); }, [props.signedIn, actorId]);
  const showing = !!help?.on && help.top === null && !taking;

  async function start() {
    if (!help) return;
    setTaking(true);
    help.setOn(false);
    await afterPaint();
    const shot = await captureWindow();
    setTaking(false);
    setOpen({ shot });
  }

  return (
    <>
      {showing ? (
        <View style={[styles.wrap, { bottom: props.bottom }]} pointerEvents="box-none">
          {/* help-ignore: help mode's own button, like the ?: it opens feedback rather than explaining */}
          <Pressable testID="help-feedback" onPress={() => void start()} accessibilityRole="button" accessibilityLabel={t('feedback.open')}
            style={({ pressed }) => [styles.pill, pressed && { opacity: 0.85 }]}>
            <Ico name="chatDots" size={20} color={C.white} />
            <Text style={styles.pillText}>{t('feedback.open')}</Text>
            <HelpLit />
          </Pressable>
        </View>
      ) : null}
      {open ? <FeedbackSheet ctx={props.ctx} screen={props.screen} shot={open.shot} signedIn={props.signedIn} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function FeedbackSheet(props: { ctx: Ctx; screen: string; shot: Shot | null; signedIn: boolean; onClose: () => void }) {
  const { ctx, shot } = props;
  const me = ctx.session.actorId;
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [body, setBody] = useState('');
  const [withShot, setWithShot] = useState(false);
  const [withProfile, setWithProfile] = useState(false);
  const [busy, setBusy] = useState(false);
  const profiles = useAccountActions(me).filter((a) => a.kind === 'profile');
  const names = useDisplayNames(me);
  const profile = props.signedIn ? profileChoice(ownName(profiles, names[me], ctx.session.email, t('common.you')), ctx.session.email) : null;
  const ready = feedbackReady(kind, body);

  async function send() {
    if (!feedbackReady(kind, body)) return;
    setBusy(true);
    try {
      const sent = await sendFeedback(props.signedIn ? me : null, {
        kind, body, shareProfile: withProfile && !!profile, shot: withShot && shot ? shot.base64 : null, screen: props.screen
      });
      ctx.toast(sentMessage(sent, props.signedIn));
      props.onClose();
    } catch (e) {
      ctx.toast(failureMessage('send feedback', e));
      setBusy(false);
    }
  }

  return (
    <Sheet visible title={t('feedback.title')} onClose={props.onClose}
      footer={<PrimaryBtn label={t('feedback.send')} icon="send" disabled={!ready || busy} busy={busy} onPress={() => void send()} />}>
      <ChipWrap>
        {/* help-each: a problem and an idea are different reports */}
        {FEEDBACK_KINDS.map((k) => (
          <Chip key={k} label={kindLabel(k)} icon={k} on={kind === k} onPress={() => setKind(k)}
            help={k === 'bug' ? t('feedback.help.bug') : t('feedback.help.idea')} />
        ))}
      </ChipWrap>
      <Field value={body} onChangeText={setBody} placeholder={bodyPlaceholder(kind)} multiline testID="feedback-body" help={t('feedback.help.body')} />
      {shot || profile ? (
        <Group>
          {shot ? (
            <Row testID="feedback-screenshot" label={t('feedback.addScreenshot')} role="switch" checked={withShot} onPress={() => setWithShot((v) => !v)}
              help={t('feedback.help.screenshot')} last={!profile}
              leading={<Image source={{ uri: `data:image/jpeg;base64,${shot.base64}` }} style={[styles.thumb, { height: Math.round((THUMB * shot.height) / shot.width) }]}
                accessibilityIgnoresInvertColors />} />
          ) : null}
          {profile ? (
            <Row testID="feedback-profile" icon="user" label={profile.label} sub={profile.sub} role="switch" checked={withProfile}
              onPress={() => setWithProfile((v) => !v)} help={t('feedback.help.profile')} last />
          ) : null}
        </Group>
      ) : null}
    </Sheet>
  );
}

const THUMB = 40;

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, maxWidth: '100%', paddingHorizontal: space.lg,
    borderRadius: radius.full, backgroundColor: C.primary, ...lift({ opacity: 0.25 })
  },
  pillText: { fontSize: 16, fontWeight: '700', color: C.white, flexShrink: 1 },
  thumb: { width: THUMB, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, backgroundColor: C.bg }
});
