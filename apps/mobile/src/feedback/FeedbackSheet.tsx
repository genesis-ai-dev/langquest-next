// Feedback from help mode (decisions.md 145). While help is on for a screen,
// a green Send feedback button waits in a strip the screen leaves at its foot
// (kit's Screen, HELP_FOOT_ROOM), above the tabs, so it covers nothing; it can
// also be dragged anywhere out of the way. Green, with a grip, so it is not taken for
// one of the screen's own purple buttons. Like the ?, it acts rather than
// explains: it turns help off, takes the window as the person saw it, and
// opens a sheet to say, type or both what is wrong or what would help. The
// screenshot and the person's name and email each go only if they turn them
// on. A picture of their own (a photo, or a screenshot of something else) can
// go too: chosen from the phone's files and made smaller (LAN-198,
// pictureFile.ts). Saved as an account change, it goes when the phone is online.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import type { Ctx } from '../shell/ctx';
import { Chip, ChipWrap, Field, GhostBtn, Group, HELP_FOOT_ROOM, Ico, PrimaryBtn, Row, Sheet } from '../ui/kit';
import { VoiceNote } from '../audio/voiceNote';
import { HelpLit } from '../helpMode/helpBadge';
import { useHelpMode } from '../helpMode/useHelpMode';
import { useAccountActions, useDisplayNames } from '../account/useAccount';
import { ownName } from '../account/accountText';
import { failureMessage, noteExpected } from '../diagnostics/report';
import { t } from '../i18n';
import { lift } from '../ui/shadow';
import { C, onColor, radius, space } from '../ui/theme';
import { captureWindow } from './capture';
import { adoptWaitingFeedback, sendFeedback } from './feedbackData';
import {
  bodyPlaceholder, FEEDBACK_KINDS, feedbackReady, kindLabel, pillPlace, previewSize, profileChoice, sentMessage, voiceTooLong,
  type FeedbackKind, type Shot, type VoiceRef
} from './feedbackModel';
import { choosePicture, shrinkPicture, type ChosenPicture } from './pictureFile';

/** Two frames: the dimming has gone from the screen before it is taken. */
const afterPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** A press that moves further than this is a drag, not a tap. */
const DRAG_SLOP = 6;

/** Where the person last dragged Send feedback, while the app runs: help opens with it there again. */
let kept = { dx: 0, dy: 0 };

type Size = { width: number; height: number };

/** The Feedback button over a screen in help mode, and the sheet it opens. */
export function FeedbackHost(props: { ctx: Ctx; screen: string; signedIn: boolean }) {
  const help = useHelpMode();
  const [open, setOpen] = useState<{ shot: Shot | null } | null>(null);
  const [taking, setTaking] = useState(false);
  const [area, setArea] = useState<Size | null>(null);
  const [pill, setPill] = useState<Size | null>(null);
  const [drag, setDrag] = useState(kept);
  const { actorId } = props.ctx.session;
  // What was written before signing in goes as whoever signs in.
  useEffect(() => { if (props.signedIn) void adoptWaitingFeedback(actorId); }, [props.signedIn, actorId]);
  const showing = !!help?.on && help.top === null && !taking;

  // Centred in the strip the screen leaves for it.
  const bottom = pill ? Math.max(0, (HELP_FOOT_ROOM - pill.height) / 2) : space.sm;
  const place = area && pill ? pillPlace(area, pill, bottom, drag) : null;
  const latest = useRef({ place, area, pill, bottom });
  latest.current = { place, area, pill, bottom };
  const from = useRef(kept);
  const moved = useRef(false);
  const [pressed, setPressed] = useState(false);
  const open_ = useRef<() => void>(() => {});
  // The button is its own responder, for a tap and a drag alike: a press that
  // moves past DRAG_SLOP moves it; one that does not opens feedback.
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { from.current = latest.current.place?.drag ?? kept; moved.current = false; setPressed(true); },
    onPanResponderMove: (_e, g) => {
      if (!moved.current && Math.abs(g.dx) + Math.abs(g.dy) <= DRAG_SLOP) return;
      moved.current = true;
      setDrag({ dx: from.current.dx + g.dx, dy: from.current.dy + g.dy });
    },
    onPanResponderRelease: (_e, g) => {
      setPressed(false);
      if (!moved.current) { open_.current(); return; }
      const { area: a, pill: p, bottom } = latest.current;
      const next = { dx: from.current.dx + g.dx, dy: from.current.dy + g.dy };
      kept = a && p ? pillPlace(a, p, bottom, next).drag : next;
      setDrag(kept);
    },
    onPanResponderTerminate: () => { setPressed(false); },
    onPanResponderTerminationRequest: () => false
  }), []);

  async function start() {
    if (!help) return;
    setTaking(true);
    help.setOn(false);
    await afterPaint();
    const shot = await captureWindow();
    setTaking(false);
    setOpen({ shot });
  }
  open_.current = () => void start();

  return (
    <>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none"
        onLayout={(e) => setArea({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
        {showing ? (
          // help-ignore: help mode's own button, like the ?: it opens feedback rather than explaining
          <View {...responder.panHandlers} testID="help-feedback" accessible accessibilityRole="button" accessibilityLabel={t('feedback.open')}
            onAccessibilityTap={() => void start()}
            onLayout={(e) => setPill({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
            style={[styles.place, styles.pill, place ? { left: place.left, top: place.top } : styles.unplaced, pressed && { opacity: 0.85 }]}>
            <Ico name="grip" size={18} color="rgba(255,255,255,0.75)" />
            <Ico name="chatDots" size={20} color={C.white} />
            <Text style={styles.pillText}>{t('feedback.open')}</Text>
            <HelpLit />
          </View>
        ) : null}
      </View>
      {open ? <FeedbackSheet ctx={props.ctx} screen={props.screen} shot={open.shot} signedIn={props.signedIn} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function FeedbackSheet(props: { ctx: Ctx; screen: string; shot: Shot | null; signedIn: boolean; onClose: () => void }) {
  const { ctx, shot } = props;
  const me = ctx.session.actorId;
  // A problem until it is said to be an idea: the words already ask "What happened?", and Send waits only for them.
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [body, setBody] = useState('');
  const [voice, setVoice] = useState<VoiceRef | null>(null);
  const [withShot, setWithShot] = useState(false);
  const [withProfile, setWithProfile] = useState(false);
  const [picture, setPicture] = useState<ChosenPicture | null>(null);
  /** A chosen picture being made smaller: Send waits for it. */
  const shrinking = useRef<Promise<string | null> | null>(null);
  const [busy, setBusy] = useState(false);
  const profile = props.signedIn;
  const ready = feedbackReady(kind, body, voice);

  async function choose() {
    try {
      const chosen = await choosePicture();
      if (!chosen) return;
      shrinking.current = null;
      setPicture(chosen);
    } catch (e) {
      noteExpected('feedback: choose picture', e);
      ctx.toast(t('feedback.toast.pictureFailed'), 'problem');
    }
  }

  // Shown on the sheet: one that does not fit yet is taken from there as a smaller JPEG.
  function shown(chosen: ChosenPicture, view: View, size: Size) {
    if (chosen.base64) return;
    const taking = shrinkPicture(view, size).catch((e: unknown) => { noteExpected('feedback: shrink picture', e); return null; });
    shrinking.current = taking;
    void taking.then((base64) => {
      if (shrinking.current !== taking) return;
      shrinking.current = null;
      if (base64) { setPicture((p) => (p === chosen ? { ...chosen, base64 } : p)); return; }
      setPicture((p) => (p === chosen ? null : p));
      ctx.toast(t('feedback.toast.pictureFailed'), 'problem');
    });
  }

  function removePicture() {
    shrinking.current = null;
    setPicture(null);
  }

  async function send() {
    if (voiceTooLong(voice)) { ctx.toast(t('feedback.toast.voiceTooLong')); return; }
    if (!feedbackReady(kind, body, voice)) return;
    setBusy(true);
    try {
      const chosen = picture?.base64 ?? (picture && shrinking.current ? await shrinking.current : null);
      const sent = await sendFeedback(props.signedIn ? me : null, {
        kind, body, voice, shareProfile: withProfile && profile, shot: withShot && shot ? shot.base64 : null, picture: chosen, screen: props.screen
      });
      ctx.toast(sentMessage(sent, props.signedIn));
      props.onClose();
    } catch (e) {
      ctx.toast(failureMessage('send feedback', e), 'problem');
      setBusy(false);
    }
  }

  return (
    <Sheet visible title={t('feedback.title')} onClose={props.onClose}
      footer={<PrimaryBtn label={t('feedback.send')} icon="send" disabled={(!ready && !voiceTooLong(voice)) || busy} busy={busy} onPress={() => void send()} />}>
      <ChipWrap>
        {/* help-each: a problem and an idea are different reports */}
        {FEEDBACK_KINDS.map((k) => (
          <Chip key={k} label={kindLabel(k)} icon={k} on={kind === k} onPress={() => setKind(k)}
            help={k === 'bug' ? t('feedback.help.bug') : t('feedback.help.idea')} />
        ))}
      </ChipWrap>
      <Field value={body} onChangeText={setBody} placeholder={bodyPlaceholder(kind)} multiline testID="feedback-body" help={t('feedback.help.body')} />
      <VoiceNote ctx={ctx} label={t('common.sayIt')} hash={voice?.hash ?? null}
        onChange={(hash, card) => setVoice(hash && card ? { hash, format: card.format, durationMs: card.durationMs } : null)} />
      <Group>
        {shot ? (
          <Row testID="feedback-screenshot" label={t('feedback.addScreenshot')} role="switch" checked={withShot} onPress={() => setWithShot((v) => !v)}
            help={t('feedback.help.screenshot')}
            leading={<Image source={{ uri: `data:image/jpeg;base64,${shot.base64}` }} style={[styles.thumb, { height: Math.round((THUMB * shot.height) / shot.width) }]}
              accessibilityIgnoresInvertColors />} />
        ) : null}
        <Row testID="feedback-picture" icon="media" label={picture ? t('feedback.otherPicture') : t('feedback.addPicture')}
          onPress={() => void choose()} help={t('feedback.help.picture')} last={!picture && !profile} />
        {picture ? (
          <PicturePreview key={picture.uri} picture={picture} last={!profile} onShown={(view, size) => shown(picture, view, size)} onRemove={removePicture} />
        ) : null}
        {profile ? <ProfileSwitch ctx={ctx} on={withProfile} onToggle={() => setWithProfile((v) => !v)} /> : null}
      </Group>
    </Sheet>
  );
}

/** The tallest a chosen picture shows on the sheet. */
const PREVIEW_HEIGHT = 360;

/** The chosen picture, as wide as the sheet, and the way to take it off the report. */
function PicturePreview(props: { picture: ChosenPicture; last: boolean; onShown: (view: View, size: Size) => void; onRemove: () => void }) {
  const frame = useRef<View>(null);
  const [width, setWidth] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const size = width > 0 ? previewSize(props.picture, width, PREVIEW_HEIGHT) : null;
  const told = useRef(false);
  const onShown = useRef(props.onShown);
  onShown.current = props.onShown;
  useEffect(() => {
    if (!loaded || !size || told.current) return;
    told.current = true;
    // A frame more, so the picture is drawn before it is taken.
    requestAnimationFrame(() => { if (frame.current) onShown.current(frame.current, size); });
  }, [loaded, size]);
  return (
    <View style={[styles.preview, !props.last && styles.previewBorder]}
      onLayout={(e) => setWidth(Math.max(0, e.nativeEvent.layout.width - 2 * space.md))}>
      {size ? (
        <View style={[styles.pictureClip, size]}>
          {/* Not collapsed away on Android, so it can be taken as the smaller JPEG. */}
          <View ref={frame} collapsable={false} style={size}>
            <Image testID="feedback-picture-preview" source={{ uri: props.picture.uri }} style={size} resizeMode="contain"
              onLoad={() => setLoaded(true)} accessibilityIgnoresInvertColors />
          </View>
        </View>
      ) : null}
      <GhostBtn label={t('feedback.removePicture')} icon="trash" tone="red" full={false} onPress={props.onRemove}
        help={t('feedback.help.removePicture')} />
    </View>
  );
}

/** Add my name and email, showing what that would send. Only for someone signed in. */
function ProfileSwitch(props: { ctx: Ctx; on: boolean; onToggle: () => void }) {
  const { actorId, email } = props.ctx.session;
  const profiles = useAccountActions(actorId).filter((a) => a.kind === 'profile');
  const names = useDisplayNames(actorId);
  const choice = profileChoice(ownName(profiles, names[actorId], email, t('common.you')), email);
  return (
    <Row testID="feedback-profile" icon="user" label={choice.label} sub={choice.sub} role="switch" checked={props.on}
      onPress={props.onToggle} help={t('feedback.help.profile')} last />
  );
}

const THUMB = 40;

const styles = StyleSheet.create({
  place: { position: 'absolute', maxWidth: '92%' },
  // Until it is measured it waits, unseen, where it will go.
  unplaced: { left: space.lg, bottom: space.lg, opacity: 0 },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 52, paddingLeft: space.md, paddingRight: space.lg,
    borderRadius: radius.full, backgroundColor: onColor.green, borderWidth: 2, borderColor: C.white, ...lift({ opacity: 0.3, radius: 14, y: 5, elevation: 6 })
  },
  pillText: { fontSize: 16, fontWeight: '800', color: C.white, flexShrink: 1 },
  thumb: { width: THUMB, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, backgroundColor: C.bg },
  preview: { padding: space.md, gap: space.md, alignItems: 'center' },
  previewBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  pictureClip: { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: C.bg }
});
